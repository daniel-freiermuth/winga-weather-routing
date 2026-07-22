// Calculation orchestration — wires the routing worker, draws results,
// and manages scrubber highlighting for the calculated route.

import type { WaypointMeta, GraphLayout, RouteData, GribFileMeta } from './types';
import type { ScrubberState } from './scrubber-controller';
import { fmt as _fmt, toDisplay as _toDisplay } from './units';
import { drawRoute } from './route-display';
import { buildConditionsGraph } from './conditions-graph';
import { buildWorkerPayload, renderIsochrone } from './routing-engine';
import * as scrubberCtrl from './scrubber-controller';

declare const L: typeof import('leaflet');

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
  routeLayer: L.Polyline | null;
  windBarbLayer: L.LayerGroup | null;
  legLabelLayer: L.LayerGroup | null;
  highlightLegLayer: L.Polyline | null;
  windBarbMarkers: (L.Marker | null)[];
  routeLegCoords: L.LatLngTuple[][];
  prevHighlightWpIdx: number;
  graphMeta: WaypointMeta[] | null;
  graphLayout: GraphLayout | null;
  calcStream: { close(): void } | null;
  pendingRouteData: RouteData | null;
}

/** All dependencies the calculation module needs from the app shell. */
export interface CalculationContext {
  map: L.Map;
  routingWorker: Worker;
  isochroneLayerGroup: L.LayerGroup;

  // Fixed DOM refs
  progressWrap: HTMLElement;
  progressBar: HTMLElement;
  calcBtn: HTMLButtonElement;
  landToggle: HTMLInputElement;

  // Callbacks
  setStatus(type: string, msg: string): void;
  showFailurePopup(msg: string, isWarning: boolean): void;
  fetchWindPointsAt(timeIdx: number): Promise<void>;
  fetchWavePointsAt(timeIdx: number): Promise<void>;
  scrubberState(): ScrubberState;

  // Getters for read-only state owned by app.ts
  getStartLatLon(): LatLon | null;
  getEndLatLon(): LatLon | null;
  getRouteWaypoints(): LatLon[];
  getRoutingOptions(): RoutingOptionsLike | null;
  getAppInstance(): Record<string, unknown>;
  getWindSpeedMs(): boolean;
  getWindTimes(): string[];
  getWindTimesLoaded(): boolean;
  getConditionsGraphHeight(): number;
  getConditionsExpanded(): boolean;
  getConditionsFullscreen(): boolean;
  getGribInfoFiles(): GribFileMeta[];
  getForecastSkillHorizonHours(): number;

  /** Shared mutable state — app.ts creates and proxies to its own lets. */
  state: CalcMutableState;
}

