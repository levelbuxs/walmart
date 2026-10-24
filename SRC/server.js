import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { keywordUrl, DEFAULT_KEYWORDS, normalizeKeywords, validateSettings, diffProducts, readClaimableProducts, selectDueKeywords } from './monitor-core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PULSE_DATA_DIR || path.join(ROOT, '.local', 'product-pulse');
const PREVIEW = process.env.PULSE_PREVIEW === '1';
await mkdir(DATA, { recursive: true, mode: 0o700 });
let state;
try { state = JSON.parse(await readFile(path.join(DATA, 'state.json'), 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Saved state could not be read. Back up .local/product-pulse before repairing state.json.');
  state = { keywords: ['', ...DEFAULT_KEYWORDS].map(keyword => ({ id: randomUUID(), keyword, nextDue: 0 })), settings: { minutes: 5, concurrency: 1, telegram: false, chatId: '' }, snapshots: {}, events: [], telegramToken: '' };
}
let context = null, loginPage = null, running = false, pauseReason = '', launchPromise = null, runGeneration = 0, revision = 1;
const active = new Map(), held = new Map();
let writing = Promise.resolve();
function changed() { revision++; }
function persist() {
  changed();
  const json = JSON.stringify(state);
  const task = writing.catch(() => {}).then(async () => {
    await writeFile(path.join(DATA, 'state.tmp'), json, { mode: 0o600 });
    await rename(path.join(DATA, 'state.tmp'), path.join(DATA, 'state.json'));
  });
  writing = task;
  return task;
}
function publicState() {
  return { keywords: state.keywords, settings: { ...state.settings, hasToken: !!state.telegramToken }, snapshots: state.snapshots, events: state.events, running, pauseReason, browserConnected: !!context, active: [...active.keys()], held: [...held.keys()], preview: PREVIEW, revision, now: Date.now() };
}
async function browser() {
  if (PREVIEW) throw new Error('This is the hosted setup preview. Run npm start on your PC to open your signed-in browser.');
  if (context) return context;
  if (launchPromise) return launchPromise;
  launchPromise = (async () => {
    const { chromium } = await import('playwright');
    const options = { headless: false, viewport: null, acceptDownloads: false };
    if (process.env.PULSE_BROWSER !== 'chromium') options.channel = process.env.PULSE_BROWSER || 'chrome';
    try { context = await chromium.launchPersistentContext(path.join(DATA, 'browser-profile'), options); }
    catch { throw new Error('Could not open the dedicated browser. Close any previous Product Pulse browser, or install Chrome. To use Playwright Chromium: npx playwright install chromium, then set PULSE_BROWSER=chromium and run npm start.'); }
    context.on('close', () => { context = null; loginPage = null; running = false; runGeneration++; pauseReason = 'Monitoring browser closed. Open it again and sign in, then Start.'; changed(); });
    changed();
    return context;
  })();
  try { return await launchPromise; } finally { launchPromise = null; }
}
async function openLogin() {
  const ctx = await browser();
  if (!loginPage || loginPage.isClosed()) {
    loginPage = ctx.pages().find(page => page.url() === 'about:blank') || await ctx.newPage();
    await loginPage.goto(keywordUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await loginPage.bringToFront();
}
function pause(reason) { running = false; runGeneration++; pauseReason = reason; changed(); }
async function sendTelegram(message) {
  if (!state.settings.telegram) return;
  if (!state.telegramToken || !state.settings.chatId) throw new Error('Telegram bot token and chat ID are required.');
  let response, body;
  try {
    response = await fetch(`https://api.telegram.org/bot${state.telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: state.settings.chatId, text: message.slice(0, 4000), disable_web_page_preview: true }), signal: AbortSignal.timeout(12000) });
    body = await response.json();
  } catch { throw new Error('Telegram network error or timeout.'); }
  if (!response.ok || !body.ok) throw new Error(`Telegram rejected delivery (${response.status}). Check your bot, chat ID, and /start conversation.`);
}
async function recordAlerts(keyword, result) {
  const urgentIds = new Set(result.urgent.map(p => p.id));
  const groups = [{ urgent: true, items: result.urgent }, { urgent: false, items: result.added.filter(p => !urgentIds.has(p.id)) }];
  for (const group of groups.filter(g => g.items.length)) {
    const event = { id: randomUUID(), keyword: keyword.keyword, keywordId: keyword.id, urgent: group.urgent, at: Date.now(), items: group.items.slice(0, 100), count: group.items.length, failure: '' };
    state.events.unshift(event); state.events = state.events.slice(0, 150);
    while (state.events.length > 1 && JSON.stringify(state.events).length > 2000000) state.events.pop();
    await persist();
    try { await sendTelegram(`${group.urgent ? 'URGENT new product' : 'New product'} · ${keyword.keyword || 'All products'}\n${group.items.slice(0, 12).map(p => `${p.title}\nValue: ${p.price == null ? 'Unknown' : '$' + p.price.toFixed(2)}\n${p.url}`).join('\n\n')}`); }
    catch (error) { event.failure = error.message; await persist(); }
  }
}
async function extract(page, generation) {
  let signature = '', stable = 0, last;
  const until = Date.now() + 35000;
  const start = Date.now();
  while (Date.now() < until) {
    if (!running || generation !== runGeneration) return null;
    last = await page.evaluate(readClaimableProducts);
    if (['verification', 'login'].includes(last.status)) return last;
    const next = JSON.stringify(last);
    stable = ['ok', 'empty'].includes(last.status) && next === signature ? stable + 1 : 0;
    signature = next;
    const atBottom = await page.evaluate(() => {
      window.scrollBy(0, Math.max(600, innerHeight * 0.85));
      return scrollY + innerHeight >= document.documentElement.scrollHeight - 20;
    });
    if (stable >= 3 && atBottom && Date.now() - start >= 5000) return last;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Could not read a stable first-page list. Last good products kept. The page layout may need an adapter.');
}
async function scan(keyword, generation) {
  let page, keep = false;
  const started = Date.now();
  try {
    const ctx = await browser();
    if (!running || generation !== runGeneration) return;
    page = await ctx.newPage();
    await page.goto(keywordUrl(keyword.keyword), { waitUntil: 'domcontentloaded', timeout: 60000 });
    const result = await extract(page, generation);
    if (!result || !running || generation !== runGeneration) return;
    if (['verification', 'login'].includes(result.status)) {
      keep = true; held.set(keyword.id, page);
      const blocked = state.keywords.find(k => k.id === keyword.id);
      keyword.error = result.status === 'verification' ? 'Verification required. Resolve it in the open browser tab, then Resume.' : 'Sign in in the open browser tab, then Resume.';
      if (blocked) blocked.error = keyword.error;
      pause(keyword.error); return;
    }
    const url = new URL(page.url());
    if (url.origin !== 'https://www.walmart.com' || url.pathname !== '/reviews/claim-product' || url.searchParams.get('page') !== '1' || url.searchParams.get('sort') !== 'price_high' || (url.searchParams.get('queryNups') || '') !== keyword.keyword) throw new Error('Page redirected away from the expected first-page search. Check the browser login.');
    await page.close(); page = null;
    if (!running || generation !== runGeneration) return;
    const current = state.keywords.find(k => k.id === keyword.id);
    if (!current || current.keyword !== keyword.keyword) return;
    const comparison = diffProducts(state.snapshots[keyword.id], result.products);
    state.snapshots[keyword.id] = { products: comparison.products, high: comparison.high, checked: Date.now(), added: comparison.added.map(p => p.id), urgent: comparison.urgent.map(p => p.id), excluded: result.excluded || 0 };
    current.error = ''; current.lastCheck = Date.now();
    // The per-keyword timer starts on successful completion, not the start of a batch.
    current.nextDue = Date.now() + state.settings.minutes * 60000;
    await persist();
    if (!comparison.baseline && running && generation === runGeneration) await recordAlerts(current, comparison);
  } catch (error) {
    const current = state.keywords.find(k => k.id === keyword.id);
    if (current && running && generation === runGeneration) { current.error = error.message; current.nextDue = Date.now() + state.settings.minutes * 60000; }
  } finally {
    if (page && !keep) await page.close().catch(() => {});
    const current = state.keywords.find(k => k.id === keyword.id);
    if (current) current.lastDuration = Date.now() - started;
    await persist().catch(() => { pauseReason = 'Could not save local data. Check disk space and permissions.'; running = false; });
  }
}
function pump() {
  if (!running) return;
  const due = selectDueKeywords(state.keywords, new Set(active.keys()), Date.now(), state.settings.concurrency);
  while (due.length && active.size < state.settings.concurrency) {
    const keyword = due.shift();
    const job = scan({ ...keyword }, runGeneration).finally(() => { active.delete(keyword.id); changed(); pump(); });
    active.set(keyword.id, job); changed();
  }
}
const scheduler = setInterval(pump, 1000);

const publicFiles = new Map([['/', 'app.html'], ['/app.html', 'app.html'], ['/app.js', 'app.js'], ['/app.css', 'app.css'], ['/icons/icon128.png', 'icons/icon128.png']]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('JSON requests only.');
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 64000) throw new Error('Request is too large.'); }
  return JSON.parse(body || '{}');
}
const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) && !(PREVIEW && /^[a-z0-9.-]+\.e2b\.app(:\d+)?$/i.test(host))) return json(response, 403, { error: 'Unrecognized host. Open this app on localhost.' });
    if (request.headers.origin && new URL(request.headers.origin).host !== host) return json(response, 403, { error: 'Cross-origin requests are not allowed.' });
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(request.url, `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const etag = `"${revision}"`;
      if (request.headers['if-none-match'] === etag) { response.writeHead(304); return response.end(); }
      response.setHeader('ETag', etag); return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readJson(request);
      if (url.pathname === '/api/keywords') {
        if (running || active.size) throw new Error('Pause monitoring and wait for active scans to finish before editing keywords.');
        const keywords = normalizeKeywords(body.keywords);
        if (body.includeAll) keywords.unshift('');
        const existing = new Map(state.keywords.map(k => [k.keyword.toLowerCase(), k]));
        state.keywords = keywords.map(keyword => existing.has(keyword.toLowerCase()) ? { ...existing.get(keyword.toLowerCase()), keyword } : { id: randomUUID(), keyword, nextDue: 0 });
        const ids = new Set(state.keywords.map(k => k.id));
        for (const id of Object.keys(state.snapshots)) if (!ids.has(id)) delete state.snapshots[id];
        await persist();
      } else if (url.pathname === '/api/settings') {
        if (running || active.size) throw new Error('Pause before changing the schedule.');
        if (PREVIEW && (body.telegram || body.token)) throw new Error('Configure Telegram only in the app running on your computer, not this hosted preview.');
        const settings = validateSettings(body);
        const token = body.token === undefined ? state.telegramToken : String(body.token).trim();
        if (settings.telegram && (!token || !settings.chatId)) throw new Error('Telegram needs a bot token and chat ID.');
        state.settings = settings; state.telegramToken = token;
        state.keywords.forEach(k => { if (k.lastCheck) k.nextDue = k.lastCheck + settings.minutes * 60000; });
        await persist();
      } else if (url.pathname === '/api/browser') {
        await openLogin();
      } else if (url.pathname === '/api/start') {
        if (PREVIEW) throw new Error('Hosted preview only. Download/run the app on your PC with npm start. No account is being monitored here.');
        if (active.size) throw new Error('Wait for the previous scans to stop before resuming.');
        if (!state.keywords.length) throw new Error('Add at least one keyword first.');
        await browser();
        for (const [id, page] of held) {
          if (!page.isClosed()) {
            const result = await page.evaluate(readClaimableProducts);
            if (['verification', 'login', 'unrecognized'].includes(result.status)) throw new Error('Resolve verification/sign-in in the held browser tab before resuming.');
            await page.close();
          }
          held.delete(id);
        }
        running = true; pauseReason = ''; runGeneration++;
        changed(); pump();
      } else if (url.pathname === '/api/pause') { pause('Paused by you. Active tabs will close after their current page operation returns.');
      } else if (url.pathname === '/api/check') {
        if (!running) throw new Error('Start monitoring first.');
        state.keywords.forEach(k => { if (!body.id || k.id === body.id) k.nextDue = 0; }); changed(); pump();
      } else if (url.pathname === '/api/telegram-test') {
        if (PREVIEW) throw new Error('Telegram delivery is disabled in the hosted preview. Configure it locally.');
        if (!state.settings.telegram) throw new Error('Enable and save Telegram settings first.');
        await sendTelegram('Product Pulse connected. New products and urgent price highs will arrive here. Removals stay silent.');
      } else return json(response, 404, { error: 'Unknown action.' });
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && publicFiles.has(url.pathname)) {
      const file = publicFiles.get(url.pathname);
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'");
      response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
      return response.end(await readFile(path.join(ROOT, file)));
    }
    json(response, 404, { error: 'Not found.' });
  } catch (error) { json(response, 400, { error: error.message }); }
});
const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Product Pulse ${PREVIEW ? 'SETUP PREVIEW' : 'local companion'}: http://localhost:${PORT}`));
async function shutdown() { running = false; runGeneration++; clearInterval(scheduler); await context?.close().catch(() => {}); await writing.catch(() => {}); server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
