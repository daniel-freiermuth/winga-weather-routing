// Route rendering — draws polyline, wind barbs, and leg labels on the map.

import maplibregl from 'maplibre-gl';
import { windBarbSvg } from './wind-barb';
import type { WaypointMeta, RouteData } from './types';

interface FmtResult { num: string; sym: string }

export interface RouteDisplayCtx {
  map: maplibregl.Map;
  fmt: (value: number, category: 'speed' | 'depth', forceMs?: boolean) => FmtResult;
  windSpeedMs: boolean;
  getWaypointLabels: () => { labels: boolean; intervalH: number };
  routeWaypoints: { lat: number; lon: number }[];
  setStatus: (type: string, msg: string) => void;
}

export interface RouteDisplayResult {
  routeLayer: { sourceId: string; layerId: string };
  windBarbLayer: maplibregl.Marker[];
  legLabelLayer: maplibregl.Marker[];
  windBarbMarkers: (maplibregl.Marker | null)[];
  routeLegCoords: [number, number][][];
  meta: WaypointMeta[];
  intermediateIdxs: number[];
}

export function drawRoute(route: RouteData, ctx: RouteDisplayCtx): RouteDisplayResult | null {
  const coords = route.feature?.geometry?.coordinates;
  if (!coords) {
    ctx.setStatus('error', 'Route has no coordinates');
    return null;
  }

  // Route polyline via source + layer (coords are already GeoJSON [lng, lat])
  const routeSourceId = 'calculated-route';
  const routeLayerId = 'calculated-route-line';
  ctx.map.addSource(routeSourceId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: coords.map(([lng, lat]: number[]) => [lng!, lat!]),
      },
    },
  });
  ctx.map.addLayer({
    id: routeLayerId,
    type: 'line',
    source: routeSourceId,
    paint: { 'line-color': '#89b4fa', 'line-width': 3, 'line-opacity': 0.9 },
  });
  const routeLayer = { sourceId: routeSourceId, layerId: routeLayerId };

  // Fit bounds from coordinates
  const lngs = coords.map((c: number[]) => c[0]!);
  const lats = coords.map((c: number[]) => c[1]!);
  ctx.map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 20 },
  );

  const meta = route.feature?.properties?.coordinatesMeta ?? [];
  const { labels: showLabels, intervalH } = ctx.getWaypointLabels();
  const intervalMs = intervalH * 3600000;
  let lastLabeledMs = -Infinity;

  const windBarbLayer: maplibregl.Marker[] = [];
  const windBarbMarkers: (maplibregl.Marker | null)[] = [];

  coords.forEach(([lng, lat]: number[], i: number) => {
    const m = meta[i];
    if (!m) {
      windBarbMarkers.push(null);
      return;
    }
    const waypointMs = new Date(m.time).getTime();
    const isFirstOrLast = i === 0 || i === coords.length - 1;
    const showLabel = showLabels && (intervalH === 0 || isFirstOrLast || waypointMs - lastLabeledMs >= intervalMs);
    if (showLabel) lastLabeledMs = waypointMs;

    const eta = new Date(m.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const html =
      `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none">` +
      windBarbSvg(m.tws ?? 0, m.windDir ?? 0) +
      (showLabel
        ? `<div style="color:#cdd6f4;background:#313244cc;font-size:10px;padding:1px 4px;border-radius:3px;white-space:nowrap">${eta}</div>`
        : '') +
      `</div>`;
    const el = document.createElement('div');
    el.innerHTML = html;
    el.style.width = '30px';
    el.style.height = '54px';
    el.style.pointerEvents = 'none';
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng!, lat!])
      .addTo(ctx.map);
    windBarbLayer.push(marker);
    windBarbMarkers.push(marker);
  });

  const legLabelLayer: maplibregl.Marker[] = [];
  const routeLegCoords: [number, number][][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const m1 = meta[i], m2 = meta[i + 1];
    if (!m1 || !m2) continue;
    const midLat = (coords[i]![1]! + coords[i + 1]![1]!) / 2;
    const midLng = (coords[i]![0]! + coords[i + 1]![0]!) / 2;
    // Store as [lat, lng] for internal consumption by calculation.ts
    routeLegCoords.push([
      [coords[i]![1]!, coords[i]![0]!],
      [coords[i + 1]![1]!, coords[i + 1]![0]!],
    ]);
    const avgTws = ((m1.tws ?? 0) + (m2.tws ?? 0)) / 2;
    const avgBoatSpeed = ((m1.boatSpeed ?? 0) + (m2.boatSpeed ?? 0)) / 2;
    const a1 = ((m1.windDir ?? 0) * Math.PI) / 180;
    const a2 = ((m2.windDir ?? 0) * Math.PI) / 180;
    const avgDir = (Math.atan2((Math.sin(a1) + Math.sin(a2)) / 2, (Math.cos(a1) + Math.cos(a2)) / 2) * 180) / Math.PI;
    const html =
      `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">` +
      windBarbSvg(avgTws, (avgDir + 360) % 360) +
      `</div>`;
    const el = document.createElement('div');
    el.innerHTML = html;
    el.style.width = '30px';
    el.style.height = '48px';
    el.style.pointerEvents = 'none';
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([midLng, midLat])
      .addTo(ctx.map);
    legLabelLayer.push(marker);
  }

  // Find which route coords correspond to intermediate waypoints
  const intermediateIdxs = ctx.routeWaypoints
    .map((wp) => {
      let best = -1, bestDist = Infinity;
      coords.forEach(([lng, lat]: number[], i: number) => {
        const d = Math.hypot(lat! - wp.lat, lng! - wp.lon);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    })
    .filter((i) => i > 0 && i < coords.length - 1);

  return { routeLayer, windBarbLayer, legLabelLayer, windBarbMarkers, routeLegCoords, meta, intermediateIdxs };
}
