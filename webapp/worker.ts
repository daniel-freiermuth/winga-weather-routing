// Routing Web Worker — loads wind/wave/current/land data, then runs the
// isochrone algorithm via WASM (wasm-router).
//
// PROTOCOL
// ─────────
// Main thread → Worker:
//   { type: 'calculate', payload: CalculateRequest }
//
// Worker → Main thread:
//   { type: 'progress', pct: number, frontier: [number,number][] }
//   { type: 'result', route: RoutePoint[], warning?: string }
//   { type: 'error', message: string }

import { TileWindProvider, TileCurrentProvider } from '../src/lib/tile-provider';
import { parsePolarCsv } from '../src/lib/polar';
import { parseIndexFromArrayBuffer } from '../src/lib/land-index-loader';
import { segmentCrossesLandFast, isPointOnLand } from '../src/lib/landmask';
import { windSpeedKnots, windDirection } from '../src/lib/geo';
import type { BoundingBox, CalculationRequest, RoutePoint, LandEdgeIndex } from '../src/types';

// ── Message types ─────────────────────────────────────────────────────────────

interface CalculatePayload {
  request: CalculationRequest;
  polarCsv: string;
  tileBbox: BoundingBox;
  landIndexUrl: string;
  dilatedIndexUrl?: string;
  windModel?: 'ecmwf' | 'gfs' | 'icon';
  useSafetyMargin?: boolean;
}

type InMessage = { type: 'calculate'; payload: CalculatePayload };

type OutMessage =
  | {
      type: 'progress';
      pct: number;
      frontier: [number, number][];
      legOrigin?: [number, number];
      clearIsochrones?: boolean;
    }
  | { type: 'result'; route: RoutePoint[]; warning?: string }
  | { type: 'error'; message: string };

function post(msg: OutMessage): void {
  postMessage(msg);
}

// ── WASM callback globals ─────────────────────────────────────────────────────
// Called by the WASM module during routing. They capture the current
// wind/current/land providers via module-level variables.

let windProvider: TileWindProvider;
let currentProvider: TileCurrentProvider;
let activeIndex: LandEdgeIndex;
let hasCurrent = false;

const _self = globalThis as Record<string, unknown>;

// Pre-allocated buffers — reused on every call to avoid GC pressure
// (millions of calls during a single route calculation)
const _windBuf = new Float64Array(2);
const _curBuf = new Float64Array(2);
const _zeroBuf = new Float64Array(2); // constant [0, 0]
const _reusableDate = new Date(0); // reused to avoid Date allocation in hot loop

_self['js_get_wind'] = (lat: number, lon: number, time_ms: number): Float64Array => {
  const v = windProvider.getWindAtTime(lat, lon, time_ms);
  _windBuf[0] = v.u;
  _windBuf[1] = v.v;
  return _windBuf;
};

_self['js_get_current'] = (lat: number, lon: number, time_ms: number): Float64Array => {
  if (!hasCurrent) return _zeroBuf;
  _reusableDate.setTime(time_ms);
  const v = currentProvider.getCurrent(lat, lon, _reusableDate);
  _curBuf[0] = v.u;
  _curBuf[1] = v.v;
  return _curBuf;
};

_self['js_crosses_land'] = (lat1: number, lon1: number, lat2: number, lon2: number): boolean => {
  return segmentCrossesLandFast(activeIndex, lat1, lon1, lat2, lon2);
};

_self['js_is_on_land'] = (lat: number, lon: number): boolean => {
  return isPointOnLand(activeIndex, lat, lon);
};

_self['js_get_wave'] = (lat: number, lon: number, time_ms: number): number => {
  const w = windProvider.getWaveAtTime(lat, lon, time_ms);
  return w ?? -1;
};

_self['js_covers_point'] = (lat: number, lon: number, time_ms: number): boolean => {
  return windProvider.coversPointAtTimeMs ? windProvider.coversPointAtTimeMs(lat, lon, time_ms) : true;
};

_self['js_on_progress'] = (pct: number, frontier: Float64Array): void => {
  const pts: [number, number][] = [];
  for (let i = 0; i < frontier.length; i += 2) {
    pts.push([frontier[i]!, frontier[i + 1]!]);
  }
  post({ type: 'progress', pct: 10 + pct * 0.9, frontier: pts });
};