export interface CalculationApi {
  startCalculation(): Promise<void>;
  drawRouteFromData(route: RouteData): void;
  fetchAndDrawRoute(): void;
  updateScrubberHighlight(windTimeIdx: number): void;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
  const panel = document.getElementById('conditions-panel')!;
  const result = buildConditionsGraph({
    meta, intermediateIdxs, windSpeedMs: ctx.getWindSpeedMs(), gribInfoFiles: ctx.getGribInfoFiles(),
    c64Palette: C64_PALETTE, forecastSkillHorizonHours: ctx.getForecastSkillHorizonHours(),
    toDisplay: _toDisplay, fmt: _fmt,
  });
  if (!result) { panel.style.display = 'none'; return; }
  ctx.state.graphMeta = meta;
  ctx.state.graphLayout = result.layout;
  document.getElementById('conditions-y-left')!.innerHTML = '';
  const rightAxis = document.getElementById('conditions-y-right')!;
  const rightSpacer = document.getElementById('time-scrubber-right-spacer')!;
  if (result.hasWave) {
    rightAxis.style.display = 'block';
    rightSpacer.style.display = 'block';
  } else {
    rightAxis.style.display = 'none';
    rightSpacer.style.display = 'none';
    rightAxis.innerHTML = '';
  }
  const svgEl = document.getElementById('conditions-svg')!;
  svgEl.setAttribute('viewBox', result.viewBox);
  svgEl.innerHTML = result.svgContent;
  if (!ctx.getConditionsFullscreen()) panel.style.height = ctx.getConditionsExpanded() ? `${String(ctx.getConditionsGraphHeight())}px` : '24px';
  panel.style.display = 'flex';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wire the routing worker listener and return calculation functions
 * that close over the provided context.
 */
export function setupCalculation(ctx: CalculationContext): CalculationApi {
  const { map, routingWorker, isochroneLayerGroup, state } = ctx;

  function fetchAndDrawRoute() {
    if (state.pendingRouteData) drawRouteFromData(state.pendingRouteData);
  }

  function drawRouteFromData(route: RouteData) {
    try {
      if (state.routeLayer) map.removeLayer(state.routeLayer);
      if (state.windBarbLayer) map.removeLayer(state.windBarbLayer);
      if (state.legLabelLayer) map.removeLayer(state.legLabelLayer);
      if (state.highlightLegLayer) { map.removeLayer(state.highlightLegLayer); state.highlightLegLayer = null; }
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
        scrubberCtrl.lockToRoute(i0, iN, windTimes, ctx.scrubberState());
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
    if (state.highlightLegLayer) { map.removeLayer(state.highlightLegLayer); state.highlightLegLayer = null; }
    for (let i = 0; i < state.windBarbMarkers.length; i++) {
      const m = state.windBarbMarkers[i];
      if (!m) continue;
      m.setOpacity(i === wpIdx ? 1 : 0.4);
    }
    if (legIdx >= 0 && state.routeLegCoords[legIdx]) {
      state.highlightLegLayer = L.polyline(state.routeLegCoords[legIdx]!, {
        color: '#f5c2e7', weight: 4, opacity: 0.9,
      }).addTo(map);
    }
  }

  async function startCalculation() {
    const startLatLon = ctx.getStartLatLon();
    const endLatLon = ctx.getEndLatLon();
    if (!startLatLon || !endLatLon) return;
    state.routeScrubberRange = null;
    state.scrubberLockedToRoute = false;
    document.getElementById('scrubber-range-toggle')!.style.display = 'none';

    const appInst = ctx.getAppInstance();
    const getRegionOverlay = appInst['getRegionOverlay'];
    if (typeof getRegionOverlay === 'function') {
      const overlay = getRegionOverlay() as { reload(): Promise<void> } | undefined;
      if (overlay) await overlay.reload();
    }

    const depTime = (document.getElementById('departure-time') as HTMLInputElement).value;
    if (!depTime) return ctx.setStatus('error', 'Please set a departure time');

    if (isochroneLayerGroup) isochroneLayerGroup.clearLayers();
    if (state.routeLayer) { map.removeLayer(state.routeLayer); state.routeLayer = null; }
    if (state.windBarbLayer) { map.removeLayer(state.windBarbLayer); state.windBarbLayer = null; }
    if (state.legLabelLayer) { map.removeLayer(state.legLabelLayer); state.legLabelLayer = null; }
    if (state.highlightLegLayer) { map.removeLayer(state.highlightLegLayer); state.highlightLegLayer = null; }
    document.getElementById('conditions-panel')!.style.display = 'none';
    ctx.progressWrap.style.display = '';
    ctx.progressBar.style.width = '0%';
    ctx.calcBtn.disabled = true;
    ctx.landToggle.disabled = true;
    ctx.landToggle.style.opacity = '0.4';
    if (state.calcStream) { state.calcStream.close(); state.calcStream = null; }

    ctx.setStatus('', 'Starting calculation…');

    const polarCsv = window._polarCsv as string | undefined;
    if (!polarCsv) {
      ctx.setStatus('error', 'No polar diagram loaded — upload a polar CSV file');
      ctx.calcBtn.disabled = false;
      ctx.landToggle.disabled = false;
      ctx.landToggle.style.opacity = '';
      return;
    }

    state.pendingRouteData = null;
    const opts = ctx.getRoutingOptions()?.getOptions();

    routingWorker.postMessage(buildWorkerPayload({
      start: startLatLon,
      end: endLatLon,
      departureTime: new Date(depTime).toISOString(),
      waypoints: ctx.getRouteWaypoints().length > 0 ? ctx.getRouteWaypoints() : undefined,
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
    const j = e.data as { type: string; pct?: number; progress?: number; frontier?: number[][]; route?: RouteData; error?: string };
    if (j.type === 'progress') {
      const pct = Math.round(j.pct ?? j.progress ?? 0);
      ctx.progressBar.style.width = `${String(pct)}%`;
      ctx.setStatus('', `Calculating… ${String(pct)}%`);
      if (j.frontier?.length && (document.getElementById('isochrone-toggle') as HTMLInputElement).checked) {
        renderIsochrone(j.frontier, ctx.getStartLatLon()!, isochroneLayerGroup);
      }
    } else if (j.type === 'result') {
      ctx.progressWrap.style.display = 'none';
      ctx.calcBtn.disabled = false;
      ctx.landToggle.disabled = false;
      ctx.landToggle.style.opacity = '';
      if (j.route) {
        state.pendingRouteData = j.route;
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
