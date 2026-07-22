// Map interaction handlers — placement clicks, info popups, viewport-change re-fetches,
// test routes, and marker icon factories.

import maplibregl from 'maplibre-gl';

import type { WindPoint, WavePoint, CurrentPoint } from './stores';
import { fmt as _fmt } from './units';

export type LatLon = { lat: number; lon: number };

// ── Marker icons ──────────────────────────────────────────────────────────────

export function greenIcon(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = '<div style="background:#a6e3a1;width:12px;height:12px;border-radius:50%;border:2px solid #1e2230"></div>';
  return el;
}

export function redIcon(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = '<div style="background:#f38ba8;width:12px;height:12px;border-radius:50%;border:2px solid #1e2230"></div>';
  return el;
}

// ── Placement mode ────────────────────────────────────────────────────────────

export interface PlacementCallbacks {
  setStatus(type: string, msg: string): void;
  getPlacing(): string | null;
  setPlacing(v: string | null): void;
  setStartLatLon(ll: LatLon): void;
  setEndLatLon(ll: LatLon): void;
  clearRouteWaypoints(): void;
  updateCalcButton(): void;
}

/**
 * Set the map cursor to crosshair and record which endpoint is being placed.
 */
export function activatePlacing(
  map: maplibregl.Map,
  which: string,
  cb: Pick<PlacementCallbacks, 'setStatus' | 'setPlacing'>,
) {
  cb.setPlacing(which);
  cb.setStatus('', `Click on the map to set ${which} point`);
  map.getCanvas().style.cursor = 'crosshair';
}

/**
 * Register the click-to-place handler. Returns a cleanup function.
 */
export function setupPlacementClick(
  map: maplibregl.Map,
  startMarker: maplibregl.Marker,
  endMarker: maplibregl.Marker,
  startCoords: HTMLElement,
  endCoords: HTMLElement,
  cb: PlacementCallbacks,
): () => void {
  const handler = (e: maplibregl.MapMouseEvent) => {
    const placing = cb.getPlacing();
    if (!placing) return;
    const { lat, lng } = e.lngLat;
    if (placing === 'start') {
      cb.setStartLatLon({ lat, lon: lng });
      startCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      startMarker.setLngLat([lng, lat]).addTo(map);
      cb.clearRouteWaypoints();
    } else if (placing === 'end') {
      cb.setEndLatLon({ lat, lon: lng });
      endCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      endMarker.setLngLat([lng, lat]).addTo(map);
    }
    cb.setPlacing(null);
    map.getCanvas().style.cursor = '';
    cb.updateCalcButton();
  };
  map.on('click', handler);
  return () => map.off('click', handler);
}

// ── Info popup (wind/wave/current on click) ───────────────────────────────────

export interface InfoPopupState {
  allWindPoints: WindPoint[];
  allWavePoints: WavePoint[];
  allCurrentPoints: CurrentPoint[];
  windSpeedMs: boolean;
}

/**
 * Register the info-popup click handler. Returns a cleanup function.
 */
export function setupInfoPopupClick(
  map: maplibregl.Map,
  getState: () => InfoPopupState,
): () => void {
  const handler = (e: maplibregl.MapMouseEvent) => {
    const { lat, lng } = e.lngLat;
    const state = getState();
    const lines: string[] = [];
    if (state.allWindPoints.length > 0 && (document.getElementById('wind-overlay-toggle') as HTMLInputElement | null)?.checked) {
      const wp = state.allWindPoints.find((p) => Math.abs(p.lat - lat) < 0.04 && Math.abs(p.lon - lng) < 0.04);
      if (wp) {
        const twsKn = Math.sqrt(wp.u * wp.u + wp.v * wp.v) * 1.94384;
        const twsFmt = _fmt(twsKn, 'speed', state.windSpeedMs);
        const dir = Math.round(((Math.atan2(-wp.u, -wp.v) * 180) / Math.PI + 360) % 360);
        lines.push(`Wind: ${twsFmt.num} ${twsFmt.sym} from ${String(dir)}°T<br><span style="font-size:10px;color:#a6adc8">${wp.lat.toFixed(4)}°N ${wp.lon.toFixed(4)}°E</span>`);
      }
    }
    if (state.allWavePoints.length > 0 && (document.getElementById('wave-overlay-toggle') as HTMLInputElement | null)?.checked) {
      const wp = state.allWavePoints.find((p) => Math.abs(p.lat - lat) < 0.04 && Math.abs(p.lon - lng) < 0.04 && p.waveHeight != null);
      if (wp) {
        const waveFmt = _fmt(wp.waveHeight, 'depth');
        lines.push(`Wave: ${waveFmt.num} ${waveFmt.sym}`);
      }
    }
    if (state.allCurrentPoints.length > 0 && (document.getElementById('current-overlay-toggle') as HTMLInputElement | null)?.checked) {
      const cp = state.allCurrentPoints.find((p) => Math.abs(p.lat - lat) < 0.06 && Math.abs(p.lon - lng) < 0.06);
      if (cp) {
        const spdKn = (Math.sqrt(cp.u * cp.u + cp.v * cp.v) * 1.94384).toFixed(1);
        const dir = Math.round(((Math.atan2(cp.u, cp.v) * 180) / Math.PI + 360) % 360);
        lines.push(`Current: ${spdKn} kn → ${String(dir)}°T`);
      }
    }
    if (lines.length > 0) new maplibregl.Popup({ closeOnClick: true }).setLngLat([lng, lat]).setHTML(lines.join('<br>')).addTo(map);
  };
  map.on('click', handler);
  return () => map.off('click', handler);
}

