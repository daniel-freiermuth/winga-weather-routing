import * as dataLayer from './data-layer.js';

const API = '/plugins/signalk-weather-routing';

// Escapes HTML special characters for safe insertion into innerHTML (BUG-117).
// Also escapes quotes for safe use inside HTML attributes.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DISCLAIMER_KEY = 'wr-disclaimer-v1';
const disclaimerOverlay = document.getElementById('disclaimer-overlay');
const disclaimerOk = document.getElementById('disclaimer-ok');
if (!localStorage.getItem(DISCLAIMER_KEY)) disclaimerOverlay.classList.add('visible');
disclaimerOk.addEventListener('click', () => {
  localStorage.setItem(DISCLAIMER_KEY, '1');
  disclaimerOverlay.classList.remove('visible');
});

const map = L.map('map').setView([0, 0], 2);
map.createPane('windBarbPane').style.zIndex = '350';
map.createPane('waypointMarkerPane').style.zIndex = '345';
map.createPane('windOverlayPane').style.zIndex = '300';
map.createPane('currentOverlayPane').style.zIndex = '295';
map.createPane('landPane').style.zIndex = '250';
map.createPane('landDilatedPane').style.zIndex = '248';
map.createPane('regionPane').style.zIndex = '240';

let startLatLon = null;
let endLatLon = null;
let placing = null;
let vesselPosition = null;
let vesselPositionWs = null;
let routeWaypoints = []; // intermediate {lat,lon} points from a selected SignalK route
let routeWaypointMarkers = []; // Leaflet markers for those intermediate points
let waypointRoutes = []; // [{ label, coords: [[lon,lat],...] }] from SignalK resources
let windOverlayLayer = null;
let allWindPoints = [];
let waveOverlayLayer = null;
let allWavePoints = [];
let waveGridMeta = null;
let waveOverlayMaxM = 3.0;
let currentOverlayLayer = null;
let allCurrentPoints = [];
let currentBoundsLayer = null;
let currentEnabled = true;
let unitPrefs = null;
let windSpeedMs = false;
let conditionsGraphHeight = 200;
let windTimes = []; // unified time axis (wind + current), sorted
let windTimesCount = 0; // number of entries that are wind-native (for clamping overlay calls)
let routeScrubberRange = null; // { i0, iN } when a route is active, null otherwise
let scrubberLockedToRoute = false; // true when scrubber is locked to route duration
let windNativeTimes = []; // wind-only timestamps, for checking coverage at timeIdx
let windTimesLoaded = false;
let actualWindTimes = null;
let currentFileTimes = []; // cached times from the loaded current GRIB
let routeLayer = null;
let windBarbLayer = null;
let legLabelLayer = null;
let windBarbMarkers = []; // parallel to windBarbLayer: Leaflet marker refs for highlight
let routeLegCoords = []; // [[latA,lngA],[latB,lngB]] per leg for highlight polyline
let highlightLegLayer = null;
let prevHighlightWpIdx = -1;
const ISOCHRONE_COLOURS = ['#000000', '#4477ff', '#8833cc', '#cc3333'];
let isochroneLayerGroup = L.layerGroup().addTo(map);
let regionLayer = null;
let regionList = []; // { id, name, geometry } from resources API
let regionAvoidIds = []; // list of UUIDs currently marked as avoid
let avoidRegionListDirty = false;

// Unit conversion helpers: plugin-internal units (kn, m, nmi) ↔ SignalK preset display units.
const _toSI = { speed: (v) => v * 0.514444, depth: (v) => v, distance: (v) => v * 1852.001 };
const _fromSI = { speed: (v) => v * 1.94384, depth: (v) => v, distance: (v) => v / 1852.001 };
// 'nmi' follows SignalK's own symbol for nautical miles (IEEE / US GPO standard).
// ICAO uses 'NM'; IHO uses 'M'. We match SignalK to stay consistent across the system.
const _fallbackSym = { speed: 'kn', depth: 'm', distance: 'nmi' };

function _evalFormula(formula, value) {
  const m = formula.match(/^value\s*([*/+\-])\s*([\d.]+)$/);
  if (!m) return value;
  const n = parseFloat(m[2]);
  return m[1] === '*' ? value * n : m[1] === '/' ? value / n : m[1] === '+' ? value + n : value - n;
}

function _toDisplay(value, category, forceMs = false) {
  if (forceMs) return _toSI[category](value);
  const p = unitPrefs?.[category];
  if (!p?.formula) return value;
  return _evalFormula(p.formula, _toSI[category](value));
}

function _fmt(value, category, forceMs = false) {
  if (forceMs) return { num: _toSI[category](value).toFixed(2), sym: 'm/s' };
  const p = unitPrefs?.[category];
  if (!p?.formula) return { num: value.toFixed(1), sym: _fallbackSym[category] };
  const raw = _evalFormula(p.formula, _toSI[category](value));
  const fmtStr = p.displayFormat ?? '';
  const dot = fmtStr.indexOf('.');
  const decimals = dot >= 0 ? fmtStr.length - dot - 1 : 0;
  return { num: raw.toFixed(decimals), sym: p.symbol };
}

function _parse(displayVal, category, forceMs = false) {
  if (forceMs) return displayVal * 1.94384; // m/s → kn
  const p = unitPrefs?.[category];
  if (!p?.inverseFormula) return displayVal;
  return _fromSI[category](_evalFormula(p.inverseFormula, displayVal));
}

// Frontier points arrive in pruning order, not geographic order. Without bearing-sort,
// Leaflet draws polyline segments between non-adjacent points, producing a tangled web
// of crossing lines. splitByAngularGap then breaks the sorted ring at large gaps so
// a frontier that wraps past north doesn't close a spurious segment across the map.
function sortByBearing(pts, origin) {
  return pts
    .slice()
    .sort(
      (a, b) =>
        Math.atan2(a[1] - origin.lon, a[0] - origin.lat) - Math.atan2(b[1] - origin.lon, b[0] - origin.lat),
    );
}

const ISOCHRONE_GAP_THRESHOLD_DEG = 10;

function splitByAngularGap(pts, origin, thresholdDeg) {
  if (pts.length < 2) return [pts];
  const bearing = (p) => (Math.atan2(p[1] - origin.lon, p[0] - origin.lat) * 180) / Math.PI;
  const bearings = pts.map(bearing);
  const angularGap = (a, b) => ((b - a + 540) % 360) - 180; // signed gap a→b, range (-180, 180]
  const segments = [];
  let current = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (angularGap(bearings[i - 1], bearings[i]) > thresholdDeg) {
      segments.push(current);
      current = [pts[i]];
    } else {
      current.push(pts[i]);
    }
  }
  segments.push(current);
  // Merge last segment into first if the wrap-around gap is within threshold
  if (segments.length > 1 && angularGap(bearings[bearings.length - 1], bearings[0] + 360) <= thresholdDeg) {
    segments[0] = [...segments[segments.length - 1], ...segments[0]];
    segments.pop();
  }
  return segments;
}
const C64_PALETTE = [
  '#6c7086', // Catppuccin overlay0 (replaces invisible black)
  '#ffffff', // White
  '#883932', // Red
  '#67b6bd', // Cyan
  '#8b3f96', // Purple
  '#55a049', // Green
  '#40318d', // Blue
  '#bfce72', // Yellow
];

let tileLayer = null;
let gribBoundsLayers = []; // index-keyed array, entry may be null if file is unchecked
let gribInfoFiles = []; // GribFileMeta[], ordered to match C64_PALETTE assignment
let departureResources = []; // [{ label, lat, lon }] from routes + waypoints
let landLayerOrig = null;
let landLayerDilated = null;
let renderLandOverlayToken = 0;
let dilatedIndexReady = false;
let polarMinTws = 0; // set from /status; 0 keeps all barbs directional until polar loads (tws < 0 is never true)
let dilatedPollTimer = null;
let graphMeta = null;
let graphLayout = null;
let gribLoaded = false; // true when at least one GRIB file is indexed
let gribWarningAcked = false;
let calcStream = null;
let enabledGribPaths = new Set(); // wind GRIB paths enabled — single source of truth (REQ-131)
let currentInfoFiles = []; // ocean-current GRIB meta (single-file provider; rendered in the Grib Manager)
let gribTimesMap = new Map(); // path → ISO[] actual per-file timesteps from /grib-times
let forecastSkillHorizonHours = 96; // REQ-132 low-confidence horizon; from /config
let lastCombination = null; // last /grib-combination result for the Grib Manager UI

// --- enabled-set helpers (REQ-131): replace the old querySelector('[data-file-index]') checks ---
function windFileEnabled(f) {
  return f.type !== 'current' && enabledGribPaths.has(f.path);
}
function enabledWindMeta() {
  return gribInfoFiles.filter(windFileEnabled);
}
// Toggle one wind file: update state, bbox layer, scrubber axis, and overlays.
function setGribEnabled(path, enabled) {
  const i = gribInfoFiles.findIndex((f) => f.path === path);
  if (i < 0) return;
  if (enabled) enabledGribPaths.add(path);
  else enabledGribPaths.delete(path);
  if (enabled) {
    if (!gribBoundsLayers[i]) {
      const f = gribInfoFiles[i];
      const color = C64_PALETTE[i % C64_PALETTE.length];
      gribBoundsLayers[i] = L.rectangle(
        [
          [f.latMin, f.lonMin],
          [f.latMax, f.lonMax],
        ],
        { color, weight: 2, fill: false, dashArray: '6 4' },
      ).addTo(map);
    }
  } else {
    if (gribBoundsLayers[i]) {
      map.removeLayer(gribBoundsLayers[i]);
      gribBoundsLayers[i] = null;
    }
  }
  rebuildScrubberTimes();
  const idx = parseInt(document.getElementById('time-scrubber').value);
  if (windTimesLoaded) fetchWindPoints(idx);
  if (document.getElementById('wave-overlay-toggle').checked) fetchWavePoints(idx);
  const summary = document.getElementById('grib-enabled-count');
  if (summary) summary.textContent = String(enabledGribPaths.size);
}

// Toggle ocean-current use: update state, bbox layer, scrubber axis, and current overlay.
// (Extracted from the old sidebar current-toggle so the Grib Manager checkbox can drive it.)
function setCurrentEnabled(enabled) {
  currentEnabled = enabled;
  rebuildScrubberTimes();
  if (currentEnabled) {
    if (!currentBoundsLayer && currentInfoFiles[0]) {
      const f = currentInfoFiles[0];
      currentBoundsLayer = L.rectangle(
        [
          [f.latMin, f.lonMin],
          [f.latMax, f.lonMax],
        ],
        { color: '#89dceb', weight: 2, fill: false, dashArray: '6 4' },
      ).addTo(map);
    }
    const scrubberVal = parseInt(document.getElementById('time-scrubber').value);
    const refMs = windTimes[scrubberVal] ? new Date(windTimes[scrubberVal]).getTime() : Date.now();
    fetchCurrentPoints(refMs);
  } else {
    if (currentBoundsLayer) {
      map.removeLayer(currentBoundsLayer);
      currentBoundsLayer = null;
    }
    allCurrentPoints = [];
    if (currentOverlayLayer) {
      map.removeLayer(currentOverlayLayer);
      currentOverlayLayer = null;
    }
  }
}

const startMarker = L.marker([0, 0], { icon: greenIcon() }).addTo(map);
const endMarker = L.marker([0, 0], { icon: redIcon() }).addTo(map);
startMarker.remove();
endMarker.remove();

const btnStart = document.getElementById('btn-start');
const btnEnd = document.getElementById('btn-end');
const startCoords = document.getElementById('start-coords');
const endCoords = document.getElementById('end-coords');
const calcBtn = document.getElementById('calculate');
const landToggle = document.getElementById('land-toggle');
const statusBox = document.getElementById('status-box');
const progressWrap = document.getElementById('progress-bar-wrap');
const progressBar = document.getElementById('progress-bar');
const gribInfo = document.getElementById('grib-info');

btnStart.addEventListener('click', () => activatePlacing('start'));
btnEnd.addEventListener('click', () => activatePlacing('end'));

map.on('click', (e) => {
  if (!placing) return;
  const { lat, lng } = e.latlng;
  if (placing === 'start') {
    startLatLon = { lat, lon: lng };
    startCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    startMarker.setLatLng([lat, lng]).addTo(map);
    btnStart.classList.remove('active');
  } else {
    endLatLon = { lat, lon: lng };
    endCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    endMarker.setLatLng([lat, lng]).addTo(map);
    btnEnd.classList.remove('active');
  }
  placing = null;
  map.getContainer().style.cursor = '';
  clearRouteWaypoints();
  updateCalcButton();
});

calcBtn.addEventListener('click', startCalculation);
document.getElementById('run-test').addEventListener('click', runTest);
document.getElementById('run-helsinki-test').addEventListener('click', runHelsinkiTest);
document.getElementById('run-gothenburg-test').addEventListener('click', runGothenburgTest);

function updateScrubberLabel(idx) {
  if (!windTimes[idx]) return;
  document.getElementById('time-scrubber-label').textContent = new Date(windTimes[idx]).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

let scrubberTimer = null;
let windAbortCtrl = null;
let waveAbortCtrl = null;
let currentAbortCtrl = null;

document.getElementById('time-scrubber').addEventListener('input', (e) => {
  const idx = parseInt(e.target.value);
  updateScrubberLabel(idx);
  updateScrubberHighlight(idx);
  if (scrubberTimer) clearTimeout(scrubberTimer);
  scrubberTimer = setTimeout(() => {
    scrubberTimer = null;
    if (windAbortCtrl) windAbortCtrl.abort();
    windAbortCtrl = new AbortController();
    fetchWindPoints(idx, windAbortCtrl.signal);
    if (waveAbortCtrl) waveAbortCtrl.abort();
    waveAbortCtrl = new AbortController();
    fetchWavePoints(idx, waveAbortCtrl.signal);
    if (allCurrentPoints.length > 0 || document.getElementById('current-overlay-toggle').checked) {
      const timeMs = windTimes[idx] ? new Date(windTimes[idx]).getTime() : Date.now();
      if (currentAbortCtrl) currentAbortCtrl.abort();
      currentAbortCtrl = new AbortController();
      fetchCurrentPoints(timeMs, currentAbortCtrl.signal);
    }
  }, 150);
});

// REQ-118: jump scrubber to the nearest available timestep to wall-clock now
document.getElementById('jump-to-now').addEventListener('click', () => {
  if (!windTimesLoaded) return;
  const nowMs = Date.now();
  let idx = windTimes.findIndex((t) => new Date(t).getTime() >= nowMs);
  if (idx < 0) idx = windTimes.length - 1;
  const scrubber = document.getElementById('time-scrubber');
  scrubber.value = idx;
  updateScrubberLabel(idx);
  fetchWindPoints(idx);
  fetchWavePoints(idx);
  if (currentEnabled || allCurrentPoints.length > 0) {
    fetchCurrentPoints(windTimes[idx] ? new Date(windTimes[idx]).getTime() : Date.now());
  }
  updateScrubberHighlight(idx);
});

document.getElementById('scrubber-range-toggle').addEventListener('click', toggleScrubberRange);

// REQ-111: copy current scrubber time into the departure time field
document.getElementById('use-as-departure').addEventListener('click', () => {
  const t = windTimes[parseInt(document.getElementById('time-scrubber').value)];
  if (!t) return;
  document.getElementById('departure-time').value = toLocalDateTimeInput(new Date(t));
});

// REQ-116: clicking a ⏮ button on a GRIB file row jumps scrubber to that file's start time
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.grib-jump-btn');
  if (!btn || !windTimesLoaded || !btn.dataset.timeStart) return;
  const ts = new Date(btn.dataset.timeStart).getTime();
  const idx = windTimes.findIndex((t) => new Date(t).getTime() >= ts);
  if (idx < 0) return;
  const scrubber = document.getElementById('time-scrubber');
  scrubber.value = idx;
  updateScrubberLabel(idx);
  fetchWindPoints(idx);
  fetchWavePoints(idx);
  if (currentEnabled || allCurrentPoints.length > 0) {
    const timeMs = windTimes[idx] ? new Date(windTimes[idx]).getTime() : Date.now();
    fetchCurrentPoints(timeMs);
  }
  updateScrubberHighlight(idx);
});

