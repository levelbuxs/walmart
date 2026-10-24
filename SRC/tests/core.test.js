import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshot, parsePrice, validateMonitor } from '../core.js';
const p=(id,price=100)=>({id,title:`Product ${id}`,price,url:`https://example.com/ip/${id}`});
const previous=(products,high=100)=>({products,high});

test('first scan creates a silent baseline with all products',()=>{
  const r=compareSnapshot(null,[p('1',500),p('2',100)]);
  assert.equal(r.baseline,true);assert.equal(r.high,500);assert.deepEqual(r.added,[]);assert.equal(r.products.length,2);
});
test('unchanged or reordered products do not alert',()=>{
  const r=compareSnapshot(previous([p('1'),p('2')]),[p('2'),p('1')]);
  assert.deepEqual(r.added,[]);assert.deepEqual(r.removed,[]);assert.deepEqual(r.urgent,[]);
});
test('same-priced new product gets a normal alert, not urgent',()=>{
  const r=compareSnapshot(previous([p('1')]),[p('1'),p('2')]);
  assert.equal(r.added.length,1);assert.equal(r.urgent.length,0);
});
test('higher-priced new product is urgent',()=>{
  const r=compareSnapshot(previous([p('1')]),[p('1'),p('2',100.01)]);
  assert.equal(r.urgent[0].id,'2');assert.equal(r.high,100.01);
});
test('multiple new items compare against the same previous high',()=>{
  const r=compareSnapshot(previous([p('1')]),[p('1'),p('2',101),p('3',200),p('4',90)]);
  assert.equal(r.added.length,3);assert.equal(r.urgent.length,2);
});
test('removals are recorded without lowering the all-time high',()=>{
  const r=compareSnapshot(previous([p('1',100),p('2',500)],500),[p('1')]);
  assert.equal(r.removed[0].id,'2');assert.equal(r.high,500);
  const next=compareSnapshot(r,[p('1'),p('3',499)]);assert.equal(next.urgent.length,0);
});
test('price-only changes are quiet but update the recorded high',()=>{
  const r=compareSnapshot(previous([p('1')]),[p('1',600)]);
  assert.equal(r.added.length,0);assert.equal(r.high,600);
});
test('unknown prices do not invent urgent alerts',()=>{
  const r=compareSnapshot(null,[p('1',null)]);assert.equal(r.high,null);
  const next=compareSnapshot(r,[p('1',null),p('2',50)]);assert.equal(next.urgent.length,0);assert.equal(next.high,50);
  const next2=compareSnapshot(next,[p('1',null),p('2',50),p('3',null)]);assert.equal(next2.urgent.length,0);
});
test('duplicate cards are deduplicated by ID',()=>{
  const r=compareSnapshot(null,[p('1'),p('1')]);assert.equal(r.products.length,1);
});
test('parse valued-at price before incidental dollar amounts',()=>{
  assert.equal(parsePrice('shipping $5.99 Valued at $1,299.95'),1299.95);
  assert.equal(parsePrice('Current price $99.00'),99);
  assert.equal(parsePrice('No price available'),null);
});
test('validate URLs, keyword, and allowed intervals',()=>{
  const good=validateMonitor({keyword:' ebike ',url:'https://example.com/?q=ebike',minutes:5});assert.equal(good.keyword,'ebike');
  for(const input of [{keyword:'',url:'https://example.com',minutes:5},{keyword:'x',url:'javascript:alert(1)',minutes:5},{keyword:'x',url:'https://user:password@example.com',minutes:5},{keyword:'x',url:'https://example.com',minutes:1}])assert.throws(()=>validateMonitor(input));
});
