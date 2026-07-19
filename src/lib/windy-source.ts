// WindyForecastSource: ForecastSource backed by the Windy internal API.
//
// DATA SOURCES
// ─────────────
// Wind (u/v m/s): point forecast API — exact values, 1 HTTP request per point.
// Wave height (m): tile API — JPEG pixel sampling, 1 tile per (model × time step).
// Ocean current (u/v m/s): CMEMS tile API — tile pixel sampling, 72 h horizon.
//
// The hybrid design lets each variable use its best source:
//   - Point forecast: exact, authenticated, no JPEG quantisation noise.
//   - Tiles: no auth, CDN-cached, the ONLY source for waves and CMEMS currents.
//
// JPEG DECODING
// ──────────────
// Tile pixels are decoded with `jpeg-js` (pure JS, no native addon).
// Wind/wave tiles are 257×257; at z=3 they cover ~45°×45°, so the entire
// Baltic fits in 1–2 tiles per time step.
//
// TILE CACHE
// ───────────
// Decoded RGBA buffers are kept in an in-memory Map keyed by URL.
// Tiles are ~264 KB each; a 20-waypoint / 5-day planning query needs at most
// ~100 tiles (~26 MB). Cache is per-instance and is NOT evicted — suitable
// for a short-lived planning session. Create a new WindyForecastSource to
// clear the cache.
//
// AUTHENTICATION
// ───────────────
//   - No credentials: anonymous token, 3-hourly steps, ~6-day horizon.
//   - Windy premium credentials: 1-hourly steps, 15-day horizon.
//   - Tiles never require authentication.

import jpeg from 'jpeg-js';
import {
  WindyClient,
  WINDY_MODELS,
  buildTileUrl,
  latLonToTile,
  latLonToPixel,
  decodeTileHeader,
  sampleTilePixel,
  refToCompact,
  getValidTimes,
} from '@signalk-weather-routing/windy-lib';
import type {
  WindyClientOptions,
  WindyModelKey,
  WindyMinifest,
  RgbaDecoder,
  WindyTilePixelValue,
} from '@signalk-weather-routing/windy-lib';
import type { WindVector } from '../types';
import type { ForecastPoint, ForecastSource, SourceCoverage } from './weather-source';

// ── JPEG decoder (pure JS, no native addon) ──────────────────────────────────

