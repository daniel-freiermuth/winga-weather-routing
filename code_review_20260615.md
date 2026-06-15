# Code Review — 2026-06-15 (Combined)

Combined review of the signalk-weather-routing codebase, merging the 2026-06-14 and 2026-06-15 passes. Each prior finding has been re-verified against the current code (`main`, commit `a3088f1`).

**Scope:** 15 TypeScript source files, 1 HTML frontend (2,766 lines), 8 test files. Total 6,198 lines.

---

## Validity Assessment of Prior Findings (2026-06-14)

All 18 prior findings were re-checked against the current code. **17 are confirmed valid; 1 is reclassified.** None have been fixed.

| Prior ID | Bug/Issue | Verdict | Notes |
|---|---|---|---|
| C1 / BUG-93 | `selectFile` silent fallback | **Valid — confirmed** | `windprovider.ts:37-49` unchanged. The isochrone loop guards candidates with `coversPointAtTime`, but `getWind()` is called on the *parent* point before the candidate is generated — the parent's coverage at the current time step is not checked. Safety concern is real. |
| C2 / BUG-94 | Current drift wrong latitude | **Valid — confirmed** | `isochrone.ts:241` unchanged. `newLat` used in cosine instead of `point.lat`. Small error but logically incorrect. |
| C3 / BUG-92 | Seed lat/lon rejects 0° | **Valid — confirmed** | `index.ts:347` unchanged. `!start?.lat` rejects `lat: 0`. Low real-world probability (Baltic-focused plugin) but technically a bug. |
| C4 | `as any` for gdal-async | **Valid — confirmed** | 8 casts in `grib.ts:156,182,190,255,256,277,418,419`. |
| C5 / BUG-95 | Silent GRIB load failure | **Valid — confirmed** | `index.ts:431` unchanged. `console.warn` + skip; user sees no indication. |
| M1 | `app` typed as `any` | **Valid — confirmed** | `index.ts:28` — `module.exports = (app: any)`. Also `resources.ts:6`, `setup.ts:15`. |
| M2 / BUG-96 | `console.log` on hot path | **Valid — confirmed** | `isochrone.ts:42,64` — `logStepTiming` / `logTimingSummary` unguarded. |
| M3 | `console.warn` for GRIB failure | **Valid — confirmed** | `index.ts:431`. Same line as C5. |
| M4 | `new Function` ESM workaround | **Reclassified** | See below. |
| M5 | `bracketIndex` O(n) scan | **Valid — low impact** | `polar.ts:66-73`. Arrays are 6–12 elements; binary search overhead may exceed linear scan at this size. Technically correct but negligible benefit. |
| M6 / BUG-97 | Optional chaining overhead | **Valid — confirmed** | `polar.ts:53-56`. Four `?.` + `??` on every bilinear interpolation. |
| M7 | `DEG_TO_RAD` duplication | **Valid — confirmed** | `geo.ts` has ~10 inline `Math.PI / 180`. `DEG_TO_RAD` exists in `isochrone.ts:26` but `geo.ts` doesn't import it. |
| M8 | `setImmediate` per step | **Valid — by design** | `isochrone.ts:338`. The yield is required to flush SSE events to the browser. Removing it breaks progressive rendering. Not a bug; at most a tuning candidate if routing is too slow. |
| m1 | Inconsistent `import * as fs` | **Valid — confirmed** | `polar.ts:3` uses `'fs'`; `setup.ts:4` also uses `'fs'`; rest of codebase uses `'node:fs'`. |
| m2 | `nTimes` never read | **Valid — confirmed** | `types.ts:26` field, `grib.ts:81` assignment, no runtime reads. Only test fixtures populate it. |
| m3 | `closestPoint` reduce 3× | **Valid — partially** | Two live instances (`isochrone.ts:305-307`, `346-348`) + one dead instance (355-358, see Nm1). |
| m4 | `pruneToFrontier` inlines `Math.PI/180` | **Valid — confirmed** | `isochrone.ts:397` inlines while `DEG_TO_RAD` sits at line 26 of the same file. |
| m5 | Test sync fs cleanup | **Valid — confirmed** | `polar.test.ts:3,23,108` — `writeFileSync` / `unlinkSync`. |
| m6 | Rejection counts not in error msg | **Valid — confirmed** | `isochrone.ts:283-285` computes counters; `294-317` uses only the ternary decision. |

