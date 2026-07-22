// Routing engine — dispatches calculation to the Web Worker and processes results.

import { sortByBearing, splitByAngularGap } from './utils';

declare const L: typeof import('leaflet');

export interface RoutingRequest {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departureTime: string;
  waypoints?: { lat: number; lon: number }[] | undefined;
  polarCsv: string;
  useLandAvoidance: boolean;
  useSafetyMargin: boolean;
  options: {
    motorBelowKn?: number | undefined;
    motorSpeedKn?: number | undefined;
    waitForWind?: boolean | undefined;
    maxWindKn?: number | undefined;
    maxWaveM?: number | undefined;
  };
}

export interface RoutingCallbacks {
  onProgress: (pct: number, frontier?: number[][]) => void;
  onResult: (route: unknown) => void;
  onError: (msg: string) => void;
}

const ISOCHRONE_GAP_THRESHOLD_DEG = 10;
const ISOCHRONE_COLOURS = ['#000000', '#4477ff', '#8833cc', '#cc3333'];

/**
 * Render isochrone frontier segments on the map.
 */
export function renderIsochrone(
  frontier: number[][],
  origin: { lat: number; lon: number },
  isochroneGroup: L.LayerGroup,
): void {
  const pts = sortByBearing(
    frontier.map((pt) => [pt[0]!, pt[1]!]),
    origin,
  );
  const segments = splitByAngularGap(pts, origin, ISOCHRONE_GAP_THRESHOLD_DEG);
  const color = ISOCHRONE_COLOURS[isochroneGroup.getLayers().length % ISOCHRONE_COLOURS.length]!;
  for (const seg of segments) {
    if (seg.length >= 2) {
      L.polyline(
        seg.map(([lat, lon]) => [lat!, lon!] as L.LatLngTuple),
        { color, weight: 1, opacity: 0.5 },
      ).addTo(isochroneGroup);
    }
  }
}

/**
 * Build the worker message payload for a routing calculation.
 */
export function buildWorkerPayload(req: RoutingRequest): unknown {
  const allCoords = [req.start, ...(req.waypoints ?? []), req.end];
  const lats = allCoords.map((c) => c.lat);
  const lons = allCoords.map((c) => c.lon);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const margin = Math.max(1, (latMax - latMin) * 0.3, (lonMax - lonMin) * 0.3);

  return {
    type: 'calculate',
    payload: {
      request: {
        start: req.start,
        end: req.end,
        departureTime: req.departureTime,
        ...(req.waypoints && req.waypoints.length > 0 ? { waypoints: req.waypoints } : {}),
        useLandAvoidance: req.useLandAvoidance,
        options: req.options,
      },
      polarCsv: req.polarCsv,
      tileBbox: {
        latMin: latMin - margin, latMax: latMax + margin,
        lonMin: lonMin - margin, lonMax: lonMax + margin,
      },
      landIndexUrl: new URL('./data/edge-index.bin.gz', import.meta.url).href,
      dilatedIndexUrl: req.useSafetyMargin
        ? new URL('./data/dilated-edge-index.bin.gz', import.meta.url).href
        : undefined,
      windModel: 'ecmwf',
      useSafetyMargin: req.useSafetyMargin,
    },
  };
}
