import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import serverChromium, { inflate } from '@sparticuz/chromium';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { extractPage, scanKeywordPages } from '../monitor-core.js';

if (process.platform === 'linux') {
  const require = createRequire(import.meta.url);
  await inflate(join(dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH = [join(tmpdir(), 'al2023/lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}

const card = (id, name, price, extra = '', action = '<button>View item</button>') =>
  `<article data-item-id="${id}"><a link-identifier="${id}" href="/ip/example/${id}"><h3>${name}</h3></a><img src="https://i5.walmartimages.com/${id}.jpg"><p>Free (Valued at $${price})</p>${extra}${action}</article>`;
const pageFixture = number => {
  if (number === 1) return `<html><body>${card('a', 'Chair A', '99.99')}${card('b', 'Chair B', '49.99')}${card('x', 'Sold out chair', '500', 'Out of stock · Shop similar')}</body></html>`;
  if (number === 2) return `<html><body>${card('b', 'Chair B', '49.99')}${card('c', 'Chair C', '29.99')}</body></html>`;
  return '<html><body>No results found</body></html>';
};

test('the reviewer portal is read page by page, refreshed in place, and merged', async () => {
  const browser = await chromium.launch({ executablePath: await serverChromium.executablePath(), args: serverChromium.args, headless: true });
  try {
    const page = await browser.newPage();
    const requested = [];
    await page.route('https://www.walmart.com/**', route => {
      const url = new URL(route.request().url());
      requested.push(url.searchParams.get('page'));
      return route.fulfill({ contentType: 'text/html', body: pageFixture(Number(url.searchParams.get('page'))) });
    });
    const fast = (target, options) => extractPage(target, { ...options, minWait: 400, timeout: 8000, interval: 120 });

    // A single page scan, then the same keyword again: the tab is refreshed, not recreated.
    const first = [];
    await scanKeywordPages(page, { keyword: 'chair', pages: 1, sort: 'price_high', extract: fast, onNavigate: info => first.push(info) });
    assert.equal(first.length, 1);
    assert.equal(first[0].refreshed, false, 'the first visit navigates');
    const second = [];
    await scanKeywordPages(page, { keyword: 'chair', pages: 1, sort: 'price_high', extract: fast, onNavigate: info => second.push(info) });
    assert.equal(second.length, 1);
    assert.equal(second[0].refreshed, true, 'the next cycle refreshes the same tab in place');
    assert.deepEqual(requested, ['1', '1']);
    // Cards carry a stable anchor so a claim link can jump to them.
    assert.equal(await page.locator('#rr-claim-a').count(), 1);
    assert.equal(await page.locator('#rr-claim-x').count(), 1, 'every card on the page can be pointed at');

    // Deeper pages merge into one list without duplicates.
    const seen = [];
    const result = await scanKeywordPages(page, {
      keyword: 'chair', pages: 3, sort: 'price_high', extract: fast,
      onPage: info => seen.push(info.products.length)
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.products.map(item => item.id), ['a', 'b', 'c']);
    assert.equal(result.pagesRead, 2, 'the third page had no products');
    assert.equal(result.excluded, 1, 'the out-of-stock card is not counted');
    assert.match(result.note, /Only 2 page\(s\)/);
    assert.deepEqual(seen, [2, 3], 'each page is published as it is read');
  } finally {
    await browser.close();
  }
});

test('a verification page stops the walk instead of reporting empty results', async () => {
  const browser = await chromium.launch({ executablePath: await serverChromium.executablePath(), args: serverChromium.args, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://www.walmart.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Verify you are human. Press and hold.</body></html>' }));
    const fast = (target, options) => extractPage(target, { ...options, minWait: 400, timeout: 8000, interval: 120 });
    const result = await scanKeywordPages(page, { keyword: 'chair', pages: 2, sort: 'price_high', extract: fast });
    assert.equal(result.status, 'verification');
    assert.equal(result.products.length, 0);
  } finally {
    await browser.close();
  }
});