### M4 — Reclassified: `dilate.ts` is dead code

**Prior assessment:** `new Function('s', 'return import(s)')` in `dilate.ts:7` bypasses CSP and is flagged by security scanners. Workaround for CJS/ESM mismatch.

**Current assessment:** `dilate.ts` is **not imported by any runtime code**. The runtime dilation worker was removed in BUG-29 / REQ-51. Dilation is now handled by the Python build script (`scripts/prepare-land-data.py:295`). `dilate.ts` is only imported by `dilate.test.ts`. The comment at `dilate.ts:95` ("called only from the pre-build script and from setup.ts") is **stale** — setup.ts does not import it.

**Revised finding:** The `new Function` is no longer a runtime concern. The file is dead code with a stale comment. Either delete it (the Python script + the test are the only consumers) or explicitly mark it as test-only and correct the comment. Downgraded from Major to Minor.

---

## New Findings (2026-06-15)

### Critical

#### NC1 — `/avoid-regions` PUT validation bypass when no regions are loaded

**File:** `src/index.ts:841`

```typescript
const filtered = ids.filter(id => valid.has(id) || !valid.size);
```

When the SignalK resources API returns no regions (or is temporarily unavailable), `valid` is an empty `Set` (`valid.size === 0`). The expression `!valid.size` evaluates to `true`, so the filter accepts **every** UUID — including garbage, stale, or malformed strings. The validation is intended to reject unknown UUIDs, but it silently accepts everything when the region index is empty.

If SignalK's resources API is temporarily unavailable when the user toggles a region avoidance checkbox, arbitrary identifiers are persisted to plugin config. They will never match any region, so the user believes they've configured avoidance when they haven't.

**Fix:** When `valid.size === 0`, reject all IDs (return 400 with "no regions available") or accept them but log a warning. Do not silently persist unvalidated input.

---

#### NC2 — Waypoint GRIB coverage check gated on land avoidance

**File:** `src/index.ts:408-420`

```typescript
if (useLandAvoidance && activeIndex) {
  for (let i = 0; i < waypoints.length; i++) {
    // ... isPointOnLand check ...
    // ... GRIB coverage check ...
  }
}
```

The start point is **always** checked for GRIB coverage (line 397-405), regardless of land avoidance. But waypoint GRIB coverage is only validated when `useLandAvoidance && activeIndex`. If a user disables land avoidance (or if the land index fails to load), waypoints outside GRIB coverage pass validation silently. The route then fails mid-calculation when the isochrone frontier exits the GRIB domain — producing a confusing "frontier reached GRIB boundary" error instead of a clear pre-flight message naming the offending waypoint.

GRIB coverage is independent of land avoidance. The coverage check should not be nested inside the land-avoidance guard.

**Fix:** Move the waypoint GRIB coverage check (lines 413-419) outside the `if (useLandAvoidance && activeIndex)` block. Keep the `isPointOnLand` check inside it.

---

### Major

#### NM1 — `getWave` duplicates the BUG-93 three-level fallback pattern

**File:** `src/lib/windprovider.ts:64-71`

```typescript
const f =
  waveFiles.find(e =>
    coversPoint(e, lat, lon) &&
    e.meta.timeStart.getTime() <= tMs &&
    e.meta.timeEnd.getTime() >= tMs
  ) ??
  waveFiles.find(e => coversPoint(e, lat, lon)) ??   // spatial only — ignores time
  waveFiles[0];                                       // first file — ignores both
```

