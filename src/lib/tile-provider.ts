// TileWindProvider / TileCurrentProvider: WindProvider and CurrentProvider
// implementations backed by pre-fetched Windy forecast tiles.
//
// LIFECYCLE
// ─────────
//   1. Construct with model, time range, and bounding box.
//   2. Call load() — fetches and decodes all needed tiles in parallel.
//   3. Use getWind / getWave / getCurrent — fully synchronous after load().
//
// TILE CACHING
// ─────────────
// Each tile is fetched once and its decoded RGBA buffer + header are stored
// in memory. At z=3, one tile covers ~45°×45°. A 5-day Baltic route
// typically needs ~1 tile × 40 time steps × 2 overlays ≈ 80 tile fetches,
// each ~28 KB → ~2 MB total. The 257×265×4 decoded RGBA is ~272 KB per
// tile, so ~22 MB total in memory — fine for a planning session.
//
// BROWSER COMPATIBILITY
// ──────────────────────
// This module uses fetch() + OffscreenCanvas for JPEG decoding. No Node.js APIs.
// It runs in a browser or Web Worker (OffscreenCanvas is available in both).

// Browser/Worker APIs — declared here so the module compiles under the server
// tsconfig (lib: ES2023, no DOM). At runtime, these are only called in browser/worker contexts.
declare function createImageBitmap(blob: Blob): Promise<ImageBitmap>;
declare class OffscreenCanvas {
  constructor(width: number, height: number);
  getContext(type: '2d'): OffscreenCanvasRenderingContext2D | null;
}
declare interface OffscreenCanvasRenderingContext2D {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}
declare interface ImageBitmap { width: number; height: number; close(): void; }
declare interface ImageData { data: Uint8ClampedArray; width: number; height: number; }

import {
  WINDY_MODELS,
  buildTileUrl,
  decodeTileHeader,
  sampleTileBilinear,
  latLonToTile,
  latLonToPixelFrac,
  refToCompact,
  getValidTimes,
  fetchMinifest,
} from '@signalk-weather-routing/windy-lib';
import type {
  WindyModelKey,
  WindyTileHeader,
} from '@signalk-weather-routing/windy-lib';
import type { BoundingBox, CurrentProvider, GribFileMeta, WindProvider, WindVector } from '../types';

// ── Cached tile ───────────────────────────────────────────────────────────────

interface CachedTile {
  rgba: Uint8Array;
  header: WindyTileHeader;
}

/** Cache key: `${model}/${overlay}/${validTimeCompact}/${z}/${x}/${y}` */
function tileKey(
  model: string, overlay: string, validTime: string,
  z: number, x: number, y: number,
): string {
  return `${model}/${overlay}/${validTime}/${String(z)}/${String(x)}/${String(y)}`;
}

// ── Shared tile fetch infrastructure ──────────────────────────────────────────

/** Fetch a JPEG tile, decode to RGBA, extract header. Deduplicates by URL. */
const inflight = new Map<string, Promise<CachedTile>>();

