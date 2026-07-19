// Routing Web Worker — runs the isochrone algorithm off the main thread.
//
// PROTOCOL
// ─────────
// Main thread → Worker:
//   { type: 'calculate', payload: CalculateRequest }
//
// Worker → Main thread:
//   { type: 'progress', pct: number, frontier: [number,number][] }
//   { type: 'result', route: RoutePoint[], warning?: string }
//   { type: 'error', message: string }
//
// The worker pre-loads wind/wave/current tiles and the land index before
// starting the isochrone. Polar data and route parameters are passed inline.

import { TileWindProvider, TileCurrentProvider } from '../src/lib/tile-provider';
import { parsePolarCsv } from '../src/lib/polar';
import { parseIndexFromArrayBuffer } from '../src/lib/land-index-loader';
import { buildLandIndex } from '../src/lib/landmask';
import { IsochroneAlgorithm } from '../src/lib/routing/isochrone';
import type { BoundingBox, CalculationRequest, RoutePoint } from '../src/types';

// ── Message types ─────────────────────────────────────────────────────────────

interface CalculatePayload {
  /** Route start, end, waypoints, departure, options — same as CalculationRequest */
  request: CalculationRequest;
  /** Polar diagram CSV content (not a file path). */
  polarCsv: string;
  /** Bounding box for tile pre-fetch — should cover the full route area with margin. */
  tileBbox: BoundingBox;
  /** URL to the gzipped edge-index binary (served from the same host or a CDN). */
  landIndexUrl: string;
  /** URL to the gzipped dilated edge-index binary (for safety margin). */
  dilatedIndexUrl?: string;
  /** Windy model for wind tiles. Default: 'ecmwf'. */
  windModel?: 'ecmwf' | 'gfs' | 'icon';
  /** Whether to use the safety margin (dilated coastline). */
  useSafetyMargin?: boolean;
}

type InMessage = { type: 'calculate'; payload: CalculatePayload };

type OutMessage =
  | { type: 'progress'; pct: number; frontier: [number, number][] }
  | { type: 'result'; route: RoutePoint[]; warning?: string }
  | { type: 'error'; message: string };

function post(msg: OutMessage): void {
  postMessage(msg);
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handleCalculate(payload: CalculatePayload): Promise<void> {
  const { request, polarCsv, tileBbox, landIndexUrl, dilatedIndexUrl, windModel, useSafetyMargin } = payload;

  // Parse departure time bounds
  const departureMs = new Date(request.departureTime).getTime();
  // Estimate a generous arrival window: 15 days (max ECMWF premium) from departure
  const arrivalMs = departureMs + 15 * 24 * 3_600_000;

  post({ type: 'progress', pct: 0, frontier: [] });

  // 1. Load polar (synchronous — just CSV parsing)
  const polar = parsePolarCsv(polarCsv);

  // 2. Pre-fetch wind + wave + current tiles and land index in parallel
  const landFetch = fetch(landIndexUrl)
    .then(async (r) => {
      if (!r.ok || r.body === null) throw new Error(`Land index HTTP ${String(r.status)}`);
      const ds = new DecompressionStream('gzip');
      const decompressed: ReadableStream<Uint8Array> = r.body.pipeThrough(ds);
      const reader = decompressed.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        const chunk: Uint8Array = result.value;
        chunks.push(chunk);
        total += chunk.length;
      }
      const combined = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      return parseIndexFromArrayBuffer(combined.buffer);
    });

  let dilatedFetch: Promise<ReturnType<typeof parseIndexFromArrayBuffer> | null> = Promise.resolve(null);
  if (useSafetyMargin === true && dilatedIndexUrl !== undefined) {
    dilatedFetch = fetch(dilatedIndexUrl)
      .then(async (r) => {
        if (!r.ok || r.body === null) return null;
        const ds = new DecompressionStream('gzip');
        const decompressed: ReadableStream<Uint8Array> = r.body.pipeThrough(ds);
        const reader = decompressed.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const chunk: Uint8Array = result.value;
          chunks.push(chunk);
          total += chunk.length;
        }
        const combined = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { combined.set(c, off); off += c.length; }
        return parseIndexFromArrayBuffer(combined.buffer);
      })
      .catch(() => null);
  }

  const windProvider = new TileWindProvider({
    windModel: windModel ?? 'ecmwf',
  });
  const currentProvider = new TileCurrentProvider();

  // All loading in parallel
  const [edgeIndex, dilatedEdgeIndex] = await Promise.all([
    landFetch,
    dilatedFetch,
    windProvider.load(tileBbox, departureMs, arrivalMs),
    currentProvider.load(tileBbox, departureMs, arrivalMs),
  ]);

  post({ type: 'progress', pct: 10, frontier: [] });

  // 3. Build land index from polygons (for overlay — landmask uses edge grid directly)
  const activeIndex = useSafetyMargin === true && dilatedEdgeIndex !== null
    ? dilatedEdgeIndex
    : edgeIndex;

  // 4. Run isochrone
  const algorithm = new IsochroneAlgorithm();
  const result = await algorithm.calculate(
    windProvider,
    currentProvider.times.length > 0 ? currentProvider : null,
    polar,
    activeIndex,
    null, // no region avoidance in browser (could be added later)
    request,
    (pct, frontier) => {
      // Map 0-100 from algorithm to 10-100 for the worker (0-10 is loading)
      post({ type: 'progress', pct: 10 + pct * 0.9, frontier });
    },
    request.options,
  );

  post({
    type: 'result',
    route: result.route,
    ...(result.warning !== undefined && { warning: result.warning }),
  });
}

// ── Message listener ──────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as InMessage;
  if (msg.type === 'calculate') {
    void handleCalculate(msg.payload).catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  }
});
