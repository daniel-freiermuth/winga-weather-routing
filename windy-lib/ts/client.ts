/**
 * WindyClient — high-level entry point for the Windy internal API.
 *
 * Handles token refresh, minifest caching, and request encoding.
 * Construct once; call repeatedly.
 *
 * @example
 * const windy = new WindyClient();
 *
 * // Weather forecast at a position (wind, gust, temp, rain, pressure…):
 * const wx = await windy.getForecastFor({ lat: 54.32, lon: 10.13 });
 * const windKt = wx.data.wind[0]! * 1.944;
 *
 * // Tile URL for a Leaflet/MapLibre map layer (no auth needed):
 * const url = await windy.getForecastTile(3, 4, 2, "wind");
 * L.tileLayer(url).addTo(map);   // url has {z}/{x}/{y} replaced by 3/4/2
 * // … or get a reusable template:
 * const { leafletTemplate } = await windy.getTileInfo("wind");
 *
 * // Ocean current at a waypoint:
 * import { browserRgbaDecoder } from "./tiles.js";
 * const cur = await windy.sampleAtPosition({ lat: 54.32, lon: 10.13 }, "currents", { rgbaDecoder: browserRgbaDecoder });
 * console.log(`${(cur.speed * 1.944).toFixed(2)} kt from ${cur.direction.toFixed(0)}°`);
 */

import { fetchWindyToken, loginWindy, tokenExpiresSoon } from "./auth.js";
import { fetchMinifest, refToCompact, getValidTimes } from "./minifest.js";
import { fetchPointForecast } from "./forecast.js";
import {
  buildTileUrl,
  latLonToTile,
  latLonToPixel,
  decodeTileHeader,
  sampleTilePixel,
  type RgbaDecoder,
} from "./tiles.js";
import {
  WINDY_MODELS,
  WINDY_OVERLAYS,
  type LatLon,
  type WindyModelKey,
  type WindyOverlay,
  type WindyLevel,
  type WindyMinifest,
  type WindyPointForecastResponse,
  type WindyTilePixelValue,
} from "./types.js";
export type { RgbaDecoder };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WindyClientOptions {
  /**
   * Country code for the anonymous token request. Default: `"SE"`.
   * Irrelevant when `credentials` is provided (login flow is used instead).
   */
  country?: string;
  /**
   * Stable device UUID. Generate once with `crypto.randomUUID()` and persist.
   * Omitting it creates a fresh identity on every `WindyClient` construction.
   */
  uid?: string;
  /**
   * Windy account credentials for premium access (15-day extended forecast).
   * When provided, `WindyClient` uses the three-step login flow instead of
   * the anonymous token flow, and sets `premium: true` automatically.
   *
   * @example
   * const windy = new WindyClient({
   *   credentials: { email: "me@example.com", password: "MyPass123" },
   *   uid: "stored-uuid",
   * });
   * const wx = await windy.getForecastFor({ lat: 54.32, lon: 10.13 });
   * // wx.header.daysAvail === 15
   */
  credentials?: { email: string; password: string };
}

