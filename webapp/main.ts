// Webapp main thread — Leaflet map + routing worker integration.

import L from 'leaflet';

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

const status = document.getElementById('status')!;

// ── Map ───────────────────────────────────────────────────────────────────────

const map = L.map('map').setView([57.7, 18.3], 7); // Baltic default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 18,
}).addTo(map);

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

worker.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; pct?: number; message?: string; route?: unknown; warning?: string };

  if (msg.type === 'progress') {
    status.textContent = `Routing… ${String(Math.round(msg.pct ?? 0))}%`;
  } else if (msg.type === 'result') {
    status.textContent = msg.warning ?? 'Route ready';
    console.log('[main] route:', msg.route);
  } else if (msg.type === 'error') {
    status.textContent = `Error: ${msg.message ?? 'unknown'}`;
  }
});

worker.addEventListener('error', (event: ErrorEvent) => {
  status.textContent = `Worker error: ${event.message}`;
});

// ── Status ────────────────────────────────────────────────────────────────────

status.textContent = `Weather Routing v${__APP_VERSION__} (${__APP_COMMIT__}) — ready`;
console.log(`[main] Weather Routing webapp loaded (v${__APP_VERSION__})`);
