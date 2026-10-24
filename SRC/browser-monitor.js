/* Product Pulse: NO EXTENSION. Paste this whole file into a signed-in
   https://www.walmart.com tab's DevTools console, then click Start.
   Keep that controller tab open and do not refresh it. */
(() => {
  'use strict';
  if (location.origin !== 'https://www.walmart.com') {
    alert('Run this script in a signed-in https://www.walmart.com tab, not in the app preview.');
    return;
  }
  if (window.__productPulseBrowser) { window.__productPulseBrowser.show(); return; }
  const DEFAULT_LINK = 'chair | https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1';
  const KEY = 'productPulseBrowser.v1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => n == null ? 'Price unknown' : '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const parsePrice = text => {
    const m = text.match(/Valued at\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i) || text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return m ? Number(m[1].replaceAll(',', '')) : null;
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* new baseline */ }
  const state = { running:false, busy:false, child:null, timer:null, monitors:[], snapshots:saved.snapshots || {}, selected:null, alerts:[], status:'Ready. Click Start to open the first-page monitoring window.' };
  const host = document.createElement('div');
  host.id = 'product-pulse-browser-controller';
  host.style.cssText = 'position:fixed;inset:15px;z-index:2147483647;display:block;';
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{color:#203a34;font:14px system-ui,sans-serif}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}main{height:100%;overflow:auto;background:#f6faf8;border:1px solid #cadfd4;border-radius:14px;box-shadow:0 12px 80px #0005;padding:26px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}h1{font-size:25px;margin:0 0 8px}h2{font-size:18px;margin:15px 0}p{font-size:12px;line-height:1.7;color:#637d74}button{padding:10px 14px;border-radius:6px;border:1px solid #cbded4;background:white;color:#205f4c}button.primary{background:#007d67;color:white;border-color:#007d67}button:disabled{opacity:.45;cursor:default}.actions{display:flex;gap:8px;flex-wrap:wrap}textarea{width:100%;min-height:80px;padding:12px;border:1px solid #cadcd2;border-radius:6px;background:white;color:#334f44}label{font-size:12px}select{padding:8px;border:1px solid #cadcd2;border-radius:5px;margin:10px}#status{padding:12px;background:#e5f2eb;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;margin:15px 0}#status.error{background:#fff0e7;color:#964a31}#tabs{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}#tabs .selected{border-color:#007d67;background:#e3f1e9}.summary{font-size:12px;color:#678176;line-height:1.7}.urgent{color:#b54b30;font-weight:700}.new{color:#007d67;font-weight:700}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:13px;border-bottom:1px solid #e5eee8;font-size:12px}th{background:#edf5ef;color:#698477}td:last-child,th:last-child{text-align:right}a{color:#007d67}#alerts{font-size:12px;line-height:1.8;margin:15px 0}.note{border-top:1px solid #dae7df;padding-top:12px}.minimize{font-size:20px}small{font-size:11px;color:#71877c}@media(max-width:650px){main{padding:15px}header{display:block}.actions{margin:15px 0}th,td{padding:9px}}
  </style><main><header><div><h1>Product Pulse · Your browser</h1><small>No extension · Signed-in session · First page only · Removals stay silent</small></div><button id="minimize" class="minimize" title="Minimize panel">−</button></header>
  <p>Leave this controller tab open without refreshing it. A separate Walmart window refreshes the watched first-page URLs. Your chair link is ready below.</p>
  <label>Keyword links (one per line, up to 30)</label><textarea id="links" spellcheck="false"></textarea>
  <label>Refresh interval<select id="minutes"><option value="5">5 minutes</option><option value="7">7 minutes</option><option value="10">10 minutes</option></select></label>
  <div class="actions"><button id="start" class="primary">Start monitoring</button><button id="stop" disabled>Pause</button><button id="check" disabled>Check now</button><button id="notifications">Enable desktop alerts</button><button id="open">Show monitoring window</button><button id="clear">Reset saved baselines</button></div>
  <div id="status" role="status"></div><div id="tabs"></div><div id="products"></div><div id="alerts" aria-live="polite"></div>
  <p class="note">Only additions alert: <strong>New product</strong> or <strong>URGENT new product</strong> above the keyword’s previous all-time high. Removed products simply disappear from the current list. The first scan saves a silent baseline. Checks are queued and may be delayed by sleeping tabs, site loading, or your PC sleeping. Desktop alerts depend on Walmart site and OS notification permissions. No Telegram token is requested by this script. Use only where permitted by the site.</p></main>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  $('links').value = saved.links || DEFAULT_LINK;
  $('minutes').value = ['5','7','10'].includes(String(saved.minutes)) ? String(saved.minutes) : '5';
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({snapshots:state.snapshots, links:$('links').value, minutes:$('minutes').value})); }
    catch { status('Browser storage is unavailable or full. The current list is in memory only.', true); }
  }
  function status(message, error=false) { state.status=message; $('status').textContent=message; $('status').className=error?'error':''; }
  function monitorsFromInput() {
    const lines=$('links').value.split('\n').map(l=>l.trim()).filter(Boolean);
    if (!lines.length || lines.length>30) throw new Error('Enter between 1 and 30 keyword links.');
    const urls=new Set();
    return lines.map((line,i)=>{
      const separator=line.indexOf('|');
      if(separator<1)throw new Error(`Line ${i+1}: use keyword | URL.`);
      const keyword=line.slice(0,separator).trim();
      const url=new URL(line.slice(separator+1).trim());
      if(url.origin!==location.origin || url.pathname!=='/reviews/claim-product' || url.username || url.password)throw new Error(`Line ${i+1}: use a Walmart claim-product URL on this same origin.`);
      url.searchParams.set('page','1');
      if(url.searchParams.get('sort')!=='price_high')throw new Error(`Line ${i+1}: use a link sorted price_high.`);
      if(!url.searchParams.get('queryNups'))throw new Error(`Line ${i+1}: the link needs queryNups for your keyword.`);
      url.hash='';
      if(urls.has(url.href))throw new Error(`Line ${i+1}: duplicate URL.`);
      urls.add(url.href);
      return {keyword,url:url.href,next:0,error:''};
    });
  }
  function render() {
    const monitors=state.monitors;
    if(!monitors.some(m=>m.url===state.selected))state.selected=monitors[0]?.url;
    $('tabs').innerHTML=monitors.map((m,i)=>`<button data-index="${i}" class="${m.url===state.selected?'selected':''}">${escape(m.keyword)}${m.error?' · needs attention':''}</button>`).join('');
    const m=monitors.find(m=>m.url===state.selected);
    const snapshot=state.snapshots[m?.url];
    if(!m){$('products').innerHTML='<h2>All first-page products will appear here.</h2>';return;}
    if(!snapshot){$('products').innerHTML=`<h2>${escape(m.keyword)}</h2><p>${escape(m.error||'Waiting for the first successful scan.')}</p>`;return;}
    const products=[...snapshot.products].sort((a,b)=>(b.price??-1)-(a.price??-1));
    $('products').innerHTML=`<h2>${escape(m.keyword)} · ${products.length} first-page products</h2><p class="summary">Last successful check: ${escape(new Date(snapshot.checked).toLocaleString())} · All-time high: ${money(snapshot.high)}${m.error?`<br><span class="urgent">${escape(m.error)} Showing the last good list.</span>`:''}</p><table><thead><tr><th>Product</th><th>Price / value</th></tr></thead><tbody>${products.map(p=>`<tr><td><a href="${escape(p.url)}" target="_blank" rel="noopener noreferrer">${escape(p.title)}</a>${snapshot.urgent?.includes(p.id)?' <span class="urgent">URGENT NEW</span>':snapshot.added?.includes(p.id)?' <span class="new">NEW</span>':''}</td><td>${money(p.price)}</td></tr>`).join('')}</tbody></table>`;
    $('alerts').innerHTML=state.alerts.slice(0,15).map(a=>`<div class="${a.urgent?'urgent':'new'}">${escape(a.text)}</div>`).join('');
  }
  function announce(keyword, items, urgent) {
    if(!items.length)return;
    const title=`${urgent?'URGENT new product':'New product'} · ${keyword}`;
    const body=items.map(p=>`${p.title} — ${money(p.price)}`).join('\n');
    state.alerts.unshift({urgent,text:`${new Date().toLocaleTimeString()} · ${title} (${items.length}): ${body}`});
    state.alerts=state.alerts.slice(0,30);
    if(globalThis.Notification?.permission==='granted') {
      try { new Notification(title,{body:body.slice(0,1200),requireInteraction:urgent}); }
      catch { status('New products detected. Desktop alert failed; see the alert list here.',true); }
    }
  }
  async function load(m) {
    if(!state.child || state.child.closed)throw new Error('The monitoring window was closed. Pause, then click Start to reopen it.');
    const previousDoc=(()=>{try{return state.child.document;}catch{return null;}})();
    try {
      if(state.child.location.href===m.url)state.child.location.reload();
      else state.child.location.href=m.url;
    }catch{state.child.location.href=m.url;}
    const deadline=Date.now()+45000;
    while(Date.now()<deadline && state.running) {
      try {
        const doc=state.child.document;
        const url=new URL(state.child.location.href);
        if(doc!==previousDoc && doc.readyState==='complete' && url.origin===location.origin && url.pathname==='/reviews/claim-product' && url.searchParams.get('page')==='1' && url.searchParams.get('queryNups')===new URL(m.url).searchParams.get('queryNups') && url.searchParams.get('sort')==='price_high')return doc;
      }catch{ /* Login or navigation may temporarily be cross-origin. Never bypass it. */ }
      await sleep(1000);
    }
    throw new Error('Page did not load as the expected first-page URL. Check the monitoring window for login or verification.');
  }
  async function extract(doc) {
    let signature='',stable=0,products=[];
    const start=Date.now();
    while(Date.now()-start<24000 && state.running) {
      const text=doc.body?.innerText||'';
      if(/verify you are human|robot or human|press and hold|unusual traffic|access denied/i.test(text))throw new Error('Site verification detected. Resolve it manually in the monitoring window.');
      const found=new Map();
      for(const card of doc.querySelectorAll('[data-test-id="gpt-main"], [data-item-id]')) {
        const link=card.querySelector('a[href*="/ip/"]');
        if(!link)continue;
        let url;try{url=new URL(link.getAttribute('href'),doc.baseURI);}catch{continue;}
        if(!['http:','https:'].includes(url.protocol))continue;
        const title=(card.querySelector('[data-automation-id="product-title"], h3')?.innerText||link.getAttribute('aria-label')||link.innerText||'').trim();
        if(!title||/^view item$/i.test(title))continue;
        const id=card.getAttribute('data-item-id')||url.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1]||url.origin+url.pathname;
        found.set(id,{id,title,url:url.href,price:parsePrice(card.innerText||'')});
      }
      products=[...found.values()];
      const next=JSON.stringify(products);
      stable=products.length&&next===signature?stable+1:0;signature=next;
      state.child.scrollTo(0,doc.body?.scrollHeight||0);
      if(stable>=3 && Date.now()-start>=5000)break;
      await sleep(1500);
    }
    if(!products.length || stable<3)throw new Error('No stable product list found. The previous list was kept. Check login and product-card layout; a site-specific selector adjustment may be needed.');
    state.child.scrollTo(0,0);
    return products;
  }
  async function check(m) {
    status(`Checking ${m.keyword} · page 1 only…`);
    const products=await extract(await load(m));
    if(!state.running)return;
    const old=state.snapshots[m.url];
    const oldIds=new Set(old?.products.map(p=>p.id)||[]);
    const added=old?products.filter(p=>!oldIds.has(p.id)):[];
    const urgent=added.filter(p=>old.high!=null && p.price!=null && p.price>old.high);
    const knownPrices=products.map(p=>p.price).filter(p=>p!=null);
    const high=Math.max(old?.high??-Infinity,...knownPrices);
    state.snapshots[m.url]={products,high:Number.isFinite(high)?high:null,checked:Date.now(),added:added.map(p=>p.id),urgent:urgent.map(p=>p.id)};
    m.error='';persist();
    // Intentionally no notifications, activity entries, or counts for removals.
    const urgentIds=new Set(urgent.map(p=>p.id));
    announce(m.keyword,urgent,true);
    announce(m.keyword,added.filter(p=>!urgentIds.has(p.id)),false);
    status(`${m.keyword}: ${products.length} products on page 1. ${old?(added.length?`${added.length} new product(s).`:'No new products.'):'Initial baseline saved — no alerts.'} Removals are silent.`);
    render();
  }
  async function tick() {
    if(!state.running||state.busy)return;
    state.busy=true;
    try {
      for(const m of state.monitors) {
        if(!state.running)break;
        if(m.next>Date.now())continue;
        try{await check(m);}catch(error){if(state.running){m.error=error.message;status(`${m.keyword}: ${error.message}`,true);render();}}
        m.next=Date.now()+Number($('minutes').value)*60000;
      }
    }finally{state.busy=false;if(state.running)state.timer=setTimeout(tick,10000);}
  }
  function controls() {
    $('start').disabled=state.running||state.busy;$('stop').disabled=!state.running;$('check').disabled=!state.running||state.busy;
    $('links').disabled=state.running||state.busy;$('minutes').disabled=state.running||state.busy;
  }
  $('start').onclick=()=>{
    try {
      if(state.busy)throw new Error('Wait for the previous check to stop.');
      state.monitors=monitorsFromInput();
      // Called directly from a user click, so the browser can allow the popup.
      state.child=window.open('about:blank','ProductPulseFirstPage','popup,width=1150,height=850');
      if(!state.child)throw new Error('Popup blocked. Allow popups for Walmart and click Start again.');
      state.running=true;persist();controls();render();void tick();
    }catch(error){status(error.message,true);}
  };
  $('stop').onclick=()=>{state.running=false;clearTimeout(state.timer);status('Paused. The last product list is kept; no refreshes or alerts will be scheduled.');controls();};
  $('check').onclick=()=>{if(!state.busy){clearTimeout(state.timer);state.monitors.forEach(m=>m.next=0);void tick();}};
  $('notifications').onclick=async()=>{
    try {
      if(!globalThis.Notification)throw new Error('Desktop notifications are not supported here. In-panel alerts still work.');
      const permission=await Notification.requestPermission();
      status(permission==='granted'?'Desktop alerts enabled for NEW products only. Removals stay silent.':'Desktop alerts were not allowed. New-product alerts will still appear in this panel.');
    }catch(error){status(error.message,true);}
  };
  $('open').onclick=()=>{if(state.child&&!state.child.closed)state.child.focus();else status('Click Start to open the monitoring window.',true);};
  $('clear').onclick=()=>{if(state.running||state.busy){status('Pause and wait for the current scan to finish before resetting baselines.',true);return;}if(confirm('Clear saved product lists and all-time highs? Next scans create silent baselines.')){state.snapshots={};persist();render();}};
  $('tabs').onclick=event=>{const button=event.target.closest('[data-index]');if(button){state.selected=state.monitors[Number(button.dataset.index)].url;render();}};
  let minimized=false;
  $('minimize').onclick=()=>{minimized=!minimized;host.style.inset=minimized?'auto 15px 15px auto':'15px';host.style.width=minimized?'310px':'';host.style.height=minimized?'105px':'';$('minimize').textContent=minimized?'+':'−';};
  const uiTimer=setInterval(controls,1000);
  window.__productPulseBrowser={show(){minimized=false;host.style.inset='15px';host.style.width='';host.style.height='';$('minimize').textContent='−';},stop(){state.running=false;clearTimeout(state.timer);clearInterval(uiTimer);host.remove();delete window.__productPulseBrowser;}};
  try{state.monitors=monitorsFromInput();}catch{ /* Validate on Start. */ }
  status(state.status);render();controls();
  console.info('Product Pulse ready. No extension is used. Click Start in the panel; keep this controller tab open without refreshing it.');
})();
