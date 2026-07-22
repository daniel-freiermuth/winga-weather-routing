// Forecast data fetching — loads wind, wave, and current overlay data from Windy tiles.
// Pushes results into stores so overlay components react automatically.

import { windPoints, wavePoints, currentPoints, waveGridMetaStore } from './stores';
import * as dataLayer from './data-layer';
import type { WindPoint, WavePoint } from './stores';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** State tracking for the time axis */
export interface TimeAxisState {
  windTimes: string[];
  windNativeTimes: string[];
  windTimesLoaded: boolean;
}

let allWindPoints: WindPoint[] = [];
let allWavePoints: WavePoint[] = [];
let allCurrentPoints: { lat: number; lon: number; u: number; v: number }[] = [];

export function getWindPoints() { return allWindPoints; }
export function getWavePoints() { return allWavePoints; }
export function getCurrentPoints() { return allCurrentPoints; }

export async function fetchWindPoints(
  timeIdx: number, timeAxis: TimeAxisState, map: MapLibreMap, signal?: AbortSignal,
): Promise<void> {
  if (!timeAxis.windTimesLoaded) return;
  const timeStr = timeAxis.windTimes[timeIdx];
  if (!timeStr || !timeAxis.windNativeTimes.includes(timeStr)) {
    allWindPoints = [];
    windPoints.set([]);
    return;
  }
  const nativeIdx = timeAxis.windNativeTimes.indexOf(timeStr);
  if (!map) return;
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(), latMax: bounds.getNorth(),
    lonMin: bounds.getWest(), lonMax: bounds.getEast(),
  };
  try {
    allWindPoints = await dataLayer.fetchWindGrid(nativeIdx, bbox, signal);
    windPoints.set(allWindPoints);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return;
    throw e;
  }
}

export async function fetchWavePoints(
  timeIdx: number, timeAxis: TimeAxisState, map: MapLibreMap, signal?: AbortSignal,
): Promise<void> {
  if (!timeAxis.windTimesLoaded) return;
  const timeStr = timeAxis.windTimes[timeIdx];
  if (!timeStr || !timeAxis.windNativeTimes.includes(timeStr)) {
    allWavePoints = [];
    wavePoints.set([]);
    return;
  }
  const nativeIdx = timeAxis.windNativeTimes.indexOf(timeStr);
  if (!map) return;
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(), latMax: bounds.getNorth(),
    lonMin: bounds.getWest(), lonMax: bounds.getEast(),
  };
  try {
    const result = await dataLayer.fetchWaveGrid(nativeIdx, bbox, signal);
    allWavePoints = result.points;
    wavePoints.set(allWavePoints);
    if (allWavePoints.length > 0) {
      const lats = allWavePoints.map((p) => p.lat);
      const lons = allWavePoints.map((p) => p.lon);
      waveGridMetaStore.set({
        latMin: Math.min(...lats), latMax: Math.max(...lats),
        lonMin: Math.min(...lons), lonMax: Math.max(...lons),
        latStep: 0.5, lonStep: 0.5,
      });
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return;
    throw e;
  }
}

export async function fetchCurrentPoints(
  timeMs: number, map: MapLibreMap, signal?: AbortSignal,
): Promise<void> {
  if (!map) return;
  const bounds = map.getBounds();
  const bbox = {
    latMin: bounds.getSouth(), latMax: bounds.getNorth(),
    lonMin: bounds.getWest(), lonMax: bounds.getEast(),
  };
  try {
    allCurrentPoints = await dataLayer.fetchCurrentGrid(timeMs, bbox, signal);
    currentPoints.set(allCurrentPoints);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return;
    throw e;
  }
}
