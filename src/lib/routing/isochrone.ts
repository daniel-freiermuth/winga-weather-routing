// Isochrone routing: time-optimal route search via iterative frontier expansion.

import type {
  CurrentProvider,
  WindProvider,
  LandEdgeIndex,
  RegionIndex,
  PolarData,
  CalculationRequest,
  IsochronePoint,
  RoutePoint,
  LatLon,
} from '../../types';
import type { RoutingAlgorithm } from './algorithm';
import { interpolateBoatSpeed } from '../polar';
import { segmentCrossesLandFast, isPointOnLand } from '../landmask';
import { segmentCrossesRegion, isPointInRegion } from '../regions';
import { haversineNM, bearingTo, destinationPoint, windSpeedKnots, windDirection, DEG_TO_RAD, nearestIdx } from '../geo';

const DEFAULT_HEADING_STEP = 5;
const DEFAULT_SECTOR_SIZE = 1;
const DEFAULT_MIN_BOAT_SPEED = 0.3;
const DEFAULT_ARRIVAL_RADIUS_NM = 2;
// Applied when the direct segment from a frontier point to the destination is clear of land.
// When land blocks that segment, the cone is disabled (180°) so the frontier can find a way
// around the obstacle — e.g. eastward escape from the Roslagen archipelago (BUG-51).
// Value matches OpenCPN's MaxDivertedCourse default (REQ-73).
const FINE_PASS_CONE_HALF_ANGLE = 100;
// Land check for cone disable uses only the first N nm of the bearing to destination.
// Checking the full segment (up to 250 nm) causes nearly every Baltic frontier point to
// have its cone disabled because the long segment crosses Finnish/Estonian land — removing
// all directional constraint and causing excessive wandering (BUG-53).
const CONE_DISABLE_LOOKAHEAD_NM = 100;
const MAX_HEADING_CHANGE = 120;

interface StepTiming {
  step: number;
  frontierSize: number;
  coneDisabledCount: number;
  candidatesEvaluated: number;
  landChecksPerformed: number;
  windLookupMs: number;
  polarMs: number;
  landCheckMs: number;
  pruningMs: number;
  totalMs: number;
}

function logStepTiming(t: StepTiming): void {
  if (typeof process === 'undefined' || process.env['DEBUG'] === undefined || process.env['DEBUG'] === '') return;
  console.log(
    `[isochrone] step=${String(t.step)} frontier=${String(t.frontierSize)} coneDisabled=${String(t.coneDisabledCount)}/${String(t.frontierSize)} candidates=${String(t.candidatesEvaluated)}` +
      ` landChecks=${String(t.landChecksPerformed)}` +
      ` wind=${t.windLookupMs.toFixed(1)}ms polar=${t.polarMs.toFixed(1)}ms` +
      ` land=${t.landCheckMs.toFixed(1)}ms prune=${t.pruningMs.toFixed(1)}ms` +
      ` total=${t.totalMs.toFixed(1)}ms`,
  );
}

