<script lang="ts">
  // Root application component — owns layout, state, and all event wiring.
  // app.ts creates the MapLibre map and mounts this component.

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
  import type { CalcMutableState, CalculationApi } from '../calculation';
  import type { SkDeps } from '../sk-resources';
  import type { ConfigState, ConfigCallbacks } from '../config';
  import type { WaypointWeather } from '../route-weather';
  import type { WindPoint, WavePoint, CurrentPoint, WaveGridMeta } from '../stores';
  import { forecastLoaded, windPoints as windPointsStore, wavePoints as wavePointsStore, currentPoints as currentPointsStore, waveGridMetaStore as waveGridMetaStoreRef } from '../stores';
  import { fmt as _fmt } from '../units';
  import { toLocalDateTimeInput } from '../utils';
  import * as forecaster from '../forecast-fetcher';
  import { computeLabel, computeCoverageHtml, computeNowMarkerLeft, findNowIndex } from '../scrubber-controller';
  import type { ScrubberState } from '../scrubber-controller';
  import { createTimeAxis, loadWindyTimes, rebuildTimes } from '../time-axis';
  import { setupCalculation } from '../calculation';
  import { greenIcon, redIcon, setupInfoPopupClick, setupViewportRefresh } from '../map-interaction';
  import { loadDepartureResources as _loadDepartureResources, loadWaypointRoutes as _loadWaypointRoutes, connectVesselPositionStream as _connectVesselPositionStream } from '../sk-resources';
  import { analyseRouteWeather } from '../route-weather';
  import * as dataLayer from '../data-layer';
  import { setupGraphTooltip } from '../graph-tooltip';
  import { loadConfig as _loadConfig } from '../config';
  import maplibregl from 'maplibre-gl';
  import { MapLibre } from 'svelte-maplibre-gl';

  // ── Props ──────────────────────────────────────────────────────────────────
  interface Props {
    skFetch: (path: string, options?: RequestInit) => Promise<Response>;
    skWebSocketUrl: (path: string) => string;
  }

  let { skFetch, skWebSocketUrl }: Props = $props();

  // ── Reactive State ─────────────────────────────────────────────────────────

  // UI text
  let startCoordsText = $state('—');
  let endCoordsText = $state('—');
  let statusType = $state('');
  let statusText = $state('Ready');
  let gribStatusHtml = $state('<span style="color:#89b4fa">Loading…</span>');
  let departureTime = $state(defaultDepartureTime());
  let buildVersion = $state('');
  let waveLegendMax = $state('3 m');

  // Booleans / numbers
  let polarCsv = $state<string | null>(localStorage.getItem('wr-polar-csv'));
  const polarLoaded = $derived(!!polarCsv);
  let isCalculating = $state(false);
  let isAnalysing = $state(false);
  let calcProgress = $state(0);
  let showProgress = $state(false);

  // Navigation / placement state
  let vesselPosition = $state<{ lat: number; lon: number } | null>(null);
  let departureResources = $state<{ label: string; lat: number; lon: number }[]>([]);
  let pendingRouteData = $state<RouteData | null>(null);
  let regionEnabled = $state(false);
  let startLatLon = $state<{ lat: number; lon: number } | null>(null);
  let endLatLon = $state<{ lat: number; lon: number } | null>(null);
  let placing = $state<string | null>(null);
  let routeWaypoints = $state<{ lat: number; lon: number }[]>([]);
  let waypointRoutes = $state<{ label: string; coords: number[][] }[]>([]);
  let windTimesLoaded = $state(false);
  let skConnectedState = $state(false);

  // Analysis results (drives {#if} block in template)
  let analyseResults = $state<WaypointWeather[]>([]);

  // Save modal
  let showSaveModal = $state(false);

  // Failure popup
  let failurePopupMsg = $state('');
  let failurePopupType = $state<'error' | 'warning'>('error');
  let failurePopupVisible = $state(false);

  // Overlay visibility (bound to LayerToggles via $bindable)
  let windOverlayVisible = $state(true);
  let waveOverlayVisible = $state(false);
  let currentOverlayVisible = $state(false);
  let landOverlayVisible = $state(false);
  let regionOverlayVisible = $state(false);
  let isochroneVisibleState = $state(true);

  // Overlay data (synced from stores written by forecast-fetcher)
  let windPointsData = $state<WindPoint[]>([]);
  let wavePointsData = $state<WavePoint[]>([]);
  let currentPointsData = $state<CurrentPoint[]>([]);
  let waveGridMetaData = $state<WaveGridMeta | null>(null);

  // ── Derived State ──────────────────────────────────────────────────────────

  const hasRoute = $derived(
    (!!startLatLon && !!endLatLon) || routeWaypoints.length > 0
  );
  const canCalculate = $derived(hasRoute && windTimesLoaded && !isCalculating);
  const canAnalyse = $derived(
    hasRoute && polarLoaded && !!departureTime && windTimesLoaded && !isAnalysing
  );
  const calcHint = $derived.by(() => {
    if (isCalculating) return '';
    const m: string[] = [];
    if (!windTimesLoaded) m.push('loading forecast…');
    if (!hasRoute) m.push('set route');
    return m.length ? 'Needs: ' + m.join(', ') : '';
  });
  const analyseHint = $derived.by(() => {
    if (isAnalysing) return '';
    const m: string[] = [];
    if (!windTimesLoaded) m.push('loading forecast…');
    if (!hasRoute) m.push('set route');
    if (!polarLoaded) m.push('load polar');
    if (!departureTime) m.push('set departure');
    return m.length ? 'Needs: ' + m.join(', ') : '';
  });

  // ── Internal (non-reactive) State ──────────────────────────────────────────

  let regionOverlayRef: { getAvoidIds: () => string[]; reload: () => Promise<void>; toggleAvoid: (id: string, avoid: boolean) => void } | undefined;
  let regionListData = $state<{ id: string; name: string; avoided: boolean }[]>([]);
  let routeWaypointMarkers: maplibregl.Marker[] = [];
  let currentEnabled = true;
  let windSpeedMs = false;
  let waveOverlayMaxM = $state(3.0);
  let conditionsGraphHeight = $state(200);
  let windTimes: string[] = [];
  let windTimesCount = 0;
  let routeScrubberRange: { i0: number; iN: number } | null = null;
  let scrubberLockedToRoute = false;
  let windNativeTimes: string[] = [];
  let currentFileTimes: string[] = [];
  let gribInfoFiles: GribFileMeta[] = [];
  let dilatedIndexReady = false;
  let graphMeta: WaypointMeta[] | null = null;
  let graphLayout: GraphLayout | null = null;
  let unitPrefs: Record<string, UnitPref> | null = null;
  let forecastSkillHorizonHours = 96;
  let enabledGribPaths = new Set<string>();
  let timeAxis = createTimeAxis();

  // Scrubber reactive state
  let scrubberIndex = $state(0);
  let scrubberLabel = $state('');
  let coverageHtml = $state('');
  let nowMarkerLeft = $state<string | null>(null);
  let showRangeToggle = $state(false);
  let rangeToggleLabel = $state('Full range');
  let showRightSpacer = $state(false);
  let scrubberVisible = $state(false);

  // Conditions panel reactive state
  let conditionsVisible = $state(false);
  let conditionsExpanded = $state(true);
  let conditionsFullscreen = $state(false);
  let conditionsSvgContent = $state('');
  let conditionsSvgViewBox = $state('0 0 820 200');
  let conditionsHasWave = $state(false);

  // Bind:this refs for graph tooltip
  let graphTooltipEl = $state<HTMLDivElement | undefined>();
  let conditionsPanelRef: { getSvgEl(): SVGSVGElement | undefined } | undefined;

  // Subscribe to overlay data stores (forecast-fetcher writes to these)
  windPointsStore.subscribe(v => { windPointsData = v; });
  wavePointsStore.subscribe(v => { wavePointsData = v; });
  currentPointsStore.subscribe(v => { currentPointsData = v; });
  waveGridMetaStoreRef.subscribe(v => { waveGridMetaData = v; });

  // MapLibre layers / markers
  let routeLayer: { sourceId: string; layerId: string } | null = null;
  let windBarbLayer: maplibregl.Marker[] = [];
  let legLabelLayer: maplibregl.Marker[] = [];
  let windBarbMarkers: (maplibregl.Marker | null)[] = [];
  let routeLegCoords: [number, number][][] = [];
  let highlightLegLayer: { sourceId: string; layerId: string } | null = null;
  let prevHighlightWpIdx = -1;

  // Map refs at component level
  let mapRef = $state<maplibregl.Map>(undefined as unknown as maplibregl.Map);
  let startMarker: maplibregl.Marker | null = null;
  let endMarker: maplibregl.Marker | null = null;
  let isochroneState: { sourceIds: string[]; layerIds: string[]; count: number; map: maplibregl.Map } | null = null;
  let routingWorker: Worker | null = null;
  let calcApi: CalculationApi | null = null;
  let routeWeatherMarkers: maplibregl.Marker[] = [];

  // RoutingOptions component ref
  interface RoutingOptionsApi {
    getOptions: () => {
      useLandAvoidance: boolean; useSafetyMargin: boolean;
      motorBelowKn: number | undefined; motorSpeedKn: number | undefined;
      waitForWind: boolean | undefined; maxWindKn: number | undefined; maxWaveM: number | undefined;
      waypointLabels: boolean; waypointLabelInterval: number;
    };
  }
  let routingOptionsRef: RoutingOptionsApi | undefined;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function defaultDepartureTime(): string {
    const now = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
    return toLocalDateTimeInput(now);
  }

  function setStatus(type: string, msg: string) {
    statusType = type;
    statusText = msg;
  }

  function handleShowFailurePopup(msg: string, isWarning: boolean) {
    failurePopupMsg = msg;
    failurePopupType = isWarning ? 'warning' : 'error';
    failurePopupVisible = true;
  }

  function timeAxisState() { return { windTimes, windNativeTimes, windTimesLoaded }; }

  async function fetchWindPointsAt(idx: number, signal?: AbortSignal) {
    await forecaster.fetchWindPoints(idx, timeAxisState(), mapRef!, signal);
    scrubberLabel = computeLabel(idx, windTimes);
  }
  async function fetchWavePointsAt(idx: number, signal?: AbortSignal) {
    await forecaster.fetchWavePoints(idx, timeAxisState(), mapRef!, signal);
  }
  async function fetchCurrentPointsAt(timeMs: number, signal?: AbortSignal) {
    await forecaster.fetchCurrentPoints(timeMs, mapRef!, signal);
  }

  function scrubberState(): ScrubberState {
    return { windTimes, scrubberLockedToRoute, routeScrubberRange, graphMeta, gribInfoFiles, enabledGribPaths, currentEnabled, currentFileTimes };
  }

  /** Update all scrubber-derived reactive state from current windTimes / range. */
  function updateScrubberView() {
    const rangeStart = scrubberLockedToRoute && routeScrubberRange ? routeScrubberRange.i0 : 0;
    const rangeEnd = scrubberLockedToRoute && routeScrubberRange ? routeScrubberRange.iN : Math.max(0, windTimes.length - 1);
    coverageHtml = computeCoverageHtml(rangeStart, rangeEnd, scrubberState());
    nowMarkerLeft = computeNowMarkerLeft(rangeStart, rangeEnd, windTimes);
    scrubberLabel = computeLabel(scrubberIndex, windTimes);
  }

  function rebuildScrubberTimes() {
    const result = rebuildTimes(timeAxis);
    timeAxis = result;
    windTimes = result.windTimes;
    windTimesCount = result.windTimesCount;
    windNativeTimes = result.windNativeTimes;
    windTimesLoaded = result.windTimesLoaded;
    if (result.windTimesLoaded) forecastLoaded.set(true);
    if (windTimes.length === 0) {
      scrubberVisible = false;
      return;
    }
    scrubberVisible = true;
    scrubberIndex = Math.min(scrubberIndex, Math.max(0, windTimes.length - 1));
    updateScrubberView();
  }

  function useSafetyMargin(): boolean {
    return routingOptionsRef?.getOptions().useSafetyMargin ?? false;
  }

  // ── Scrubber Event Handlers ────────────────────────────────────────────────

  let scrubberDebounce: ReturnType<typeof setTimeout> | null = null;
  let windAbort: AbortController | null = null;
  let waveAbort: AbortController | null = null;
  let currentAbort: AbortController | null = null;

  function handleScrubberChange(idx: number) {
    scrubberIndex = idx;
    scrubberLabel = computeLabel(idx, windTimes);
    clearTimeout(scrubberDebounce ?? undefined);
    scrubberDebounce = setTimeout(() => {
      windAbort?.abort(); windAbort = new AbortController();
      waveAbort?.abort(); waveAbort = new AbortController();
      void fetchWindPointsAt(idx, windAbort.signal);
      void fetchWavePointsAt(idx, waveAbort.signal);
      const timeMs = windTimes[idx] ? new Date(windTimes[idx]).getTime() : Date.now();
      if (currentEnabled || forecaster.getCurrentPoints().length > 0) {
        currentAbort?.abort(); currentAbort = new AbortController();
        void fetchCurrentPointsAt(timeMs, currentAbort.signal);
      }
      calcApi?.updateScrubberHighlight(idx);
    }, 100);
  }

  function handleJumpToNow() {
    if (!windTimesLoaded) return;
    const idx = findNowIndex(windTimes);
    handleScrubberChange(idx);
  }

  function handleToggleRange() {
    if (!routeScrubberRange) return;
    scrubberLockedToRoute = !scrubberLockedToRoute;
    rangeToggleLabel = scrubberLockedToRoute ? 'Full range' : 'Route only';
    if (scrubberLockedToRoute) {
      scrubberIndex = Math.max(routeScrubberRange.i0, Math.min(routeScrubberRange.iN, scrubberIndex));
    }
    updateScrubberView();
  }

  function handleUseAsDeparture(timeIso: string) {
    if (timeIso) departureTime = toLocalDateTimeInput(new Date(timeIso));
  }

  function handleConditionsToggle() {
    conditionsExpanded = !conditionsExpanded;
  }

  function handleConditionsFullscreenToggle() {
    conditionsFullscreen = !conditionsFullscreen;
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  function activatePlacing(which: 'start' | 'end') {
    placing = which;
    setStatus('', `Click on the map to set ${which} point`);
    if (mapRef) mapRef.getCanvas().style.cursor = 'crosshair';
  }

  function handleCalculate() {
    void calcApi?.startCalculation();
  }

  function handleAnalyse() {
    if (!departureTime) return;
    const csv = polarCsv;
    if (!csv) return;
    isAnalysing = true;

    void (async () => {
      try {
        let coords: number[][] | null = null;
        if (startLatLon && endLatLon) {
          coords = [[startLatLon.lon, startLatLon.lat], [endLatLon.lon, endLatLon.lat]];
          if (routeWaypoints.length > 0) {
            coords = [coords[0]!, ...routeWaypoints.map((wp) => [wp.lon, wp.lat]), coords[1]!];
          }
        }
        if (!coords || coords.length < 2) {
          setStatus('error', 'Need at least 2 route points for analysis');
          return;
        }
        const waypoints = coords.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
        const results = await analyseRouteWeather(waypoints, new Date(departureTime).getTime(), csv);
        analyseResults = results;

        // Add route weather markers on map
        for (const m of routeWeatherMarkers) m.remove();
        routeWeatherMarkers = results.map((r) => {
          const el = document.createElement('div');
          el.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#89b4fa;border:1px solid #1e2230';
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(mapRef!);
          const tw = _fmt(r.twsKn ?? 0, 'speed');
          const popup = new maplibregl.Popup({ offset: [0, -10], closeButton: false, closeOnClick: false })
            .setHTML(`WP${String(r.idx)}<br>${tw.num} ${tw.sym}, ${Math.round(r.twdDeg ?? 0)}°`);
          marker.setPopup(popup);
          marker.getElement().addEventListener('mouseenter', () => popup.addTo(mapRef!));
          marker.getElement().addEventListener('mouseleave', () => popup.remove());
          return marker;
        });
      } catch (e) {
        setStatus('error', `Analysis failed: ${String(e)}`);
      } finally {
        isAnalysing = false;
      }
    })();
  }

  const OREGRUND = { lat: 60.3996, lon: 18.3403 };

  function setTestRoute(s: { lat: number; lon: number }, e: { lat: number; lon: number }, departure: string) {
    startLatLon = s;
    endLatLon = e;
    startCoordsText = `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
    endCoordsText = `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`;
    departureTime = departure;
    startMarker?.setLngLat([s.lon, s.lat]).addTo(mapRef!);
    endMarker?.setLngLat([e.lon, e.lat]).addTo(mapRef!);
    routeWaypoints = [];
    for (const m of routeWaypointMarkers) m.remove();
    routeWaypointMarkers = [];
  }

  function handleRunTest() {
    setTestRoute(OREGRUND, { lat: 58.5052, lon: 17.3474 }, '2026-05-24T08:00');
  }

  function handleRunHelsinki() {
    setTestRoute(OREGRUND, { lat: 60.0881, lon: 24.953 }, '2026-06-06T02:00');
  }

  function handleRunGothenburg() {
    setTestRoute(OREGRUND, { lat: 57.6138, lon: 11.598 }, '2026-06-06T02:00');
  }

  function handleSaveRoute() {
    if (!pendingRouteData) {
      setStatus('error', 'No route to save');
      return;
    }
    showSaveModal = true;
  }

  async function handleSaveRouteConfirm(name: string) {
    if (!pendingRouteData) return;
    const body = { ...pendingRouteData, name };
    const r = await skFetch('/signalk/v2/api/resources/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
    showSaveModal = false;
  }

  function handleUseVesselPosition() {
    if (!vesselPosition) return;
    const { lat, lon } = vesselPosition;
    startLatLon = { lat, lon };
    startCoordsText = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    startMarker?.setLngLat([lon, lat]).addTo(mapRef!);
    routeWaypoints = [];
    for (const m of routeWaypointMarkers) m.remove();
    routeWaypointMarkers = [];
  }

  function handleDepartureResourceSelect(index: number) {
    const res = departureResources[index];
    if (!res) return;
    const { lat, lon } = res;
    startLatLon = { lat, lon };
    startCoordsText = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    startMarker?.setLngLat([lon, lat]).addTo(mapRef!);
    routeWaypoints = [];
    for (const m of routeWaypointMarkers) m.remove();
    routeWaypointMarkers = [];
  }

  function handleWaypointRouteChange(e: Event) {
    const idx = parseInt((e.target as HTMLSelectElement).value);
    // Clear existing waypoints
    for (const m of routeWaypointMarkers) m.remove();
    routeWaypointMarkers = [];
    routeWaypoints = [];

    if (isNaN(idx) || !waypointRoutes[idx]) return;
    const route = waypointRoutes[idx]!;
    const coords = route.coords;
    if (coords.length >= 2) {
      const first = coords[0]!;
      startLatLon = { lat: first[1]!, lon: first[0]! };
      startCoordsText = `${first[1]!.toFixed(4)}, ${first[0]!.toFixed(4)}`;
      startMarker?.setLngLat([first[0]!, first[1]!]).addTo(mapRef!);

      const last = coords[coords.length - 1]!;
      endLatLon = { lat: last[1]!, lon: last[0]! };
      endCoordsText = `${last[1]!.toFixed(4)}, ${last[0]!.toFixed(4)}`;
      endMarker?.setLngLat([last[0]!, last[1]!]).addTo(mapRef!);
    }
    // Add intermediate waypoint markers
    const newWaypoints: { lat: number; lon: number }[] = [];
    const newMarkers: maplibregl.Marker[] = [];
    for (let i = 1; i < coords.length - 1; i++) {
      const wp = { lat: coords[i]![1]!, lon: coords[i]![0]! };
      newWaypoints.push(wp);
      const el = document.createElement('div');
      el.innerHTML = '<div style="background:#f5c2e7;width:8px;height:8px;border-radius:50%;border:1px solid #1e2230"></div>';
      newMarkers.push(
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([wp.lon, wp.lat]).addTo(mapRef!),
      );
    }
    routeWaypoints = newWaypoints;
    routeWaypointMarkers = newMarkers;

    // Fit map to route bounds
    const bounds = coords.reduce(
      (b, [lon, lat]) => b.extend([lon!, lat!] as [number, number]),
      new maplibregl.LngLatBounds(),
    );
    mapRef?.fitBounds(bounds, { padding: 30 });
  }

  // ── Map Initialization ($effect — runs once when map becomes available) ────

  let mapInitialized = false;
  $effect(() => {
    const m = mapRef;
    if (!m || mapInitialized) return;
    mapInitialized = true;

    startMarker = new maplibregl.Marker({ element: greenIcon(), anchor: 'center' });
    endMarker = new maplibregl.Marker({ element: redIcon(), anchor: 'center' });
    isochroneState = { sourceIds: [], layerIds: [], count: 0, map: m };
    routingWorker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });

    // ── Map click handler (placement) ──────────────────────────────────────
    m.on('click', (e: maplibregl.MapMouseEvent) => {
      if (!placing) return;
      const { lat, lng } = e.lngLat;
      if (placing === 'start') {
        startLatLon = { lat, lon: lng };
        startCoordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        startMarker?.setLngLat([lng, lat]).addTo(mapRef!);
        routeWaypoints = [];
        for (const mk of routeWaypointMarkers) mk.remove();
        routeWaypointMarkers = [];
      } else if (placing === 'end') {
        endLatLon = { lat, lon: lng };
        endCoordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        endMarker?.setLngLat([lng, lat]).addTo(mapRef!);
      }
      placing = null;
      if (mapRef) mapRef.getCanvas().style.cursor = '';
    });

    // ── Calculation module ──────────────────────────────────────────────────
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

    calcApi = setupCalculation({
      map: m, routingWorker: routingWorker!, isochroneState: isochroneState!,
      setProgress: (pct: number) => { calcProgress = pct; },
      setCalculating: (v: boolean) => { isCalculating = v; },
      setShowProgress: (v: boolean) => { showProgress = v; },
      getDepartureTime: () => departureTime,
      getIsochroneEnabled: () => isochroneVisibleState,
      setStatus,
      showFailurePopup: handleShowFailurePopup,
      fetchWindPointsAt: (idx: number) => fetchWindPointsAt(idx),
      fetchWavePointsAt: (idx: number) => fetchWavePointsAt(idx),
      scrubberState,
      getStartLatLon: () => startLatLon,
      getEndLatLon: () => endLatLon,
      getRouteWaypoints: () => routeWaypoints,
      getRoutingOptions: () => routingOptionsRef ?? null,
      getWindSpeedMs: () => windSpeedMs,
      getWindTimes: () => windTimes,
      getWindTimesLoaded: () => windTimesLoaded,
      getGribInfoFiles: () => gribInfoFiles,
      getForecastSkillHorizonHours: () => forecastSkillHorizonHours,
      getPolarCsv: () => polarCsv ?? undefined,
      setConditionsGraph: (data) => {
        if (data) {
          conditionsSvgContent = data.svgContent;
          conditionsSvgViewBox = data.viewBox;
          conditionsHasWave = data.hasWave;
          showRightSpacer = data.hasWave;
          graphLayout = data.layout;
        }
      },
      setConditionsVisible: (v) => { conditionsVisible = v; },
      lockScrubberToRoute: (i0, iN) => {
        routeScrubberRange = { i0, iN };
        scrubberLockedToRoute = true;
        scrubberIndex = i0;
        showRangeToggle = true;
        rangeToggleLabel = 'Full range';
        updateScrubberView();
      },
      setShowRangeToggle: (v) => { showRangeToggle = v; },
      state: calcState,
    });

    // ── SK resources ────────────────────────────────────────────────────────
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
      skFetch, skWebSocketUrl, map: m,
      startMarker: startMarker!,
      endMarker: endMarker!,
      setStartCoordsText: (t: string) => { startCoordsText = t; },
      setEndCoordsText: (t: string) => { endCoordsText = t; },
      state: skState,
    };

    // ── Config ──────────────────────────────────────────────────────────────
    const configState: ConfigState = {
      get waveOverlayMaxM() { return waveOverlayMaxM; }, set waveOverlayMaxM(v) { waveOverlayMaxM = v; },
      get windSpeedMs() { return windSpeedMs; }, set windSpeedMs(v) { windSpeedMs = v; },
      get conditionsGraphHeight() { return conditionsGraphHeight; }, set conditionsGraphHeight(v) { conditionsGraphHeight = v; },
      get forecastSkillHorizonHours() { return forecastSkillHorizonHours; }, set forecastSkillHorizonHours(v) { forecastSkillHorizonHours = v; },
      get unitPrefs() { return unitPrefs; }, set unitPrefs(v) { unitPrefs = v; },
    };
    const configCallbacks: ConfigCallbacks = {
      setBuildVersion: (v: string) => { buildVersion = v; },
      setWaveLegendMax: (text: string) => { waveLegendMax = text; },
      setSafetyMarginDist: (_text: string) => { /* safety margin text is hardcoded in RoutingOptions */ },
    };

    // ── Startup ─────────────────────────────────────────────────────────────

    gribStatusHtml = '<span style="color:#89b4fa">Using Windy ECMWF forecast</span>';

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

    void _loadConfig(skFetch, configState, configCallbacks);

    // SK-dependent features
    void (async () => {
      try {
        const r = await skFetch('/signalk');
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        skConnectedState = true;
        void _loadDepartureResources(skDeps);
        void _loadWaypointRoutes(skDeps);
        if (regionOverlayRef) void regionOverlayRef.reload();
        _connectVesselPositionStream(skDeps);
      } catch {
        skConnectedState = false;
        setStatus('', 'Ready (no SignalK server)');
      }
    })();

    // ── Map event handlers ──────────────────────────────────────────────────
    setupViewportRefresh(m, {
      fetchWindPointsAt,
      fetchWavePointsAt,
      isWindTimesLoaded: () => windTimesLoaded,
      isWindVisible: () => windOverlayVisible,
      isWaveVisible: () => waveOverlayVisible,
      getScrubberIndex: () => scrubberIndex,
    });
    setupInfoPopupClick(m, () => ({
      allWindPoints: forecaster.getWindPoints(),
      allWavePoints: forecaster.getWavePoints(),
      allCurrentPoints: forecaster.getCurrentPoints(),
      windSpeedMs,
      windVisible: windOverlayVisible,
      waveVisible: waveOverlayVisible,
      currentVisible: currentOverlayVisible,
    }));

    // Dilated land data polling
    const dilatedPoll = setInterval(() => {
      if (dilatedIndexReady) return;
      if (dataLayer.dilatedLandDataReady()) { dilatedIndexReady = true; clearInterval(dilatedPoll); }
    }, 5000);

    // Conditions graph tooltip — deferred until bind:this refs are available
    const tooltipPoll = setInterval(() => {
      const svgEl = conditionsPanelRef?.getSvgEl();
      if (svgEl && graphTooltipEl) {
        clearInterval(tooltipPoll);
        setupGraphTooltip(svgEl, graphTooltipEl, () => ({ graphMeta, graphLayout, windSpeedMs }));
      }
    }, 200);
  });
</script>

<!-- Sidebar -->
<div class="sidebar">
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

  <div class="section">
    <ChartSelector map={mapRef ?? null} skConnected={skConnectedState} {skFetch} />
  </div>

  <div class="section">
    <LayerToggles
      {regionEnabled}
      bind:windVisible={windOverlayVisible}
      bind:waveVisible={waveOverlayVisible}
      bind:currentVisible={currentOverlayVisible}
      bind:landVisible={landOverlayVisible}
      bind:regionVisible={regionOverlayVisible}
      bind:isochroneVisible={isochroneVisibleState}
      regions={regionListData}
      onToggleRegionAvoid={(id, avoid) => regionOverlayRef?.toggleAvoid(id, avoid)}
    />
  </div>

  <div class="section">
    <RoutingOptions bind:this={routingOptionsRef} />
  </div>

  <div class="section">
    <div class="section-title">Forecast</div>
    <div>{@html gribStatusHtml}</div>
  </div>

  <div class="section">
    <DepartureSection
      startCoords={startCoordsText}
      vesselAvailable={vesselPosition !== null}
      resources={departureResources}
      onSetOnMap={() => activatePlacing('start')}
      onUseVesselPosition={handleUseVesselPosition}
      onResourceSelect={handleDepartureResourceSelect}
    />
  </div>

  {#if waypointRoutes.length > 0}
    <div class="section">
      <div class="section-title">Route waypoints</div>
      <select class="select-input" onchange={handleWaypointRouteChange}>
        <option value="">— route waypoints —</option>
        {#each waypointRoutes as route, i}
          <option value={String(i)}>{route.label}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="section">
    <div class="section-title">Destination</div>
    <div class="coord-row">
      <button class="marker-btn" onclick={() => activatePlacing('end')}>Set on map</button>
      <span class="coord-value">{endCoordsText}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Departure Time</div>
    <input type="datetime-local" class="datetime-input" bind:value={departureTime} />
  </div>

  <div class="section">
    <PolarInput onPolarChange={(csv) => { polarCsv = csv; }} />
  </div>

  <ActionButtons
    {canCalculate} {canAnalyse} {isCalculating} {isAnalysing}
    {calcHint} {analyseHint} {calcProgress} {showProgress}
    hasPendingRoute={pendingRouteData !== null}
    onCalculate={handleCalculate} onAnalyse={handleAnalyse}
    onRunTest={handleRunTest} onRunHelsinki={handleRunHelsinki}
    onRunGothenburg={handleRunGothenburg} onSaveRoute={handleSaveRoute}
  />

  {#if analyseResults.length > 0}
    <RouteWeatherTable data={analyseResults} />
  {/if}

  <div class="status-box" class:error={statusType === 'error'} class:done={statusType === 'done'} class:loading={statusType === 'loading'}>
    {statusText}
  </div>

  <div class="section" style="margin-top:auto">
    <SkServerSettings currentUrl={localStorage.getItem('wr-signalk-url') ?? ''} />
  </div>
  <div class="build-version">{buildVersion}</div>
</div>

<!-- Overlays (tooltips, legends, modals) -->
<div bind:this={graphTooltipEl} class="graph-tooltip"></div>
<div class="wave-legend" class:visible={waveOverlayVisible}>
  <div class="wave-legend-bar"></div>
  <div class="wave-legend-labels">
    <span>0</span>
    <span>{waveLegendMax}</span>
  </div>
</div>

<Disclaimer />

<FailurePopup
  message={failurePopupMsg}
  type={failurePopupType}
  visible={failurePopupVisible}
  onClose={() => { failurePopupVisible = false; }}
/>

{#if showSaveModal}
  <SaveRouteModal
    visible={true}
    onSave={handleSaveRouteConfirm}
    onCancel={() => { showSaveModal = false; }}
  />
{/if}

<!-- Right column: map + panels -->
<div class="right-col">
  <!-- svelte-ignore binding_property_non_reactive -->
  <MapLibre
    bind:map={mapRef}
    class="map-container"
    center={[18, 57]}
    zoom={6}
    style={{
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    }}
    transformRequest={(url) => ({
      url,
      referrerPolicy: 'strict-origin-when-cross-origin',
    })}
  />
  <!-- SVG defs for region hatch pattern -->
  <svg width="0" height="0" style="position: absolute">
    <defs>
      <pattern id="hatch-avoid" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="#f38ba8" stroke-width="1.5" opacity="0.6" />
      </pattern>
    </defs>
  </svg>
  <TimeScrubber
    {windTimes}
    {scrubberIndex}
    lockedRange={scrubberLockedToRoute ? routeScrubberRange : null}
    label={scrubberLabel}
    {coverageHtml}
    {nowMarkerLeft}
    {showRangeToggle}
    {rangeToggleLabel}
    {showRightSpacer}
    visible={scrubberVisible}
    onIndexChange={handleScrubberChange}
    onJumpToNow={handleJumpToNow}
    onToggleRange={handleToggleRange}
    onUseAsDeparture={handleUseAsDeparture}
  />
  <ConditionsPanel
    bind:this={conditionsPanelRef}
    visible={conditionsVisible}
    expanded={conditionsExpanded}
    fullscreen={conditionsFullscreen}
    graphHeight={conditionsGraphHeight}
    svgContent={conditionsSvgContent}
    svgViewBox={conditionsSvgViewBox}
    hasWave={conditionsHasWave}
    onToggle={handleConditionsToggle}
    onFullscreenToggle={handleConditionsFullscreenToggle}
  />
  <div id="meteogram-panel">
    <Meteogram data={[]} />
  </div>
</div>

<!-- Renderless overlay components (manage their own map layers) -->
<WindOverlay map={mapRef ?? null} points={windPointsData} visible={windOverlayVisible} />
<WaveOverlay map={mapRef ?? null} points={wavePointsData} visible={waveOverlayVisible} gridMeta={waveGridMetaData} maxM={waveOverlayMaxM} />
<CurrentOverlay map={mapRef ?? null} points={currentPointsData} visible={currentOverlayVisible} />
<LandOverlay map={mapRef ?? null} visible={landOverlayVisible} {useSafetyMargin} />
<RegionOverlay map={mapRef ?? null} visible={regionOverlayVisible} {skFetch} bind:this={regionOverlayRef} onRegionsChange={(r) => { regionListData = r; }} />

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

  .select-input {
    width: 100%;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
  }

  .datetime-input {
    width: 100%;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
  }

  .build-version {
    font-size: 10px;
    color: #585b70;
    text-align: center;
    padding: 8px 0 4px;
    user-select: text;
  }

  /* Status box */
  .status-box {
    padding: 8px;
    font-size: 12px;
    text-align: center;
    border-radius: 4px;
    color: #cdd6f4;
  }
  .status-box.error { background: #45475a; color: #f38ba8; }
  .status-box.done { color: #a6e3a1; }
  .status-box.loading { color: #89b4fa; }

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
  .wave-legend.visible {
    display: flex;
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
