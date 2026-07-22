// SignalK resource loading: departure points, waypoint routes, vessel position.

declare const L: typeof import('leaflet');

import { escapeHtml } from './utils';

type LatLon = { lat: number; lon: number };

/** Mutable state shared between sk-resources functions and app.ts. */
export interface SkState {
  departureResources: { label: string; lat: number; lon: number }[];
  waypointRoutes: { label: string; coords: number[][] }[];
  routeWaypoints: LatLon[];
  routeWaypointMarkers: L.Marker[];
  startLatLon: LatLon | null;
  endLatLon: LatLon | null;
  vesselPosition: LatLon | null;
  vesselPositionWs: WebSocket | null;
}

/** External dependencies injected from app.ts. */
export interface SkDeps {
  skFetch: (path: string, options?: RequestInit) => Promise<Response>;
  skWebSocketUrl: (path: string) => string;
  map: L.Map;
  startMarker: L.Marker;
  endMarker: L.Marker;
  startCoords: HTMLElement;
  endCoords: HTMLElement;
  updateCalcButton: () => void;
  updateAnalyseButton: () => void;
  state: SkState;
}

// ── Departure resources ──────────────────────────────────────────────────────

export async function loadDepartureResources(deps: SkDeps): Promise<void> {
  const sel = document.getElementById('departure-resource')!;
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
  deps.state.departureResources = entries;
  if (entries.length === 0) { sel.style.display = 'none'; return; }
  sel.innerHTML =
    '<option value="">— set from resources —</option>' +
    entries.map((e, i) => `<option value="${String(i)}">${escapeHtml(e.label)}</option>`).join('');
  sel.style.display = '';
}

// ── Waypoint routes ──────────────────────────────────────────────────────────

export function clearRouteWaypoints(deps: SkDeps): void {
  for (const m of deps.state.routeWaypointMarkers) m.remove();
  deps.state.routeWaypointMarkers = [];
  deps.state.routeWaypoints = [];
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
    deps.state.waypointRoutes = routes;
    if (routes.length === 0) return;
    const sec = document.getElementById('waypoints-route-section')!;
    sec.style.display = '';
    const sel = document.getElementById('waypoints-route')!;
    sel.innerHTML =
      '<option value="">— route waypoints —</option>' +
      routes.map((rt, i) => `<option value="${String(i)}">${escapeHtml(rt.label)}</option>`).join('');
  } catch { /* offline */ }
}

export function handleWaypointRouteChange(deps: SkDeps, e: Event): void {
  const idx = parseInt((e.target as HTMLSelectElement).value);
  clearRouteWaypoints(deps);
  if (isNaN(idx) || !deps.state.waypointRoutes[idx]) { deps.updateCalcButton(); return; }
  const route = deps.state.waypointRoutes[idx]!;
  const coords = route.coords;
  if (coords.length >= 2) {
    const first = coords[0]!;
    deps.state.startLatLon = { lat: first[1]!, lon: first[0]! };
    deps.startCoords.textContent = `${first[1]!.toFixed(4)}, ${first[0]!.toFixed(4)}`;
    deps.startMarker.setLatLng([first[1]!, first[0]!]).addTo(deps.map);
    const last = coords[coords.length - 1]!;
    deps.state.endLatLon = { lat: last[1]!, lon: last[0]! };
    deps.endCoords.textContent = `${last[1]!.toFixed(4)}, ${last[0]!.toFixed(4)}`;
    deps.endMarker.setLatLng([last[1]!, last[0]!]).addTo(deps.map);
  }
  for (let i = 1; i < coords.length - 1; i++) {
    const wp = { lat: coords[i]![1]!, lon: coords[i]![0]! };
    deps.state.routeWaypoints.push(wp);
    deps.state.routeWaypointMarkers.push(
      L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          html: `<div style="background:#f5c2e7;width:8px;height:8px;border-radius:50%;border:1px solid #1e2230"></div>`,
          iconSize: [8, 8], iconAnchor: [4, 4], className: '',
        }),
        pane: 'waypointMarkerPane',
      }).addTo(deps.map),
    );
  }
  deps.map.fitBounds(L.latLngBounds(coords.map(([lon, lat]) => [lat!, lon!] as L.LatLngTuple)), { padding: [30, 30] });
  deps.updateCalcButton();
  deps.updateAnalyseButton();
}

// ── Departure resource picker ────────────────────────────────────────────────

export function handleDepartureResourceChange(deps: SkDeps, e: Event): void {
  const idx = parseInt((e.target as HTMLSelectElement).value);
  if (isNaN(idx) || !deps.state.departureResources[idx]) return;
  const { lat, lon } = deps.state.departureResources[idx]!;
  deps.state.startLatLon = { lat, lon };
  deps.startCoords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  deps.startMarker.setLatLng([lat, lon]).addTo(deps.map);
  clearRouteWaypoints(deps);
  deps.updateCalcButton();
}

// ── Vessel position stream ───────────────────────────────────────────────────

export function connectVesselPositionStream(deps: SkDeps): void {
  const ws = new WebSocket(deps.skWebSocketUrl('/signalk/v1/stream?subscribe=none'));
  deps.state.vesselPositionWs = ws;
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
            deps.state.vesselPosition = { lat: v.value.latitude, lon: v.value.longitude };
            (document.getElementById('btn-vessel-position') as HTMLButtonElement).disabled = false;
            document.getElementById('btn-vessel-position')!.title = 'Set start to vessel position';
          }
        }
      }
    } catch { /* ignore parse errors */ }
  };
  ws.onclose = () => {
    deps.state.vesselPosition = null;
    (document.getElementById('btn-vessel-position') as HTMLButtonElement).disabled = true;
    document.getElementById('btn-vessel-position')!.title = 'Vessel position not available';
    deps.state.vesselPositionWs = null;
    setTimeout(() => connectVesselPositionStream(deps), 5000);
  };
}

export function handleVesselPositionClick(deps: SkDeps): void {
  if (!deps.state.vesselPosition) return;
  const { lat, lon } = deps.state.vesselPosition;
  deps.state.startLatLon = { lat, lon };
  deps.startCoords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  deps.startMarker.setLatLng([lat, lon]).addTo(deps.map);
  clearRouteWaypoints(deps);
  deps.updateCalcButton();
}
