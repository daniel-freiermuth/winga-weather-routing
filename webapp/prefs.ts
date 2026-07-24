// User preferences — persisted to localStorage as a single JSON blob.
// Import { prefs } and read/write fields directly; changes auto-save.

const STORAGE_KEY = 'wr-prefs';

export interface Prefs {
  // Map position
  mapCenter: [number, number]; // [lng, lat]
  mapZoom: number;
  // Wind unit in conditions table
  windUnit: 'kn' | 'm/s' | 'km/h' | 'Bft';
  // Routing settings
  coastAvoidance: boolean;
  safetyMargin: boolean;
  motorBelowKn: string;
  motorSpeedKn: string;
  waitForWind: boolean;
  maxWindKn: string;
  maxWaveM: string;
  tackPenaltySec: string;
  tackThresholdDeg: string;
  waypointLabels: boolean;
  waypointLabelInterval: string;
}

const DEFAULTS: Prefs = {
  mapCenter: [18, 57],
  mapZoom: 6,
  windUnit: 'kn',
  coastAvoidance: true,
  safetyMargin: false,
  motorBelowKn: '',
  motorSpeedKn: '',
  waitForWind: false,
  maxWindKn: '',
  maxWaveM: '',
  tackPenaltySec: '30',
  tackThresholdDeg: '60',
  waypointLabels: true,
  waypointLabelInterval: '0',
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) as Partial<Prefs> };
  } catch { /* corrupt data — use defaults */ }
  return { ...DEFAULTS };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced save — coalesces rapid changes (e.g. map panning). */
export function savePrefs(p: Prefs): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }, 500);
}

export const prefs: Prefs = load();
