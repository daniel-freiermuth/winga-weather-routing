// Time axis management — builds the unified wind+current timeline,
// manages scrubber range, and handles Windy tile time loading.

import * as dataLayer from './data-layer';
import type { GribFileMeta } from './types';

export interface TimeAxisManager {
  windTimes: string[];
  windTimesCount: number;
  windNativeTimes: string[];
  windTimesLoaded: boolean;
  actualWindTimes: string[] | null;
  currentFileTimes: string[];
  currentEnabled: boolean;
  gribTimesMap: Map<string, string[]>;
  enabledGribPaths: Set<string>;
  gribInfoFiles: GribFileMeta[];
}

/**
 * Create a new empty time axis manager.
 */
export function createTimeAxis(): TimeAxisManager {
  return {
    windTimes: [],
    windTimesCount: 0,
    windNativeTimes: [],
    windTimesLoaded: false,
    actualWindTimes: null,
    currentFileTimes: [],
    currentEnabled: true,
    gribTimesMap: new Map(),
    enabledGribPaths: new Set(),
    gribInfoFiles: [],
  };
}

/**
 * Rebuild the unified time axis from enabled GRIB files or Windy times.
 * Returns the new state; caller must apply it.
 */
export function rebuildTimes(mgr: TimeAxisManager): TimeAxisManager {
  const windSet = new Set<string>();
  const enabledWind = mgr.gribInfoFiles.filter(
    (f) => f.type !== 'current' && mgr.enabledGribPaths.has(f.path),
  );

  if (enabledWind.length > 0) {
    for (const f of enabledWind) {
      if (!f.timeStart || !f.nTimes) continue;
      const startMs = new Date(f.timeStart).getTime();
      const endMs = new Date(f.timeEnd).getTime();
      const cached = mgr.gribTimesMap.get(f.path);
      if (cached) {
        for (const t of cached) {
          const ms = new Date(t).getTime();
          if (ms >= startMs && ms <= endMs) windSet.add(t);
        }
      } else if (mgr.actualWindTimes) {
        for (const t of mgr.actualWindTimes) {
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
  } else if (mgr.actualWindTimes) {
    for (const t of mgr.actualWindTimes) windSet.add(t);
  }

  const windArr = Array.from(windSet).sort();
  let unified = [...windArr];
  if (mgr.currentEnabled && mgr.currentFileTimes.length > 0) {
    const s = new Set(windArr);
    for (const t of mgr.currentFileTimes) {
      if (!s.has(t)) unified.push(t);
    }
    unified.sort();
  }

  const loaded = unified.length > 0;

  return {
    ...mgr,
    windTimes: unified,
    windTimesCount: windArr.length,
    windNativeTimes: windArr,
    windTimesLoaded: loaded,
  };
}

/**
 * Load forecast times from Windy CDN and return the initial time axis state.
 */
export async function loadWindyTimes(mgr: TimeAxisManager): Promise<TimeAxisManager> {
  const { windTimes: wt, currentTimes: ct } = await dataLayer.loadTimesFromWindy();
  const updated: TimeAxisManager = {
    ...mgr,
    actualWindTimes: wt,
    currentFileTimes: ct,
    gribTimesMap: new Map([['windy', wt]]),
  };
  return rebuildTimes(updated);
}
