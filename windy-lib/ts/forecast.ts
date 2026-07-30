/**
 * Windy point forecast API — reverse-engineered from index.js v50.1.2.
 *
 * HOW IT WORKS
 * ─────────────
 * The point forecast endpoint lives at node.windy.com but its URL path is
 * split into three base64-encoded segments (anti-scraping):
 *
 *   https://node.windy.com
 *     /{b64("forecast")}
 *     /{b64(model)}                   ← e.g. b64("ecmwf")
 *     /{b64("point/{model}/v2.9/{lat:.3f}/{lon:.3f}?{params}")}
 *
 * The response body is also base64-encoded JSON (content-type: text/plain).
 *
 * b64(s) = btoa(s) with trailing '=' stripped. Standard base64, NOT url-safe.
 *
 * PARAMS
 * ───────
 *   refTime  ISO timestamp from minifest.ref, e.g. "2026-07-19T00:00:00Z"
 *   step     3 for standard (3-hourly), 1 for premium hourly
 *   pr       1 if premium (enables extended forecast)
 *   sc       session counter (integer; server ignores exact value)
 *   token2   JWT from auth.ts
 *   uid      stable UUID you generate once and reuse
 *   v        Windy client version ("50.1.2")
 *   poc      page-open counter (integer; server ignores exact value)
 *   source   "detail"
 *   extended "true" for premium 15-day extended forecast
 *
 * SUPPORTED MODELS
 * ─────────────────
 *   ecmwf   ECMWF (runs at 00z/12z, 9 km, up to 15 days with premium)
 *   gfs     GFS NOAA (22 km)
 *   icon    ICON DWD (13 km)
 *
 * Note: CMEMS (ocean currents) has no working point forecast endpoint.
 * Current speed/direction at a point must be read from the tile pixel.
 *
 * UNITS IN RESPONSE
 * ──────────────────
 *   temp, dewPoint  Kelvin  → subtract 273.15 for °C
 *   wind, gust      m/s     → multiply by 1.944 for knots
 *   pressure        Pa      → divide by 100 for hPa
 *   mm              mm per step interval
 */

import type { WindyPointForecastResponse, WindyModelKey } from "./types.js";
import { WINDY_MODELS } from "./types.js";

const NODE_BASE = "https://node.windy.com";
const CLIENT_VERSION = "50.1.2";

/** base64 without padding, as expected by the server. */
function b64(s: string): string {
  return Buffer.from(s).toString("base64").replace(/=+$/, "");
}

export interface PointForecastOptions {
  /** JWT from fetchWindyToken(). */
  token: string;
  /** Stable UUID — generate once with crypto.randomUUID() and persist. */
  uid: string;
  /** ISO ref time from the minifest, e.g. "2026-07-19T00:00:00Z". */
  refTime: string;
  /** Forecast step in hours. 3 = standard 3-hourly; 1 = premium hourly. */
  step?: number;
  /** Set true to request the extended 15-day forecast (needs premium token). */
  premium?: boolean;
}

/**
 * Fetch a point forecast for a specific location and weather model.
 *
 * @example
 * const { token } = await fetchWindyToken();
 * const minifest  = await fetchMinifest("ecmwf-hres");
 * const uid       = crypto.randomUUID();
 *
 * const data = await fetchPointForecast(54.32, 10.13, "ecmwf", {
 *   token, uid, refTime: minifest.ref, premium: true,
 * });
 *
 * const windKt = data.data.wind[0]! * 1.944;
 * const dir    = data.data.windDir[0]!;
 */
export async function fetchPointForecast(
  lat: number,
  lon: number,
  model: Exclude<WindyModelKey, "cmems">,
  opts: PointForecastOptions
): Promise<WindyPointForecastResponse> {
  const { token, uid, refTime, step = 3, premium = false } = opts;

  const params = new URLSearchParams({
    refTime,
    source: "detail",
    step: String(step),
    pr: premium ? "1" : "0",
    sc: "1",
    token2: token,
    uid,
    v: CLIENT_VERSION,
    poc: "1",
    ...(premium ? { extended: "true" } : {}),
  });

  const { forecastId } = WINDY_MODELS[model];
  const inner = `point/${forecastId}/v2.9/${lat.toFixed(3)}/${lon.toFixed(3)}?${params}`;
  const url = `${NODE_BASE}/${b64("forecast")}/${b64(forecastId)}/${b64(inner)}`;

  const resp = await fetch(url, {
    headers: {
      Accept: "application/json binary/hcadae$indcd28",
      Origin: "https://www.windy.com",
      Referer: "https://www.windy.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
  });

  if (!resp.ok) throw new Error(`Point forecast failed: HTTP ${resp.status}`);

  // Response body is base64-encoded JSON (content-type: text/plain).
  const b64Body = await resp.text();
  const json = Buffer.from(b64Body, "base64").toString("utf8");
  return JSON.parse(json) as WindyPointForecastResponse;
}
