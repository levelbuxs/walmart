import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import serverChromium, { inflate } from '@sparticuz/chromium';

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
if (process.platform === 'linux') {
  await inflate(join(dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH = [join(tmpdir(), 'al2023/lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}

const card = (id, name, price) =>
  `<article data-item-id="${id}"><a link-identifier="${id}" href="/ip/example/${id}"><h3>${name}</h3></a><img src="https://i5.walmartimages.com/${id}.jpg"><p>Free (Valued at $${price})</p><button>View item</button></article>`;
const page = body => `<html><body>${body}</body></html>`;
const fixtureBody = (number, query) => {
  const q = String(query || '');
  // The extra-item markers are & and 8 by default; the test adds * as a third.
  if (q === 'chair&') return page(card('d', 'Chair D', '19.99'));
  if (q === 'chair8') return page(card('c', 'Chair C', '29.99'));
  if (q === 'chair*') return page(card('b', 'Chair B', '49.99'));
  return number === 1
    ? page(card('a', 'Chair A', '99.99') + card('b', 'Chair B', '49.99'))
    : page(card('b', 'Chair B', '49.99') + card('c', 'Chair C', '29.99'));
};

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('the companion reads every page of a keyword, then refreshes the same tab', { timeout: 180000 }, async () => {
  const requests = [];
  const fixture = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push(url.href);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixtureBody(Number(url.searchParams.get('page') || 1), url.searchParams.get('queryNups')));
  });
  const fixturePort = await listen(fixture);
  const dataDir = await mkdtemp(join(tmpdir(), 'pulse-test-'));
  const appPort = fixturePort + 1;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC,
    env: {
      ...process.env,
      PULSE_DATA_DIR: dataDir,
      PULSE_PORTAL_URL: `http://127.0.0.1:${fixturePort}/reviews/claim-product`,
      PULSE_BROWSER_PATH: await serverChromium.executablePath(),
      PULSE_HEADLESS: '1',
      PORT: String(appPort),
      HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  const base = `http://127.0.0.1:${appPort}`;
  const call = async (path, body) => {
    const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    return { status: response.status, result };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      try { ready = (await fetch(base + '/api/state')).ok; } catch { await new Promise(r => setTimeout(r, 250)); }
    }
    assert(ready, `the companion did not start: ${log.join('')}`);

    assert.equal((await call('keywords', { keywords: ['chair'], includeAll: false })).status, 200);
    assert.equal((await call('settings', { minutes: 1, concurrency: 1, pages: 2, sort: 'price_high', extraMarkers: '& 8 *' })).status, 200);
    assert.equal((await call('start', {})).status, 200);

    let snapshot = null;
    for (let attempt = 0; attempt < 120 && !snapshot; attempt++) {
      const state = await (await fetch(base + '/api/state')).json();
      const keyword = state.keywords[0];
      const found = state.snapshots[keyword?.id];
      if (found?.checked) snapshot = { state, keyword, found };
      else await new Promise(r => setTimeout(r, 500));
    }
    assert(snapshot, `no snapshot was committed: ${log.join('')}`);
    assert.deepEqual(snapshot.found.products.map(p => p.id), ['a', 'b', 'c'], 'both pages are merged without duplicates');
    assert.equal(snapshot.found.pages, 2);
    assert.equal(snapshot.found.excluded, 0);
    assert.equal(snapshot.found.high, 99.99);
    assert.equal(snapshot.state.live[snapshot.keyword.id], undefined, 'the live progress is cleared when the scan finishes');
    assert(snapshot.keyword.nextDue > Date.now(), 'the keyword is scheduled again');
    const pages = requests.map(href => new URL(href).searchParams.get('page'));
    assert.deepEqual(pages.slice(0, 2), ['1', '2'], 'page one then page two were read');

    // The next cycle refreshes the tab that is already open instead of adding one.
    const before = requests.length;
    assert.equal((await call('check', { id: snapshot.keyword.id })).status, 200);
    for (let attempt = 0; attempt < 120; attempt++) {
      if (requests.length >= before + 2) break;
      await new Promise(r => setTimeout(r, 500));
    }
    assert(requests.length >= before + 2, 'the keyword was read again');
    assert.equal(new URL(requests[before]).searchParams.get('page'), '1');

    // The claim jump opens the portal and finds the item.
    const claim = await call('claim', { keyword: 'chair', id: 'a', title: 'Chair A' });
    assert.equal(claim.status, 200, claim.result?.error);
    const missing = await call('claim', { keyword: 'chair', id: 'nope', title: 'Not here' });
    assert.equal(missing.status, 400);
    assert.match(missing.result.error, /not on the first page/);

    // Filters and keywords can be changed while it is running.
    assert.equal((await call('settings', { minutes: 5, concurrency: 1, pages: 1, sort: 'price_high', extraMarkers: '& 8 *' })).status, 200);
    assert.equal((await call('keywords', { keywords: ['chair', 'sofa'], includeAll: false })).status, 200);

    // The experimental extra-item search adds what the plain keyword misses.
    assert.equal((await call('keyword-extra', { id: snapshot.keyword.id, experimental: true })).status, 200);
    assert.equal((await call('check', { id: snapshot.keyword.id })).status, 200);
    let withExtra = null;
    for (let attempt = 0; attempt < 160 && !withExtra; attempt++) {
      const state = await (await fetch(base + '/api/state')).json();
      const found = state.snapshots[snapshot.keyword.id];
      if (found?.products?.some(p => p.id === 'd')) withExtra = found;
      else await new Promise(r => setTimeout(r, 500));
    }
    assert(withExtra, 'the extra-item search did not run');
    assert.deepEqual(withExtra.products.map(p => p.id).sort(), ['a', 'b', 'c', 'd']);
    const extras = withExtra.variants.map(v => v.query);
    assert.deepEqual(extras, ['chair&', 'chair8', 'chair*']);
    // Pages per search was lowered to 1 before this pass, so the plain keyword
    // only returned a and b: the & search brought d, the 8 search brought c and
    // the * search only repeated b, which was already known.
    assert.equal(withExtra.variants.find(v => v.query === 'chair&').extra, 1);
    assert.equal(withExtra.variants.find(v => v.query === 'chair8').extra, 1);
    assert.equal(withExtra.variants.find(v => v.query === 'chair*').extra, 0);
    assert(requests.some(href => decodeURIComponent(href).includes('queryNups=chair&')));
    assert(requests.some(href => decodeURIComponent(href).includes('queryNups=chair8')));
    assert(requests.some(href => decodeURIComponent(href).includes('queryNups=chair*')));
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.on('exit', resolve));
    await new Promise(resolve => fixture.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
