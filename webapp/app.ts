// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Detects the SignalK server, creates the MapLibre map, and mounts <App>.
// All logic lives in App.svelte and its modules.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

declare global {
  interface Window {
    _polarCsv?: string;
    _routeWeatherMarkers?: import('maplibre-gl').Marker[];
  }
}

import { mapInstance } from './stores';
import { mount } from 'svelte';
import App from './components/App.svelte';
import { escapeHtml } from './utils';

// ── SignalK Server URL ────────────────────────────────────────────────────────

function detectSkBase(): string {
  let stored = localStorage.getItem('wr-signalk-url');
  if (stored) {
    stored = stored.trim().replace(/\/+$/, '');
    if (stored && !stored.startsWith('http://') && !stored.startsWith('https://')) {
      stored = 'http://' + stored;
      localStorage.setItem('wr-signalk-url', stored);
    }
    return stored;
  }
  if (location.pathname.includes('signalk-weather-routing') || location.port === '3000') return '';
  return '';
}

const SK_BASE = detectSkBase();

function skFetch(path: string, options?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : SK_BASE + path;
  return fetch(url, { ...options, credentials: SK_BASE ? 'omit' : 'same-origin' });
}

function skWebSocketUrl(path: string): string {
  if (SK_BASE) return SK_BASE.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

// ── Mount App ─────────────────────────────────────────────────────────────────

mount(App, {
  target: document.getElementById('app')!,
  props: { skFetch, skWebSocketUrl, escapeHtml },
});

// ── Create MapLibre map ───────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  center: [18, 57],
  zoom: 6,
  // SignalK helmet sets Referrer-Policy: no-referrer — override for tile requests
  transformRequest: (url: string) => ({
    url,
    referrerPolicy: 'strict-origin-when-cross-origin' as ReferrerPolicy,
  }),
});
mapInstance.set(map);
