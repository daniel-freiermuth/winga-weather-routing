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
 * @param rgba   Flat Uint8Array of RGBA values for the full 265×257 image,
 *               as returned by canvas.getContext("2d").getImageData().data
 *               or by decoding the JPEG with a library like `sharp`.
 */
export function decodeTileHeader(rgba: Uint8Array): WindyTileHeader {
  // Header bytes start at pixel 2 (byte offset 8) within row 0.
  const buf = new ArrayBuffer(28);
  const bytes = new Uint8Array(buf);
  const floats = new Float32Array(buf);

  let offset = 8; // skip 2 preamble pixels (8 bytes RGBA)
  for (let i = 0; i < 28; i++) {
    const r = Math.round((rgba[offset] ?? 0) / 64);      // 2 bits
    const g = Math.round((rgba[offset + 1] ?? 0) / 16);  // 4 bits
    const b = Math.round((rgba[offset + 2] ?? 0) / 64);  // 2 bits
    bytes[i] = (r << 6) | (g << 2) | b;
    offset += 4; // next RGBA pixel
  }

  return {
    decoderRstep: floats[0] ?? 0,
    decoderRmin: floats[1] ?? 0,
    decoderGstep: floats[2] ?? 0,
    decoderGmin: floats[3] ?? 0,
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

