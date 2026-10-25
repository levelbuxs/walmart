const $ = id => document.getElementById(id);
let state = null, selected = null, view = 'products', etag = '', toastTimer, initialized = false, polling = false;
const seenEvents = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const label = keyword => keyword || 'All products · unfiltered';
// The extra-item markers are configurable, so the tooltip reads them from the
// saved settings instead of hard-coding them.
function extraTitle(){
  const markers=(state?.settings?.extraMarkers||[]).map(m=>`${m}`);
  return markers.length?`Experimental: also search this keyword with ${markers.join(', ')} to find extra items`:'Experimental: also search this keyword with the extra markers to find extra items';
}
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
  $('breadcrumb').textContent={products:'Product radar',watchlist:'Watchlist',activity:'Activity',settings:'Preferences',setup:'Browser setup'}[view];
}
function duration(ms) { const total=Math.max(0,Math.ceil(ms/1000));return total<60?`${total}s`:`${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s`; }
const liveFor = id => state?.live?.[id] || null;
// Snapshot products plus anything the running scan has already found.
function productsOf(keyword) {
  const items=new Map();
  for(const p of state.snapshots[keyword.id]?.products||[])items.set(p.id,p);
  for(const p of liveFor(keyword.id)?.products||[])if(!items.has(p.id))items.set(p.id,p);
  return [...items.values()];
}
function timer(k) {
  if(state.active.includes(k.id)){const live=liveFor(k.id);return live?{text:`p${live.page}/${live.pages} · ${live.found}`,className:'scanning'}:{text:'Scanning…',className:'scanning'};}
  if(state.held.includes(k.id))return{text:'Needs you',className:'late'};
  if(!state.running)return{text:k.lastCheck?'Paused':'Not scanned',className:''};
  if(!k.nextDue)return{text:'Queued',className:'late'};
  const remaining=k.nextDue-Date.now();
  return remaining>0?{text:duration(remaining),className:''}:{text:`-${duration(-remaining)}`,className:'late'};
}
// Green check once a keyword has been read, red cross when it is overdue or failed.
function keywordStatus(k) {
  if(state.active.includes(k.id))return{icon:'↻',className:'scanning'};
  if(state.held.includes(k.id))return{icon:'!',className:'late'};
  if(k.error)return{icon:'✕',className:'late'};
  if(state.running&&k.nextDue&&k.nextDue<=Date.now())return{icon:'✕',className:'late'};
  if(k.lastCheck)return{icon:'✓',className:'done'};
  return{icon:'⌕',className:''};
}
function updateTimers() {
  if(!state)return;
  document.querySelectorAll('[data-timer]').forEach(el=>{const k=state.keywords.find(k=>k.id===el.dataset.timer);if(k){const t=timer(k);el.textContent=t.text;el.className='timer '+t.className;}});
}
function sortLabel() {
  const option=(state.sorts||[]).find(item=>item.value===state.settings.sort);
  return option?option.label:'Value: high to low';
}
function render() {
  if(!state)return;
  if(selected&&!state.keywords.some(k=>k.id===selected))selected=null;
  $('preview-banner').hidden=!state.preview;
  $('connection-label').textContent=state.preview?'Setup preview':state.browserConnected?(state.browserMode==='attached'?'Your Chrome attached':'Browser connected'):'Browser not connected';
  $('connection-dot').classList.toggle('live',state.browserConnected);
  $('attention').hidden=!state.pauseReason;$('attention').textContent=state.pauseReason;
  $('stat-keywords').textContent=state.keywords.length;
  const all=new Map();
  for(const k of state.keywords)for(const p of productsOf(k))all.set(p.id,p);
  $('stat-products').textContent=all.size;$('product-count').textContent=all.size;
  const midnight=new Date();midnight.setHours(0,0,0,0);
  const today=state.events.filter(e=>e.at>=midnight.getTime());
  $('stat-new').textContent=today.reduce((sum,e)=>sum+e.count,0);$('stat-urgent').textContent=today.filter(e=>e.urgent).reduce((sum,e)=>sum+e.count,0);
  $('event-count').textContent=state.events.length;
  const scanning=state.active.length;
  $('run-label').textContent=state.running?`${scanning} ${scanning===1?'page':'pages'} scanning · monitoring active`:state.pauseReason?'Monitoring paused':'Ready when you are';
  $('run-dot').classList.toggle('live',state.running);
  const pages=state.settings.pages||1;
  $('schedule-summary').textContent=`Every ${state.settings.minutes} ${state.settings.minutes===1?'minute':'minutes'} · ${state.settings.concurrency} ${state.settings.concurrency===1?'page':'pages'} at a time · ${pages} ${pages===1?'page':'pages'} per search`;
  $('start').textContent=state.running?'Ⅱ  Pause monitoring':state.pauseReason?'▷  Resume monitoring':'▷  Start monitoring';
  $('check-now').disabled=!state.running;
  $('all-filter').classList.toggle('active',selected===null);
  $('keyword-list').innerHTML=state.keywords.map(k=>{
    const s=keywordStatus(k);
    return `<div class="keyword-row"><button class="keyword ${selected===k.id?'active':''}" data-keyword="${esc(k.id)}"><span class="status ${s.className}">${s.icon}</span><span class="keyword-label">${esc(label(k.keyword))}</span><span class="timer" data-timer="${esc(k.id)}"></span></button><button class="extra-toggle ${k.experimental?'on':''}" data-extra="${esc(k.id)}" title="${esc(extraTitle())}">⚗</button></div>`;
  }).join('');
  updateTimers();renderCatalog();renderActivity();renderProfiles();renderWatchlist();renderBrowserChoice();
}
function buildEntries() {
  const entries=new Map();
  for(const keyword of state.keywords) {
    const snapshot=state.snapshots[keyword.id];
    for(const p of productsOf(keyword)) {
      const old=entries.get(p.id);
      entries.set(p.id,{...p,keyword:old?old.keyword:keyword.keyword,keywordLabel:old?old.keywordLabel:label(keyword.keyword),urgent:old?.urgent||!!snapshot?.urgent?.includes(p.id),added:old?.added||!!snapshot?.added?.includes(p.id)});
    }
  }
  return entries;
}
function rrLink(keyword,product) {
  try {
    const url=new URL(state.portal||'https://www.walmart.com/reviews/claim-product');
    url.searchParams.set('sort',state.settings.sort||'price_high');
    if(keyword)url.searchParams.set('queryNups',keyword);
    url.searchParams.set('page','1');
    url.hash=`rr-claim-${product.id}~${encodeURIComponent(product.title||'')}`;
    return url.href;
  } catch { return ''; }
}
function renderCatalog() {
  if(!state)return;
  const k=state.keywords.find(k=>k.id===selected);
  const entries=buildEntries();
  const query=$('search').value.toLowerCase();
  const products=[...entries.values()].filter(p=>(p.title||'').toLowerCase().includes(query));
  const sort=$('sort').value;
  products.sort((a,b)=>sort==='name'?(a.title||'').localeCompare(b.title||''):sort==='low'?(a.price??Infinity)-(b.price??Infinity):(b.price??-1)-(a.price??-1));
  $('catalog-title').innerHTML=`${esc(k?label(k.keyword):'All monitored products')} <span class="pill">${products.length}</span>`;
  const pages=state.settings.pages||1;
  $('catalog-caption').textContent=`${pages} ${pages===1?'page':'pages'} per search · ${sortLabel()} · claimable items only · removals stay silent`;
  const snapshot=k?state.snapshots[k.id]:null;
  $('selected-summary').hidden=!k;
  if(k){const live=liveFor(k.id);const parts=[];if(snapshot)parts.push(`Last checked ${new Date(snapshot.checked).toLocaleString()} · Recorded high: ${money(snapshot.high)} · ${snapshot.excluded||0} unavailable/non-actionable cards excluded`);else parts.push('Waiting for the first successful scan.');if(snapshot?.pages)parts.push(`${snapshot.pages} ${snapshot.pages===1?'page':'pages'} read`);if(snapshot?.filtered)parts.push(`${snapshot.filtered} outside the value range`);if(snapshot?.unknownValue)parts.push(`${snapshot.unknownValue} with an unknown value`);if(live)parts.push(`Scanning page ${live.page} of ${live.pages} · ${live.found} found so far`);if(k.note)parts.push(k.note);if(k.error)parts.push(k.error);$('selected-summary').textContent=parts.join(' · ');}
  if(!products.length) {
    const checked=Object.keys(state.snapshots).length>0;
    if(query){
      $('catalog').innerHTML=`<div class="empty-state"><span class="empty-icon">⌕</span><h2>No matching products</h2><p>Try another name, or pick a different keyword on the left. Every product you monitor is searched here by title.</p></div>`;
      return;
    }
    if(checked){
      $('catalog').innerHTML=`<div class="empty-state"><span class="empty-icon">◉</span><h2>Nothing claimable here right now</h2><p>No eligible products match this view. Unavailable items are excluded, and removals never trigger an alert — the next pass will fill this page again.</p></div>`;
      return;
    }
    $('catalog').innerHTML=`<div class="empty-state"><span class="empty-icon">◉</span><h2>Your first finds, all in one place.</h2><p>Three short steps and Product Pulse starts watching the reviewer portal for you. Products appear here — with their image, name and value — as each page is read.</p><div class="getting-started"><ul><li><span class="step">1</span><div><b>Open the browser and sign in</b>Product Pulse opens a real Chrome window with its own profile. Sign in to Walmart once.</div></li><li><span class="step">2</span><div><b>Pick your keywords</b>Your list is prefilled. Add, remove or reorder anything you like — the program takes them one at a time.</div></li><li><span class="step">3</span><div><b>Start monitoring</b>The first pass quietly builds a baseline. After that you are told about new arrivals only.</div></li></ul></div><button class="button primary" data-open-browser>Open browser ↗</button></div>`;
    return;
  }
  $('catalog').innerHTML=products.map(p=>`<article class="product-card"><a class="product-image" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${p.image?`<img loading="lazy" src="${link(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer">`:'<span class="image-placeholder">▧</span>'}${p.urgent?'<span class="badge urgent">ϟ URGENT · NEW HIGH</span>':p.added?'<span class="badge new">+ NEW ARRIVAL</span>':''}</a><div class="product-body"><span class="product-keyword">${esc(p.keywordLabel)}</span><a class="product-title" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a><div class="product-value"><div><small>PRODUCT VALUE</small><strong>${money(p.price)}</strong></div><span class="badge available">Claim action available</span></div><div class="card-actions"><button class="product-link claim" data-claim="${esc(p.id)}" data-claim-keyword="${esc(p.keyword)}" data-claim-title="${esc(p.title)}">Claim on Walmart ↗</button><a class="product-link" href="${link(p.url)}" target="_blank" rel="noopener noreferrer">View item</a></div></div></article>`).join('');
  $('catalog').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const placeholder=document.createElement('span');placeholder.className='image-placeholder';placeholder.textContent='▧';img.replaceWith(placeholder);},{once:true}));
}
function renderActivity() {
  $('activity-list').innerHTML=state.events.length?state.events.map(e=>`<article class="event"><div class="event-header"><span class="badge ${e.urgent?'urgent':'new'}">${e.urgent?'ϟ URGENT':'+ NEW'}</span><h2>${e.urgent?'URGENT new product':'New product'} · ${esc(label(e.keyword))}</h2><time>${esc(new Date(e.at).toLocaleString())}</time></div><p>${e.count} ${e.count===1?'product':'products'} added to the reviewer pages</p>${e.items.map(p=>`<div class="event-item">${p.image?`<img loading="lazy" src="${link(p.image)}" alt="" referrerpolicy="no-referrer">`:''}<a href="${link(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a><strong>${money(p.price)}</strong></div>`).join('')}${e.failure?`<p class="failure">${esc(e.failure)} The alert is saved here; delivery was not automatically retried.</p>`:''}</article>`).join(''):'<div class="empty-state"><span class="empty-icon">◷</span><h2>No noise. Just new arrivals.</h2><p>Your first scan quietly establishes a baseline. New-product alerts will appear here after later checks. There are no removal alerts.</p></div>';
}
// The picker is rebuilt only when the list of browsers changes, and a choice
// the user has made in the dropdown is kept until it is saved.
let browserOptionsSignature='', browserOptionsSaved='';
function renderBrowserChoice() {
  const select=$('browser-choice');
  if(!select||!state)return;
  const browsers=state.browsers||[];
  const current=state.browserChoice?.browser||'chrome';
  const signature=browsers.map(item=>`${item.id}:${item.installed?1:0}`).join('|');
  if(signature!==browserOptionsSignature){
    browserOptionsSignature=signature;
    select.innerHTML=browsers.map(item=>`<option value="${esc(item.id)}">${esc(item.label)}${item.installed?'':' (not found)'}</option>`).join('');
    browserOptionsSaved='';
  }
  if(current!==browserOptionsSaved){ select.value=current; browserOptionsSaved=current; }
  if(!select.value)select.value=current;
  const detail=browsers.find(item=>item.id===select.value);
  $('browser-detail').textContent=detail?`${detail.note}${detail.path?` — ${detail.path}`:''}`:'';
}
function renderProfiles() {
  const list=$('profile-list');
  if(!list)return;
  const profiles=state.profiles||[];
  if(!profiles.length){list.innerHTML='<p class="profile-empty">No saved profiles yet. Save a keyword list to switch between watchlists in one click.</p>';return;}
  list.innerHTML=profiles.map(p=>`<div class="profile-item"><strong>${esc(p.name)}</strong><span>${p.keywords.length} keyword${p.keywords.length===1?'':'s'}${p.includeAll?' · all products':''}</span><button type="button" class="text-button" data-apply-profile="${esc(p.id)}">Apply</button><button type="button" class="text-button" data-delete-profile="${esc(p.id)}">Delete</button></div>`).join('');
}
function renderWatchlist() {
  const list=$('watchlist-items');
  if(!list)return;
  $('watchlist-count').textContent=state.keywords.length;
  list.innerHTML=state.keywords.map((k,index)=>{
    const s=keywordStatus(k);
    const live=liveFor(k.id);
    return `<li class="watch-item ${s.className}"><span class="watch-index">${index+1}</span><span class="status ${s.className}">${s.icon}</span><span class="watch-name">${esc(label(k.keyword))}</span>${live?`<span class="watch-live">page ${live.page}/${live.pages} · ${live.found} found</span>`:''}<span class="timer" data-timer="${esc(k.id)}"></span><button class="extra-toggle ${k.experimental?'on':''}" data-extra="${esc(k.id)}" title="${esc(extraTitle())}">⚗</button><button class="watch-remove" data-remove="${esc(k.id)}" title="Remove this keyword">×</button></li>`;
  }).join('');
  $('watchlist-include-all').checked=state.keywords.some(k=>!k.keyword);
  const minutes=state.settings.minutes;
  $('watch-interval').value=[1,5,15].includes(minutes)?String(minutes):'custom';
  $('watch-custom-field').hidden=$('watch-interval').value!=='custom';
  $('watch-custom-minutes').value=minutes;
  $('watch-pages').value=String(state.settings.pages||1);
  $('watch-sort').value=state.settings.sort||'price_high';
  $('watch-min').value=state.settings.minValue?String(state.settings.minValue):'';
  $('watch-max').value=state.settings.maxValue?String(state.settings.maxValue):'';
  $('watch-concurrency').value=String(state.settings.concurrency||1);
  $('watch-filter-summary').textContent=`Now: every ${state.settings.minutes} minute${state.settings.minutes===1?'':'s'} · ${state.settings.pages} page${state.settings.pages===1?'':'s'} per search · ${sortLabel()} · value ${state.settings.minValue?`$${state.settings.minValue}`:'any'} to ${state.settings.maxValue?`$${state.settings.maxValue}`:'no limit'} · ${state.settings.concurrency} keyword${state.settings.concurrency===1?'':'s'} at a time`;
  $('watchlist-start').textContent=state.running?'Ⅱ  Pause monitoring':state.pauseReason?'▷  Resume monitoring':'▷  Start monitoring';
}
function syncSettings() {
  const m=state.settings.minutes;
  $('interval').value=[1,5,15].includes(m)?String(m):'custom';$('custom-minutes').value=m;
  $('custom-field').hidden=$('interval').value!=='custom';$('concurrency').value=String(state.settings.concurrency);
  $('pages').value=String(state.settings.pages||1);$('portal-sort').value=state.settings.sort||'price_high';
  $('min-value').value=state.settings.minValue?String(state.settings.minValue):'';$('max-value').value=state.settings.maxValue?String(state.settings.maxValue):'';
  $('extra-markers').value=(state.settings.extraMarkers||[]).join(' ');
  $('telegram-enabled').checked=state.settings.telegram;$('chat-id').value=state.settings.chatId;
  $('toast-enabled').checked=state.settings.desktopToasts!==false;
  $('token-state').textContent=state.settings.hasToken?'Telegram token saved on this computer':'No Telegram token saved';
  $('concurrency-warning').hidden=state.settings.concurrency===1;
}
function notifyNewEvents() {
  for(const e of state.events) {
    if(seenEvents.has(e.id))continue;seenEvents.add(e.id);
    if(!initialized)continue;
    const title=`${e.urgent?'URGENT new product':'New product'} · ${label(e.keyword)}`;
    toast(`${title} · ${e.count} ${e.count===1?'item':'items'}`);
    // The companion raises the system notification, so the browser only adds
    // one when system notifications are switched off.
    if(state.settings.desktopToasts===false&&globalThis.Notification?.permission==='granted')try{new Notification(title,{body:e.items.slice(0,4).map(p=>`${p.title} — ${money(p.price)}`).join('\n'),requireInteraction:e.urgent});}catch{/* Activity remains available. */}
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
async function attachBrowser(){await post('attach');toast('Attached to your running Chrome. Start monitoring when you are ready.');}
function editKeywords(){
  if(!state)return;
  $('keyword-input').value=state.keywords.filter(k=>k.keyword).map(k=>k.keyword).join('\n');
  $('extra-input').value=state.keywords.filter(k=>k.experimental&&k.keyword).map(k=>k.keyword).join('\n');
  $('include-all').checked=state.keywords.some(k=>!k.keyword);updateListCount();$('keywords-dialog').showModal();
}
function keywordLines(){return $('keyword-input').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{
  if(/^https?:\/\//i.test(s)){const u=new URL(s);if(u.origin!=='https://www.walmart.com'||u.pathname!=='/reviews/claim-product')throw new Error('Use keywords or Walmart reviewer claim-product URLs.');return u.searchParams.get('queryNups')||'';}return s;
}).filter(Boolean);}
function extraLines(){return $('extra-input').value.split('\n').map(s=>s.trim()).filter(Boolean);}
function extraKeywords(){return state.keywords.filter(k=>k.experimental&&k.keyword).map(k=>k.keyword);}
// Pushes filter changes straight to the companion. Nothing has to be stopped:
// the next pass of every keyword picks the new values up.
async function pushSettings(overrides={}) {
  await post('settings',{
    minutes:state.settings.minutes,concurrency:state.settings.concurrency,pages:state.settings.pages,
    sort:state.settings.sort,minValue:state.settings.minValue,maxValue:state.settings.maxValue,
    extraMarkers:state.settings.extraMarkers,
    telegram:state.settings.telegram,chatId:state.settings.chatId,desktopToasts:state.settings.desktopToasts,
    ...overrides
  });
}
async function saveKeywords(keywords,includeAll,extra){
  await post('keywords',{keywords,includeAll,extra:extra??extraKeywords()});
}
function updateListCount(){try{$('list-count').textContent=`${keywordLines().length} keywords`;}catch{$('list-count').textContent='Check the pasted links';}}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('keyword-list').addEventListener('click',event=>{const b=event.target.closest('[data-keyword]');if(b){selected=b.dataset.keyword;go('products');render();}});
$('all-filter').addEventListener('click',()=>{selected=null;go('products');render();});
$('search').addEventListener('input',renderCatalog);$('sort').addEventListener('change',renderCatalog);
$('catalog').addEventListener('click',guard(async event=>{
  if(event.target.closest('[data-open-browser]')){await openBrowser();return;}
  const claim=event.target.closest('[data-claim]');
  if(claim){await post('claim',{keyword:claim.dataset.claimKeyword||'',id:claim.dataset.claim,title:claim.dataset.claimTitle||''});toast('Opened the reviewer portal and highlighted that item. Click Walmart’s own Claim button there.');}
}));
$('open-browser').addEventListener('click',guard(openBrowser));$('setup-browser').addEventListener('click',guard(openBrowser));
$('browser-choice').addEventListener('change',()=>{
  const item=(state?.browsers||[]).find(b=>b.id===$('browser-choice').value);
  $('browser-detail').textContent=item?`${item.note}${item.path?` — ${item.path}`:''}`:'';
});
$('browser-save').addEventListener('click',guard(async()=>{
  const browser=$('browser-choice').value;
  if(!browser)return;
  await post('browser-choice',{browser});
  toast(`Product Pulse will use ${(state.browsers||[]).find(b=>b.id===browser)?.label||browser} from now on.`);
}));
$('attach-browser').addEventListener('click',guard(attachBrowser));$('setup-attach').addEventListener('click',guard(attachBrowser));
$('start').addEventListener('click',guard(async()=>{await post(state.running?'pause':'start');toast(state.running?'Monitoring started. First checks create silent baselines.':'Monitoring paused.');}));
$('check-now').addEventListener('click',guard(async()=>{await post('check',{id:selected});toast('Check queued. Active keyword scans are not duplicated.');}));
$('schedule-edit').addEventListener('click',()=>{if(state)syncSettings();go('settings');});
$('interval').addEventListener('change',()=>{$('custom-field').hidden=$('interval').value!=='custom';});
$('concurrency').addEventListener('change',()=>{$('concurrency-warning').hidden=$('concurrency').value==='1';});
$('settings-form').addEventListener('submit',guard(async event=>{
  event.preventDefault();
  const body={minutes:Number($('interval').value==='custom'?$('custom-minutes').value:$('interval').value),concurrency:Number($('concurrency').value),pages:Number($('pages').value),sort:$('portal-sort').value,minValue:$('min-value').value,maxValue:$('max-value').value,extraMarkers:$('extra-markers').value,telegram:$('telegram-enabled').checked,chatId:$('chat-id').value,desktopToasts:$('toast-enabled').checked};
  if($('token').value.trim())body.token=$('token').value.trim();
  await post('settings',body);$('token').value='';syncSettings();toast('Preferences saved.');
}));
$('telegram-test').addEventListener('click',guard(async()=>{await post('telegram-test');toast('Test sent to Telegram.');}));
$('notify-test').addEventListener('click',guard(async()=>{await post('notify-test');toast('Test notification sent. Check your notifications and Telegram.');}));
async function desktop(){if(!globalThis.Notification)throw new Error('This browser does not support desktop notifications.');const permission=await Notification.requestPermission();toast(permission==='granted'?'Desktop alerts enabled. Keep the dashboard open.':'Desktop alerts not allowed. Activity and Telegram remain available.',permission!=='granted');}
$('desktop').addEventListener('click',guard(desktop));$('enable-desktop').addEventListener('click',guard(desktop));
$('edit-keywords').addEventListener('click',guard(editKeywords));$('setup-keywords').addEventListener('click',guard(editKeywords));$('close-keywords').addEventListener('click',()=>$('keywords-dialog').close());
$('keyword-input').addEventListener('input',updateListCount);
$('keywords-form').addEventListener('submit',guard(async event=>{event.preventDefault();await saveKeywords(keywordLines(),$('include-all').checked,extraLines());$('keywords-dialog').close();toast('Keyword list saved on this computer.');}));
$('watchlist-start').addEventListener('click',guard(async()=>{await post(state.running?'pause':'start');toast(state.running?'Monitoring paused. The last list is kept.':'Monitoring started. It walks the keywords in order.');}));
$('watch-interval').addEventListener('change',guard(async()=>{const value=$('watch-interval').value;const minutes=value==='custom'?Number($('watch-custom-minutes').value):Number(value);await pushSettings({minutes});toast(`Now checking every ${minutes} minute(s). The next pass uses it.`);}));
$('watch-custom-minutes').addEventListener('change',guard(async()=>{await pushSettings({minutes:Number($('watch-custom-minutes').value)});toast('Interval updated.');}));
$('watch-pages').addEventListener('change',guard(async()=>{await pushSettings({pages:Number($('watch-pages').value)});toast('Pages per search updated.');}));
$('watch-sort').addEventListener('change',guard(async()=>{await pushSettings({sort:$('watch-sort').value});toast('Sort updated.');}));
$('watch-min').addEventListener('change',guard(async()=>{await pushSettings({minValue:$('watch-min').value});toast('Minimum value updated.');}));
$('watch-max').addEventListener('change',guard(async()=>{await pushSettings({maxValue:$('watch-max').value});toast('Maximum value updated.');}));
$('watch-concurrency').addEventListener('change',guard(async()=>{await pushSettings({concurrency:Number($('watch-concurrency').value)});toast('Pages at a time updated.');}));
$('watchlist-add-button').addEventListener('click',guard(async()=>{
  const value=$('watchlist-add').value.trim();
  if(!value){toast('Type a keyword first.',true);return;}
  const list=state.keywords.filter(k=>k.keyword).map(k=>k.keyword);
  if(list.some(k=>k.toLowerCase()===value.toLowerCase())){toast('That keyword is already on the list.',true);return;}
  list.push(value);$('watchlist-add').value='';
  await saveKeywords(list,state.keywords.some(k=>!k.keyword));
  toast(`${value} added. It is picked up when the queue reaches it.`);
}));
$('watchlist-add').addEventListener('keydown',guard(async event=>{if(event.key==='Enter'){event.preventDefault();$('watchlist-add-button').click();}}));
$('watchlist-include-all').addEventListener('change',guard(async()=>{await saveKeywords(state.keywords.filter(k=>k.keyword).map(k=>k.keyword),$('watchlist-include-all').checked);}));
$('watchlist-items').addEventListener('click',guard(async event=>{
  const remove=event.target.closest('[data-remove]');
  if(!remove)return;
  const target=state.keywords.find(k=>k.id===remove.dataset.remove);
  if(!target)return;
  const rest=state.keywords.filter(k=>k.id!==target.id);
  await saveKeywords(rest.filter(k=>k.keyword).map(k=>k.keyword),rest.some(k=>!k.keyword),extraKeywords().filter(name=>name!==target.keyword));
  toast(`${label(target.keyword)} removed.`);
}));
document.addEventListener('click',guard(async event=>{
  const button=event.target.closest('[data-extra]');
  if(!button)return;
  const keyword=state.keywords.find(k=>k.id===button.dataset.extra);
  if(!keyword)return;
  const next=!keyword.experimental;
  await post('keyword-extra',{id:keyword.id,experimental:next});
  toast(next?`Extra-item search is on for ${label(keyword.keyword)}. It runs on the next pass.`:`Extra-item search is off for ${label(keyword.keyword)}.`);
}));
$('profile-save').addEventListener('click',guard(async()=>{
  const name=$('profile-name').value.trim();
  if(!name){toast('Give the profile a name first.',true);return;}
  await post('profiles',{action:'save',name,keywords:keywordLines(),includeAll:$('include-all').checked});
  $('profile-name').value='';toast('Profile saved.');
}));
$('profile-list').addEventListener('click',guard(async event=>{
  const apply=event.target.closest('[data-apply-profile]');
  if(apply){await post('profiles',{action:'apply',id:apply.dataset.applyProfile});$('keywords-dialog').close();toast('Profile applied.');return;}
  const remove=event.target.closest('[data-delete-profile]');
  if(remove){await post('profiles',{action:'delete',id:remove.dataset.deleteProfile});toast('Profile deleted.');}
}));
$('export-list').addEventListener('click',guard(()=>{
  const content=JSON.stringify({keywords:keywordLines(),includeAll:$('include-all').checked,extra:extraLines()},null,2);const u=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='product-pulse-keywords.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}));
$('import-list').addEventListener('change',guard(async event=>{
  const file=event.target.files[0];if(!file)return;if(file.size>64000)throw new Error('List file is too large.');const text=await file.text();
  if(file.name.endsWith('.json')){const parsed=JSON.parse(text);const keywords=Array.isArray(parsed)?parsed:parsed.keywords;if(!Array.isArray(keywords)||!keywords.every(k=>typeof k==='string'))throw new Error('Invalid keyword list file.');$('keyword-input').value=keywords.join('\n');if(!Array.isArray(parsed))$('include-all').checked=!!parsed.includeAll;if(!Array.isArray(parsed)&&Array.isArray(parsed.extra))$('extra-input').value=parsed.extra.join('\n');}
  else $('keyword-input').value=text;
  event.target.value='';updateListCount();toast('List imported. Review it, then click Save.');
}));
setInterval(updateTimers,1000);
setInterval(async()=>{if(polling)return;polling=true;try{await refresh();}catch{$('connection-label').textContent='Companion offline';$('connection-dot').classList.remove('live');}finally{polling=false;}},2000);
refresh().catch(error=>toast(error.message,true));
