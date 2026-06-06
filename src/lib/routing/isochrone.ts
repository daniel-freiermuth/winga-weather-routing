// Isochrone routing: two-phase time-optimal route search (coarse T_bound pre-pass then fine expansion).

import { WindProvider, LandEdgeIndex, PolarData, CalculationRequest, IsochronePoint, RoutePoint } from '../../types';
import { RoutingAlgorithm } from './algorithm';
import { nearestIdx } from '../windprovider';
import { interpolateBoatSpeed } from '../polar';
import { segmentCrossesLandFast, isPointOnLand } from '../landmask';
import { haversineNM, bearingTo, destinationPoint, windSpeedKnots, windDirection } from '../geo';

const DEFAULT_HEADING_STEP = 5;
const DEFAULT_SECTOR_SIZE = 1;
const DEFAULT_MIN_BOAT_SPEED = 0.3;
const DEFAULT_ARRIVAL_RADIUS_NM = 2;
const TBOUND_HEADING_STEP = 20;
// Same granularity as the fine pass: prevents adjacent bearing sectors (e.g. Öresund at
// 213° vs overshot-south at 211° from Åland) from competing in the same 5° bucket,
// which caused the coarse pass to discard the Öresund candidate and return T_bound=null.
const TBOUND_SECTOR_SIZE = 1;

interface StepTiming {
  step: number;
  frontierSize: number;
  candidatesEvaluated: number;
  landChecksPerformed: number;
  windLookupMs: number;
  polarMs: number;
  landCheckMs: number;
  pruningMs: number;
  totalMs: number;
}

function logStepTiming(t: StepTiming): void {
  console.log(
    `[isochrone] step=${t.step} frontier=${t.frontierSize} candidates=${t.candidatesEvaluated}` +
    ` landChecks=${t.landChecksPerformed}` +
    ` wind=${t.windLookupMs.toFixed(1)}ms polar=${t.polarMs.toFixed(1)}ms` +
    ` land=${t.landCheckMs.toFixed(1)}ms prune=${t.pruningMs.toFixed(1)}ms` +
    ` total=${t.totalMs.toFixed(1)}ms`,
  );
}