Identical pattern to C1/BUG-93 but for wave data. If no wave file matches both spatial and temporal constraints, it falls back to spatial-only, then to the first wave file. Wave height data from the wrong time period could be used for the `maxWaveM` routing constraint (`isochrone.ts:178-181`), causing the router to accept or reject candidates based on incorrect wave conditions. **Nautical Safety Rule** concern — same class as BUG-93.

**Fix:** Remove the second and third fallback levels. Return `undefined` if no file matches both spatial and temporal constraints.

---

#### NM2 — `buildRegionIndex` MultiPolygon key generation is inconsistent and fragile

**File:** `src/lib/regions.ts:52`

```typescript
const key = regions.size > 0 ? `${id}__${regions.size}` : id;
```

The first ring of the first region inserted gets key `id` (no suffix). All subsequent rings get `id__N` where N is the global `regions.size` counter — not a per-region ring index. Example for three regions where B is a MultiPolygon with 2 rings:

| Region | Ring | `regions.size` at insert | Key |
|---|---|---|---|
| A (single ring) | 0 | 0 | `A` |
| B (multi ring) | 0 | 1 | `B__1` |
| B (multi ring) | 1 | 2 | `B__2` |
| C (single ring) | 0 | 3 | `C__3` |

The UUID extraction in `segmentCrossesRegion`, `isPointInRegion`, and `validRegionUuids` uses `key.split('__')[0]`, which works today. But the key format is inconsistent: the first ring of the first region has no `__` suffix while later single-ring regions do (`C__3`). A future developer modifying this code could easily introduce a bug.

**Fix:** Always use a per-UUID ring counter, or always use the `id__ringIndex` format consistently (including `A__0` for the first ring).

---

#### NM3 — Invalid `departureTime` produces misleading error

**File:** `src/index.ts:375,381-383`

```typescript
const departureMs = new Date(departureTime).getTime();
// ...
const selectedEntries = gribFiles.filter(f =>
  f.meta.timeEnd.getTime() >= departureMs && ...
);
if (selectedEntries.length === 0) {
  return void res.status(400).json({ error: 'No GRIB files cover the requested departure time' });
}
```

If `departureTime` is a non-empty but invalid string (e.g. `"garbage"`), `new Date("garbage").getTime()` returns `NaN`. The filter `f.meta.timeEnd.getTime() >= NaN` is always `false`, so `selectedEntries` is empty. The user sees "No GRIB files cover the requested departure time" — misleading. The actual problem is that the departure time is not a valid date.

**Fix:** Add `if (isNaN(departureMs)) return void res.status(400).json({ error: 'Invalid departureTime — expected ISO 8601' });` after line 375.

---

#### NM4 — `loadRegions` auto-clean fires `savePluginConfig` without awaiting

**File:** `src/index.ts:142`

```typescript
try { app.savePluginConfig?.(); } catch { /* not critical */ }
```

`app.savePluginConfig()` returns a Promise. It is called without `await` inside a synchronous try/catch. If the Promise rejects, the rejection is unhandled (the try/catch catches synchronous throws, not async rejections). Additionally, fire-and-forget config saves can race with other config writes — the `/avoid-regions` PUT handler at line 844 also calls `app.savePluginConfig()`. If both fire concurrently, the last write wins and config could be silently lost.

**Fix:** Make `loadRegions` await the save, or move the auto-clean to a dedicated synchronisation point that cannot race with PUT handlers.

---

#### NM5 — `getWaveAt` doesn't validate lat/lon bounds before bilinear interpolation

**File:** `src/lib/grib.ts:296-310`

```typescript
export function getWaveAt(grib: GribData, lat: number, lon: number, timeMs: number): number | undefined {
  // ... finds nearest time ...
  const v = bilinear(grib.swhByTime.get(bestMs)!, gridParams, lat, lon);
  return v >= 100 ? undefined : v;
}
```

`bilinear` (line 320) silently clamps out-of-domain coordinates to edge values via `Math.max(0, Math.min(grib.nLat - 2, ...))`. Wind lookups are guarded by `coversPointAtTime` in the isochrone loop, but wave lookups (used for the `maxWaveM` comfort constraint at `isochrone.ts:179`) have no bounds check. A frontier point just outside the wave GRIB coverage gets clamped edge-wave values rather than `undefined`, potentially allowing or rejecting candidates based on wrong wave data.

