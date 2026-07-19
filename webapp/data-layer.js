// Data layer — provides wind/wave/current grid data from Windy tiles.
// Replaces the server API calls (/wind-grid, /wave-grid, /current-grid, /wind-times).
//
// All functions return the same data shapes that app.js expects so the UI
// rendering code (renderWindOverlay, renderWaveOverlay, etc.) doesn't change.

import jpeg from 'jpeg-js';
import {
  fetchMinifest,
  refToCompact,
  getValidTimes,
  buildTileUrl,
  decodeTileHeader,
  sampleTilePixel,
  latLonToTile,
  latLonToPixel,
} from '@signalk-weather-routing/windy-lib';

// ── Tile cache ────────────────────────────────────────────────────────────────

/** @type {Map<string, Promise<{rgba: Uint8Array, header: object}>>} */
const tileCache = new Map();

async function fetchTile(url) {
  let pending = tileCache.get(url);
  if (pending) return pending;
  pending = (async () => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Tile ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const { data } = jpeg.decode(new Uint8Array(buf), { useTArray: true });
    const header = decodeTileHeader(data);
    return { rgba: data, header };
  })();
  tileCache.set(url, pending);
  return pending;
}

// ── Minifest cache ────────────────────────────────────────────────────────────

const manifests = new Map();
const MANIFEST_TTL = 10 * 60 * 1000;

async function getManifest(modelId) {
  const cached = manifests.get(modelId);
  if (cached && Date.now() - cached.fetchedAt < MANIFEST_TTL) return cached.data;
  const data = await fetchMinifest(modelId);
  manifests.set(modelId, { data, fetchedAt: Date.now() });
  return data;
}

// ── State ─────────────────────────────────────────────────────────────────────

let windModel = 'ecmwf-hres';
let windSteps = [];
let waveSteps = [];
let cmemsSteps = [];
let windModelRun = '';
let waveModelRun = '';
let cmemsModelRun = '';

export function setWindModel(model) {
  const models = { ecmwf: 'ecmwf-hres', gfs: 'gfs', icon: 'icon' };
  windModel = models[model] || 'ecmwf-hres';
}

/**
 * Load forecast time axes from Windy minifests.
 * @returns {Promise<{windTimes: string[], currentTimes: string[]}>}
 */
export async function loadTimesFromWindy() {
  const [windMf, waveMf, cmemsMf] = await Promise.all([
    getManifest(windModel),
    getManifest('ecmwf-wam'),
    getManifest('cmems'),
  ]);

  windModelRun = refToCompact(windMf.ref);
  waveModelRun = refToCompact(waveMf.ref);
  cmemsModelRun = refToCompact(cmemsMf.ref);
  windSteps = getValidTimes(windMf);
  waveSteps = getValidTimes(waveMf);
  cmemsSteps = getValidTimes(cmemsMf);

  return {
    windTimes: windSteps.map((s) => s.iso),
    currentTimes: cmemsSteps.map((s) => s.iso),
  };
}

// ── Grid sampling helpers ─────────────────────────────────────────────────────

const ZOOM = 3;

