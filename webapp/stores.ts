// Shared reactive stores for the webapp.

import { writable } from 'svelte/store';
import type { WaypointWeather } from './route-weather';
import type { WaypointMeta, GraphLayout, RouteData, GribFileMeta } from './types';

declare const L: typeof import('leaflet');

// ── Types ─────────────────────────────────────────────────────────────────────

export type LatLon = { lat: number; lon: number };
export interface WindPoint { lat: number; lon: number; u: number; v: number }
export interface WavePoint { lat: number; lon: number; waveHeight: number }
export interface CurrentPoint { lat: number; lon: number; u: number; v: number }

export interface WaveGridMeta {
  latMin: number; latMax: number;
  lonMin: number; lonMax: number;
  latStep: number; lonStep: number;
}

// ── Map ───────────────────────────────────────────────────────────────────────

export const mapInstance = writable<L.Map | null>(null);

// ── Navigation / placement ────────────────────────────────────────────────────

export const startLatLon = writable<LatLon | null>(null);
export const endLatLon = writable<LatLon | null>(null);
export const placing = writable<string | null>(null);
export const vesselPosition = writable<LatLon | null>(null);
export const routeWaypoints = writable<LatLon[]>([]);
export const departureResources = writable<{ label: string; lat: number; lon: number }[]>([]);
export const waypointRoutes = writable<{ label: string; coords: number[][] }[]>([]);

// ── Overlay data ──────────────────────────────────────────────────────────────

export const windPoints = writable<WindPoint[]>([]);
export const wavePoints = writable<WavePoint[]>([]);
export const currentPoints = writable<CurrentPoint[]>([]);
export const waveGridMetaStore = writable<WaveGridMeta | null>(null);
export const waveOverlayMaxMStore = writable(3.0);

// ── Overlay visibility ────────────────────────────────────────────────────────

export const windOverlayVisible = writable(true);
export const waveOverlayVisible = writable(false);
export const currentOverlayVisible = writable(false);
export const landOverlayVisible = writable(false);
export const regionOverlayVisible = writable(false);
export const isochroneVisible = writable(true);

// ── Scrubber / time axis ──────────────────────────────────────────────────────

export const windTimes = writable<string[]>([]);
export const windTimesLoaded = writable(false);
export const scrubberIndex = writable(0);
export const scrubberLockedToRoute = writable(false);
export const routeScrubberRange = writable<{ i0: number; iN: number } | null>(null);

// ── Forecast / GRIB ───────────────────────────────────────────────────────────

export const forecastLoaded = writable(false);
export const skConnected = writable(false);
export const gribInfoFiles = writable<GribFileMeta[]>([]);
export const forecastSkillHorizonHours = writable(96);

// ── Calculation results ───────────────────────────────────────────────────────

export const pendingRouteData = writable<RouteData | null>(null);
export const graphMeta = writable<WaypointMeta[] | null>(null);
export const graphLayout = writable<GraphLayout | null>(null);
export const routeWeatherResults = writable<WaypointWeather[]>([]);

// ── UI state ──────────────────────────────────────────────────────────────────

export const statusMessage = writable<{ type: string; text: string }>({ type: '', text: 'Ready' });
export const conditionsExpanded = writable(true);
export const conditionsFullscreen = writable(false);
export const conditionsGraphHeight = writable(200);

// ── SignalK ───────────────────────────────────────────────────────────────────

/** Fetch wrapper that prepends the SK base URL */
export const skFetchFn = writable<((path: string, options?: RequestInit) => Promise<Response>) | null>(null);