// ── Viewport change handler ───────────────────────────────────────────────────

export interface ViewportCallbacks {
  fetchWindPointsAt(timeIdx: number): void;
  fetchWavePointsAt(timeIdx: number): void;
  isWindTimesLoaded(): boolean;
}

/**
 * Re-fetch overlay data when the viewport changes. Returns a cleanup function.
 */
export function setupViewportRefresh(
  map: maplibregl.Map,
  cb: ViewportCallbacks,
): () => void {
  const handler = () => {
    const windToggle = document.getElementById('wind-overlay-toggle') as HTMLInputElement | null;
    const waveToggle = document.getElementById('wave-overlay-toggle') as HTMLInputElement | null;
    const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
    if (windToggle?.checked && cb.isWindTimesLoaded()) {
      const idx = parseInt(scrubber?.value ?? '0') || 0;
      cb.fetchWindPointsAt(idx);
    }
    if (waveToggle?.checked && cb.isWindTimesLoaded()) {
      const idx = parseInt(scrubber?.value ?? '0') || 0;
      cb.fetchWavePointsAt(idx);
    }
  };
  map.on('moveend', handler);
  return () => { map.off('moveend', handler); };
}

// ── Test routes ───────────────────────────────────────────────────────────────

export interface TestRouteCallbacks {
  setStartLatLon(ll: LatLon): void;
  setEndLatLon(ll: LatLon): void;
  clearRouteWaypoints(): void;
  updateCalcButton(): void;
}

const OREGRUND: LatLon = { lat: 60.3996, lon: 18.3403 };

export function setTestRoute(
  map: maplibregl.Map,
  startMarker: maplibregl.Marker,
  endMarker: maplibregl.Marker,
  startCoords: HTMLElement,
  endCoords: HTMLElement,
  s: LatLon,
  e: LatLon,
  departureValue: string,
  cb: TestRouteCallbacks,
) {
  cb.setStartLatLon(s);
  cb.setEndLatLon(e);
  startCoords.textContent = `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
  endCoords.textContent = `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`;
  startMarker.setLngLat([s.lon, s.lat]).addTo(map);
  endMarker.setLngLat([e.lon, e.lat]).addTo(map);
  (document.getElementById('departure-time') as HTMLInputElement).value = departureValue;
  cb.clearRouteWaypoints();
  cb.updateCalcButton();
}

export function runTest(
  map: maplibregl.Map, startMarker: maplibregl.Marker, endMarker: maplibregl.Marker,
  startCoords: HTMLElement, endCoords: HTMLElement, cb: TestRouteCallbacks,
) {
  setTestRoute(map, startMarker, endMarker, startCoords, endCoords, OREGRUND, { lat: 58.5052, lon: 17.3474 }, '2026-05-24T08:00', cb);
}

export function runHelsinkiTest(
  map: maplibregl.Map, startMarker: maplibregl.Marker, endMarker: maplibregl.Marker,
  startCoords: HTMLElement, endCoords: HTMLElement, cb: TestRouteCallbacks,
) {
  setTestRoute(map, startMarker, endMarker, startCoords, endCoords, OREGRUND, { lat: 60.0881, lon: 24.953 }, '2026-06-06T02:00', cb);
}

export function runGothenburgTest(
  map: maplibregl.Map, startMarker: maplibregl.Marker, endMarker: maplibregl.Marker,
  startCoords: HTMLElement, endCoords: HTMLElement, cb: TestRouteCallbacks,
) {
  setTestRoute(map, startMarker, endMarker, startCoords, endCoords, OREGRUND, { lat: 57.6138, lon: 11.598 }, '2026-06-06T02:00', cb);
}