const now = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
document.getElementById('departure-time').value = toLocalDateTimeInput(now);

loadGribInfo(); // server mode: loads GRIB metadata and then calls initWindScrubber
initWindScrubber(); // Windy mode: loads forecast directly from Windy minifest (harmless if loadGribInfo succeeds first)
loadCharts();
loadDepartureResources();
loadWaypointRoutes();
loadConfig();
loadRegions();
connectVesselPositionStream();

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    location.href = `/admin/#/login?redirect=${encodeURIComponent(location.href)}`;
  }
  return res;
}

async function loadCharts() {
  const charts = [
    {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  ];

  try {
    const r = await apiFetch('/signalk/v2/api/resources/charts');
    if (r.ok) {
      const data = await r.json();
      for (const [id, chart] of Object.entries(data)) {
        if (chart.serverType !== 'tilelayer') continue;
        if (chart.url?.includes('.mvt')) continue;
        charts.push({
          name: chart.name || id,
          url: chart.url.replace(/\$z/g, '{z}').replace(/\$x/g, '{x}').replace(/\$y/g, '{y}'),
          attribution: chart.name || id,
        });
      }
    }
  } catch (e) {
    /* fall back to OSM only */
  }

  const select = document.getElementById('chart-select');
  select.innerHTML = charts.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
  setChart(charts[0]);
  select.addEventListener('change', () => setChart(charts[parseInt(select.value)]));
}

function setChart(chart) {
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(chart.url, { attribution: chart.attribution, maxZoom: 19 }).addTo(map);
}

async function loadDepartureResources() {
  const sel = document.getElementById('departure-resource');
  const entries = [];

  const [routesRes, wpsRes] = await Promise.allSettled([
    apiFetch('/signalk/v2/api/resources/routes'),
    apiFetch('/signalk/v2/api/resources/waypoints'),
  ]);

  if (routesRes.status === 'fulfilled' && routesRes.value.ok) {
    const data = await routesRes.value.json();
    for (const [, r] of Object.entries(data)) {
      const coords = r.feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length === 0) continue;
      const [lon, lat] = coords[coords.length - 1]; // last waypoint — continue from where route ended
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      entries.push({ label: `\u{1F5FA} ${r.name ?? 'Unnamed route'}`, lat, lon });
    }
  }

  if (wpsRes.status === 'fulfilled' && wpsRes.value.ok) {
    const data = await wpsRes.value.json();
    for (const [, wp] of Object.entries(data)) {
      const coords = wp.feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const [lon, lat] = coords;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      entries.push({ label: `\u{1F4CD} ${wp.name ?? 'Unnamed waypoint'}`, lat, lon });
    }
  }

  departureResources = entries;
  if (entries.length === 0) {
    sel.style.display = 'none';
    return;
  }

  sel.innerHTML =
    '<option value="">— set from resources —</option>' +
    entries.map((e, i) => `<option value="${i}">${escapeHtml(e.label)}</option>`).join('');
  sel.style.display = '';
}

function clearRouteWaypoints() {
  routeWaypoints = [];
  for (const m of routeWaypointMarkers) map.removeLayer(m);
  routeWaypointMarkers = [];
  document.getElementById('waypoints-route').value = '';
}

async function loadWaypointRoutes() {
  let data;
  try {
    const r = await apiFetch('/signalk/v2/api/resources/routes');
    if (!r.ok) return;
    data = await r.json();
  } catch {
    return;
  }

  const entries = [];
  for (const [, route] of Object.entries(data)) {
    const coords = route.feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    entries.push({ label: route.name ?? 'Unnamed route', coords });
  }
  waypointRoutes = entries;
  if (entries.length === 0) return;

  const sel = document.getElementById('waypoints-route');
  sel.innerHTML =
    '<option value="">— route waypoints —</option>' +
    entries.map((e, i) => `<option value="${i}">${escapeHtml(e.label)}</option>`).join('');
  document.getElementById('waypoints-route-section').style.display = '';
}

document.getElementById('waypoints-route').addEventListener('change', (e) => {
  const idx = parseInt(e.target.value);
  if (isNaN(idx)) {
    // Placeholder selected — only clear intermediate markers, keep start/end
    for (const m of routeWaypointMarkers) map.removeLayer(m);
    routeWaypointMarkers = [];
    routeWaypoints = [];
    return;
  }
  const { coords } = waypointRoutes[idx];
  const first = coords[0];
  const last = coords[coords.length - 1];

  startLatLon = { lat: first[1], lon: first[0] };
  endLatLon = { lat: last[1], lon: last[0] };
  startCoords.textContent = `${startLatLon.lat.toFixed(4)}, ${startLatLon.lon.toFixed(4)}`;
  endCoords.textContent = `${endLatLon.lat.toFixed(4)}, ${endLatLon.lon.toFixed(4)}`;
  startMarker.setLatLng([startLatLon.lat, startLatLon.lon]).addTo(map);
  endMarker.setLatLng([endLatLon.lat, endLatLon.lon]).addTo(map);

  routeWaypoints = coords.slice(1, -1).map((c) => ({ lat: c[1], lon: c[0] }));

  for (const m of routeWaypointMarkers) map.removeLayer(m);
  routeWaypointMarkers = [];
  routeWaypoints.forEach((wp, i) => {
    const marker = L.marker([wp.lat, wp.lon], {
      icon: L.divIcon({
        html: `<div style="background:#f9e2af;color:#1e1e2e;width:20px;height:20px;border-radius:50%;border:2px solid #1e1e2e;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold">${i + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        className: '',
      }),
      pane: 'waypointMarkerPane',
    }).addTo(map);
    routeWaypointMarkers.push(marker);
  });

  // Reset departure resource — it now refers to a different position
  document.getElementById('departure-resource').value = '';
  updateCalcButton();
});

async function loadConfig() {
  const r = await apiFetch(`${API}/config`);
  if (!r.ok) return;
  const cfg = await r.json();
  if (cfg.configuration?.hideTestButtons) {
    for (const id of ['run-test', 'run-helsinki-test', 'run-gothenburg-test'])
      document.getElementById(id).style.display = 'none';
  }
  if (cfg.configuration?.waveOverlayMaxM != null) {
    waveOverlayMaxM = cfg.configuration.waveOverlayMaxM;
  }
  windSpeedMs = !!cfg.configuration?.windSpeedMs;
  if (cfg.configuration?.conditionsGraphHeight != null) {
    conditionsGraphHeight = cfg.configuration.conditionsGraphHeight;
  }
  if (cfg.configuration?.forecastSkillHorizonHours != null) {
    forecastSkillHorizonHours = cfg.configuration.forecastSkillHorizonHours;
  }

  try {
    const up = await fetch('/signalk/v1/unitpreferences/active');
    if (up.ok) unitPrefs = (await up.json()).categories;
  } catch {
    /* offline or not supported — fall back to kn/m/nmi */
  }

  const speedSym = _fmt(0, 'speed').sym;
  const windSym = _fmt(0, 'speed', windSpeedMs).sym;
  const depthSym = _fmt(0, 'depth').sym;

  document.getElementById('motor-below-unit').textContent = `${speedSym}, speed`;
  document.getElementById('motor-speed-unit').textContent = speedSym;
  document.getElementById('motor-below-kn').placeholder = speedSym;
  document.getElementById('motor-speed-kn').placeholder = speedSym;
  document.getElementById('max-wind-label').textContent = `Max wind (${windSym}, empty = no limit)`;
  document.getElementById('max-wave-label').textContent = `Max wave (${depthSym}, empty = no limit)`;
  document.getElementById('wave-legend-max').textContent = `${_fmt(waveOverlayMaxM, 'depth').num} ${depthSym}`;
  const smFmt = _fmt(0.5, 'distance');
  document.getElementById('safety-margin-dist').textContent = `${smFmt.num} ${smFmt.sym}`;
  try {
    const bi = await fetch('./buildinfo.json');
    if (bi.ok) {
      const { version } = await bi.json();
      document.getElementById('build-version').textContent = version;
    }
  } catch {
    /* not available in dev without a build step */
  }
}

document.getElementById('departure-resource').addEventListener('change', (e) => {
  const idx = parseInt(e.target.value);
  if (isNaN(idx)) return;
  const { lat, lon } = departureResources[idx];
  startLatLon = { lat, lon };
  startCoords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  startMarker.setLatLng([lat, lon]).addTo(map);
  e.target.value = ''; // reset so the same item can be re-selected
  clearRouteWaypoints();
  updateCalcButton();
});

function connectVesselPositionStream() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/signalk/v1/stream?subscribe=none`);
  vesselPositionWs = ws;
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: 'navigation.position', period: 1000 }],
      }),
    );
  };
  ws.onmessage = (e) => {
    try {
      const delta = JSON.parse(e.data);
      for (const update of delta.updates ?? []) {
        for (const v of update.values ?? []) {
          if (v.path === 'navigation.position' && v.value) {
            vesselPosition = { lat: v.value.latitude, lon: v.value.longitude };
            document.getElementById('btn-vessel-position').disabled = false;
            document.getElementById('btn-vessel-position').title = 'Set start to vessel position';
          }
        }
      }
    } catch {
      /* ignore parse errors */
    }
  };
  ws.onclose = () => {
    vesselPosition = null;
    document.getElementById('btn-vessel-position').disabled = true;
    document.getElementById('btn-vessel-position').title = 'Vessel position not available';
    vesselPositionWs = null;
    setTimeout(connectVesselPositionStream, 5000);
  };
}

document.getElementById('btn-vessel-position').addEventListener('click', () => {
  if (!vesselPosition) return;
  const { lat, lon } = vesselPosition;
  startLatLon = { lat, lon };
  startCoords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  startMarker.setLatLng([lat, lon]).addTo(map);
  clearRouteWaypoints();
  updateCalcButton();
});

function clearGribBoundsLayers() {
  for (const l of gribBoundsLayers) {
    if (l) map.removeLayer(l);
  }
  gribBoundsLayers = [];
  if (currentBoundsLayer) {
    map.removeLayer(currentBoundsLayer);
    currentBoundsLayer = null;
  }
}

async function loadGribInfo() {
  try {
    const r = await apiFetch(`${API}/grib-info`, { cache: 'no-store' });
    const j = await r.json();

    clearGribBoundsLayers();

    const currentInfoEl = document.getElementById('current-info');
    const hasWindFiles = j.files && j.files.length > 0;
    const hasCurrentFiles = j.currentFiles && j.currentFiles.length > 0;

    if (!hasWindFiles && !hasCurrentFiles) {
      gribLoaded = false;
      gribInfo.innerHTML = j.gribDir
        ? `<span>No GRIB files found in</span><br>${escapeHtml(j.gribDir)}`
        : '<span>No GRIB directory configured</span>';
      currentInfoEl.style.display = 'none';
      const removeOldBtn = document.getElementById('remove-old-gribs-btn');
      removeOldBtn.style.display = 'none';
      showGribWarning(j.failedFiles ?? []);
      updateCalcButton();
      return;
    }

    gribLoaded = hasWindFiles;

    gribInfoFiles = j.files ?? [];

    // Draw one dashed bbox rectangle per file in C64 palette order
    let boundsUnion = null;
    j.files.forEach((f, i) => {
      const color = C64_PALETTE[i % C64_PALETTE.length];
      const layer = L.rectangle(
        [
          [f.latMin, f.lonMin],
          [f.latMax, f.lonMax],
        ],
        {
          color,
          weight: 2,
          fill: false,
          dashArray: '6 4',
        },
      ).addTo(map);
      gribBoundsLayers[i] = layer;
      const b = L.latLngBounds([
        [f.latMin, f.lonMin],
        [f.latMax, f.lonMax],
      ]);
      boundsUnion = boundsUnion ? boundsUnion.extend(b) : b;
    });
    if (boundsUnion) map.fitBounds(boundsUnion);

    // Sidebar: compact summary + "Open GRIB Manager" button (REQ-131). Per-file
    // selection, timeline, warnings, and the optimized-combination proposal live in
    // the Grib Manager modal. Bounding-box rectangles stay on the map per enabled file.
    enabledGribPaths = new Set(j.files.map((f) => f.path));
    gribInfo.innerHTML = !hasWindFiles
      ? '<span>No wind GRIB files loaded</span>'
      : '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        `<span style="font-size:11px;color:#cdd6f4">${j.files.length} wind GRIB${j.files.length === 1 ? '' : 's'}</span>` +
        (j.currentFiles && j.currentFiles.length > 0
          ? `<span style="font-size:11px;color:#89dceb">${j.currentFiles.length} ocean current</span>`
          : '') +
        `<span style="font-size:10px;color:#a6adc8"><b id="grib-enabled-count">${j.files.length}</b> enabled</span>` +
        `<button id="open-grib-manager-btn" style="font-size:11px;cursor:pointer">Open GRIB Manager…</button>` +
        '</div>';
    const openMgrBtn = document.getElementById('open-grib-manager-btn');
    if (openMgrBtn) openMgrBtn.addEventListener('click', openGribManager);

    // Current files: stored for the Grib Manager (single-file provider). The sidebar
    // current section is no longer rendered — current GRIBs are managed in the modal.
    currentInfoFiles = j.currentFiles ?? [];
    currentEnabled = true;
    currentInfoEl.style.display = 'none';
    if (currentInfoFiles.length > 0) {
      const f = currentInfoFiles[0];
      if (currentBoundsLayer) map.removeLayer(currentBoundsLayer);
      currentBoundsLayer = L.rectangle(
        [
          [f.latMin, f.lonMin],
          [f.latMax, f.lonMax],
        ],
        { color: '#89dceb', weight: 2, fill: false, dashArray: '6 4' },
      ).addTo(map);
      const scrubberVal = parseInt(document.getElementById('time-scrubber').value);
      const refMs = windTimes[scrubberVal] ? new Date(windTimes[scrubberVal]).getTime() : Date.now();
      fetchCurrentPoints(refMs);
    } else {
      if (currentBoundsLayer) {
        map.removeLayer(currentBoundsLayer);
        currentBoundsLayer = null;
      }
      allCurrentPoints = [];
      if (currentOverlayLayer) {
        map.removeLayer(currentOverlayLayer);
        currentOverlayLayer = null;
      }
    }

    // "Remove old GRIBs" visibility is driven from the Grib Manager (renderGribManagerBody).

    showGribWarning(j.failedFiles ?? []);
    updateCalcButton();
    initWindScrubber();
  } catch (e) {
    gribInfo.textContent = 'Could not reach plugin API';
  }
}

