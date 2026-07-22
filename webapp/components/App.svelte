<script lang="ts">
  // Root application component — owns layout, state, and all event wiring.
  // app.ts creates the MapLibre map and mounts this component.

  import { mount, unmount } from 'svelte';
  import { get } from 'svelte/store';
  import ChartSelector from './ChartSelector.svelte';
  import LayerToggles from './LayerToggles.svelte';
  import RoutingOptions from './RoutingOptions.svelte';
  import PolarInput from './PolarInput.svelte';
  import SkServerSettings from './SkServerSettings.svelte';
  import TimeScrubber from './TimeScrubber.svelte';
  import ConditionsPanel from './ConditionsPanel.svelte';
  import Meteogram from './Meteogram.svelte';
  import WindOverlay from './WindOverlay.svelte';
  import WaveOverlay from './WaveOverlay.svelte';
  import CurrentOverlay from './CurrentOverlay.svelte';
  import LandOverlay from './LandOverlay.svelte';
  import RegionOverlay from './RegionOverlay.svelte';
  import RouteWeatherTable from './RouteWeatherTable.svelte';
  import SaveRouteModal from './SaveRouteModal.svelte';
  import DepartureSection from './DepartureSection.svelte';
  import ActionButtons from './ActionButtons.svelte';
  import Disclaimer from './Disclaimer.svelte';
  import FailurePopup from './FailurePopup.svelte';

  import type { WaypointMeta, GraphLayout, RouteData, UnitPref, GribFileMeta } from '../types';
  import { mapInstance, skConnected, forecastLoaded, routeWeatherResults, statusMessage } from '../stores';
  import { fmt as _fmt } from '../units';
  import { toLocalDateTimeInput } from '../utils';
  import * as forecaster from '../forecast-fetcher';
  import * as scrubberCtrl from '../scrubber-controller';
  import { createTimeAxis, loadWindyTimes, rebuildTimes } from '../time-axis';
  import { setupCalculation } from '../calculation';
  import type { CalcMutableState } from '../calculation';
  import { greenIcon, redIcon, activatePlacing as _activatePlacing, setupPlacementClick, setupInfoPopupClick, setupViewportRefresh, runTest as _runTest, runHelsinkiTest as _runHelsinkiTest, runGothenburgTest as _runGothenburgTest } from '../map-interaction';
  import type { PlacementCallbacks, TestRouteCallbacks } from '../map-interaction';
  import { setStatus as _setStatus, showFailurePopup, hideFailurePopup } from '../status';
  import { loadConfig as _loadConfig } from '../config';
  import type { ConfigState } from '../config';
  import { setupGraphTooltip } from '../graph-tooltip';
  import { loadDepartureResources as _loadDepartureResources, clearRouteWaypoints as _clearRouteWaypoints, loadWaypointRoutes as _loadWaypointRoutes, handleWaypointRouteChange, handleDepartureResourceChange, connectVesselPositionStream as _connectVesselPositionStream, handleVesselPositionClick } from '../sk-resources';
  import type { SkDeps } from '../sk-resources';
  import { analyseRouteWeather } from '../route-weather';
  import * as dataLayer from '../data-layer';
  import maplibregl from 'maplibre-gl';

  interface Props {
    skFetch: (path: string, options?: RequestInit) => Promise<Response>;
    skWebSocketUrl: (path: string) => string;
    escapeHtml: (s: string) => string;
  }

  let { skFetch, skWebSocketUrl, escapeHtml }: Props = $props();

  // ── State ─────────────────────────────────────────────────────────────────

  let regionEnabled = $state(false);
  let regionOverlayRef: { getAvoidIds: () => string[]; reload: () => Promise<void> } | undefined;

  // Reactive state — used in template bindings
  let vesselPosition = $state<{ lat: number; lon: number } | null>(null);
  let departureResources = $state<{ label: string; lat: number; lon: number }[]>([]);
  let pendingRouteData = $state<RouteData | null>(null);

  // Mutable state — internal, not directly in template
  let startLatLon: { lat: number; lon: number } | null = null;
  let endLatLon: { lat: number; lon: number } | null = null;
  let placing: string | null = null;
  let routeWaypoints: { lat: number; lon: number }[] = [];
  let routeWaypointMarkers: maplibregl.Marker[] = [];
  let waypointRoutes: { label: string; coords: number[][] }[] = [];
  let currentEnabled = true;
  let windSpeedMs = false;
  let waveOverlayMaxM = 3.0;
  let conditionsGraphHeight = 200;
  let windTimes: string[] = [];
  let windTimesCount = 0;
  let routeScrubberRange: { i0: number; iN: number } | null = null;
  let scrubberLockedToRoute = false;
  let windNativeTimes: string[] = [];
  let windTimesLoaded = false;
  let currentFileTimes: string[] = [];
  let gribInfoFiles: GribFileMeta[] = [];
  let dilatedIndexReady = false;
  let graphMeta: WaypointMeta[] | null = null;
  let graphLayout: GraphLayout | null = null;
  let unitPrefs: Record<string, UnitPref> | null = null;
  let forecastSkillHorizonHours = 96;
  let enabledGribPaths = new Set<string>();
  let timeAxis = createTimeAxis();

  // MapLibre layers / markers
  let routeLayer: { sourceId: string; layerId: string } | null = null;
  let windBarbLayer: maplibregl.Marker[] = [];
  let legLabelLayer: maplibregl.Marker[] = [];
  let windBarbMarkers: (maplibregl.Marker | null)[] = [];
  let routeLegCoords: [number, number][][] = [];
  let highlightLegLayer: { sourceId: string; layerId: string } | null = null;
  let prevHighlightWpIdx = -1;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setStatus(type: string, msg: string) {
    const el = document.getElementById('status-box');
    if (el) { el.className = type === 'error' || type === 'done' ? type : ''; el.textContent = msg; }
    statusMessage.set({ type, text: msg });
  }

  function timeAxisState() { return { windTimes, windNativeTimes, windTimesLoaded }; }

  async function fetchWindPointsAt(idx: number, signal?: AbortSignal) {
    await forecaster.fetchWindPoints(idx, timeAxisState(), signal);
    scrubberCtrl.updateLabel(idx, windTimes);
  }
  async function fetchWavePointsAt(idx: number, signal?: AbortSignal) {
    await forecaster.fetchWavePoints(idx, timeAxisState(), signal);
  }
  async function fetchCurrentPointsAt(timeMs: number, signal?: AbortSignal) {
    await forecaster.fetchCurrentPoints(timeMs, signal);
  }

  function scrubberState(): scrubberCtrl.ScrubberState {
    return { windTimes, scrubberLockedToRoute, routeScrubberRange, graphMeta, gribInfoFiles, enabledGribPaths, currentEnabled, currentFileTimes };
  }

  function rebuildScrubberTimes() {
    const result = rebuildTimes(timeAxis);
    timeAxis = result;
    windTimes = result.windTimes;
    windTimesCount = result.windTimesCount;
    windNativeTimes = result.windNativeTimes;
    windTimesLoaded = result.windTimesLoaded;
    scrubberCtrl.applyScrubberTimes(windTimes, scrubberState());
  }

  function useSafetyMargin(): boolean {
    return routingOptions?.getOptions().useSafetyMargin ?? false;
  }

  // ── Routing options ───────────────────────────────────────────────────────

  interface RoutingOptionsApi {
    getOptions: () => {
      useLandAvoidance: boolean; useSafetyMargin: boolean;
      motorBelowKn: number | undefined; motorSpeedKn: number | undefined;
      waitForWind: boolean | undefined; maxWindKn: number | undefined; maxWaveM: number | undefined;
      waypointLabels: boolean; waypointLabelInterval: number;
    };
  }
  let routingOptions: RoutingOptionsApi | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  // Wait for the map to be ready (style loaded) before initializing.
  // mapInstance is set by app.ts inside map.on('load').
  let mapInitialized = false;
  const unsubMap = mapInstance.subscribe((m) => {
    if (!m || mapInitialized) return;
    mapInitialized = true;
    unsubMap();
    const map = m;
    const isochroneState = { sourceIds: [] as string[], layerIds: [] as string[], count: 0, map };
    const routingWorker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    const startMarker = new maplibregl.Marker({ element: greenIcon(), anchor: 'center' }); // not added until placed
    const endMarker = new maplibregl.Marker({ element: redIcon(), anchor: 'center' });

    // DOM refs
    const startCoords = document.getElementById('start-coords')!;
    const endCoords = document.getElementById('end-coords')!;
    const calcBtn = document.getElementById('calculate') as HTMLButtonElement;
    const landToggle = document.getElementById('land-toggle') as HTMLInputElement;
    const progressWrap = document.getElementById('progress-bar-wrap')!;
    const progressBar = document.getElementById('progress-bar')!;
    const gribInfo = document.getElementById('grib-info')!;
    const analyseBtn = document.getElementById('analyse-weather-btn') as HTMLButtonElement;
    const routeWeatherPanel = document.getElementById('route-weather-panel')!;
    let routeWeatherInstance: Record<string, unknown> | null = null;


    // Departure time default
    const now = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
    (document.getElementById('departure-time') as HTMLInputElement).value = toLocalDateTimeInput(now);

    // RoutingOptions API
    // Access happens after render; RoutingOptions exports getOptions via Svelte instance
    const optEl = document.getElementById('routing-options-section');
    if (optEl) {
      setTimeout(() => {
        routingOptions = (optEl.querySelector('[data-routing-options]') as unknown as RoutingOptionsApi | null) ?? null;
      }, 0);
    }

    // ── Calculation module ──────────────────────────────────────────────

    let calcStream: { close(): void } | null = null;
    const calcState: CalcMutableState = {
      get routeScrubberRange() { return routeScrubberRange; }, set routeScrubberRange(v) { routeScrubberRange = v; },
      get scrubberLockedToRoute() { return scrubberLockedToRoute; }, set scrubberLockedToRoute(v) { scrubberLockedToRoute = v; },
      get routeLayer() { return routeLayer; }, set routeLayer(v) { routeLayer = v; },
      get windBarbLayer() { return windBarbLayer; }, set windBarbLayer(v) { windBarbLayer = v; },
      get legLabelLayer() { return legLabelLayer; }, set legLabelLayer(v) { legLabelLayer = v; },
      get highlightLegLayer() { return highlightLegLayer; }, set highlightLegLayer(v) { highlightLegLayer = v; },
      get windBarbMarkers() { return windBarbMarkers; }, set windBarbMarkers(v) { windBarbMarkers = v; },
      get routeLegCoords() { return routeLegCoords; }, set routeLegCoords(v) { routeLegCoords = v; },
      get prevHighlightWpIdx() { return prevHighlightWpIdx; }, set prevHighlightWpIdx(v) { prevHighlightWpIdx = v; },
      get graphMeta() { return graphMeta; }, set graphMeta(v) { graphMeta = v; },
      get graphLayout() { return graphLayout; }, set graphLayout(v) { graphLayout = v; },
      get calcStream() { return calcStream; }, set calcStream(v) { calcStream = v; },
      get pendingRouteData() { return pendingRouteData; }, set pendingRouteData(v) { pendingRouteData = v; },
    };

    const calcApi = setupCalculation({
      map, routingWorker, isochroneState,
      progressWrap, progressBar, calcBtn, landToggle,
      setStatus, showFailurePopup,
      fetchWindPointsAt: (idx: number) => fetchWindPointsAt(idx),
      fetchWavePointsAt: (idx: number) => fetchWavePointsAt(idx),
      scrubberState,
      getStartLatLon: () => startLatLon,
      getEndLatLon: () => endLatLon,
      getRouteWaypoints: () => routeWaypoints,
      getRoutingOptions: () => routingOptions ?? null,
      getAppInstance: () => ({}),
      getWindSpeedMs: () => windSpeedMs,
      getWindTimes: () => windTimes,
      getWindTimesLoaded: () => windTimesLoaded,
      getConditionsGraphHeight: () => conditionsGraphHeight,
      getConditionsExpanded: () => true,
      getConditionsFullscreen: () => false,
      getGribInfoFiles: () => gribInfoFiles,
      getForecastSkillHorizonHours: () => forecastSkillHorizonHours,
      state: calcState,
    });

    // ── Placement + test routes ─────────────────────────────────────────

    function clearRouteWaypointsLocal() { _clearRouteWaypoints(skDeps); }
    function updateCalcButton() {
      const hasData = windTimesLoaded;
      const hasStart = !!startLatLon;
      const hasEnd = !!endLatLon;
      const hasRouteWp = routeWaypoints.length > 0;
      const ready = (hasStart && hasEnd || hasRouteWp) && hasData;
      calcBtn.disabled = !ready;
      let hint = document.getElementById('calc-hint');
      if (!hint) { hint = document.createElement('span'); hint.id = 'calc-hint'; hint.style.cssText = 'font-size:10px;color:#6c7086;display:block;margin-top:2px'; calcBtn.after(hint); }
      const missing: string[] = [];
      if (!hasData) missing.push('loading forecast…');
      if (!(hasStart && hasEnd || hasRouteWp)) missing.push('set route');
      hint.textContent = missing.length > 0 ? `Needs: ${missing.join(', ')}` : '';
    }

    const placementCb: PlacementCallbacks = {
      getPlacing: () => placing,
      setStartLatLon: (v) => { startLatLon = v; },
      setEndLatLon: (v) => { endLatLon = v; },
      setPlacing: (v) => { placing = v; },
      setStatus,
      clearRouteWaypoints: clearRouteWaypointsLocal,
      updateCalcButton,
    };
    setupPlacementClick(map, startMarker, endMarker, startCoords, endCoords, placementCb);

    document.getElementById('btn-start')?.addEventListener('click', () => _activatePlacing(map, 'start', { setStatus, setPlacing: (v) => { placing = v; } }));
    document.getElementById('btn-end')?.addEventListener('click', () => _activatePlacing(map, 'end', { setStatus, setPlacing: (v) => { placing = v; } }));
    calcBtn.addEventListener('click', calcApi.startCalculation);

    const testCb: TestRouteCallbacks = { setStartLatLon: (v) => { startLatLon = v; }, setEndLatLon: (v) => { endLatLon = v; }, clearRouteWaypoints: clearRouteWaypointsLocal, updateCalcButton };
    document.getElementById('run-test')?.addEventListener('click', () => _runTest(map, startMarker, endMarker, startCoords, endCoords, testCb));
    document.getElementById('run-helsinki-test')?.addEventListener('click', () => _runHelsinkiTest(map, startMarker, endMarker, startCoords, endCoords, testCb));
    document.getElementById('run-gothenburg-test')?.addEventListener('click', () => _runGothenburgTest(map, startMarker, endMarker, startCoords, endCoords, testCb));

    // ── Scrubber ────────────────────────────────────────────────────────

    scrubberCtrl.setupScrubberHandlers({
      getWindTimes: () => windTimes,
      isLoaded: () => windTimesLoaded,
      isCurrentEnabled: () => currentEnabled,
      hasCurrentPoints: () => forecaster.getCurrentPoints().length > 0,
      fetchWind: (idx, signal) => { void fetchWindPointsAt(idx, signal); },
      fetchWave: (idx, signal) => { void fetchWavePointsAt(idx, signal); },
      fetchCurrent: (timeMs, signal) => { void fetchCurrentPointsAt(timeMs, signal); },
      onScrubberHighlight: calcApi.updateScrubberHighlight,
      onToggleRange: () => { const r = scrubberCtrl.toggleRange(scrubberState()); scrubberLockedToRoute = r.locked; },
    });

    // ── Route weather analysis ──────────────────────────────────────────

    function updateAnalyseButton() {
      const hasRoute = !!startLatLon || routeWaypoints.length > 0;
      const hasPolar = !!window._polarCsv;
      const hasDep = !!(document.getElementById('departure-time') as HTMLInputElement | null)?.value;
      analyseBtn.disabled = !(hasRoute && hasPolar && hasDep && windTimesLoaded);
      const hint = document.getElementById('analyse-hint');
      if (hint) {
        const m: string[] = [];
        if (!windTimesLoaded) m.push('loading forecast…');
        if (!hasRoute) m.push('set route');
        if (!hasPolar) m.push('load polar');
        if (!hasDep) m.push('set departure');
        hint.textContent = m.length > 0 ? `Needs: ${m.join(', ')}` : '';
      }
    }
    const analyseHint = document.createElement('span');
    analyseHint.id = 'analyse-hint';
    analyseHint.style.cssText = 'font-size:10px;color:#6c7086;display:block;margin-top:2px';
    analyseBtn.after(analyseHint);
    document.getElementById('departure-time')?.addEventListener('change', updateAnalyseButton);
    document.getElementById('waypoints-route')?.addEventListener('change', () => setTimeout(updateAnalyseButton, 100));

    analyseBtn.addEventListener('click', async () => {
      const depTime = (document.getElementById('departure-time') as HTMLInputElement).value;
      if (!depTime) return;
      const polarCsv = window._polarCsv;
      if (!polarCsv) return;
      analyseBtn.disabled = true; analyseBtn.textContent = 'Analysing…';
      try {
        const sel = document.getElementById('waypoints-route') as HTMLSelectElement | null;
        const routeIdx = sel?.value ? parseInt(sel.value) : -1;
        const routeCoords = routeIdx >= 0 ? waypointRoutes[routeIdx]?.coords : null;
        let coords: number[][] | null = routeCoords ?? null;
        if (!coords && startLatLon && endLatLon) {
          coords = [[startLatLon.lon, startLatLon.lat], [endLatLon.lon, endLatLon.lat]];
          if (routeWaypoints.length > 0) coords = [coords[0]!, ...routeWaypoints.map((wp) => [wp.lon, wp.lat]), coords[1]!];
        }
        if (!coords || coords.length < 2) { analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse Route Weather'; return; }
        const waypoints = coords.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
        const results = await analyseRouteWeather(waypoints, new Date(depTime).getTime(), polarCsv);
        routeWeatherResults.set(results);
        if (routeWeatherInstance) unmount(routeWeatherInstance);
        routeWeatherPanel.style.display = 'block'; routeWeatherPanel.innerHTML = '';
        routeWeatherInstance = mount(RouteWeatherTable, { target: routeWeatherPanel, props: { data: results } }) as Record<string, unknown>;
        if (window._routeWeatherMarkers) for (const m of window._routeWeatherMarkers) m.remove();
        window._routeWeatherMarkers = results.map((r) => {
          const el = document.createElement('div');
          el.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#89b4fa;border:1px solid #1e2230';
          const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(map);
          const tw = _fmt(r.twsKn ?? 0, 'speed');
          const popup = new maplibregl.Popup({ offset: [0, -10], closeButton: false, closeOnClick: false }).setHTML(`WP${String(r.idx)}<br>${tw.num} ${tw.sym}, ${Math.round(r.twdDeg ?? 0)}°`);
          m.setPopup(popup);
          m.getElement().addEventListener('mouseenter', () => popup.addTo(map));
          m.getElement().addEventListener('mouseleave', () => popup.remove());
          return m;
        });
      } catch (e) { setStatus('error', `Analysis failed: ${String(e)}`); }
      finally { analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse Route Weather'; }
    });

    // Poll for forecast loaded
    const readyPoll = setInterval(() => { updateAnalyseButton(); updateCalcButton(); if (windTimesLoaded) clearInterval(readyPoll); }, 500);

    // ── SK resources ────────────────────────────────────────────────────

    let vesselPositionWs: WebSocket | null = null;
    const skState: import('../sk-resources').SkState = {
      get departureResources() { return departureResources; }, set departureResources(v) { departureResources = v; },
      get waypointRoutes() { return waypointRoutes; }, set waypointRoutes(v) { waypointRoutes = v; },
      get routeWaypoints() { return routeWaypoints; }, set routeWaypoints(v) { routeWaypoints = v; },
      get routeWaypointMarkers() { return routeWaypointMarkers; }, set routeWaypointMarkers(v) { routeWaypointMarkers = v; },
      get startLatLon() { return startLatLon; }, set startLatLon(v) { startLatLon = v; },
      get endLatLon() { return endLatLon; }, set endLatLon(v) { endLatLon = v; },
      get vesselPosition() { return vesselPosition; }, set vesselPosition(v) { vesselPosition = v; },
      get vesselPositionWs() { return vesselPositionWs; }, set vesselPositionWs(v) { vesselPositionWs = v; },
    };
    const skDeps: SkDeps = {
      skFetch, skWebSocketUrl, map,
      startMarker, endMarker, startCoords, endCoords,
      updateCalcButton, updateAnalyseButton,
      state: skState,
    };
    document.getElementById('waypoints-route')?.addEventListener('change', (e) => handleWaypointRouteChange(skDeps, e));
    document.getElementById('departure-resource')?.addEventListener('change', (e) => handleDepartureResourceChange(skDeps, e));
    document.getElementById('btn-vessel-position')?.addEventListener('click', () => handleVesselPositionClick(skDeps));

    // ── Config ──────────────────────────────────────────────────────────

    const configState: ConfigState = {
      get waveOverlayMaxM() { return waveOverlayMaxM; }, set waveOverlayMaxM(v) { waveOverlayMaxM = v; },
      get windSpeedMs() { return windSpeedMs; }, set windSpeedMs(v) { windSpeedMs = v; },
      get conditionsGraphHeight() { return conditionsGraphHeight; }, set conditionsGraphHeight(v) { conditionsGraphHeight = v; },
      get forecastSkillHorizonHours() { return forecastSkillHorizonHours; }, set forecastSkillHorizonHours(v) { forecastSkillHorizonHours = v; },
      get unitPrefs() { return unitPrefs; }, set unitPrefs(v) { unitPrefs = v; },
    };

    // ── Startup ─────────────────────────────────────────────────────────

    // GRIB info (Windy mode — no server-side GRIB files)
    gribInfo.innerHTML = '<span style="color:#89b4fa">Using Windy ECMWF forecast</span>';
    document.getElementById('current-info')!.style.display = 'none';

    // Init wind scrubber (load Windy times + first overlay fetch)
    void (async () => {
      setStatus('', 'Loading forecast data…');
      try {
        timeAxis = await loadWindyTimes(timeAxis);
        windTimes = timeAxis.windTimes;
        windTimesCount = timeAxis.windTimesCount;
        windNativeTimes = timeAxis.windNativeTimes;
        windTimesLoaded = timeAxis.windTimesLoaded;
      } catch (e) {
        setStatus('error', 'Failed to load forecast: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
      rebuildScrubberTimes();
      if (windTimesCount > 0) {
        await fetchWindPointsAt(0);
        await fetchWavePointsAt(0);
      }
      setStatus('done', 'Ready');
    })();

    void _loadConfig(skFetch, configState);

    // SK-dependent features
    void (async () => {
      try {
        const r = await skFetch('/signalk');
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        skConnected.set(true);
        void _loadDepartureResources(skDeps);
        void _loadWaypointRoutes(skDeps);
        if (regionOverlayRef) void regionOverlayRef.reload();
        _connectVesselPositionStream(skDeps);
      } catch {
        skConnected.set(false);
        setStatus('', 'Ready (no SignalK server)');
      }
    })();

    // ── Map event handlers ──────────────────────────────────────────────

    setupViewportRefresh(map, { fetchWindPointsAt, fetchWavePointsAt, isWindTimesLoaded: () => windTimesLoaded });
    setupInfoPopupClick(map, () => ({
      allWindPoints: forecaster.getWindPoints(),
      allWavePoints: forecaster.getWavePoints(),
      allCurrentPoints: forecaster.getCurrentPoints(),
      windSpeedMs,
    }));

    // Isochrone toggle
    document.getElementById('isochrone-toggle')?.addEventListener('change', (e) => {
      const visible = (e.target as HTMLInputElement).checked;
      for (const id of isochroneState.layerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    });

    // Save route
    const saveModalContainer = document.createElement('div');
    document.body.appendChild(saveModalContainer);
    document.getElementById('save-route-btn')?.addEventListener('click', () => {
      if (!pendingRouteData) return setStatus('error', 'No route to save');
      mount(SaveRouteModal, { target: saveModalContainer, props: {
        visible: true,
        onSave: async (name: string) => {
          if (!pendingRouteData) return;
          const body = { ...pendingRouteData, name };
          const r = await skFetch('/signalk/v2/api/resources/routes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
          saveModalContainer.innerHTML = '';
        },
        onCancel: () => { saveModalContainer.innerHTML = ''; },
      } });
    });

    // Failure popup

    // Dilated land data polling
    const dilatedPoll = setInterval(() => {
      if (dilatedIndexReady) return;
      if (dataLayer.dilatedLandDataReady()) { dilatedIndexReady = true; clearInterval(dilatedPoll); }
    }, 5000);

    // Conditions graph tooltip
    setupGraphTooltip(
      document.getElementById('conditions-svg')!,
      document.getElementById('graph-tooltip')!,
      () => ({ graphMeta, graphLayout, windSpeedMs }),
    );
  });
</script>

<!-- Sidebar -->
<div id="sidebar" class="sidebar">
  <h1>&#9973; Weather Routing</h1>
  <a
    href="https://github.com/kristianwiklund/signalk-weather-routing"
    target="_blank"
    rel="noopener"
    class="github-link"
  >
    <svg height="12" viewBox="0 0 16 16" width="12" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
    GitHub — source &amp; issues
  </a>

  <div class="section" id="chart-section">
    <ChartSelector {skFetch} />
  </div>

  <div class="section">
    <LayerToggles {regionEnabled} />
  </div>

  <div class="section" id="routing-options-section">
    <RoutingOptions />
  </div>

  <div class="section">
    <div class="section-title">Forecast</div>
    <div id="grib-info">Loading forecast…</div>
    <div id="current-info" style="display: none"></div>
  </div>

  <div class="section">
    <DepartureSection
      vesselAvailable={vesselPosition !== null}
      resources={departureResources}
      onSetOnMap={() => {}}
      onUseVesselPosition={() => {}}
      onResourceSelect={() => {}}
    />
  </div>

  <div class="section" id="waypoints-route-section" style="display: none">
    <div class="section-title">Route waypoints</div>
    <select id="waypoints-route">
      <option value="">— route waypoints —</option>
    </select>
  </div>

  <div class="section">
    <div class="section-title">Destination</div>
    <div class="coord-row">
      <button class="marker-btn" id="btn-end">Set on map</button>
      <span class="coord-value" id="end-coords">&#8212;</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Departure Time</div>
    <input type="datetime-local" id="departure-time" />
  </div>

  <div class="section" id="polar-section">
    <PolarInput />
  </div>

  <ActionButtons
    canCalculate={false}
    canAnalyse={false}
    hasPendingRoute={pendingRouteData !== null}
    calcHint=""
    analyseHint=""
    onCalculate={() => {}}
    onRunTest={() => {}}
    onRunHelsinki={() => {}}
    onRunGothenburg={() => {}}
    onSaveRoute={() => {}}
    onAnalyse={() => {}}
  />

  <div class="section" style="margin-top:auto" id="sk-settings-section">
    <SkServerSettings currentUrl={localStorage.getItem('wr-signalk-url') ?? ''} />
  </div>
  <div id="build-version" class="build-version"></div>
</div>

<!-- Overlays (tooltips, legends, modals) -->
<div id="graph-tooltip" class="graph-tooltip"></div>
<div id="wave-legend" class="wave-legend">
  <div id="wave-legend-bar" class="wave-legend-bar"></div>
  <div id="wave-legend-labels" class="wave-legend-labels">
    <span id="wave-legend-min">0</span>
    <span id="wave-legend-max">3 m</span>
  </div>
</div>

<div id="confirm-modal-overlay" class="confirm-modal-overlay" style="display:none">
  <div id="confirm-modal" class="confirm-modal">
    <h2 id="confirm-modal-title">Confirm</h2>
    <p id="confirm-modal-msg"></p>
    <div class="modal-buttons">
      <button id="confirm-modal-cancel">Cancel</button>
      <button id="confirm-modal-ok">Archive</button>
    </div>
  </div>
</div>

<Disclaimer />

<FailurePopup message="" type="error" visible={false} onClose={() => {}} />

<!-- Right column: map + panels -->
<div id="right-col" class="right-col">
  <div id="map" class="map-container"></div>
  <!-- SVG defs for region hatch pattern -->
  <svg width="0" height="0" style="position: absolute">
    <defs>
      <pattern id="hatch-avoid" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="#f38ba8" stroke-width="1.5" opacity="0.6" />
      </pattern>
    </defs>
  </svg>
  <TimeScrubber />
  <ConditionsPanel />
  <div id="meteogram-panel">
    <Meteogram data={[]} />
  </div>
</div>

<!-- Renderless overlay components (manage their own map layers) -->
<div style="display:none">
  <WindOverlay />
  <WaveOverlay />
  <CurrentOverlay />
  <LandOverlay {useSafetyMargin} />
  <RegionOverlay {skFetch} {escapeHtml} bind:this={regionOverlayRef} />
</div>

<style>
  .sidebar {
    width: 320px;
    flex-shrink: 0;
    background: #1e2230;
    color: #cdd6f4;
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-right: 2px solid #313244;
  }
  .sidebar h1 {
    font-size: 16px;
    margin-bottom: 2px;
    color: #cdd6f4;
  }
  .github-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #a6adc8;
    font-size: 11px;
    text-decoration: none;
    margin-bottom: 8px;
  }
  .github-link:hover { color: #cdd6f4; }

  .right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: #1e2230;
  }
  .map-container {
    flex: 1;
    min-height: 200px;
  }

  .section {
    background: #2a2f45;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 4px;
  }
  .section-title {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .coord-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .coord-value {
    font-size: 12px;
    color: #a6adc8;
  }
  .marker-btn {
    font-size: 11px;
    padding: 3px 8px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    cursor: pointer;
  }
  .marker-btn:hover { background: #45475a; }

  .analyse-btn {
    background: #a6e3a1;
    color: #1e1e2e;
    margin-top: 4px;
  }
  .build-version {
    font-size: 10px;
    color: #585b70;
    text-align: center;
    padding: 8px 0 4px;
    user-select: text;
  }

  /* Keep global IDs working for imperative code */
  :global(#status-box) {
    padding: 8px;
    font-size: 12px;
    text-align: center;
    border-radius: 4px;
    color: #cdd6f4;
  }
  :global(#status-box.error) { background: #45475a; color: #f38ba8; }
  :global(#status-box.done) { color: #a6e3a1; }
  :global(#status-box.loading) { color: #89b4fa; }

  :global(#progress-bar-wrap) {
    height: 4px;
    background: #313244;
    border-radius: 2px;
    margin: 4px 0;
    overflow: hidden;
  }
  :global(#progress-bar) {
    height: 100%;
    background: #89b4fa;
    width: 0;
    transition: width 0.3s;
  }

  /* Wave legend */
  .wave-legend {
    position: absolute;
    bottom: 30px;
    left: 340px;
    background: rgba(30, 34, 48, 0.9);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    color: #cdd6f4;
    display: none;
    flex-direction: column;
    gap: 2px;
    z-index: 500;
  }
  .wave-legend-bar {
    width: 120px;
    height: 8px;
    background: linear-gradient(to right, hsla(240,100%,50%,0.7), hsla(120,100%,50%,0.7), hsla(0,100%,50%,0.7));
    border-radius: 2px;
  }
  .wave-legend-labels {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
  }

  /* Graph tooltip */
  .graph-tooltip {
    position: fixed;
    background: #313244;
    color: #cdd6f4;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    pointer-events: none;
    z-index: 9000;
    display: none;
    white-space: nowrap;
  }

</style>