**Fix:** Check lat/lon against the wave grid bounds before calling `bilinear`, return `undefined` if outside.

---

#### NM6 — New `console.log` calls for SSE debugging

**File:** `src/index.ts:518,524,528`

```typescript
console.log(`[calculation-stream] connection received at ${Date.now()}`);
console.log(`[calculation-stream] headers flushed at ${Date.now()}`);
console.log(`[calculation-stream] client closed at ${Date.now()}`);
```

Three `console.log` calls added during BUG-8/BUG-11 SSE debugging. Not present in the prior review. Same class of issue as prior M2/M3 — unguarded `console.log` that should use `app.debug`. These run on every SSE connection (once per page load or calculation), not on the isochrone hot path, so the performance impact is negligible. But they violate the project convention and clutter the SignalK server log.

**Fix:** Replace with `app.debug(...)` or remove (the SSE hang they were debugging is resolved).

---

### Minor

#### Nm1 — Dead code: unreachable `reduce` on empty `isochrone` array

**File:** `src/lib/routing/isochrone.ts:343-360`

```typescript
if (!arrived) {
  if (isochrone.length > 0) {
    // ... returns partial route ...
  }
  // Reached only when isochrone.length === 0:
  const closest = isochrone.reduce((best, p) => ..., isochrone[0]);
  // closest is always undefined here (reduce on empty array with undefined initial)
  const dist = closest ? Math.round(...) : 0;
  throw new RoutingError(`... closest approach: ${dist} nm ...`, 'grib_exhausted');
}
```

The `reduce` at line 355 is only reached when `isochrone.length === 0` (the `if` at line 344 returns otherwise). On an empty array, `reduce` with `undefined` initial value returns `undefined`. The subsequent ternary `closest ? ... : 0` handles it, so `dist` is always `0`. The `reduce` call is dead code — `closest` is always `undefined` and `dist` is always `0`.

**Fix:** Remove the reduce; throw directly with "no frontier remaining" (dist=0 is misleading — it implies the boat was at the destination).

---

#### Nm2 — Redundant double coverage check in `/wave-grid`

**File:** `src/index.ts:656-667`

Two consecutive `loaded.some(...)` checks with nearly identical conditions. The second adds `f.data?.swhByTime?.size` but repeats all spatial/temporal conditions from the first. The first is a pure early-exit but adds code duplication.

**Fix:** Merge into a single check that tests all conditions including `swhByTime?.size`.

---

#### Nm3 — Grid iteration logic duplicated 3×

**Files:** `src/index.ts:601-615` (`/wind-grid`), `651-673` (`/wave-grid`), `696-704` (`/current-grid`)

The same lat/lon nested loop with per-point coverage checking appears three times with minor variations. Each computes `nLat`, `nLon`, iterates `i`/`j`, checks coverage, and formats coordinates.

**Fix:** Extract a shared `iterateGridPoints(loaded, latMin, latMax, lonMin, lonMax, latStep, lonStep, timeMs, callback)` helper.

---

#### Nm4 — `loadRegions` mutates plugin config during a read operation

**File:** `src/index.ts:137-144`

`loadRegions()` is called from `start()`, `/calculate`, `/reload-grib`, and `/avoid-regions` PUT. It auto-cleans stale UUIDs from settings and persists config as a side effect. A read operation (loading regions for routing or display) silently rewrites the plugin config file. If the auto-clean logic has a bug, it could corrupt config on every region load.

**Fix:** Separate the read (load region index) from the write (clean stale IDs). Perform auto-clean only at `start()` or on explicit user action.

---

#### Nm5 — Frontend `innerHTML` with unescaped external data

**File:** `public/index.html:861,905,935,1097,1126,1207,1274,1327,2750`

Multiple `innerHTML` assignments insert data from external sources without HTML escaping:

