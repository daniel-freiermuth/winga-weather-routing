// Calculation orchestration — wires the routing worker, draws results,
// and manages scrubber highlighting for the calculated route.

import maplibregl from 'maplibre-gl';
import type { WaypointMeta, GraphLayout, RouteData, GribFileMeta } from './types';
import type { ScrubberState } from './scrubber-controller';
import { fmt as _fmt, toDisplay as _toDisplay } from './units';
import { drawRoute } from './route-display';
import { buildConditionsGraph } from './conditions-graph';
import { buildWorkerPayload, renderIsochrone, clearIsochrones } from './routing-engine';
import type { IsochroneState } from './routing-engine';

type LatLon = { lat: number; lon: number };

const C64_PALETTE = [
  '#6c7086', '#ffffff', '#883932', '#67b6bd', '#8b3f96',
  '#55a049', '#40318d', '#bfce72', '#8b5429', '#574200',
];

export interface RoutingOptionsLike {
  getOptions: () => {
    useLandAvoidance: boolean;
    useSafetyMargin: boolean;
    motorBelowKn: number | undefined;
    motorSpeedKn: number | undefined;
    waitForWind: boolean | undefined;
    maxWindKn: number | undefined;
    maxWaveM: number | undefined;
    waypointLabels: boolean;
    waypointLabelInterval: number;
  };
}

/** Mutable state that app.ts owns but the calculation module reads/writes. */
export interface CalcMutableState {
  routeScrubberRange: { i0: number; iN: number } | null;
  scrubberLockedToRoute: boolean;
  routeLayer: { sourceId: string; layerId: string } | null;
  windBarbLayer: maplibregl.Marker[];
  legLabelLayer: maplibregl.Marker[];
  highlightLegLayer: { sourceId: string; layerId: string } | null;
  windBarbMarkers: (maplibregl.Marker | null)[];
  routeLegCoords: [number, number][][];
  prevHighlightWpIdx: number;
  graphMeta: WaypointMeta[] | null;
  graphLayout: GraphLayout | null;
  calcStream: { close(): void } | null;
  pendingRouteData: RouteData | null;
}

/** All dependencies the calculation module needs from the app shell. */
export interface CalculationContext {
  map: maplibregl.Map;
  routingWorker: Worker;
  isochroneState: IsochroneState;

  // Callbacks (replace DOM refs)
  setProgress(pct: number): void;
  setCalculating(v: boolean): void;
  setShowProgress(v: boolean): void;
  setStatus(type: string, msg: string): void;
  showFailurePopup(msg: string, isWarning: boolean): void;
  fetchWindPointsAt(timeIdx: number): Promise<void>;
  fetchWavePointsAt(timeIdx: number): Promise<void>;
  scrubberState(): ScrubberState;

  // Conditions graph callbacks (replace getElementById)
  setConditionsGraph(data: { svgContent: string; viewBox: string; hasWave: boolean; layout: GraphLayout } | null): void;
  setConditionsVisible(v: boolean): void;
  lockScrubberToRoute(i0: number, iN: number): void;
  setShowRangeToggle(v: boolean): void;

  // Getters for read-only state owned by App.svelte
  getStartLatLon(): LatLon | null;
  getEndLatLon(): LatLon | null;
  getRouteWaypoints(): LatLon[];
  getRoutingOptions(): RoutingOptionsLike | null;
  getWindSpeedMs(): boolean;
  getWindTimes(): string[];
  getWindTimesLoaded(): boolean;
  getDepartureTime(): string;
  getIsochroneEnabled(): boolean;
  getGribInfoFiles(): GribFileMeta[];
  getForecastSkillHorizonHours(): number;
  getPolarCsv(): string | undefined;

  /** Shared mutable state — App.svelte creates and proxies to its own lets. */
  state: CalcMutableState;
}