function logTimingSummary(timings: StepTiming[]): void {
  if (timings.length === 0) return;
  const fields: (keyof StepTiming)[] = [
    'frontierSize', 'candidatesEvaluated', 'landChecksPerformed',
    'windLookupMs', 'polarMs', 'landCheckMs', 'pruningMs', 'totalMs',
  ];
  const lines = fields.map((f) => {
    const vals = timings.map((t) => t[f] as number);
    const total = vals.reduce((a, b) => a + b, 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return `  ${f}: min=${min.toFixed(1)} max=${max.toFixed(1)} total=${total.toFixed(1)}`;
  });
  console.log(`[isochrone] summary over ${timings.length} steps:\n${lines.join('\n')}`);
}

export class IsochroneAlgorithm implements RoutingAlgorithm {
  readonly id = 'isochrone';
  readonly name = 'Isochrone';

  async calculate(
    wind: WindProvider,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: Array<[number, number]>) => void,
    options?: Record<string, unknown>,
  ): Promise<{ route: RoutePoint[]; warning?: string }> {
    const headingStep = Number(options?.headingStep ?? DEFAULT_HEADING_STEP);
    const sectorSize = Number(options?.sectorSize ?? DEFAULT_SECTOR_SIZE);
    const minBoatSpeed = Number(options?.minBoatSpeed ?? DEFAULT_MIN_BOAT_SPEED);
    const arrivalRadiusNm = Number(options?.arrivalRadiusNm ?? DEFAULT_ARRIVAL_RADIUS_NM);
    const maxWindKn = Number(options?.maxWindKn ?? 0);  // 0 = no limit
    const maxWaveM  = Number(options?.maxWaveM  ?? 0);  // 0 = no limit

    const { start, end } = request;
    const departureTime = new Date(request.departureTime);
    const startTimeIdx = nearestIdx(wind.times, departureTime);
    const nSteps = wind.times.length - startTimeIdx - 1;

    if (nSteps <= 0) throw new Error('Departure time is at or after the end of the forecast data');

    let isochrone: IsochronePoint[] = [{
      lat: start.lat, lon: start.lon,
      time: wind.times[startTimeIdx],
      heading: 0, twa: 0, tws: 0, boatSpeed: 0, windDir: 0,
      stepCalcMs: 0,
      parent: undefined,
    }];

    let arrived: IsochronePoint | null = null;

    const maxBoatSpeed = getMaxPolarSpeed(polar);
    const tBound = await runCoarsePass(wind, polar, edgeIndex, start, end, minBoatSpeed, arrivalRadiusNm, maxWindKn, maxWaveM, startTimeIdx, nSteps, onProgress);
    const tBoundMs = tBound !== null ? tBound.getTime() : null;

    const stepTimings: StepTiming[] = [];

    for (let step = startTimeIdx; step < wind.times.length - 1; step++) {
      const stepStart = performance.now();
      const nextTime = wind.times[step + 1];
      const dtHours = (nextTime.getTime() - wind.times[step].getTime()) / 3_600_000;
      const candidates: IsochronePoint[] = [];

      let windLookupMs = 0;
      let landCheckMs = 0;
      let candidatesEvaluated = 0;
      let landChecksPerformed = 0;

      const t0frontier = performance.now();

      for (const point of isochrone) {
        if (edgeIndex && isPointOnLand(edgeIndex, point.lat, point.lon)) continue;

        const t0wind = performance.now();
        const windVec = wind.getWind(point.lat, point.lon, step);
        windLookupMs += performance.now() - t0wind;

        const tws = windSpeedKnots(windVec.u, windVec.v);
        const wdir = windDirection(windVec.u, windVec.v);

        if (maxWindKn > 0 && tws > maxWindKn) continue;
        if (maxWaveM > 0) {
          const wh = wind.getWave(point.lat, point.lon, wind.times[step]);
          if (wh != null && wh > maxWaveM) continue;
        }

        for (let hdg = 0; hdg < 360; hdg += headingStep) {
          let twa = ((hdg - wdir) + 360) % 360;
          if (twa > 180) twa = 360 - twa;

          const boatSpeed = interpolateBoatSpeed(polar, twa, tws);
          if (boatSpeed < minBoatSpeed) continue;

          candidatesEvaluated++;
          const distNM = boatSpeed * dtHours;
          const { lat: newLat, lon: newLon } = destinationPoint(point.lat, point.lon, distNM, hdg);

          if (!wind.coversPoint(newLat, newLon)) continue; // discard candidates outside GRIB domain (BUG-37)

          if (edgeIndex) {
            landChecksPerformed++;
            const t0land = performance.now();
            const blocked = segmentCrossesLandFast(edgeIndex, point.lat, point.lon, newLat, newLon);
            landCheckMs += performance.now() - t0land;
            if (blocked) continue;
          }

          const newPoint: IsochronePoint = {
            lat: newLat, lon: newLon,
            time: nextTime,
            heading: hdg, twa, tws, boatSpeed, windDir: wdir,
            stepCalcMs: 0,
            parent: point,
          };
          candidates.push(newPoint);

          const distToEnd = haversineNM(newLat, newLon, end.lat, end.lon);
          if (distToEnd <= arrivalRadiusNm) {
            if (!arrived || distToEnd < haversineNM(arrived.lat, arrived.lon, end.lat, end.lon)) {
              arrived = newPoint;
            }
          }
        }
      }

      const frontierLoopMs = performance.now() - t0frontier;
      const polarMs = Math.max(0, frontierLoopMs - windLookupMs - landCheckMs);

      const stepCalcMs = performance.now() - stepStart;
      for (const c of candidates) c.stepCalcMs = Math.round(stepCalcMs);

      if (arrived) break;

      const t0prune = performance.now();
      isochrone = pruneToFrontier(candidates, start.lat, start.lon, sectorSize);
      const pruningMs = performance.now() - t0prune;

      if (isochrone.length === 0) throw new Error('No reachable positions — check GRIB coverage and polar data');

      let drawIsochrone = isochrone;
      if (tBoundMs !== null) {
        const bounded = isochrone.filter((p) => {
          const minRemainingH = haversineNM(p.lat, p.lon, end.lat, end.lon) / maxBoatSpeed; // admissible lower bound: even at max polar speed this point cannot beat T_bound
          return p.time.getTime() + minRemainingH * 3_600_000 <= tBoundMs;
        });
        drawIsochrone = bounded;
        if (bounded.length === 0) {
          onProgress(50 + Math.round(((step - startTimeIdx + 1) / nSteps) * 50), []);
          await new Promise<void>((resolve) => setImmediate(resolve)); // yield event loop so SSE progress events are flushed to the browser
          break;
        }
        isochrone = bounded;
      }

      const timing: StepTiming = {
        step,
        frontierSize: isochrone.length,
        candidatesEvaluated,
        landChecksPerformed,
        windLookupMs,
        polarMs: Math.max(0, polarMs),
        landCheckMs,
        pruningMs,
        totalMs: performance.now() - stepStart,
      };
      stepTimings.push(timing);
      logStepTiming(timing);

      const frontier: Array<[number, number]> = drawIsochrone.map((p) => [p.lat, p.lon]);
      onProgress(50 + Math.round(((step - startTimeIdx + 1) / nSteps) * 50), frontier);
      await new Promise<void>((resolve) => setImmediate(resolve)); // yield event loop so SSE progress events are flushed to the browser
    }

    logTimingSummary(stepTimings);

    if (!arrived) {
      if (isochrone.length > 0) {
        // Time steps exhausted with a live frontier — route extends past forecast coverage.
        const closest = isochrone.reduce((best, p) =>
          haversineNM(p.lat, p.lon, end.lat, end.lon) < haversineNM(best.lat, best.lon, end.lat, end.lon) ? p : best
        );
        const dist = Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon));
        return {
          route: backtrack(closest, wind, false),
          warning: `Route extends past forecast coverage — partial route shown (${dist} nm from destination)`,
        };
      }
      const closest = isochrone.reduce((best, p) =>
        haversineNM(p.lat, p.lon, end.lat, end.lon) < haversineNM(best.lat, best.lon, end.lat, end.lon) ? p : best,
        isochrone[0],
      );
      const dist = closest ? Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon)) : 0;
      throw new Error(`Destination not reached within forecast period (closest approach: ${dist} nm)`);
    }

    return { route: backtrack(arrived, wind, true, end) };
  }
}

