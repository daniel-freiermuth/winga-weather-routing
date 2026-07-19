// Weather data source abstraction.
//
// There are two distinct use cases with very different performance requirements:
//
//   1. Routing (isochrone algorithm) — ~170 000 synchronous wind lookups per route.
//      Data MUST be pre-loaded into memory as a spatial grid. The existing
//      WindProvider / CurrentProvider interfaces serve this contract and are
//      unchanged.
//
//   2. Planning view ("weather along a fixed route") — ~10–20 async point
//      queries at planning time. Any backend works; HTTP APIs are fine.
//
// ForecastSource is the common denominator: every backend implements it.
// BulkLoadableSource extends it for backends that can also feed the routing
// algorithm (GRIB files, pre-fetched tile caches).
//
//   ForecastSource          ← all backends (GRIB, Weather API, SMHI, …)
//   └── BulkLoadableSource  ← bulk-loadable backends only (GRIB)
//           │
//           └─ loadForRouting() → RoutingData
//                                   ├─ WindProvider    (existing routing contract)
//                                   └─ CurrentProvider (existing routing contract)

import type { BoundingBox, CurrentProvider, WindVector, WindProvider } from '../types';

// ── Shared data types ─────────────────────────────────────────────────────────

/** Atmospheric + oceanographic data at a single location and time. */
export interface ForecastPoint {
  readonly timeMs: number;
  /** True wind u/v components (m/s). u = eastward, v = northward. */
  readonly wind?: WindVector;
  /** Significant wave height (m). */
  readonly waveHeightM?: number;
  /** Ocean current u/v components (m/s). */
  readonly current?: WindVector;
}

/** What spatial and temporal extent a source covers. */
export interface SourceCoverage {
  readonly timeRange: { readonly startMs: number; readonly endMs: number };
  /** Undefined for sources with global coverage (most API sources). */
  readonly bbox?: BoundingBox;
}

// ── ForecastSource ────────────────────────────────────────────────────────────

/**
 * A source of weather forecast data that can answer async point queries.
 *
 * Every backend implements this interface — GRIB files, the SignalK Weather
 * API v2, SMHI, Open-Meteo, etc. It is the contract consumed by the planning
 * view ("weather at waypoints with ETAs").
 */
export interface ForecastSource {
  /** Stable identifier; used to select a specific source by name. */
  readonly id: string;

  /** Human-readable label shown in the UI. */
  readonly name: string;

  /**
   * Time range and spatial extent of available data.
   * bbox is undefined for sources with global or unknown coverage.
   */
  coverage(): Promise<SourceCoverage>;

  /**
   * Forecast for a single lat/lon across the window [fromMs, toMs].
   *
   * Implementations return one entry per available forecast step that falls
   * within the window, sorted by timeMs ascending. May return fewer entries
   * than the window contains if the source has gaps or limited resolution.
   *
   * API sources typically request ~count= ⌈(toMs−fromMs)/stepMs⌉ entries;
   * GRIB sources filter their in-memory time axis.
   */
  queryPoint(
    lat: number,
    lon: number,
    fromMs: number,
    toMs: number,
  ): Promise<ForecastPoint[]>;
}

// ── BulkLoadableSource ───────────────────────────────────────────────────────

/**
 * The in-memory weather data handed to the routing algorithm.
 * Produced by BulkLoadableSource.loadForRouting().
 */
export interface RoutingData {
  /** Wind + wave provider, synchronous O(1) lookups, ready for isochrone. */
  readonly wind: WindProvider;
  /** Ocean current provider; null when no current data is available. */
  readonly current: CurrentProvider | null;
  /** Spatial and temporal extent of the loaded data. */
  readonly coverage: SourceCoverage & { readonly bbox: BoundingBox };
}

/**
 * A ForecastSource that can also be bulk-loaded into memory for use by the
 * routing algorithm.
 *
 * Only sources backed by a pre-fetched spatial grid implement this —
 * currently GRIB files. HTTP API sources cannot satisfy the synchronous
 * lookup contract required by the isochrone algorithm and therefore only
 * implement ForecastSource.
 *
 * Check with isBulkLoadable() before calling loadForRouting().
 */
export interface BulkLoadableSource extends ForecastSource {
  /**
   * Load weather data into memory and return the routing-layer interfaces
   * (WindProvider / CurrentProvider) that the isochrone algorithm accepts.
   *
   * @param enabledPaths  Optional allowlist — for GRIB sources, the file
   *                      paths to include. Absent means all available files.
   */
  loadForRouting(enabledPaths?: string[]): Promise<RoutingData>;
}

// ── Type guard ────────────────────────────────────────────────────────────────

/** Narrow a ForecastSource to BulkLoadableSource at runtime. */
export function isBulkLoadable(src: ForecastSource): src is BulkLoadableSource {
  return 'loadForRouting' in src;
}
