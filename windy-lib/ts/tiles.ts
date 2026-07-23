/**
 * Windy tile system — reverse-engineered from index.js v50.1.2.
 *
 * TILE URL FORMAT
 * ────────────────
 * https://ims.windy.com/im/v3.0/forecast/{model}/{modelRun}/{validTime}/wm_grid_257/{z}/{x}/{y}/{filename}-{level}.jpg
 *
 *   model      model identifier, e.g. "ecmwf-hres", "cmems"
 *   modelRun   compact ISO of model run, e.g. "2026071900"
 *   validTime  compact ISO of forecast valid time, e.g. "2026071909"
 *   z/x/y      standard XYZ slippy-map tile coordinates
 *   filename   overlay file stem (see OVERLAY_FILENAMES in types.ts)
 *   level      altitude level, e.g. "surface", "850h"
 *
 * No authentication required. CDN-cached with max-age=86400.
 *
 * TILE BINARY FORMAT — JPEG, 265 × 257 PIXELS
 * ─────────────────────────────────────────────
 * The tile is a standard JFIF JPEG, but taller than the grid data:
 *
 *   Rows  0–7  (8 rows):   header — float32 rescale parameters, packed into pixels
 *   Rows  8–264 (257 rows): meteorological data — 257 × 257 pixel grid
 *
 * The grid is 257 × 257 because 257 = 2⁸ + 1, which tiles seamlessly (shared
 * edge pixels between adjacent tiles).
 *
 * HEADER ENCODING (rows 0–7)
 * ───────────────────────────
 * Each header pixel stores exactly 8 bits of a raw float32 byte stream:
 *
 *   byte = (round(R/64) << 6) | (round(G/16) << 2) | round(B/64)
 *          ↑ 2 bits from R    ↑ 4 bits from G       ↑ 2 bits from B
 *
 * 28 consecutive pixels → 28 bytes → reinterpret as 7 × Float32:
 *   [0] decoderRstep   R channel scale (physical units per DN)
 *   [1] decoderRmin    R channel offset (physical value at pixel=0)
 *   [2] decoderGstep   G channel scale
 *   [3] decoderGmin    G channel offset
 *   (indices 4–6 are additional metadata, usage unclear)
 *
 * The header pixels start at byte offset 8 within the first row's RGBA buffer
 * (i.e. pixel index 2, skipping 2 preamble pixels). All 8 rows are identical
 * (redundancy against JPEG block-boundary artefacts).
 *
 * DATA PIXELS (rows 8–264)
 * ─────────────────────────
 * Shader defines (from JS layer config) determine how channels are used:
 *
 *   VECTOR_SIZE  R = U component (east), G = V component (north)
 *                → wind, currents, waves
 *   (default)    R = scalar value
 *                → temp, rain, pressure, etc.
 *   USE_BLUE_CHANNEL  value encoded in B channel (SST, PNG format)
 *
 * Rescaling (applied in GLSL, replicated here in JS):
 *   U_physical = (R / 255) * (255 * decoderRstep) + decoderRmin
 *             = R * decoderRstep + decoderRmin
 *   V_physical = G * decoderGstep + decoderGmin
 *
 * JPEG compression introduces ~1–2 DN of quantisation error, acceptable for
 * visualisation. The point forecast API (forecast.ts) gives exact values.
 *
 * CMEMS / JPGtransparency
 * ────────────────────────
 * Ocean-only models (CMEMS currents) use `JPGtransparency: true`. Land pixels
 * have B ≈ 255. Check B < 250 before treating a pixel as valid ocean data.
 *
 * LAT/LON → TILE COORDS
 * ──────────────────────
 * Standard Web Mercator XYZ slippy-map scheme:
 *   x = floor((lon + 180) / 360 * 2^z)
 *   y = floor((1 - ln(tan(lat_rad) + sec(lat_rad)) / π) / 2 * 2^z)
 */

import type {
  WindyTileHeader,
  WindyTilePixelValue,
  WindyLevel,
} from "./types.js";

/**
 * A function that fetches a Windy JPEG tile and decodes it to a flat RGBA
 * Uint8Array (265 × 257 × 4 bytes, row-major). Pass to `sampleAtPosition`.
 *
 * Two implementations are provided:
 *   `browserRgbaDecoder`  — uses OffscreenCanvas; works in browsers and Deno.
 *
 * Node.js with sharp:
 *   import sharp from "sharp";
 *   const decoder: RgbaDecoder = async (url) => {
 *     const buf = await fetch(url).then(r => r.arrayBuffer());
 *     const { data } = await sharp(Buffer.from(buf))
 *       .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
 *     return new Uint8Array(data.buffer);
 *   };
 */
export type RgbaDecoder = (tileUrl: string) => Promise<Uint8Array>;