function closestStep(steps, targetMs) {
  let best = steps[0];
  let bestDiff = Infinity;
  for (const s of steps) {
    const diff = Math.abs(new Date(s.iso).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

/**
 * Sample a Windy tile overlay across a bounding box at a given step density.
 * Fetches only the tiles needed for the bbox, caches them.
 *
 * @param {string} model       e.g. 'ecmwf-hres', 'ecmwf-wam', 'cmems'
 * @param {string} modelRun    compact model run time
 * @param {string} validTime   compact valid time
 * @param {string} overlay     e.g. 'wind', 'waves', 'seacurrents'
 * @param {boolean} isOcean    true for CMEMS (B-channel land check)
 * @param {{latMin:number, latMax:number, lonMin:number, lonMax:number}} bbox
 * @param {number} step        grid spacing in degrees
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{lat:number, lon:number, u:number, v:number, speed:number}>>}
 */
async function sampleOverlayGrid(model, modelRun, validTime, overlay, isOcean, bbox, step, signal) {
  // Determine which tiles cover the bbox
  const tl = latLonToTile(bbox.latMax, bbox.lonMin, ZOOM);
  const br = latLonToTile(bbox.latMin, bbox.lonMax, ZOOM);

  // Pre-fetch all needed tiles in parallel
  const tilePromises = new Map();
  for (let tx = tl.x; tx <= br.x; tx++) {
    for (let ty = tl.y; ty <= br.y; ty++) {
      const url = buildTileUrl(model, modelRun, validTime, ZOOM, tx, ty, overlay);
      if (!tilePromises.has(`${tx}/${ty}`)) {
        tilePromises.set(`${tx}/${ty}`, fetchTile(url).catch(() => null));
      }
    }
  }

  // Resolve all tiles
  const tiles = new Map();
  for (const [key, promise] of tilePromises) {
    const tile = await promise;
    if (tile) tiles.set(key, tile);
  }

  if (signal?.aborted) return [];

  // Sample the grid
  const points = [];
  for (let lat = bbox.latMin; lat <= bbox.latMax; lat += step) {
    for (let lon = bbox.lonMin; lon <= bbox.lonMax; lon += step) {
      const { x, y } = latLonToTile(lat, lon, ZOOM);
      const tile = tiles.get(`${x}/${y}`);
      if (!tile) continue;
      const { px, py } = latLonToPixel(lat, lon, ZOOM, x, y);
      const val = sampleTilePixel(tile.rgba, tile.header, px, py, isOcean);
      if (val.hasData) {
        points.push({
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          u: val.u,
          v: val.v,
          speed: val.speed,
        });
      }
    }
  }
  return points;
}

// ── Public: grid endpoints ────────────────────────────────────────────────────

/**
 * Fetch wind grid for a time step within a bounding box.
 * @param {number} timeIdx   index into windSteps
 * @param {{latMin:number,latMax:number,lonMin:number,lonMax:number}} bbox
 * @param {AbortSignal} [signal]
 * @returns {Promise<{lat:number,lon:number,u:number,v:number}[]>}
 */
export async function fetchWindGrid(timeIdx, bbox, signal) {
  const step = windSteps[timeIdx];
  if (!step) return [];
  return sampleOverlayGrid(windModel, windModelRun, step.compact, 'wind', false, bbox, 0.5, signal);
}

/**
 * Fetch wave grid for a time step within a bounding box.
 * @param {number} timeIdx   index into windSteps
 * @param {{latMin:number,latMax:number,lonMin:number,lonMax:number}} bbox
 * @param {AbortSignal} [signal]
 * @returns {Promise<{points: {lat:number,lon:number,waveHeight:number}[], timeMs: number}>}
 */
export async function fetchWaveGrid(timeIdx, bbox, signal) {
  const windStep = windSteps[timeIdx];
  if (!windStep) return { points: [], timeMs: 0 };
  const windTimeMs = new Date(windStep.iso).getTime();
  const waveStep = closestStep(waveSteps, windTimeMs);
  if (!waveStep) return { points: [], timeMs: 0 };

  const raw = await sampleOverlayGrid('ecmwf-wam', waveModelRun, waveStep.compact, 'waves', false, bbox, 0.5, signal);
  const points = raw
    .filter((p) => p.speed > 0.1)
    .map((p) => ({ lat: p.lat, lon: p.lon, waveHeight: Math.round(p.speed * 1000) / 1000 }));
  return { points, timeMs: windTimeMs };
}

/**
 * Fetch current grid for a time (ms) within a bounding box.
 * @param {number} timeMs
 * @param {{latMin:number,latMax:number,lonMin:number,lonMax:number}} bbox
 * @param {AbortSignal} [signal]
 * @returns {Promise<{lat:number,lon:number,u:number,v:number}[]>}
 */
export async function fetchCurrentGrid(timeMs, bbox, signal) {
  const step = closestStep(cmemsSteps, timeMs);
  if (!step) return [];
  const raw = await sampleOverlayGrid('cmems', cmemsModelRun, step.compact, 'seacurrents', true, bbox, 0.5, signal);
  return raw.filter((p) => p.speed > 0.01);
}
