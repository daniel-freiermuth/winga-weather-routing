// Scrubber controller — manages the time scrubber DOM behavior,
// coverage bar rendering, now-marker positioning, and range toggling.

import type { WaypointMeta, GribFileMeta } from './types';

const C64_PALETTE = [
  '#6c7086', '#ffffff', '#883932', '#67b6bd', '#8b3f96',
  '#55a049', '#40318d', '#bfce72', '#8b5429', '#574200',
];

export interface ScrubberState {
  windTimes: string[];
  scrubberLockedToRoute: boolean;
  routeScrubberRange: { i0: number; iN: number } | null;
  graphMeta: WaypointMeta[] | null;
  gribInfoFiles: GribFileMeta[];
  enabledGribPaths: Set<string>;
  currentEnabled: boolean;
  currentFileTimes: string[];
}

/** Update the time label next to the scrubber. */
export function updateLabel(idx: number, windTimes: string[]): void {
  const t = windTimes[idx];
  if (!t) return;
  const el = document.getElementById('time-scrubber-label');
  if (el) {
    el.textContent = new Date(t).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}

/** Render the coverage bar showing which GRIB files cover which time range. */
export function renderCoverageBar(rangeStart: number, rangeEnd: number, state: ScrubberState): void {
  const bar = document.getElementById('scrubber-coverage-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const span = Math.max(1, rangeEnd - rangeStart);

  const addRow = (color: string, si: number, ei: number) => {
    si = Math.max(si, rangeStart);
    ei = Math.min(ei, rangeEnd);
    if (si > ei) return;
    const p1 = (((si - rangeStart) / span) * 100).toFixed(2);
    const p2 = (((ei - rangeStart) / span) * 100).toFixed(2);
    const row = document.createElement('div');
    row.style.cssText = `height:4px;border-radius:2px;background:linear-gradient(to right,#313244 0% ${p1}%,${color} ${p1}% ${p2}%,#313244 ${p2}% 100%)`;
    bar.appendChild(row);
  };

  if (state.scrubberLockedToRoute && state.graphMeta && state.graphMeta.some((m) => m.gribFile != null)) {
    const stops: string[] = [];
    for (let i = 0; i < state.graphMeta.length; i++) {
      const tMs = new Date(state.graphMeta[i]!.time).getTime();
      let si = state.windTimes.findIndex((t) => new Date(t).getTime() >= tMs);
      if (si < 0) si = rangeEnd;
      const nextMs = i < state.graphMeta.length - 1
        ? new Date(state.graphMeta[i + 1]!.time).getTime()
        : state.windTimes[rangeEnd] ? new Date(state.windTimes[rangeEnd]!).getTime() : tMs;
      let ei = state.windTimes.findIndex((t) => new Date(t).getTime() >= nextMs);
      if (ei < 0) ei = rangeEnd;
      ei = Math.max(si, ei - 1);
      const fp = state.graphMeta[i]!.gribFile;
      const colorIdx = fp != null ? state.gribInfoFiles.findIndex((f) => f.path === fp) : -1;
      const color = colorIdx >= 0 ? C64_PALETTE[colorIdx % C64_PALETTE.length]! : '#45475a';
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
    state.gribInfoFiles.forEach((f, i) => {
      if (f.type === 'current' || !state.enabledGribPaths.has(f.path)) return;
      const startMs = new Date(f.timeStart).getTime();
      const endMs = new Date(f.timeEnd).getTime();
      const si = state.windTimes.findIndex((t) => new Date(t).getTime() >= startMs);
      const ei = state.windTimes.findLastIndex((t) => new Date(t).getTime() <= endMs);
      addRow(C64_PALETTE[i % C64_PALETTE.length]!, si, ei);
    });
  }

  if (state.currentEnabled && state.currentFileTimes.length > 0) {
    const currentSet = new Set(state.currentFileTimes);
    const si = state.windTimes.findIndex((t) => currentSet.has(t));
    const ei = state.windTimes.findLastIndex((t) => currentSet.has(t));
    addRow('#89dceb', si, ei);
  }
}

/** Position the now-marker triangle relative to the given range. */
export function updateNowMarker(rangeStart: number, rangeEnd: number, windTimes: string[]): void {
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

/** Toggle scrubber between route-restricted and full GRIB range. Returns updated lock state. */
export function toggleRange(state: ScrubberState): { locked: boolean } {
  if (!state.routeScrubberRange) return { locked: state.scrubberLockedToRoute };
  const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
  const toggleBtn = document.getElementById('scrubber-range-toggle');
  if (!scrubber || !toggleBtn) return { locked: state.scrubberLockedToRoute };

  if (state.scrubberLockedToRoute) {
    scrubber.min = '0';
    scrubber.max = String(state.windTimes.length - 1);
    toggleBtn.textContent = 'Route only';
    renderCoverageBar(0, state.windTimes.length - 1, { ...state, scrubberLockedToRoute: false });
    updateNowMarker(0, state.windTimes.length - 1, state.windTimes);
    return { locked: false };
  } else {
    const { i0, iN } = state.routeScrubberRange;
    scrubber.min = String(i0);
    scrubber.max = String(iN);
    scrubber.value = String(Math.max(i0, Math.min(iN, parseInt(scrubber.value))));
    toggleBtn.textContent = 'Full range';
    renderCoverageBar(i0, iN, { ...state, scrubberLockedToRoute: true });
    updateNowMarker(i0, iN, state.windTimes);
    return { locked: true };
  }
}

/** Apply scrubber DOM state after rebuilding times. */
export function applyScrubberTimes(windTimes: string[], state: ScrubberState): void {
  renderCoverageBar(0, windTimes.length - 1, state);
  updateNowMarker(0, windTimes.length - 1, windTimes);
  const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
  if (!scrubber) return;
  const prevVal = Math.min(parseInt(scrubber.value) || 0, Math.max(0, windTimes.length - 1));
  if (windTimes.length === 0) {
    const panel = document.getElementById('time-scrubber-panel');
    if (panel) panel.style.display = 'none';
    return;
  }
  scrubber.min = '0';
  scrubber.max = String(windTimes.length - 1);
  scrubber.value = String(prevVal);
  const panel = document.getElementById('time-scrubber-panel');
  if (panel) panel.style.display = 'flex';
  updateLabel(prevVal, windTimes);
}

/** Lock scrubber to a route time range. */
export function lockToRoute(
  i0: number, iN: number, windTimes: string[], state: ScrubberState,
): void {
  const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
  if (!scrubber) return;
  scrubber.min = String(i0);
  scrubber.max = String(iN);
  scrubber.value = String(i0);
  renderCoverageBar(i0, iN, { ...state, scrubberLockedToRoute: true });
  updateNowMarker(i0, iN, windTimes);
  const toggleBtn = document.getElementById('scrubber-range-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = 'Full range';
    toggleBtn.style.display = '';
  }
}

export interface ScrubberHandlerDeps {
  getWindTimes: () => string[];
  isLoaded: () => boolean;
  isCurrentEnabled: () => boolean;
  hasCurrentPoints: () => boolean;
  fetchWind: (idx: number, signal?: AbortSignal) => void;
  fetchWave: (idx: number, signal?: AbortSignal) => void;
  fetchCurrent: (timeMs: number, signal?: AbortSignal) => void;
  onScrubberHighlight: (idx: number) => void;
  onToggleRange: () => void;
}

/**
 * Wire all scrubber DOM event handlers. Call once after the DOM is ready.
 */
export function setupScrubberHandlers(deps: ScrubberHandlerDeps): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let windAbort: AbortController | null = null;
  let waveAbort: AbortController | null = null;
  let currentAbort: AbortController | null = null;

  document.getElementById('time-scrubber')?.addEventListener('input', (e) => {
    const idx = parseInt((e.target as HTMLInputElement).value);
    updateLabel(idx, deps.getWindTimes());
    clearTimeout(timer ?? undefined);
    timer = setTimeout(() => {
      windAbort?.abort();
      windAbort = new AbortController();
      waveAbort?.abort();
      waveAbort = new AbortController();
      deps.fetchWind(idx, windAbort.signal);
      deps.fetchWave(idx, waveAbort.signal);

      const wt = deps.getWindTimes();
      const timeMs = wt[idx] ? new Date(wt[idx]).getTime() : Date.now();
      if (deps.isCurrentEnabled() || deps.hasCurrentPoints()) {
        currentAbort?.abort();
        currentAbort = new AbortController();
        deps.fetchCurrent(timeMs, currentAbort.signal);
      }
      deps.onScrubberHighlight(idx);
    }, 100);
  });

  document.getElementById('jump-to-now')?.addEventListener('click', () => {
    if (!deps.isLoaded()) return;
    const wt = deps.getWindTimes();
    const nowMs = Date.now();
    let idx = wt.findIndex((t) => new Date(t).getTime() >= nowMs);
    if (idx < 0) idx = wt.length - 1;
    const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
    if (scrubber) {
      scrubber.value = String(idx);
      scrubber.dispatchEvent(new Event('input'));
    }
  });

  document.getElementById('scrubber-range-toggle')?.addEventListener('click', () => deps.onToggleRange());

  document.getElementById('use-as-departure')?.addEventListener('click', () => {
    const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
    if (!scrubber) return;
    const wt = deps.getWindTimes();
    const t = wt[parseInt(scrubber.value)];
    if (t) {
      const depInput = document.getElementById('departure-time') as HTMLInputElement | null;
      if (depInput) {
        const d = new Date(t);
        const pad = (n: number) => String(n).padStart(2, '0');
        depInput.value = `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  });

  // Click-to-jump on GRIB file start-time buttons
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-time-start]');
    if (!btn || !deps.isLoaded() || !(btn as HTMLElement).dataset['timeStart']) return;
    const ts = parseInt((btn as HTMLElement).dataset['timeStart']!);
    const wt = deps.getWindTimes();
    const idx = wt.findIndex((t) => new Date(t).getTime() >= ts);
    if (idx >= 0) {
      const scrubber = document.getElementById('time-scrubber') as HTMLInputElement | null;
      if (scrubber) {
        scrubber.value = String(idx);
        scrubber.dispatchEvent(new Event('input'));
      }
    }
  });
}