const IMS_BASE = "https://ims.windy.com/im/v3.0/forecast";
const TILE_SIZE = 257;
const HEADER_ROWS = 8;

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

/**
 * Build the URL for a single Windy data tile.
 *
 * @param model       Model identifier, e.g. "ecmwf-hres" or "cmems"
 * @param modelRun    Compact run time from refToCompact(), e.g. "2026071900"
 * @param validTime   Compact valid time, e.g. "2026071906"
 * @param z           Zoom level (max 3 for free tier and CMEMS)
 * @param x           Tile column
 * @param y           Tile row
 * @param filename    Overlay filename stem, e.g. "wind", "seacurrents"
 * @param level       Altitude level, e.g. "surface"
 *
 * @example
 * // ECMWF wind at surface, T+9h
 * const url = buildTileUrl("ecmwf-hres", "2026071900", "2026071909", 3, 4, 2, "wind", "surface");
 *
 * // CMEMS ocean currents at T+6h
 * const url = buildTileUrl("cmems", "2026071900", "2026071906", 3, 4, 2, "seacurrents", "surface");
 */
export function buildTileUrl(
  model: string,
  modelRun: string,
  validTime: string,
  z: number,
  x: number,
  y: number,
  filename: string,
  level: WindyLevel = "surface"
): string {
  return `${IMS_BASE}/${model}/${modelRun}/${validTime}/wm_grid_257/${z}/${x}/${y}/${filename}-${level}.jpg`;
}

// ---------------------------------------------------------------------------
// Lat/lon ↔ tile XY
// ---------------------------------------------------------------------------

/**
 * Convert a lat/lon to the XYZ tile that contains it at zoom level z.
 *
 * @example
 * const { x, y } = latLonToTile(54.32, 10.13, 3); // → { x: 4, y: 2 }
 */
export function latLonToTile(
  lat: number,
  lon: number,
  z: number
): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n
  );
  return { x, y };
}

/**
 * Pixel coordinates (px, py) within a 257×257 data tile for a given lat/lon.
 * Returns values in [0, 256].
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  z: number,
  tileX: number,
  tileY: number
): { px: number; py: number } {
  const n = 2 ** z;
  // Fractional tile position
  const fx = ((lon + 180) / 360) * n - tileX;
  const latRad = (lat * Math.PI) / 180;
  const fy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n -
    tileY;
  return {
    px: Math.round(fx * (TILE_SIZE - 1)),
    py: Math.round(fy * (TILE_SIZE - 1)),
  };
}

// ---------------------------------------------------------------------------
// JPEG tile decoding
// ---------------------------------------------------------------------------

/**
 * Decode the 8-row rescale header from raw RGBA pixel data.
 *
 * Verified against Windy index.js v50.1.2 functions p_() and m_():
 *
 *   function p_(e, t) {           // e = RGBA buffer, t = quality tier (0=extreme)
 *     let l = t*4*4 + 8;          // start offset: tier 0 → byte 8 = pixel 2
 *     for (a = 0; a < 28; a++)
 *       ..., l += 16;             // ← stride 16 bytes (4 pixels) — each byte
 *     return c;                   //   is stored in 4 REDUNDANT consecutive pixels
 *   }
 *
 *   function m_(e) {              // e = Float32Array from p_()
 *     return {
 *       decoderRmin:  e[0],       // layout: [Rmin, Rmax, Gmin, Gmax, Bmin, Bmax, ?]
 *       decoderRstep: (e[1]-e[0])/255,   // ← step = range / 255
 *       decoderGmin:  e[2],
 *       decoderGstep: (e[3]-e[2])/255,
 *       decoderBmin:  e[4],       // for USE_BLUE_CHANNEL overlays (SST etc.)
 *       decoderBstep: (e[5]-e[4])/255,
 *     }
 *   }
 *
 * Three common bugs (all present in earlier versions of this file):
 *   Bug 1 — stride 4 instead of 16: reads interleaved redundant copies → garbled bytes.
 *   Bug 2 — float layout [Rstep,Rmin,...] instead of [Rmin,Rmax,...]: wrong indices.
 *   Bug 3 — decoderRstep = floats[1] instead of (floats[1]-floats[0])/255: wrong magnitude.
 *
 * @param rgba  Flat Uint8Array of RGBA from getImageData() or sharp().raw().
 *              Must be the full 265×257×4 buffer (header rows included).
 */