export interface CalculationApi {
  startCalculation(): Promise<void>;
  drawRouteFromData(route: RouteData): void;
  fetchAndDrawRoute(): void;
  updateScrubberHighlight(windTimeIdx: number): void;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function removeSourceAndLayer(map: maplibregl.Map, ids: { sourceId: string; layerId: string }) {
  if (map.getLayer(ids.layerId)) map.removeLayer(ids.layerId);
  if (map.getSource(ids.sourceId)) map.removeSource(ids.sourceId);
}

function findScrubberPosition(graphMeta: WaypointMeta[] | null, tMs: number) {
  if (!graphMeta || graphMeta.length < 2) return { wpIdx: -1, legIdx: -1 };
  for (let i = 0; i < graphMeta.length - 1; i++) {
    const t1 = new Date(graphMeta[i]!.time).getTime();
    const t2 = new Date(graphMeta[i + 1]!.time).getTime();
    if (tMs >= t1 && tMs <= t2) return { wpIdx: i, legIdx: i };
  }
  return { wpIdx: -1, legIdx: -1 };
}

function drawConditionsGraph(ctx: CalculationContext, meta: WaypointMeta[], intermediateIdxs: number[] = []) {
  const result = buildConditionsGraph({
    meta, intermediateIdxs, windSpeedMs: ctx.getWindSpeedMs(), gribInfoFiles: ctx.getGribInfoFiles(),
    c64Palette: C64_PALETTE, forecastSkillHorizonHours: ctx.getForecastSkillHorizonHours(),
    toDisplay: _toDisplay, fmt: _fmt,
  });
  if (!result) { ctx.setConditionsVisible(false); return; }
  ctx.state.graphMeta = meta;
  ctx.state.graphLayout = result.layout;
  ctx.setConditionsGraph({ svgContent: result.svgContent, viewBox: result.viewBox, hasWave: result.hasWave, layout: result.layout });
  ctx.setConditionsVisible(true);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wire the routing worker listener and return calculation functions
 * that close over the provided context.
 */
export function setupCalculation(ctx: CalculationContext): CalculationApi {
  const { map, routingWorker, state } = ctx;
  const isochroneState = ctx.isochroneState;

  function fetchAndDrawRoute() {
    if (state.pendingRouteData) drawRouteFromData(state.pendingRouteData);
  }

  function drawRouteFromData(route: RouteData) {
    try {
      if (state.routeLayer) removeSourceAndLayer(map, state.routeLayer);
      for (const m of state.windBarbLayer) m.remove();
      for (const m of state.legLabelLayer) m.remove();
      if (state.highlightLegLayer) { removeSourceAndLayer(map, state.highlightLegLayer); state.highlightLegLayer = null; }
      state.windBarbMarkers = [];
      state.routeLegCoords = [];
      state.prevHighlightWpIdx = -1;
      const routingOptions = ctx.getRoutingOptions();
      const result = drawRoute(route, {
        map, fmt: _fmt, windSpeedMs: ctx.getWindSpeedMs(),
        getWaypointLabels: () => {
          const opts = routingOptions?.getOptions();
          return { labels: opts?.waypointLabels ?? true, intervalH: opts?.waypointLabelInterval ?? 0 };
        },
        routeWaypoints: ctx.getRouteWaypoints(), setStatus: ctx.setStatus,
      });
      if (!result) return;
      state.routeLayer = result.routeLayer;
      state.windBarbLayer = result.windBarbLayer;
      state.legLabelLayer = result.legLabelLayer;
      state.windBarbMarkers = result.windBarbMarkers;
      state.routeLegCoords = result.routeLegCoords;
      drawConditionsGraph(ctx, result.meta, result.intermediateIdxs);
      const windTimes = ctx.getWindTimes();
      if (ctx.getWindTimesLoaded() && result.meta.length > 0) {
        const t0ms = new Date(result.meta[0]!.time).getTime();
        const tNms = new Date(result.meta[result.meta.length - 1]!.time).getTime();
        let i0 = windTimes.findIndex((t) => new Date(t).getTime() >= t0ms);
        let iN = windTimes.findIndex((t) => new Date(t).getTime() >= tNms);
        if (i0 < 0) i0 = 0;
        if (iN < 0) iN = windTimes.length - 1;
        ctx.lockScrubberToRoute(i0, iN);
        state.routeScrubberRange = { i0, iN };
        state.scrubberLockedToRoute = true;
        ctx.fetchWindPointsAt(i0);
        ctx.fetchWavePointsAt(i0);
      }
    } catch (e) {
      ctx.setStatus('error', `Draw failed: ${String(e)}`);
    }
  }

  function updateScrubberHighlight(windTimeIdx: number) {
    if (!state.graphMeta || state.graphMeta.length < 2 || !state.graphLayout) return;
    const windTimes = ctx.getWindTimes();
    const t = windTimes[windTimeIdx];
    if (!t) return;
    const tMs = new Date(t).getTime();
    const { wpIdx, legIdx } = findScrubberPosition(state.graphMeta, tMs);
    if (wpIdx === state.prevHighlightWpIdx) return;
    state.prevHighlightWpIdx = wpIdx;
    if (state.highlightLegLayer) { removeSourceAndLayer(map, state.highlightLegLayer); state.highlightLegLayer = null; }
    for (let i = 0; i < state.windBarbMarkers.length; i++) {
      const m = state.windBarbMarkers[i];
      if (!m) continue;
      m.getElement()!.style.opacity = i === wpIdx ? '1' : '0.4';
    }
    if (legIdx >= 0 && state.routeLegCoords[legIdx]) {
      const legCoords = state.routeLegCoords[legIdx]!;
      const sourceId = 'highlight-leg';
      const layerId = 'highlight-leg-line';
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            // routeLegCoords are [lat, lng] — convert to [lng, lat] for GeoJSON
            coordinates: legCoords.map(([lat, lng]) => [lng, lat]),
          },
        },
      });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': '#f5c2e7', 'line-width': 4, 'line-opacity': 0.9 },
      });
      state.highlightLegLayer = { sourceId, layerId };
    }
  }

  async function startCalculation() {
    const startLatLon = ctx.getStartLatLon();
    const endLatLon = ctx.getEndLatLon();
    if (!startLatLon || !endLatLon) return;
    state.routeScrubberRange = null;
    state.scrubberLockedToRoute = false;
    ctx.setShowRangeToggle(false);

    const depTime = ctx.getDepartureTime();
    if (!depTime) return ctx.setStatus('error', 'Please set a departure time');

    clearIsochrones(isochroneState);
    if (state.routeLayer) { removeSourceAndLayer(map, state.routeLayer); state.routeLayer = null; }
    for (const m of state.windBarbLayer) m.remove();
    state.windBarbLayer = [];
    for (const m of state.legLabelLayer) m.remove();
    state.legLabelLayer = [];
    if (state.highlightLegLayer) { removeSourceAndLayer(map, state.highlightLegLayer); state.highlightLegLayer = null; }
    ctx.setConditionsVisible(false);
    ctx.setShowProgress(true);
    ctx.setProgress(0);
    ctx.setCalculating(true);
    if (state.calcStream) { state.calcStream.close(); state.calcStream = null; }

    ctx.setStatus('', 'Starting calculation…');

    const polarCsv = ctx.getPolarCsv();
    if (!polarCsv) {
      ctx.setStatus('error', 'No polar diagram loaded — upload a polar CSV file');
      ctx.setCalculating(false);
      return;
    }

    state.pendingRouteData = null;
    const opts = ctx.getRoutingOptions()?.getOptions();

    // Unwrap Svelte $state proxies — structured cloning (postMessage) can't handle Proxy objects
    const plainStart = startLatLon ? { lat: startLatLon.lat, lon: startLatLon.lon } : startLatLon;
    const plainEnd = endLatLon ? { lat: endLatLon.lat, lon: endLatLon.lon } : endLatLon;
    const plainWaypoints = ctx.getRouteWaypoints().map(wp => ({ lat: wp.lat, lon: wp.lon }));

    routingWorker.postMessage(buildWorkerPayload({
      start: plainStart,
      end: plainEnd,
      departureTime: new Date(depTime).toISOString(),
      waypoints: plainWaypoints.length > 0 ? plainWaypoints : undefined,
      polarCsv,
      useLandAvoidance: opts?.useLandAvoidance ?? true,
      useSafetyMargin: opts?.useSafetyMargin ?? false,
      options: {
        motorBelowKn: opts?.motorBelowKn,
        motorSpeedKn: opts?.motorSpeedKn,
        waitForWind: opts?.waitForWind,
        maxWindKn: opts?.maxWindKn,
        maxWaveM: opts?.maxWaveM,
      },
    }));

    ctx.setStatus('', 'Calculating…');
  }

  // Wire worker message handler
  routingWorker.addEventListener('message', (e) => {
    const j = e.data as { type: string; pct?: number; progress?: number; frontier?: number[][]; route?: { lat: number; lon: number; time: string; heading: number; twa: number; tws: number; boatSpeed?: number; windDir: number; waveHeight?: number; gribFilePath?: string }[]; warning?: string; error?: string };
    if (j.type === 'progress') {
      const pct = Math.round(j.pct ?? j.progress ?? 0);
      ctx.setProgress(pct);
      ctx.setStatus('', `Calculating… ${String(pct)}%`);
      if (j.frontier?.length && ctx.getIsochroneEnabled()) {
        renderIsochrone(j.frontier, ctx.getStartLatLon()!, isochroneState);
      }
    } else if (j.type === 'result') {
      ctx.setShowProgress(false);
      ctx.setCalculating(false);
      if (j.route && j.route.length >= 2) {
        // Convert RoutePoint[] to GeoJSON RouteData
        const routeData: RouteData = {
          feature: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: j.route.map(p => [p.lon, p.lat]),
            },
            properties: {
              coordinatesMeta: j.route.map(p => {
                const meta: WaypointMeta = {
                  name: '',
                  time: typeof p.time === 'string' ? p.time : new Date(p.time as unknown as number).toISOString(),
                  windDir: p.windDir,
                  heading: p.heading,
                  twa: p.twa,
                  tws: p.tws,
                };
                if (p.boatSpeed != null) meta.boatSpeed = p.boatSpeed;
                if (p.waveHeight != null) meta.waveHeight = p.waveHeight;
                if (p.gribFilePath != null) meta.gribFile = p.gribFilePath;
                return meta;
              }),
            },
          },
        };
        state.pendingRouteData = routeData;
        ctx.setStatus('done', 'Route calculated');
        fetchAndDrawRoute();
      } else if (j.error) {
        ctx.setStatus('error', j.error);
        ctx.showFailurePopup(j.error, false);
      } else {
        ctx.setStatus('error', 'No route returned');
      }
    }
  });

  return { startCalculation, drawRouteFromData, fetchAndDrawRoute, updateScrubberHighlight };
}