_self['js_prefetch'] = (_time_ms: number): void => {
  // Tiles are prefetched upfront before WASM runs (see handleCalculate).
};

// ── WASM loading ──────────────────────────────────────────────────────────────

type WasmModule = {
  calculate_route(
    polar_twa: Float64Array,
    polar_tws: Float64Array,
    polar_speeds: Float64Array,
    legs: Float64Array,
    departure_ms: number,
    forecast_end_ms: number,
    options: Float64Array,
  ): Float64Array;
};

let wasmModule: WasmModule | null = null;

async function loadWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  // Dynamic import: WASM module is a build artifact that may not exist on all platforms.
  const mod = await import('./wasm-pkg/wasm_router.js');
  await mod.default();
  wasmModule = mod as unknown as WasmModule;
  console.log('[routing] WASM module loaded');
  return wasmModule;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function fetchGzBinary(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${String(r.status)}: ${url}`);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isGzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzipped) return buf;
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk: Uint8Array = result.value;
    chunks.push(chunk);
    total += chunk.length;
  }
  const combined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    combined.set(c, off);
    off += c.length;
  }
  return combined.buffer;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handleCalculate(payload: CalculatePayload): Promise<void> {
  const { request, polarCsv, tileBbox, landIndexUrl, dilatedIndexUrl, windModel, useSafetyMargin } = payload;

  const departureMs = new Date(request.departureTime).getTime();
  post({ type: 'progress', pct: 0, frontier: [] });

  // 1. Parse polar
  const polar = parsePolarCsv(polarCsv);

  // 2. Pre-fetch everything in parallel (including WASM)
  const landFetch = fetchGzBinary(landIndexUrl).then((buf) => parseIndexFromArrayBuffer(buf));
  let dilatedFetch: Promise<ReturnType<typeof parseIndexFromArrayBuffer> | null> = Promise.resolve(null);
  if (useSafetyMargin === true && dilatedIndexUrl !== undefined) {
    dilatedFetch = fetchGzBinary(dilatedIndexUrl)
      .then((buf) => parseIndexFromArrayBuffer(buf))
      .catch(() => null);
  }

  const routePoints = [request.start, request.end, ...(request.waypoints ?? [])];
  const routeBbox = {
    latMin: Math.min(...routePoints.map((p) => p.lat)) - 1,
    latMax: Math.max(...routePoints.map((p) => p.lat)) + 1,
    lonMin: Math.min(...routePoints.map((p) => p.lon)) - 1,
    lonMax: Math.max(...routePoints.map((p) => p.lon)) + 1,
  };
  const zoom = TileWindProvider.computeZoom(routeBbox, 2);
  windProvider = new TileWindProvider({ windModel: windModel ?? 'ecmwf', zoom });
  currentProvider = new TileCurrentProvider(zoom);

  const [edgeIndex, dilatedEdgeIndex] = await Promise.all([
    landFetch,
    dilatedFetch,
    windProvider.load(tileBbox),
    currentProvider.load(tileBbox, departureMs, departureMs + 72 * 3_600_000),
    loadWasm(),
  ]);

  activeIndex = useSafetyMargin === true && dilatedEdgeIndex !== null ? dilatedEdgeIndex : edgeIndex;
  hasCurrent = currentProvider.times.length > 0;

  post({ type: 'progress', pct: 10, frontier: [] });

  // 3. Prefetch all wind tiles for the route duration upfront
  // (WASM loop is synchronous — can't do async prefetch mid-step)
  const forecastEnd = windProvider.times[windProvider.times.length - 1];
  const forecastEndMs = forecastEnd ? forecastEnd.getTime() : departureMs + 7 * 24 * 3_600_000;
  const directDist =
    Math.sqrt((request.end.lat - request.start.lat) ** 2 + (request.end.lon - request.start.lon) ** 2) * 60;
  const estDurationMs = Math.min((directDist / 5) * 3_600_000, forecastEndMs - departureMs);
  const stepMs = Math.max(900_000, estDurationMs / 100);
  const prefetches: Promise<void>[] = [];
  for (let t = departureMs; t <= departureMs + estDurationMs + stepMs; t += stepMs) {
    if (windProvider.prefetchForTime) {
      prefetches.push(windProvider.prefetchForTime(t));
    }
  }
  await Promise.all(prefetches);

  // 4. Run WASM routing
  const wasm = wasmModule;
  if (!wasm) throw new Error('WASM module not loaded');

  const waypoints = request.waypoints ?? [];
  const allPoints = [request.start, ...waypoints, request.end];
  const legs = new Float64Array(allPoints.length * 2);
  for (let i = 0; i < allPoints.length; i++) {
    legs[i * 2] = allPoints[i]!.lat;
    legs[i * 2 + 1] = allPoints[i]!.lon;
  }

  const opts = request.options ?? {};
  const options = new Float64Array([
    Number(opts['headingStep'] ?? 5),
    Number(opts['sectorSize'] ?? 1),
    Number(opts['minBoatSpeed'] ?? 0.3),
    Number(opts['maxWindKn'] ?? 0),
    Number(opts['maxWaveM'] ?? 0),
    Number(opts['motorSpeedKn'] ?? 0),
    Number(opts['motorBelowKn'] ?? 0),
    opts['waitForWind'] ? 1 : 0,
    Number(opts['tackPenaltySec'] ?? 30),
    Number(opts['tackThresholdDeg'] ?? 60),
    100, // coneHalfAngle
    100, // coneDisableLookaheadNm
    120, // maxHeadingChange
    0, // arrivalRadiusNm (0 = dynamic)
  ]);

  const flat = wasm.calculate_route(
    new Float64Array(polar.twa),
    new Float64Array(polar.tws),
    new Float64Array(polar.speeds.flat()),
    legs,
    departureMs,
    forecastEndMs,
    options,
  );

  // Decode flat array → RoutePoint[] and enrich with weather data
  // (WASM returns only core routing fields; gust/wave/current/WoW are display-only)
  const nPoints = flat[0]!;
  const route: RoutePoint[] = [];
  for (let i = 0; i < nPoints; i++) {
    const base = 1 + i * 9;
    const lat = flat[base]!;
    const lon = flat[base + 1]!;
    const timeMs = flat[base + 2]!;
    const time = new Date(timeMs);

    // Resample weather at each waypoint position and time
    const gustMs = windProvider.getGustAtTime ? windProvider.getGustAtTime(lat, lon, timeMs) : undefined;
    const cur = hasCurrent ? currentProvider.getCurrent(lat, lon, time) : undefined;
    const resampled = windProvider.getWindAtTime(lat, lon, timeMs);

    // Wind-over-water
    const wowU = resampled.u - (cur?.u ?? 0);
    const wowV = resampled.v - (cur?.v ?? 0);

    const pt: RoutePoint = {
      lat,
      lon,
      time,
      heading: flat[base + 3]!,
      twa: flat[base + 4]!,
      tws: flat[base + 5]!,
      boatSpeed: flat[base + 6]! > 0 ? flat[base + 6]! : undefined,
      windDir: flat[base + 7]!,
      legCalcMs: flat[base + 8]!,
      waveHeight: windProvider.getWaveAtTime ? windProvider.getWaveAtTime(lat, lon, timeMs) : undefined,
      wavePeriod: windProvider.getWavePeriodAtTime ? windProvider.getWavePeriodAtTime(lat, lon, timeMs) : undefined,
      waveDir: windProvider.getWaveDirAtTime ? windProvider.getWaveDirAtTime(lat, lon, timeMs) : undefined,
      gustKn: gustMs != null ? gustMs * 1.94384 : undefined,
      currentU: cur?.u,
      currentV: cur?.v,
      wowTws: cur ? windSpeedKnots(wowU, wowV) : undefined,
      wowDir: cur ? windDirection(wowU, wowV) : undefined,
    };
    route.push(pt);
  }

  post({ type: 'result', route });
}

// ── Message listener ──────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as InMessage;
  if (msg.type === 'calculate') {
    void handleCalculate(msg.payload).catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  }
});
