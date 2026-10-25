import { chromium } from 'playwright';
import serverChromium, { inflate } from '@sparticuz/chromium';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readClaimableProducts } from '../monitor-core.js';
if(process.platform==='linux'){
  const require=createRequire(import.meta.url);
  await inflate(join(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH=[join(tmpdir(),'al2023/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}
const base=process.env.PULSE_TEST_URL||'http://127.0.0.1:8080';
const initial=await (await fetch(base+'/api/state')).json();
assert(initial.preview,'Run this test against PULSE_PREVIEW=1, never an active monitor.');
const request=async(path,body)=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:await serverChromium.executablePath(),args:serverChromium.args,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('heading',{name:'Your next find starts here.'}).waitFor();
  assert(await page.locator('#preview-banner').isVisible());
  assert.equal(await page.locator('.product-card').count(),0);
  await page.locator('#edit-keywords').click();
  assert((await page.locator('#keyword-input').inputValue()).includes('power bank'));
  await page.locator('#keyword-input').fill('chair\npower bank\nDesk & lamp');
  await page.getByRole('button',{name:'Save keyword list',exact:true}).click();
  await page.locator('#keyword-list').getByText('Desk & lamp',{exact:true}).waitFor();
  await page.locator('[data-view="settings"]').click();
  await page.locator('#interval').selectOption('custom');await page.locator('#custom-minutes').fill('7.5');await page.locator('#concurrency').selectOption('2');
  assert(await page.locator('#concurrency-warning').isVisible());
  await page.locator('#pages').selectOption('3');await page.locator('#portal-sort').selectOption('price_low');await page.locator('#min-value').fill('10');await page.locator('#max-value').fill('900');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await page.locator('#schedule-summary').filter({hasText:'Every 7.5 minutes · 2 pages at a time'}).waitFor({state:'attached'});
  await page.locator('#schedule-summary').filter({hasText:'3 pages per search'}).waitFor({state:'attached'});
  const saved=(await (await fetch(base+'/api/state')).json()).settings;
  assert.equal(saved.pages,3);assert.equal(saved.sort,'price_low');assert.equal(saved.minValue,10);assert.equal(saved.maxValue,900);
  // The extra-item markers are configurable and saved with the other preferences.
  await page.locator('#extra-markers').fill('& 8 *');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  const withMarkers=(await (await fetch(base+'/api/state')).json()).settings;
  assert.deepEqual(withMarkers.extraMarkers,['&','8','*']);
  await page.locator('#extra-markers').fill('& 8');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  // The browser picker offers the browsers that can be driven and remembers the choice.
  await page.locator('[data-view="setup"]').click();
  await page.locator('#browser-choice').waitFor();
  assert((await page.locator('#browser-choice option').count())>=4,'the browser picker lists the browsers');
  await page.locator('#browser-choice').selectOption('chromium');
  await page.locator('#browser-save').click();
  await page.locator('#toast').filter({hasText:'Chromium'}).waitFor();
  assert.equal((await (await fetch(base+'/api/state')).json()).browserChoice.browser,'chromium');
  await page.locator('#browser-choice').selectOption(initial.browserChoice?.browser||'chrome');
  await page.locator('#browser-save').click();
  await page.locator('[data-view="settings"]').click();
  // Saved profiles: create one, apply it, then remove it.
  await page.locator('#edit-keywords').click();
  await page.locator('#profile-name').fill('Furniture test');
  await page.locator('#profile-save').click();
  await page.locator('#profile-list').getByText('Furniture test').waitFor();
  await page.locator('#profile-list').locator('.profile-item',{hasText:'Furniture test'}).getByRole('button',{name:'Apply'}).click();
  await page.locator('#keyword-list').getByText('Desk & lamp',{exact:true}).waitFor();
  await page.locator('#edit-keywords').click();
  await page.locator('#profile-list').locator('.profile-item',{hasText:'Furniture test'}).getByRole('button',{name:'Delete'}).click();
  await page.locator('#profile-list').getByText('Furniture test').waitFor({state:'detached'});
  await page.locator('#close-keywords').click();
  await page.locator('[data-view="products"]').click();
  // The watchlist box: ordered keywords, live filters, add and remove.
  await page.locator('[data-view="watchlist"]').click();
  await page.locator('#watchlist-items .watch-item').first().waitFor();
  const ordered=await page.locator('#watchlist-items .watch-name').allInnerTexts();
  assert(ordered.includes('chair'),'the watchlist shows the keywords');
  await page.locator('#watch-pages').selectOption('2');
  await page.locator('#watch-filter-summary').filter({hasText:'2 pages per search'}).waitFor({state:'attached'});
  await page.locator('#watch-interval').selectOption('15');
  await page.locator('#watch-filter-summary').filter({hasText:'every 15 minutes'}).waitFor({state:'attached'});
  await page.locator('#watchlist-add').fill('desk lamp');
  await page.locator('#watchlist-add-button').click();
  await page.locator('#watchlist-items').getByText('desk lamp',{exact:true}).waitFor();
  await page.locator('#watchlist-items .watch-item',{hasText:'desk lamp'}).locator('[data-remove]').click();
  await page.locator('#watchlist-items').getByText('desk lamp',{exact:true}).waitFor({state:'detached'});
  // The experimental extra-item search is a per-keyword switch.
  await page.locator('#watchlist-items .watch-item',{hasText:'chair'}).locator('[data-extra]').click();
  const afterToggle=(await (await fetch(base+'/api/state')).json()).keywords.find(k=>k.keyword==='chair');
  assert.equal(afterToggle.experimental,true);
  await page.locator('#watchlist-items .watch-item',{hasText:'chair'}).locator('[data-extra]').click();
  const afterToggleOff=(await (await fetch(base+'/api/state')).json()).keywords.find(k=>k.keyword==='chair');
  assert.equal(afterToggleOff.experimental,false);
  await page.locator('[data-view="products"]').click();
  await page.locator('#start').click();await page.locator('#toast').filter({hasText:'Hosted preview only'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  assert.equal((await fetch(base+'/.local/product-pulse/state.json')).status,404);
  assert.equal((await fetch(base+'/server.js')).status,404);
  assert.equal((await fetch(base+'/api/keywords',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{"keywords":[]}'})).status,403);
  assert.equal((await request('settings',{minutes:5,concurrency:1,telegram:true,token:'test-only-placeholder',chatId:'123'})).status,400);
  assert.equal('telegramToken' in await (await fetch(base+'/api/state')).json(),false);
  const fixture=await browser.newPage();
  await fixture.route('https://www.walmart.com/**',r=>r.fulfill({contentType:'text/html',body:'<html><body>Fixture</body></html>'}));
  await fixture.goto('https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1');
  const card=(id,name,extra='',action='<button>View item</button>')=>`<article data-item-id="${id}"><a link-identifier="${id}" href="/ip/example/${id}"><h3>${name}</h3></a><img src="https://i5.walmartimages.com/example.jpg"><p>Free (Valued at $99.99)</p>${extra}${action}</article>`;
  await fixture.setContent(`<html><body>${card('1','Claimable chair')}${card('2','Out of stock chair','Out of stock · Shop similar')}${card('3','No action chair','','')}${card('4','Disabled chair','','<button disabled>View item</button>')}<article><a link-identifier="20979321202" href="/ip/Massage-Chair-Cushion/20979321202"><span><h3>Massage Chair Cushion Pad</h3></span></a><img src="https://i5.walmartimages.com/cushion.jpg"><a href="#">View item</a><p>Free (Valued at $1,299.95)</p></article></body></html>`);
  const extracted=await fixture.evaluate(readClaimableProducts);
  assert.equal(extracted.status,'ok');assert.equal(extracted.products.length,2);assert.equal(extracted.excluded,3);
  assert.equal(extracted.products.find(p=>p.id==='20979321202').price,1299.95);
  assert(extracted.products[0].image.endsWith('example.jpg'));
  await fixture.setContent('<html><body>Prove you are human. Press and hold.</body></html>');assert.equal((await fixture.evaluate(readClaimableProducts)).status,'verification');
  await fixture.setContent('<html><body>No products found</body></html>');assert.equal((await fixture.evaluate(readClaimableProducts)).status,'empty');
  await fixture.setContent('<html><body>Loading…</body></html>');assert.equal((await fixture.evaluate(readClaimableProducts)).status,'unrecognized');
  console.log('Companion browser checks passed: saved editable lists, saved profiles, custom schedule, pages per search, sort and value range, configurable extra-item markers, browser picker, watchlist box with live filters, add and remove keywords, experimental extra-item switch, concurrency warnings, preview safety, responsive UI, API isolation, screenshot-style extraction, images, value parsing, stock/action exclusions, verification, recognized empty results.');
}finally{
  await request('keywords',{keywords:initial.keywords.filter(k=>k.keyword).map(k=>k.keyword),includeAll:initial.keywords.some(k=>!k.keyword)});
  await request('settings',initial.settings);
  await browser.close();
}
// Capture the restored empty, honest setup preview.
const screenshotBrowser=await chromium.launch({executablePath:await serverChromium.executablePath(),args:serverChromium.args,headless:true});
try{const page=await screenshotBrowser.newPage({viewport:{width:1440,height:1000}});await page.goto(base);await page.locator('#connection-label').filter({hasText:'Setup preview'}).waitFor();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/companion.png',fullPage:true});}finally{await screenshotBrowser.close();}