| Line | Source | Data |
|---|---|---|
| 861 | SignalK charts API | Chart names (`c.name`) |
| 905, 935 | SignalK resources API | Route/waypoint names |
| 1097 | Backend `/grib-info` | `gribDir` path |
| 1126 | Backend `/grib-info` | GRIB file metadata |
| 1327 | SignalK resources API | Region names |
| 2750 | Route waypoint data | Tooltip content |

In a local-network SignalK deployment the risk is low (data comes from the trusted local server). But if SignalK is exposed to untrusted networks, a malicious chart name or region name containing `<script>` would execute in the browser. The frontend already uses `textContent` in 29 other locations — these `innerHTML` cases are the exception.

**Fix:** Use `textContent` for dynamic strings, or add an `escapeHtml()` helper.

---

#### Nm6 — `dilate.ts` is dead code with stale comment (reclassified from prior M4)

**File:** `src/lib/dilate.ts`

`dilateAndMergePolygons` is exported but **not imported by any runtime code**. The runtime dilation worker was removed (BUG-29 / REQ-51); dilation is now done by the Python build script (`scripts/prepare-land-data.py`). The only consumer is `dilate.test.ts`. The comment at line 95 ("called only from the pre-build script and from setup.ts") is stale — setup.ts does not import it.

**Fix:** Delete the file, or update the comment to reflect its test-only status.

---

## Architecture Observations

### Well-architected (confirmed from prior review)
- Provider pattern for wind and current isolates the routing algorithm from file management
- Two-level land index (1° grid for point-in-polygon, 0.1° edge tiles for segment crossing) for hot-path performance
- Clean `RoutingAlgorithm` interface — trivial to add new strategies
- Lazy GRIB loading: metadata scanned at startup, grid data loaded only at calculation time

### New positive observations
- Region avoidance (REQ-98): `RegionIndex` reuses `pointInRing` / `segmentCrossesRing` from `landmask.ts` — no geometry code duplication
- `Float64Array` ring storage in `RegionRing` matches `LandPolygon` layout — consistent memory model
- Avoided regions checked in the isochrone hot path alongside land checks — no separate pass needed

### Concerns (updated)
- `src/index.ts` has grown to **867 lines** (was 782 in prior review). The REQ-98 endpoints (`/avoid-regions`, `/region-index`) and the `/calculate` waypoint loop add further bulk. Extracting route handlers into `src/lib/api.ts` is now more urgent.
- `loadRegions()` is called from 4 code paths (`start`, `/calculate`, `/reload-grib`, `/avoid-regions`), each with different post-load side effects (auto-clean, setReady). Cohesion problem.
- The `app` object is passed as `any` to `resources.ts`, `setup.ts`, and used inline throughout `index.ts`. All `app.setPluginStatus`, `app.setPluginError`, `app.debug`, `app.savePluginConfig`, `app.resourcesApi` calls are completely unchecked.

---

## Convention Compliance

| Rule | Prior (06-14) | Current (06-15) | Delta |
|---|---|---|---|
| File header comments | 22/22 `.ts` files | 15/15 `.ts` files + `regions.ts` | New file compliant |
| `any` usage | 19 | 20 | +1 (`regions.ts:20`) |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0 | — |
| TODO / FIXME / HACK | 0 | 0 | — |
| `console.log` in source | 6 | 9 | +3 (SSE debugging, `index.ts`) |
| `debug.enabled` guards | 0 | 0 | — |
| `for...of` over `.forEach` | 1 `.forEach` in test | 1 `.forEach` in test | — |
| TypeScript strict mode | Enabled | Enabled | — |

---

## Combined Priority Proposal

All findings from both reviews, merged and re-prioritised.

### P0 — Fix before next release (safety / correctness)

