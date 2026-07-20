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
  sampleTilePixel,
  latLonToTile,
  latLonToPixel,
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

/** Find the closest minifest step to a target timestamp. */
function closestStepIdx(steps: { iso: string; compact: string }[], targetMs: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s === undefined) continue;
    const diff = Math.abs(new Date(s.iso).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
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
  private windModelRun = '';
  private waveModelRun = '';
  private tiles: { x: number; y: number }[] = [];
  private loaded = false;

  constructor(opts: TileWindProviderOptions = {}) {
    const model = opts.windModel ?? 'ecmwf';
    this.windModel = WINDY_MODELS[model].minifestId;
    this.zoom = opts.zoom ?? 3;
  }

  /** Pre-fetch all tiles for the given area and time window. */
  async load(bbox: BoundingBox, fromMs: number, toMs: number): Promise<void> {
    const [windMf, waveMf] = await Promise.all([
      fetchMinifest(this.windModel),
      fetchMinifest(this.waveModel),
    ]);

    this.windModelRun = refToCompact(windMf.ref);
    this.waveModelRun = refToCompact(waveMf.ref);
    this.windSteps = getValidTimes(windMf);
    this.waveSteps = getValidTimes(waveMf);
    this.tiles = tilesForBbox(bbox, this.zoom);

    // Build time axis: wind steps within [fromMs, toMs]
    const timesSet = new Set<number>();
    for (const s of this.windSteps) {
      const ms = new Date(s.iso).getTime();
      if (ms >= fromMs && ms <= toMs) timesSet.add(ms);
    }
    const sortedMs = [...timesSet].sort((a, b) => a - b);
    this.times.length = 0;
    this.times.push(...sortedMs.map((ms) => new Date(ms)));

    // Pre-fetch all wind + wave tiles in parallel
    const fetches: Promise<void>[] = [];
    for (const t of this.tiles) {
      for (const step of this.windSteps) {
        const ms = new Date(step.iso).getTime();
        if (ms < fromMs || ms > toMs) continue;
        const key = tileKey(this.windModel, 'wind', step.compact, this.zoom, t.x, t.y);
        if (!this.cache.has(key)) {
          const url = buildTileUrl(this.windModel, this.windModelRun, step.compact, this.zoom, t.x, t.y, 'wind');
          fetches.push(fetchAndDecode(url).then((tile) => { this.cache.set(key, tile); }));
        }
      }
      for (const step of this.waveSteps) {
        const ms = new Date(step.iso).getTime();
        if (ms < fromMs || ms > toMs) continue;
        const key = tileKey(this.waveModel, 'waves', step.compact, this.zoom, t.x, t.y);
        if (!this.cache.has(key)) {
          const url = buildTileUrl(this.waveModel, this.waveModelRun, step.compact, this.zoom, t.x, t.y, 'waves');
          fetches.push(fetchAndDecode(url).then((tile) => { this.cache.set(key, tile); }).catch(() => { /* wave tiles may 404 over land */ }));
        }
      }
    }
    await Promise.all(fetches);
    this.loaded = true;
  }

  getWind(lat: number, lon: number, timeIdx: number): WindVector {
    const step = this.windSteps[this.stepIdxForTimeIdx(timeIdx)];
    if (step === undefined) return { u: 0, v: 0 };
    return this.sampleWind(lat, lon, step.compact);
  }

  getWave(lat: number, lon: number, t: Date): number | undefined {
    const idx = closestStepIdx(this.waveSteps, t.getTime());
    const step = this.waveSteps[idx];
    if (step === undefined) return undefined;
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey(this.waveModel, 'waves', step.compact, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return undefined;
    const { px, py } = latLonToPixel(lat, lon, this.zoom, x, y);
    const val = sampleTilePixel(tile.rgba, tile.header, px, py, false);
    return val.hasData ? val.speed : undefined;
  }

  coversPoint(_lat: number, _lon: number): boolean {
    return this.loaded; // tiles are global at z=3
  }

  coversPointAtTime(_lat: number, _lon: number, timeIdx: number): boolean {
    return this.loaded && timeIdx >= 0 && timeIdx < this.times.length;
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
    return closestStepIdx(this.windSteps, t.getTime());
  }

  private sampleWind(lat: number, lon: number, validTime: string): WindVector {
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey(this.windModel, 'wind', validTime, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return { u: 0, v: 0 };
    const { px, py } = latLonToPixel(lat, lon, this.zoom, x, y);
    const val = sampleTilePixel(tile.rgba, tile.header, px, py, false);
    return { u: val.u, v: val.v };
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
    if (!this.loaded) return { u: 0, v: 0 };
    const idx = closestStepIdx(this.steps, t.getTime());
    const step = this.steps[idx];
    if (step === undefined) return { u: 0, v: 0 };
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const key = tileKey('cmems', 'seacurrents', step.compact, this.zoom, x, y);
    const tile = this.cache.get(key);
    if (tile === undefined) return { u: 0, v: 0 };
    const { px, py } = latLonToPixel(lat, lon, this.zoom, x, y);
    const val = sampleTilePixel(tile.rgba, tile.header, px, py, true);
    return val.hasData ? { u: val.u, v: val.v } : { u: 0, v: 0 };
  }

  coversPoint(lat: number, lon: number): boolean {
    return this.loaded &&
      lat >= this.bbox.latMin && lat <= this.bbox.latMax &&
      lon >= this.bbox.lonMin && lon <= this.bbox.lonMax;
  }
}
