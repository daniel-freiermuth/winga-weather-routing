// SignalK REST + WebSocket client for the planning webapp.
// Connects to the SK server (same origin in production, proxied in dev).

export interface SkRoute {
  id: string;
  name: string;
  coordinates: [number, number][]; // [lon, lat] GeoJSON order
}

export interface SkWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface VesselPosition {
  lat: number;
  lon: number;
}

/**
 * Fetch all saved routes from the SignalK Resources API.
 * Returns an empty array if the server is unreachable.
 */
export async function fetchRoutes(baseUrl = ''): Promise<SkRoute[]> {
  try {
    const resp = await fetch(`${baseUrl}/signalk/v2/api/resources/routes`);
    if (!resp.ok) return [];
    const data: unknown = await resp.json();
    if (typeof data !== 'object' || data === null) return [];

    const routes: SkRoute[] = [];
    const entries = Object.entries(data as Record<string, unknown>);
    for (const [id, raw] of entries) {
      if (typeof raw !== 'object' || raw === null) continue;
      const route = raw as Record<string, unknown>;
      const name = typeof route['name'] === 'string' ? route['name'] : id;
      const feature = route['feature'] as Record<string, unknown> | undefined;
      const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
      const coords = geometry?.['coordinates'] as [number, number][] | undefined;
      if (coords !== undefined && Array.isArray(coords)) {
        routes.push({ id, name, coordinates: coords });
      }
    }
    return routes;
  } catch {
    return [];
  }
}

/**
 * Fetch all saved waypoints from the SignalK Resources API.
 */
export async function fetchWaypoints(baseUrl = ''): Promise<SkWaypoint[]> {
  try {
    const resp = await fetch(`${baseUrl}/signalk/v2/api/resources/waypoints`);
    if (!resp.ok) return [];
    const data: unknown = await resp.json();
    if (typeof data !== 'object' || data === null) return [];

    const waypoints: SkWaypoint[] = [];
    const entries = Object.entries(data as Record<string, unknown>);
    for (const [id, raw] of entries) {
      if (typeof raw !== 'object' || raw === null) continue;
      const wp = raw as Record<string, unknown>;
      const name = typeof wp['name'] === 'string' ? wp['name'] : id;
      const feature = wp['feature'] as Record<string, unknown> | undefined;
      const geometry = feature?.['geometry'] as Record<string, unknown> | undefined;
      const coords = geometry?.['coordinates'] as [number, number] | undefined;
      if (coords !== undefined && coords.length >= 2) {
        waypoints.push({ id, name, lon: coords[0], lat: coords[1] });
      }
    }
    return waypoints;
  } catch {
    return [];
  }
}

/**
 * Subscribe to vessel position updates via SignalK WebSocket.
 * Returns a cleanup function to close the connection.
 */
export function subscribePosition(
  onPosition: (pos: VesselPosition) => void,
  baseUrl = '',
): () => void {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/signalk/v1/stream?subscribe=none`;
  let ws: WebSocket | null = null;
  let closed = false;

  function connect(): void {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      ws?.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: 'navigation.position', period: 5000 }],
      }));
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          updates?: { values?: { path?: string; value?: { latitude?: number; longitude?: number } }[] }[];
        };
        for (const update of msg.updates ?? []) {
          for (const val of update.values ?? []) {
            if (val.path === 'navigation.position' && val.value !== undefined) {
              const { latitude, longitude } = val.value;
              if (latitude !== undefined && longitude !== undefined) {
                onPosition({ lat: latitude, lon: longitude });
              }
            }
          }
        }
      } catch { /* ignore parse errors */ }
    });
    ws.addEventListener('close', () => {
      if (!closed) setTimeout(connect, 5000);
    });
  }

  connect();
  return () => { closed = true; ws?.close(); };
}