function showGribWarning(failedFiles) {
  const warn = document.getElementById('grib-warning');
  if (!failedFiles || failedFiles.length === 0) {
    warn.style.display = 'none';
    gribWarningAcked = true;
    updateCalcButton();
    return;
  }
  gribWarningAcked = false;
  const total = gribBoundsLayers.length + failedFiles.length;
  const ok = gribBoundsLayers.length;
  document.getElementById('grib-warning-msg').textContent =
    `${failedFiles.length} of ${total} GRIB file(s) could not be indexed:`;
  const ul = document.getElementById('grib-warning-list');
  ul.innerHTML = failedFiles
    .map((f) => `<li title="${escapeHtml(f.error)}">${escapeHtml(f.path.split('/').pop())}</li>`)
    .join('');
  document.getElementById('grib-warning-ack').textContent = `Continue with ${ok} of ${total} file(s)`;
  warn.style.display = 'block';
  updateCalcButton();
}

document.getElementById('grib-warning-ack').addEventListener('click', () => {
  gribWarningAcked = true;
  document.getElementById('grib-warning').style.display = 'none';
  updateCalcButton();
});

async function loadRegions() {
  try {
    // Fetch regions from the standard SignalK Resources API.
    // Returns an object keyed by UUID.
    const r = await fetch('/signalk/v2/api/resources/regions');
    if (!r.ok) {
      regionList = [];
      return;
    }
    const data = await r.json();
    if (!data || typeof data !== 'object') {
      regionList = [];
      return;
    }

    regionList = Object.entries(data)
      .map(([id, entry]) => ({
        id,
        name: entry?.name ?? id.slice(0, 8),
        geometry: entry?.feature?.geometry,
      }))
      .filter((r) => r.geometry);

    // Fetch avoid list from the plugin endpoint.
    const avoidR = await apiFetch(`${API}/avoid-regions`);
    if (avoidR.ok) {
      const avoidJ = await avoidR.json();
      regionAvoidIds = avoidJ.avoidRegionIds ?? [];
    }

    // Update the region list sidebar and overlay.
    renderRegionList();
    await renderRegionOverlay();
    document.getElementById('region-toggle').disabled = false;
  } catch {
    regionList = [];
  }
}

function renderRegionList() {
  const container = document.getElementById('region-list');
  if (regionList.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = regionList
    .map((reg) => {
      const id = reg.id ?? reg._id ?? '';
      const name = reg.name ?? id.slice(0, 8);
      const isAvoided = regionAvoidIds.includes(id);
      return `
    <label class="region-item" data-uuid="${escapeHtml(id)}"
      style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;
             cursor:pointer;font-size:12px;color:#cdd6f4;background:${isAvoided ? '#3a1f28' : '#2a2f45'};
             border:1px solid ${isAvoided ? '#f38ba8' : 'transparent'}">
      <input type="checkbox" ${isAvoided ? 'checked' : ''} style="accent-color:#f38ba8;cursor:pointer">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</span>
    </label>`;
    })
    .join('');

  container.querySelectorAll('.region-item').forEach((el) => {
    const cb = el.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', async () => {
      await toggleRegionAvoid(el.dataset.uuid, cb.checked);
    });
  });
}

async function toggleRegionAvoid(uuid, avoid) {
  // Refresh region geometry and the avoid list from the backend before toggling,
  // so the overlay reflects any edits made in freeboard-sk (REQ-98).
  await loadRegions();
  if (avoid) {
    if (!regionAvoidIds.includes(uuid)) regionAvoidIds.push(uuid);
  } else {
    regionAvoidIds = regionAvoidIds.filter((id) => id !== uuid);
  }
  renderRegionList();
  await renderRegionOverlay();
  // Persist immediately via PUT /avoid-regions.
  try {
    await apiFetch(`${API}/avoid-regions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avoidRegionIds: regionAvoidIds }),
    });
  } catch {
    /* best-effort */
  }
}

async function renderRegionOverlay() {
  if (regionLayer) {
    map.removeLayer(regionLayer);
    regionLayer = null;
  }
  if (!document.getElementById('region-toggle').checked || regionList.length === 0) return;

  const features = [];
  for (const reg of regionList) {
    if (!reg.geometry) continue;
    const id = reg.id ?? reg._id ?? '';
    const isAvoided = regionAvoidIds.includes(id);
    features.push({
      type: 'Feature',
      id,
      properties: { name: reg.name ?? '', avoided: isAvoided },
      geometry: reg.geometry,
    });
  }
  if (features.length === 0) return;

  regionLayer = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      pane: 'regionPane',
      renderer: L.svg({ pane: 'regionPane' }),
      style: (feature) => {
        if (feature?.properties?.avoided) {
          return {
            color: '#f38ba8',
            weight: 2,
            fillColor: 'url(#hatch-avoid)',
            fillOpacity: 1,
          };
        }
        return {
          color: '#6c7086',
          weight: 1,
          dashArray: '4 4',
          fillColor: 'rgba(148,148,148,0.15)',
          fillOpacity: 1,
        };
      },
    },
  ).addTo(map);
}

document.getElementById('region-toggle').addEventListener('change', async (e) => {
  if (e.target.checked) {
    await loadRegions();
  } else {
    if (regionLayer) {
      map.removeLayer(regionLayer);
      regionLayer = null;
    }
  }
});

async function startCalculation() {
  if (!startLatLon || !endLatLon) return;
  // Reset scrubber range toggle (BUG-132)
  routeScrubberRange = null;
  scrubberLockedToRoute = false;
  document.getElementById('scrubber-range-toggle').style.display = 'none';
  // Refresh region geometry from SignalK before routing so any edits
  // made in freeboard-sk are reflected in the overlay (REQ-98).
  await loadRegions();
  const depTime = document.getElementById('departure-time').value;
  if (!depTime) return setStatus('error', 'Please set a departure time');

  clearIsochrones();
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (windBarbLayer) {
    map.removeLayer(windBarbLayer);
    windBarbLayer = null;
  }
  if (legLabelLayer) {
    map.removeLayer(legLabelLayer);
    legLabelLayer = null;
  }
  if (highlightLegLayer) {
    map.removeLayer(highlightLegLayer);
    highlightLegLayer = null;
  }
  windBarbMarkers = [];
  routeLegCoords = [];
  prevHighlightWpIdx = -1;
  if (windTimesLoaded) {
    const scrubber = document.getElementById('time-scrubber');
    scrubber.min = 0;
    scrubber.max = windTimes.length - 1;
  }
  if (calcStream) {
    calcStream.close();
    calcStream = null;
  }
  document.getElementById('save-route-btn').style.display = 'none';
  document.getElementById('conditions-panel').style.display = 'none';
  hideFailurePopup();
  calcBtn.disabled = true;
  landToggle.disabled = true;
  landToggle.style.opacity = '0.4';
  progressWrap.style.display = 'block';
  progressBar.style.width = '0';
  setStatus('', 'Connecting…');
  console.log(`[startCalculation] t=${Date.now()}`);

  // Open SSE stream and wait for onopen before sending the POST.
  // This guarantees the server has registered the client in sseClients
  // before the calculation starts, so no onProgress events are missed.
  try {
    await openCalcStream();
  } catch (e) {
    setStatus('error', `Could not open event stream: ${e.message}`);
    calcBtn.disabled = false;
    landToggle.disabled = false;
    landToggle.style.opacity = '';
    return;
  }

  setStatus('', 'Sending request…');

  try {
    const r = await apiFetch(`${API}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: startLatLon,
        end: endLatLon,
        departureTime: new Date(depTime).toISOString(),
        ...(routeWaypoints.length > 0 ? { waypoints: routeWaypoints } : {}),
        avoidRegionIds: regionAvoidIds,
        useSafetyMargin: document.getElementById('safety-margin-toggle').checked,
        useLandAvoidance: document.getElementById('land-avoidance-toggle').checked,
        enabledGribPaths: gribInfoFiles
          .filter((f) => f.type !== 'current' && enabledGribPaths.has(f.path))
          .map((f) => f.path),
        useCurrentGrib: currentEnabled,
        options: {
          motorBelowKn:
            _parse(parseFloat(document.getElementById('motor-below-kn').value) || 0, 'speed') || undefined,
          motorSpeedKn:
            _parse(parseFloat(document.getElementById('motor-speed-kn').value) || 0, 'speed') || undefined,
          waitForWind: document.getElementById('wait-for-wind-toggle').checked || undefined,
          maxWindKn:
            _parse(parseFloat(document.getElementById('max-wind-kn').value) || 0, 'speed', windSpeedMs) ||
            undefined,
          maxWaveM: _parse(parseFloat(document.getElementById('max-wave-m').value) || 0, 'depth') || undefined,
        },
      }),
    });
    const j = await r.json();
    if (j.error) {
      if (calcStream) {
        calcStream.close();
        calcStream = null;
      }
      setStatus('error', j.error);
      calcBtn.disabled = false;
      landToggle.disabled = false;
      landToggle.style.opacity = '';
      return;
    }
  } catch (e) {
    if (calcStream) {
      calcStream.close();
      calcStream = null;
    }
    setStatus('error', String(e));
    calcBtn.disabled = false;
    landToggle.disabled = false;
    landToggle.style.opacity = '';
    return;
  }

  if (!calcStream) return; // SSE error/done already handled the result
  setStatus('', 'Calculating…');
}

function openCalcStream() {
  return new Promise((resolve, reject) => {
    console.log(`[openCalcStream] EventSource created t=${Date.now()}`);
    const stream = new EventSource(`${API}/calculation-stream`);
    const hangTimer = setTimeout(() => {
      console.log(`[openCalcStream] HANG: onopen has not fired after 5s, readyState=${stream.readyState}`);
    }, 5000);

    stream.onopen = () => {
      clearTimeout(hangTimer);
      console.log(`[openCalcStream] onopen fired t=${Date.now()}`);
      calcStream = stream;
      resolve();
    };

    stream.onmessage = (e) => {
      const j = JSON.parse(e.data);

      if (j.type === 'progress') {
        progressBar.style.width = `${j.progress}%`;
        setStatus('', `Calculating… ${j.progress}%`);
        if (j.frontier?.length && document.getElementById('isochrone-toggle').checked) {
          const pts = sortByBearing(
            j.frontier.map(([lat, lon]) => [lat, lon]),
            startLatLon,
          );
          const colour = ISOCHRONE_COLOURS[isochroneLayerGroup.getLayers().length % ISOCHRONE_COLOURS.length];
          const segments = splitByAngularGap(pts, startLatLon, ISOCHRONE_GAP_THRESHOLD_DEG);
          for (const seg of segments) {
            L.polyline(seg, { color: colour, weight: 1.0, opacity: 0.6, interactive: false }).addTo(
              isochroneLayerGroup,
            );
          }
        }
      } else if (j.type === 'done') {
        stream.close();
        calcStream = null;
        progressBar.style.width = '100%';
        setStatus('done', 'Route calculated.');
        calcBtn.disabled = false;
        landToggle.disabled = false;
        landToggle.style.opacity = '';
        document.getElementById('save-route-btn').style.display = 'block';
        fetchAndDrawRoute();
      } else if (j.type === 'warning') {
        stream.close();
        calcStream = null;
        progressBar.style.width = '100%';
        setStatus('done', `Partial route: ${j.warning}`);
        showFailurePopup(j.warning, true);
        calcBtn.disabled = false;
        landToggle.disabled = false;
        landToggle.style.opacity = '';
        document.getElementById('save-route-btn').style.display = 'block';
        fetchAndDrawRoute();
      } else if (j.type === 'error') {
        stream.close();
        calcStream = null;
        const reasonText =
          {
            land: 'All available paths are blocked by land.',
            wind: 'Wind is too light or adverse to make progress under sail.',
            grib_exhausted: 'Destination not reached before the forecast period ends.',
          }[j.reason] ?? '';
        const errMsg = (j.error ?? 'Unknown error') + (reasonText ? ` — ${reasonText}` : '');
        setStatus('error', errMsg);
        showFailurePopup(errMsg, false);
        calcBtn.disabled = false;
        landToggle.disabled = false;
        landToggle.style.opacity = '';
        progressWrap.style.display = 'none';
      }
    };

    stream.onerror = () => {
      console.log(`[openCalcStream] onerror fired t=${Date.now()} calcStream=${calcStream !== null}`);
      stream.close();
      if (!calcStream) {
        // onopen never fired — connection failed
        reject(new Error('stream connection failed'));
      } else {
        calcStream = null;
        setStatus('error', 'Lost connection to calculation stream');
        calcBtn.disabled = false;
        landToggle.disabled = false;
        landToggle.style.opacity = '';
        progressWrap.style.display = 'none';
      }
    };
  });
}

function clearIsochrones() {
  isochroneLayerGroup.clearLayers();
}

function windBarbSvg(tws, windDir, color = '#333') {
  if (tws < polarMinTws) {
    // Below polar minimum TWS: calm symbol — ring + centre dot, no staff, no rotation.
    return (
      `<div style="width:30px;height:36px;overflow:visible">` +
      `<svg width="30" height="36" viewBox="-6 0 18 36" style="overflow:visible">` +
      `<circle cx="0" cy="22" r="5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<circle cx="0" cy="22" r="2" fill="${color}"/>` +
      `</svg></div>`
    );
  }

  let remaining = Math.round(tws);
  const pennants = Math.floor(remaining / 50);
  remaining %= 50;
  const fulls = Math.floor(remaining / 10);
  remaining %= 10;
  const halfs = Math.floor(remaining / 5);

  // Staff points up; barbs drawn from tip downward; no ring.
  let y = 2;
  let barbs = '';
  for (let i = 0; i < pennants; i++) {
    barbs += `<polygon points="0,${y} 8,${y + 4} 0,${y + 8}" fill="${color}"/>`;
    y += 10;
  }
  for (let i = 0; i < fulls; i++) {
    barbs += `<line x1="0" y1="${y}" x2="8" y2="${y + 4}" stroke="${color}" stroke-width="1.5"/>`;
    y += 5;
  }
  if (halfs) {
    barbs += `<line x1="0" y1="${y}" x2="4" y2="${y + 2}" stroke="${color}" stroke-width="1.5"/>`;
  }
  const staff = `<line x1="0" y1="2" x2="0" y2="22" stroke="${color}" stroke-width="1.5"/>`;
  // Arrowhead at the TOWARD tip — after rotation by windDir, points where the wind blows to.
  const arrowhead = `<polygon points="-3,19 3,19 0,26" fill="${color}"/>`;

  return (
    `<div style="transform:rotate(${windDir}deg);transform-origin:15px 33px;width:30px;height:36px;overflow:visible">` +
    `<svg width="30" height="36" viewBox="-6 0 18 36" style="overflow:visible">` +
    `${staff}${barbs}${arrowhead}` +
    `</svg></div>`
  );
}

