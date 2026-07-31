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

void test('getValidTimes: skips tuples with stepHours=0', () => {
  // stepHours=0 would cause an infinite loop at minifest.ts:78.
  // The guard skips the invalid tuple, producing an empty result.
  const result = getValidTimes({ ...MINIFEST_BASE, dst: [[0, 3, 90]] });
  assert.strictEqual(result.length, 0);
});

void test('getValidTimes: normal dst tuples still work', () => {
  const result = getValidTimes({ ...MINIFEST_BASE, dst: [[3, 3, 9]] });
  assert.strictEqual(result.length, 3); // h=3, h=6, h=9
  assert.deepStrictEqual(
    result.map((s) => s.compact),
    ['2026071903', '2026071906', '2026071909'],
  );
});
