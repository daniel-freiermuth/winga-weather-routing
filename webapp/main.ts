// Weather Routing webapp — main thread.
// Manages Leaflet map, sidebar controls, SignalK integration, and worker dispatch.

import L from 'leaflet';
import { fetchRoutes } from './lib/signalk';
import type { SkRoute } from './lib/signalk';
import type { BoundingBox, LatLon, RoutePoint } from '../src/types';

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const routeSelect = document.getElementById('route-select') as HTMLSelectElement;
const departureInput = document.getElementById('departure-time') as HTMLInputElement;
const polarInput = document.getElementById('polar-file') as HTMLInputElement;
const polarStatus = document.getElementById('polar-status')!;
const windModelSelect = document.getElementById('wind-model') as HTMLSelectElement;
const landAvoidance = document.getElementById('land-avoidance') as HTMLInputElement;
const calculateBtn = document.getElementById('calculate-btn') as HTMLButtonElement;
const resultPanel = document.getElementById('result-panel')!;
const statusText = document.getElementById('status-text')!;
const progressBar = document.getElementById('progress-bar')!;
const progressFill = document.getElementById('progress-fill')!;
const versionEl = document.getElementById('version')!;

// ── State ─────────────────────────────────────────────────────────────────────

let routes: SkRoute[] = [];
let polarCsv: string | null = null;
let calculating = false;

// ── Map ───────────────────────────────────────────────────────────────────────

const map = L.map('map').setView([57.7, 18.3], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 18,
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
const resultLayer = L.layerGroup().addTo(map);

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface WorkerMessage {
  type: 'progress' | 'result' | 'error';
  pct?: number;
  frontier?: [number, number][];
  route?: RoutePoint[];
  warning?: string;
  message?: string;
}

worker.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as WorkerMessage;

  if (msg.type === 'progress') {
    const pct = Math.round(msg.pct ?? 0);
    statusText.textContent = `Routing… ${String(pct)}%`;
    progressFill.style.width = `${String(pct)}%`;
  } else if (msg.type === 'result') {
    calculating = false;
    calculateBtn.disabled = false;
    progressBar.style.display = 'none';
    const route = msg.route ?? [];
    statusText.textContent = msg.warning ?? `Route ready — ${String(route.length)} waypoints`;
    displayRoute(route);
  } else if (msg.type === 'error') {
    calculating = false;
    calculateBtn.disabled = false;
    progressBar.style.display = 'none';
    statusText.textContent = `Error: ${msg.message ?? 'unknown'}`;
  }
});

// ── Route display ─────────────────────────────────────────────────────────────

function displaySelectedRoute(route: SkRoute): void {
  routeLayer.clearLayers();
  if (route.coordinates.length === 0) return;

  // GeoJSON [lon, lat] → Leaflet [lat, lon]
  const latlngs: L.LatLngExpression[] = route.coordinates.map(([lon, lat]) => [lat, lon]);
  L.polyline(latlngs, { color: '#a6adc8', weight: 2, dashArray: '6,4' }).addTo(routeLayer);

  // Waypoint markers
  for (const [i, [lon, lat]] of route.coordinates.entries()) {
    L.circleMarker([lat, lon], {
      radius: 4, color: '#89b4fa', fillColor: '#89b4fa', fillOpacity: 1,
    }).bindTooltip(`WP ${String(i + 1)}`, { direction: 'top', offset: [0, -8] })
      .addTo(routeLayer);
  }

  // Fit map to route
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [40, 40] });
}