| # | ID | Type | Reason |
|---|---|---|---|
| 1 | C3 / BUG-92 | Prior | `!start?.lat` rejects valid 0° coordinates — silently fails for equator/prime meridian |
| 2 | C1 / BUG-93 | Prior | `selectFile` silent fallback returns wrong-file wind data — Nautical Safety Rule violation |
| 3 | NM1 | New | `getWave` same fallback pattern as BUG-93 — wrong wave data for `maxWaveM` constraint |
| 4 | NC1 | New | `/avoid-regions` validation accepts all UUIDs when no regions loaded — silent config corruption |
| 5 | NC2 | New | Waypoint GRIB coverage skipped when land avoidance off — confusing mid-route failure |
| 6 | NM3 | New | Invalid `departureTime` produces misleading "No GRIB files cover" error |
| 7 | C5 / BUG-95 | Prior | Partial GRIB load failures invisible to user — route calculated on subset |

### P1 — Important (reliability + correctness)

| # | ID | Type | Reason |
|---|---|---|---|
| 8 | C2 / BUG-94 | Prior | Current drift uses wrong latitude for cosine correction |
| 9 | NM5 | New | `getWaveAt` no bounds check — silently clamps to edge wave values |
| 10 | NM4 | New | `savePluginConfig` fire-and-forget — unhandled rejection + race with PUT handler |
| 11 | M2 / BUG-96 | Prior | `console.log` on isochrone hot path without `debug.enabled` guard |
| 12 | M6 / BUG-97 | Prior | Optional chaining on every polar lookup — dead overhead post-validation |
| 13 | M3 | Prior | `console.warn` for GRIB failure instead of `app.debug` |

### P2 — Code quality / maintainability

| # | ID | Type | Reason |
|---|---|---|---|
| 14 | C4 | Prior | Centralise gdal-async `as any` in typed wrappers |
| 15 | M1 | Prior | Type the SignalK `app` object — catches signature mismatches at compile time |
| 16 | NM2 | New | `buildRegionIndex` key generation — fragile and inconsistent |
| 17 | M7 | Prior | Deduplicate `DEG_TO_RAD` — DRY |
| 18 | M5 | Prior | Binary search for `bracketIndex` — low impact (arrays are 6–12 elements) |
| 19 | NM6 | New | Remove SSE `console.log` debugging calls |
| 20 | M8 | Prior | `setImmediate` per step — by design (SSE flush), tuning candidate only |

### P3 — Polish (low impact, quick wins)

| # | ID | Type | Reason |
|---|---|---|---|
| 21 | Nm1 | New | Dead `reduce` code in isochrone failure path |
| 22 | Nm2 | New | Redundant double coverage check in `/wave-grid` |
| 23 | Nm3 | New | Grid iteration logic duplicated 3× |
| 24 | Nm4 | New | `loadRegions` config mutation side effect on read |
| 25 | Nm5 | New | Frontend `innerHTML` with unescaped data (9 locations) |
| 26 | Nm6 / M4 | Reclass. | `dilate.ts` dead code with stale comment |
| 27 | m1 | Prior | Inconsistent `import * as fs` style |
| 28 | m2 | Prior | `nTimes` field never read |
| 29 | m3 | Prior | `closestPoint` reduce repeated (2 live + 1 dead instance) |
| 30 | m4 | Prior | `pruneToFrontier` inlines `Math.PI / 180` |
| 31 | m5 | Prior | Test sync fs without crash-safe cleanup |
| 32 | m6 | Prior | Rejection counts not included in error messages |

---

## Summary Statistics

| Category | Prior (06-14) | New (06-15) | Combined |
|---|---|---|---|
| Critical | 5 (C1–C5) | 2 (NC1–NC2) | 7 |
| Major | 8 (M1–M8) | 6 (NM1–NM6) | 14 |
| Minor | 6 (m1–m6) | 6 (Nm1–Nm6, incl. reclassified M4) | 11 |
| **Total** | **19** | **14** | **32** |

Prior findings fixed since 06-14: **0 of 19**.
Prior findings reclassified: **1** (M4 → Nm6, dead code).
New findings in REQ-98 region avoidance code: **5** (NC1, NC2, NM2, NM4, Nm4).