async function fetchWindPoints(timeIdx, signal) {
  if (!windTimesLoaded) return;
  const timeStr = windTimes[timeIdx];
  if (!timeStr || !windNativeTimes.includes(timeStr)) {
    allWindPoints = [];
    if (windOverlayLayer) { map.removeLayer(windOverlayLayer); windOverlayLayer = null; }
    return;
  }
  // Map unified timeIdx to the wind-native index
  const nativeIdx = windNativeTimes.indexOf(timeStr);
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(),
    latMax: bounds.getNorth(),
    lonMin: bounds.getWest(),
    lonMax: bounds.getEast(),
  };
  try {
    allWindPoints = await dataLayer.fetchWindGrid(nativeIdx, bbox, signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  updateScrubberLabel(timeIdx);
  if (document.getElementById('wind-overlay-toggle').checked) renderWindOverlay();
  if (document.getElementById('wave-overlay-toggle').checked) renderWaveOverlay();
}

function waveColor(h) {
  const maxH = waveOverlayMaxM || 3.0;
  if (h == null || h < 0.2) return 'rgba(0,0,0,0)';
  const t = Math.max(0, Math.min(1, h / maxH));
  const hue = Math.round(240 - t * 240);
  return `hsla(${hue}, 100%, 50%, 0.7)`;
}

async function fetchWavePoints(timeIdx, signal) {
  if (!windTimesLoaded) return;
  const timeStr = windTimes[timeIdx];
  if (!timeStr || !windNativeTimes.includes(timeStr)) {
    allWavePoints = [];
    if (waveOverlayLayer) { map.removeLayer(waveOverlayLayer); waveOverlayLayer = null; }
    return;
  }
  const nativeIdx = windNativeTimes.indexOf(timeStr);
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(),
    latMax: bounds.getNorth(),
    lonMin: bounds.getWest(),
    lonMax: bounds.getEast(),
  };
  try {
    const result = await dataLayer.fetchWaveGrid(nativeIdx, bbox, signal);
    allWavePoints = result.points;
    // Compute grid meta from the actual points for the canvas renderer
    if (allWavePoints.length > 0) {
      const lats = allWavePoints.map((p) => p.lat);
      const lons = allWavePoints.map((p) => p.lon);
      waveGridMeta = {
        latMin: Math.min(...lats), latMax: Math.max(...lats),
        lonMin: Math.min(...lons), lonMax: Math.max(...lons),
        latStep: 0.5, lonStep: 0.5,
      };
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  if (document.getElementById('wave-overlay-toggle').checked) renderWaveOverlay();
}

function renderWaveOverlay() {
  if (waveOverlayLayer) {
    map.removeLayer(waveOverlayLayer);
    waveOverlayLayer = null;
  }
  if (allWavePoints.length === 0 || !waveGridMeta) return;

  const pts = allWavePoints.filter((p) => p.waveHeight != null);
  if (pts.length === 0) return;
  const whVals = pts.map((p) => p.waveHeight);
  const minWh = Math.min(...whVals);
  const maxWh = Math.max(...whVals);
  const meanWh = whVals.reduce((a, b) => a + b, 0) / whVals.length;
  console.log(
    `[wave-overlay] ${pts.length}/${allWavePoints.length} points have waveHeight. min=${minWh.toFixed(3)} max=${maxWh.toFixed(3)} mean=${meanWh.toFixed(3)}`,
  );

  const { latMin, latMax, lonMin, lonMax, latStep, lonStep } = waveGridMeta;
  const nLat = Math.round((latMax - latMin) / latStep);
  const nLon = Math.round((lonMax - lonMin) / lonStep);

  const grid = new Float32Array((nLat + 1) * (nLon + 1));
  grid.fill(NaN);
  for (const { lat, lon, waveHeight } of pts) {
    const i = Math.round((lat - latMin) / latStep);
    const j = Math.round((lon - lonMin) / lonStep);
    grid[i * (nLon + 1) + j] = waveHeight;
  }

  const canvas = document.createElement('canvas');
  canvas.width = nLon + 1;
  canvas.height = nLat + 1;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(nLon + 1, nLat + 1);
  const maxH = waveOverlayMaxM || 3.0;

  // Canvas rows must be spaced in Web Mercator Y, not geographic latitude.
  // L.imageOverlay stretches the image linearly in Mercator space; a lat-linear
  // canvas would displace data by up to 85 km northward when the canvas spans many degrees.
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const mercToLat = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  const yTop = mercY(latMax + latStep / 2);
  const yBot = mercY(latMin - latStep / 2);

  for (let canvasRow = 0; canvasRow <= nLat; canvasRow++) {
    const lat = mercToLat(yTop - (canvasRow / nLat) * (yTop - yBot));
    const i = Math.round((lat - latMin) / latStep);
    if (i < 0 || i > nLat) continue;
    for (let j = 0; j <= nLon; j++) {
      const h = grid[i * (nLon + 1) + j];
      const idx = (canvasRow * (nLon + 1) + j) * 4;
      if (isNaN(h) || h < 0.2) {
        imageData.data[idx + 3] = 0;
      } else {
        const t = Math.max(0, Math.min(1, h / maxH));
        const hue = 240 - t * 240;
        const hh = hue / 60;
        const c = 0.5;
        const x = c * (1 - Math.abs((hh % 2) - 1));
        let r1 = 0,
          g1 = 0,
          b1 = 0;
        if (hh < 1) {
          r1 = c;
          g1 = x;
        } else if (hh < 2) {
          r1 = x;
          g1 = c;
        } else if (hh < 3) {
          g1 = c;
          b1 = x;
        } else if (hh < 4) {
          g1 = x;
          b1 = c;
        } else if (hh < 5) {
          r1 = x;
          b1 = c;
        } else {
          r1 = c;
          b1 = x;
        }
        imageData.data[idx] = Math.round(r1 * 255);
        imageData.data[idx + 1] = Math.round(g1 * 255);
        imageData.data[idx + 2] = Math.round(b1 * 255);
        imageData.data[idx + 3] = 178;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const gridBounds = L.latLngBounds(
    L.latLng(latMin - latStep / 2, lonMin - lonStep / 2),
    L.latLng(latMax + latStep / 2, lonMax + lonStep / 2),
  );

  waveOverlayLayer = L.imageOverlay(canvas.toDataURL(), gridBounds, {
    opacity: 1.0,
    interactive: false,
  }).addTo(map);
}

function renderWindOverlay() {
  if (windOverlayLayer) map.removeLayer(windOverlayLayer);
  windOverlayLayer = L.layerGroup();

  const bounds = map.getBounds();
  // 40px minimum spacing — fingertip-width on a plotter screen, distinguishable with gloves.
  const MIN_PX = 40;
  const keptPx = [];

  for (const { lat, lon, u, v } of allWindPoints) {
    if (!bounds.contains([lat, lon])) continue;

    const spd = Math.sqrt(u * u + v * v) * 1.94384; // m/s → knots
    if (spd < 0.5) continue;

    const px = map.latLngToContainerPoint([lat, lon]);
    let tooClose = false;
    for (const p of keptPx) {
      const dx = p.x - px.x,
        dy = p.y - px.y;
      if (dx * dx + dy * dy < MIN_PX * MIN_PX) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    keptPx.push(px);
    const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
    L.marker([lat, lon], {
      icon: L.divIcon({
        html: `<div style="opacity:0.85;pointer-events:none;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9))">${windBarbSvg(spd, dir, '#ffffff')}</div>`,
        iconSize: [30, 36],
        iconAnchor: [0, 22],
        className: '',
      }),
      pane: 'windOverlayPane',
    }).addTo(windOverlayLayer);
  }
  windOverlayLayer.addTo(map);
}

async function fetchCurrentPoints(timeMs, signal) {
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(),
    latMax: bounds.getNorth(),
    lonMin: bounds.getWest(),
    lonMax: bounds.getEast(),
  };
  try {
    allCurrentPoints = await dataLayer.fetchCurrentGrid(timeMs, bbox, signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  if (document.getElementById('current-overlay-toggle').checked) renderCurrentOverlay();
}

function renderCurrentOverlay() {
  if (currentOverlayLayer) map.removeLayer(currentOverlayLayer);
  currentOverlayLayer = L.layerGroup();

  const bounds = map.getBounds();
  const MIN_PX = 40;
  const keptPx = [];

  for (const { lat, lon, u, v } of allCurrentPoints) {
    if (!bounds.contains([lat, lon])) continue;

    const spd = Math.sqrt(u * u + v * v) * 1.94384; // m/s → knots
    if (spd < 0.05) continue;

    const px = map.latLngToContainerPoint([lat, lon]);
    let tooClose = false;
    for (const p of keptPx) {
      const dx = p.x - px.x,
        dy = p.y - px.y;
      if (dx * dx + dy * dy < MIN_PX * MIN_PX) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    keptPx.push(px);

    // Arrow pointing in the direction the current flows TO (opposite of wind convention).
    const dir = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
    // Scale: 1 kn ≈ 16px shaft, max ~5 kn (ocean surface current).
    const len = Math.min(28, Math.max(8, spd * 16));
    const rad = (dir * Math.PI) / 180;
    const dx = Math.sin(rad) * len,
      dy = -Math.cos(rad) * len;
    const svg =
      `<svg width="40" height="40" viewBox="-20 -20 40 40" xmlns="http://www.w3.org/2000/svg">` +
      `<line x1="0" y1="0" x2="${dx.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#74c7ec" stroke-width="2" stroke-linecap="round"/>` +
      `<polygon points="${dx.toFixed(1)},${dy.toFixed(1)} ` +
      `${(dx - 5 * Math.cos(rad) - 3 * Math.sin(rad)).toFixed(1)},${(dy + 5 * Math.sin(rad) - 3 * Math.cos(rad)).toFixed(1)} ` +
      `${(dx - 5 * Math.cos(rad) + 3 * Math.sin(rad)).toFixed(1)},${(dy + 5 * Math.sin(rad) + 3 * Math.cos(rad)).toFixed(1)}" ` +
      `fill="#74c7ec"/>` +
      `</svg>`;
    L.marker([lat, lon], {
      icon: L.divIcon({
        html: `<div style="opacity:0.85;pointer-events:none">${svg}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        className: '',
      }),
      pane: 'currentOverlayPane',
    }).addTo(currentOverlayLayer);
  }
  currentOverlayLayer.addTo(map);
}

// Renders the GRIB coverage bar scaled to [rangeStart, rangeEnd] (BUG-132).
// When the scrubber is locked to a calculated route, the bar is coloured by which GRIB
// file supplied each waypoint (REQ-129) instead of plain temporal overlap.
function renderCoverageBar(rangeStart, rangeEnd) {
  const bar = document.getElementById('scrubber-coverage-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const span = Math.max(1, rangeEnd - rangeStart);
  const addRow = (color, si, ei) => {
    // Clamp to visible range — partial overlap shows the covered portion
    si = Math.max(si, rangeStart);
    ei = Math.min(ei, rangeEnd);
    if (si > ei) return;
    const p1 = (((si - rangeStart) / span) * 100).toFixed(2);
    const p2 = (((ei - rangeStart) / span) * 100).toFixed(2);
    const row = document.createElement('div');
    row.style.cssText = `height:4px;border-radius:2px;background:linear-gradient(to right,#313244 0% ${p1}%,${color} ${p1}% ${p2}%,#313244 ${p2}% 100%)`;
    bar.appendChild(row);
  };

  // REQ-129: route-locked view colours the bar by the GRIB supplying each leg.
  if (scrubberLockedToRoute && graphMeta && graphMeta.some((m) => m.gribFile != null)) {
    const stops = [];
    for (let i = 0; i < graphMeta.length; i++) {
      const tMs = new Date(graphMeta[i].time).getTime();
      let si = windTimes.findIndex((t) => new Date(t).getTime() >= tMs);
      if (si < 0) si = rangeEnd;
      const nextMs =
        i < graphMeta.length - 1
          ? new Date(graphMeta[i + 1].time).getTime()
          : windTimes[rangeEnd]
            ? new Date(windTimes[rangeEnd]).getTime()
            : tMs;
      let ei = windTimes.findIndex((t) => new Date(t).getTime() >= nextMs);
      if (ei < 0) ei = rangeEnd;
      ei = Math.max(si, ei - 1);
      const fp = graphMeta[i].gribFile;
      const colorIdx = fp != null ? gribInfoFiles.findIndex((f) => f.path === fp) : -1;
      const color = colorIdx >= 0 ? C64_PALETTE[colorIdx % C64_PALETTE.length] : '#45475a';
      const a = (((Math.max(rangeStart, Math.min(rangeEnd, si)) - rangeStart) / span) * 100).toFixed(2);
      const b = (((Math.max(rangeStart, Math.min(rangeEnd, ei)) - rangeStart) / span) * 100).toFixed(2);
      stops.push(`${color} ${a}% ${b}%`);
    }
    if (stops.length > 0) {
      const row = document.createElement('div');
      row.style.cssText = `height:4px;border-radius:2px;background:linear-gradient(to right,${stops.join(',')})`;
      bar.appendChild(row);
    }
  } else {
    gribInfoFiles.forEach((f, i) => {
      if (f.type === 'current' || !enabledGribPaths.has(f.path)) return;
      const startMs = new Date(f.timeStart).getTime();
      const endMs = new Date(f.timeEnd).getTime();
      const si = windTimes.findIndex((t) => new Date(t).getTime() >= startMs);
      const ei = windTimes.findLastIndex((t) => new Date(t).getTime() <= endMs);
      addRow(C64_PALETTE[i % C64_PALETTE.length], si, ei);
    });
  }
  if (currentEnabled && currentFileTimes.length > 0) {
    const currentSet = new Set(currentFileTimes);
    const si = windTimes.findIndex((t) => currentSet.has(t));
    const ei = windTimes.findLastIndex((t) => currentSet.has(t));
    addRow('#89dceb', si, ei);
  }
}

// Positions the yellow now-triangle relative to [rangeStart, rangeEnd] (BUG-132).
function updateNowMarker(rangeStart, rangeEnd) {
  const nowMs = Date.now();
  const nowIdx = windTimes.findIndex((t) => new Date(t).getTime() >= nowMs);
  const nowMarker = document.getElementById('scrubber-now-marker');
  if (!nowMarker) return;
  if (nowIdx >= rangeStart && nowIdx <= rangeEnd && rangeEnd > rangeStart) {
    const pct = (((nowIdx - rangeStart) / (rangeEnd - rangeStart)) * 100).toFixed(2);
    nowMarker.style.left = `${pct}%`;
    nowMarker.style.display = 'block';
  } else {
    nowMarker.style.display = 'none';
  }
}

// Toggles scrubber between route-restricted and full GRIB range (BUG-132).
function toggleScrubberRange() {
  if (!routeScrubberRange) return;
  const scrubber = document.getElementById('time-scrubber');
  const toggleBtn = document.getElementById('scrubber-range-toggle');
  if (scrubberLockedToRoute) {
    // Switch to full range
    scrubber.min = 0;
    scrubber.max = windTimes.length - 1;
    renderCoverageBar(0, windTimes.length - 1);
    updateNowMarker(0, windTimes.length - 1);
    toggleBtn.textContent = 'Route range';
    scrubberLockedToRoute = false;
  } else {
    // Switch to route range
    scrubber.min = routeScrubberRange.i0;
    scrubber.max = routeScrubberRange.iN;
    renderCoverageBar(routeScrubberRange.i0, routeScrubberRange.iN);
    updateNowMarker(routeScrubberRange.i0, routeScrubberRange.iN);
    toggleBtn.textContent = 'Full range';
    scrubberLockedToRoute = true;
  }
  updateScrubberLabel(parseInt(scrubber.value) || 0);
  const idx = parseInt(scrubber.value) || 0;
  fetchWindPoints(idx);
  fetchWavePoints(idx);
}

function rebuildScrubberTimes() {
  const windSet = new Set();
  const enabled = enabledWindMeta();

  if (enabled.length > 0) {
    // Server mode: filter by enabled GRIB files
    for (const f of enabled) {
      if (!f.timeStart || !f.nTimes) continue;
      const startMs = new Date(f.timeStart).getTime();
      const endMs = new Date(f.timeEnd).getTime();
      if (gribTimesMap.has(f.path)) {
        for (const t of gribTimesMap.get(f.path)) {
          const ms = new Date(t).getTime();
          if (ms >= startMs && ms <= endMs) windSet.add(t);
        }
      } else if (actualWindTimes) {
        for (const t of actualWindTimes) {
          const ms = new Date(t).getTime();
          if (ms >= startMs && ms <= endMs) windSet.add(t);
        }
      } else {
        const step = f.nTimes > 1 ? (endMs - startMs) / (f.nTimes - 1) : 0;
        for (let k = 0; k < f.nTimes; k++) {
          windSet.add(new Date(Math.round(startMs + k * step)).toISOString());
        }
      }
    }
  } else if (actualWindTimes) {
    // Windy mode: no GRIB files — use actualWindTimes directly from minifest
    for (const t of actualWindTimes) windSet.add(t);
  }
  const windArr = Array.from(windSet).sort();
  windTimesCount = windArr.length;
  windNativeTimes = windArr;

  let unified = [...windArr];
  if (currentEnabled && currentFileTimes.length > 0) {
    const s = new Set(windArr);
    for (const t of currentFileTimes) {
      if (!s.has(t)) unified.push(t);
    }
    unified.sort();
  }
  windTimes = unified;

  renderCoverageBar(0, unified.length - 1);
  updateNowMarker(0, unified.length - 1);

  const scrubber = document.getElementById('time-scrubber');
  const prevVal = Math.min(parseInt(scrubber.value) || 0, Math.max(0, unified.length - 1));
  if (unified.length === 0) {
    document.getElementById('time-scrubber-panel').style.display = 'none';
    windTimesLoaded = false;
    return;
  }
  scrubber.min = 0;
  scrubber.max = unified.length - 1;
  scrubber.value = prevVal;
  document.getElementById('time-scrubber-panel').style.display = 'flex';
  windTimesLoaded = true;
  updateScrubberLabel(prevVal);
}

async function initWindScrubber() {
  const statusEl = document.getElementById('status-box');
  statusEl.className = 'loading';
  statusEl.innerHTML = 'Loading forecast data<span class="wr-spinner"></span>';

  try {
    const { windTimes: wt, currentTimes: ct } = await dataLayer.loadTimesFromWindy();
    actualWindTimes = wt;
    currentFileTimes = ct;
    // Treat all wind times as a single "file" for the scrubber
    gribTimesMap = new Map([['windy', wt]]);
  } catch (e) {
    statusEl.className = 'error';
    statusEl.textContent = 'Failed to load forecast: ' + (e.message || e);
    return;
  }

  rebuildScrubberTimes();

  if (windTimesCount > 0) {
    await fetchWindPoints(0);
    await fetchWavePoints(0);
  }

  statusEl.className = 'done';
  statusEl.textContent = 'Ready';
}

async function fetchAndDrawRoute() {
  try {
    const r = await apiFetch(`${API}/pending-route`);
    if (!r.ok) {
      setStatus('error', `Could not fetch route (HTTP ${r.status})`);
      return;
    }
    const route = await r.json();
    const coords = route.feature?.geometry?.coordinates;
    if (!coords) {
      setStatus('error', 'Route has no coordinates');
      return;
    }

    if (routeLayer) map.removeLayer(routeLayer);
    if (windBarbLayer) map.removeLayer(windBarbLayer);
    if (legLabelLayer) map.removeLayer(legLabelLayer);
    if (highlightLegLayer) {
      map.removeLayer(highlightLegLayer);
      highlightLegLayer = null;
    }
    windBarbMarkers = [];
    routeLegCoords = [];
    prevHighlightWpIdx = -1;

    routeLayer = L.polyline(
      coords.map(([lng, lat]) => [lat, lng]),
      {
        color: '#89b4fa',
        weight: 3,
        opacity: 0.9,
      },
    ).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [20, 20] });

    const meta = route.feature?.properties?.coordinatesMeta ?? [];
    const showLabels = document.getElementById('waypoint-labels-toggle').checked;
    const intervalH = parseFloat(document.getElementById('waypoint-label-interval').value) || 0;
    const intervalMs = intervalH * 3600000;
    let lastLabeledMs = -Infinity;
    windBarbLayer = L.layerGroup();
    coords.forEach(([lng, lat], i) => {
      const m = meta[i];
      if (!m) {
        windBarbMarkers.push(null);
        return;
      }
      const waypointMs = new Date(m.time).getTime();
      const isFirstOrLast = i === 0 || i === coords.length - 1;
      const showLabel =
        showLabels && (intervalH === 0 || isFirstOrLast || waypointMs - lastLabeledMs >= intervalMs);
      if (showLabel) lastLabeledMs = waypointMs;
      const eta = new Date(m.time).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const html =
        `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none">` +
        windBarbSvg(m.tws ?? 0, m.windDir ?? 0) +
        (showLabel
          ? `<div style="color:#cdd6f4;background:#313244cc;font-size:10px;padding:1px 4px;border-radius:3px;white-space:nowrap">${eta}</div>`
          : '') +
        `</div>`;
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({ html, iconSize: [30, 54], iconAnchor: [15, 33], className: '' }),
        pane: 'windBarbPane',
      })
        .bindTooltip(
          (() => {
            const tw = _fmt(m.tws ?? 0, 'speed', windSpeedMs);
            const bs = _fmt(m.boatSpeed ?? 0, 'speed');
            return `${tw.num} ${tw.sym}, ${m.windDir ?? 0}° — boat ${bs.num} ${bs.sym}<br><span style="font-size:10px;color:#a6adc8">${lat.toFixed(4)}°N ${lng.toFixed(4)}°E</span>`;
          })(),
          { direction: 'top', offset: [0, -10] },
        )
        .addTo(windBarbLayer);
      windBarbMarkers.push(marker);
    });
    windBarbLayer.addTo(map);

    legLabelLayer = L.layerGroup();
    for (let i = 0; i < coords.length - 1; i++) {
      const m1 = meta[i],
        m2 = meta[i + 1];
      if (!m1 || !m2) continue;
      const midLat = (coords[i][1] + coords[i + 1][1]) / 2;
      const midLng = (coords[i][0] + coords[i + 1][0]) / 2;
      routeLegCoords.push([
        [coords[i][1], coords[i][0]],
        [coords[i + 1][1], coords[i + 1][0]],
      ]);
      const avgTws = ((m1.tws ?? 0) + (m2.tws ?? 0)) / 2;
      const avgBoatSpeed = ((m1.boatSpeed ?? 0) + (m2.boatSpeed ?? 0)) / 2;
      // Circular mean for wind direction (handles 359°/1° wrap)
      const a1 = ((m1.windDir ?? 0) * Math.PI) / 180;
      const a2 = ((m2.windDir ?? 0) * Math.PI) / 180;
      const avgDir =
        (Math.atan2((Math.sin(a1) + Math.sin(a2)) / 2, (Math.cos(a1) + Math.cos(a2)) / 2) * 180) / Math.PI;
      const html =
        `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">` +
        windBarbSvg(avgTws, (avgDir + 360) % 360) +
        `</div>`;
      L.marker([midLat, midLng], {
        icon: L.divIcon({ html, iconSize: [30, 48], iconAnchor: [15, 28], className: '' }),
        pane: 'windBarbPane',
      })
        .bindTooltip(
          (() => {
            const tw = _fmt(avgTws, 'speed', windSpeedMs);
            const bs = _fmt(avgBoatSpeed, 'speed');
            return `${tw.num} ${tw.sym}, ${Math.round((avgDir + 360) % 360)}° — boat ${bs.num} ${bs.sym}<br><span style="font-size:10px;color:#a6adc8">${midLat.toFixed(4)}°N ${midLng.toFixed(4)}°E</span>`;
          })(),
          { direction: 'top', offset: [0, -10] },
        )
        .addTo(legLabelLayer);
    }
    legLabelLayer.addTo(map);

    const intermediateIdxs = routeWaypoints
      .map((wp) => {
        let best = -1,
          bestDist = Infinity;
        coords.forEach(([lng, lat], i) => {
          const d = Math.hypot(lat - wp.lat, lng - wp.lon);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        return best;
      })
      .filter((i) => i > 0 && i < coords.length - 1);
    drawConditionsGraph(meta, intermediateIdxs);

    if (windTimesLoaded && meta.length > 0) {
      const t0ms = new Date(meta[0].time).getTime();
      const tNms = new Date(meta[meta.length - 1].time).getTime();
      let i0 = windTimes.findIndex((t) => new Date(t).getTime() >= t0ms);
      let iN = windTimes.findIndex((t) => new Date(t).getTime() >= tNms);
      if (i0 < 0) i0 = 0;
      if (iN < 0) iN = windTimes.length - 1;
      const scrubber = document.getElementById('time-scrubber');
      scrubber.min = i0;
      scrubber.max = iN;
      scrubber.value = i0;
      renderCoverageBar(i0, iN);
      updateNowMarker(i0, iN);
      routeScrubberRange = { i0, iN };
      scrubberLockedToRoute = true;
      const toggleBtn = document.getElementById('scrubber-range-toggle');
      toggleBtn.textContent = 'Full range';
      toggleBtn.style.display = '';
      fetchWindPoints(i0);
      fetchWavePoints(i0);
    }
  } catch (e) {
    setStatus('error', `Draw failed: ${e}`);
  }
}

// --- Conditions graph ---

let scrubberExpanded = true;
let conditionsExpanded = true;
let conditionsFullscreen = false;

function enterConditionsFullscreen() {
  conditionsFullscreen = true;
  const panel = document.getElementById('conditions-panel');
  panel.classList.add('conditions-fullscreen');
  panel.style.height = '';
}

function exitConditionsFullscreen() {
  conditionsFullscreen = false;
  const panel = document.getElementById('conditions-panel');
  panel.classList.remove('conditions-fullscreen');
  panel.style.height = conditionsExpanded ? `${conditionsGraphHeight}px` : '24px';
}

document.getElementById('conditions-handle').addEventListener('click', () => {
  if (conditionsFullscreen) {
    exitConditionsFullscreen();
    return;
  }
  conditionsExpanded = !conditionsExpanded;
  document.getElementById('conditions-svg').style.display = conditionsExpanded ? '' : 'none';
  document.getElementById('conditions-toggle').textContent = conditionsExpanded ? '▼' : '▶';
  document.getElementById('conditions-panel').style.height = conditionsExpanded
    ? `${conditionsGraphHeight}px`
    : '24px';
});

document.getElementById('scrubber-handle').addEventListener('click', () => {
  scrubberExpanded = !scrubberExpanded;
  document.getElementById('scrubber-body').style.display = scrubberExpanded ? '' : 'none';
  document.getElementById('scrubber-toggle').textContent = scrubberExpanded ? '▼' : '▶';
  document.getElementById('scrubber-handle').title = scrubberExpanded ? 'Collapse panel' : 'Expand panel';
  document.getElementById('time-scrubber-panel').style.height = scrubberExpanded ? '' : '28px';
});

document.getElementById('conditions-svg').addEventListener('click', () => {
  if (conditionsFullscreen) exitConditionsFullscreen();
  else enterConditionsFullscreen();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && conditionsFullscreen) exitConditionsFullscreen();
});

function drawConditionsGraph(meta, intermediateIdxs = []) {
  const panel = document.getElementById('conditions-panel');
  if (!meta || meta.length < 2) {
    panel.style.display = 'none';
    return;
  }

  const hasWave = meta.some((m) => m.waveHeight != null);

  const VW = 820,
    VH = 200;
  const ml = windSpeedMs ? 30 : 0,
    mr = 20,
    mt = 14,
    mb = 66;
  const pr = 800; // right axis line x-coordinate
  const pw = VW - ml - mr,
    ph = VH - mt - mb;

  graphMeta = meta;

  // Scale: compute display-unit values for both axes
  const twsDisplayVals = meta.map((m) => _toDisplay(m.tws ?? 0, 'speed', windSpeedMs));
  const boatDisplayVals = meta.map((m) => (m.boatSpeed != null ? _toDisplay(m.boatSpeed, 'speed') : null));
  const twsStep5 = windSpeedMs ? 2 : 5; // m/s steps of 2; kn steps of 5
  const maxTwsDisp = Math.ceil(Math.max(...twsDisplayVals) / twsStep5) * twsStep5 || twsStep5;
  const maxBoatDisp = Math.ceil(Math.max(...boatDisplayVals) / 5) * 5 || 5;
  // Single-axis mode: shared left scale; dual-axis mode: separate scales
  const maxLeft = windSpeedMs ? maxBoatDisp : Math.max(maxTwsDisp, maxBoatDisp);
  const rawMaxWave = hasWave ? Math.max(...meta.map((m) => m.waveHeight ?? 0)) : 0;
  const maxWave = hasWave ? Math.max(1, Math.ceil(rawMaxWave * 2) / 2) : 0;

  const hasGrib = meta.some((m) => m.gribFile != null);
  graphLayout = { VW, ml, pw, mt, ph, hasWave, hasGrib, maxLeft, maxBoatSpeed: maxBoatDisp, maxWave };

  const xOf = (i) => (ml + (i / (meta.length - 1)) * pw).toFixed(1);
  const yLeft = (v) => (mt + ph * (1 - v / maxLeft)).toFixed(1);
  const yWind = windSpeedMs ? (v) => (mt + ph * (1 - v / maxTwsDisp)).toFixed(1) : yLeft;
  const yWave = (v) => (mt + ph * (1 - v / maxWave)).toFixed(1);

  const el = [];

  el.push(`<defs><marker id="wdarrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
  <polygon points="0,0 5,2.5 0,5" fill="#a6adc8"/>
</marker>
<pattern id="gmSkillPat" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
  <rect width="6" height="6" fill="rgba(245,194,231,0.10)"/>
  <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(245,194,231,0.35)" stroke-width="1"/>
</pattern></defs>`);
  el.push(`<rect x="0" y="0" width="${VW}" height="${VH}" fill="#1e2230"/>`);

  // REQ-132: low-confidence band over waypoints forecast beyond the skill horizon from
  // the freshest supplying model run (referenceTime). Shows where the route leaves
  // reliable forecast skill — distinct from staleness and granularity.
  if (hasGrib) {
    const refMs = Math.max(
      ...meta.map((m) => {
        const f = m.gribFile ? gribInfoFiles.find((g) => g.path === m.gribFile) : null;
        return f ? new Date(f.referenceTime).getTime() : -Infinity;
      }),
    );
    if (isFinite(refMs)) {
      const cutoff = refMs + forecastSkillHorizonHours * 3600000;
      const firstOver = meta.findIndex((m) => new Date(m.time).getTime() > cutoff);
      if (firstOver >= 0) {
        const x0 = parseFloat(xOf(firstOver));
        el.push(
          `<rect x="${x0.toFixed(1)}" y="${mt}" width="${(VW - mr - x0).toFixed(1)}" height="${ph}" fill="url(#gmSkillPat)"/>`,
        );
        el.push(
          `<text x="${((x0 + VW - mr) / 2).toFixed(1)}" y="${mt + 10}" text-anchor="middle" fill="#f5c2e7" font-size="8">low forecast confidence</text>`,
        );
      }
    }
  }

  // Left y-axis — single axis (normal) or dual axes (windSpeedMs)
  const twsAxisStep = windSpeedMs ? twsStep5 : maxLeft <= 15 ? 5 : 10;
  document.getElementById('conditions-y-left').innerHTML = '';
  if (windSpeedMs) {
    // Outer left axis: TWS in m/s (blue, at x=2)
    el.push(`<text x="2" y="${mt - 8}" fill="#89b4fa" font-size="9">m/s</text>`);
    for (let v = 0; v <= maxTwsDisp; v += twsAxisStep) {
      const y = parseFloat(yWind(v));
      el.push(
        `<line x1="0" y1="${y.toFixed(1)}" x2="${VW}" y2="${y.toFixed(1)}" stroke="#313244" stroke-width="0.5"/>`,
      );
      el.push(`<text x="2" y="${y.toFixed(1)}" fill="#89b4fa" font-size="10">${v}</text>`);
    }
    // Inner left axis: boat speed in preset unit (orange), right-aligned to margin boundary
    const boatSym = _fmt(0, 'speed').sym;
    const boatStep = maxBoatDisp <= 15 ? 5 : 10;
    el.push(`<text x="${ml - 2}" y="${mt - 8}" text-anchor="end" fill="#fab387" font-size="9">${boatSym}</text>`);
    for (let v = 0; v <= maxBoatDisp; v += boatStep) {
      const y = parseFloat(yLeft(v));
      el.push(
        `<text x="${ml - 2}" y="${y.toFixed(1)}" text-anchor="end" fill="#fab387" font-size="10">${v}</text>`,
      );
    }
  } else {
    // Single shared left axis
    const speedSym = _fmt(0, 'speed').sym;
    el.push(`<text x="2" y="${mt - 8}" fill="#89b4fa" font-size="9">${speedSym}</text>`);
    for (let v = 0; v <= maxLeft; v += twsAxisStep) {
      const y = parseFloat(yLeft(v));
      el.push(
        `<line x1="0" y1="${y.toFixed(1)}" x2="${VW}" y2="${y.toFixed(1)}" stroke="#313244" stroke-width="0.5"/>`,
      );
      el.push(`<text x="2" y="${y.toFixed(1)}" fill="#89b4fa" font-size="10">${v}</text>`);
    }
  }

  // Right y-axis (wave height) — labels as SVG text in viewBox coordinates
  const rightSpacer = document.getElementById('time-scrubber-right-spacer');
  document.getElementById('conditions-y-right').innerHTML = '';
  if (hasWave) {
    document.getElementById('conditions-y-right').style.display = 'block';
    rightSpacer.style.display = 'block';
    const waveSym = _fmt(0, 'depth').sym;
    el.push(
      `<text x="${pr + 2}" y="${mt - 8}" text-anchor="start" fill="#a6e3a1" font-size="9">${waveSym}</text>`,
    );
    const wStep = maxWave <= 3 ? 0.5 : 1;
    for (let v = 0; v <= maxWave + 0.001; v += wStep) {
      const y = parseFloat(yWave(v));
      const dispWave = _fmt(v, 'depth');
      el.push(
        `<text x="${pr + 2}" y="${y.toFixed(1)}" text-anchor="start" fill="#a6e3a1" font-size="10">${dispWave.num}</text>`,
      );
    }
    el.push(`<line x1="${pr}" y1="${mt}" x2="${pr}" y2="${mt + ph}" stroke="#45475a" stroke-width="1"/>`);
  } else {
    document.getElementById('conditions-y-right').style.display = 'none';
    rightSpacer.style.display = 'none';
  }

  // Axis lines
  el.push(`<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#45475a" stroke-width="1"/>`);
  el.push(`<line x1="${ml}" y1="${mt + ph}" x2="${pr}" y2="${mt + ph}" stroke="#45475a" stroke-width="1"/>`);

  // Wind speed line — plotted against yWind (m/s axis when windSpeedMs, else shared)
  el.push(
    `<path d="${meta.map((m, i) => (i === 0 ? 'M' : 'L') + xOf(i) + ',' + yWind(twsDisplayVals[i])).join(' ')}" fill="none" stroke="#89b4fa" stroke-width="1" stroke-linejoin="round"/>`,
  );

  // Boat speed line — separate path per contiguous block of valid data (skips null at seed point)
  {
    let segStart = -1;
    for (let i = 0; i <= meta.length; i++) {
      const hasData = i < meta.length && boatDisplayVals[i] != null;
      if (hasData && segStart === -1) {
        segStart = i;
      } else if (!hasData && segStart !== -1) {
        if (i - segStart >= 2) {
          const pts = [];
          for (let j = segStart; j < i; j++) {
            pts.push((j === segStart ? 'M' : 'L') + xOf(j) + ',' + yLeft(boatDisplayVals[j]));
          }
          el.push(
            `<path d="${pts.join(' ')}" fill="none" stroke="#fab387" stroke-width="1" stroke-linejoin="round"/>`,
          );
        }
        segStart = -1;
      }
    }
  }

  // Wave height line — separate path per contiguous block of valid data
  if (hasWave) {
    let segStart = -1;
    for (let i = 0; i <= meta.length; i++) {
      const hasData = i < meta.length && meta[i].waveHeight != null;
      if (hasData && segStart === -1) {
        segStart = i;
      } else if (!hasData && segStart !== -1) {
        if (i - segStart >= 2) {
          const pts = [];
          for (let j = segStart; j < i; j++) {
            pts.push((j === segStart ? 'M' : 'L') + xOf(j) + ',' + yWave(meta[j].waveHeight));
          }
          el.push(
            `<path d="${pts.join(' ')}" fill="none" stroke="#a6e3a1" stroke-width="1" stroke-linejoin="round"/>`,
          );
        }
        segStart = -1;
      }
    }
  }

  // Per-waypoint: dots, labels, direction arrows
  const labelEvery = Math.max(1, Math.ceil(meta.length / 8));
  const arrowY = mt + ph + 32;

  for (let i = 0; i < meta.length; i++) {
    const m = meta[i];
    const x = parseFloat(xOf(i));
    const d = new Date(m.time);

    el.push(`<circle cx="${x}" cy="${yWind(twsDisplayVals[i])}" r="1.5" fill="#89b4fa"/>`);
    if (boatDisplayVals[i] != null)
      el.push(`<circle cx="${x}" cy="${yLeft(boatDisplayVals[i])}" r="1.5" fill="#fab387"/>`);
    if (hasWave && m.waveHeight != null) {
      el.push(`<circle cx="${x}" cy="${yWave(m.waveHeight)}" r="1.5" fill="#a6e3a1"/>`);
    }

    // X-axis time label
    if (i === 0 || i === meta.length - 1 || i % labelEvery === 0) {
      const label =
        d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const ly = mt + ph + 12;
      el.push(
        `<text x="${x}" y="${ly}" text-anchor="middle" fill="#6c7086" font-size="9" transform="rotate(-30,${x},${ly})">${label}</text>`,
      );
    }

    // Wind direction arrow — points toward where wind blows (windDir is FROM direction)
    const windDeg = ((m.windDir ?? 0) + 180) % 360;
    const rad = (windDeg * Math.PI) / 180;
    const len = 9;
    const dx = Math.sin(rad) * len,
      dy = -Math.cos(rad) * len;
    el.push(
      `<line x1="${(x - dx / 2).toFixed(1)}" y1="${(arrowY - dy / 2).toFixed(1)}" x2="${(x + dx / 2).toFixed(1)}" y2="${(arrowY + dy / 2).toFixed(1)}" stroke="#a6adc8" stroke-width="1" marker-end="url(#wdarrow)"/>`,
    );
  }

  // Legend — starts at ml so it occupies the data area, not the axis margin
  const lx = ml;
  el.push(`<rect x="${lx}" y="3" width="10" height="10" fill="#89b4fa" rx="1"/>`);
  el.push(`<text x="${lx + 13}" y="12" fill="#89b4fa" font-size="10">Wind speed</text>`);
  el.push(`<rect x="${lx + 90}" y="3" width="10" height="10" fill="#fab387" rx="1"/>`);
  el.push(`<text x="${lx + 103}" y="12" fill="#fab387" font-size="10">Boat speed</text>`);
  if (hasWave) {
    el.push(`<rect x="${lx + 185}" y="3" width="10" height="10" fill="#a6e3a1" rx="1"/>`);
    el.push(`<text x="${lx + 198}" y="12" fill="#a6e3a1" font-size="10">Wave height</text>`);
  }

  // GRIB source stripe — colored segments below wind arrows, one per waypoint
  if (hasGrib) {
    const stripeTop = mt + ph + 40;
    const stripeH = 8;
    for (let i = 0; i < meta.length; i++) {
      const x1 = parseFloat(xOf(i));
      const x2 = i < meta.length - 1 ? parseFloat(xOf(i + 1)) : VW;
      const filePath = meta[i].gribFile;
      const colorIdx = filePath != null ? gribInfoFiles.findIndex((f) => f.path === filePath) : -1;
      const color = colorIdx >= 0 ? C64_PALETTE[colorIdx % C64_PALETTE.length] : '#45475a';
      el.push(
        `<rect x="${x1.toFixed(1)}" y="${stripeTop}" width="${(x2 - x1).toFixed(1)}" height="${stripeH}" fill="${color}" opacity="0.7"/>`,
      );
    }
    el.push(`<text x="${ml + 2}" y="${stripeTop + stripeH + 10}" fill="#6c7086" font-size="8">GRIB</text>`);
  }

  // Intermediate waypoint markers (REQ-97): vertical dashed lines at each REQ-92 junction
  for (let k = 0; k < intermediateIdxs.length; k++) {
    const x = parseFloat(xOf(intermediateIdxs[k]));
    el.push(
      `<line x1="${x}" y1="${mt}" x2="${x}" y2="${mt + ph}" stroke="#f5c2e7" stroke-width="1" stroke-dasharray="4,3" opacity="0.75"/>`,
    );
    el.push(`<text x="${x}" y="${mt - 3}" text-anchor="middle" font-size="8" fill="#f5c2e7">WP${k + 1}</text>`);
  }

  const svgEl = document.getElementById('conditions-svg');
  svgEl.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svgEl.innerHTML = el.join('\n');

  if (!conditionsFullscreen) panel.style.height = conditionsExpanded ? `${conditionsGraphHeight}px` : '24px';
  panel.style.display = 'flex';
}

function findScrubberPosition(tMs) {
  if (!graphMeta || graphMeta.length < 2) return { wpIdx: -1, legIdx: -1 };
  let wpIdx = 0,
    minDiff = Infinity;
  graphMeta.forEach((m, i) => {
    const d = Math.abs(new Date(m.time).getTime() - tMs);
    if (d < minDiff) {
      minDiff = d;
      wpIdx = i;
    }
  });
  let legIdx = 0;
  for (let i = 0; i < graphMeta.length - 1; i++) {
    if (tMs <= new Date(graphMeta[i + 1].time).getTime()) {
      legIdx = i;
      break;
    }
    legIdx = i;
  }
  return { wpIdx, legIdx };
}

function updateScrubberHighlight(windTimeIdx) {
  if (prevHighlightWpIdx >= 0 && windBarbMarkers[prevHighlightWpIdx]?._icon)
    windBarbMarkers[prevHighlightWpIdx]._icon.classList.remove('wp-highlight');
  if (highlightLegLayer) {
    map.removeLayer(highlightLegLayer);
    highlightLegLayer = null;
  }

  if (!graphMeta || windBarbMarkers.length === 0) return;

  const tMs = new Date(windTimes[windTimeIdx]).getTime();
  const { wpIdx, legIdx } = findScrubberPosition(tMs);

  if (wpIdx >= 0 && windBarbMarkers[wpIdx]?._icon) {
    windBarbMarkers[wpIdx]._icon.classList.add('wp-highlight');
    prevHighlightWpIdx = wpIdx;
  }
  if (legIdx >= 0 && routeLegCoords[legIdx]) {
    highlightLegLayer = L.polyline(routeLegCoords[legIdx], {
      color: '#f5c2e7',
      weight: 5,
      opacity: 0.85,
    }).addTo(map);
  }
}

function activatePlacing(which) {
  placing = which;
  btnStart.classList.toggle('active', which === 'start');
  btnEnd.classList.toggle('active', which === 'end');
  map.getContainer().style.cursor = 'crosshair';
}

function updateCalcButton() {
  calcBtn.disabled = !(startLatLon && endLatLon && gribLoaded && gribWarningAcked);
}

function setTestRoute(s, e, departureValue) {
  startLatLon = s;
  endLatLon = e;
  startCoords.textContent = `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
  endCoords.textContent = `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`;
  startMarker.setLatLng([s.lat, s.lon]).addTo(map);
  endMarker.setLatLng([e.lat, e.lon]).addTo(map);
  document.getElementById('departure-time').value = departureValue;
  clearRouteWaypoints();
  updateCalcButton();
  startCalculation();
}

const OREGRUND = { lat: 60.3996, lon: 18.3403 };

function runTest() {
  setTestRoute(OREGRUND, { lat: 58.5052, lon: 17.3474 }, '2026-05-24T08:00');
}

function runHelsinkiTest() {
  setTestRoute(OREGRUND, { lat: 60.0881, lon: 24.953 }, '2026-06-06T02:00');
}

function runGothenburgTest() {
  setTestRoute(OREGRUND, { lat: 57.6138, lon: 11.598 }, '2026-06-06T02:00');
}

function setStatus(type, msg) {
  statusBox.className = type === 'error' || type === 'done' ? type : '';
  statusBox.textContent = msg;
}

function showFailurePopup(msg, isWarning) {
  const popup = document.getElementById('failure-popup');
  popup.className = isWarning ? 'warning' : 'error';
  document.getElementById('failure-popup-msg').textContent = msg;
  popup.style.display = 'flex';
}

function hideFailurePopup() {
  document.getElementById('failure-popup').style.display = 'none';
}

document.getElementById('failure-popup-close').addEventListener('click', hideFailurePopup);

function toLocalDateTimeInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function greenIcon() {
  return L.divIcon({
    html: '<div style="background:#a6e3a1;width:12px;height:12px;border-radius:50%;border:2px solid #1e2230"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}
function redIcon() {
  return L.divIcon({
    html: '<div style="background:#f38ba8;width:12px;height:12px;border-radius:50%;border:2px solid #1e2230"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

async function renderLandOverlay() {
  if (!gribLoaded) return;
  const token = ++renderLandOverlayToken;

  if (landLayerOrig) {
    map.removeLayer(landLayerOrig);
    landLayerOrig = null;
  }
  if (landLayerDilated) {
    map.removeLayer(landLayerDilated);
    landLayerDilated = null;
  }

  if (!document.getElementById('land-toggle').checked) return;

  const b = map.getBounds();
  const bboxQuery = `latMin=${b.getSouth()}&lonMin=${b.getWest()}&latMax=${b.getNorth()}&lonMax=${b.getEast()}`;
  const safetyOn = dilatedIndexReady && document.getElementById('safety-margin-toggle').checked;

  const r = await apiFetch(`${API}/land-polygons?${bboxQuery}`);
  if (!r.ok) return;
  if (token !== renderLandOverlayToken || !document.getElementById('land-toggle').checked) return;
  const data = await r.json();
  if (token !== renderLandOverlayToken || !document.getElementById('land-toggle').checked) return;

  landLayerOrig = L.geoJSON(data, {
    style: { color: '#6c7086', weight: 0.5, fillColor: '#45475a', fillOpacity: 0.6, pane: 'landPane' },
    renderer: L.canvas({ pane: 'landPane' }),
  }).addTo(map);

  if (safetyOn) {
    const r2 = await apiFetch(`${API}/land-polygons?dilated=true&${bboxQuery}`);
    if (!r2.ok) return;
    if (token !== renderLandOverlayToken || !document.getElementById('land-toggle').checked) return;
    const data2 = await r2.json();
    if (token !== renderLandOverlayToken || !document.getElementById('land-toggle').checked) return;

    landLayerDilated = L.geoJSON(data2, {
      style: { color: '#9399b2', weight: 0.5, fillColor: '#585b70', fillOpacity: 0.4, pane: 'landDilatedPane' },
      renderer: L.canvas({ pane: 'landDilatedPane' }),
    }).addTo(map);
  }
}

document.getElementById('land-toggle').addEventListener('change', async (e) => {
  if (e.target.checked) {
    await renderLandOverlay();
  } else {
    renderLandOverlayToken++;
    if (landLayerOrig) {
      map.removeLayer(landLayerOrig);
      landLayerOrig = null;
    }
    if (landLayerDilated) {
      map.removeLayer(landLayerDilated);
      landLayerDilated = null;
    }
  }
});

map.on('moveend', () => {
  if (document.getElementById('land-toggle').checked) renderLandOverlay();
});

map.on('zoomend moveend', () => {
  if (allWindPoints.length > 0 && document.getElementById('wind-overlay-toggle').checked) renderWindOverlay();
  if (allWavePoints.length > 0 && document.getElementById('wave-overlay-toggle').checked) renderWaveOverlay();
  if (allCurrentPoints.length > 0 && document.getElementById('current-overlay-toggle').checked)
    renderCurrentOverlay();
});

map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  const lines = [];

  // Wind section — shown when wind overlay is active
  if (allWindPoints.length > 0 && document.getElementById('wind-overlay-toggle').checked) {
    const wp = allWindPoints.find((p) => Math.abs(p.lat - lat) < 0.04 && Math.abs(p.lon - lng) < 0.04);
    if (wp) {
      const twsKn = Math.sqrt(wp.u * wp.u + wp.v * wp.v) * 1.94384;
      const twsFmt = _fmt(twsKn, 'speed', windSpeedMs);
      const dir = Math.round(((Math.atan2(-wp.u, -wp.v) * 180) / Math.PI + 360) % 360);
      lines.push(
        `Wind: ${twsFmt.num} ${twsFmt.sym} from ${dir}°T<br><span style="font-size:10px;color:#a6adc8">${wp.lat.toFixed(4)}°N ${wp.lon.toFixed(4)}°E</span>`,
      );
    }
  }

  // Wave section — shown when wave overlay is active
  if (allWavePoints.length > 0 && document.getElementById('wave-overlay-toggle').checked) {
    const wp = allWavePoints.find(
      (p) => Math.abs(p.lat - lat) < 0.04 && Math.abs(p.lon - lng) < 0.04 && p.waveHeight != null,
    );
    if (wp) {
      const waveFmt = _fmt(wp.waveHeight, 'depth');
      lines.push(`Wave: ${waveFmt.num} ${waveFmt.sym}`);
    }
  }

  // Current section — shown when current overlay is active
  if (allCurrentPoints.length > 0 && document.getElementById('current-overlay-toggle').checked) {
    const cp = allCurrentPoints.find((p) => Math.abs(p.lat - lat) < 0.06 && Math.abs(p.lon - lng) < 0.06);
    if (cp) {
      const spdKn = (Math.sqrt(cp.u * cp.u + cp.v * cp.v) * 1.94384).toFixed(1);
      const dir = Math.round(((Math.atan2(cp.u, cp.v) * 180) / Math.PI + 360) % 360);
      lines.push(`Current: ${spdKn} kn → ${dir}°T`);
    }
  }

  if (lines.length > 0) {
    L.popup().setLatLng([lat, lng]).setContent(lines.join('<br>')).openOn(map);
  }
});

document.getElementById('wind-overlay-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (allWindPoints.length > 0) renderWindOverlay();
  } else {
    if (windOverlayLayer) {
      map.removeLayer(windOverlayLayer);
      windOverlayLayer = null;
    }
  }
});

document.getElementById('wave-overlay-toggle').addEventListener('change', (e) => {
  const legend = document.getElementById('wave-legend');
  if (e.target.checked) {
    legend.style.display = 'flex';
    if (allWavePoints.length > 0) renderWaveOverlay();
  } else {
    legend.style.display = 'none';
    if (waveOverlayLayer) {
      map.removeLayer(waveOverlayLayer);
      waveOverlayLayer = null;
    }
  }
});

document.getElementById('current-overlay-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (allCurrentPoints.length > 0) renderCurrentOverlay();
  } else {
    if (currentOverlayLayer) {
      map.removeLayer(currentOverlayLayer);
      currentOverlayLayer = null;
    }
  }
});

document.getElementById('isochrone-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    isochroneLayerGroup.addTo(map);
  } else {
    map.removeLayer(isochroneLayerGroup);
  }
});

document.getElementById('safety-margin-toggle').addEventListener('change', () => {
  if (document.getElementById('land-toggle').checked) {
    renderLandOverlay();
  }
});

// REQ-126: re-render route when label toggle/interval changes
document.getElementById('waypoint-labels-toggle').addEventListener('change', () => {
  if (routeLayer) fetchAndDrawRoute();
});
document.getElementById('waypoint-label-interval').addEventListener('input', () => {
  if (routeLayer) fetchAndDrawRoute();
});

const saveRouteBtn = document.getElementById('save-route-btn');
const saveModalOverlay = document.getElementById('save-modal-overlay');
const routeNameInput = document.getElementById('route-name-input');
const modalSaveBtn = document.getElementById('modal-save-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

saveRouteBtn.addEventListener('click', () => {
  const defaultName = `Weather Route ${new Date().toLocaleString()}`;
  routeNameInput.value = defaultName;
  saveModalOverlay.classList.add('visible');
  routeNameInput.select();
});

modalCancelBtn.addEventListener('click', () => {
  saveModalOverlay.classList.remove('visible');
});

modalSaveBtn.addEventListener('click', async () => {
  const name = routeNameInput.value.trim() || `Weather Route ${new Date().toLocaleString()}`;
  modalSaveBtn.disabled = true;
  try {
    const r = await apiFetch(`${API}/save-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (j.error) {
      setStatus('error', `Save failed: ${j.error}`);
    } else {
      setStatus('done', `Route saved: ${name}`);
    }
  } catch (e) {
    setStatus('error', `Save failed: ${e}`);
  } finally {
    modalSaveBtn.disabled = false;
    saveModalOverlay.classList.remove('visible');
  }
});

function showConfirm(title, msg, onConfirm) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-msg').textContent = msg;
  const overlay = document.getElementById('confirm-modal-overlay');
  overlay.classList.add('visible');
  const okBtn = document.getElementById('confirm-modal-ok');
  const cancelBtn = document.getElementById('confirm-modal-cancel');
  const cleanup = () => {
    overlay.classList.remove('visible');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', cleanup);
  };
  const onOk = async () => {
    cleanup();
    await onConfirm();
  };
  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', cleanup);
}

// Promise-based yes/no confirm reusing the confirm-modal (for the upload flow).
function confirmYesNo(title, msg) {
  return new Promise((resolve) => {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-msg').textContent = msg;
    const overlay = document.getElementById('confirm-modal-overlay');
    overlay.classList.add('visible');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const done = (val) => {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// Archive button delegation for wind and current GRIB rows (wired once)
document.getElementById('grib-info').addEventListener('click', (e) => {
  const btn = e.target.closest('.grib-remove-btn');
  if (!btn) return;
  const filePath = btn.dataset.filePath;
  const name = filePath.split('/').pop();
  showConfirm('Archive GRIB file', `Move "${name}" to the archive folder?`, async () => {
    await apiFetch(`${API}/archive-grib-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    loadGribInfo();
  });
});
document.getElementById('current-info').addEventListener('click', (e) => {
  const btn = e.target.closest('.grib-remove-btn');
  if (!btn) return;
  const filePath = btn.dataset.filePath;
  const name = filePath.split('/').pop();
  showConfirm('Archive GRIB file', `Move "${name}" to the archive folder?`, async () => {
    await apiFetch(`${API}/archive-grib-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    loadGribInfo();
  });
});

async function checkDilatedReady() {
  try {
    const r = await apiFetch(`${API}/status`);
    const j = await r.json();
    if (j.polarMinTws != null) polarMinTws = j.polarMinTws;
    if (j.hiresLandActive) document.getElementById('land-toggle-label').textContent = 'Land overlay (hires)';
    if (j.dilatedIndexReady) {
      dilatedIndexReady = true;
      document.getElementById('safety-margin-building').style.display = 'none';
      document.getElementById('safety-margin-wrap').style.display = '';
      if (dilatedPollTimer) {
        clearInterval(dilatedPollTimer);
        dilatedPollTimer = null;
      }
    } else {
      document.getElementById('safety-margin-building').style.display = 'block';
      document.getElementById('safety-margin-pct').textContent = j.dilatedBuildProgress ?? 0;
    }
  } catch {
    /* ignore — server may still be starting */
  }
}

checkDilatedReady();
dilatedPollTimer = setInterval(checkDilatedReady, 3000);

const svgEl = document.getElementById('conditions-svg');
const tooltip = document.getElementById('graph-tooltip');

svgEl.addEventListener('mousemove', (e) => {
  if (!graphMeta || !graphLayout) return;
  const { VW, ml, pw, mt, ph, hasWave, maxLeft, maxBoatSpeed, maxWave } = graphLayout;
  const rect = svgEl.getBoundingClientRect();
  const svgX = ((e.clientX - rect.left) / rect.width) * VW;
  const frac = (svgX - ml) / pw;

  // Fractional index — linearly interpolate between adjacent waypoints
  const exactIdx = Math.max(0, Math.min(graphMeta.length - 1, frac * (graphMeta.length - 1)));
  const idx0 = Math.max(0, Math.min(graphMeta.length - 2, Math.floor(exactIdx)));
  const idx1 = Math.min(idx0 + 1, graphMeta.length - 1);
  const t = exactIdx - idx0;
  const m0 = graphMeta[idx0],
    m1 = graphMeta[idx1];
  const lerp = (a, b) => a + (b - a) * t;

  const d = new Date(m0.time);
  const dateStr =
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tws = lerp(m0.tws ?? 0, m1.tws ?? 0);
  const boatSpeed = m0.boatSpeed != null && m1.boatSpeed != null ? lerp(m0.boatSpeed, m1.boatSpeed) : null;

  const twsFmt = _fmt(tws, 'speed', windSpeedMs);
  let html = `<strong>${dateStr}</strong><br>Wind: ${twsFmt.num} ${twsFmt.sym} from ${m0.windDir ?? 0}°`;
  if (boatSpeed != null) {
    const bsFmt = _fmt(boatSpeed, 'speed');
    html += `<br>Boat: ${bsFmt.num} ${bsFmt.sym}`;
  }
  if (m0.waveHeight != null && m1.waveHeight != null) {
    const wvFmt = _fmt(lerp(m0.waveHeight, m1.waveHeight), 'depth');
    html += `<br>Wave: ${wvFmt.num} ${wvFmt.sym}`;
  }
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const ttW = tooltip.offsetWidth,
    ttH = tooltip.offsetHeight;
  let left = e.clientX + 12,
    top = e.clientY - ttH / 2;
  if (left + ttW > window.innerWidth - 8) left = e.clientX - ttW - 12;
  if (top < 8) top = 8;
  if (top + ttH > window.innerHeight - 8) top = window.innerHeight - ttH - 8;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
});

svgEl.addEventListener('mouseleave', () => {
  tooltip.style.display = 'none';
});

// ─── Grib Manager (REQ-131) ─────────────────────────────────────────────────
// Modal: per-file timeline with real coverage, granularity transitions, staleness,
// the low-confidence skill band (REQ-132), the departure-aware optimized-combination
// proposal, and select/deselect. Replaces the sidebar checkbox list.
function gmFormat(ms) {
  const d = new Date(ms);
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

// Positions (ms) where the timestep coarsens by >1.5× — marks non-uniform granularity.
function granularityChanges(times) {
  if (!times || times.length < 3) return [];
  const out = [];
  let prev = new Date(times[1]).getTime() - new Date(times[0]).getTime();
  for (let i = 2; i < times.length; i++) {
    const step = new Date(times[i]).getTime() - new Date(times[i - 1]).getTime();
    if (prev > 0 && step > prev * 1.5) out.push(new Date(times[i]).getTime());
    prev = step;
  }
  return out;
}

// Ensure bbox rectangles match the enabled set (used after bulk enable/disable).
function syncBboxLayers() {
  gribInfoFiles.forEach((f, i) => {
    const want = enabledGribPaths.has(f.path);
    const has = !!gribBoundsLayers[i];
    if (want && !has) {
      const color = C64_PALETTE[i % C64_PALETTE.length];
      gribBoundsLayers[i] = L.rectangle(
        [
          [f.latMin, f.lonMin],
          [f.latMax, f.lonMax],
        ],
        { color, weight: 2, fill: false, dashArray: '6 4' },
      ).addTo(map);
    } else if (!want && has) {
      map.removeLayer(gribBoundsLayers[i]);
      gribBoundsLayers[i] = null;
    }
  });
}

async function refreshCombination() {
  const depInput = document.getElementById('departure-time').value;
  let qs = '';
  if (depInput) {
    const depMs = new Date(depInput).getTime();
    if (!isNaN(depMs)) qs = `?departureTime=${new Date(depMs).toISOString()}`;
  }
  try {
    const r = await apiFetch(`${API}/grib-combination${qs}`);
    if (r.ok) lastCombination = await r.json();
  } catch (_) {
    /* keep previous/null */
  }
}

function openGribManager() {
  document.getElementById('grib-manager-overlay').style.display = 'flex';
  const body = document.getElementById('grib-manager-body');
  body.innerHTML = '<div style="padding: 20px; color: #a6adc8">Loading…</div>';
  (async () => {
    try {
      if (gribTimesMap.size === 0 && gribInfoFiles.length > 0) {
        const r = await apiFetch(`${API}/grib-times`);
        if (r.ok) {
          const { files } = await r.json();
          gribTimesMap = new Map((files ?? []).map((f) => [f.path, f.times]));
        }
      }
      await refreshCombination();
      renderGribManagerBody();
    } catch (e) {
      body.innerHTML = `<div style="padding: 20px; color: #f38ba8">Could not load: ${escapeHtml(e.message)}</div>`;
    }
  })();
}

function closeGribManager() {
  document.getElementById('grib-manager-overlay').style.display = 'none';
}

function renderGribManagerBody() {
  const body = document.getElementById('grib-manager-body');
  const files = gribInfoFiles;
  if (files.length === 0) {
    body.innerHTML = '<div style="padding: 20px; color: #a6adc8">No GRIB files loaded.</div>';
    return;
  }
  const showPast = document.getElementById('grib-manager-past').checked;
  const nowMs = Date.now();
  const horizonMs = forecastSkillHorizonHours * 3600000;

  // Axis spans all loaded files (wind + current) so the full picture (incl. historical) is visible.
  let minMs = Infinity,
    maxMs = -Infinity;
  for (const f of [...files, ...currentInfoFiles]) {
    const s = new Date(f.timeStart).getTime();
    const e = new Date(f.timeEnd).getTime();
    if (s < minMs) minMs = s;
    if (e > maxMs) maxMs = e;
  }
  const span = Math.max(1, maxMs - minMs);
  const pct = (ms) => (((ms - minMs) / span) * 100).toFixed(2);

  const comb = lastCombination;
  const scopeEl = document.getElementById('grib-manager-scope');
  const proposedCount = comb && comb.proposed ? comb.proposed.length : 0;
  if (comb && comb.scope) {
    const base =
      comb.scope.mode === 'departure'
        ? `Proposal scoped to departure ${gmFormat(new Date(comb.scope.departureTime).getTime())}`
        : 'Proposal scoped to now-forward';
    scopeEl.textContent =
      proposedCount > 0
        ? base
        : `${base} — no files match. Set a departure time (past for historical data) or enable files manually.`;
  } else {
    scopeEl.textContent = '';
  }
  // "Accept proposed" is only meaningful when there is a proposal; hide it otherwise
  // (an empty proposal would just disable every wind file — see result-9 guard).
  const acceptBtn = document.getElementById('grib-manager-accept');
  if (acceptBtn) acceptBtn.style.display = proposedCount > 0 ? '' : 'none';

  const combByPath = new Map(((comb && comb.files) || []).map((f) => [f.path, f]));
  const proposedSet = new Set((comb && comb.proposed) || []);

  let html =
    '<div class="gm-axis"><span></span><span>file</span><span>coverage timeline →</span><span>status</span></div>';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const color = C64_PALETTE[i % C64_PALETTE.length];
    const s = new Date(f.timeStart).getTime();
    const e = new Date(f.timeEnd).getTime();
    const isCurrent = f.type === 'current';
    const isPast = e < nowMs;
    if (isPast && !showPast && !isCurrent) continue;

    const left = pct(s);
    const width = (pct(e) - pct(s)).toFixed(2);
    const enabled = isCurrent ? currentEnabled : enabledGribPaths.has(f.path);
    const cf = combByPath.get(f.path);
    const proposed = proposedSet.has(f.path);

    // Skill band: low-confidence region past the forecast horizon from now.
    let bar = '<div class="gm-bar">';
    const skillStart = Math.max(nowMs + horizonMs, s);
    if (skillStart < e) {
      bar += `<div class="gm-skill" style="left:${pct(skillStart)}%;width:${(pct(e) - pct(skillStart)).toFixed(2)}%"></div>`;
    }
    const fillStyle = enabled
      ? `background:${color}`
      : `background:repeating-linear-gradient(45deg,${color}66 0 4px,transparent 4px 8px);opacity:0.55`;
    const fillCls = isPast ? 'gm-bar-fill gm-bar-past' : 'gm-bar-fill';
    bar += `<div class="${fillCls}" style="left:${left}%;width:${width}%;${fillStyle}"></div>`;
    if (nowMs >= s && nowMs <= e) bar += `<div class="gm-now" style="left:${pct(nowMs)}%"></div>`;
    if (!isCurrent) {
      for (const gMs of granularityChanges(gribTimesMap.get(f.path))) {
        if (gMs >= s && gMs <= e) bar += `<div class="gm-granule" style="left:${pct(gMs)}%"></div>`;
      }
    }
    bar += '</div>';

    let status;
    if (isCurrent) status = '<span style="color: #89dceb">ocean current</span>';
    else if (proposed) status = '<span style="color: #a6e3a1">◀ proposed</span>';
    else if (cf && cf.reason && cf.reason.startsWith('redundant'))
      status = '<span style="color: #6c7086">redundant</span>';
    else if (cf && cf.reason && cf.reason.startsWith('past')) status = '<span style="color: #f38ba8">past</span>';
    else if (cf && cf.reason)
      status = `<span style="color: #6c7086">${escapeHtml(cf.reason.split(':')[0])}</span>`;
    else status = '';

    let ageBadge = '';
    if (f.referenceTime) {
      const ageH = (nowMs - new Date(f.referenceTime).getTime()) / 3_600_000;
      const ageColor = ageH > 24 ? '#f38ba8' : ageH > 12 ? '#fe640b' : '#6c7086';
      ageBadge = ` <span style="color:${ageColor}">${Math.round(ageH)}h</span>`;
    }
    const waveBadge = f.hasWave
      ? ' <span style="color:#89b4fa" title="contains wave data (HTSGW)">~wave</span>'
      : '';
    const name = f.path.split('/').pop() || f.path;
    const cb = `<input type="checkbox" class="gm-toggle" data-path="${escapeHtml(f.path)}" ${enabled ? 'checked' : ''} style="accent-color:${color};cursor:pointer" ${isCurrent ? 'disabled' : ''}>`;
    const mini =
      `<span class="gm-mini-btns">` +
      `<button class="grib-jump-btn" data-time-start="${f.timeStart}" title="Jump scrubber to start">&#x23EE;</button>` +
      `<button class="grib-remove-btn" data-file-path="${escapeHtml(f.path)}" title="Archive this file">&#x1F5D1;</button>` +
      `</span>`;

    html +=
      `<div class="gm-row">` +
      cb +
      `<span class="gm-name" style="color:${color}" title="${escapeHtml(f.path)}">${escapeHtml(name)}${waveBadge}${ageBadge}</span>` +
      `<span style="position:relative">${bar}</span>` +
      `<span class="gm-status">${status} ${mini}</span>` +
      `</div>`;
  }

  // Ocean-current rows (single-file provider; one global on/off toggle).
  for (const f of currentInfoFiles) {
    const color = '#89dceb';
    const s = new Date(f.timeStart).getTime();
    const e = new Date(f.timeEnd).getTime();
    const isPast = e < nowMs;
    const left = pct(s);
    const width = (pct(e) - pct(s)).toFixed(2);
    let bar = '<div class="gm-bar">';
    const skillStart = Math.max(nowMs + horizonMs, s);
    if (skillStart < e) {
      bar += `<div class="gm-skill" style="left:${pct(skillStart)}%;width:${(pct(e) - pct(skillStart)).toFixed(2)}%"></div>`;
    }
    const fillStyle = currentEnabled
      ? `background:${color}`
      : `background:repeating-linear-gradient(45deg,${color}66 0 4px,transparent 4px 8px);opacity:0.55`;
    const fillCls = isPast ? 'gm-bar-fill gm-bar-past' : 'gm-bar-fill';
    bar += `<div class="${fillCls}" style="left:${left}%;width:${width}%;${fillStyle}"></div>`;
    if (nowMs >= s && nowMs <= e) bar += `<div class="gm-now" style="left:${pct(nowMs)}%"></div>`;
    bar += '</div>';
    let ageBadge = '';
    if (f.referenceTime) {
      const ageH = (nowMs - new Date(f.referenceTime).getTime()) / 3_600_000;
      const ageColor = ageH > 24 ? '#f38ba8' : ageH > 12 ? '#fe640b' : '#6c7086';
      ageBadge = ` <span style="color:${ageColor}">${Math.round(ageH)}h</span>`;
    }
    const name = f.path.split('/').pop() || f.path;
    const cb = `<input type="checkbox" class="gm-current-toggle" ${currentEnabled ? 'checked' : ''} style="accent-color:${color};cursor:pointer">`;
    const mini =
      `<span class="gm-mini-btns">` +
      `<button class="grib-jump-btn" data-time-start="${f.timeStart}" title="Jump scrubber to start">&#x23EE;</button>` +
      `<button class="grib-remove-btn" data-file-path="${escapeHtml(f.path)}" title="Archive this file">&#x1F5D1;</button>` +
      `</span>`;
    html +=
      `<div class="gm-row">` +
      cb +
      `<span class="gm-name" style="color:${color}" title="${escapeHtml(f.path)}">${escapeHtml(name)}${ageBadge}</span>` +
      `<span style="position:relative">${bar}</span>` +
      `<span class="gm-status"><span style="color: #89dceb">ocean current</span> ${mini}</span>` +
      `</div>`;
  }
  body.innerHTML = html;

  body.querySelectorAll('.gm-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      setGribEnabled(cb.dataset.path, cb.checked);
      renderGribManagerBody();
    });
  });
  body.querySelectorAll('.gm-current-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      setCurrentEnabled(cb.checked);
      renderGribManagerBody();
    });
  });
  const cnt = document.getElementById('grib-enabled-count');
  if (cnt) cnt.textContent = String(enabledGribPaths.size);
  // "Remove old GRIBs" button (lives in the manager): show when there are past-end files.
  const oldCount = [...gribInfoFiles, ...currentInfoFiles].filter(
    (f) => f.timeEnd && new Date(f.timeEnd).getTime() < nowMs,
  ).length;
  const removeOldBtn = document.getElementById('remove-old-gribs-btn');
  if (removeOldBtn) {
    removeOldBtn.style.display = oldCount > 0 ? '' : 'none';
    removeOldBtn.textContent = `Remove old GRIBs (${oldCount})`;
  }
}

// Accept the proposed combination: enable proposed wind files, disable the rest, one rebuild.
function acceptProposedCombination() {
  // Guard against an empty proposal (e.g. all-past dataset with no departure set, so the
  // now-scoped proposal is []). Applying it would disable every wind file at once.
  if (!lastCombination || !lastCombination.proposed || lastCombination.proposed.length === 0) return;
  enabledGribPaths = new Set(lastCombination.proposed);
  syncBboxLayers();
  rebuildScrubberTimes();
  const idx = parseInt(document.getElementById('time-scrubber').value);
  if (windTimesLoaded) fetchWindPoints(idx);
  if (document.getElementById('wave-overlay-toggle').checked) fetchWavePoints(idx);
  renderGribManagerBody();
}

function enableAllGribs() {
  enabledGribPaths = new Set(gribInfoFiles.filter((f) => f.type !== 'current').map((f) => f.path));
  syncBboxLayers();
  rebuildScrubberTimes();
  const idx = parseInt(document.getElementById('time-scrubber').value);
  if (windTimesLoaded) fetchWindPoints(idx);
  if (document.getElementById('wave-overlay-toggle').checked) fetchWavePoints(idx);
  renderGribManagerBody();
}

// Upload one GRIB file (octet-stream). Resolves with the JSON response, rejects on error.
function uploadGribFile(base, file, archive, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = `name=${encodeURIComponent(base)}${archive ? '&archive=1' : ''}`;
    xhr.open('POST', `${API}/upload-grib?${qs}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401 || xhr.status === 403) {
        location.href = `/admin/#/login?redirect=${encodeURIComponent(location.href)}`;
        reject(new Error('authentication required'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || '{}'));
        } catch {
          resolve({});
        }
      } else {
        let m = `upload failed (HTTP ${xhr.status})`;
        try {
          m = JSON.parse(xhr.responseText).error || m;
        } catch {
          /* keep default */
        }
        reject(new Error(m));
      }
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(file);
  });
}

// Handle a file selection from the Grib Manager upload input (REQ-139). Per file: a
// pre-flight collision check; on conflict, prompt to archive-and-replace or skip.
async function handleGribUpload(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;
  const status = document.getElementById('grib-upload-status');
  let uploaded = 0;
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const base = f.name;
    let archive = false;
    try {
      const r = await apiFetch(`${API}/grib-exists?name=${encodeURIComponent(base)}`);
      if (r.ok) {
        const { exists } = await r.json();
        if (exists) {
          const ok = await confirmYesNo(
            'Replace GRIB file',
            `A file named "${base}" already exists in the GRIB directory. Archive the existing file and upload the new one?`,
          );
          if (!ok) {
            status.textContent = `Skipped ${base} (${i + 1}/${files.length})`;
            continue;
          }
          archive = true;
        }
      }
    } catch {
      /* pre-flight unavailable — attempt the upload anyway */
    }
    try {
      await uploadGribFile(base, f, archive, (pct) => {
        status.textContent = `Uploading ${base} (${i + 1}/${files.length})… ${pct}%`;
      });
      uploaded++;
    } catch (e) {
      failed.push({ name: base, error: String(e.message || e) });
    }
  }
  status.textContent = failed.length
    ? `Uploaded ${uploaded}; failed ${failed.length}: ` + failed.map((x) => `${x.name} (${x.error})`).join('; ')
    : `Uploaded ${uploaded} file(s).`;
  await loadGribInfo();
  if (document.getElementById('grib-manager-overlay').style.display !== 'none') openGribManager();
}

// Wire modal controls on DOMContentLoaded — the modal HTML is parsed AFTER this inline
// script, so the elements don't exist at script-load. Wiring them inline (before the
// modal markup) was the root cause of the inert close/accept/enable-all/past buttons.
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('grib-manager-close').addEventListener('click', closeGribManager);
  document.getElementById('grib-manager-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'grib-manager-overlay') closeGribManager();
  });
  document.getElementById('grib-manager-accept').addEventListener('click', acceptProposedCombination);
  document.getElementById('grib-manager-reset').addEventListener('click', enableAllGribs);
  document.getElementById('grib-manager-past').addEventListener('change', renderGribManagerBody);
  document.getElementById('remove-old-gribs-btn').addEventListener('click', () => {
    showConfirm(
      'Archive old GRIBs',
      'Move all GRIB files whose forecast has ended to the archive folder?',
      async () => {
        await apiFetch(`${API}/archive-old-gribs`, { method: 'POST' });
        loadGribInfo();
      },
    );
  });
  document.getElementById('reload-grib').addEventListener('click', async () => {
    try {
      const r = await apiFetch(`${API}/reload-grib`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const j = await r.json();
      if (j.error) setStatus('error', j.error);
      else {
        loadGribInfo();
        loadRegions();
        // refresh the manager if it's open
        if (document.getElementById('grib-manager-overlay').style.display !== 'none') openGribManager();
      }
    } catch (e) {
      setStatus('error', String(e));
    }
  });
  document.getElementById('grib-manager-upload').addEventListener('click', () => {
    document.getElementById('grib-upload-input').click();
  });
  document.getElementById('grib-upload-input').addEventListener('change', (e) => {
    const input = e.target;
    handleGribUpload(input.files);
    input.value = ''; // allow re-selecting the same file later
  });
});
document.getElementById('departure-time').addEventListener('change', () => {
  if (document.getElementById('grib-manager-overlay').style.display !== 'none') {
    (async () => {
      await refreshCombination();
      renderGribManagerBody();
    })();
  }
});
