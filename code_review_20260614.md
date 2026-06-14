# Code Review — 2026-06-14

Review of the signalk-weather-routing codebase (22 TypeScript source files, 4,377 lines, 8 test files).

---

## Critical

### C1 — `selectFile` fallback chain silently returns wrong GRIB data — **BUG-93**

**File:** `src/lib/windprovider.ts:37-49`

`selectFile` has a three-level fallback chain: (1) spatial + temporal match, (2) spatial-only match (ignoring time), (3) first file in sorted order regardless of coverage. If no file matches both spatial and temporal constraints, it silently returns data from a file that does not cover the requested time or location. This violates the **Nautical Safety Rule** (fail loudly, fail early, fail clearly).

**Fix:** Remove the second and third fallback levels. If no file matches both spatial and temporal constraints, throw an error or return `{ u: 0, v: 0 }` explicitly.

---

### C2 — Current drift longitude uses incorrect latitude for cosine correction — **BUG-94**

**File:** `src/lib/routing/isochrone.ts:222-227`

```typescript
newLat += cur.v * dtS / (1852 * 60);
newLon += cur.u * dtS / (1852 * 60 * Math.cos(newLat * DEG_TO_RAD));
```

`newLat` is modified on line 225 before it is used in the cosine correction on line 226. The longitude calculation should use the original `point.lat` or the midpoint. Small error (~0.01% per 1° of latitude change) but logically incorrect.

**Fix:** Use `point.lat` (or midpoint `(point.lat + newLat) / 2`) for the cosine term instead of `newLat`.

---

### C3 — Seed latitude/longitude validation rejects valid 0° values — **BUG-92**

**File:** `src/index.ts:300`

```typescript
if (!start?.lat || !start?.lon || !end?.lat || !end?.lon || !departureTime)
```

Rejects the valid coordinate `lat: 0` (equator) and `lon: 0` (prime meridian) because they are falsy.

**Fix:** Change to `typeof start?.lat !== 'number'` or explicit `isNaN` checks.

---

### C4 — Widespread `as any` casts for `gdal-async` API calls

**File:** `src/lib/grib.ts:156,182,190,255,256,277,418,419`

Eight or more `as any` casts for every GDAL interaction (`(gdal.vsimem as any).copy`, `(band.pixels as any).readAsync`, etc.). The `gdal-async` library has incomplete or absent type definitions, so the entire GRIB data loading path relies on unchecked runtime types.

**Fix:** Create thin typed wrapper functions around the GDAL operations (e.g. `readBandPixels(band, nLon, nLat): Promise<Float32Array>`, `copyToVsimem(data, path): void`) to centralise the `any` escapes.

---

### C5 — Silent GRIB file load failures during calculation — **BUG-95**

**File:** `src/index.ts:379-387`

When a GRIB file fails to load during calculation, `console.warn` is called but the entry is simply skipped. If some files succeed and some fail, the route is calculated with a subset of files and the user sees no indication of partial failure. Failed files are not tracked in `gribFailedFiles` (that list is only populated during `scanAndIndexGribDir`).

**Fix:** Track calculation-time load failures in a separate list and include them in the response warning or status.

---

## Major

### M1 — SignalK `app` object typed as `any` everywhere

**Files:** `src/index.ts:27`, `src/lib/resources.ts:6`, `src/lib/setup.ts:15`

The SignalK plugin framework's `app` object is typed as `any` everywhere it is passed around. All `app.setPluginStatus`, `app.setPluginError`, `app.debug` calls are completely unchecked.

**Fix:** Define a minimal interface for the SignalK app object subset used by this plugin.

---

### M2 — `console.log` for step timing on hot path without debug guard — **BUG-96**

**File:** `src/lib/routing/isochrone.ts:41-48,63`

The `logStepTiming` and `logTimingSummary` functions use `console.log` for every isochrone step. Project rules require `debug.enabled &&` guards to avoid eager string allocation. These run on the hot path.

