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
}

// ── Departure resources ──────────────────────────────────────────────────────

export async function loadDepartureResources(deps: SkDeps): Promise<void> {
  const entries: { label: string; lat: number; lon: number }[] = [];
  try {
    const r = await deps.skFetch('/signalk/v2/api/resources/waypoints');
    if (r.ok) {
      const data: unknown = await r.json();
      for (const [, wp] of Object.entries(data as Record<string, Record<string, unknown>>)) {
        const feature = wp['feature'] as Record<string, unknown> | undefined;
        const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
        const coords = geometry?.['coordinates'] as number[] | undefined;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const [lon, lat] = coords;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        entries.push({ label: (wp['name'] as string | undefined) ?? 'Unnamed waypoint', lat, lon });
      }
    }
  } catch { /* offline */ }
  skState.departureResources = entries;
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

