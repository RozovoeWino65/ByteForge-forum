import test from 'node:test';
import assert from 'node:assert/strict';

import { timeAgo } from '../js/dom.js';

const NOW = new Date('2026-11-20T12:00:00Z').getTime();

test('только что — меньше минуты', () => {
  assert.equal(timeAgo('2026-11-20T11:59:40Z', NOW), 'только что');
});

test('минуты, часы, дни', () => {
  assert.equal(timeAgo('2026-11-20T11:55:00Z', NOW), '5 мин');
  assert.equal(timeAgo('2026-11-20T09:00:00Z', NOW), '3 ч');
  assert.equal(timeAgo('2026-11-18T12:00:00Z', NOW), '2 дн');
});

test('старше недели — дата', () => {
  const result = timeAgo('2026-10-01T12:00:00Z', NOW);
  assert.match(result, /\d/);
  assert.doesNotMatch(result, /мин|ч|дн/);
});

test('некорректная дата не ломает рендер', () => {
  assert.equal(timeAgo('не дата', NOW), '');
});

test('будущая дата считается как «только что»', () => {
  assert.equal(timeAgo('2026-11-20T13:00:00Z', NOW), 'только что');
});