**Fix:** Wrap timing logging with `debug.enabled &&` guards or move to an opt-in debug mode.

---

### M3 — `console.warn` instead of `app.setPluginError` for GRIB load failure

**File:** `src/index.ts:384`

`console.warn` is used to log a GRIB file load failure. In the SignalK server context this log may not be visible to the end user.

**Fix:** Use `app.debug` or a dedicated status update mechanism.

---

### M4 — `new Function(...)` for ESM import in dilate script

**File:** `src/lib/dilate.ts:7`

Uses `new Function('s', 'return import(s)')` to dynamically import ESM-only jsts modules from a CJS module. This bypasses CSP and is flagged by security scanners. Workaround for CJS/ESM mismatch.

**Fix:** Investigate whether jsts provides a CJS-compatible entry point. If not, document explicitly that this is a build-time-only workaround.

---

### M5 — `bracketIndex` uses O(n) linear scan on hot path

**File:** `src/lib/polar.ts:66-73`

`bracketIndex` performs a linear scan to find the bracket index for TWA and TWS. Called once per candidate per heading per frontier point. Arrays are sorted — binary search would be faster.

**Fix:** Replace with binary search.

---

### M6 — Optional chaining on polar speed lookups on every hot-path call — **BUG-97**

**File:** `src/lib/polar.ts:53-56`

```typescript
polar.speeds[twaIdx]?.[twsIdx] ?? 0
```

Uses optional chaining and nullish coalescing on every access. If the polar data is valid (guaranteed by `parsePolar`), these runtime checks are dead overhead.

**Fix:** Access with direct indexing after parse-time shape validation.

---

### M7 — `Math.PI / 180` inlined ~10 times, named constant unused

**Files:** `src/lib/geo.ts:6-7,18-20,33-35`, `src/lib/routing/isochrone.ts:25,380`

`Math.PI / 180` appears at least 10 times across the codebase. A `DEG_TO_RAD` constant exists in `isochrone.ts` but is only used once. Other modules inline the calculation.

**Fix:** Export a `DEG_TO_RAD` constant from `geo.ts` and use it everywhere.

---

### M8 — `setImmediate` yield on every isochrone step

**File:** `src/lib/routing/isochrone.ts:321`

`await new Promise<void>((resolve) => setImmediate(resolve))` is called at the end of every isochrone step to flush SSE events. On a 50-step route this adds ~50 event-loop yields.

**Fix:** Measure and consider emitting SSE progress every N steps if routing is slower than desired.

---

## Minor

### m1 — Inconsistent `import * as fs` style

**Files:** Throughout codebase

Mixed use of `'node:fs'` / `'fs'` for the same module. Sync and async `fs` used inconsistently — `parsePolar` uses `readFileSync` in what is otherwise an async context.

**Fix:** Standardise on `import * as fs from 'node:fs'` and `import * as fsp from 'node:fs/promises'`. Use `fsp.readFile` in `parsePolar`.

---

### m2 — `nTimes` field in `GribFileMeta` never read

**File:** `src/types.ts:27`

`nTimes: number` is computed in `readGribMeta` but never referenced anywhere in the codebase.

**Fix:** Remove it or use it (e.g. for progress estimation in the UI).

---

### m3 — Same `closestPoint` reduce pattern repeated 3×

**File:** `src/lib/routing/isochrone.ts:288-290,329-331,338-341`

The `reduce` pattern for finding the closest frontier point to the destination appears three times.

**Fix:** Extract `function closestTo(target: LatLon, points: IsochronePoint[]): IsochronePoint`.

---

### m4 — `pruneToFrontier` inlines `Math.PI / 180` while `DEG_TO_RAD` in file scope

**File:** `src/lib/routing/isochrone.ts:380`

`DEG_TO_RAD` is defined on line 25 of the same file but `pruneToFrontier` uses inline `Math.PI / 180`.