/** Full tile metadata — use when you need animation or map-layer templates. */
export interface TileInfo {
  /**
   * Leaflet / MapLibre URL template pointing at the closest-to-now forecast step.
   * @example L.tileLayer(info.leafletTemplate, { tileSize: 257 }).addTo(map);
   */
  leafletTemplate: string;
  /** Build a URL for an explicit tile coordinate. */
  tileUrl: (z: number, x: number, y: number) => string;
  /** Compact model run time, e.g. `"2026071900"`. */
  modelRun: string;
  /** All available forecast valid-time compact strings. */
  validTimes: string[];
  /** One Leaflet template per forecast step — ready for a time-slider animation. */
  animationTemplates: string[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class WindyClient {
  private readonly country: string;
  private readonly uid: string;
  private readonly premium: boolean;
  private readonly credentials: { email: string; password: string } | undefined;

  private token: string | null = null;
  private manifests = new Map<string, { fetched: number; data: WindyMinifest }>();

  constructor(opts: WindyClientOptions = {}) {
    this.country = opts.country ?? "SE";
    this.uid = opts.uid ?? crypto.randomUUID();
    this.credentials = opts.credentials;
    this.premium = opts.credentials !== undefined;
  }

  // ── Infrastructure ──────────────────────────────────────────────────────

  /** Return a valid token, refreshing automatically 5 min before expiry. */
  async getToken(): Promise<string> {
    if (this.token === null || tokenExpiresSoon(this.token)) {
      if (this.credentials !== undefined) {
        const { accessToken } = await loginWindy(this.credentials);
        this.token = accessToken;
      } else {
        const { token } = await fetchWindyToken(this.country);
        this.token = token;
      }
    }
    return this.token;
  }

  /** Return a cached minifest, re-fetching after 10 min. */
  async getMinifest(modelKey: WindyModelKey): Promise<WindyMinifest> {
    const { minifestId } = WINDY_MODELS[modelKey];
    const cached = this.manifests.get(minifestId);
    if (cached !== undefined && Date.now() - cached.fetched < 10 * 60 * 1000) {
      return cached.data;
    }
    const data = await fetchMinifest(minifestId);
    this.manifests.set(minifestId, { fetched: Date.now(), data });
    return data;
  }


  /**
   * Fetch a weather forecast for a position.
   *
   * Returns **all** variables in one call — temperature (K), wind (m/s), gust,
   * direction (°), precipitation (mm), pressure (Pa), humidity (%), cloud base
   * — at 3-hour steps for up to ~6 days (free tier).
   * No `type` parameter: filter the returned arrays in the caller.
   *
   * @param position  `{ lat, lon }` in decimal degrees.
   * @param model     NWP model. Defaults to `"ecmwf"`. Not applicable to `"cmems"`
   *                  (ocean currents have no point forecast — use `sampleAtPosition`).
   *
   * @example
   * const wx = await windy.getForecastFor({ lat: 54.32, lon: 10.13 });
   * const windKt  = wx.data.wind[0]!  * 1.944;   // m/s → knots
   * const tempC   = wx.data.temp[0]!  - 273.15;   // K → °C
   * const gustKt  = wx.data.gust[0]!  * 1.944;
   * const rainMm  = wx.data.mm[0]!;
   * const dir     = wx.data.windDir[0]!;           // degrees true
   */
  async getForecastFor(
    position: LatLon,
    model: Exclude<WindyModelKey, "cmems"> = "ecmwf"
  ): Promise<WindyPointForecastResponse> {
    const [token, minifest] = await Promise.all([
      this.getToken(),
      this.getMinifest(model),
    ]);
    return fetchPointForecast(position.lat, position.lon, model, {
      token,
      uid: this.uid,
      refTime: minifest.ref,
      premium: this.premium,
    });
  }

  // ── Tiles ────────────────────────────────────────────────────────────────

  /**
   * Return a single tile URL for map display.
   *
   * Tiles need **no authentication** and are served from a CDN.
   * The URL points at the closest-to-now available forecast step.
   *
   * `model` is inferred from the overlay when unambiguous:
   *   - ocean overlays (`currents`, `currentsTide`, `sst`) → `"cmems"`
   *   - all other overlays → `"ecmwf"`
   *
   * @param z        Zoom level (max 3 for all free-tier models and CMEMS).
   * @param x        Tile column.
   * @param y        Tile row.
   * @param overlay  Which variable: `"wind"`, `"temp"`, `"currents"`, etc.
   * @param model    Override the model. Rarely needed.
   *
   * @example
   * // Leaflet — fetch one specific tile:
   * const url = await windy.getForecastTile(3, 4, 2, "wind");
   * // → "https://ims.windy.com/.../2026071900/2026071909/wm_grid_257/3/4/2/wind-surface.jpg"
   *
   * // Better for a full layer: use getTileInfo() which gives a {z}/{x}/{y} template.
   */
  async getForecastTile(
    z: number,
    x: number,
    y: number,
    overlay: WindyOverlay,
    model?: WindyModelKey
  ): Promise<string> {
    const overlayInfo = WINDY_OVERLAYS[overlay];
    const modelKey: WindyModelKey = model ?? overlayInfo.model;
    const modelInfo = WINDY_MODELS[modelKey];

    const minifest = await this.getMinifest(modelKey);
    const modelRun = refToCompact(minifest.ref);
    const steps = getValidTimes(minifest);
    const now = Date.now();
    const step = steps.findLast((s) => new Date(s.iso).getTime() <= now) ?? steps[0]!;

    return buildTileUrl(modelInfo.minifestId, modelRun, step.compact, z, x, y, overlayInfo.filename, "surface", overlayInfo.format);
  }

  /**
   * Full tile metadata — Leaflet/MapLibre templates, animation frames, and
   * a `tileUrl` function for direct fetching. Use this when you need more
   * than a single URL (time-slider, tile decoding, custom rendering).
   *
   * `model` defaults the same way as `getForecastTile`.
   *
   * @example
   * const { leafletTemplate } = await windy.getTileInfo("wind");
   * L.tileLayer(leafletTemplate, { tileSize: 257, opacity: 0.7 }).addTo(map);
   *
   * // Ocean currents layer:
   * const { leafletTemplate } = await windy.getTileInfo("currents");
   *
   * // All forecast steps for animation:
   * const { animationTemplates, validTimes } = await windy.getTileInfo("wind");
   */
  async getTileInfo(
    overlay: WindyOverlay,
    model?: WindyModelKey,
    level: WindyLevel = "surface"
  ): Promise<TileInfo> {
    const overlayInfo = WINDY_OVERLAYS[overlay];
    const modelKey: WindyModelKey = model ?? overlayInfo.model;
    const modelInfo = WINDY_MODELS[modelKey];

    const minifest = await this.getMinifest(modelKey);
    const modelRun = refToCompact(minifest.ref);
    const steps = getValidTimes(minifest);
    const validTimes = steps.map((s) => s.compact);

    const now = Date.now();
    const currentStep = steps.findLast((s) => new Date(s.iso).getTime() <= now) ?? steps[0]!;

    const makeTemplate = (validTime: string): string =>
      buildTileUrl(modelInfo.minifestId, modelRun, validTime, 0, 0, 0, overlayInfo.filename, level, overlayInfo.format)
        .replace("/0/0/0/", "/{z}/{x}/{y}/");

    const tileUrl = (z: number, x: number, y: number): string =>
      buildTileUrl(modelInfo.minifestId, modelRun, currentStep.compact, z, x, y, overlayInfo.filename, level, overlayInfo.format);

    return {
      leafletTemplate: makeTemplate(currentStep.compact),
      tileUrl,
      modelRun,
      validTimes,
      animationTemplates: validTimes.map(makeTemplate),
    };
  }

  /**
   * Sample the value of an overlay at a specific position by fetching and
   * decoding the covering tile.
   *
   * Primary use case: **ocean currents** (CMEMS has no point forecast API —
   * this is the only way to get current speed/direction at a coordinate).
   * For weather variables, prefer `getForecastFor` which is more accurate.
   *
   * Requires an `RgbaDecoder`. Two options:
   *   `browserRgbaDecoder` — uses OffscreenCanvas; works in browsers/Deno.
   *   Node.js with sharp:
   *     ```ts
   *     const decoder: RgbaDecoder = async (url) => {
   *       const buf = await fetch(url).then(r => r.arrayBuffer());
   *       const { data } = await sharp(Buffer.from(buf))
   *         .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
   *       return new Uint8Array(data.buffer);
   *     };
   *     ```
   *
   * @example
   * import { browserRgbaDecoder } from "./tiles.js";
   * const cur = await windy.sampleAtPosition(
   *   { lat: 54.32, lon: 10.13 }, "currents", { rgbaDecoder: browserRgbaDecoder }
   * );
   * console.log(`${(cur.speed * 1.944).toFixed(2)} kt from ${cur.direction.toFixed(0)}°`);
   */
  async sampleAtPosition(
    position: LatLon,
    overlay: WindyOverlay,
    opts: {
      rgbaDecoder: RgbaDecoder;
      model?: WindyModelKey;
      level?: WindyLevel;
      /**
       * Zoom level for the covering tile.
       * Defaults to the model's maxZoomPremium (z=4 for ECMWF/CMEMS/WAM, z=3 for GFS).
       * The CDN does not enforce premium — these tiles are served to anyone.
       */
      zoom?: number;
    }
  ): Promise<WindyTilePixelValue> {
    const overlayInfo = WINDY_OVERLAYS[overlay];
    const modelKey: WindyModelKey = opts.model ?? overlayInfo.model;
    const modelInfo = WINDY_MODELS[modelKey];
    const { rgbaDecoder, level = "surface", zoom = modelInfo.maxZoomPremium } = opts;

    const minifest = await this.getMinifest(modelKey);
    const modelRun = refToCompact(minifest.ref);
    const steps = getValidTimes(minifest);
    const now = Date.now();
    const step = steps.findLast((s) => new Date(s.iso).getTime() <= now) ?? steps[0]!;

    const { x, y } = latLonToTile(position.lat, position.lon, zoom);
    const url = buildTileUrl(modelInfo.minifestId, modelRun, step.compact, zoom, x, y, overlayInfo.filename, level, overlayInfo.format);

    const rgba = await rgbaDecoder(url);
    const header = decodeTileHeader(rgba);
    const { px, py } = latLonToPixel(position.lat, position.lon, zoom, x, y);
    const isPng = overlayInfo.format === "png";
    return sampleTilePixel(rgba, header, px, py, modelInfo.oceanOnly, isPng);
  }
}
