// Grid bounds computation shared by /wind-grid and /wave-grid endpoints.

import { GribFileEntry } from '../types';

export interface GridBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  latStep: number;
  lonStep: number;
  nLat: number;
  nLon: number;
}

// Computes the union bounding box and finest step across multiple GRIB files.
// Used by grid overlay endpoints to iterate at native resolution.
export function computeGridBounds(loaded: GribFileEntry[]): GridBounds {
  const latStep = Math.min(...loaded.map((f) => f.meta.latStep));
  const lonStep = Math.min(...loaded.map((f) => f.meta.lonStep));
  let latMin = Infinity,
    latMax = -Infinity,
    lonMin = Infinity,
    lonMax = -Infinity;
  for (const f of loaded) {
    if (f.meta.latMin < latMin) latMin = f.meta.latMin;
    if (f.meta.latMax > latMax) latMax = f.meta.latMax;
    if (f.meta.lonMin < lonMin) lonMin = f.meta.lonMin;
    if (f.meta.lonMax > lonMax) lonMax = f.meta.lonMax;
  }
  const nLat = Math.round((latMax - latMin) / latStep);
  const nLon = Math.round((lonMax - lonMin) / lonStep);
  return { latMin, latMax, lonMin, lonMax, latStep, lonStep, nLat, nLon };
}