// Farthest-from-start dominance: within each bearing sector keep the candidate
// that has travelled the greatest distance from the original start.
// g+h (A*) was attempted but fails here because all step-N candidates share the
// same g value (wind.times[N]), reducing g+h to min-h = min haversine-to-destination.
// For routes requiring a southward detour (e.g. Öresund), min-h prefers near-start
// points (smaller haversine) over correctly advancing south-going points, pinning
// the frontier near the start indefinitely (D13, BUG-37).
// Frontier escape (escaped points are farthest from start) is prevented by the GRIB
// domain boundary check applied before candidates enter this function.
function pruneToFrontier<T extends { lat: number; lon: number }>(
  candidates: T[],
  startLat: number,
  startLon: number,
  sectorSize: number,
): T[] {
  type Entry = { point: T; distSq: number };
  const sectors = new Map<number, Entry>();

  for (const p of candidates) {
    const brng = bearingTo(startLat, startLon, p.lat, p.lon);
    const sector = Math.floor(((brng % 360) + 360) % 360 / sectorSize);

    const dLat = p.lat - startLat;
    const dLon = (p.lon - startLon) * Math.cos(startLat * (Math.PI / 180)); // cosine correction: longitude degrees are shorter than latitude degrees away from the equator
    const distSq = dLat * dLat + dLon * dLon;

    const existing = sectors.get(sector);
    if (!existing || distSq > existing.distSq) {
      sectors.set(sector, { point: p, distSq });
    }
  }

  return Array.from(sectors.values()).map((e) => e.point);
}

