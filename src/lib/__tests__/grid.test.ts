import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGridBounds } from '../grid';
import { GribFileEntry } from '../../types';

function makeEntry(latMin: number, latMax: number, lonMin: number, lonMax: number, latStep: number, lonStep: number): GribFileEntry {
  return {
    meta: {
      path: 'test.grib2', mtime: 0, type: 'wind' as const,
      latMin, latMax, lonMin, lonMax, latStep, lonStep,
      timeStart: new Date('2024-01-01'), timeEnd: new Date('2024-01-02'),
      nTimes: 2, referenceTime: new Date('2024-01-01'),
    },
    data: null,
  };
}

test('computeGridBounds: union bbox of two overlapping files', () => {
  const a = makeEntry(40, 42, 10, 12, 0.5, 0.5);
  const b = makeEntry(41, 44, 11, 14, 0.5, 0.5);
  const bounds = computeGridBounds([a, b]);
  assert.strictEqual(bounds.latMin, 40);
  assert.strictEqual(bounds.latMax, 44);
  assert.strictEqual(bounds.lonMin, 10);
  assert.strictEqual(bounds.lonMax, 14);
});

test('computeGridBounds: picks finest step when files differ', () => {
  const a = makeEntry(40, 42, 10, 12, 1.0, 1.0);
  const b = makeEntry(41, 43, 11, 13, 0.25, 0.25);
  const bounds = computeGridBounds([a, b]);
  assert.strictEqual(bounds.latStep, 0.25);
  assert.strictEqual(bounds.lonStep, 0.25);
});

test('computeGridBounds: nLat/nLon computed from union bbox and finest step', () => {
  const a = makeEntry(40, 42, 10, 12, 0.5, 0.5);
  const bounds = computeGridBounds([a]);
  assert.strictEqual(bounds.nLat, 4);  // (42-40)/0.5 = 4
  assert.strictEqual(bounds.nLon, 4);  // (12-10)/0.5 = 4
});

test('computeGridBounds: single file', () => {
  const a = makeEntry(50, 55, 0, 10, 1, 2);
  const bounds = computeGridBounds([a]);
  assert.strictEqual(bounds.latMin, 50);
  assert.strictEqual(bounds.latMax, 55);
  assert.strictEqual(bounds.lonMin, 0);
  assert.strictEqual(bounds.lonMax, 10);
  assert.strictEqual(bounds.latStep, 1);
  assert.strictEqual(bounds.lonStep, 2);
  assert.strictEqual(bounds.nLat, 5);
  assert.strictEqual(bounds.nLon, 5);  // (10-0)/2 = 5
});
