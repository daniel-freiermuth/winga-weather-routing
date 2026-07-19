// SignalKWeatherSource: ForecastSource backed by the SignalK Weather API v2.
//
// Queries GET /signalk/v2/api/weather/forecasts/point?lat=…&lon=…&count=…
// Any installed weather provider plugin (SMHI, Open-Meteo, OpenWeather, GRIB
// provider, etc.) is selectable via the optional providerId.
//
// This source only implements ForecastSource (async point queries).
// It cannot implement BulkLoadableSource because the Weather API does not
// expose a spatial grid — only individual point forecasts — which is
// incompatible with the synchronous O(1) lookup contract the routing
// algorithm requires.
//
// Typical use: planning view endpoint that returns weather at each waypoint
// of a fixed route at its estimated arrival time.

import type { WindVector } from '../types';
import type { ForecastPoint, ForecastSource, SourceCoverage } from './weather-source';

// Shape of a single entry returned by the SK Weather API v2.
// Only the fields this plugin consumes are typed; the full spec has more.
interface SkForecastEntry {
  time?: string; // ISO 8601
  wind?: {
    direction?: number; // degrees true, meteorological (FROM)
    speed?: number;     // m/s
    gust?: number;      // m/s
  };
  waves?: {
    significantHeight?: number; // m
    direction?: number;
    period?: number;
  };
  // SK spec also has temperature, pressure, humidity, etc. — unused here.
}

function skEntryToForecastPoint(entry: SkForecastEntry): ForecastPoint | null {
  const timeMs = entry.time !== undefined ? new Date(entry.time).getTime() : NaN;
  if (isNaN(timeMs)) return null;

  let wind: WindVector | undefined;
  if (entry.wind?.speed !== undefined && entry.wind.direction !== undefined) {
    // Meteorological convention: direction = FROM. Convert to u/v (m/s).
    const rad = (entry.wind.direction * Math.PI) / 180;
    wind = {
      u: -entry.wind.speed * Math.sin(rad), // eastward component
      v: -entry.wind.speed * Math.cos(rad), // northward component
    };
  }

  return {
    timeMs,
    ...(wind !== undefined && { wind }),
    ...(entry.waves?.significantHeight !== undefined && {
      waveHeightM: entry.waves.significantHeight,
    }),
  };
}

export class SignalKWeatherSource implements ForecastSource {
  readonly id: string;
  readonly name: string;

  /**
   * @param baseUrl    Root URL of the SignalK server, e.g. 'http://localhost:3000'.
   * @param providerId Optional — selects a specific installed weather provider.
   *                   Absent means the server's default provider is used.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly providerId?: string,
  ) {
    this.id = providerId !== undefined ? `signalk-weather-${providerId}` : 'signalk-weather';
    this.name =
      providerId !== undefined ? `SignalK Weather (${providerId})` : 'SignalK Weather API';
  }

  async coverage(): Promise<SourceCoverage> {
    // The Weather API v2 has no coverage endpoint. Return a conservative
    // estimate: standard 7-day forecast from now.
    return Promise.resolve({
      timeRange: {
        startMs: Date.now(),
        endMs: Date.now() + 7 * 24 * 3_600_000,
      },
    });
  }

  async queryPoint(
    lat: number,
    lon: number,
    fromMs: number,
    toMs: number,
  ): Promise<ForecastPoint[]> {
    // Map the time window to a count of hourly forecast steps.
    const windowHours = Math.ceil((toMs - fromMs) / 3_600_000);
    // Add a few extra entries so the fromMs offset is always covered.
    const count = Math.max(windowHours + 3, 6);

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      count: String(count),
    });
    if (this.providerId !== undefined) {
      params.set('provider', this.providerId);
    }

    const url = `${this.baseUrl}/signalk/v2/api/weather/forecasts/point?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SignalK Weather API ${String(res.status)}: ${url}`);
    }

    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) {
      throw new Error(`SignalK Weather API: expected array, got ${typeof raw}`);
    }

    return (raw as unknown[])
      .filter((e): e is SkForecastEntry => typeof e === 'object' && e !== null)
      .map(skEntryToForecastPoint)
      .filter((p): p is ForecastPoint => p !== null && p.timeMs >= fromMs && p.timeMs <= toMs)
      .sort((a, b) => a.timeMs - b.timeMs);
  }
}
