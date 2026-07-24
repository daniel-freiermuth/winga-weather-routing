// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Detects the SignalK server and mounts <App>.
// The MapLibre map is created declaratively via <MapLibre> in App.svelte.

import 'maplibre-gl/dist/maplibre-gl.css';

declare global {
  interface Window {
    _routeWeatherMarkers?: import('maplibre-gl').Marker[];
  }
}

import { mount } from 'svelte';
import App from './components/App.svelte';

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
  if (location.pathname.includes('winga-weather-routing') || location.pathname.includes('signalk-weather-routing') || location.port === '3000') return '';
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
  props: { skFetch, skWebSocketUrl },
});
