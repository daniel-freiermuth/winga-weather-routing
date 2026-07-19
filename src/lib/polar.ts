// Polar diagram loading (ORC/OpenCPN semicolon-delimited CSV) and bilinear boat-speed interpolation.

import type { PolarData } from '../types';

/**
 * Parse a polar CSV string into PolarData.
 * Browser-compatible — no filesystem access.
 */
export function parsePolarCsv(csv: string): PolarData {
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  // Header: twa/tws;6;8;10;12;14;16;20
  const headerLine = lines[0];
  if (headerLine === undefined) return { tws: [], twa: [], speeds: [] };
  const header = headerLine.split(';');
  const tws = header
    .slice(1)
    .map(Number)
    .filter((v) => !isNaN(v));

  const twa: number[] = [];
  const speeds: number[][] = [];

  for (const line of lines.slice(1)) {
    const parts = line.split(';').map(Number);
    const angle = parts[0];
    if (angle === undefined || isNaN(angle)) continue;
    twa.push(angle);
    speeds.push(parts.slice(1, 1 + tws.length));
  }

  return { tws, twa, speeds };
}

/**
 * Read and parse a polar CSV file from the filesystem.
 * Node.js only — not available in the browser. Callers must pass the file
 * content as a string if running in a browser context (use parsePolarCsv).
 */
export function parsePolarFile(filePath: string): PolarData {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- Node.js-only: dynamic require keeps module importable in browsers that never call this function
  const fsModule: unknown = require('node:fs');
  if (
    fsModule === null ||
    typeof fsModule !== 'object' ||
    !('readFileSync' in fsModule) ||
    typeof fsModule.readFileSync !== 'function'
  ) {
    throw new Error('parsePolarFile requires Node.js (node:fs not available)');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- validated readFileSync above; Function type is the narrowest TS can prove from typeof guard
  const content: unknown = fsModule.readFileSync(filePath, 'utf-8');
  if (typeof content !== 'string') throw new Error('readFileSync did not return a string');
  return parsePolarCsv(content);
}

export function interpolateBoatSpeed(polar: PolarData, twaDeg: number, twsKnots: number): number {
  // Polar is symmetric: use absolute TWA clamped to 0–180
  const twa = Math.min(180, Math.max(0, Math.abs(twaDeg)));

  // Below the polar's minimum close-hauled angle the boat cannot make progress against the wind.
  // Bilinear extrapolation below polar.twa[0] produces non-zero speeds for impossible headings.
  const firstTwa = polar.twa[0];
  if (firstTwa === undefined || twa < firstTwa) return 0;

  const twsIdx = bracketIndex(polar.tws, twsKnots);
  const twaIdx = bracketIndex(polar.twa, twa);

  if (twsIdx < 0 || twaIdx < 0) return 0;

  const twa0 = polar.twa[twaIdx];
  const twa1 = polar.twa[Math.min(twaIdx + 1, polar.twa.length - 1)];
  if (twa0 === undefined || twa1 === undefined) return 0;
  const tTwa = twa1 === twa0 ? 0 : Math.max(0, Math.min(1, (twa - twa0) / (twa1 - twa0)));
  const twaNext = Math.min(twaIdx + 1, polar.twa.length - 1);

  // Below polar minimum TWS: linearly interpolate toward zero (BUG-58).
  // ORC polars start at 6 kn because the VPP aero model is unreliable below that,
  // not because boats can't sail. At 4-5 kn TWS a typical boat makes 1-3 kn.
  // Linear ramp from (0, 0) to (polar.tws[0], polar_min_speed) preserves
  // frontier points at moderate TWS while correctly showing less wind = less speed.
  const firstTws = polar.tws[0];
  if (firstTws === undefined) return 0;
  if (twsKnots < firstTws) {
    const minTwsSpeed =
      (1 - tTwa) * (polar.speeds[twaIdx]?.[0] ?? 0) + tTwa * (polar.speeds[twaNext]?.[0] ?? 0);
    return minTwsSpeed * (twsKnots / firstTws);
  }

  const tws0 = polar.tws[twsIdx];
  const tws1 = polar.tws[Math.min(twsIdx + 1, polar.tws.length - 1)];
  if (tws0 === undefined || tws1 === undefined) return 0;
  const tTws = tws1 === tws0 ? 0 : Math.max(0, Math.min(1, (twsKnots - tws0) / (tws1 - tws0)));
  const twsNext = Math.min(twsIdx + 1, polar.tws.length - 1);

  const s00 = polar.speeds[twaIdx]?.[twsIdx] ?? 0;
  const s10 = polar.speeds[twaNext]?.[twsIdx] ?? 0;
  const s01 = polar.speeds[twaIdx]?.[twsNext] ?? 0;
  const s11 = polar.speeds[twaNext]?.[twsNext] ?? 0;

  return (1 - tTwa) * (1 - tTws) * s00 + tTwa * (1 - tTws) * s10 + (1 - tTwa) * tTws * s01 + tTwa * tTws * s11;
}

function bracketIndex(arr: number[], value: number): number {
  const first = arr[0];
  if (first === undefined || value <= first) return 0; // clamp to lowest bracket; tTws/tTwa lower-clamp prevents below-minimum extrapolation
  const last = arr[arr.length - 1];
  if (last === undefined || value >= last) return arr.length - 2;
  for (let i = 0; i < arr.length - 1; i++) {
    const lo = arr[i];
    const hi = arr[i + 1];
    if (lo !== undefined && hi !== undefined && value >= lo && value <= hi) return i;
  }
  return -1;
}
