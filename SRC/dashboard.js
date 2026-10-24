import { DEFAULT_SELECTORS, validateMonitor } from './core.js';
const $ = id => document.getElementById(id);
const extension = !!globalThis.chrome?.runtime?.id;
let data = { monitors: [], events: [], settings: { desktop: true, telegram: false } };
let selected = null, currentView = 'monitors', toastTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = p => p == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(p);
const safeLink = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? escape(u.href) : '#'; } catch { return '#'; } };
function ago(time) {
  if (!time) return 'Not checked yet';
  const minutes = Math.floor((Date.now() - time) / 60000);
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = error ? 'error' : ''; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 10000 : 5500);
}
function demoData() {
  const now = Date.now();
  const products = [
    ['1', 'Aventon Aventure.2 All-Terrain Electric Bike, 750W', 1899],
    ['2', 'ENGWE X26 Dual Battery Folding Electric Bike', 1599],
    ['3', 'Heybike Ranger S Electric Bike, 1000W Motor', 1299],
    ['4', 'Velotric Discover 1 Commuter Electric Bike', 1199],
    ['5', 'Lectric XP 3.0 Long-Range Folding Electric Bike', 999],
    ['6', 'Jasion EB7 ST Step-Through Electric Bike', 799],
    ['7', 'Gotrax R1 Folding Electric Bike, 20-inch Tires', 599]
  ].map(([id, title, price]) => ({ id, title, price, url: `https://www.walmart.com/ip/${id}` }));
  const monitors = [
    { id: 'ebike', keyword: 'ebike', products, high: 1899, minutes: 5, added: ['1','2'], urgent: ['1'], last: now - 120000 },
    { id: 'laptop', keyword: 'laptop', products: [['l1','ASUS ROG Strix 16-inch Gaming Laptop',2199],['l2','Lenovo Legion Pro 5 Gaming Laptop',1799],['l3','Apple MacBook Air 13-inch',1099],['l4','HP Pavilion 15-inch Notebook',749]].map(([id,title,price])=>({id,title,price,url:'https://www.walmart.com/'})), high:2199,minutes:5,last:now-240000 },
    { id: 'coffee', keyword: 'espresso machine', products: [['c1','Breville Barista Touch Espresso Machine',999],['c2','De’Longhi Magnifica Evo Espresso Machine',699],['c3','Ninja Luxe Café Espresso Machine',499]].map(([id,title,price])=>({id,title,price,url:'https://www.walmart.com/'})), high:999,minutes:10,last:now-420000 },
    { id: 'headphones', keyword: 'headphones', products: [['h1','Sony WH-1000XM5 Wireless Headphones',399],['h2','Bose QuietComfort Wireless Headphones',349],['h3','Beats Studio Pro Wireless Headphones',249]].map(([id,title,price])=>({id,title,price,url:'https://www.walmart.com/'})), high:399,minutes:7,last:now-480000,paused:true }
  ].map(m => ({ id: m.id, keyword: m.keyword, url: `https://www.walmart.com/search?q=${encodeURIComponent(m.keyword)}&sort=price_high`, minutes:m.minutes, selectors:{...DEFAULT_SELECTORS}, enabled:!m.paused, lastCheck:m.last, snapshot:{products:m.products,high:m.high}, lastAdded:m.added||[], lastUrgent:m.urgent||[] }));
  const events = [
    { id:'demo1',monitorId:'ebike',keyword:'ebike',kind:'urgent',title:'URGENT new product · ebike',count:1,items:[products[0]],at:now-120000,failures:[] },
    { id:'demo2',monitorId:'ebike',keyword:'ebike',kind:'new',title:'New product · ebike',count:1,items:[products[1]],at:now-120000,failures:[] }
  ];
  return {monitors,events,settings:{desktop:true,telegram:false}};
}
async function send(message) {
  if (!extension) {
    if (message.type === 'save') {
      const valid = validateMonitor(message.monitor);
      const id = message.monitor.id || crypto.randomUUID();
      const existing = data.monitors.find(m=>m.id===id);
      if (!existing && data.monitors.length>=30) throw new Error('Maximum 30 monitors.');
      if (existing) Object.assign(existing,valid,{enabled:true});
      else data.monitors.push({...valid,id,enabled:true,snapshot:null});
      render(); return {id};
    }
    if (message.type === 'delete') data.monitors=data.monitors.filter(m=>m.id!==message.id);
    if (message.type === 'toggle') { const m=data.monitors.find(m=>m.id===message.id); if(m)m.enabled=!m.enabled; }
    if (message.type === 'settings') data.settings={...message.settings};
    if (message.type === 'check' || message.type.startsWith('test')) toast('Preview only — install the extension to run checks and send alerts.');
    render(); return {};
  }
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Extension did not respond. Reload the extension and try again.');
  return response;
}
async function permission(urls) {
  if (!extension) return;
  const origins = [...new Set(urls.map(url => new URL(url).origin + '/*'))];
  if (!await chrome.permissions.request({ origins })) throw new Error('Page access was not granted. The monitor needs access to read products.');
}
function render() {
  const monitors=data.monitors;
  if (!monitors.some(m=>m.id===selected)) selected=monitors[0]?.id;
  $('nav-count').textContent=monitors.length;
  $('monitor-count').textContent=monitors.length;
  $('stat-active').innerHTML=`${monitors.filter(m=>m.enabled).length}<span> / 30</span>`;
  $('stat-products').textContent=monitors.reduce((sum,m)=>sum+(m.snapshot?.products.length||0),0);
  const today=new Date(); today.setHours(0,0,0,0);
  const events=data.events.filter(e=>e.at>=today.getTime());
  $('stat-new').textContent=events.filter(e=>['new','urgent'].includes(e.kind)).reduce((sum,e)=>sum+e.count,0);
  $('stat-urgent').textContent=events.filter(e=>e.kind==='urgent').reduce((sum,e)=>sum+e.count,0);
  $('monitor-list').innerHTML=monitors.length ? monitors.map(m=>{
    const scanning = m.scanningAt && Date.now()-m.scanningAt < 120000;
    const status = !m.enabled ? 'Paused' : m.error ? 'Needs attention' : scanning ? 'Checking' : 'Active';
    return `<button class="monitor-card ${m.id===selected?'selected':''}" data-select="${escape(m.id)}"><div class="card-top"><span class="keyword-icon">${m.keyword.toLowerCase().includes('bike')?'↗':m.keyword.toLowerCase().includes('laptop')?'▱':m.keyword.toLowerCase().includes('coffee')||m.keyword.includes('espresso')?'♧':'⌕'}</span><span class="keyword-name">${escape(m.keyword)}</span><span class="badge ${m.error?'error':m.enabled?'active':'paused'}">${status==='Active'?'• ':''}${status}</span></div><div class="card-numbers"><div><small>PRODUCTS</small><strong>${m.snapshot?.products.length??'—'}</strong></div><div><small>ALL-TIME HIGH</small><strong>${usd(m.snapshot?.high)}</strong></div></div><div class="card-bottom"><span>↻ Every ${m.minutes} min</span><span>${ago(m.lastCheck)}</span></div></button>`;
  }).join('') : `<div class="empty"><span class="empty-symbol">⌕</span><h2>A fresh radar</h2>Add your first keyword to start watching.</div>`;
  renderDetail(); renderEvents();
}
function renderDetail() {
  const m=data.monitors.find(m=>m.id===selected);
  if (!m) { $('product-detail').innerHTML='<div class="empty"><span class="empty-symbol">◉</span><h2>Your next find starts here.</h2><p>Add a keyword and a first-page URL.<br>We’ll keep the product list here and alert you when it changes.</p><button class="button primary" data-action="add">＋ Add your first monitor</button></div>'; return; }
  const products=[...(m.snapshot?.products||[])].sort((a,b)=>(b.price??-1)-(a.price??-1));
  const urgent=new Set(m.lastUrgent||[]), added=new Set(m.lastAdded||[]);
  $('product-detail').innerHTML=`<div class="product-heading"><div><h2>${escape(m.keyword)} <span class="pill">${products.length} products</span></h2><p>Everything detected on the first page, highest price first.</p></div><div class="detail-actions"><button class="icon-button" data-action="check" title="Check now" aria-label="Check now">↻</button><button class="icon-button" data-action="toggle" title="${m.enabled?'Pause':'Resume'} monitor" aria-label="${m.enabled?'Pause':'Resume'} monitor">${m.enabled?'Ⅱ':'▷'}</button><button class="icon-button" data-action="edit" title="Edit monitor" aria-label="Edit monitor">✎</button><button class="icon-button" data-action="delete" title="Delete monitor" aria-label="Delete monitor">×</button></div></div><div class="product-meta"><span class="meta-tag">↻ ${m.minutes}-minute interval</span><span class="meta-tag">◷ ${ago(m.lastCheck)}</span><a class="text-button" href="${safeLink(m.url)}" target="_blank" rel="noopener">Open page ↗</a></div>${m.error?`<div class="error-note">${escape(m.error)}</div>`:''}${products.length?`<div class="product-scroll"><table class="product-table"><thead><tr><th>PRODUCT</th><th>PRICE / VALUE</th></tr></thead><tbody>${products.map(p=>`<tr><td><a class="product-name" href="${safeLink(p.url)}" target="_blank" rel="noopener">${escape(p.title)}</a><span class="product-id">ID ${escape(p.id)}</span></td><td><span class="price-cell">${usd(p.price)}</span>${urgent.has(p.id)?'<div class="row-status"><span class="badge urgent">ϟ NEW HIGH</span></div>':added.has(p.id)?'<div class="row-status"><span class="badge new">＋ NEW</span></div>':''}</td></tr>`).join('')}</tbody></table></div><div class="product-bottom"><span>Showing all ${products.length} first-page products</span><button class="text-button" data-action="export">Export CSV ↓</button></div>`:`<div class="empty"><span class="empty-symbol">◷</span><h2>Waiting for the first scan</h2>${!extension?'Install the extension to create a real baseline.':m.error?'Fix the issue above, then check again.':'Your baseline will appear here when the page finishes loading.'}</div>`}`;
}
function renderEvents() {
  $('events-list').innerHTML=data.events.length?data.events.map(e=>`<article class="event-card"><div class="event-heading"><span class="badge ${e.kind==='urgent'?'urgent':e.kind==='new'?'new':'paused'}">${e.kind==='urgent'?'ϟ URGENT':e.kind==='new'?'＋ NEW':'↻ UPDATE'}</span><h2>${escape(e.title)}</h2><span class="event-time">${ago(e.at)}</span></div><p>${e.count} product${e.count===1?'':'s'} ${e.kind==='removed'?'left':'added to'} the first page.</p><ul>${(e.items||[]).map(p=>`<li><a href="${safeLink(p.url)}" target="_blank" rel="noopener">${escape(p.title)}</a> · ${usd(p.price)}</li>`).join('')}</ul>${(e.failures||[]).map(f=>`<p class="delivery-error">${escape(f)} This alert is saved here; it was not automatically retried.</p>`).join('')}</article>`).join(''):'<div class="product-panel empty"><span class="empty-symbol">◷</span><h2>Quiet is a good signal.</h2>Product-change alerts will appear here. Your initial baseline does not trigger alerts.</div>';
}
function showView(view) {
  currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('breadcrumb').textContent={monitors:'Monitors',activity:'Activity',settings:'Notifications',guide:'Setup guide'}[view];
}
function openMonitor(m) {
  $('monitor-form').reset();
  $('monitor-id').value=m?.id||''; $('keyword').value=m?.keyword||''; $('page-url').value=m?.url||''; $('interval').value=String(m?.minutes||5);
  for (const key of Object.keys(DEFAULT_SELECTORS)) $(`selector-${key}`).value=m?.selectors?.[key]??DEFAULT_SELECTORS[key];
  $('dialog-title').textContent=m?'Edit keyword monitor':'Add a keyword monitor';
  $('monitor-dialog').showModal();
}
function exportCsv(m) {
  if (!m?.snapshot) return;
  const cell=v=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@-]/,'\t$&')+'"';
  const csv=[['ID','Product','Price USD','URL'],...m.snapshot.products.map(p=>[p.id,p.title,p.price,p.url])].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${m.keyword.replace(/[^a-z0-9-]/gi,'_')}-first-page.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const guard=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message,true);}};
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
$('add-monitor').addEventListener('click',()=>openMonitor());
$('bulk-add').addEventListener('click',()=>{$('bulk-dialog').showModal();});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('monitor-list').addEventListener('click',event=>{const b=event.target.closest('[data-select]');if(b){selected=b.dataset.select;render();}});
$('product-detail').addEventListener('click',guard(async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  const m=data.monitors.find(m=>m.id===selected);
  if(action==='add')openMonitor();
  if(action==='edit')openMonitor(m);
  if(action==='check'){await send({type:'check',id:m.id});if(extension)toast('Check queued. The temporary tab will close after scanning.');}
  if(action==='toggle')await send({type:'toggle',id:m.id});
  if(action==='delete'&&confirm(`Delete the “${m.keyword}” monitor and its saved product list?`))await send({type:'delete',id:m.id});
  if(action==='export')exportCsv(m);
}));
$('check-all').addEventListener('click',guard(async()=>{await send({type:'check'});if(extension)toast('Checks queued for all active monitors.');}));
$('monitor-form').addEventListener('submit',guard(async event=>{
  event.preventDefault();
  const selectors=Object.fromEntries(Object.keys(DEFAULT_SELECTORS).map(k=>[k,$(`selector-${k}`).value.trim()]));
  for(const selector of Object.values(selectors))if(selector)document.querySelector(selector);
  const monitor={id:$('monitor-id').value,keyword:$('keyword').value,url:$('page-url').value,minutes:Number($('interval').value),selectors};
  validateMonitor(monitor); await permission([monitor.url]);
  const result=await send({type:'save',monitor});if(extension)data=await chrome.storage.local.get({monitors:[],events:[],settings:{desktop:true,telegram:false}});selected=result.id;$('monitor-dialog').close();render();
  toast(extension?'Monitor saved. First-page scan queued.':'Preview monitor added. Install the extension to start checking.');
}));
$('bulk-form').addEventListener('submit',guard(async event=>{
  event.preventDefault();
  const monitors=$('bulk-lines').value.split('\n').filter(line=>line.trim()).map((line,i)=>{
    const separator=line.indexOf('|');if(separator<0)throw new Error(`Line ${i+1}: use keyword | URL.`);
    return validateMonitor({keyword:line.slice(0,separator).trim(),url:line.slice(separator+1).trim(),minutes:5});
  });
  if(!monitors.length||data.monitors.length+monitors.length>30)throw new Error('Import must fit within the 30-monitor limit.');
  await permission(monitors.map(m=>m.url));
  let count=0;
  try {for(const monitor of monitors){await send({type:'save',monitor});count++;}}
  catch(error){throw new Error(`${count} monitors imported before an error: ${error.message}. Remove those lines before retrying.`);}
  $('bulk-dialog').close();$('bulk-form').reset();render();toast(`${count} monitors imported${extension?'. Baseline checks queued.':' in this preview.'}`);
}));
function settingsFromForm(){return{desktop:$('desktop-enabled').checked,telegram:$('telegram-enabled').checked,token:$('bot-token').value.trim(),chatId:$('chat-id').value.trim()};}
async function saveSettings(){
  const settings=settingsFromForm();
  if(settings.telegram){if(!settings.token||!settings.chatId)throw new Error('Telegram needs both a bot token and a chat ID.');await permission(['https://api.telegram.org/']);}
  await send({type:'settings',settings});
}
$('settings-form').addEventListener('submit',guard(async event=>{event.preventDefault();await saveSettings();toast(extension?'Notification preferences saved.':'Preview preferences updated — no alerts will be sent.');}));
$('test-desktop').addEventListener('click',guard(async()=>{await send({type:'testDesktop'});if(extension)toast('Test sent. Check your desktop notifications.');}));
$('test-telegram').addEventListener('click',guard(async()=>{
  if(extension){if(!$('bot-token').value.trim()||!$('chat-id').value.trim())throw new Error('Enter a bot token and chat ID first.');await permission(['https://api.telegram.org/']);await send({type:'settings',settings:settingsFromForm()});}
  await send({type:'testTelegram'});if(extension)toast('Test delivered to Telegram.');
}));
async function load(){
  if(extension)data=await chrome.storage.local.get({monitors:[],events:[],settings:{desktop:true,telegram:false}});
  else{data=demoData();$('preview-banner').hidden=false;}
  $('desktop-enabled').checked=data.settings.desktop!==false;$('telegram-enabled').checked=!!data.settings.telegram;$('bot-token').value=data.settings.token||'';$('chat-id').value=data.settings.chatId||'';
  render();
}
if(extension)chrome.storage.onChanged.addListener(async(changes,area)=>{if(area==='local'&&(changes.monitors||changes.events||changes.settings)){data=await chrome.storage.local.get({monitors:[],events:[],settings:{desktop:true,telegram:false}});render();}});
setInterval(()=>{if(currentView==='monitors'||currentView==='activity')render();},30000);
load().catch(error=>toast(error.message,true));
