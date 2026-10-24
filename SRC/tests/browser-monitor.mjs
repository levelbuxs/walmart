import { chromium } from 'playwright';
import serverChromium, { inflate } from '@sparticuz/chromium';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
if(process.platform==='linux') {
  const require=createRequire(import.meta.url);
  await inflate(join(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH=[join(tmpdir(),'al2023/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}
const browser=await chromium.launch({executablePath:await serverChromium.executablePath(),args:serverChromium.args,headless:true});
try {
  const context=await browser.newContext();
  let products=[{id:'1',title:'First chair',price:100},{id:'2',title:'High chair',price:500}];
  const visits=[];
  await context.route('https://www.walmart.com/**',route=>{
    const url=new URL(route.request().url());visits.push(url.href);
    const cards=url.pathname==='/reviews/claim-product'?products.map(p=>`<div data-item-id="${p.id}"><a href="/ip/chair/${p.id}"><h3>${p.title}</h3></a><div>Valued at $${p.price}</div></div>`).join(''):'';
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Walmart fixture</title></head><body>${cards}</body></html>`});
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.walmart.com/controller-fixture');
  await page.evaluate(await readFile(new URL('../browser-monitor.js',import.meta.url),'utf8'));
  await page.getByRole('button',{name:'Start monitoring',exact:true}).click();
  const status=page.locator('#product-pulse-browser-controller').locator('#status');
  const rows=page.locator('#product-pulse-browser-controller').locator('tbody tr');
  const alerts=page.locator('#product-pulse-browser-controller').locator('#alerts > div');
  await status.filter({hasText:'Initial baseline saved'}).waitFor({timeout:60000});
  assert.equal(await rows.count(),2);assert.equal(await alerts.count(),0);
  products=[{id:'1',title:'First chair',price:100},{id:'3',title:'New record chair',price:700},{id:'4',title:'Similar price chair',price:500}];
  await page.getByRole('button',{name:'Check now',exact:true}).click();
  await status.filter({hasText:'2 new product(s)'}).waitFor({timeout:60000});
  assert.equal(await rows.count(),3);assert.equal(await alerts.count(),2);
  assert((await alerts.allTextContents()).some(text=>text.includes('URGENT new product')));
  products=[{id:'1',title:'First chair',price:100}];
  await page.getByRole('button',{name:'Check now',exact:true}).click();
  await status.filter({hasText:'1 products on page 1. No new products.'}).waitFor({timeout:60000});
  assert.equal(await rows.count(),1);assert.equal(await alerts.count(),2,'Removal must not create any alert');
  assert.equal((await page.locator('#product-pulse-browser-controller').locator('#products').textContent()).includes('$700.00'),true,'All-time high must survive removal');
  assert(visits.filter(url=>url.includes('claim-product')).every(url=>new URL(url).searchParams.get('page')==='1'));
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  assert((await status.textContent()).includes('Paused'));
  await page.waitForTimeout(1700);
  await page.evaluate(()=>window.__productPulseBrowser.stop());
  assert.equal(await page.locator('#product-pulse-browser-controller').count(),0);
  assert.deepEqual(errors,[]);
  console.log('No-extension browser checks passed: chair link, signed-in-origin popup, first-page baseline, normal/urgent additions, silent removals, all-time high, pause and cleanup.');
}finally{await browser.close();}
