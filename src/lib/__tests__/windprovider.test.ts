import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MultiFileWindProvider, nearestIdx } from '../windprovider';
import { GribData, GribFileEntry } from '../../types';

function makeGrib(opts: { latMin?: number; latMax?: number; lonMin?: number; lonMax?: number; u?: number; v?: number; times?: Date[] }): GribData {
  const latMin = opts.latMin ?? 40;
  const latStep = 1;
  const lonMin = opts.lonMin ?? 10;
  const lonStep = 1;
  const nLat = 3, nLon = 3;
  const nPoints = nLat * nLon;
  const t0 = opts.times?.[0] ?? new Date('2024-01-01T00:00:00Z');
  const t1 = opts.times?.[1] ?? new Date('2024-01-01T01:00:00Z');
  const times = opts.times ?? [t0, t1];
  const u = opts.u ?? 0;
  const v = opts.v ?? 5;
  return {
    latMin, latStep, lonMin, lonStep, nLat, nLon, times,
    u10: times.map(() => new Float32Array(nPoints).fill(u)),
    v10: times.map(() => new Float32Array(nPoints).fill(v)),
  };
}

function makeEntry(grib: GribData, mtime: number, path_ = 'test.grib2'): GribFileEntry {
  return {
    meta: {
      path: path_,
      mtime,
      latMin: grib.latMin,
      latMax: grib.latMin + grib.latStep * (grib.nLat - 1),
      lonMin: grib.lonMin,
      lonMax: grib.lonMin + grib.lonStep * (grib.nLon - 1),
      timeStart: grib.times[0],
      timeEnd: grib.times[grib.times.length - 1],
      nTimes: grib.times.length,
    },
    data: grib,
  };
}

test('nearestIdx: returns 0 for single-element array', () => {
  const times = [new Date('2024-01-01T00:00:00Z')];
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T06:00:00Z')), 0);
});

test('nearestIdx: finds exact match', () => {
  const times = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
    new Date('2024-01-01T02:00:00Z'),
  ];
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T01:00:00Z')), 1);
});

test('nearestIdx: rounds to nearest', () => {
  const times = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T02:00:00Z'),
  ];
  // 30 minutes past midnight is closer to index 0
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T00:30:00Z')), 0);
  // 90 minutes past midnight is closer to index 1
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T01:30:00Z')), 1);
});

test('MultiFileWindProvider: merged times axis contains entries from all files', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const g1 = makeGrib({ times: [t0, t1] });
  const g2 = makeGrib({ times: [t1, t2] });
  const provider = new MultiFileWindProvider([makeEntry(g1, 1000), makeEntry(g2, 2000)]);
  // t1 appears in both files — should be deduplicated
  assert.strictEqual(provider.times.length, 3);
  assert.strictEqual(provider.times[0].getTime(), t0.getTime());
  assert.strictEqual(provider.times[1].getTime(), t1.getTime());
  assert.strictEqual(provider.times[2].getTime(), t2.getTime());
});

test('MultiFileWindProvider: getWind returns freshest file when files overlap spatially', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  // Older file: v=5 (southerly), newer file: v=10 (stronger southerly)
  const gOld = makeGrib({ v: 5, times: [t0, t1] });
  const gNew = makeGrib({ v: 10, times: [t0, t1] });
  const provider = new MultiFileWindProvider([
    makeEntry(gOld, 1000, 'old.grib2'),
    makeEntry(gNew, 2000, 'new.grib2'),
  ]);
  const wind = provider.getWind(41, 11, 0);  // both files cover this point
  assert.strictEqual(wind.v, 10, 'should use the newer file (mtime 2000)');
});

test('MultiFileWindProvider: getWind falls back to any file when point outside all bboxes', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const g = makeGrib({ latMin: 40, lonMin: 10, v: 7, times: [t0, t1] });
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  // Point is outside the 40–42 lat / 10–12 lon bbox — bilinear clamps to edge
  const wind = provider.getWind(60, 20, 0);
  assert.ok(typeof wind.u === 'number' && typeof wind.v === 'number', 'should return numbers');
});

test('MultiFileWindProvider: getWave returns undefined when no file has swh data', () => {
  const g = makeGrib({});
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  assert.strictEqual(provider.getWave(41, 11, new Date('2024-01-01T00:00:00Z')), undefined);
});

test('MultiFileWindProvider: single file times axis matches grib.times', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const g = makeGrib({ times: [t0, t1, t2] });
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  assert.strictEqual(provider.times.length, 3);
  assert.strictEqual(provider.times[0].getTime(), t0.getTime());
  assert.strictEqual(provider.times[2].getTime(), t2.getTime());
});

// scanGribDir: integration test using a real temp directory
import { scanGribDir } from '../grib';

test('scanGribDir: finds grib2 files and ignores others', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grib-test-'));
  try {
    await fs.writeFile(path.join(dir, 'forecast.grib2'), '');
    await fs.writeFile(path.join(dir, 'other.grib'), '');
    await fs.writeFile(path.join(dir, 'readme.txt'), '');
    await fs.writeFile(path.join(dir, 'DATA.GRB2'), '');  // uppercase extension
    const files = await scanGribDir(dir);
    assert.strictEqual(files.length, 3, 'should find .grib2, .grib, .GRB2 (case-insensitive)');
    assert.ok(files.every(f => f.startsWith(dir)), 'paths should be absolute');
    assert.ok(files.every(f => !f.endsWith('.txt')), 'should not include .txt');
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test('scanGribDir: returns empty array for empty directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grib-test-'));
  try {
    const files = await scanGribDir(dir);
    assert.strictEqual(files.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test('scanGribDir: throws for non-existent directory', async () => {
  await assert.rejects(
    () => scanGribDir('/nonexistent/path/that/does/not/exist'),
    /ENOENT/,
  );
});
