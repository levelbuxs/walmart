import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  keywordUrl, DEFAULT_KEYWORDS, normalizeKeywords, validateSettings, diffProducts,
  readClaimableProducts, selectDueKeywords, applyValueRange, experimentalVariants,
  sortApplied, extractPage, scanKeywordPages, SORT_OPTIONS, MAX_PAGES_PER_KEYWORD,
  BASE_URL, DEFAULT_EXTRA_MARKERS
} from './monitor-core.js';
import { detectBrowsers, resolveBrowser, DEFAULT_BROWSER } from './browser-choice.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PULSE_DATA_DIR || path.join(ROOT, '.local', 'product-pulse');
const PREVIEW = process.env.PULSE_PREVIEW === '1';
const CDP_URL = process.env.PULSE_CDP_URL || 'http://127.0.0.1:9222';
// The reviewer portal that is read. The default is Walmart's own portal; the
// override exists so the monitor can be pointed at a mirror or a test server.
const PORTAL = process.env.PULSE_PORTAL_URL || BASE_URL;
// Which browser to drive. The choice is stored next to the data so the setup
// script, the dashboard and the command line all agree.
const BROWSER_FILE = path.join(DATA, 'browser.json');
// Windows PowerShell writes UTF-8 with a byte order mark. Strip it, otherwise
// JSON.parse refuses the file and the saved browser choice is ignored.
const readJsonFile = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
let browserChoice = { browser: DEFAULT_BROWSER };
try { browserChoice = { ...browserChoice, ...await readJsonFile(BROWSER_FILE) }; } catch { /* first run */ }
await mkdir(DATA, { recursive: true, mode: 0o700 });
let state;
try { state = await readJsonFile(path.join(DATA, 'state.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Saved state could not be read. Back up .local/product-pulse before repairing state.json.');
  state = {
    keywords: ['', ...DEFAULT_KEYWORDS].map(keyword => ({ id: randomUUID(), keyword, nextDue: 0 })),
    settings: { minutes: 5, concurrency: 1, pages: 1, sort: 'price_high', minValue: 0, maxValue: 0, extraMarkers: [...DEFAULT_EXTRA_MARKERS], telegram: false, chatId: '', desktopToasts: true },
    snapshots: {}, live: {}, events: [], profiles: [], telegramToken: ''
  };
}
state.live = state.live || {};
state.profiles = state.profiles || [];
state.settings = { ...{ minutes: 5, concurrency: 1, pages: 1, sort: 'price_high', minValue: 0, maxValue: 0, extraMarkers: [...DEFAULT_EXTRA_MARKERS], telegram: false, chatId: '', desktopToasts: true }, ...(state.settings || {}) };

let context = null, loginPage = null, running = false, pauseReason = '', launchPromise = null, runGeneration = 0, revision = 1;
let browserMode = 'dedicated';
const active = new Map(), held = new Map(), pool = [];
let claimPage = null;
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
  return {
    keywords: state.keywords,
    settings: { ...state.settings, hasToken: !!state.telegramToken },
    snapshots: state.snapshots, live: state.live, profiles: state.profiles, events: state.events,
    running, pauseReason, browserConnected: !!context, browserMode,
    active: [...active.keys()], held: [...held.keys()], preview: PREVIEW, revision, now: Date.now(),
    sorts: SORT_OPTIONS, maxPages: MAX_PAGES_PER_KEYWORD, portal: PORTAL,
    browsers: detectBrowsers(), browserChoice: { ...browserChoice, ...resolveBrowser(browserChoice) },
    extraMarkers: state.settings.extraMarkers
  };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browser() {
  if (PREVIEW) throw new Error('This is the hosted setup preview. Run npm start on your PC to open your signed-in browser.');
  if (context) return context;
  if (launchPromise) return launchPromise;
  launchPromise = (async () => {
    const { chromium } = await import('playwright');
    if (process.env.PULSE_CDP_URL) return attach(chromium);
    const options = { headless: process.env.PULSE_HEADLESS === '1', viewport: null, acceptDownloads: false };
    const resolved = resolveBrowser(browserChoice);
    if (resolved.executablePath) options.executablePath = resolved.executablePath;
    else if (resolved.channel) options.channel = resolved.channel;
    try { context = await chromium.launchPersistentContext(path.join(DATA, 'browser-profile'), options); }
    catch { throw new Error('Could not open the chosen browser. Close any previous Product Pulse window, or pick a different browser in Browser setup. To use the bundled Chromium instead: npx playwright install chromium.'); }
    browserMode = 'dedicated';
    context.on('close', () => { context = null; loginPage = null; running = false; runGeneration++; pauseReason = 'Monitoring browser closed. Open it again and sign in, then Start.'; changed(); });
    changed();
    return context;
  })();
  try { return await launchPromise; } finally { launchPromise = null; }
}

// Connects to a Chrome you already run yourself (started with
// --remote-debugging-port), so the monitor reuses your real signed-in session
// and your real profile. Nothing is installed into Chrome and no extension is used.
async function attach(chromium) {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0] || await browser.newContext();
  context = ctx;
  browserMode = 'attached';
  ctx.on('close', () => { context = null; running = false; runGeneration++; pauseReason = 'The attached Chrome was closed. Open it again, then Start.'; changed(); });
  changed();
  return ctx;
}
async function attachToRunningChrome() {
  if (PREVIEW) throw new Error('The hosted preview cannot reach your computer. Run npm start locally.');
  if (context) throw new Error('A browser is already connected.');
  const { chromium } = await import('playwright');
  try { await attach(chromium); }
  catch {
    throw new Error(`Could not reach Chrome at ${CDP_URL}. Start Chrome with --remote-debugging-port=9222 (and a dedicated profile folder), then click Attach again.`);
  }
}

