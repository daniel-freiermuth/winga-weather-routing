/**
 * windy-lib — reverse-engineered Windy internal API client.
 *
 * Discovered by inspecting network traffic and index.js (v50.1.2).
 * See individual modules for protocol documentation.
 *
 * QUICK START — use the high-level client
 * ─────────────────────────────────────────
 * import { WindyClient } from "./index.js";
 *
 * const windy = new WindyClient();
 *
 * // Point forecast (temp, wind, gust, rain…) at a location:
 * const wx = await windy.getWeather(54.32, 10.13);
 * const windKt = wx.data.wind[0]! * 1.944;
 *
 * // Tile URL for a Leaflet / MapLibre layer (no auth required):
 * const { tileUrl } = await windy.getTileInfo("ecmwf", "wind");
 * // use tileUrl(z, x, y) to form tile URLs
 *
 * // Ocean currents tile:
 * const { tileUrl } = await windy.getTileInfo("cmems", "currents");
 *
 * AVAILABLE MODELS
 * ─────────────────
 * import { WINDY_MODELS } from "./index.js";
 * // WINDY_MODELS.ecmwf  — ECMWF HRES 9 km, up to 15 days (premium)
 * // WINDY_MODELS.gfs    — GFS NOAA  22 km
 * // WINDY_MODELS.icon   — ICON DWD  13 km
 * // WINDY_MODELS.cmems  — CMEMS ocean currents, tile-only, 72 h
 *
 * AVAILABLE OVERLAYS
 * ───────────────────
 * import { WINDY_OVERLAYS } from "./index.js";
 * // WINDY_OVERLAYS.wind / gust / temp / rain / rainAccu / snowAccu
 * // WINDY_OVERLAYS.clouds / lclouds / mclouds / hclouds / pressure
 * // WINDY_OVERLAYS.waves / swell1 / swell2
 * // WINDY_OVERLAYS.currents / currentsTide / sst   ← ocean only (cmems)
 */

// High-level client — start here
export { WindyClient } from "./client.js";
export type { WindyClientOptions, TileInfo } from "./client.js";

// Models and overlays — the catalogues
export { WINDY_MODELS, WINDY_OVERLAYS } from "./types.js";
export type { LatLon, WindyModelKey, WindyModelInfo, WindyOverlay, WindyLevel } from "./types.js";

// Types — for typing your own code
export type {
  WindyAuthResponse,
  WindyMinifest,
  WindyForecastHeader,
  WindyCelestial,
  WindyDailySummary,
  WindyForecastData,
  WindyPointForecastResponse,
  WindyTileHeader,
  WindyTilePixelValue,
} from "./types.js";

// Low-level building blocks — use when you need more control
export { WINDY_CSRF, fetchWindyToken, loginWindy, tokenExpiresAt, tokenExpiresSoon } from "./auth.js";
export type { WindyCredentials, WindyLoginResponse } from "./auth.js";
export { fetchMinifest, refToCompact, getValidTimes } from "./minifest.js";
export type { PointForecastOptions } from "./forecast.js";
export { fetchPointForecast } from "./forecast.js";
export { buildTileUrl, latLonToTile, latLonToPixel, latLonToPixelFrac, decodeTileHeader, sampleTilePixel, sampleTileBilinear, browserRgbaDecoder } from "./tiles.js";
export type { RgbaDecoder } from "./tiles.js";
