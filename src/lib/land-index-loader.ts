// Browser-compatible land index loading.
//
// Parses the binary edge-index format used by landmask.ts from an ArrayBuffer.
// No Node.js APIs — works in browsers, Web Workers, and Node.js.
//
// In the browser, the caller fetches the .bin.gz file, decompresses it with
// DecompressionStream, and passes the resulting ArrayBuffer here.
//
// In Node.js (server plugin), the existing setup.ts handles filesystem caching
// and calls parseIndexBuffer() directly.

import type { LandEdgeIndex, LandPolygon } from '../types';

export const EDGE_INDEX_MAGIC = 0x4c4e4458; // 'LNDX'
export const EDGE_INDEX_VERSION = 2;
export const DILATED_INDEX_MAGIC = 0x444c4e44; // 'DLND'
export const DILATED_INDEX_VERSION = 2;

/**
 * Parse a land edge-index binary buffer into the LandEdgeIndex structure.
 * Uses DataView — works with any ArrayBuffer source (fetch, fs, IndexedDB).
 */
export function parseIndexFromArrayBuffer(buffer: ArrayBuffer): LandEdgeIndex {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);

  if (magic !== EDGE_INDEX_MAGIC && magic !== DILATED_INDEX_MAGIC) {
    throw new Error(`Invalid land index: bad magic 0x${magic.toString(16)} (expected LNDX or DLND)`);
  }
  if (version !== EDGE_INDEX_VERSION) {
    throw new Error(`Unsupported land index version ${String(version)} (expected ${String(EDGE_INDEX_VERSION)})`);
  }

  const nPolygons = view.getUint32(16, true);
  const nEdgeCells = view.getUint32(20, true);
  const nPolyCells = view.getUint32(24, true);
  let off = 32;

  const polygons: LandPolygon[] = [];
  for (let i = 0; i < nPolygons; i++) {
    const bboxLatMin = view.getFloat64(off, false); // BE
    const bboxLatMax = view.getFloat64(off + 8, false);
    const bboxLonMin = view.getFloat64(off + 16, false);
    const bboxLonMax = view.getFloat64(off + 24, false);
    const nFloats = view.getUint32(off + 32, true); // LE
    off += 40; // 4×f64 + u32 + 4-byte pad
    const exterior = new Float64Array(buffer, off, nFloats);
    off += nFloats * 8;
    polygons.push({ bboxLatMin, bboxLatMax, bboxLonMin, bboxLonMax, exterior });
  }

  const edgeGrid = new Map<number, Uint32Array>();
  for (let i = 0; i < nEdgeCells; i++) {
    const key = view.getUint32(off, true);
    off += 4;
    const n = view.getUint32(off, true);
    off += 4;
    edgeGrid.set(key, new Uint32Array(buffer, off, n));
    off += n * 4;
  }

  const polyGrid = new Map<number, number[]>();
  for (let i = 0; i < nPolyCells; i++) {
    const key = view.getUint32(off, true);
    off += 4;
    const n = view.getUint32(off, true);
    off += 4;
    const polys: number[] = [];
    for (let j = 0; j < n; j++) {
      polys.push(view.getUint32(off, true));
      off += 4;
    }
    polyGrid.set(key, polys);
  }

  return { polygons, edgeGrid, polyGrid };
}

/**
 * Fetch and decompress a gzipped land index from a URL.
 * Uses fetch + DecompressionStream — works in modern browsers and Node.js 18+.
 */
export async function fetchLandIndex(url: string): Promise<LandEdgeIndex> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Land index fetch failed: HTTP ${String(resp.status)}`);

  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // If the server set Content-Encoding: gzip, the browser already decompressed it.
  // Detect by checking for the gzip magic bytes (1f 8b).
  const isGzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzipped) {
    return parseIndexFromArrayBuffer(buf);
  }

  // Manually decompress
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes).then(async () => writer.close());
  const reader = ds.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = result.value;
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return parseIndexFromArrayBuffer(combined.buffer);
}