export function decodeTileHeader(rgba: Uint8Array): WindyTileHeader {
  // p_() with quality tier t=0: start at byte offset 8 (pixel 2)
  const buf = new ArrayBuffer(28);
  const bytes = new Uint8Array(buf);
  const floats = new Float32Array(buf);

  let offset = 8;
  for (let i = 0; i < 28; i++) {
    const r = Math.round((rgba[offset]     ?? 0) / 64);  // 2 bits from R
    const g = Math.round((rgba[offset + 1] ?? 0) / 16);  // 4 bits from G
    const b = Math.round((rgba[offset + 2] ?? 0) / 64);  // 2 bits from B
    bytes[i] = (r << 6) | (g << 2) | b;
    offset += 16; // BUG 1 FIX: skip 3 redundant copies (4 pixels × 4 bytes)
  }

  // m_(): float layout is [Rmin, Rmax, Gmin, Gmax, Bmin, Bmax, ?]
  // BUG 2+3 FIX: step = (max - min) / 255, not floats[0] or floats[1]/255
  return {
    decoderRmin:  floats[0] ?? 0,
    decoderRstep: ((floats[1] ?? 0) - (floats[0] ?? 0)) / 255,
    decoderGmin:  floats[2] ?? 0,
    decoderGstep: ((floats[3] ?? 0) - (floats[2] ?? 0)) / 255,
  };
}

/**
 * Sample a single pixel from the data region (rows 8–264) of a decoded tile.
 *
 * @param rgba   Full 265×257 RGBA buffer (same as passed to decodeTileHeader).
 * @param header Decoded from decodeTileHeader().
 * @param px     Pixel column, 0–256.
 * @param py     Pixel row within data region (0 = first data row), 0–256.
 * @param isOceanModel  Set true for CMEMS to enable the B-channel land check.
 */
export function sampleTilePixel(
  rgba: Uint8Array,
  header: WindyTileHeader,
  px: number,
  py: number,
  isOceanModel = false
): WindyTilePixelValue {
  const row = py + HEADER_ROWS; // skip header rows
  const offset = (row * TILE_SIZE + px) * 4;

  const R = rgba[offset] ?? 0;
  const G = rgba[offset + 1] ?? 0;
  const B = rgba[offset + 2] ?? 0;

  // CMEMS uses B ≈ 255 as "land / no data" sentinel.
  const hasData = !isOceanModel || B < 250;

  const u = R * header.decoderRstep + header.decoderRmin;
  const v = G * header.decoderGstep + header.decoderGmin;
  const speed = Math.sqrt(u * u + v * v);
  const direction = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

  return { u, v, speed, direction, hasData };
}

/**
 * `RgbaDecoder` implementation for browsers and Deno.
 * Uses `OffscreenCanvas` — not available in Node.js.
 *
 * @example
 * import { browserRgbaDecoder } from "./tiles.js";
 * const cur = await windy.sampleAtPosition(lat, lon, "currents", { rgbaDecoder: browserRgbaDecoder });
 */
export const browserRgbaDecoder: RgbaDecoder = async (url: string): Promise<Uint8Array> => {
  const blob = await fetch(url).then((r) => r.blob());
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return new Uint8Array(img.data.buffer);
};


/**
 * Fractional pixel coordinates within a 257×257 data tile for a given lat/lon.
 * Unlike `latLonToPixel`, does NOT round — returns continuous values for
 * bilinear interpolation.
 */
export function latLonToPixelFrac(
  lat: number, lon: number, z: number, tileX: number, tileY: number
): { px: number; py: number } {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n - tileX;
  const latRad = (lat * Math.PI) / 180;
  const fy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n -
    tileY;
  return {
    px: fx * (TILE_SIZE - 1),
    py: fy * (TILE_SIZE - 1),
  };
}

/**
 * Bilinear interpolation of 4 surrounding pixels in a decoded tile.
 * Falls back to nearest-pixel sampling when any corner has no data.
 */
export function sampleTileBilinear(
  rgba: Uint8Array, header: WindyTileHeader,
  px: number, py: number, isOceanModel = false
): WindyTilePixelValue {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, TILE_SIZE - 1);
  const y1 = Math.min(y0 + 1, TILE_SIZE - 1);
  const fx = px - x0, fy = py - y0;

  const s00 = sampleTilePixel(rgba, header, x0, y0, isOceanModel);
  const s10 = sampleTilePixel(rgba, header, x1, y0, isOceanModel);
  const s01 = sampleTilePixel(rgba, header, x0, y1, isOceanModel);
  const s11 = sampleTilePixel(rgba, header, x1, y1, isOceanModel);

  // If any corner has no data, fall back to nearest
  if (!s00.hasData || !s10.hasData || !s01.hasData || !s11.hasData) {
    return sampleTilePixel(rgba, header, Math.round(px), Math.round(py), isOceanModel);
  }

  const u = s00.u * (1 - fx) * (1 - fy) + s10.u * fx * (1 - fy) + s01.u * (1 - fx) * fy + s11.u * fx * fy;
  const v = s00.v * (1 - fx) * (1 - fy) + s10.v * fx * (1 - fy) + s01.v * (1 - fx) * fy + s11.v * fx * fy;
  const speed = Math.sqrt(u * u + v * v);
  const direction = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  return { u, v, speed, direction, hasData: true };
}
