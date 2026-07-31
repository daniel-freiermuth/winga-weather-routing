import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getValidTimes } from '@winga-weather-routing/windy-lib';

const MINIFEST_BASE = {
  ref: '2026-07-19T00:00:00Z',
  end: '2026-07-20T00:00:00Z',
  info: '',
  update: '',
  v: '2.4',
  urls: { citytile: '', pointForecast: '', imageServer: '' },
};

void test('getValidTimes: does not hang on stepHours=0 (skips or throws)', () => {
  // stepHours=0 would cause an infinite loop at minifest.ts:78.
  // The function must either skip the tuple or throw, not hang.
  const result = getValidTimes({ ...MINIFEST_BASE, dst: [[0, 3, 90]] });
  // If we reach here, the function returned instead of looping forever.
  assert.ok(Array.isArray(result));
});

void test('getValidTimes: normal dst tuples still work', () => {
  const result = getValidTimes({ ...MINIFEST_BASE, dst: [[3, 3, 9]] });
  assert.strictEqual(result.length, 3); // h=3, h=6, h=9
  assert.strictEqual(result[0]!.compact, '2026071903');
  assert.strictEqual(result[1]!.compact, '2026071906');
  assert.strictEqual(result[2]!.compact, '2026071909');
});