function logTimingSummary(timings: StepTiming[]): void {
  if (typeof process === 'undefined' || process.env['DEBUG'] === undefined || process.env['DEBUG'] === '') return;
  if (timings.length === 0) return;
  const fields: (keyof StepTiming)[] = [
    'frontierSize',
    'coneDisabledCount',
    'candidatesEvaluated',
    'landChecksPerformed',
    'windLookupMs',
    'polarMs',
    'landCheckMs',
    'pruningMs',
    'totalMs',
  ];
  const lines = fields.map((f) => {
    const vals = timings.map((t) => t[f]);
    const total = vals.reduce((a, b) => a + b, 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return `  ${f}: min=${min.toFixed(1)} max=${max.toFixed(1)} total=${total.toFixed(1)}`;
  });
  console.log(`[isochrone] summary over ${String(timings.length)} steps:\n${lines.join('\n')}`);
}

type FailureReason = 'land' | 'wind' | 'grib_exhausted';

// Structured routing failure — carries a machine-readable reason so the frontend
// can show the sailor a specific diagnostic rather than a generic error string.
export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly reason: FailureReason,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class IsochroneAlgorithm implements RoutingAlgorithm {
  readonly id = 'isochrone';
  readonly name = 'Isochrone';

  async calculate(
    wind: WindProvider,
    current: CurrentProvider | null,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    regionIndex: RegionIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: [number, number][], legOrigin?: { lat: number; lon: number }, clearIsochrones?: boolean) => void,
    options?: Record<string, unknown>,
  ): Promise<{ route: RoutePoint[]; warning?: string }> {
    const { start, end } = request;
    const departureTime = new Date(request.departureTime);

    // ── Validate forecast availability ──────────────────────────────────────
    const forecastEnd = wind.times[wind.times.length - 1];
    if (wind.times.length < 2 || forecastEnd === undefined) throw new Error('Departure time is at or after the end of the forecast data');
    const forecastEndMs = forecastEnd.getTime();
    const departureMs = departureTime.getTime();
    if (departureMs >= forecastEndMs) throw new Error('Departure time is at or after the end of the forecast data');

    const avoidIds = new Set(request.avoidRegionIds ?? []);

    // Nautical Safety Rule: hard error if start or destination is inside an avoided region.
    if (regionIndex && avoidIds.size > 0) {
      if (isPointInRegion(regionIndex, avoidIds, start.lat, start.lon))
        throw new Error('Start point is inside an avoided region — move it to open water or unmark that region');
      if (isPointInRegion(regionIndex, avoidIds, end.lat, end.lon))
        throw new Error('Destination is inside an avoided region — move it to open water or unmark that region');
    }

    // Nautical Safety Rule: hard error if start, destination, or any intermediate waypoint is on land.
    if (edgeIndex) {
      if (isPointOnLand(edgeIndex, start.lat, start.lon))
        throw new Error('Start point is on land — move it to open water');
      if (isPointOnLand(edgeIndex, end.lat, end.lon))
        throw new Error('Destination is on land — move it to open water');
      if (request.waypoints) {
        for (let wi = 0; wi < request.waypoints.length; wi++) {
          const wp = request.waypoints[wi];
          if (wp && isPointOnLand(edgeIndex, wp.lat, wp.lon))
            throw new Error(`Waypoint ${String(wi + 1)} is on land — move it to open water`);
        }
      }
    }

    // ── Build leg list: start → wp1 → wp2 → … → end ────────────────────────
    const waypoints = request.waypoints ?? [];
    const legPoints = [start, ...waypoints, end];
    const totalLegs = legPoints.length - 1;

    let fullRoute: RoutePoint[] = [];
    let warning: string | undefined;
    let legDepartureMs = departureMs;

    for (let legIdx = 0; legIdx < totalLegs; legIdx++) {
      const legStart = legPoints[legIdx];
      const legEnd = legPoints[legIdx + 1];
      if (!legStart || !legEnd) break;

      // Clear isochrones from previous leg
      if (legIdx > 0) {
        onProgress(0, [], legStart, true);
      }

      const legResult = await this.calculateLeg(
        legStart, legEnd, legDepartureMs, forecastEndMs,
        wind, current, polar, edgeIndex, regionIndex, avoidIds,
        options,
        (pct, frontier) => {
          const overallPct = Math.round((legIdx / totalLegs + pct / 100 / totalLegs) * 100);
          onProgress(Math.min(overallPct, 99), frontier, legStart);
        },
      );

      // Append leg route (skip first point of subsequent legs — it's the same as the last of the previous)
      const legRoute = legResult.route;
      if (legIdx === 0) {
        fullRoute = legRoute;
      } else if (legRoute.length > 0) {
        fullRoute.push(...legRoute.slice(1));
      }

      if (legResult.warning !== undefined) {
        warning = `Leg ${String(legIdx + 1)}: ${legResult.warning}`;
        break; // partial route — don't continue to next leg
      }

      // Next leg departs from where this one arrived
      if (legRoute.length > 0) {
        const lastPoint = legRoute[legRoute.length - 1];
        if (lastPoint) legDepartureMs = lastPoint.time.getTime();
      }
    }

    return warning !== undefined ? { route: fullRoute, warning } : { route: fullRoute };
  }

  /** Route a single leg from legStart to legEnd. */
  private async calculateLeg(
    legStart: LatLon,
    legEnd: LatLon,
    departureMs: number,
    forecastEndMs: number,
    wind: WindProvider,
    current: CurrentProvider | null,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    regionIndex: RegionIndex | null,
    avoidIds: Set<string>,
    options: Record<string, unknown> | undefined,
    onProgress: (pct: number, frontier: [number, number][]) => void,
  ): Promise<{ route: RoutePoint[]; warning?: string }> {
    const headingStep = Number(options?.['headingStep'] ?? DEFAULT_HEADING_STEP);
    const sectorSize = Number(options?.['sectorSize'] ?? DEFAULT_SECTOR_SIZE);
    const minBoatSpeed = Number(options?.['minBoatSpeed'] ?? DEFAULT_MIN_BOAT_SPEED);
    const maxWindKn = Number(options?.['maxWindKn'] ?? 0);
    const maxWaveM = Number(options?.['maxWaveM'] ?? 0);
    const motorSpeedKn = Number(options?.['motorSpeedKn'] ?? 0);
    const motorBelowKn = Number(options?.['motorBelowKn'] ?? 0);
    const waitForWind = Boolean(options?.['waitForWind'] ?? false);
    const tackPenaltySec = Number(options?.['tackPenaltySec'] ?? 30);
    const tackThresholdDeg = Number(options?.['tackThresholdDeg'] ?? 60);
    const configuredConeHalfAngle = Number(options?.['coneHalfAngle'] ?? FINE_PASS_CONE_HALF_ANGLE);
    const coneDisableLookaheadNm = Number(options?.['coneDisableLookaheadNm'] ?? CONE_DISABLE_LOOKAHEAD_NM);
    const maxHeadingChangeDeg = Number(options?.['maxHeadingChange'] ?? MAX_HEADING_CHANGE);

    const start = legStart;
    const end = legEnd;
    const departureTime = new Date(departureMs);

    // ── Adaptive timestep ───────────────────────────────────────────────────
    const directDistNm = haversineNM(start.lat, start.lon, end.lat, end.lon);
    const estimatedSpeedKn = 5;
    const forecastDurationH = (forecastEndMs - departureMs) / 3_600_000;
    const estimatedDurationH = Math.min(directDistNm / estimatedSpeedKn, forecastDurationH);
    const targetSteps = 100;
    const stepDurationH = Math.max(0.25, estimatedDurationH / targetSteps);
    const stepDurationMs = stepDurationH * 3_600_000;
    const estimatedTotalSteps = Math.ceil(estimatedDurationH / stepDurationH);

    // ── Dynamic arrival radius ──────────────────────────────────────────────
    const configuredArrivalRadius = options?.['arrivalRadiusNm'];
    const dynamicRadius = Math.max(0.1, Math.min(directDistNm / 100, DEFAULT_ARRIVAL_RADIUS_NM));
    const arrivalRadiusNm = configuredArrivalRadius != null && Number(configuredArrivalRadius) > 0
      ? Number(configuredArrivalRadius)
      : dynamicRadius;

    const seedVec = wind.getWindAtTime(start.lat, start.lon, departureMs);
    let isochrone: IsochronePoint[] = [
      {
        lat: start.lat,
        lon: start.lon,
        time: departureTime,
        heading: 0,
        twa: 0,
        tws: windSpeedKnots(seedVec.u, seedVec.v),
        windDir: windDirection(seedVec.u, seedVec.v),
        stepCalcMs: 0,
      },
    ];

    let arrived: IsochronePoint | null = null;

    const stepTimings: StepTiming[] = [];
    let stepsCompleted = 0;
    let lastFrontier: IsochronePoint[] | null = null;
    const lastRejected = { byLand: 0, byPolar: 0, byGrib: 0 };

    let currentTimeMs = departureMs;

    for (let step = 0; step < 500; step++) {
      const nextTimeMs = currentTimeMs + stepDurationMs;
      if (nextTimeMs > forecastEndMs) break;

      if (wind.prefetchForTime) await wind.prefetchForTime(currentTimeMs);

      const nextTime = new Date(nextTimeMs);
      const dtHours = stepDurationH;
      const nearestTimeIdx = nearestIdx(wind.times, new Date(currentTimeMs));

      const stepStart = performance.now();
      const candidates: IsochronePoint[] = [];

      let windLookupMs = 0;
      let landCheckMs = 0;
      let candidatesEvaluated = 0;
      let landChecksPerformed = 0;
      let rejectedByPolar = 0;
      let rejectedByLand = 0;
      let rejectedByGrib = 0;
      let coneDisabledCount = 0;

      const t0frontier = performance.now();

      for (const point of isochrone) {
        if (edgeIndex && isPointOnLand(edgeIndex, point.lat, point.lon)) continue;
        if (regionIndex && avoidIds.size > 0 && isPointInRegion(regionIndex, avoidIds, point.lat, point.lon)) continue;

        const pointToDestBearing = bearingTo(point.lat, point.lon, end.lat, end.lon);

        const t0wind = performance.now();
        const windVec = wind.getWindAtTime(point.lat, point.lon, currentTimeMs);
        const gribFilePath = wind.getFilePathForPoint(point.lat, point.lon, nearestTimeIdx);
        windLookupMs += performance.now() - t0wind;

        const trueWindDir = windDirection(windVec.u, windVec.v);
        let wowU = windVec.u;
        let wowV = windVec.v;
        if (current) {
          const cur = current.getCurrent(point.lat, point.lon, nextTime);
          wowU -= cur.u;
          wowV -= cur.v;
        }
        const tws = windSpeedKnots(wowU, wowV);
        const wdir = windDirection(wowU, wowV);

        if (maxWindKn > 0 && windSpeedKnots(windVec.u, windVec.v) > maxWindKn) {
          rejectedByPolar++;
          continue;
        }
        if (maxWaveM > 0) {
          const wh = wind.getWaveAtTime ? wind.getWaveAtTime(point.lat, point.lon, currentTimeMs) : wind.getWave(point.lat, point.lon, new Date(currentTimeMs));
          if (wh != null && wh > maxWaveM) continue;
        }

        const distToDest = haversineNM(point.lat, point.lon, end.lat, end.lon);
        const coneCheckEnd =
          distToDest <= coneDisableLookaheadNm
            ? end
            : destinationPoint(point.lat, point.lon, coneDisableLookaheadNm, pointToDestBearing);
        const directPathBlockedByLand =
          edgeIndex !== null &&
          segmentCrossesLandFast(edgeIndex, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
        const directPathBlockedByRegion =
          regionIndex !== null &&
          avoidIds.size > 0 &&
          segmentCrossesRegion(regionIndex, avoidIds, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
        if (directPathBlockedByLand || directPathBlockedByRegion) coneDisabledCount++;
        const coneHalfAngle = directPathBlockedByLand || directPathBlockedByRegion ? 180 : configuredConeHalfAngle;

        let waitCandidateAdded = false;
        for (let hdg = 0; hdg < 360; hdg += headingStep) {
          const deviation = Math.abs(((hdg - pointToDestBearing + 180 + 360) % 360) - 180);
          if (deviation > coneHalfAngle) continue;

          if (point.parent !== undefined) {
            const delta = Math.abs(((hdg - point.heading + 180 + 360) % 360) - 180);
            if (delta > maxHeadingChangeDeg) continue;
          }

          let twa = (hdg - wdir + 360) % 360;
          if (twa > 180) twa = 360 - twa;

          const polarSpeed = interpolateBoatSpeed(polar, twa, tws);
          const effectiveSpeed =
            motorBelowKn > 0 && motorSpeedKn > 0 && polarSpeed < motorBelowKn ? motorSpeedKn : polarSpeed;
          if (effectiveSpeed < minBoatSpeed) {
            if (waitForWind && !waitCandidateAdded) {
              candidates.push({
                lat: point.lat,
                lon: point.lon,
                time: nextTime,
                heading: point.heading,
                twa: point.twa,
                tws,
                boatSpeed: 0,
                windDir: trueWindDir,
                stepCalcMs: 0,
                gribFilePath,
                parent: point,
              });
              waitCandidateAdded = true;
            }
            rejectedByPolar++;
            continue;
          }

          candidatesEvaluated++;
          let penaltyH = 0;
          if (tackPenaltySec > 0 && point.parent !== undefined) {
            const hdgChange = Math.abs(((hdg - point.heading + 180 + 360) % 360) - 180);
            if (hdgChange > tackThresholdDeg) penaltyH = tackPenaltySec / 3600;
          }
          const distNM = effectiveSpeed * Math.max(0, dtHours - penaltyH);
          const wt = destinationPoint(point.lat, point.lon, distNM, hdg);
          let newLat = wt.lat;
          let newLon = wt.lon;

          if (current) {
            const cur = current.getCurrent(point.lat, point.lon, nextTime);
            const dtS = dtHours * 3600;
            newLat += (cur.v * dtS) / (1852 * 60);
            newLon += (cur.u * dtS) / (1852 * 60 * Math.cos(point.lat * DEG_TO_RAD));
          }

          const covered = wind.coversPointAtTimeMs
            ? wind.coversPointAtTimeMs(newLat, newLon, nextTimeMs)
            : wind.coversPointAtTime(newLat, newLon, nearestTimeIdx);
          if (!covered) {
            rejectedByGrib++;
            continue;
          }

          if (edgeIndex) {
            landChecksPerformed++;
            const t0land = performance.now();
            const blocked = segmentCrossesLandFast(edgeIndex, point.lat, point.lon, newLat, newLon);
            landCheckMs += performance.now() - t0land;
            if (blocked) {
              rejectedByLand++;
              continue;
            }
          }
          if (
            regionIndex &&
            avoidIds.size > 0 &&
            segmentCrossesRegion(regionIndex, avoidIds, point.lat, point.lon, newLat, newLon)
          ) {
            rejectedByLand++;
            continue;
          }

          const newPoint: IsochronePoint = {
            lat: newLat,
            lon: newLon,
            time: nextTime,
            heading: hdg,
            twa,
            tws,
            boatSpeed: effectiveSpeed,
            windDir: trueWindDir,
            stepCalcMs: 0,
            gribFilePath,
            parent: point,
          };
          candidates.push(newPoint);
        }
      }

      const arrivedCandidate = candidates.reduce<IsochronePoint | null>((best, c) => {
        const d = haversineNM(c.lat, c.lon, end.lat, end.lon);
        if (d > arrivalRadiusNm) return best;
        if (best === null || d < haversineNM(best.lat, best.lon, end.lat, end.lon)) return c;
        return best;
      }, null);
      if (arrivedCandidate !== null) {
        arrived = arrivedCandidate;
        break;
      }
      const frontierLoopMs = performance.now() - t0frontier;
      const polarMs = Math.max(0, frontierLoopMs - windLookupMs - landCheckMs);

      const stepCalcMs = performance.now() - stepStart;
      for (const c of candidates) c.stepCalcMs = Math.round(stepCalcMs);

      lastRejected.byLand = rejectedByLand;
      lastRejected.byPolar = rejectedByPolar;
      lastRejected.byGrib = rejectedByGrib;

      const t0prune = performance.now();
      isochrone = pruneToFrontier(candidates, start.lat, start.lon, sectorSize);
      const pruningMs = performance.now() - t0prune;

      if (isochrone.length > 0) lastFrontier = isochrone;

      if (isochrone.length === 0) {
        const reason: FailureReason =
          lastRejected.byGrib > lastRejected.byLand && lastRejected.byGrib > lastRejected.byPolar
            ? 'grib_exhausted'
            : lastRejected.byLand > lastRejected.byPolar
              ? 'land'
              : 'wind';
        const reasonText = (r: FailureReason) =>
          r === 'land'
            ? 'land blocks all paths'
            : r === 'grib_exhausted'
              ? 'frontier reached GRIB boundary'
              : 'wind too adverse or light';
        const counts = `(land: ${String(lastRejected.byLand)}, wind: ${String(lastRejected.byPolar)}, grib: ${String(lastRejected.byGrib)})`;
        if (lastFrontier !== null) {
          const closest = closestTo(lastFrontier, end);
          const dist = Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon));
          return {
            route: backtrack(closest, wind, current, false),
            warning: `No reachable positions at step ${String(stepsCompleted + 1)} (${reasonText(reason)}) ${counts} — partial route shown (${String(dist)} nm from destination)`,
          };
        }
        throw new RoutingError(
          `No reachable positions at step ${String(step + 1)} — ${reasonText(reason)}${reason === 'wind' ? ' to make progress' : ''} ${counts}`,
          reason,
        );
      }

      const timing: StepTiming = {
        step,
        frontierSize: isochrone.length,
        coneDisabledCount,
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

      const frontier: [number, number][] = isochrone.map((p) => [p.lat, p.lon]);
      stepsCompleted++;
      const progressPct = Math.min(Math.round(((stepsCompleted + 1) / estimatedTotalSteps) * 100), 99);
      onProgress(progressPct, frontier);
      currentTimeMs = nextTimeMs;
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }

    logTimingSummary(stepTimings);

    if (!arrived) {
      if (isochrone.length > 0) {
        const closest = closestTo(isochrone, end);
        const dist = Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon));
        return {
          route: backtrack(closest, wind, current, false),
          warning: `Route extends past forecast coverage after ${String(stepsCompleted)} steps — partial route shown (${String(dist)} nm from destination)`,
        };
      }
      throw new RoutingError(
        `Destination not reached within forecast period after ${String(stepsCompleted)} steps`,
        'grib_exhausted',
      );
    }

    return { route: backtrack(arrived, wind, current, true, end) };
  }
}

