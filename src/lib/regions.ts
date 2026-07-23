// SignalK region avoidance: loads regions from resources/regions and checks segment/point against them.

import type { RegionRing, RegionIndex, SignalKResourceEntry, GeoJsonGeometry } from '../types';
import { pointInRing, segmentCrossesRing } from './landmask';

// Builds a RegionIndex from SignalK resource data.
// Accepts two formats:
//   - array of { id, name?, feature: { geometry } } — from app.resourcesApi.listResources()
//   - object keyed by UUID { "uuid": { name?, feature: { geometry } } } — from raw HTTP API
export function buildRegionIndex(
  apiRegions: SignalKResourceEntry[] | Record<string, SignalKResourceEntry>,
): RegionIndex {
  const regions = new Map<string, RegionRing>();
  const entries: { id: string; name: string | undefined; feature: { geometry: GeoJsonGeometry } }[] = [];

  if (Array.isArray(apiRegions)) {
    for (const entry of apiRegions) {
      const geo = entry.feature?.geometry;
      if (entry.id !== undefined && entry.id !== '' && geo !== undefined) {
        entries.push({ id: entry.id, name: entry.name, feature: { geometry: geo } });
      }
    }
  } else {
    for (const [uuid, entry] of Object.entries(apiRegions)) {
      const geo = entry.feature?.geometry;
      if (geo) {
        entries.push({ id: uuid, name: entry.name, feature: { geometry: geo } });
      }
    }
  }

  for (const { id, feature } of entries) {
    const geo = feature.geometry;
    let rings: number[][][] = [];
    if (geo.type === 'Polygon') {
      rings = geo.coordinates;
    } else {
      // MultiPolygon: merge all polygons into a single ring set.
      for (const poly of geo.coordinates) rings.push(...poly);
    }

    let ringIdx = 0;
    for (const ringCoords of rings) {
      // ringCoords is [[lon,lat], [lon,lat], ...] — extract exterior ring only.
      const n = ringCoords.length;
      const exterior = new Float64Array(n * 2);
      let latMin = Infinity,
        latMax = -Infinity;
      let lonMin = Infinity,
        lonMax = -Infinity;
      // for...of avoids noUncheckedIndexedAccess on ringCoords[i]
      let i = 0;
      for (const pos of ringCoords) {
        const lon = pos[0]; // GeoJSON position: [lon, lat, alt?]
        const lat = pos[1];
        if (lon === undefined || lat === undefined) { i++; continue; } // GeoJSON always has lon+lat; guard satisfies TS
        exterior[i * 2] = lon;
        exterior[i * 2 + 1] = lat;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        i++;
      }
      // Key format: always id__ringIdx for consistency across single and multi-ring regions.
      const key = `${id}__${String(ringIdx)}`;
      regions.set(key, { bboxLatMin: latMin, bboxLatMax: latMax, bboxLonMin: lonMin, bboxLonMax: lonMax, exterior });
      ringIdx++;
    }
  }

  return { regions };
}

// Returns the set of UUID prefixes present in the index (for auto-clean of stale IDs).
export function validRegionUuids(index: RegionIndex): Set<string> {
  const uuids = new Set<string>();
  for (const key of index.regions.keys()) {
    const uuid = key.includes('__') ? (key.split('__')[0] ?? key) : key;
    uuids.add(uuid);
  }
  return uuids;
}

// Checks whether the segment (lat1,lon1)→(lat2,lon2) crosses any region whose UUID is in avoidIds.
export function segmentCrossesRegion(
  index: RegionIndex,
  avoidIds: Set<string>,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): boolean {
  for (const [key, ring] of index.regions) {
    const uuid = key.includes('__') ? (key.split('__')[0] ?? key) : key;
    if (!avoidIds.has(uuid)) continue;
    if (Math.max(lat1, lat2) < ring.bboxLatMin) continue;
    if (Math.min(lat1, lat2) > ring.bboxLatMax) continue;
    if (Math.max(lon1, lon2) < ring.bboxLonMin) continue;
    if (Math.min(lon1, lon2) > ring.bboxLonMax) continue;
    if (segmentCrossesRing(lat1, lon1, lat2, lon2, ring.exterior)) return true;
  }
  return false;
}

// Returns true if (lat, lon) falls inside any region whose UUID is in avoidIds.
export function isPointInRegion(index: RegionIndex, avoidIds: Set<string>, lat: number, lon: number): boolean {
  for (const [key, ring] of index.regions) {
    const uuid = key.includes('__') ? (key.split('__')[0] ?? key) : key;
    if (!avoidIds.has(uuid)) continue;
    if (lat < ring.bboxLatMin || lat > ring.bboxLatMax) continue;
    if (lon < ring.bboxLonMin || lon > ring.bboxLonMax) continue;
    if (pointInRing(lat, lon, ring.exterior)) return true;
  }
  return false;
}
