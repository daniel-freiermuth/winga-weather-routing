import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeCombination, type CombinationFile } from '../gribCombination';

function mk(over: Partial<CombinationFile> & Pick<CombinationFile, 'path'>): CombinationFile {
  return {
    type: 'wind',
    referenceTime: new Date('2026-06-20T00:00:00Z'),
    timeStart: new Date('2026-06-20T00:00:00Z'),
    timeEnd: new Date('2026-06-25T00:00:00Z'),
    latMin: 50,
    latMax: 60,
    lonMin: 10,
    lonMax: 20,
    latStep: 0.1,
    meanStepMs: 3600000,
    mtime: 1000,
    ...over,
  };
}

test('proposeCombination: newer referenceTime fully covering an older file marks the older redundant', () => {
  const newer = mk({
    path: '/new.grib2',
    referenceTime: new Date('2026-06-20T06:00:00Z'),
  });
  const older = mk({
    path: '/old.grib2',
    referenceTime: new Date('2026-06-20T00:00:00Z'),
  });
  const res = proposeCombination([older, newer], {
    now: new Date('2026-06-20T08:00:00Z'),
  });
  assert.deepStrictEqual(res.proposed, ['/new.grib2']);
  const oldResult = res.files.find((f) => f.path === '/old.grib2');
  assert.equal(oldResult?.recommended, false);
  assert.match(oldResult?.reason ?? '', /redundant: fully covered by \/new\.grib2/);
});

test('proposeCombination: partially overlapping files are both recommended (geographic stitch)', () => {
  // A covers lon 10–20, B covers lon 15–25 — neither contains the other → both kept.
  const a = mk({ path: '/a.grib2', lonMin: 10, lonMax: 20 });
  const b = mk({ path: '/b.grib2', lonMin: 15, lonMax: 25 });
  const res = proposeCombination([a, b], {
    now: new Date('2026-06-20T08:00:00Z'),
  });
  assert.deepStrictEqual(res.proposed.sort(), ['/a.grib2', '/b.grib2']);
});

test('proposeCombination: now-scoped excludes files whose forecast period has ended', () => {
  const past = mk({
    path: '/past.grib2',
    timeStart: new Date('2026-06-10T00:00:00Z'),
    timeEnd: new Date('2026-06-11T00:00:00Z'),
  });
  const future = mk({
    path: '/future.grib2',
    timeStart: new Date('2026-06-20T00:00:00Z'),
    timeEnd: new Date('2026-06-25T00:00:00Z'),
  });
  const res = proposeCombination([past, future], {
    now: new Date('2026-06-20T08:00:00Z'),
  });
  assert.deepStrictEqual(res.proposed, ['/future.grib2']);
  assert.equal(res.scope.mode, 'now');
  const pastResult = res.files.find((f) => f.path === '/past.grib2');
  assert.equal(pastResult?.recommended, false);
  assert.match(pastResult?.reason ?? '', /past: forecast period ended/);
});

test('proposeCombination: departure-scoped to a past time proposes past files (learning/test use)', () => {
  const past = mk({
    path: '/past.grib2',
    timeStart: new Date('2026-06-10T00:00:00Z'),
    timeEnd: new Date('2026-06-11T00:00:00Z'),
  });
  const future = mk({
    path: '/future.grib2',
    timeStart: new Date('2026-06-20T00:00:00Z'),
    timeEnd: new Date('2026-06-25T00:00:00Z'),
  });
  const res = proposeCombination([past, future], {
    departureTime: new Date('2026-06-10T12:00:00Z'),
    now: new Date('2026-06-20T08:00:00Z'),
  });
  assert.equal(res.scope.mode, 'departure');
  assert.deepStrictEqual(res.proposed, ['/past.grib2']);
  const futureResult = res.files.find((f) => f.path === '/future.grib2');
  assert.match(futureResult?.reason ?? '', /does not cover the set departure time/);
});

test('proposeCombination: finer granularity wins on equal referenceTime', () => {
  const coarse = mk({ path: '/coarse.grib2', meanStepMs: 3 * 3600000 });
  const fine = mk({ path: '/fine.grib2', meanStepMs: 1 * 3600000 });
  // Same coverage → finer fully contains coarse? No: same bbox+time means each contains the other;
  // the first in priority order (fine) is recommended, coarse is then redundant (contained by fine).
  const res = proposeCombination([coarse, fine], {
    now: new Date('2026-06-20T08:00:00Z'),
  });
  assert.deepStrictEqual(res.proposed, ['/fine.grib2']);
  const coarseResult = res.files.find((f) => f.path === '/coarse.grib2');
  assert.match(coarseResult?.reason ?? '', /redundant: fully covered by \/fine\.grib2/);
});
