import assert from 'node:assert/strict';
import test from 'node:test';
import { nextReview } from '../src/review.ts';

test('review ratings produce monotonic useful intervals', () => {
  const state = { interval: 10, ease: 2.5, lapses: 0 };
  const again = nextReview(state, 'again', new Date('2026-08-14T00:00:00Z'));
  const hard = nextReview(state, 'hard', new Date('2026-08-14T00:00:00Z'));
  const good = nextReview(state, 'good', new Date('2026-08-14T00:00:00Z'));
  assert.equal(again.interval, 1);
  assert.ok(hard.interval > again.interval);
  assert.ok(good.interval > hard.interval);
  assert.equal(again.lapses, 1);
});