// Farthest-from-start dominance: within each bearing sector keep the two candidates
// that have travelled the greatest distance from the original start (BUG-45).
// Keeping two per sector instead of one allows a channel-threading path and an
// open-water escape in the same 1° sector to coexist — with single-survivor selection
// the farther (open-water) point always won, silently discarding the channel path.
// OpenCPN uses topologically correct closed-contour merging instead; top-2 is a
// deliberate simplification that fixes the immediate failure mode (D16). The full
// closed-contour merge remains a candidate for a future sprint if top-2 proves
// insufficient.
// g+h (A*) was attempted but fails here because all step-N candidates share the
// same g value (wind.times[N]), reducing g+h to min-h = min haversine-to-destination.
// For routes requiring a southward detour (e.g. Öresund), min-h prefers near-start
// points (smaller haversine) over correctly advancing south-going points, pinning
// the frontier near the start indefinitely (D13, BUG-37).
// Frontier escape (escaped points are farthest from start) is prevented by the GRIB
// domain boundary check applied before candidates enter this function.
// Returns the point in `points` closest to `target` by haversine distance.
function closestTo<T extends { lat: number; lon: number }>(points: T[], target: { lat: number; lon: number }): T {
  return points.reduce((best, p) =>
    haversineNM(p.lat, p.lon, target.lat, target.lon) < haversineNM(best.lat, best.lon, target.lat, target.lon)
      ? p
      : best,
  );
}

