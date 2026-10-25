import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordUrl, normalizeKeywords, validateSettings, diffProducts, selectDueKeywords, experimentalVariants } from '../monitor-core.js';
const p=(id,price)=>({id,price,title:id,url:'https://www.walmart.com/ip/'+id,image:''});
test('reviewer URLs support encoded keywords and never leave page one',()=>{
  const url=new URL(keywordUrl('power bank'));
  assert.equal(url.pathname,'/reviews/claim-product');assert.equal(url.searchParams.get('queryNups'),'power bank');assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('sort'),'price_high');
  assert.equal(new URL(keywordUrl()).searchParams.has('queryNups'),false);
  assert.equal(new URL(keywordUrl('a & b / ?')).searchParams.get('queryNups'),'a & b / ?');
});
test('keyword lists trim, deduplicate and reject invalid entries',()=>{
  assert.deepEqual(normalizeKeywords([' chair ','Chair','','power bank']),['chair','power bank']);
  assert.throws(()=>normalizeKeywords([{}]));assert.throws(()=>normalizeKeywords(Array(101).fill('x')));
});
test('schedule accepts one, five, fifteen, custom and only 1–3 worker slots',()=>{
  for(const minutes of [1,5,15,7.5,1440])assert.equal(validateSettings({minutes,concurrency:1}).minutes,minutes);
  for(const settings of [{minutes:0},{minutes:1441},{minutes:'bad'},{concurrency:4}])assert.throws(()=>validateSettings(settings));
  assert.equal(validateSettings({}).minutes,5);assert.equal(validateSettings({}).concurrency,1);
});
test('first baseline and removals never produce additions or removal events',()=>{
  const baseline=diffProducts(null,[p('a',500),p('b',100)]);assert.equal(baseline.baseline,true);assert.equal(baseline.added.length,0);
  const removed=diffProducts(baseline,[p('b',100)]);assert.equal(removed.added.length,0);assert.equal(removed.high,500);assert.equal('removed' in removed,false);
  const empty=diffProducts(removed,[]);assert.equal(empty.products.length,0);assert.equal(empty.high,500);assert.equal(empty.added.length,0);
});
test('all new items compare to the same prior high; equal priced additions stay normal',()=>{
  const previous=diffProducts(null,[p('a',500)]);
  const result=diffProducts(previous,[p('b',500),p('c',501),p('d',700),p('e',null)]);
  assert.equal(result.added.length,4);assert.deepEqual(result.urgent.map(p=>p.id),['c','d']);assert.equal(result.high,700);
});
test('unknown values and price-only changes do not invent urgent new products',()=>{
  const unknown=diffProducts(null,[p('a',null)]);assert.equal(unknown.high,null);
  const known=diffProducts(unknown,[p('a',null),p('b',100)]);assert.equal(known.urgent.length,0);
  const changed=diffProducts(known,[p('a',null),p('b',200)]);assert.equal(changed.added.length,0);assert.equal(changed.high,200);
});
test('the queue walks the keywords in the order they were entered',()=>{
  const keywords=[{id:'a',nextDue:30},{id:'b',nextDue:0},{id:'c',nextDue:20},{id:'d',nextDue:200}];
  // 'a' is due, so it is taken first even though 'b' has been waiting longer.
  assert.deepEqual(selectDueKeywords(keywords,new Set(),100,1).map(k=>k.id),['a']);
  assert.deepEqual(selectDueKeywords(keywords,new Set(['a']),100,3).map(k=>k.id),['b','c']);
  assert.deepEqual(selectDueKeywords(keywords,new Set(['a','b']),100,3).map(k=>k.id),['c']);
  assert.deepEqual(selectDueKeywords(keywords,new Set(['a','b','c']),100,3),[]);
});
test('a keyword flagged for an immediate check is taken first',()=>{
  const keywords=[{id:'a',nextDue:0},{id:'b',nextDue:0,priority:true}];
  assert.deepEqual(selectDueKeywords(keywords,new Set(),100,1).map(k=>k.id),['b']);
  assert.deepEqual(selectDueKeywords(keywords,new Set(),100,2).map(k=>k.id),['b','a']);
});
test('the experimental markers are added to the end of a keyword',()=>{
  assert.deepEqual(experimentalVariants('chair'),['chair&','chair8']);
  assert.deepEqual(experimentalVariants('power bank'),['power bank&','power bank8']);
  assert.deepEqual(experimentalVariants('chair',['*']),['chair*']);
  assert.deepEqual(experimentalVariants(''),[]);
  const url=new URL(keywordUrl('chair8'));
  assert.equal(url.searchParams.get('queryNups'),'chair8');
  assert.equal(url.searchParams.get('sort'),'price_high');
  assert.equal(url.searchParams.get('page'),'1');
  const amp=new URL(keywordUrl('chair&'));
  assert.equal(amp.searchParams.get('queryNups'),'chair&');
  const quote=new URL(keywordUrl('chair"'));
  assert.equal(quote.searchParams.get('queryNups'),'chair"');
});