**Fix:** Use the file-level constant.

---

### m5 — Test file uses sync fs without crash-safe cleanup

**File:** `src/lib/__tests__/polar.test.ts:3,23-24,108`

Uses `writeFileSync` and `unlinkSync`. A test crash before cleanup leaves a stale temp file.

**Fix:** Use `fs.mkdtemp` + `fs.rm` patterns (as done in `windprovider.test.ts`) for safer temp file management.

---

### m6 — Rejection counters not included in error messages

**File:** `src/lib/routing/isochrone.ts:266-286`

Counters for land/wind/GRIB rejections are computed but only used for the ternary `FailureReason` decision. Their numeric values would aid diagnostics.

**Fix:** Include rejection counts in the failure message, e.g. `"(land: 120, wind: 45, grib-exhausted: 30)"`.

---

## Architecture Observations

### Well-architected
- Provider pattern for wind and current (`WindProvider`, `CurrentProvider`) isolates the routing algorithm from file management
- Two-level land index (1° grid for point-in-polygon, 0.1° edge tiles for segment crossing) for hot-path performance
- Clean `RoutingAlgorithm` interface — trivial to add new strategies
- Lazy GRIB loading: metadata scanned at startup, grid data loaded only at calculation time

### Could improve
- `src/index.ts` is 782 lines — route handlers (`.post('/calculate')`, `.get('/wind-grid')`, etc.) could be extracted into `src/lib/api.ts`
- The SignalK `module.exports = (app: any) => { ... }` closure pattern forces `index.ts` into one big function, limiting testability
- Error handling is repetitive — try/catch blocks in the calculation route mix business logic, error handling, and SSE management

---

## Convention Compliance

| Rule | Status |
|---|---|
| File header comments | Present in all 22 `.ts` files |
| `any` avoidance | 19 uses — goal is "avoid `any`" |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| TODO / FIXME / HACK | 0 |
| `console.log` in source code | 6 locations (should use `app.debug`) |
| `debug.enabled` guard pattern | 0 — not yet applied |
| `for...of` over `.forEach` | 1 `.forEach` in test (acceptable) |
| TypeScript strict mode | Enabled |

---

## Priority Proposal

**P0 — Fix before next release (safety/correctness bugs)**

| # | Bug | Reason |
|---|---|---|
| **C3** | BUG-92 | `!start?.lat` rejects valid 0° coordinates — real bug: equator/prime meridian positions silently fail |
| **C1** | BUG-93 | `selectFile` silent fallback returns wrong-file data — Nautical Safety Rule violation |
| **C2** | BUG-94 | Current drift uses wrong latitude — incorrect geodetic calculation, though small magnitude |

**P1 — Important (reliability + hot-path perf)**

| # | Bug | Reason |
|---|---|---|
| **C5** | BUG-95 | Partial GRIB load failures invisible to user |
| **M2** | BUG-96 | `console.log` on hot path without `debug.enabled` guard — perf loss + rule violation |
| **M6** | BUG-97 | Optional chaining on every polar lookup — unnecessary overhead post-validation |

**P2 — Code quality / maintainability**

| # | Reason |
|---|---|
| **C4** | Centralise `gdal-async` `as any` in typed wrappers — prevents future runtime surprises |
| **M1** | Type the SignalK `app` object — catches signature mismatches at compile time |
| **M5** | Binary search for `bracketIndex` — trivial win on hot path |
| **M7** | Deduplicate `DEG_TO_RAD` — DRY, trivial |
| **M8** | Batching `setImmediate` yields — measure first, fix if slow |

**P3 — Polish (low impact, quick wins)**

| # | Reason |
|---|---|
| **M3** | `console.warn` → `app.debug` |
| **M4** | `new Function` ESM workaround — build-time only, not on request path |
| **m1–m6** | All minor items — style, dead code, test robustness |
