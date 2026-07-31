/**
 * Windy internal API — reverse-engineered types.
 *
 * Discovered by inspecting network traffic and index.js (v50.1.2) from www.windy.com.
 * All API calls require a session token obtained via auth.ts.
 *
 * Transport quirks (see forecast.ts / auth.ts for implementation):
 *   - Point forecast URL paths are base64-encoded (anti-scraping).
 *   - Point forecast response bodies are base64-encoded JSON.
 *   - Tile images are plain JPEG, no auth required.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Geographic position. */
export interface LatLon {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Response from account.windy.com/api/info */
export interface WindyAuthResponse {
  message: string;
  /** false = anonymous session, true = logged-in user */
  auth: boolean;
  /** JWT valid for 48 h. Payload: { magic: number, iat: number, exp: number } */
  token: string;
  userInfo: { requiresCookieConsent: boolean; [key: string]: unknown };
}

// ---------------------------------------------------------------------------
// Minifest — describes the current model run
// ---------------------------------------------------------------------------

/**
 * Returned by node.windy.com/metadata/v1.0/forecast/{model}/minifest.json
 * No auth required.
 */
export interface WindyMinifest {
  /** Time steps: each entry is [stepHours, firstHour, lastHour] */
  dst: [number, number, number][];
  /** Compact model-run id, e.g. "2026071900". Not used directly; use `ref`. */
  info: string;
  /** ISO timestamp of the model run reference time. Use this in tile URLs. */
  ref: string;
  /** ISO timestamp of the last data update on the server. */
  update: string;
  /** ISO timestamp of the last valid forecast time available. */
  end: string;
  /** Minifest format version, e.g. "2.4" */
  v: string;
  urls: {
    /** City-tile endpoint (forecast overlaid on map grid squares). */
    citytile: string;
    /** Point forecast endpoint — append /{lat}/{lon}?... */
    pointForecast: string;
    /** Image tile server base URL — append /{modelRun}/{validTime}/wm_grid_257/{z}/{x}/{y}/... */
    imageServer: string;
  };
}

// ---------------------------------------------------------------------------
// Supported models and overlays
// ---------------------------------------------------------------------------

/**
 * Model descriptors — the single source of truth for model IDs.
 *
 * Two different IDs exist per model (Windy's own split):
 *   minifestId   used in: metadata URL, tile imageServer URL
 *   forecastId   used in: point forecast URL path segments
 *
 * Always access via the WINDY_MODELS map — never hardcode the strings.
 */
export interface WindyModelInfo {
  /** Human-readable name. */
  name: string;
  /** ID used in metadata and tile URLs, e.g. "ecmwf-hres". */
  minifestId: string;
  /** ID used in point forecast URL segments, e.g. "ecmwf". */
  forecastId: string;
  /** Approximate grid resolution, km. */
  resolutionKm: number;
  /** Max forecast horizon in hours (free tier). */
  freeTierHours: number;
  /** Max forecast horizon in hours (premium). */
  premiumHours: number;
  /** Whether a point forecast API exists (false for ocean-only models). */
  hasPointForecast: boolean;
  /** Whether this model covers ocean variables only. */
  oceanOnly: boolean;
  /**
   * Maximum tile zoom level the Windy UI renders for free-tier users.
   * Note: the CDN does NOT enforce this — z=4 tiles exist and are served
   * even without a premium token. The limit is client-side only.
   */
  maxZoomFree: number;
  /**
   * Maximum tile zoom level the CDN actually has tiles for.
   * Above this, the server returns 400.
   */
  maxZoomPremium: number;
}

/**
 * All models Windy supports, keyed by a stable short name.
 *
 * Zoom level notes (verified against live CDN 2026-07-31):
 *   z=3: ~17 km/pixel at equator, ~45° per tile — all models
 *   z=4: ~8.5 km/pixel, ~22.5° per tile — matches ECMWF 9 km native grid
 *   z=5+: only available for high-res regional models (HRRR, ICON-D2, UKV…)
 *
 * The free/premium zoom distinction is enforced ONLY in the Windy web client.
 * The CDN serves any tile that exists regardless of auth status.
 */
export const WINDY_MODELS = {
  ecmwf: {
    name: "ECMWF HRES",
    minifestId: "ecmwf-hres",
    forecastId: "ecmwf",
    resolutionKm: 9,
    freeTierHours: 141,
    premiumHours: 360,
    hasPointForecast: true,
    oceanOnly: false,
    maxZoomFree: 3,
    maxZoomPremium: 4,      // CDN confirmed: z=4→200, z=5→400
  },
  gfs: {
    name: "GFS",
    minifestId: "gfs",
    forecastId: "gfs",
    resolutionKm: 22,
    freeTierHours: 141,
    premiumHours: 360,
    hasPointForecast: true,
    oceanOnly: false,
    maxZoomFree: 3,
    maxZoomPremium: 3,      // CDN confirmed: z=3→200, z=4→400
  },
  icon: {
    name: "ICON",
    minifestId: "icon",
    forecastId: "icon",
    resolutionKm: 13,
    freeTierHours: 141,
    premiumHours: 360,
    hasPointForecast: true,
    oceanOnly: false,
    maxZoomFree: 3,
    maxZoomPremium: 3,
  },
  cmems: {
    name: "CMEMS",
    minifestId: "cmems",
    forecastId: "cmems",
    resolutionKm: 9,
    freeTierHours: 72,
    premiumHours: 72,
    hasPointForecast: false,
    oceanOnly: true,
    maxZoomFree: 3,
    maxZoomPremium: 4,      // UI renders z=3, but CDN confirmed: z=4→200
  },
  ecmwfWam: {
    name: "ECMWF WAM",
    minifestId: "ecmwf-wam",
    forecastId: "ecmwfWaves",
    resolutionKm: 14,
    freeTierHours: 141,
    premiumHours: 360,
    hasPointForecast: true,
    oceanOnly: true,
    maxZoomFree: 3,
    maxZoomPremium: 4,      // CDN confirmed: z=4→200, z=5→400
  },
} as const satisfies Record<string, WindyModelInfo>;

export type WindyModelKey = keyof typeof WINDY_MODELS;

/**
 * Overlay → tile metadata.
 *
 *   filename    file stem in tile URL: `{filename}-{level}.{format}`
 *   format      tile image format: "jpg" (JPEG, weather) or "png" (PNG+alpha, waves/ocean)
 *   vectorField R=U, G=V two-component vector (wind, currents)
 *   waveField   R=period_U, G=period_V, B=height — three-component wave encoding
 *   oceanOnly   overlay only has data over ocean
 *   model       default model key for this overlay (auto-selected by the client)
 */
export const WINDY_OVERLAYS = {
  wind:         { filename: "wind",             format: "jpg", vectorField: true,  waveField: false, oceanOnly: false, model: "ecmwf"    },
  gust:         { filename: "gust",             format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  temp:         { filename: "temp",             format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  rain:         { filename: "rain",             format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  rainAccu:     { filename: "rainAccu",         format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  snowAccu:     { filename: "snowAccu",         format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  clouds:       { filename: "clouds",           format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  lclouds:      { filename: "lclouds",          format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  mclouds:      { filename: "mclouds",          format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  hclouds:      { filename: "hclouds",          format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  pressure:     { filename: "pressure",         format: "jpg", vectorField: false, waveField: false, oceanOnly: false, model: "ecmwf"    },
  waves:        { filename: "waves",            format: "png", vectorField: false, waveField: true,  oceanOnly: true,  model: "ecmwfWam" },
  swell1:       { filename: "swell1",           format: "png", vectorField: false, waveField: true,  oceanOnly: true,  model: "ecmwfWam" },
  swell2:       { filename: "swell2",           format: "png", vectorField: false, waveField: true,  oceanOnly: true,  model: "ecmwfWam" },
  currents:     { filename: "seacurrents",      format: "jpg", vectorField: true,  waveField: false, oceanOnly: true,  model: "cmems"    },
  currentsTide: { filename: "seacurrents_tide", format: "jpg", vectorField: true,  waveField: false, oceanOnly: true,  model: "cmems"    },
  sst:          { filename: "sst",              format: "png", vectorField: false, waveField: false, oceanOnly: true,  model: "cmems"    },
} as const;

export type WindyOverlay = keyof typeof WINDY_OVERLAYS;

/** Altitude levels available for upper-atmosphere parameters. */
export type WindyLevel =
  | "surface"
  | "100m"
  | "975h" | "950h" | "925h" | "900h" | "850h" | "800h"
  | "700h" | "600h" | "500h" | "400h" | "300h" | "250h" | "200h" | "150h" | "10h";

// ---------------------------------------------------------------------------
// Point forecast response
// ---------------------------------------------------------------------------

/** Metadata block at the top of every point forecast response. */
export interface WindyForecastHeader {
  model: string;
  /** ISO reference time of the model run. */
  refTime: string;
  /** ISO timestamp of the server's last data ingest. */
  update: string;
  updateTs: number;
  /** Terrain elevation at the queried point, metres. */
  elevation: number;
  /** Forecast time step in hours (3 for standard, 1 for premium hourly). */
  step: number;
  /** UTC offset of the local timezone in hours. */
  utcOffset: number;
  tzName: string;
  sunsetTs: number;
  sunriseTs: number;
  hasWaves: boolean;
  /** Number of forecast days available (up to 15 with premium). */
  daysAvail: number;
  /** Model's terrain elevation at the nearest grid point, metres. */
  modelElevation: number;
}

/** Sun/moon info at the queried location. */
export interface WindyCelestial {
  sunsetTs: number;
  sunriseTs: number;
  duskTs: number;
  isDay: boolean;
  /** 1 if the point is over the sea. */
  atSea: number;
  TZname: string;
  TZoffset: number;
  TZoffsetMin: number;
  TZoffsetFormatted: string;
  TZabbrev: string;
  TZtype: string;
  /** ISO local time string of the observation moment. */
  nowObserved: string;
  /** Local sunset time, e.g. "21:42". */
  sunset: string;
  /** Local sunrise time, e.g. "5:11". */
  sunrise: string;
  dusk: string;
  night: null | unknown;
}

/** Daily summary entry (one per calendar day). */
export interface WindyDailySummary {
  icon: number;
  date: string;
  index: number;
  /** Unix ms timestamp of local midnight. */
  timestamp: number;
  weekday: string;
  day: number;
  /** Max temperature in Kelvin. */
  tempMax: number;
  /** Min temperature in Kelvin. */
  tempMin: number;
  /** Representative wind speed in m/s. */
  wind: number;
  /** Representative wind direction in degrees. */
  windDir: number;
  /** Number of 3-hour segments in this day. */
  segments: number;
}

/**
 * Parallel arrays — all indexed by forecast step.
 * Arrays always have the same length (number of forecast steps returned).
 */
export interface WindyForecastData {
  /** Date string per step, e.g. "2026-07-19". */
  day: string[];
  /** Local hour per step. */
  hour: number[];
  /** Unix ms timestamps. */
  ts: number[];
  /** Day fraction that is daylight (0–1). */
  isDay: number[];
  moonPhase: number[];
  /** Weather icon index. */
  icon: number[];
  /** Total precipitation, mm per step interval. */
  mm: number[];
  snowPrecip: number[];
  /** Convective precipitation, mm. */
  convPrecip: number[];
  /** Rain flag (1 = raining). */
  rain: number[];
  /** Snow flag. */
  snow: number[];
  /** Temperature, Kelvin. Subtract 273.15 for °C. */
  temp: number[];
  /** Dew point, Kelvin. */
  dewPoint: number[];
  /** Wind speed, m/s. Multiply by 1.944 for knots. */
  wind: number[];
  /** Wind direction, degrees true. */
  windDir: number[];
  /** Relative humidity, %. */
  rh: number[];
  /** Wind gust speed, m/s. */
  gust: number[];
  /** Atmospheric pressure, Pa. Divide by 100 for hPa. */
  pressure: number[];
  /** Cloud base, metres. Null when sky is clear. */
  cbase: (number | null)[];
}

/** Top-level response from the point forecast endpoint. */
export interface WindyPointForecastResponse {
  header: WindyForecastHeader;
  celestial: WindyCelestial;
  /** Keyed by date string, e.g. "2026-07-19". */
  summary: Record<string, WindyDailySummary>;
  data: WindyForecastData;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/**
 * Scale/offset parameters decoded from the 8-row header embedded in each
 * forecast tile (265×257 pixels; first 8 rows are metadata, both JPEG and PNG).
 *
 * The header stores 7 float32 values: [Rmin, Rmax, Gmin, Gmax, Bmin, Bmax, ?]
 * Step = (max - min) / 255. Physical value = pixel * step + min.
 *
 * Channel usage depends on the overlay:
 *   Vector (wind, currents):  R=U (east),     G=V (north),  B unused
 *   Wave (waves, swell):      R=period_U,     G=period_V,   B=height (metres)
 *   Scalar (temp, rain…):     R=value,        G,B unused
 */
export interface WindyTileHeader {
  decoderRstep: number;
  decoderRmin: number;
  decoderGstep: number;
  decoderGmin: number;
  /** B-channel scale (wave height, m per DN). Zero when B is unused. */
  decoderBstep: number;
  /** B-channel offset (wave height min). Zero when B is unused. */
  decoderBmin: number;
}

/** Decoded meteorological values at a single tile pixel. */
export interface WindyTilePixelValue {
  /** R-channel decoded value. Wind: east component (m/s). Wave: period_U. Scalar: the value itself. */
  u: number;
  /** G-channel decoded value. Wind: north component (m/s). Wave: period_V. */
  v: number;
  /** Magnitude of (u, v). Wind/current speed (m/s). Wave: total period (s). */
  speed: number;
  /** Bearing from north, degrees true. Wind: direction wind is blowing TO. Wave: propagation direction. */
  direction: number;
  /** B-channel decoded value. Wave: significant wave height (m). Zero for non-wave overlays. */
  height: number;
  /** False if the pixel is land / no data (alpha=0 for PNG, B≈255 for CMEMS JPEG). */
  hasData: boolean;
}