function pruneToFrontier<T extends { lat: number; lon: number }>(
  candidates: T[],
  startLat: number,
  startLon: number,
  sectorSize: number,
): T[] {
  interface Entry { point: T; distSq: number }
  const sectors = new Map<number, Entry[]>();

  for (const p of candidates) {
    const brng = bearingTo(startLat, startLon, p.lat, p.lon);
    const sector = Math.floor((((brng % 360) + 360) % 360) / sectorSize);

    const dLat = p.lat - startLat;
    const dLon = (p.lon - startLon) * Math.cos(startLat * DEG_TO_RAD); // cosine correction: longitude degrees are shorter than latitude degrees away from the equator
    const distSq = dLat * dLat + dLon * dLon;

    const existing = sectors.get(sector) ?? [];
    if (existing.length < 2) {
      existing.push({ point: p, distSq });
      sectors.set(sector, existing);
    } else {
      // Replace the closer of the two survivors if the new candidate is farther.
      const e0 = existing[0];
      const e1 = existing[1];
      if (e0 === undefined || e1 === undefined) throw new Error('BUG: existing index out of bounds');
      const minIdx = e0.distSq <= e1.distSq ? 0 : 1;
      const eMin = existing[minIdx];
      if (eMin === undefined) throw new Error('BUG: existing[minIdx] out of bounds');
      if (distSq > eMin.distSq) existing[minIdx] = { point: p, distSq };
    }
  }

  return [...sectors.values()].flatMap((arr) => arr.map((e) => e.point));
}

