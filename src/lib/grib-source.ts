// GribForecastSource: BulkLoadableSource backed by local GRIB2 files.
//
// Adapts the existing MultiFileWindProvider / SingleFileCurrentProvider pair
// (which the routing algorithm already depends on) into the ForecastSource /
// BulkLoadableSource abstraction without duplicating data or changing those
// classes.
//
// Lifecycle:
//   1. Construct with the plugin's live GribFileEntry / CurrentFileEntry arrays.
//   2. Call loadForRouting() once — or inject a pre-loaded windProvider — to
//      enable queryPoint(). The routing algorithm calls loadForRouting() before
//      starting isochrone expansion; the planning view endpoint can call
//      queryPoint() after that.

import type {
  BoundingBox,
  CurrentFileEntry,
  GribFileEntry,
  WindVector,
} from '../types';
import { MultiFileWindProvider } from './windprovider';
import { nearestIdx } from './geo';
import { SingleFileCurrentProvider } from './currentprovider';
import type {
  BulkLoadableSource,
  ForecastPoint,
  RoutingData,
  SourceCoverage,
} from './weather-source';

export class GribForecastSource implements BulkLoadableSource {
  readonly id = 'grib';
  readonly name = 'GRIB Files';

  // Set by loadForRouting(); used by queryPoint().
  private windProvider: MultiFileWindProvider | null = null;

  constructor(
    private readonly windFiles: GribFileEntry[],
    private readonly currentFiles: CurrentFileEntry[],
  ) {}

  /**
   * Inject an already-loaded MultiFileWindProvider — avoids redundant loading
   * when the routing engine has already built one.
   */
  setWindProvider(provider: MultiFileWindProvider): void {
    this.windProvider = provider;
  }

  async coverage(): Promise<SourceCoverage> {
    if (this.windFiles.length === 0) {
      return Promise.resolve({ timeRange: { startMs: 0, endMs: 0 } });
    }
    let startMs = Infinity;
    let endMs = -Infinity;
    let latMin = Infinity,
      latMax = -Infinity,
      lonMin = Infinity,
      lonMax = -Infinity;
    for (const f of this.windFiles) {
      const { meta } = f;
      if (meta.timeStart.getTime() < startMs) startMs = meta.timeStart.getTime();
      if (meta.timeEnd.getTime() > endMs) endMs = meta.timeEnd.getTime();
      if (meta.latMin < latMin) latMin = meta.latMin;
      if (meta.latMax > latMax) latMax = meta.latMax;
      if (meta.lonMin < lonMin) lonMin = meta.lonMin;
      if (meta.lonMax > lonMax) lonMax = meta.lonMax;
    }
    return Promise.resolve({
      timeRange: { startMs, endMs },
      bbox: { latMin, latMax, lonMin, lonMax },
    });
  }

  async queryPoint(
    lat: number,
    lon: number,
    fromMs: number,
    toMs: number,
  ): Promise<ForecastPoint[]> {
    if (!this.windProvider) {
      return Promise.reject(
        new Error('GribForecastSource: call loadForRouting() or setWindProvider() first'),
      );
    }
    const provider = this.windProvider;
    const points: ForecastPoint[] = [];
    for (const t of provider.times) {
      const ms = t.getTime();
      if (ms < fromMs || ms > toMs) continue;
      const idx = nearestIdx(provider.times, t);
      let wind: WindVector | undefined;
      let waveHeightM: number | undefined;
      if (provider.coversPointAtTime(lat, lon, idx)) {
        wind = provider.getWind(lat, lon, idx);
        waveHeightM = provider.getWave(lat, lon, t);
      }
      points.push({
        timeMs: ms,
        ...(wind !== undefined && { wind }),
        ...(waveHeightM !== undefined && { waveHeightM }),
      });
    }
    return Promise.resolve(points);
  }

  async loadForRouting(enabledPaths?: string[]): Promise<RoutingData> {
    // Only entries with data already lazy-loaded (via loadGrib()) are included.
    // Callers must load GRIB data before calling loadForRouting().
    const windFiles = (
      enabledPaths !== undefined
        ? this.windFiles.filter((f) => enabledPaths.includes(f.meta.path))
        : this.windFiles
    ).filter((f) => f.data !== null);

    if (windFiles.length === 0) {
      throw new Error('loadForRouting: no GRIB data loaded — call loadGrib() on entries first');
    }

    this.windProvider = new MultiFileWindProvider(windFiles);

    const loadedCurrent = this.currentFiles.find((f) => f.data !== null);
    const currentProvider =
      loadedCurrent !== undefined ? new SingleFileCurrentProvider(loadedCurrent) : null;

    const cov = await this.coverage();
    const bbox: BoundingBox = cov.bbox ?? {
      latMin: -90,
      latMax: 90,
      lonMin: -180,
      lonMax: 180,
    };

    return {
      wind: this.windProvider,
      current: currentProvider,
      coverage: { timeRange: cov.timeRange, bbox },
    };
  }
}
