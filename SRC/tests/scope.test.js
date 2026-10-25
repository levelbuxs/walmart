import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keywordUrl, validateSettings, applyValueRange, mergeProductPages, sortApplied,
  claimUrl, claimAnchorId, MAX_PAGES_PER_KEYWORD
} from '../monitor-core.js';
const p = (id, price) => ({ id, price, title: `Product ${id}`, url: `https://www.walmart.com/ip/${id}`, image: '' });

test('each page of a keyword gets its own reviewer-portal URL', () => {
  const first = new URL(keywordUrl('car', { page: 1, sort: 'price_high' }));
  const third = new URL(keywordUrl('car', { page: 3, sort: 'price_low' }));
  assert.equal(first.pathname, '/reviews/claim-product');
  assert.equal(first.searchParams.get('page'), '1');
  assert.equal(first.searchParams.get('sort'), 'price_high');
  assert.equal(first.searchParams.get('queryNups'), 'car');
  assert.equal(third.searchParams.get('page'), '3');
  assert.equal(third.searchParams.get('sort'), 'price_low');
});

test('pages per search stay inside the supported range', () => {
  assert.equal(validateSettings({ pages: 1 }).pages, 1);
  assert.equal(validateSettings({ pages: MAX_PAGES_PER_KEYWORD }).pages, MAX_PAGES_PER_KEYWORD);
  assert.equal(validateSettings({}).pages, 1);
  for (const pages of [0, MAX_PAGES_PER_KEYWORD + 1, 1.5, 'many']) assert.throws(() => validateSettings({ pages }));
});

test('sort and value range are validated, not silently ignored', () => {
  assert.equal(validateSettings({ sort: 'price_low' }).sort, 'price_low');
  assert.throws(() => validateSettings({ sort: 'whatever' }));
  assert.deepEqual(validateSettings({ minValue: '25' }).minValue, 25);
  assert.deepEqual(validateSettings({ maxValue: '80' }).maxValue, 80);
  assert.equal(validateSettings({ minValue: '' }).minValue, 0);
  assert.throws(() => validateSettings({ minValue: 100, maxValue: 50 }));
  assert.throws(() => validateSettings({ minValue: -5 }));
});

test('value range keeps in-range items and reports the rest', () => {
  const products = [p('a', 10), p('b', 50), p('c', 90), p('d', null)];
  const result = applyValueRange(products, { minValue: 20, maxValue: 60 });
  assert.deepEqual(result.products.map(item => item.id), ['b']);
  assert.equal(result.filtered, 2);
  assert.equal(result.unknown, 1);
  const untouched = applyValueRange(products, {});
  assert.equal(untouched.products.length, 4);
  assert.equal(untouched.filtered, 0);
});

test('pages of one keyword merge without duplicates', () => {
  const merged = mergeProductPages([[p('a', 10), p('b', 20)], [p('b', 20), p('c', 30)]]);
  assert.deepEqual(merged.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(mergeProductPages([]).length, 0);
});

test('requested order is verified against the values that were read', () => {
  assert.equal(sortApplied([p('a', 90), p('b', 50)], 'price_high'), true);
  assert.equal(sortApplied([p('a', 50), p('b', 90)], 'price_high'), false);
  assert.equal(sortApplied([p('a', 50), p('b', 90)], 'price_low'), true);
  assert.equal(sortApplied([p('a', 90), p('b', null)], 'price_high'), null);
  assert.equal(sortApplied([p('a', 90)], 'price_high'), null);
});

test('claim links point at the item anchor on the reviewer portal', () => {
  const product = p('20482510479', 60);
  assert.equal(claimAnchorId(product), 'rr-claim-20482510479');
  const url = new URL(claimUrl('car', product));
  assert.equal(url.origin, 'https://www.walmart.com');
  assert.equal(url.pathname, '/reviews/claim-product');
  assert.equal(url.searchParams.get('queryNups'), 'car');
  assert.equal(url.hash, `#rr-claim-20482510479~${encodeURIComponent('Product 20482510479')}`);
});
