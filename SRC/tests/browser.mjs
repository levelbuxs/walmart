import { chromium } from 'playwright';
import serverChromium, { inflate } from '@sparticuz/chromium';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
// Minimal Linux sandboxes may lack NSS; the bundled Lambda libraries supply it.
if (process.platform === 'linux') {
  const require = createRequire(import.meta.url);
  const libraryArchive = join(dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br');
  await inflate(libraryArchive);
  process.env.LD_LIBRARY_PATH = [join(tmpdir(), 'al2023/lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}
import assert from 'node:assert/strict';
import { extractProducts } from '../extractor.js';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:await serverChromium.executablePath(),args:serverChromium.args,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(process.env.PULSE_TEST_URL||'http://127.0.0.1:8080/dashboard.html');
  await page.locator('.monitor-card').first().waitFor();
  assert.equal(await page.locator('.monitor-card').count(),4);
  assert.equal(await page.locator('.product-table tbody tr').count(),7);
  assert(await page.locator('#preview-banner').isVisible());
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/dashboard.png',fullPage:true});
  await page.getByRole('button',{name:'＋ Add monitor',exact:true}).click();
  await page.locator('#keyword').fill('test keyword');await page.locator('#page-url').fill('https://example.com/search?q=test');
  await page.getByRole('button',{name:'Save monitor',exact:true}).click();
  await page.locator('.monitor-card').filter({hasText:'test keyword'}).waitFor();assert.equal(await page.locator('.monitor-card').count(),5);
  await page.locator('[data-view="settings"]').click();assert(await page.locator('#settings-form').isVisible());
  await page.locator('[data-view="activity"]').click();assert.equal(await page.locator('.event-card').count(),2);
  await page.setViewportSize({width:390,height:844});await page.locator('[data-view="monitors"]').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.deepEqual(errors,[]);
  // Test the actual injected extraction function against realistic card markup.
  await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:`<html><head><title>Fixture products</title></head><body><div data-item-id="a"><a href="/ip/example/123"><span data-automation-id="product-title">Example ebike</span></a><div>shipping $5.99 · Valued at $1,299.95</div></div><div data-item-id="b"><a href="/ip/456"><h3>Second product</h3></a><div>$100.00</div></div></body></html>`}));
  await page.goto('http://127.0.0.1:8080/fixture');
  const selectors={card:'[data-item-id]',title:'[data-automation-id="product-title"], h3',link:'a[href*="/ip/"]',price:''};
  const extracted=await page.evaluate(extractProducts,selectors);
  assert.equal(extracted.products.length,2);assert.equal(extracted.products[0].price,1299.95);assert.equal(extracted.products[0].title,'Example ebike');
  let failed=false;try{await page.evaluate(extractProducts,{...selectors,card:'['});}catch{failed=true;}assert(failed);
  console.log('Browser checks passed: dashboard, add monitor, navigation, mobile layout, extraction, invalid selectors.');
} finally {await browser.close();}
