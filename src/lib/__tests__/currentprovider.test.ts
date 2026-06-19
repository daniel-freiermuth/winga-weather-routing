// Unit tests for ocean current GRIB loading and interpolation (REQ-91).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentAt, nearestCurrentTimeIndex } from '../grib';
import { SingleFileCurrentProvider } from '../currentprovider';
import { CurrentGribData, CurrentFileEntry } from '../../types';

function makeCurrentGrib(
  opts: {
    latMin?: number;
    latStep?: number;
    lonMin?: number;
    lonStep?: number;
    nLat?: number;
    nLon?: number;
    u?: number;
    v?: number;
    times?: Date[];
  } = {},
): CurrentGribData {
  const latMin = opts.latMin ?? 40;
  const latStep = opts.latStep ?? 1;
  const lonMin = opts.lonMin ?? 10;
  const lonStep = opts.lonStep ?? 1;
  const nLat = opts.nLat ?? 2;
  const nLon = opts.nLon ?? 2;
  const nPts = nLat * nLon;
  const t0 = opts.times?.[0] ?? new Date('2024-01-01T00:00:00Z');
  const t1 = opts.times?.[1] ?? new Date('2024-01-01T03:00:00Z');
  const times = opts.times ?? [t0, t1];
  return {
    latMin,
    latStep,
    lonMin,
    lonStep,
    nLat,
    nLon,
    times,
    u: times.map(() => new Float32Array(nPts).fill(opts.u ?? 1.0)),
    v: times.map(() => new Float32Array(nPts).fill(opts.v ?? 0.5)),
  };
}

function makeEntry(data: CurrentGribData): CurrentFileEntry {
  return {
    meta: {
      path: 'current.grib2',
      mtime: 0,
      type: 'current',
      latMin: data.latMin,
      latMax: data.latMin + data.latStep * (data.nLat - 1),
      lonMin: data.lonMin,
      lonMax: data.lonMin + data.lonStep * (data.nLon - 1),
      latStep: data.latStep,
      lonStep: data.lonStep,
      timeStart: data.times[0],
      timeEnd: data.times[data.times.length - 1],
      nTimes: data.times.length,
      referenceTime: data.times[0],
    },
    data,
  };
}

// --- getCurrentAt ---

test('getCurrentAt: returns interpolated value at centre of uniform 2×2 grid', () => {
  const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
  // Centre of a 2×2 grid starting at (40,10) with step 1: query at (40.5, 10.5)
  const result = getCurrentAt(data, 40.5, 10.5, 0);
  assert.ok(Math.abs(result.u - 2.0) < 0.001, `u should be ≈2.0, got ${result.u}`);
  assert.ok(Math.abs(result.v - 1.0) < 0.001, `v should be ≈1.0, got ${result.v}`);
});

test('getCurrentAt: returns {u:0,v:0} for point south of grid (out-of-domain, no clamping)', () => {
  const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
  const result = getCurrentAt(data, 39.0, 10.5, 0); // lat=39 < latMin=40
  assert.strictEqual(result.u, 0);
  assert.strictEqual(result.v, 0);
});

test('getCurrentAt: returns {u:0,v:0} for point north of grid', () => {
  const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
  const result = getCurrentAt(data, 42.0, 10.5, 0); // lat=42 > latMax=41
  assert.strictEqual(result.u, 0);
  assert.strictEqual(result.v, 0);
});

test('getCurrentAt: returns {u:0,v:0} for point west of grid', () => {
  const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
  const result = getCurrentAt(data, 40.5, 9.0, 0); // lon=9 < lonMin=10
  assert.strictEqual(result.u, 0);
  assert.strictEqual(result.v, 0);
});

test('getCurrentAt: returns {u:0,v:0} for point east of grid', () => {
  const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
  const result = getCurrentAt(data, 40.5, 12.0, 0); // lon=12 > lonMax=11
  assert.strictEqual(result.u, 0);
  assert.strictEqual(result.v, 0);
});

test('getCurrentAt: returns non-zero for point exactly on grid boundary', () => {
  const data = makeCurrentGrib({ u: 3.0, v: 1.5 });
  const result = getCurrentAt(data, 40.0, 10.0, 0); // at latMin, lonMin exactly
  assert.ok(result.u !== 0 || result.v !== 0, 'boundary point should have non-zero current');
});

// --- nearestCurrentTimeIndex ---

test('nearestCurrentTimeIndex: returns 0 for single-element time axis', () => {
  const data = makeCurrentGrib({ times: [new Date('2024-01-01T00:00:00Z')] });
  const idx = nearestCurrentTimeIndex(data, new Date('2024-01-01T06:00:00Z'));
  assert.strictEqual(idx, 0);
});

test('nearestCurrentTimeIndex: returns nearest index for 3-hourly axis', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T03:00:00Z');
  const t2 = new Date('2024-01-01T06:00:00Z');
  const data = makeCurrentGrib({ times: [t0, t1, t2] });
  // 1.5h past t0 → equidistant; implementation breaks ties toward lower index
  assert.strictEqual(nearestCurrentTimeIndex(data, new Date('2024-01-01T02:00:00Z')), 1);
  assert.strictEqual(nearestCurrentTimeIndex(data, new Date('2024-01-01T04:00:00Z')), 1);
  assert.strictEqual(nearestCurrentTimeIndex(data, new Date('2024-01-01T05:00:00Z')), 2);
});

// --- SingleFileCurrentProvider ---

test('SingleFileCurrentProvider: getCurrent returns {u:0,v:0} outside bbox', () => {
  const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
  const provider = new SingleFileCurrentProvider(makeEntry(data));
  const result = provider.getCurrent(30.0, 10.5, new Date('2024-01-01T00:00:00Z'));
  assert.strictEqual(result.u, 0);
  assert.strictEqual(result.v, 0);
});

test('SingleFileCurrentProvider: getCurrent returns non-zero inside bbox', () => {
  const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
  const provider = new SingleFileCurrentProvider(makeEntry(data));
  const result = provider.getCurrent(40.5, 10.5, new Date('2024-01-01T00:00:00Z'));
  assert.ok(result.u !== 0 || result.v !== 0, 'inside-domain query should return non-zero current');
});

test('SingleFileCurrentProvider: coversPoint returns true inside bbox', () => {
  const data = makeCurrentGrib();
  const provider = new SingleFileCurrentProvider(makeEntry(data));
  assert.ok(provider.coversPoint(40.5, 10.5));
});

test('SingleFileCurrentProvider: coversPoint returns false outside bbox', () => {
  const data = makeCurrentGrib();
  const provider = new SingleFileCurrentProvider(makeEntry(data));
  assert.ok(!provider.coversPoint(30.0, 10.5));
  assert.ok(!provider.coversPoint(40.5, 5.0));
});

test('SingleFileCurrentProvider: times matches the underlying data times', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T03:00:00Z');
  const data = makeCurrentGrib({ times: [t0, t1] });
  const provider = new SingleFileCurrentProvider(makeEntry(data));
  assert.strictEqual(provider.times.length, 2);
  assert.strictEqual(provider.times[0].getTime(), t0.getTime());
  assert.strictEqual(provider.times[1].getTime(), t1.getTime());
});