async function openLogin() {
  const ctx = await browser();
  if (!loginPage || loginPage.isClosed()) {
    loginPage = ctx.pages().find(page => page.url() === 'about:blank') || await ctx.newPage();
    await loginPage.goto(keywordUrl('', { base: PORTAL }), { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await loginPage.bringToFront();
}
function pause(reason) { running = false; runGeneration++; pauseReason = reason; changed(); }
async function closePool() {
  const pages = pool.splice(0, pool.length);
  await Promise.all(pages.map(page => page.close().catch(() => {})));
}
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

// System notification (Windows toast, macOS notification, Linux notify-send).
// It is raised by the companion, so it arrives even when the dashboard tab is
// closed. node-notifier is an optional dependency: when it is missing the
// failure is reported instead of being hidden.
let notifier = null, notifierChecked = false;
async function desktopNotifier() {
  if (notifierChecked) return notifier;
  notifierChecked = true;
  try { notifier = (await import('node-notifier')).default; } catch { notifier = null; }
  return notifier;
}
async function sendDesktopToast(title, message) {
  if (!state.settings.desktopToasts) return;
  const notify = await desktopNotifier();
  if (!notify) throw new Error('System notifications are not available on this computer. Install node-notifier, or turn on Telegram.');
  await new Promise((resolve, reject) => {
    notify.notify({ title, message, wait: false }, error => {
      if (!error) return resolve();
      const text = String(error);
      if (/notify-send|Command failed|not found/i.test(text)) return reject(new Error('This computer has no system notifier (notify-send is missing on Linux). Use Telegram instead.'));
      reject(new Error(text));
    });
  });
}
function alertHeadline(urgent, keyword) {
  return `${urgent ? 'URGENT new product' : 'New product'} · ${keyword || 'All products'}`;
}
function alertLines(items, limit = 12) {
  return items.slice(0, limit).map(p => `${p.title}\nValue: ${p.price == null ? 'Unknown' : '$' + p.price.toFixed(2)}\n${p.url}`);
}
async function recordAlerts(keyword, result) {
  const urgentIds = new Set(result.urgent.map(p => p.id));
  const groups = [{ urgent: true, items: result.urgent }, { urgent: false, items: result.added.filter(p => !urgentIds.has(p.id)) }];
  for (const group of groups.filter(g => g.items.length)) {
    const event = { id: randomUUID(), keyword: keyword.keyword, keywordId: keyword.id, urgent: group.urgent, at: Date.now(), items: group.items.slice(0, 100), count: group.items.length, failure: '' };
    state.events.unshift(event); state.events = state.events.slice(0, 150);
    while (state.events.length > 1 && JSON.stringify(state.events).length > 2000000) state.events.pop();
    await persist();
    const headline = alertHeadline(group.urgent, keyword.keyword);
    const failures = [];
    try { await sendDesktopToast(headline, alertLines(group.items, 3).join('\n\n')); }
    catch (error) { failures.push(error.message); }
    try { await sendTelegram(`${headline}\n${alertLines(group.items).join('\n\n')}`); }
    catch (error) { failures.push(error.message); }
    if (failures.length) { event.failure = failures.join(' '); await persist(); }
  }
}
async function extract(page, generation) {
  return extractPage(page, { isRunning: () => running && generation === runGeneration });
}
async function acquirePage(ctx) {
  while (pool.length) {
    const page = pool.pop();
    if (!page.isClosed()) return page;
  }
  return ctx.newPage();
}
async function scan(keyword, generation) {
  let page, keep = false, committed = false;
  const started = Date.now();
  const previous = state.snapshots[keyword.id] || null;
  // If the keyword is asked for again while this scan runs, the new request
  // wins: the timer is not pushed back over it.
  const token = keyword.token || 0;
  const totalPages = state.settings.pages || 1;
  const sort = state.settings.sort || 'price_high';
  // The plain keyword always comes first. The experimental markers are extra
  // searches for the same keyword, so they only read the first page.
  const queries = [keyword.keyword];
  if (keyword.experimental && keyword.keyword) queries.push(...experimentalVariants(keyword.keyword, state.settings.extraMarkers));
  try {
    const ctx = await browser();
    if (!running || generation !== runGeneration) return;
    page = await acquirePage(ctx);
    const merged = [];
    const seen = new Set();
    const variants = [];
    let excluded = 0, pagesRead = 0, note = '';
    for (const [index, query] of queries.entries()) {
      const isBase = index === 0;
      const result = await scanKeywordPages(page, {
        keyword: query,
        pages: isBase ? totalPages : 1,
        sort,
        base: PORTAL,
        isRunning: () => running && generation === runGeneration,
        extract: (target, options) => extract(target, generation),
        onPage: async ({ number, pages, products }) => {
          state.live[keyword.id] = {
            page: number, pages, found: merged.length + products.filter(item => !seen.has(item.id)).length,
            query: isBase ? '' : query,
            products: [...merged, ...products].slice(0, 300)
          };
          changed();
          await persist();
        }
      });
      if (result.status === 'stopped') return;
      if (['verification', 'login'].includes(result.status)) {
        keep = true; held.set(keyword.id, page);
        const blocked = state.keywords.find(k => k.id === keyword.id);
        keyword.error = result.status === 'verification' ? 'Verification required. Resolve it in the open browser tab, then Resume.' : 'Sign in in the open browser tab, then Resume.';
        if (blocked) blocked.error = keyword.error;
        pause(keyword.error); return;
      }
      if (!running || generation !== runGeneration) return;
      let extra = 0;
      for (const item of result.products) {
        if (seen.has(item.id)) continue;
        seen.add(item.id); merged.push(item); extra++;
      }
      if (isBase) {
        excluded = result.excluded;
        pagesRead = result.pagesRead;
        note = result.note;
      } else {
        variants.push({ query, found: result.products.length, extra });
      }
    }
    const unique = merged;
    const range = applyValueRange(unique, state.settings);
    const ordered = sortApplied(range.products, sort);
    const comparison = diffProducts(previous, range.products);
    state.snapshots[keyword.id] = {
      products: comparison.products, high: comparison.high, checked: Date.now(),
      added: comparison.added.map(p => p.id), urgent: comparison.urgent.map(p => p.id),
      excluded, pages: pagesRead, filtered: range.filtered, unknownValue: range.unknown,
      sortApplied: ordered, sort, variants
    };
    delete state.live[keyword.id];
    const current = state.keywords.find(k => k.id === keyword.id);
    if (!current || current.keyword !== keyword.keyword) return;
    committed = true;
    current.error = ''; current.lastCheck = Date.now();
    const extraFound = variants.reduce((sum, variant) => sum + variant.extra, 0);
    current.note = [
      ordered === false ? 'Walmart did not apply the requested sort on this page, so the order may not match.' : '',
      note,
      extraFound ? `Extra-item search added ${extraFound} item(s) that the plain keyword did not show.` : ''
    ].filter(Boolean).join(' ');
    // The per-keyword timer starts on successful completion, not the start of a batch.
    if ((current.token || 0) === token) {
      current.nextDue = Date.now() + state.settings.minutes * 60000;
      current.priority = false;
    }
    await persist();
    if (!comparison.baseline && running && generation === runGeneration) await recordAlerts(current, comparison);
  } catch (error) {
    delete state.live[keyword.id];
    const current = state.keywords.find(k => k.id === keyword.id);
    if (current && running && generation === runGeneration) {
      current.error = error.message;
      if ((current.token || 0) === token) current.nextDue = Date.now() + state.settings.minutes * 60000;
    }
  } finally {
    if (!committed) delete state.live[keyword.id];
    if (page && !keep) {
      // A paused run closes its tab; a running one keeps it for the next cycle.
      if (running && !page.isClosed()) pool.push(page);
      else await page.close().catch(() => {});
    }
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
        // Editing while running is allowed: the list is used by the next pass
        // of the queue, and a keyword that is being scanned right now finishes
        // with the list it started with.
        const keywords = normalizeKeywords(body.keywords);
        if (body.includeAll) keywords.unshift('');
        const extra = new Set(normalizeKeywords(body.extra || []).map(name => name.toLowerCase()));
        const existing = new Map(state.keywords.map(k => [k.keyword.toLowerCase(), k]));
        state.keywords = keywords.map(keyword => {
          const found = existing.get(keyword.toLowerCase());
          const entry = found ? { ...found, keyword } : { id: randomUUID(), keyword, nextDue: 0, experimental: false };
          if (extra.has(keyword.toLowerCase())) entry.experimental = true;
          return entry;
        });
        const ids = new Set(state.keywords.map(k => k.id));
        for (const id of Object.keys(state.snapshots)) if (!ids.has(id)) delete state.snapshots[id];
        await persist();
      } else if (url.pathname === '/api/keyword-extra') {
        const keyword = state.keywords.find(k => k.id === body.id);
        if (!keyword) throw new Error('That keyword is no longer in the list.');
        keyword.experimental = !!body.experimental;
        if (keyword.experimental) { keyword.nextDue = 0; keyword.token = (keyword.token || 0) + 1; }
        await persist();
      } else if (url.pathname === '/api/profiles') {
        const action = String(body.action || 'save');
        if (action === 'delete') {
          state.profiles = state.profiles.filter(profile => profile.id !== body.id);
        } else if (action === 'apply') {
          const profile = state.profiles.find(item => item.id === body.id);
          if (!profile) throw new Error('That profile no longer exists.');
          const keywords = normalizeKeywords(profile.keywords || []);
          if (profile.includeAll) keywords.unshift('');
          const existing = new Map(state.keywords.map(k => [k.keyword.toLowerCase(), k]));
          state.keywords = keywords.map(keyword => existing.has(keyword.toLowerCase()) ? { ...existing.get(keyword.toLowerCase()), keyword } : { id: randomUUID(), keyword, nextDue: 0 });
          const ids = new Set(state.keywords.map(k => k.id));
          for (const id of Object.keys(state.snapshots)) if (!ids.has(id)) delete state.snapshots[id];
        } else {
          const name = String(body.name || '').trim().slice(0, 60);
          if (!name) throw new Error('Give the profile a name.');
          const keywords = normalizeKeywords(body.keywords || []);
          const profile = { id: randomUUID(), name, keywords, includeAll: !!body.includeAll, at: Date.now() };
          state.profiles = [profile, ...state.profiles.filter(item => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 40);
        }
        await persist();
      } else if (url.pathname === '/api/settings') {
        if (PREVIEW && (body.telegram || body.token)) throw new Error('Configure Telegram only in the app running on your computer, not this hosted preview.');
        const settings = validateSettings(body);
        const token = body.token === undefined ? state.telegramToken : String(body.token).trim();
        if (settings.telegram && (!token || !settings.chatId)) throw new Error('Telegram needs a bot token and chat ID.');
        state.settings = settings; state.telegramToken = token;
        // Filters and the interval take effect on the next pass of every
        // keyword; nothing has to be stopped first.
        const limit = Date.now() + settings.minutes * 60000;
        state.keywords.forEach(k => { if (k.nextDue > limit) k.nextDue = limit; });
        await persist();
      } else if (url.pathname === '/api/browser') {
        await openLogin();
      } else if (url.pathname === '/api/browser-choice') {
        const id = String(body.browser || '').trim();
        const known = detectBrowsers().find(item => item.id === id);
        if (!known) throw new Error('That browser is not one this companion can drive.');
        browserChoice = { browser: id, executablePath: body.executablePath ? String(body.executablePath) : '' };
        await writeFile(BROWSER_FILE, JSON.stringify(browserChoice, null, 2), { mode: 0o600 });
        changed();
      } else if (url.pathname === '/api/attach') {
        await attachToRunningChrome();
      } else if (url.pathname === '/api/claim') {
        if (PREVIEW) throw new Error('The hosted preview cannot open Walmart tabs.');
        const ctx = await browser();
        const keyword = String(body.keyword || '');
        const id = String(body.id || '').slice(0, 80);
        if (!id) throw new Error('That product has no id to jump to.');
        if (!claimPage || claimPage.isClosed()) claimPage = await ctx.newPage();
        const target = keywordUrl(keyword, { page: 1, sort: state.settings.sort || 'price_high', base: PORTAL });
        await claimPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const gate = await claimPage.evaluate(() => {
          const body = (document.body?.innerText || '').slice(0, 4000);
          if (/verify you are human|robot or human|press and hold|unusual traffic|access denied/i.test(body)) return 'verification';
          if (/sign in to (your account|continue)|log in to continue/i.test(body)) return 'login';
          return '';
        });
        if (gate === 'verification') throw new Error('Walmart asked for a verification in the browser window. Resolve it there, then try again.');
        if (gate === 'login') throw new Error('The browser window is not signed in to Walmart. Sign in there, then try again.');
        const found = await claimPage.evaluate(id => {
          const text = node => (node?.innerText || node?.textContent || '').trim();
          const cards = [...document.querySelectorAll('[data-item-id], [data-test-id="gpt-main"]')];
          const card = cards.find(el => el.getAttribute('data-item-id') === id)
            || cards.find(el => [...el.querySelectorAll('a[href*="/ip/"]')].some(a => a.getAttribute('link-identifier') === id));
          if (!card) return false;
          card.id = `rr-claim-${id}`;
          card.classList.add('product-pulse-claim-target');
          if (!document.getElementById('product-pulse-claim-style')) {
            const style = document.createElement('style');
            style.id = 'product-pulse-claim-style';
            style.textContent = '.product-pulse-claim-target{outline:3px solid #0071dc!important;outline-offset:-3px;box-shadow:0 0 0 6px #0071dc22!important;border-radius:6px;background:#0071dc0d!important}';
            document.documentElement.appendChild(style);
          }
          card.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return text(card).slice(0, 120);
        }, id);
        await claimPage.bringToFront().catch(() => {});
        if (!found) throw new Error('That item is not on the first page of its keyword right now. The page opened so you can check it.');
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
      } else if (url.pathname === '/api/pause') {
        pause('Paused by you. Active tabs will close after their current page operation returns.');
        await closePool();
      } else if (url.pathname === '/api/check') {
        if (!running) throw new Error('Start monitoring first.');
        state.keywords.forEach(k => { if (!body.id || k.id === body.id) { k.nextDue = 0; k.priority = true; k.token = (k.token || 0) + 1; } }); changed(); pump();
      } else if (url.pathname === '/api/notify-test') {
        if (PREVIEW) throw new Error('Notifications are disabled in the hosted preview. Configure them locally.');
        const failures = [];
        try { await sendDesktopToast('Product Pulse · test', 'A new product would look like this:\nExample Chair\nValue: $129.99'); }
        catch (error) { failures.push(error.message); }
        try { await sendTelegram('Product Pulse · test\nA new product would look like this:\nExample Chair\nValue: $129.99'); }
        catch (error) { failures.push(error.message); }
        if (failures.length) throw new Error(failures.join(' '));
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
// Opens the dashboard in the default browser so a double-click on start.bat is
// all it takes. Set PULSE_OPEN_DASHBOARD=0 to switch that off.
function openDashboard() {
  if (PREVIEW || process.env.PULSE_OPEN_DASHBOARD === '0') return;
  const url = `http://localhost:${PORT}`;
  const options = { detached: true, stdio: 'ignore' };
  let child;
  try {
    // The arguments are passed without a shell so the URL is never re-quoted.
    if (process.platform === 'win32') child = spawn('cmd.exe', ['/c', 'start', '', url], options);
    else if (process.platform === 'darwin') child = spawn('open', [url], options);
    else child = spawn('xdg-open', [url], options);
  } catch { return; }
  // A machine without a browser opener must not take the companion down.
  child.on('error', () => {});
  child.unref();
}
server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`Product Pulse ${PREVIEW ? 'SETUP PREVIEW' : 'local companion'}: http://localhost:${PORT}`);
  openDashboard();
});
async function shutdown() {
  running = false; runGeneration++; clearInterval(scheduler);
  await closePool();
  // An attached Chrome belongs to the user: disconnect, never close it.
  if (browserMode === 'dedicated') await context?.close().catch(() => {});
  await writing.catch(() => {});
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