async function fetchAndDecode(url: string): Promise<CachedTile> {
  let pending = inflight.get(url);
  if (pending !== undefined) return pending;
  pending = (async () => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Tile HTTP ${String(resp.status)}: ${url}`);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context from OffscreenCanvas');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const rgba = new Uint8Array(imageData.data.buffer);
    bitmap.close();
    const header = decodeTileHeader(rgba);
    return { rgba, header };
  })();
  inflight.set(url, pending);
  return pending;
}

/** Find the closest minifest step to a target timestamp. Uses binary search on sorted steps. */
function closestStepIdx(steps: { iso: string; compact: string }[], targetMs: number, precomputedMs?: number[]): number {
  if (steps.length === 0) return 0;
  const ms = precomputedMs ?? steps.map(s => new Date(s.iso).getTime());
  // Binary search for nearest
  let lo = 0, hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ms[mid]! < targetMs) lo = mid + 1;
    else hi = mid;
  }
  // Check lo and lo-1 for closest
  if (lo > 0 && Math.abs(ms[lo - 1]! - targetMs) <= Math.abs(ms[lo]! - targetMs)) return lo - 1;
  return lo;
}

/** Determine all tile coordinates at zoom z that cover a bounding box. */
function tilesForBbox(bbox: BoundingBox, z: number): { x: number; y: number }[] {
  const tl = latLonToTile(bbox.latMax, bbox.lonMin, z);
  const br = latLonToTile(bbox.latMin, bbox.lonMax, z);
  const tiles: { x: number; y: number }[] = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

// ── TileWindProvider ──────────────────────────────────────────────────────────

export interface TileWindProviderOptions {
  /** NWP model for wind. Default: `'ecmwf'`. */
  windModel?: Exclude<WindyModelKey, 'cmems'>;
  /** Tile zoom level. Max 3 for ECMWF/GFS. Default: 3. */
  zoom?: number;
}

/**
 * Pre-fetch Windy wind + wave tiles for a geographic area and time range,
 * then provide synchronous O(1) wind/wave lookups for the routing algorithm.
 *
 * ```
 * const wp = new TileWindProvider(options);
 * await wp.load(bbox, fromMs, toMs);
 * // Now usable as WindProvider — synchronous getWind / getWave
 * ```
 */
export class TileWindProvider implements WindProvider {
  readonly times: Date[] = [];

  private readonly windModel: string;
  private readonly waveModel = 'ecmwf-wam';
  private readonly zoom: number;
  private readonly cache = new Map<string, CachedTile>();
  private windSteps: { iso: string; compact: string }[] = [];
  private waveSteps: { iso: string; compact: string }[] = [];
  private windStepsMs: number[] = []; // precomputed timestamps for fast lookup
  private waveStepsMs: number[] = [];
  private windModelRun = '';
  private waveModelRun = '';
  private tiles: { x: number; y: number }[] = [];
  private loaded = false;

  constructor(opts: TileWindProviderOptions = {}) {
    const model = opts.windModel ?? 'ecmwf';
    this.windModel = WINDY_MODELS[model].minifestId;
    this.zoom = opts.zoom ?? 3;
  }

  /** Load metadata (model runs, time steps, tile grid). No tiles fetched yet. */
  async load(bbox: BoundingBox, _fromMs?: number, _toMs?: number): Promise<void> {
    const [windMf, waveMf] = await Promise.all([
      fetchMinifest(this.windModel),
      fetchMinifest(this.waveModel),
    ]);

    this.windModelRun = refToCompact(windMf.ref);
    this.waveModelRun = refToCompact(waveMf.ref);
    this.windSteps = getValidTimes(windMf);
    this.waveSteps = getValidTimes(waveMf);
    this.windStepsMs = this.windSteps.map(s => new Date(s.iso).getTime());
    this.waveStepsMs = this.waveSteps.map(s => new Date(s.iso).getTime());
    this.tiles = tilesForBbox(bbox, this.zoom);

    // Build full time axis from all available wind steps
    this.times.length = 0;
    this.times.push(...this.windStepsMs.map(ms => new Date(ms)));

    this.loaded = true;
  }

  /**
   * Fetch tiles for a specific time (and its neighbor for temporal interpolation).
   * Call before each algorithm step. Already-cached tiles are skipped.
   */
  async prefetchForTime(timeMs: number): Promise<void> {
    // Find the two bracketing wind steps for temporal interpolation
    const windIdxs = new Set<number>();
    const wi = closestStepIdx(this.windSteps, timeMs, this.windStepsMs);
    windIdxs.add(wi);
    if (wi > 0) windIdxs.add(wi - 1);
    if (wi < this.windSteps.length - 1) windIdxs.add(wi + 1);

    // Same for wave
    const waveIdxs = new Set<number>();
    const wvi = closestStepIdx(this.waveSteps, timeMs, this.waveStepsMs);
    waveIdxs.add(wvi);
    if (wvi > 0) waveIdxs.add(wvi - 1);
    if (wvi < this.waveSteps.length - 1) waveIdxs.add(wvi + 1);

    const fetches: Promise<void>[] = [];
    for (const t of this.tiles) {
      for (const si of windIdxs) {
        const step = this.windSteps[si];
        if (!step) continue;
        const key = tileKey(this.windModel, 'wind', step.compact, this.zoom, t.x, t.y);
        if (!this.cache.has(key)) {
          const url = buildTileUrl(this.windModel, this.windModelRun, step.compact, this.zoom, t.x, t.y, 'wind');
          fetches.push(fetchAndDecode(url).then((tile) => { this.cache.set(key, tile); }));
        }
      }
      for (const si of waveIdxs) {
        const step = this.waveSteps[si];
        if (!step) continue;
        const key = tileKey(this.waveModel, 'waves', step.compact, this.zoom, t.x, t.y);
        if (!this.cache.has(key)) {
          const url = buildTileUrl(this.waveModel, this.waveModelRun, step.compact, this.zoom, t.x, t.y, 'waves');
          fetches.push(fetchAndDecode(url).then((tile) => { this.cache.set(key, tile); }).catch(() => { /* wave tiles may 404 over land */ }));
        }
      }
    }
    if (fetches.length > 0) await Promise.all(fetches);
  }

  getWind(lat: number, lon: number, timeIdx: number): WindVector {
    const step = this.windSteps[this.stepIdxForTimeIdx(timeIdx)];
    if (step === undefined) return { u: 0, v: 0 };
    return this.sampleWind(lat, lon, step.compact);
  }

  getWave(lat: number, lon: number, t: Date): number | undefined {
    const idx = closestStepIdx(this.waveSteps, t.getTime(), this.waveStepsMs);
    const step = this.waveSteps[idx];
    if (step === undefined) return undefined;
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey(this.waveModel, 'waves', step.compact, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return undefined;
    const { px, py } = latLonToPixelFrac(lat, lon, this.zoom, x, y);
    const val = sampleTileBilinear(tile.rgba, tile.header, px, py, false);
    return val.hasData ? val.speed : undefined;
  }

  coversPoint(_lat: number, _lon: number): boolean {
    return this.loaded; // tiles are global at z=3
  }

  coversPointAtTime(_lat: number, _lon: number, timeIdx: number): boolean {
    return this.loaded && timeIdx >= 0 && timeIdx < this.times.length;
  }

  coversPointAtTimeMs(_lat: number, _lon: number, timeMs: number): boolean {
    if (!this.loaded || this.times.length === 0) return false;
    const first = this.times[0];
    const last = this.times[this.times.length - 1];
    if (first === undefined || last === undefined) return false;
    return timeMs >= first.getTime() && timeMs <= last.getTime();
  }

  // Cache the last time-bracket index to avoid repeated binary searches
  // (algorithm queries the same timeMs for many points within each step)
  private lastTimeMs = -1;
  private lastTimeBracket = 0;
  private lastTimeFrac = 0;

  getWindAtTime(lat: number, lon: number, timeMs: number): WindVector {
    const times = this.times;
    if (times.length === 0) return { u: 0, v: 0 };
    const first = times[0];
    const last = times[times.length - 1];
    if (first === undefined || last === undefined) return { u: 0, v: 0 };
    if (timeMs <= first.getTime()) return this.getWindByDate(lat, lon, first);
    if (timeMs >= last.getTime()) return this.getWindByDate(lat, lon, last);

    // Reuse cached bracket if same timeMs (very common — same time for all frontier points)
    let i: number;
    let f: number;
    if (timeMs === this.lastTimeMs) {
      i = this.lastTimeBracket;
      f = this.lastTimeFrac;
    } else {
      // Binary search for bracket
      let lo = 0, hi = times.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid]!.getTime() <= timeMs) lo = mid;
        else hi = mid - 1;
      }
      i = lo;
      const t0 = times[i]!.getTime();
      const t1 = times[i + 1]!.getTime();
      f = (timeMs - t0) / (t1 - t0);
      this.lastTimeMs = timeMs;
      this.lastTimeBracket = i;
      this.lastTimeFrac = f;
    }

    // If very close to a step boundary, skip interpolation
    if (f < 0.01) return this.getWindByDate(lat, lon, times[i]!);
    if (f > 0.99) return this.getWindByDate(lat, lon, times[i + 1]!);

    const w0 = this.getWindByDate(lat, lon, times[i]!);
    const w1 = this.getWindByDate(lat, lon, times[i + 1]!);

    return {
      u: w0.u * (1 - f) + w1.u * f,
      v: w0.v * (1 - f) + w1.v * f,
    };
  }

  getWaveAtTime(lat: number, lon: number, timeMs: number): number | undefined {
    if (this.waveSteps.length === 0) return undefined;
    // Find bracketing wave steps
    const i = closestStepIdx(this.waveSteps, timeMs, this.waveStepsMs);
    const t0ms = this.waveStepsMs[i];
    if (t0ms === undefined) return this.getWave(lat, lon, new Date(timeMs));
    // If at or past last step, or only one step, use nearest
    if (i >= this.waveSteps.length - 1) return this.getWave(lat, lon, new Date(timeMs));
    const t1ms = this.waveStepsMs[i + 1];
    if (t1ms === undefined || t1ms === t0ms) return this.getWave(lat, lon, new Date(timeMs));
    const f = Math.max(0, Math.min(1, (timeMs - t0ms) / (t1ms - t0ms)));
    if (f < 0.01) return this.getWave(lat, lon, new Date(t0ms));
    if (f > 0.99) return this.getWave(lat, lon, new Date(t1ms));
    const w0 = this.getWave(lat, lon, new Date(t0ms));
    const w1 = this.getWave(lat, lon, new Date(t1ms));
    if (w0 === undefined) return w1;
    if (w1 === undefined) return w0;
    return w0 * (1 - f) + w1 * f;
  }

  /** Compute optimal zoom level so the route area fits within maxTilesPerDim tiles.
   *  Capped at zoom 4 — Windy tile CDN only serves zoom 3 and 4. */
  static computeZoom(bbox: BoundingBox, maxTilesPerDim = 2): number {
    const latSpan = bbox.latMax - bbox.latMin;
    const lonSpan = bbox.lonMax - bbox.lonMin;
    const span = Math.max(latSpan, lonSpan);
    const z = Math.floor(Math.log2(maxTilesPerDim * 360 / span));
    return Math.max(3, Math.min(z, 4)); // Windy serves zoom 3–4 only
  }

  getFilePathForPoint(lat: number, lon: number, timeIdx: number): string {
    const step = this.windSteps[this.stepIdxForTimeIdx(timeIdx)];
    if (step === undefined) return '';
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    return `windy/${this.windModel}/${this.windModelRun}/${step.compact}/${String(this.zoom)}/${String(x)}/${String(y)}`;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Map a times[] index to the closest wind step index. */
  private stepIdxForTimeIdx(timeIdx: number): number {
    const t = this.times[timeIdx];
    if (t === undefined) return 0;
    return closestStepIdx(this.windSteps, t.getTime(), this.windStepsMs);
  }

  private sampleWind(lat: number, lon: number, validTime: string): WindVector {
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey(this.windModel, 'wind', validTime, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return { u: 0, v: 0 };
    const { px, py } = latLonToPixelFrac(lat, lon, this.zoom, x, y);
    const val = sampleTileBilinear(tile.rgba, tile.header, px, py, false);
    return { u: val.u, v: val.v };
  }

  private getWindByDate(lat: number, lon: number, t: Date): WindVector {
    const idx = closestStepIdx(this.windSteps, t.getTime(), this.windStepsMs);
    const step = this.windSteps[idx];
    if (!step) return { u: 0, v: 0 };
    return this.sampleWind(lat, lon, step.compact);
  }
}

// ── TileCurrentProvider ───────────────────────────────────────────────────────

/**
 * Pre-fetch CMEMS ocean current tiles for a geographic area and time range,
 * then provide synchronous current lookups for the routing algorithm.
 */
export class TileCurrentProvider implements CurrentProvider {
  readonly times: Date[] = [];
  readonly meta: GribFileMeta;

  private readonly zoom: number;
  private readonly cache = new Map<string, CachedTile>();
  private steps: { iso: string; compact: string }[] = [];
  private stepsMs: number[] = [];
  private modelRun = '';
  private tiles: { x: number; y: number }[] = [];
  private loaded = false;
  private bbox: BoundingBox = { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };

  constructor(zoom = 3) {
    this.zoom = zoom;
    // Synthetic meta for the routing algorithm (only used by UI, not routing core).
    this.meta = {
      path: 'windy/cmems',
      mtime: Date.now(),
      type: 'current',
      latMin: -90, latMax: 90, lonMin: -180, lonMax: 180,
      latStep: 0.1, lonStep: 0.1,
      timeStart: new Date(),
      timeEnd: new Date(),
      nTimes: 0,
      referenceTime: new Date(),
    };
  }

  async load(bbox: BoundingBox, fromMs: number, toMs: number): Promise<void> {
    this.bbox = bbox;
    const mf = await fetchMinifest('cmems');
    this.modelRun = refToCompact(mf.ref);
    this.steps = getValidTimes(mf);
    this.stepsMs = this.steps.map(s => new Date(s.iso).getTime());
    this.tiles = tilesForBbox(bbox, this.zoom);

    const horizonMs = new Date(mf.end).getTime();
    const effectiveToMs = Math.min(toMs, horizonMs);

    const timesSet = new Set<number>();
    for (const s of this.steps) {
      const ms = new Date(s.iso).getTime();
      if (ms >= fromMs && ms <= effectiveToMs) timesSet.add(ms);
    }
    const sortedMs = [...timesSet].sort((a, b) => a - b);
    this.times.length = 0;
    this.times.push(...sortedMs.map((ms) => new Date(ms)));

    // Update synthetic meta
    this.meta.timeStart = this.times[0] ?? new Date();
    this.meta.timeEnd = this.times[this.times.length - 1] ?? new Date();
    this.meta.nTimes = this.times.length;
    this.meta.referenceTime = new Date(mf.ref);
    this.meta.latMin = bbox.latMin;
    this.meta.latMax = bbox.latMax;
    this.meta.lonMin = bbox.lonMin;
    this.meta.lonMax = bbox.lonMax;

    const fetches: Promise<void>[] = [];
    for (const t of this.tiles) {
      for (const step of this.steps) {
        const ms = new Date(step.iso).getTime();
        if (ms < fromMs || ms > effectiveToMs) continue;
        const key = tileKey('cmems', 'seacurrents', step.compact, this.zoom, t.x, t.y);
        if (!this.cache.has(key)) {
          const url = buildTileUrl('cmems', this.modelRun, step.compact, this.zoom, t.x, t.y, 'seacurrents');
          fetches.push(fetchAndDecode(url).then((tile) => { this.cache.set(key, tile); }).catch(() => { /* may fail over land */ }));
        }
      }
    }
    await Promise.all(fetches);
    this.loaded = true;
  }

  getCurrent(lat: number, lon: number, t: Date): WindVector {
    if (!this.loaded || this.steps.length === 0) return { u: 0, v: 0 };
    const timeMs = t.getTime();
    const i = closestStepIdx(this.steps, timeMs, this.stepsMs);

    // Temporal interpolation between bracketing steps
    if (i < this.steps.length - 1) {
      const t0 = this.stepsMs[i]!;
      const t1 = this.stepsMs[i + 1]!;
      if (t1 > t0) {
        const f = Math.max(0, Math.min(1, (timeMs - t0) / (t1 - t0)));
        if (f > 0.01 && f < 0.99) {
          const c0 = this.sampleCurrent(lat, lon, this.steps[i]!.compact);
          const c1 = this.sampleCurrent(lat, lon, this.steps[i + 1]!.compact);
          return { u: c0.u * (1 - f) + c1.u * f, v: c0.v * (1 - f) + c1.v * f };
        }
      }
    }
    return this.sampleCurrent(lat, lon, this.steps[i]!.compact);
  }

  private sampleCurrent(lat: number, lon: number, validTime: string): WindVector {
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey('cmems', 'seacurrents', validTime, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return { u: 0, v: 0 };
    const { px, py } = latLonToPixelFrac(lat, lon, this.zoom, x, y);
    const val = sampleTileBilinear(tile.rgba, tile.header, px, py, true);
    return val.hasData ? { u: val.u, v: val.v } : { u: 0, v: 0 };
  }

  coversPoint(lat: number, lon: number): boolean {
    return this.loaded &&
      lat >= this.bbox.latMin && lat <= this.bbox.latMax &&
      lon >= this.bbox.lonMin && lon <= this.bbox.lonMax;
  }
}
