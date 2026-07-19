// WindyForecastSource: ForecastSource backed by the Windy internal API.
//
// Uses the reverse-engineered client in windy-lib to call the Windy point
// forecast endpoint (node.windy.com). All weather models supported by Windy
// are available: ecmwf (default, 9 km, up to 15 days with premium), gfs
// (22 km), icon (13 km). CMEMS ocean currents have no point forecast in the
// Windy API and are therefore not available through this source.
//
// Auth:
//   - Anonymous (no credentials): free tier, 3-hourly steps, ~6 days.
//   - Windy premium login: 1-hourly steps, up to 15 days.
//
// Wave data is NOT available via the Windy point forecast endpoint. The waves
// overlay exists as tile-only data. ForecastPoint.waveHeightM will always be
// undefined from this source.
//
// This source only implements ForecastSource (async point queries). It cannot
// implement BulkLoadableSource because Windy does not expose a spatial grid
// download — only individual point forecasts.

import type { WindyClientOptions, WindyModelKey } from '@signalk-weather-routing/windy-lib';
import { WINDY_MODELS, WindyClient } from '@signalk-weather-routing/windy-lib';
import type { WindVector } from '../types';
import type { ForecastPoint, ForecastSource, SourceCoverage } from './weather-source';

/** Models supported by the Windy point forecast endpoint. */
export type WindyForecastModel = Exclude<WindyModelKey, 'cmems'>;

export interface WindySourceOptions {
  /**
   * NWP model to use. Default: `'ecmwf'`.
   * Options: `'ecmwf'` (9 km), `'gfs'` (22 km), `'icon'` (13 km).
   */
  model?: WindyForecastModel;
  /**
   * Windy account credentials for premium access (1-hourly steps, 15 days).
   * Omit for anonymous access (3-hourly, ~6 days).
   */
  credentials?: { email: string; password: string };
  /**
   * Stable UUID for the Windy session. Generate once with crypto.randomUUID()
   * and persist across plugin restarts to avoid creating a new identity each time.
   */
  uid?: string;
}

export class WindyForecastSource implements ForecastSource {
  readonly id: string;
  readonly name: string;

  private readonly model: WindyForecastModel;
  private readonly isPremium: boolean;
  private readonly client: WindyClient;

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

  async coverage(): Promise<SourceCoverage> {
    // Fetch the current minifest to get the true forecast end time from the
    // server — more accurate than estimating from the nominal horizon hours.
    const minifest = await this.client.getMinifest(this.model);
    return {
      timeRange: {
        startMs: Date.now(),
        endMs: new Date(minifest.end).getTime(),
      },
      // No bbox — Windy has global coverage.
    };
  }

  async queryPoint(
    lat: number,
    lon: number,
    fromMs: number,
    toMs: number,
  ): Promise<ForecastPoint[]> {
    const response = await this.client.getForecastFor({ lat, lon }, this.model);

    const { ts, wind: windSpeed, windDir } = response.data;

    const points: ForecastPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const timeMs = ts[i];
      if (timeMs === undefined || timeMs < fromMs || timeMs > toMs) continue;

      const speed = windSpeed[i];
      const dir = windDir[i];

      let wind: WindVector | undefined;
      if (speed !== undefined && dir !== undefined) {
        // Windy windDir = meteorological FROM direction (degrees).
        // Convert to u/v (m/s): u = eastward, v = northward.
        const rad = (dir * Math.PI) / 180;
        wind = {
          u: -speed * Math.sin(rad),
          v: -speed * Math.cos(rad),
        };
      }

      points.push({
        timeMs,
        ...(wind !== undefined && { wind }),
        // waveHeightM intentionally absent — not available via point forecast.
      });
    }

    return points;
  }
}