function displayRoute(route: RoutePoint[]): void {
  resultLayer.clearLayers();
  if (route.length === 0) return;

  const latlngs: L.LatLngExpression[] = route.map((p) => [p.lat, p.lon]);
  L.polyline(latlngs, { color: '#f38ba8', weight: 3 }).addTo(resultLayer);

  // ETA labels at select waypoints (every ~3h or first/last)
  let lastLabelTime = 0;
  for (const [i, p] of route.entries()) {
    const isEndpoint = i === 0 || i === route.length - 1;
    const timeDiff = p.time.getTime() - lastLabelTime;
    if (!isEndpoint && timeDiff < 3 * 3_600_000) continue;
    lastLabelTime = p.time.getTime();

    const windKn = Math.round(p.tws * 10) / 10;
    const label = `${p.time.toISOString().slice(5, 16).replace('T', ' ')}\n${String(windKn)} kn ${String(Math.round(p.windDir))}°`;

    L.circleMarker([p.lat, p.lon], {
      radius: 3, color: '#f38ba8', fillColor: '#f38ba8', fillOpacity: 1,
    }).bindTooltip(label, { direction: 'top', permanent: isEndpoint, offset: [0, -8] })
      .addTo(resultLayer);
  }

  // Build result summary table
  const first = route[0];
  const last = route[route.length - 1];
  if (first !== undefined && last !== undefined) {
    const durationH = (last.time.getTime() - first.time.getTime()) / 3_600_000;
    resultPanel.innerHTML = `
      <table>
        <tr><td>Departure</td><td class="wx-val">${first.time.toISOString().slice(0, 16).replace('T', ' ')} UTC</td></tr>
        <tr><td>ETA</td><td class="wx-val">${last.time.toISOString().slice(0, 16).replace('T', ' ')} UTC</td></tr>
        <tr><td>Duration</td><td class="wx-val">${durationH.toFixed(1)} h</td></tr>
        <tr><td>Waypoints</td><td class="wx-val">${String(route.length)}</td></tr>
      </table>`;
    resultPanel.style.display = 'block';
  }
}

// ── Controls ──────────────────────────────────────────────────────────────────

function updateCalculateButton(): void {
  const routeSelected = routeSelect.value !== '';
  const hasPolar = polarCsv !== null;
  const hasDeparture = departureInput.value !== '';
  calculateBtn.disabled = calculating || !routeSelected || !hasPolar || !hasDeparture;
}

// Route selector
routeSelect.addEventListener('change', () => {
  const route = routes.find((r) => r.id === routeSelect.value);
  if (route !== undefined) displaySelectedRoute(route);
  updateCalculateButton();
});

// Departure default: next 3h rounded to nearest hour
const now = new Date();
now.setMinutes(0, 0, 0);
now.setHours(now.getHours() + 3);
departureInput.value = now.toISOString().slice(0, 16);
departureInput.addEventListener('change', updateCalculateButton);

// Polar file upload
polarInput.addEventListener('change', () => {
  const file = polarInput.files?.[0];
  if (file === undefined) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    polarCsv = reader.result as string;
    polarStatus.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    polarStatus.style.color = '#a6e3a1';
    updateCalculateButton();
  });
  reader.readAsText(file);
});

// Calculate
calculateBtn.addEventListener('click', () => {
  const route = routes.find((r) => r.id === routeSelect.value);
  if (route === undefined || polarCsv === null) return;

  // Build bounding box with 2° margin around the route
  let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  for (const [lon, lat] of route.coordinates) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  const margin = 2;
  const tileBbox: BoundingBox = {
    latMin: latMin - margin,
    latMax: latMax + margin,
    lonMin: lonMin - margin,
    lonMax: lonMax + margin,
  };

  // Route waypoints in {lat, lon} order
  const waypoints: LatLon[] = route.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const start = waypoints[0];
  const end = waypoints[waypoints.length - 1];
  if (start === undefined || end === undefined) return;

  calculating = true;
  calculateBtn.disabled = true;
  resultPanel.style.display = 'none';
  resultLayer.clearLayers();
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';
  statusText.textContent = 'Starting…';

  // Land index URL — in production, served by the SK plugin.
  // In dev, Vite serves static files from the webapp root.
  const landIndexUrl = './data/edge-index.bin.gz';

  worker.postMessage({
    type: 'calculate',
    payload: {
      request: {
        start,
        end,
        waypoints: waypoints.slice(1, -1), // intermediate waypoints
        departureTime: new Date(departureInput.value).toISOString(),
        useLandAvoidance: landAvoidance.checked,
      },
      polarCsv,
      tileBbox,
      landIndexUrl,
      windModel: windModelSelect.value,
      useSafetyMargin: false,
    },
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  versionEl.textContent = `v${__APP_VERSION__} (${__APP_COMMIT__})`;
  statusText.textContent = 'Fetching routes…';

  routes = await fetchRoutes();

  routeSelect.innerHTML = '';
  if (routes.length === 0) {
    routeSelect.innerHTML = '<option value="">No routes found (SK server unreachable?)</option>';
  } else {
    routeSelect.innerHTML = '<option value="">— select a route —</option>';
    for (const r of routes) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.name} (${String(r.coordinates.length)} pts)`;
      routeSelect.appendChild(opt);
    }
  }

  statusText.textContent = `Ready — ${String(routes.length)} route(s) loaded`;
  updateCalculateButton();
}

void init();