// includeEnd=true appends the destination as the final waypoint (normal arrival).
// includeEnd=false omits it (partial route — boat never reached destination).
function backtrack(
  arrived: IsochronePoint,
  wind: WindProvider,
  includeEnd: boolean,
  end?: { lat: number; lon: number },
): RoutePoint[] {
  const route: RoutePoint[] = [];

  if (includeEnd && end) {
    route.unshift({
      lat: end.lat, lon: end.lon,
      time: arrived.time,
      heading: arrived.heading,
      twa: arrived.twa, tws: arrived.tws, boatSpeed: arrived.boatSpeed, windDir: arrived.windDir,
      legCalcMs: 0,
      waveHeight: wind.getWave(end.lat, end.lon, arrived.time),
    });
  }

  let cur: IsochronePoint | undefined = arrived;
  while (cur) {
    route.unshift({
      lat: cur.lat, lon: cur.lon,
      time: cur.time,
      heading: cur.heading,
      twa: cur.twa, tws: cur.tws, boatSpeed: cur.boatSpeed, windDir: cur.windDir,
      legCalcMs: cur.stepCalcMs,
      waveHeight: wind.getWave(cur.lat, cur.lon, cur.time),
    });
    cur = cur.parent;
  }

  return route;
}

function getMaxPolarSpeed(polar: PolarData): number {
  return Math.max(...polar.speeds.flat());
}

type GeoPoint = { lat: number; lon: number };
type CoarsePoint = GeoPoint;

async function runCoarsePass(
  wind: WindProvider,
  polar: PolarData,
  edgeIndex: LandEdgeIndex | null,
  start: GeoPoint,
  end: GeoPoint,
  minBoatSpeed: number,
  arrivalRadiusNm: number,
  maxWindKn: number,
  maxWaveM: number,
  startTimeIdx: number,
  nSteps: number,
  onProgress: (pct: number, frontier: Array<[number, number]>) => void,
): Promise<Date | null> {
  let frontier: CoarsePoint[] = [{ lat: start.lat, lon: start.lon }];

  for (let step = startTimeIdx; step < wind.times.length - 1; step++) {
    const nextTime = wind.times[step + 1];
    const dtHours = (nextTime.getTime() - wind.times[step].getTime()) / 3_600_000;
    const candidates: CoarsePoint[] = [];

    for (const point of frontier) {
      if (edgeIndex && isPointOnLand(edgeIndex, point.lat, point.lon)) continue;

      const windVec = wind.getWind(point.lat, point.lon, step);
      const tws = windSpeedKnots(windVec.u, windVec.v);
      const wdir = windDirection(windVec.u, windVec.v);

      if (maxWindKn > 0 && tws > maxWindKn) continue;
      if (maxWaveM > 0) {
        const wh = wind.getWave(point.lat, point.lon, wind.times[step]);
        if (wh != null && wh > maxWaveM) continue;
      }

      for (let hdg = 0; hdg < 360; hdg += TBOUND_HEADING_STEP) {
        let twa = ((hdg - wdir) + 360) % 360;
        if (twa > 180) twa = 360 - twa;

        const boatSpeed = interpolateBoatSpeed(polar, twa, tws);
        if (boatSpeed < minBoatSpeed) continue;

        const distNM = boatSpeed * dtHours;
        const { lat: newLat, lon: newLon } = destinationPoint(point.lat, point.lon, distNM, hdg);

        if (!wind.coversPoint(newLat, newLon)) continue; // discard candidates outside GRIB domain (BUG-37)

        if (edgeIndex && segmentCrossesLandFast(edgeIndex, point.lat, point.lon, newLat, newLon)) continue;

        candidates.push({ lat: newLat, lon: newLon });

        if (haversineNM(newLat, newLon, end.lat, end.lon) <= arrivalRadiusNm) {
          return nextTime;
        }
      }
    }

    // A single empty step may be caused by land temporarily blocking all headings — skip rather than abort.
    if (candidates.length === 0) continue;
    frontier = pruneToFrontier(candidates, start.lat, start.lon, TBOUND_SECTOR_SIZE);
    if (frontier.length === 0) return null;

    const coarseFrontier: Array<[number, number]> = frontier.map((p) => [p.lat, p.lon]);
    onProgress(Math.round(((step - startTimeIdx + 1) / nSteps) * 50), coarseFrontier);
    await new Promise<void>((resolve) => setImmediate(resolve)); // yield event loop so SSE progress events are flushed to the browser
  }

  return null;
}