const nodeRgbaDecoder: RgbaDecoder = async (url: string): Promise<Uint8Array> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Tile fetch failed: HTTP ${String(resp.status)} — ${url}`);
  const buf = await resp.arrayBuffer();
  const decoded = jpeg.decode(Buffer.from(buf), { useTArray: true });
  return decoded.data;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the step in a minifest closest to `targetMs`.
 * Returns undefined only when the minifest has no steps at all.
 */
function closestStep(
  minifest: WindyMinifest,
  targetMs: number,
): { iso: string; compact: string } | undefined {
  let best: { iso: string; compact: string } | undefined;
  let bestDiff = Infinity;
  for (const step of getValidTimes(minifest)) {
    const diff = Math.abs(new Date(step.iso).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = step;
    }
  }
  return best;
}

/** Convert meteorological FROM-direction + speed to u/v components (m/s). */
function toWindVector(speedMs: number, dirDeg: number): WindVector {
  const rad = (dirDeg * Math.PI) / 180;
  return { u: -speedMs * Math.sin(rad), v: -speedMs * Math.cos(rad) };
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Models with a working point forecast endpoint (CMEMS is tile-only). */
export type WindyForecastModel = Exclude<WindyModelKey, 'cmems'>;

export interface WindySourceOptions {
  /**
   * NWP model. Default: `'ecmwf'`.
   * - `'ecmwf'` — 9 km resolution, best accuracy
   * - `'gfs'`   — 22 km, NOAA
   * - `'icon'`  — 13 km, DWD
   */
  model?: WindyForecastModel;
  /**
   * Windy account credentials for premium access.
   * Premium: 1-hourly steps, 15-day horizon.
   * Anonymous (omit): 3-hourly, ~6-day horizon.
   */
  credentials?: { email: string; password: string };
  /**
   * Stable device UUID. Generate once with `crypto.randomUUID()` and store
   * in plugin settings so the same identity is reused across restarts.
   */
  uid?: string;
}

// ── WindyForecastSource ───────────────────────────────────────────────────────

export class WindyForecastSource implements ForecastSource {
  readonly id: string;
  readonly name: string;

  private readonly model: WindyForecastModel;
  private readonly isPremium: boolean;
  private readonly client: WindyClient;

  /**
   * Decoded tile RGBA cache: URL → decoded pixel buffer.
   * Tiles are ~264 KB; a typical planning session caches <100 tiles.
   */
  private readonly tileCache = new Map<string, Promise<Uint8Array>>();

  constructor(opts: WindySourceOptions = {}) {
    this.model = opts.model ?? 'ecmwf';
    this.isPremium = opts.credentials !== undefined;

    const modelInfo = WINDY_MODELS[this.model];
    this.id = `windy-${this.model}`;
    this.name = `Windy ${modelInfo.name}${this.isPremium ? ' (premium)' : ''}`;

    const clientOpts: WindyClientOptions = {
      ...(opts.uid !== undefined && { uid: opts.uid }),
      ...(opts.credentials !== undefined && { credentials: opts.credentials }),
    };
    this.client = new WindyClient(clientOpts);
  }

  // ── ForecastSource contract ─────────────────────────────────────────────────

  async coverage(): Promise<SourceCoverage> {
    // Fetch the current minifest to get the true forecast end time.
    const minifest = await this.client.getMinifest(this.model);
    return {
      timeRange: {
        startMs: Date.now(),
        endMs: new Date(minifest.end).getTime(),
      },
      // No bbox — Windy has global coverage.
    };
  }

  /**
   * Forecast for a single position across [fromMs, toMs].
   *
   * Wind:    point forecast API (exact, 1 request total for the time range).
   * Waves:   tile API, one tile per time step covering (lat, lon).
   * Current: CMEMS tile API, same strategy, within 72 h horizon only.
   *
   * Tile fetches for the same URL are deduplicated and cached for the
   * lifetime of this WindyForecastSource instance.
   */
  async queryPoint(
    lat: number,
    lon: number,
    fromMs: number,
    toMs: number,
  ): Promise<ForecastPoint[]> {
    // Fetch wind forecast + both minifests in parallel.
    const [windResponse, windMinifest, cmemsMinifest] = await Promise.all([
      this.client.getForecastFor({ lat, lon }, this.model),
      this.client.getMinifest(this.model),
      this.client.getMinifest('cmems'),
    ]);

    const windModelInfo = WINDY_MODELS[this.model];
    const windModelRun = refToCompact(windMinifest.ref);
    const cmemsModelRun = refToCompact(cmemsMinifest.ref);
    const cmemsHorizonMs = new Date(cmemsMinifest.end).getTime();

    const { ts, wind: windSpeed, windDir } = windResponse.data;

    // Build one promise per forecast step in the requested window.
    // Each async map callback returns ForecastPoint | null (null = out of range).
    const settled = await Promise.all(
      ts.map(async (timeMs, i) => {
        if (timeMs < fromMs || timeMs > toMs) return null;
        const speed = windSpeed[i];
        const dir = windDir[i];

        // 1. Wind from point forecast — no extra HTTP request.
        let wind: WindVector | undefined;
        if (speed !== undefined && dir !== undefined) {
          wind = toWindVector(speed, dir);
        }

        // 2. Wave height from tile — one tile covers all nearby waypoints.
        let waveHeightM: number | undefined;
        const waveStep = closestStep(windMinifest, timeMs);
        if (waveStep !== undefined) {
          const wavePx = await this.sampleOverlay(
            lat, lon,
            windModelInfo.minifestId, windModelRun,
            waveStep.compact, 'waves', false,
          ).catch(() => undefined);
          if (wavePx?.hasData === true) waveHeightM = wavePx.speed;
        }

        // 3. Ocean current from CMEMS tile (within 72 h horizon only).
        let current: WindVector | undefined;
        if (timeMs <= cmemsHorizonMs) {
          const currentStep = closestStep(cmemsMinifest, timeMs);
          if (currentStep !== undefined) {
            const curPx = await this.sampleOverlay(
              lat, lon,
              'cmems', cmemsModelRun,
              currentStep.compact, 'seacurrents', true,
            ).catch(() => undefined);
            if (curPx?.hasData === true) {
              current = { u: curPx.u, v: curPx.v };
            }
          }
        }

        return {
          timeMs,
          ...(wind !== undefined && { wind }),
          ...(waveHeightM !== undefined && { waveHeightM }),
          ...(current !== undefined && { current }),
        } satisfies ForecastPoint;
      }),
    );

    return settled
      .filter((p): p is ForecastPoint => p !== null)
      .sort((a, b) => a.timeMs - b.timeMs);
  }

  // ── Private tile helpers ────────────────────────────────────────────────────

  /**
   * Sample the value of a vector overlay at (lat, lon) for a specific model
   * run and valid time. Results are cached by tile URL.
   */
  private async sampleOverlay(
    lat: number,
    lon: number,
    modelId: string,
    modelRun: string,
    validTimeCompact: string,
    filename: string,
    isOceanModel: boolean,
  ): Promise<WindyTilePixelValue> {
    const ZOOM = 3; // z=3: max for free-tier and CMEMS; ~45°×45° per tile
    const { x, y } = latLonToTile(lat, lon, ZOOM);
    const url = buildTileUrl(modelId, modelRun, validTimeCompact, ZOOM, x, y, filename);
    const rgba = await this.fetchTile(url);
    const header = decodeTileHeader(rgba);
    const { px, py } = latLonToPixel(lat, lon, ZOOM, x, y);
    return sampleTilePixel(rgba, header, px, py, isOceanModel);
  }

  /** Fetch and decode a tile, deduplicating concurrent requests for the same URL. */
  private async fetchTile(url: string): Promise<Uint8Array> {
    let pending = this.tileCache.get(url);
    if (pending === undefined) {
      pending = nodeRgbaDecoder(url);
      this.tileCache.set(url, pending);
    }
    return pending;
  }
}
