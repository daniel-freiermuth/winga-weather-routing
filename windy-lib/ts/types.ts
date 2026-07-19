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
}

/** All models Windy supports, keyed by a stable short name. */
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
  },
} as const satisfies Record<string, WindyModelInfo>;

export type WindyModelKey = keyof typeof WINDY_MODELS;

/**
 * Overlay → tile metadata.
 * Use `WINDY_OVERLAYS[key].filename` for the stem in tile URLs.
 * `vectorField: true` means R=U (east), G=V (north) channels.
 * `oceanOnly: true`  means the overlay requires the cmems model.
 */
export const WINDY_OVERLAYS = {
  wind:         { filename: "wind",             vectorField: true,  oceanOnly: false },
  gust:         { filename: "gust",             vectorField: false, oceanOnly: false },
  temp:         { filename: "temp",             vectorField: false, oceanOnly: false },
  rain:         { filename: "rain",             vectorField: false, oceanOnly: false },
  rainAccu:     { filename: "rainAccu",         vectorField: false, oceanOnly: false },
  snowAccu:     { filename: "snowAccu",         vectorField: false, oceanOnly: false },
  clouds:       { filename: "clouds",           vectorField: false, oceanOnly: false },
  lclouds:      { filename: "lclouds",          vectorField: false, oceanOnly: false },
  mclouds:      { filename: "mclouds",          vectorField: false, oceanOnly: false },
  hclouds:      { filename: "hclouds",          vectorField: false, oceanOnly: false },
  pressure:     { filename: "pressure",         vectorField: false, oceanOnly: false },
  waves:        { filename: "waves",            vectorField: true,  oceanOnly: false },
  swell1:       { filename: "swell1",           vectorField: true,  oceanOnly: false },
  swell2:       { filename: "swell2",           vectorField: true,  oceanOnly: false },
  currents:     { filename: "seacurrents",      vectorField: true,  oceanOnly: true  },
  currentsTide: { filename: "seacurrents_tide", vectorField: true,  oceanOnly: true  },
  sst:          { filename: "sst",              vectorField: false, oceanOnly: true  },
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
 * forecast JPEG tile (265×257 pixels total; first 8 rows are metadata).
 *
 * Physical value = pixel_channel / 255 * (255 * step) + min
 *               = pixel_channel * step + min
 *
 * For vector fields (wind, currents):
 *   U (east)  = R * decoderRstep + decoderRmin
 *   V (north) = G * decoderGstep + decoderGmin
 *   speed     = sqrt(U² + V²)
 */
export interface WindyTileHeader {
  /** Scale factor for the R channel (m/s per DN). */
  decoderRstep: number;
  /** Offset for the R channel (physical value at pixel=0). */
  decoderRmin: number;
  /** Scale factor for the G channel (m/s per DN). */
  decoderGstep: number;
  /** Offset for the G channel. */
  decoderGmin: number;
}

/** Decoded meteorological values at a single tile pixel. */
export interface WindyTilePixelValue {
  /** East component, m/s (U). Also the scalar value for non-vector fields. */
  u: number;
  /** North component, m/s (V). Zero for scalar fields. */
  v: number;
  /** Magnitude. For scalars equals |u|. */
  speed: number;
  /** Bearing from north, degrees true. */
  direction: number;
  /** False if the pixel is land or outside model coverage (B channel ≈ 255 for CMEMS). */
  hasData: boolean;
}
