// MultiFileWindProvider: resolves wind and wave lookups across multiple GRIB files.
// When files overlap spatially and temporally, the most-recently-modified file wins.

import { GribFileEntry, WindProvider, WindVector } from '../types';
import { getWindAt, getWaveAt, nearestTimeIndex } from './grib';

export function nearestIdx(times: Date[], t: Date): number {
  const ms = t.getTime();
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(times[i].getTime() - ms);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}

function coversPoint(entry: GribFileEntry, lat: number, lon: number): boolean {
  const { latMin, latMax, lonMin, lonMax } = entry.meta;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

export class MultiFileWindProvider implements WindProvider {
  readonly times: Date[];
  // Sorted by mtime descending so the first covering file is always the freshest.
  private readonly sortedFiles: GribFileEntry[];

  constructor(files: GribFileEntry[]) {
    this.sortedFiles = [...files].sort((a, b) => b.meta.mtime - a.meta.mtime);

    const msSet = new Set<number>();
    for (const f of this.sortedFiles) {
      for (const t of f.data!.times) msSet.add(t.getTime());
    }
    this.times = Array.from(msSet).sort((a, b) => a - b).map(ms => new Date(ms));
  }

  getWind(lat: number, lon: number, timeIdx: number): WindVector {
    const t = this.times[timeIdx];
    const f = this.sortedFiles.find(e => coversPoint(e, lat, lon)) ?? this.sortedFiles[0];
    return getWindAt(f.data!, lat, lon, nearestTimeIndex(f.data!, t));
  }

  getWave(lat: number, lon: number, t: Date): number | undefined {
    const waveFiles = this.sortedFiles.filter(e => e.data?.swhByTime?.size);
    if (waveFiles.length === 0) return undefined;
    const f = waveFiles.find(e => coversPoint(e, lat, lon)) ?? waveFiles[0];
    return getWaveAt(f.data!, lat, lon, t.getTime());
  }
}
