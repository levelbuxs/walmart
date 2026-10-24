import test from 'node:test';
import assert from 'node:assert/strict';
const listeners={};
const event=name=>({addListener:fn=>{listeners[name]=fn;}});
let store={monitors:[],events:[],settings:{desktop:true,telegram:false},ownedTabs:[]};
const alarms=new Map(),tabs=new Map(),notifications=[];
let nextTab=1,products=[],extractError=null,permissionGranted=true;
globalThis.chrome={
  storage:{local:{get:async defaults=>{
    if(typeof defaults==='string')return {[defaults]:structuredClone(store[defaults])};
    return structuredClone({...defaults,...store});
  },set:async data=>{store={...store,...structuredClone(data)};}}},
  alarms:{getAll:async()=>[...alarms.values()],get:async n=>alarms.get(n),clear:async n=>alarms.delete(n),create:async(n,a)=>alarms.set(n,{name:n,...a}),onAlarm:event('alarm')},
  action:{onClicked:event('action')},
  permissions:{contains:async()=>permissionGranted},
  tabs:{create:async options=>{const id=nextTab++;tabs.set(id,{id,url:options.url,status:'complete'});return{id};},get:async id=>tabs.get(id),remove:async id=>tabs.delete(id)},
  scripting:{executeScript:async options=>{
    if(extractError)throw new Error(extractError);
    return[{result:{products:structuredClone(products),scannedUrl:tabs.get(options.target.tabId).url}}];
  }},
  notifications:{create:async(id,options)=>{notifications.push({id,...options});},onClicked:event('notification')},
  runtime:{getURL:path=>'chrome-extension://test/'+path,onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')}
};
await import('../background.js');
const message=body=>new Promise(resolve=>listeners.message(body,{url:'chrome-extension://test/dashboard.html'},resolve));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw new Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
const product=(id,price)=>({id,title:'Product '+id,price,url:'https://example.com/ip/'+id});

test('worker integration: baseline, changes, errors, permissions, pause, delete',async()=>{
  products=[product('a',100)];
  const saved=await message({type:'save',monitor:{keyword:'ebike',url:'https://example.com/search?q=ebike',minutes:5}});
  assert.equal(saved.ok,true);
  await until(()=>store.monitors[0]?.snapshot && tabs.size===0);
  assert.equal(notifications.length,0);assert.equal(alarms.size,1);
  products=[product('a',100),product('b',100),product('c',200)];
  await message({type:'check',id:saved.id});
  await until(()=>store.events.length===2&&tabs.size===0);
  assert.equal(notifications.length,2);
  assert(notifications.some(n=>n.title.startsWith('URGENT new product')));
  assert(notifications.some(n=>n.title.startsWith('New product')));
  assert.equal(store.monitors[0].snapshot.high,200);
  await message({type:'check',id:saved.id});
  await until(()=>tabs.size===0&&!store.monitors[0].scanningAt);
  assert.equal(notifications.length,2);
  products=[product('a',100)];
  await message({type:'check',id:saved.id});await until(()=>store.events.length===3&&tabs.size===0);
  assert.equal(store.events[0].kind,'removed');assert.equal(store.monitors[0].snapshot.high,200);
  extractError='Verification required';
  await message({type:'check',id:saved.id});await until(()=>store.monitors[0].error&&tabs.size===0);
  assert.equal(store.monitors[0].snapshot.products.length,1);assert.equal(store.events.length,3);
  extractError=null;
  await message({type:'toggle',id:saved.id});assert.equal(store.monitors[0].enabled,false);assert.equal(alarms.size,0);
  await message({type:'delete',id:saved.id});assert.equal(store.monitors.length,0);
  const invalid=await message({type:'save',monitor:{keyword:'x',url:'file:///test',minutes:5}});assert.equal(invalid.ok,false);
});


test('missing site permission fails safely without a snapshot',async()=>{
  permissionGranted=false;
  const saved=await message({type:'save',monitor:{keyword:'denied',url:'https://example.com/denied',minutes:5}});
  await until(()=>store.monitors.find(m=>m.id===saved.id)?.error);
  assert.equal(store.monitors.find(m=>m.id===saved.id).snapshot,null);
  assert.match(store.monitors.find(m=>m.id===saved.id).error,/permission/);
  await message({type:'delete',id:saved.id});permissionGranted=true;
});

test('Telegram failure is recorded without rolling back a successful scan',async()=>{
  const sent=[];
  globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return{ok:false,status:403,json:async()=>({ok:false})};};
  await message({type:'settings',settings:{desktop:false,telegram:true,token:'test-token-not-real',chatId:'test-chat'}});
  products=[product('telegram-a',50)];
  const saved=await message({type:'save',monitor:{keyword:'Telegram fixture',url:'https://example.com/telegram-test',minutes:5}});
  await until(()=>store.monitors.find(m=>m.id===saved.id)?.snapshot&&tabs.size===0);
  products=[product('telegram-a',50),product('telegram-b',75)];
  await message({type:'check',id:saved.id});
  await until(()=>store.events.some(e=>e.monitorId===saved.id)&&tabs.size===0);
  const event=store.events.find(e=>e.monitorId===saved.id);
  assert.equal(event.kind,'urgent');assert.match(event.failures[0],/Telegram rejected/);
  assert.equal(store.monitors.find(m=>m.id===saved.id).snapshot.high,75);
  assert(sent[0].text.includes('URGENT new product'));
  await message({type:'delete',id:saved.id});
});
