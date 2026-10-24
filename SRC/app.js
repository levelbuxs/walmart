const $ = id => document.getElementById(id);
let state = null, selected = null, view = 'products', etag = '', toastTimer, initialized = false, polling = false;
const seenEvents = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null ? 'Unknown' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value);
const label = keyword => keyword || 'All products · unfiltered';
const link = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } };
function toast(text, error = false) { clearTimeout(toastTimer); $('toast').textContent=text; $('toast').className=error?'error':''; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5000); }
const guard = fn => async event => { try { await fn(event); } catch(error) { toast(error.message,true); } };
async function post(path, body = {}) {
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Action failed.');
  await refresh(true);return result;
}
function go(next) {
  view=next;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('breadcrumb').textContent={products:'Product radar',activity:'Activity',settings:'Preferences',setup:'Browser setup'}[view];
}
function duration(ms) { const total=Math.max(0,Math.ceil(ms/1000));return total<60?`${total}s`:`${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s`; }
function timer(k) {
  if(state.active.includes(k.id))return{text:'Scanning…',className:'scanning'};
  if(state.held.includes(k.id))return{text:'Needs you',className:'late'};
  if(!state.running)return{text:k.lastCheck?'Paused':'Not scanned',className:''};
  if(!k.nextDue)return{text:'Queued',className:'late'};
  const remaining=k.nextDue-Date.now();
  return remaining>0?{text:duration(remaining),className:''}:{text:`Overdue ${duration(-remaining)}`,className:'late'};
}
function updateTimers() {
  if(!state)return;
  document.querySelectorAll('[data-timer]').forEach(el=>{const k=state.keywords.find(k=>k.id===el.dataset.timer);if(k){const t=timer(k);el.textContent=t.text;el.className='timer '+t.className;}});
}
function render() {
  if(!state)return;
  if(selected&&!state.keywords.some(k=>k.id===selected))selected=null;
  $('preview-banner').hidden=!state.preview;
  $('connection-label').textContent=state.preview?'Setup preview':state.browserConnected?'Browser connected':'Browser not connected';
  $('connection-dot').classList.toggle('live',state.browserConnected);
  $('attention').hidden=!state.pauseReason;$('attention').textContent=state.pauseReason;
  $('stat-keywords').textContent=state.keywords.length;
  const all=new Map();
  for(const k of state.keywords)for(const p of state.snapshots[k.id]?.products||[])all.set(p.id,p);
  $('stat-products').textContent=all.size;$('product-count').textContent=all.size;
  const midnight=new Date();midnight.setHours(0,0,0,0);
  const today=state.events.filter(e=>e.at>=midnight.getTime());
  $('stat-new').textContent=today.reduce((sum,e)=>sum+e.count,0);$('stat-urgent').textContent=today.filter(e=>e.urgent).reduce((sum,e)=>sum+e.count,0);
  $('event-count').textContent=state.events.length;
  $('run-label').textContent=state.running?`${state.active.length} ${state.active.length===1?'page':'pages'} scanning · monitoring active`:state.pauseReason?'Monitoring paused':'Ready when you are';
  $('run-dot').classList.toggle('live',state.running);
  $('schedule-summary').textContent=`Every ${state.settings.minutes} ${state.settings.minutes===1?'minute':'minutes'} · ${state.settings.concurrency} ${state.settings.concurrency===1?'page':'pages'} at a time`;
  $('start').textContent=state.running?'Ⅱ  Pause monitoring':state.pauseReason?'▷  Resume monitoring':'▷  Start monitoring';
  $('check-now').disabled=!state.running;
  $('all-filter').classList.toggle('active',selected===null);
  $('keyword-list').innerHTML=state.keywords.map(k=>`<button class="keyword ${selected===k.id?'active':''}" data-keyword="${esc(k.id)}"><span>${state.active.includes(k.id)?'↻':k.error?'!':'⌕'}</span><span class="keyword-label">${esc(label(k.keyword))}</span><span class="timer" data-timer="${esc(k.id)}"></span></button>`).join('');
  updateTimers();renderCatalog();renderActivity();
}
function renderCatalog() {
  if(!state)return;
  const k=state.keywords.find(k=>k.id===selected);
  const entries=new Map();
  for(const keyword of state.keywords.filter(item=>!selected||item.id===selected)) {
    const snapshot=state.snapshots[keyword.id];
    for(const p of snapshot?.products||[]) {
      const old=entries.get(p.id);
      entries.set(p.id,{...p,keyword:old?old.keyword:label(keyword.keyword),urgent:old?.urgent||snapshot.urgent?.includes(p.id),added:old?.added||snapshot.added?.includes(p.id)});
    }
  }
  const query=$('search').value.toLowerCase();
  const products=[...entries.values()].filter(p=>p.title.toLowerCase().includes(query));
  const sort=$('sort').value;
  products.sort((a,b)=>sort==='name'?a.title.localeCompare(b.title):sort==='low'?(a.price??Infinity)-(b.price??Infinity):(b.price??-1)-(a.price??-1));
  $('catalog-title').innerHTML=`${esc(k?label(k.keyword):'All monitored products')} <span class="pill">${products.length}</span>`;
  const snapshot=k?state.snapshots[k.id]:null;
  $('selected-summary').hidden=!k;
  if(k)$('selected-summary').textContent=`${snapshot?`Last checked ${new Date(snapshot.checked).toLocaleString()} · Recorded high: ${money(snapshot.high)} · ${snapshot.excluded} unavailable/non-actionable cards excluded`:'Waiting for the first successful scan.'}${k.error?' · '+k.error:''}`;
  if(!products.length) {
    const checked=Object.keys(state.snapshots).length>0;
    $('catalog').innerHTML=`<div class="empty-state"><span class="empty-icon">${query?'⌕':'◉'}</span><h2>${query?'No matching products':checked?'Nothing claimable here right now':'Your first-page finds, all in one place.'}</h2><p>${query?'Try another name or select a different keyword.':checked?'No eligible products match this view. Unavailable items are excluded, and removals never trigger an alert.':'Connect your browser, sign in to the reviewer portal, and start your keyword list. Product images, names, and values will appear after each successful scan.'}</p>${!checked&&!query?'<button class="button primary" data-open-browser>Connect your browser ↗</button>':''}</div>`;
    return;
  }
  $('catalog').innerHTML=products.map(p=>`<article class="product-card"><a class="product-image" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${p.image?`<img loading="lazy" src="${link(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer">`:'<span class="image-placeholder">▧</span>'}${p.urgent?'<span class="badge urgent">ϟ URGENT · NEW HIGH</span>':p.added?'<span class="badge new">+ NEW ARRIVAL</span>':''}</a><div class="product-body"><span class="product-keyword">${esc(p.keyword)}</span><a class="product-title" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a><div class="product-value"><div><small>PRODUCT VALUE</small><strong>${money(p.price)}</strong></div><span class="badge available">Claim action available</span></div><a class="product-link" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">View on Walmart <span>↗</span></a></div></article>`).join('');
  $('catalog').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const placeholder=document.createElement('span');placeholder.className='image-placeholder';placeholder.textContent='▧';img.replaceWith(placeholder);},{once:true}));
}
function renderActivity() {
  $('activity-list').innerHTML=state.events.length?state.events.map(e=>`<article class="event"><div class="event-header"><span class="badge ${e.urgent?'urgent':'new'}">${e.urgent?'ϟ URGENT':'+ NEW'}</span><h2>${e.urgent?'URGENT new product':'New product'} · ${esc(label(e.keyword))}</h2><time>${esc(new Date(e.at).toLocaleString())}</time></div><p>${e.count} ${e.count===1?'product':'products'} added to the first page</p>${e.items.map(p=>`<div class="event-item">${p.image?`<img loading="lazy" src="${link(p.image)}" alt="" referrerpolicy="no-referrer">`:''}<a href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a><strong>${money(p.price)}</strong></div>`).join('')}${e.failure?`<p class="failure">${esc(e.failure)} The alert is saved here; delivery was not automatically retried.</p>`:''}</article>`).join(''):'<div class="empty-state"><span class="empty-icon">◷</span><h2>No noise. Just new arrivals.</h2><p>Your first scan quietly establishes a baseline. New-product alerts will appear here after later checks. There are no removal alerts.</p></div>';
}
function syncSettings() {
  const m=state.settings.minutes;
  $('interval').value=[1,5,15].includes(m)?String(m):'custom';$('custom-minutes').value=m;
  $('custom-field').hidden=$('interval').value!=='custom';$('concurrency').value=String(state.settings.concurrency);
  $('telegram-enabled').checked=state.settings.telegram;$('chat-id').value=state.settings.chatId;
  $('token-state').textContent=state.settings.hasToken?'Telegram token saved on this computer':'No Telegram token saved';
  $('concurrency-warning').hidden=state.settings.concurrency===1;
}
function notifyNewEvents() {
  for(const e of state.events) {
    if(seenEvents.has(e.id))continue;seenEvents.add(e.id);
    if(!initialized)continue;
    const title=`${e.urgent?'URGENT new product':'New product'} · ${label(e.keyword)}`;
    toast(`${title} · ${e.count} ${e.count===1?'item':'items'}`);
    if(globalThis.Notification?.permission==='granted')try{new Notification(title,{body:e.items.slice(0,4).map(p=>`${p.title} — ${money(p.price)}`).join('\n'),requireInteraction:e.urgent});}catch{/* Activity remains available. */}
  }
}
async function refresh(force=false) {
  const response=await fetch('/api/state',{headers:!force&&etag?{'If-None-Match':etag}:{}});
  if(response.status===304)return;
  if(!response.ok)throw new Error('Cannot connect to the local companion. Keep npm start running.');
  etag=response.headers.get('ETag')||'';state=await response.json();
  notifyNewEvents();if(!initialized)syncSettings();initialized=true;render();
}
async function openBrowser(){toast('Opening the dedicated browser. Sign in there, then return here and Start.');await post('browser');}
function editKeywords(){
  if(!state)return;
  if(state.running||state.active.length)throw new Error('Pause monitoring and wait for scans to finish before editing.');
  $('keyword-input').value=state.keywords.filter(k=>k.keyword).map(k=>k.keyword).join('\n');$('include-all').checked=state.keywords.some(k=>!k.keyword);updateListCount();$('keywords-dialog').showModal();
}
function keywordLines(){return $('keyword-input').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{
  if(/^https?:\/\//i.test(s)){const u=new URL(s);if(u.origin!=='https://www.walmart.com'||u.pathname!=='/reviews/claim-product')throw new Error('Use keywords or Walmart reviewer claim-product URLs.');return u.searchParams.get('queryNups')||'';}return s;
}).filter(Boolean);}
function updateListCount(){try{$('list-count').textContent=`${keywordLines().length} keywords`;}catch{$('list-count').textContent='Check the pasted links';}}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('keyword-list').addEventListener('click',event=>{const b=event.target.closest('[data-keyword]');if(b){selected=b.dataset.keyword;go('products');render();}});
$('all-filter').addEventListener('click',()=>{selected=null;go('products');render();});
$('search').addEventListener('input',renderCatalog);$('sort').addEventListener('change',renderCatalog);
$('catalog').addEventListener('click',guard(async event=>{if(event.target.closest('[data-open-browser]'))await openBrowser();}));
$('open-browser').addEventListener('click',guard(openBrowser));$('setup-browser').addEventListener('click',guard(openBrowser));
$('start').addEventListener('click',guard(async()=>{await post(state.running?'pause':'start');toast(state.running?'Monitoring started. First checks create silent baselines.':'Monitoring paused.');}));
$('check-now').addEventListener('click',guard(async()=>{await post('check',{id:selected});toast('Check queued. Active keyword scans are not duplicated.');}));
$('schedule-edit').addEventListener('click',()=>{if(state)syncSettings();go('settings');});
$('interval').addEventListener('change',()=>{$('custom-field').hidden=$('interval').value!=='custom';});
$('concurrency').addEventListener('change',()=>{$('concurrency-warning').hidden=$('concurrency').value==='1';});
$('settings-form').addEventListener('submit',guard(async event=>{
  event.preventDefault();const body={minutes:Number($('interval').value==='custom'?$('custom-minutes').value:$('interval').value),concurrency:Number($('concurrency').value),telegram:$('telegram-enabled').checked,chatId:$('chat-id').value};
  if($('token').value.trim())body.token=$('token').value.trim();
  await post('settings',body);$('token').value='';syncSettings();toast('Preferences saved.');
}));
$('telegram-test').addEventListener('click',guard(async()=>{await post('telegram-test');toast('Test sent to Telegram.');}));
async function desktop(){if(!globalThis.Notification)throw new Error('This browser does not support desktop notifications.');const permission=await Notification.requestPermission();toast(permission==='granted'?'Desktop alerts enabled. Keep the dashboard open.':'Desktop alerts not allowed. Activity and Telegram remain available.',permission!=='granted');}
$('desktop').addEventListener('click',guard(desktop));$('enable-desktop').addEventListener('click',guard(desktop));
$('edit-keywords').addEventListener('click',guard(editKeywords));$('setup-keywords').addEventListener('click',guard(editKeywords));$('close-keywords').addEventListener('click',()=>$('keywords-dialog').close());
$('keyword-input').addEventListener('input',updateListCount);
$('keywords-form').addEventListener('submit',guard(async event=>{event.preventDefault();await post('keywords',{keywords:keywordLines(),includeAll:$('include-all').checked});$('keywords-dialog').close();toast('Keyword list saved on this computer.');}));
$('export-list').addEventListener('click',guard(()=>{
  const content=JSON.stringify({keywords:keywordLines(),includeAll:$('include-all').checked},null,2);const u=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='product-pulse-keywords.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}));
$('import-list').addEventListener('change',guard(async event=>{
  const file=event.target.files[0];if(!file)return;if(file.size>64000)throw new Error('List file is too large.');const text=await file.text();
  if(file.name.endsWith('.json')){const parsed=JSON.parse(text);const keywords=Array.isArray(parsed)?parsed:parsed.keywords;if(!Array.isArray(keywords)||!keywords.every(k=>typeof k==='string'))throw new Error('Invalid keyword list file.');$('keyword-input').value=keywords.join('\n');if(!Array.isArray(parsed))$('include-all').checked=!!parsed.includeAll;}
  else $('keyword-input').value=text;
  event.target.value='';updateListCount();toast('List imported. Review it, then click Save.');
}));
setInterval(updateTimers,1000);
setInterval(async()=>{if(polling)return;polling=true;try{await refresh();}catch{$('connection-label').textContent='Companion offline';$('connection-dot').classList.remove('live');}finally{polling=false;}},2000);
refresh().catch(error=>toast(error.message,true));
