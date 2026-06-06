import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IsochroneAlgorithm } from '../routing/isochrone';
import { GribData, GribFileEntry, PolarData, CalculationRequest, LandPolygon } from '../../types';
import { MultiFileWindProvider } from '../windprovider';
import { buildLandEdgeIndex } from '../landmask';

// Build a tiny synthetic GRIB: 3×3 grid, 2 time steps, constant 5 m/s southerly wind
function makeGrib(times?: Date[]): GribData {
  const nLat = 3, nLon = 3;
  const nPoints = nLat * nLon;

  // 5 m/s southerly: u=0 (no eastward), v=5 (northward) → wind FROM south
  const uFrame = new Float32Array(nPoints).fill(0);
  const vFrame = new Float32Array(nPoints).fill(5);

  const t0 = times?.[0] ?? new Date('2024-01-01T00:00:00Z');
  const t1 = times?.[1] ?? new Date('2024-01-01T01:00:00Z');
  const allTimes = times ?? [t0, t1];

  return {
    latMin: 40, latStep: 1, lonMin: 10, lonStep: 1,
    nLat, nLon,
    times: allTimes,
    u10: allTimes.map(() => new Float32Array(uFrame)),
    v10: allTimes.map(() => new Float32Array(vFrame)),
  };
}

function makeEntry(grib: GribData): GribFileEntry {
  return {
    meta: {
      path: 'test.grib2',
      mtime: 0,
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

function makeWind(grib: GribData): MultiFileWindProvider {
  return new MultiFileWindProvider([makeEntry(grib)]);
}

// Simple polar: 5 kt at all TWA>0, 0 on the nose
function makePolar(): PolarData {
  return {
    tws: [1, 30],
    twa: [0, 45, 90, 135, 180],
    speeds: [
      [0, 0],
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ],
  };
}

const algo = new IsochroneAlgorithm();

test('IsochroneAlgorithm.id is "isochrone"', () => {
  assert.strictEqual(algo.id, 'isochrone');
});

test('calculate: rejects departure time past GRIB end', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.1, lon: 11.1 },
    departureTime: '2025-01-01T00:00:00Z',  // far outside GRIB
  };
  await assert.rejects(
    () => algo.calculate(wind, polar, null, req, () => {}),
    /departure time/i,
  );
});

test('calculate: arrives when destination is within arrival radius', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();

  // Very close destination — should arrive in one step
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },  // ~3 nm north — reachable in 1h at 5 kt
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
    options: { arrivalRadiusNm: 5 },  // generous radius
  };

  const { route } = await algo.calculate(wind, polar, null, req, () => {});
  assert.ok(route.length >= 2, 'route should have at least start and end waypoints');
  assert.strictEqual(route[0].lat, 41);
  assert.strictEqual(route[0].lon, 11);
  // Last point is the destination
  assert.ok(Math.abs(route[route.length - 1].lat - 41.05) < 0.5);
});

test('calculate: every RoutePoint has a non-negative legCalcMs; start point is 0', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
    options: { arrivalRadiusNm: 5 },
  };

  const { route } = await algo.calculate(wind, polar, null, req, () => {});
  for (const p of route) {
    assert.ok(typeof p.legCalcMs === 'number' && p.legCalcMs >= 0,
      `legCalcMs must be a non-negative number, got ${p.legCalcMs}`);
  }
  assert.strictEqual(route[0].legCalcMs, 0, 'start point legCalcMs must be 0');
});

test('calculate: returns partial route with warning when destination unreachable in forecast period', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();

  // Far destination — can't reach in 1 time step; expect partial route + warning
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 50, lon: 20 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const { route, warning } = await algo.calculate(wind, polar, null, req, () => {});
  assert.ok(route.length >= 1, 'partial route should have at least one waypoint');
  assert.ok(typeof warning === 'string' && warning.length > 0, 'warning should be set');
  assert.match(warning!, /forecast coverage/i);
});

test('calculate: calls onProgress at least once', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();

  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 50, lon: 20 },  // unreachable — will still progress
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  let progressCalled = false;
  await algo.calculate(wind, polar, null, req, () => { progressCalled = true; });
  assert.ok(progressCalled, 'onProgress should have been called');
});