// includeEnd=true appends the destination as the final waypoint (normal arrival).
// includeEnd=false omits it (partial route — boat never reached destination).
function backtrack(
  arrived: IsochronePoint,
  wind: WindProvider,
  current: CurrentProvider | null,
  includeEnd: boolean,
  end?: { lat: number; lon: number },
): RoutePoint[] {
  const route: RoutePoint[] = [];

  if (includeEnd && end) {
    const timeMs = arrived.time.getTime();
    const gustMs = wind.getGustAtTime ? wind.getGustAtTime(end.lat, end.lon, timeMs) : undefined;
    const cur = current ? current.getCurrent(end.lat, end.lon, arrived.time) : undefined;
    const endWind = wind.getWindAtTime(end.lat, end.lon, timeMs);
    const endWowU = endWind.u - (cur?.u ?? 0);
    const endWowV = endWind.v - (cur?.v ?? 0);
    route.unshift({
      lat: end.lat,
      lon: end.lon,
      time: arrived.time,
      heading: arrived.heading,
      twa: arrived.twa,
      tws: arrived.tws,
      boatSpeed: arrived.boatSpeed,
      windDir: arrived.windDir,
      legCalcMs: 0,
      waveHeight: wind.getWaveAtTime ? wind.getWaveAtTime(end.lat, end.lon, timeMs) : wind.getWave(end.lat, end.lon, arrived.time),
      gribFilePath: arrived.gribFilePath,
      gustKn: gustMs != null ? gustMs * 1.94384 : undefined,
      currentU: cur?.u,
      currentV: cur?.v,
      wavePeriod: wind.getWavePeriodAtTime ? wind.getWavePeriodAtTime(end.lat, end.lon, timeMs) : undefined,
      waveDir: wind.getWaveDirAtTime ? wind.getWaveDirAtTime(end.lat, end.lon, timeMs) : undefined,
      wowTws: cur ? windSpeedKnots(endWowU, endWowV) : undefined,
      wowDir: cur ? windDirection(endWowU, endWowV) : undefined,
    });
  }

  let p: IsochronePoint | undefined = arrived;
  while (p) {
    const timeMs = p.time.getTime();
    const resampled = wind.getWindAtTime(p.lat, p.lon, timeMs);
    const gustMs = wind.getGustAtTime ? wind.getGustAtTime(p.lat, p.lon, timeMs) : undefined;
    const cur = current ? current.getCurrent(p.lat, p.lon, p.time) : undefined;
    // Wind-over-water: true wind minus current
    const wowU = resampled.u - (cur?.u ?? 0);
    const wowV = resampled.v - (cur?.v ?? 0);
    route.unshift({
      lat: p.lat,
      lon: p.lon,
      time: p.time,
      heading: p.heading,
      twa: p.twa,
      tws: windSpeedKnots(resampled.u, resampled.v),
      boatSpeed: p.boatSpeed,
      windDir: windDirection(resampled.u, resampled.v),
      legCalcMs: p.stepCalcMs,
      waveHeight: wind.getWaveAtTime ? wind.getWaveAtTime(p.lat, p.lon, timeMs) : wind.getWave(p.lat, p.lon, p.time),
      gribFilePath: p.gribFilePath,
      gustKn: gustMs != null ? gustMs * 1.94384 : undefined,
      currentU: cur?.u,
      currentV: cur?.v,
      wavePeriod: wind.getWavePeriodAtTime ? wind.getWavePeriodAtTime(p.lat, p.lon, timeMs) : undefined,
      waveDir: wind.getWaveDirAtTime ? wind.getWaveDirAtTime(p.lat, p.lon, timeMs) : undefined,
      wowTws: cur ? windSpeedKnots(wowU, wowV) : undefined,
      wowDir: cur ? windDirection(wowU, wowV) : undefined,
    });
    p = p.parent;
  }

  return route;
}
