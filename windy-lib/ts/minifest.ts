/**
 * Windy minifest — describes the current model run.
 *
 * HOW IT WORKS
 * ─────────────
 * The minifest is fetched unauthenticated at page load. It tells the client:
 *   - Which model run is current (`ref`)
 *   - What forecast timesteps are available (`dst`)
 *   - Where to fetch tiles and point forecasts (`urls`)
 *
 * The `dst` (distribution) field encodes the time-step schedule as a list of
 * [stepHours, firstHour, lastHour] triplets. For example:
 *
 *   [[3, 3, 90], [3, 93, 144], [6, 150, 360]]
 *
 *   → every 3 h from T+3 … T+90
 *   → every 3 h from T+93 … T+144
 *   → every 6 h from T+150 … T+360
 *
 * TILE URL ANATOMY
 * ─────────────────
 * https://ims.windy.com/im/v3.0/forecast/{model}/{modelRun}/{validTime}/wm_grid_257/{z}/{x}/{y}/{filename}-{level}.jpg
 *
 *   modelRun  = ref ISO → compact, e.g. "2026-07-19T00:00:00Z" → "2026071900"
 *   validTime = modelRun + step hours, same format, e.g. "2026071909"
 *
 * SUPPORTED MODELS
 * ─────────────────
 *   ecmwf-hres  ECMWF 9 km, 3 h steps, 15 days (premium)
 *   gfs         GFS 22 km
 *   icon        ICON 13 km
 *   cmems       CMEMS ocean currents, 1 h steps, 72 h
 */

import type { WindyMinifest } from "./types.js";

const METADATA_BASE = "https://node.windy.com/metadata/v1.0/forecast";
const CLIENT_VERSION = "50.1.2";

/**
 * Fetch the minifest for a model. No auth required.
 *
 * @param modelIdent  e.g. "ecmwf-hres", "gfs", "cmems"
 */
export async function fetchMinifest(
  modelIdent: string
): Promise<WindyMinifest> {
  const url = `${METADATA_BASE}/${modelIdent}/minifest.json?v=${CLIENT_VERSION}&t=index&d=desktop`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Minifest fetch failed: HTTP ${resp.status}`);
  return resp.json() as Promise<WindyMinifest>;
}

/**
 * Convert an ISO ref timestamp (from minifest.ref) to the compact format
 * used in tile URL paths.
 *
 * "2026-07-19T00:00:00Z" → "2026071900"
 */
export function refToCompact(isoRef: string): string {
  return isoRef.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}).*/, "$1$2$3$4");
}

/**
 * Compute valid ISO timestamps for all forecast steps defined in `dst`.
 *
 * Returns an array of { iso, compact } pairs sorted by time, where:
 *   iso     = full ISO string, usable as `refTime` query param
 *   compact = compact form usable in tile URL paths
 */
export function getValidTimes(
  minifest: WindyMinifest
): { iso: string; compact: string }[] {
  const refMs = new Date(minifest.ref).getTime();
  const times: { iso: string; compact: string }[] = [];

  for (const [stepHours, firstHour, lastHour] of minifest.dst) {
    if (stepHours <= 0) continue;
    for (let h = firstHour; h <= lastHour; h += stepHours) {
      const ms = refMs + h * 60 * 60 * 1000;
      const d = new Date(ms);
      const iso = d.toISOString().replace(/\.\d{3}Z$/, "Z");
      const compact = iso.replace(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}).*/,
        "$1$2$3$4"
      );
      times.push({ iso, compact });
    }
  }

  return times;
}
