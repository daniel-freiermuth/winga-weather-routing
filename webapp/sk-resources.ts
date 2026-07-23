// SignalK resource loading: departure points, waypoint routes, vessel position.

import maplibregl from 'maplibre-gl';
import { skState } from './sk-state.svelte';

/** External dependencies injected from app.ts. */
export interface SkDeps {
  skFetch: (path: string, options?: RequestInit) => Promise<Response>;
  skWebSocketUrl: (path: string) => string;
  map: maplibregl.Map;
  startMarker: maplibregl.Marker;
  endMarker: maplibregl.Marker;
  setStartCoordsText: (text: string) => void;
  setEndCoordsText: (text: string) => void;
}

// ── Departure resources ──────────────────────────────────────────────────────

export async function loadDepartureResources(deps: SkDeps): Promise<void> {
  const entries: { label: string; lat: number; lon: number }[] = [];
  const [routesRes, wpsRes] = await Promise.allSettled([
    deps.skFetch('/signalk/v2/api/resources/routes'),
    deps.skFetch('/signalk/v2/api/resources/waypoints'),
  ]);
  if (routesRes.status === 'fulfilled' && routesRes.value.ok) {
    const data: unknown = await routesRes.value.json();
    for (const [, r] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      const feature = r['feature'] as Record<string, unknown> | undefined;
      const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
      const coords = geometry?.['coordinates'] as number[][] | undefined;
      if (!Array.isArray(coords) || coords.length === 0) continue;
      const last = coords[coords.length - 1]!;
      const [lon, lat] = last;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      entries.push({ label: `\u{1F5FA} ${(r['name'] as string | undefined) ?? 'Unnamed route'}`, lat, lon });
    }
  }
  if (wpsRes.status === 'fulfilled' && wpsRes.value.ok) {
    const data: unknown = await wpsRes.value.json();
    for (const [, wp] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      const feature = wp['feature'] as Record<string, unknown> | undefined;
      const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
      const coords = geometry?.['coordinates'] as number[] | undefined;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const [lon, lat] = coords;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      entries.push({ label: `\u{1F4CD} ${(wp['name'] as string | undefined) ?? 'Unnamed waypoint'}`, lat, lon });
    }
  }
  skState.departureResources = entries;
}

// ── Waypoint routes ──────────────────────────────────────────────────────────

export function clearRouteWaypoints(deps: SkDeps): void {
  for (const m of skState.routeWaypointMarkers) m.remove();
  skState.routeWaypointMarkers = [];
  skState.routeWaypoints = [];
}

export async function loadWaypointRoutes(deps: SkDeps): Promise<void> {
  try {
    const r = await deps.skFetch('/signalk/v2/api/resources/routes');
    if (!r.ok) return;
    const data: unknown = await r.json();
    const routes: { label: string; coords: number[][] }[] = [];
    for (const [, v] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      const feature = v['feature'] as Record<string, unknown> | undefined;
      const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
      const coords = geometry?.['coordinates'] as number[][] | undefined;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      routes.push({ label: (v['name'] as string | undefined) ?? 'Unnamed', coords });
    }
    skState.waypointRoutes = routes;
  } catch { /* offline */ }
}

export function handleWaypointRouteChange(deps: SkDeps, e: Event): void {
  const idx = parseInt((e.target as HTMLSelectElement).value);
  clearRouteWaypoints(deps);
  if (isNaN(idx) || !skState.waypointRoutes[idx]) return;
  const route = skState.waypointRoutes[idx]!;
  const coords = route.coords;
  if (coords.length >= 2) {
    const first = coords[0]!;
    skState.startLatLon = { lat: first[1]!, lon: first[0]! };
    deps.setStartCoordsText(`${first[1]!.toFixed(4)}, ${first[0]!.toFixed(4)}`);
    deps.startMarker.setLngLat([first[0]!, first[1]!]).addTo(deps.map);
    const last = coords[coords.length - 1]!;
    skState.endLatLon = { lat: last[1]!, lon: last[0]! };
    deps.setEndCoordsText(`${last[1]!.toFixed(4)}, ${last[0]!.toFixed(4)}`);
    deps.endMarker.setLngLat([last[0]!, last[1]!]).addTo(deps.map);
  }
  for (let i = 1; i < coords.length - 1; i++) {
    const wp = { lat: coords[i]![1]!, lon: coords[i]![0]! };
    skState.routeWaypoints.push(wp);
    const el = document.createElement('div');
    el.innerHTML = '<div style="background:#f5c2e7;width:8px;height:8px;border-radius:50%;border:1px solid #1e2230"></div>';
    skState.routeWaypointMarkers.push(
      new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([wp.lon, wp.lat]).addTo(deps.map),
    );
  }
  const bounds = coords.reduce((b, [lon, lat]) => b.extend([lon!, lat!] as [number, number]), new maplibregl.LngLatBounds());
  deps.map.fitBounds(bounds, { padding: 30 });
}

// ── Departure resource picker ────────────────────────────────────────────────

export function handleDepartureResourceChange(deps: SkDeps, e: Event): void {
  const idx = parseInt((e.target as HTMLSelectElement).value);
  if (isNaN(idx) || !skState.departureResources[idx]) return;
  const { lat, lon } = skState.departureResources[idx]!;
  skState.startLatLon = { lat, lon };
  deps.setStartCoordsText(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  deps.startMarker.setLngLat([lon, lat]).addTo(deps.map);
  clearRouteWaypoints(deps);
}

// ── Vessel position stream ───────────────────────────────────────────────────

export function connectVesselPositionStream(deps: SkDeps): void {
  const ws = new WebSocket(deps.skWebSocketUrl('/signalk/v1/stream?subscribe=none'));
  skState.vesselPositionWs = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({
      context: 'vessels.self',
      subscribe: [{ path: 'navigation.position', period: 1000 }],
    }));
  };
  ws.onmessage = (e) => {
    try {
      const delta = JSON.parse(e.data as string) as { updates?: { values?: { path: string; value?: { latitude: number; longitude: number } }[] }[] };
      for (const update of delta.updates ?? []) {
        for (const v of update.values ?? []) {
          if (v.path === 'navigation.position' && v.value) {
            skState.vesselPosition = { lat: v.value.latitude, lon: v.value.longitude };
          }
        }
      }
    } catch { /* ignore parse errors */ }
  };
  ws.onclose = () => {
    skState.vesselPosition = null;
    skState.vesselPositionWs = null;
    setTimeout(() => connectVesselPositionStream(deps), 5000);
  };
}

export function handleVesselPositionClick(deps: SkDeps): void {
  if (!skState.vesselPosition) return;
  const { lat, lon } = skState.vesselPosition;
  skState.startLatLon = { lat, lon };
  deps.setStartCoordsText(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  deps.startMarker.setLngLat([lon, lat]).addTo(deps.map);
  clearRouteWaypoints(deps);
}