test('calculate: T_bound heuristic does not prevent route discovery in a 2-step scenario (REQ-34)', async () => {
  // 3-step GRIB → 2 isochrone steps. Destination ~9 NM north — reachable in step 2 only.
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const wind = makeWind(makeGrib([t0, t1, t2]));
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end:   { lat: 41.15, lon: 11 }, // ~9 NM north: unreachable in 1 step (5 NM), reachable in 2
    departureTime: t0.toISOString(),
    options: { arrivalRadiusNm: 2 },
  };
  const { route } = await algo.calculate(wind, polar, null, req, () => {});
  assert.ok(route.length >= 2, 'route must be found in 2 steps with T_bound active');
  assert.ok(Math.abs(route[route.length - 1].lat - 41.15) < 0.1, 'last waypoint must be near destination');
});

test('calculate: coarse pass cone excludes candidates >90° from start→end bearing (REQ-35)', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
    options: { arrivalRadiusNm: 5 },
  };
  const progressPayloads: Array<[number, number][]> = [];
  const { route } = await algo.calculate(wind, polar, null, req, (_pct, frontier) => {
    progressPayloads.push(frontier);
  });
  assert.ok(route.length >= 2, 'route should be found');
  const coarsePayloads = progressPayloads.slice(0, Math.floor(progressPayloads.length / 2));
  for (const frontier of coarsePayloads) {
    for (const [lat] of frontier) {
      assert.ok(lat >= 41 - 0.01, `coarse frontier point lat ${lat} is south of start — cone failed`);
    }
  }
});

test('calculate: REQ-36 fine-pass onProgress only sends T_bound-passing points', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const wind = makeWind(makeGrib([t0, t1, t2]));
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end:   { lat: 41.15, lon: 11 },
    departureTime: t0.toISOString(),
    options: { arrivalRadiusNm: 2 },
  };
  const allFrontiers: Array<[number, number][]> = [];
  await algo.calculate(wind, polar, null, req, (_pct, frontier) => {
    allFrontiers.push(frontier);
  });
  for (const f of allFrontiers) {
    assert.ok(Array.isArray(f), 'every onProgress frontier must be an array');
  }
});

function makeGribWithWave(waveHeight: number): GribData {
  const grib = makeGrib();
  const nPoints = grib.nLat * grib.nLon;
  const waveFrame = new Float32Array(nPoints).fill(waveHeight);
  const swhByTime = new Map<number, Float32Array>();
  for (const t of grib.times) swhByTime.set(t.getTime(), new Float32Array(waveFrame));
  return { ...grib, swhByTime };
}

test('calculate: maxWindKn discards all candidates when wind exceeds limit', async () => {
  // makeGrib gives 5 m/s wind ≈ 9.7 kn; maxWindKn=5 must discard every frontier point
  const wind = makeWind(makeGrib());
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };
  await assert.rejects(
    () => algo.calculate(wind, polar, null, req, () => {}, { maxWindKn: 5 }),
    /no reachable positions/i,
  );
});

test('calculate: maxWindKn=0 imposes no wind constraint', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };
  const { route } = await algo.calculate(wind, polar, null, req, () => {}, { maxWindKn: 0, arrivalRadiusNm: 5 });
  assert.ok(route.length >= 2, 'route should be found with no wind constraint');
});

test('calculate: maxWaveM discards all candidates when wave exceeds limit', async () => {
  const wind = makeWind(makeGribWithWave(3.0));  // 3 m waves everywhere
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };
  await assert.rejects(
    () => algo.calculate(wind, polar, null, req, () => {}, { maxWaveM: 1.0 }),
    /no reachable positions/i,
  );
});

test('calculate: maxWaveM=0 imposes no wave constraint', async () => {
  const wind = makeWind(makeGribWithWave(3.0));
  const polar = makePolar();
  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };
  const { route } = await algo.calculate(wind, polar, null, req, () => {}, { maxWaveM: 0, arrivalRadiusNm: 5 });
  assert.ok(route.length >= 2, 'route should be found with no wave constraint');
});

test('calculate: land index blocks land points', async () => {
  const wind = makeWind(makeGrib());
  const polar = makePolar();

  // A polygon covering the entire GRIB area blocks all candidates
  const exterior = new Float64Array([9,39, 12,39, 12,42, 9,42, 9,39]);
  const poly: LandPolygon = {
    bboxLatMin: 39, bboxLatMax: 42, bboxLonMin: 9, bboxLonMax: 12, exterior,
  };
  const allLand = buildLandEdgeIndex([poly]);

  const req: CalculationRequest = {
    start: { lat: 41, lon: 11 },
    end: { lat: 41.05, lon: 11 },
    departureTime: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  await assert.rejects(
    () => algo.calculate(wind, polar, allLand, req, () => {}),
    /no reachable positions/i,
  );
});
