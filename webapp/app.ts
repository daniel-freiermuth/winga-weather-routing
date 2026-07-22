// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Detects the SignalK server, creates the Leaflet map, and mounts <App>.
// All logic lives in App.svelte and its modules.

declare const L: typeof import('leaflet');

declare global {
  interface Window {
    _map: L.Map;
    _routeWeatherMarkers?: L.CircleMarker[];
    _polarCsv?: string;
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

// ── Create Leaflet map ────────────────────────────────────────────────────────

const map = L.map('map').setView([57, 18], 6);
window._map = map;
mapInstance.set(map);

map.createPane('windBarbPane').style.zIndex = '350';
map.createPane('waypointMarkerPane').style.zIndex = '345';
map.createPane('windOverlayPane').style.zIndex = '300';
map.createPane('currentOverlayPane').style.zIndex = '295';
map.createPane('landPane').style.zIndex = '250';
map.createPane('landDilatedPane').style.zIndex = '248';
map.createPane('regionPane').style.zIndex = '240';
