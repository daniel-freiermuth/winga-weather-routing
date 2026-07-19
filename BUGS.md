# Known Bugs

## Open Bugs

| # | Description |
|---|---|
| [BUG-135](https://github.com/kristianwiklund/signalk-weather-routing/issues/370) | Multiple ocean-current GRIBs are mishandled when more than one is loaded. Observed with 3 norkyst800m current GRIBs: clicking any ocean-current row in the Grib Manager toggles all of them; no currents are visible in the current display; no bounding-box rectangles are drawn for the new (non-first) current GRIBs. Surfaced during REQ-139 upload testing. |
| [BUG-127](https://github.com/kristianwiklund/signalk-weather-routing/issues/333) | Wave overlay exhibits state corruption when scrubbing: shows data for periods/regions without wave coverage; once overlay disappears it doesn't recover when moving back to covered time periods; behavior is semi-random; possibly triggered by moving scrubber during active routing. All frontend overlay state management issues. |
| [BUG-120](https://github.com/kristianwiklund/signalk-weather-routing/issues/323) | `nTimes: number` field in `GribFileMeta` is computed in `readGribMeta` but never referenced anywhere at runtime. Only test fixtures populate it. Discovered in code review 2026-06-14 (m2). |

| [BUG-86](https://github.com/kristianwiklund/signalk-weather-routing/issues/264) | The ocean current GRIB support (REQ-91) has not been tested with an actual tidal current GRIB. Testing was done with BSH and RTOFS ocean current GRIBs only. It is unknown whether tidal current GRIB products (which may use different WMO parameter names or depth-level conventions) are compatible with the current implementation. |

## Won't Fix

| # | Description | Reason |
|---|---|---|
| [BUG-112](https://github.com/kristianwiklund/signalk-weather-routing/issues/315) | `setImmediate` yield on every isochrone step. | By design — required to flush SSE progress events to the browser. Removing breaks progressive rendering. Not a bug; at most a tuning candidate if routing is too slow. |
| [BUG-109](https://github.com/kristianwiklund/signalk-weather-routing/issues/312) | `bracketIndex` performs O(n) linear scan on sorted arrays. | Arrays are 6–12 elements. Binary search overhead exceeds linear scan at this size on V8. Negligible practical benefit. |
| [BUG-122](https://github.com/kristianwiklund/signalk-weather-routing/issues/325) | `pruneToFrontier` inlines `Math.PI / 180`. | Duplicate of BUG-110 — fixed when `DEG_TO_RAD` was exported from `geo.ts` and all inline uses replaced. |
| [BUG-120](https://github.com/kristianwiklund/signalk-weather-routing/issues/323) | `nTimes` field in GribFileMeta never read. | Invalid — the field IS read by the frontend (`public/index.html:1144` sidebar display, `:1909-1913` scrubber time axis reconstruction). The code review only checked backend code. |
| [BUG-91](https://github.com/kristianwiklund/signalk-weather-routing/issues/286) | Loading indicator does not appear on GUI startup. | Opencode closed it as a mistake — the underlying issue is tracked under reopened REQ-121. |

## Fixed Bugs

| # | Description |
|---|---|---|
| [~~BUG-126~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/332) | ~~Wave height constant low in conditions graph on Gothenburg test.~~ — **cannot recreate** (investigation showed wave grid cells near the Stockholm archipelago and Kattegat coast contain 9999 fill values; bilinear interpolation near these cells exceeds the `>=100` threshold and returns `undefined`; the few waypoints with valid wave data are in sheltered waters with genuinely low heights (~0.5 m); compared with old screenshots and confirmed plausible; confirmed 2026-06-15) |
| [~~BUG-80~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/242) | ~~Test buttons visible on clean install despite `hideTestButtons: true` default.~~ — **cannot reproduce** (likely a side-effect of the missing gdal binary; not reproducible after BUG-79 fixed in v0.7.3; confirmed 2026-06-13) |
| [~~BUG-78~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/240) | ~~README missing on npm registry for v0.7.0.~~ — **not needed** (propagation delay; README appeared within minutes of publish; confirmed 2026-06-13) |
| [~~BUG-70~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/211) | ~~Route calculation changed after REQ-99 deployment.~~ — **not a REQ-99 bug** (caused by the BUG-58 fix being present on main at the time; routing was correct once BUG-58 fix was reverted in commit `6575ad8`; confirmed 2026-06-13) |
| [~~BUG-69~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/208) | ~~Five branches appeared to have commits ahead of main with no open PRs.~~ — **not needed** (all are squash-merge relics or post-PR continuation branches whose work was incorporated into main via separate PRs; no unmerged code found; investigation exposed a squash-merge history problem — switch to regular merges going forward; confirmed 2026-06-13) |
| [~~BUG-64~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/202) | ~~Check and act on GitHub security scans (dependabot, code scanning alerts).~~ — **not needed** (`tar@7.5.9` is bundled inside gdal-async's own `bundledDependencies` via `@mapbox/node-pre-gyp`; npm `overrides` cannot reach doubly-bundled subtrees and no newer gdal-async or @mapbox/node-pre-gyp exists. The vulnerable code path — node-pre-gyp using tar to extract remote binaries — is dead code: SignalK installs with `--ignore-scripts` and the prebuilt gdal-async binary is already bundled in the tarball. Dependabot alerts #1 and #2 dismissed as `not_used`; confirmed 2026-06-12) |
| [~~BUG-66~~](https://github.com/kristianwiklund/signalk-weather-routing/issues/198) | ~~Check that the same coordinate mistakes as BUG-65 are not present in the wind overlay / weather data.~~ — **not needed** (wave troubleshooting findings confirmed the BUG-65 issues were specific to the wave canvas raster: mixed-grid only affects discipline=10 HTSGW, and Mercator-Y row spacing only applies to the canvas image overlay; wind arrows are plotted as individual markers at explicit lat/lon points and are unaffected by both issues; confirmed 2026-06-12) |

---

## BUG-69 — Investigation Notes

### Method

For each of the five branches, `git diff main...branch` was used to see what each branch added relative to its divergence point from main. Then the key identifiers from each diff were grepped against the current `main` working tree to determine whether the same code is present.

### Findings per branch

| Branch | Commits ahead | Key diff identifier | Present on main? |
|---|---|---|---|
| `fix/BUG-46-grib-domain-departure` | 1 | `coversDeparture` / "outside GRIB" error | **Yes** — `index.ts:291` has the same check, different wording |
| `fix/BUG-47-seed-point-wind-data` | 1 | `seedWind` variable name | **Yes** — `isochrone.ts:108` has `seedVec` doing the same thing |
| `feature/REQ-92-route-waypoint-routing` | 2 | `waypoints`, `routeWaypoints`, `waypointRoutes` | **Yes** — 9 matches in `index.ts`, 15 in `public/index.html` |
| `feature/REQ-96-REQ-97-scrubber-highlight` | 4 | `updateScrubberHighlight`, `wp-highlight`, `intermediateIdxs` | **Yes** — 10 matches in `public/index.html` |
| `feature/REQ-58-publish-to-appstore` | 7 | `version: 1.0.0`, `wr-icon-128px`, `route-to-route-demo` | **Yes** — version is 1.0.0, both assets in `package.json` |

### Root cause

All five branches are **squash-merge relics**. When a PR is merged with squash, GitHub creates a new commit on `main` whose content matches the branch diff but whose commit hash is unrelated to any of the original branch commits. The original branch commits therefore remain unreachable from `main` in git's DAG — making the branch appear "ahead" — even though the code is fully present on main.

`git log main..branch` counts commit objects, not code. A branch ahead by N commits does not mean N commits of missing work; it means N original commits that were squash-merged as a different commit.

### All 35 branches investigated

The same `git log main..branch` count was run across all branches. Every branch except `feature/REQ-86-grib-wind-overlay` (0 commits ahead) shows commits ahead of main:

| Commits ahead | Branch |
|---|---|
| 13 | `feature/REQ-95-graph-time-axis` |
| 10 | `fix/BUG-46-47-38-sprint4` |
| 7 | `feature/REQ-58-publish-to-appstore` |
| 6 | `sprint5` |
| 5 | `feature/REQ-80-expose-tuneables` |
| 4 | `feature/REQ-96-REQ-97-scrubber-highlight`, `feature/REQ-101-wave-overlay` |
| 3 | `fix/BUG-54-wind-overlay-density`, `fix/BUG-35-36-sprint6` |
| 2 | `fix/BUG-60-conditions-graph-axis-offset`, `fix/BUG-58-polar-light-air`, `fix/BUG-55-readme-gaps`, `fix/BUG-53-cone-distance`, `fix/BUG-50-59-conditions-graph-wave-height`, `feature/S7-A-ui-polish`, `feature/REQ-92-route-waypoint-routing`, `feature/REQ-87-wind-overlay-toggle`, `feature/REQ-82-83-84-motor-threshold-wait-for-wind`, `feature/REQ-58-npm-publish`, `feature/REQ-58-github-actions-ci`, `feature/REQ-58-appstore-prep`, `feature/REQ-100-wind-barb-redesign`, `feat/REQ-70-71-72-failure-diagnostics` |
| 1 | `fix/BUG-64-dependabot-tar`, `fix/BUG-57-motor-nogo-zone`, `fix/BUG-47-seed-point-wind-data`, `fix/BUG-46-grib-domain-departure`, `docs/add-req-93-94`, `docs/add-req-88-92` |

All are squash-merge relics. The commit counts reflect the size of the original branch before it was squash-merged into main as a single PR commit.

### Why only 5 were initially flagged

The initial selection used `git branch -vv` output. The 5 branches were selected because they showed no remote tracking branch (`[origin/...]` absent) or were ahead of their own remote tracking branch — both are surface signals of locally-modified or never-pushed work. The other 29 branches, all showing `[origin/branch: in sync]`, were not flagged even though they are equally ahead of `main`. This was an error in the investigation method: tracking-branch sync status is not the same as merge status when squash merges are in use.

### Branch post-merge evolution (feature/REQ-86-grib-wind-overlay)

GitHub's tree view shows commits made after PR #159 was merged (2026-06-08T19:58:08Z):

| Commit | Subject |
|--------|---------|
| `0bd8a46` | BUG-54: wind overlay samples at GRIB native resolution |
| `ad09b11` | REQ-87: wind overlay on/off checkbox |
| `331baaf` | docs: add REQ-88 through REQ-92 from sailing advisor review |
| `fb467f7` | docs: add REQ-93 and REQ-94 |

All four commits are present in `main` with the same hashes — incorporated via non-squash merges through separate PRs #163, #164, #170, #173. The branch tip `fb467f7` is reachable from main; `git log main..feature/REQ-86-grib-wind-overlay` returns 0 commits ahead. The branch is fully absorbed into main.

`feature/REQ-101-wave-overlay` shows the same pattern: reused for two PRs (#199 BUG-65, #201 REQ-101), with additional post-merge confirmation commits on the branch.

### Connection to squash merge

The opaque history is a direct consequence of squash merging. With squash merge, original branch commits are not in main's ancestry, so git cannot distinguish "this commit was squash-merged" from "this commit is genuinely unmerged." Regular merges preserve the commit graph — merged commits become reachable from main, and any post-merge additions to the branch are immediately visible as genuinely unmerged.

Decision: switch to regular merges (`gh pr merge --merge`) for all future PRs. CLAUDE.md updated accordingly.

### Verdict

No missing code. All stale branches are squash-merge relics or post-PR continuation branches whose work was subsequently merged via separate PRs. BUG-69 is a false alarm — the anomaly is in the git commit graph, not in the delivered code. Classification: **not needed**.

---

## BUG-68 — Investigation Notes

### Alerts

Two GitHub code scanning alerts (rule `actions/missing-workflow-permissions`, severity: warning):

| Alert | File | Message |
|---|---|---|
| #1 | `.github/workflows/ci.yml` | Workflow does not contain permissions |
| #2 | `.github/workflows/publish.yml` | Workflow does not contain permissions |

### Root cause

Neither workflow declares an explicit `permissions` block. Without one, the `GITHUB_TOKEN` is granted its default permissions — which include write access to contents, issues, PRs, and more — broader than either workflow needs.

### Required permissions

**`ci.yml`** — only checks out code and runs build/test steps; npm operations use no GitHub token at all.  
Minimum: `contents: read`

**`publish.yml`** — checks out code and publishes to npm via `NODE_AUTH_TOKEN` (an npm token, not `GITHUB_TOKEN`); GITHUB_TOKEN is not used at all by `npm publish`.  
Minimum: `contents: read`

### Fix

Add the following block at the workflow level in each file (before the `jobs:` key):

```yaml
permissions:
  contents: read
```

This is the least-privilege setting for both workflows and resolves both alerts.

---

## BUG-67 — Investigation Notes

### Package and origin

`esbuild` 0.28.0 is a transitive **dev** dependency, pulled in by `tsx@4.22.3` (the TypeScript test runner). tsx declares `"esbuild": "~0.28.0"` in its own `package.json`; that range resolves to 0.28.0 in the lockfile.

### Vulnerability (GHSA-g7r4-m6w7-qqqr)

Path traversal in esbuild's **development server** (`--servedir` mode). When requests containing backslash sequences (`..\\..\\`) are sent, `path.Clean()` (POSIX-only) fails to normalise them, allowing the server to escape the configured `servedir` root and serve arbitrary files. Fixed in esbuild 0.28.1.

**Scope: Windows only.** The bug requires the Windows filesystem to interpret `\` as a directory separator. It does not affect POSIX systems.

### Code path analysis

esbuild is invoked by tsx solely as a **bundler/transpiler backend** — it is called programmatically to transpile TypeScript on the fly. The vulnerable code path (`--servedir` HTTP server) is never started. Confirming:

- No project script invokes `esbuild` directly (verified in `package.json` scripts and `src/`).
- The plugin itself runs on Linux (Docker container, Raspberry Pi target). No Windows environment is in scope.
- `esbuild` is a `devDependency`; it is absent from the published npm package.

### Verdict

The vulnerable code path is dead: the dev server is never started, and the project never runs on Windows. Classification: **not_used**, same as BUG-64 alerts #1 and #2.

### Fix options

| Option | Action | Notes |
|---|---|---|
| A | Dismiss alert #3 as `not_used` on GitHub | No code change; alert closes |
| B | Update lockfile to esbuild 0.28.1 | `npm update esbuild` in container; tsx `~0.28.0` accepts 0.28.1; eliminates alert and keeps lockfile current |

Option B is low-risk and clears the alert permanently. Option A requires no code change.

---

## BUG-51 — Investigation Notes

### Root cause
The per-position cone (BUG-43 fix) at 100° half-angle blocks the initial eastward escape from the Roslagen/Stockholm archipelago. From frontier points near the Swedish east coast (~60.1°N), the bearing to the destination (58.5°N, 17.35°E) is ~204°. Heading due east (090°) deviates 114° from this bearing — outside the 100° cone. The boat must go east to reach open water, but the cone blocks all eastward headings. Step-by-step log shows the frontier shrinks progressively: 153 points at step 6 → 11 at step 17 → 0 at step 18 ("No reachable positions at fine-pass step 19"). All 221 candidates generated from the step-17 frontier fail the land check after being forced south into the dense archipelago with no eastward escape.

### Diagnostic test (360° cone, 2026-06-07)
Setting `FINE_PASS_CONE_HALF_ANGLE = 180` (no cone) confirmed the destination is reachable. The route succeeded but showed backward loops in the June 6 forecast: wind shifts from westerly to SSW, making the destination bearing adverse. Without a cone, the algorithm routed backward (NNE, running before the SSW wind) to maintain speed before correcting south. This is correct algorithmic behaviour in the absence of motor capability — the boat optimally exploits the following wind even at the cost of temporary backward motion. Correct real-world response: motor through the adverse section (REQ-24) or do not depart at that time.

### Connection to original coarse pass
The coarse pass solved this problem implicitly: it ran without a directional cone, exploring all bearings to find T_bound, and its omnidirectional expansion could escape any land-blocked start geometry. Without the coarse pass (REQ-69), the fine pass has no mechanism for the initial escape unless REQ-73 is implemented.

### Fix identified
REQ-73: apply the cone conditionally per frontier point. If the direct segment from the frontier point to the destination crosses land, disable the cone (360° search); if the segment is clear, apply the normal cone. This allows escape from land-blocked starting positions while preventing backward routing once the boat is in open water with a clear bearing.

### Current state (2026-06-07)
`FINE_PASS_CONE_HALF_ANGLE = 180` deployed — route reaches destination but with backward loops under adverse wind. Awaiting REQ-73 implementation.

---

## BUG-19 — Investigation Notes

### Root cause

The nearest-neighbour sort (BUG-18 fix) is a greedy algorithm — it always advances to the closest remaining unvisited point. For frontier points that form a roughly circular ring, this works well along the main arc. But when a small cluster of points is geographically isolated from the rest (e.g. points that have passed through a narrow passage, or survived land avoidance on one side), the algorithm defers them until the main arc is nearly complete, then jumps to the cluster, draws it, and the closing `pts.push(pts[0])` jumps back. This matches the reported symptom exactly.

### Fix

`startLatLon` is already in scope in the frontend JS. Frontier points form a ring around the start — they are correctly ordered by sorting on bearing from the start point (`Math.atan2`). This is O(n log n), always produces a topologically correct angular traversal, and correctly places isolated clusters at their angular position in the ring rather than deferring them to the end. The `nearestNeighbourSort` function should be replaced with a bearing-from-start sort.

---

## BUG-11 — Investigation Notes

*Investigated 2026-05-25. Environment: SignalK server 2.27.0, Docker container `signalk-server`, host networking port 3000. Plugin v0.1.0. GRIB: Baltic Centre ICON-EU 2026-05-24T00Z, 93 steps. Polar: `sunwind33.pol`. GSHHG h-res shapefile present at plugin data dir.*

### Client flow (code review)

`startCalculation()` in `public/index.html`:
1. Sets status "Connecting…", opens `EventSource` to `/calculation-stream`
2. Awaits `EventSource.onopen` before sending `POST /calculate`
3. On `onopen`: sends POST; on POST success sets status "Calculating…"
4. SSE `progress`/`done`/`error` events drive UI from there

Server (`src/index.ts`) confirmed correct: `res.flushHeaders()` on SSE connect, `pushSse()` per event, `closeSseClients()` after done/error.

### SSE delivery confirmed working in isolation

End-to-end test (SSE stream opened 2 s before POST, open-water start point `58.5°N 18.5°E`):
- SSE connected, `onopen` fired, progress events received, route completed.
- Confirmed: SSE infrastructure is not inherently broken.

### BUG-10 interaction

With start point `59.3°N 18.1°E` (Swedish mainland — confirmed inside GSHHG L1 FID 0 by OGR lookup):
- POST returns in **< 1.5 ms** (step-0 failure)
- SSE `error` event fires almost simultaneously with POST response

This led to the initial race-condition hypothesis (see below).

### Race condition — diagnosed and partially fixed

With a step-0 failure (BUG-10), the calculation fails before any `await setImmediate`. Server sequence:
1. `res.json({ status: 'calculating' })` — POST response sent
2. `.catch()` microtask: `pushSse({ type: 'error', … })` + `closeSseClients()`

Browser may receive the SSE `error` event **before** the POST response body:
1. SSE `onmessage`: `stream.close(); calcStream = null; setStatus('error', …)`
2. POST `apiFetch` resolves: falls through to `setStatus('', 'Calculating…')` — **overwrites the error**
3. Status stuck at "Calculating…"; no further SSE events; `calcStream` is null

**Fix applied:** `if (!calcStream) return;` guard before `setStatus('', 'Calculating…')` in `startCalculation` — now present in working tree. This correctly handles the race.

### Event-loop blocking — actual root cause of "Connecting…" hang

Diff of working tree vs last committed state (`1c6190d`) shows the land overlay toggle and `/land-polygons` endpoint were introduced in the same uncommitted changeset as the SSE infrastructure.

The `/land-polygons` handler calls `res.json(featureCollection)`, which runs `JSON.stringify()` synchronously. The developer's own instrumentation confirms this was known:

```
console.log(`[land-polygons] res.json() returned: ${Date.now()-t2}ms (event loop was blocked for this duration)`);
```

For a full-resolution GSHHG response over the ICON-EU domain (many thousands of polygon vertices), this serialization blocks the Node.js event loop for tens to hundreds of milliseconds. During that window, `res.flushHeaders()` on the SSE endpoint cannot execute, so the browser never receives the HTTP 200, and `onopen` never fires.

**Trigger condition:** user enables the land overlay checkbox → browser GETs `/land-polygons` → while Node.js is mid-`JSON.stringify`, user clicks Calculate → `openCalcStream()` opens `EventSource` → hung.

The `if (!calcStream) return` race-condition guard does not help here: `onopen` never fires, so `calcStream` is never set, and `startCalculation` never reaches the guard.

### Access log evidence (step-0 failure scenario)

```
POST /plugins/signalk-weather-routing/calculate   200   0.783 ms
GET  /plugins/signalk-weather-routing/calculation-stream   200   0.884 ms
GET  /plugins/signalk-weather-routing/status   200   1.071 ms
```

SSE connection closes in < 1 ms (Morgan logs on `res.end()`). Consistent with step-0 failure and immediate close.

### Fix applied to `/land-polygons` (2026-05-25)

`/land-polygons` handler in `src/index.ts` converted to `async`. Replaced `res.json(featureCollection)` with manual streaming: writes the GeoJSON FeatureCollection incrementally using `res.write()`, yielding to the event loop via `await new Promise<void>(r => setImmediate(r))` after each feature. Addresses the concurrent-loading scenario. Investigative `console.log` timing statements removed. Test added: `land-polygons serialization: exterior Float64Array converts to closed [lon,lat] GeoJSON ring`.

### Root cause re-opened (2026-05-25)

User confirmed the land overlay was fully loaded before pressing Calculate — the event loop was therefore not blocked at the time the SSE connection was opened. The concurrent-loading theory is **ruled out** for the reported scenario. The actual root cause of `onopen` never firing is not yet identified. The `/land-polygons` streaming fix is correct but does not address the bug as reported.

### Current state

- Race condition: **fixed** (`if (!calcStream) return` guard applied).
- Event-loop blocking from concurrent `/land-polygons`: **fixed** (streaming `setImmediate` yield per feature) — but this is not the trigger condition the user reproduces.
- `onopen` never fires (actual user-reported bug): **open**, likely resolved (2026-05-25) — not yet confirmed.
- BUG-10 (start on land): **open**.

---

## BUG-24 — Investigation Notes

*Investigated 2026-05-27. Environment: Node.js v24.15.0 (ABI 137), Docker container `signalk-server`. Plugin v0.1.0 at commit db36fd6.*

### Symptom in logs

All plugin API routes (`/plugins/signalk-weather-routing/*`) return 404. The webapp static files are served correctly (`/signalk-weather-routing/` → 200). The plugin does not appear in the SignalK Plugin Config UI. No error is logged for `signalk-weather-routing` at startup.

### Finding 1: plugin entry point fails to load

Requiring the plugin entry point directly inside the container:

```
node -e "require('/home/node/.signalk/node_modules/signalk-weather-routing/dist/index.js')"
```

→ `Error: Cannot find module '.../gdal-async/lib/binding/node-v137-linux-x64/gdal.node'`

The `gdal-async` native binary is entirely absent — the binding directory does not exist. This causes the plugin to throw at load time, so SignalK never registers it, which explains the 404s and the missing plugin config entry.

### Finding 2: cause of missing binary

The DEVELOPMENT.md clean install procedure uses `npm install --ignore-scripts` for the tarball installation step (step 3). This suppresses `gdal-async`'s `postinstall` hook, which is responsible for downloading or building the prebuilt native binary for the current Node.js ABI.

Previous installs worked because `gdal-async` was already present in `node_modules` with its binary intact, so npm only updated the plugin itself. After the full `npm uninstall` (which removed `gdal-async` as well), the fresh install with `--ignore-scripts` left the binding directory absent.

### Root cause

DEVELOPMENT.md step 3 (`npm install --ignore-scripts`) strips the `gdal-async` postinstall hook needed to install the native binary. The `--ignore-scripts` flag was intended to suppress the plugin's own `prepare` script, but it also suppresses dependency lifecycle scripts.

### Fix direction

Step 3 of the install procedure must allow `gdal-async`'s postinstall to run. Options:
1. Drop `--ignore-scripts` from step 3 and rely on the tarball not having a `prepare` script that causes problems.
2. Keep `--ignore-scripts` and add an explicit `npm rebuild gdal-async` step after the tarball install.

---

## BUG-25 — Investigation Notes

*Investigated 2026-05-27. Environment: Node.js v24.15.0, Docker container `signalk-server`. Plugin v0.1.0 at commit db36fd6 (after BUG-24 fix).*

### Symptom

Node process at >>100% CPU from startup. SignalK GUI unreachable. Identical symptom was present before the plugin was uninstalled (i.e. introduced by db36fd6, masked by BUG-24).

### Finding 1: union is blocking the main thread

Inspector stack trace captured while CPU was at 107%:

```
union → union → unionFull → computeOverlay → getResultGeometry → overlayOp → ...
```

This is `CascadedPolygonUnion.union()` from JSTS, running synchronously on the main thread. Thread 33 (main) shows `wchan=0` (running in user space, not blocked in a syscall). The process had accumulated >10 minutes of CPU time with no sign of completion.

### Finding 2: cache loading always fails due to alignment bug

The dilated edge index cache (`dilated-edge-index-v1.bin`, 73 MB, last written 2026-05-27 08:23) exists, and its header (magic, version, mtime) all match. However, `loadDilatedIndex` always throws:

```
Float64Array error: start offset of Float64Array should be a multiple of 8
```

The binary format writes a 36-byte bbox header per polygon (4 × f64 bbox + 1 × u32 nFloats), placing the exterior `Float64Array` at file offset 68 (32 header + 36 bbox). 68 is not a multiple of 8 → `new Float64Array(buf.buffer, 68, nFloats)` always throws a `RangeError`. The `catch {}` silently swallows it and returns `null`, so `buildDilated` falls through to the rebuild path on every startup.

The same bug is present in fa72712 (identical code in `setup.ts`). The cache is never successfully loaded.

### Finding 3: why SignalK is unreachable

`dilateAndMergePolygons` is declared `async`, but after the initial `await loadJsts()`, all work is synchronous: buffering 17,092+ GSHHG polygons and then calling `CascadedPolygonUnion.union()`. There is no event-loop yield during the union. The main thread is blocked for the duration, so Node.js cannot serve any HTTP requests → SignalK GUI is unreachable.

### Root causes

1. **Alignment bug in `saveDilatedIndex`/`loadDilatedIndex`** — the 36-byte per-polygon bbox header makes the exterior `Float64Array` unaligned. Cache is never loaded; union always reruns.
2. **Synchronous union on main thread** — `CascadedPolygonUnion.union()` for ~17,000 polygons blocks the event loop for >10 minutes with no yield points.

### Fix options

- **Fix the alignment only**: pad the bbox header to 40 bytes (or use a copy instead of a typed-array view for loading), bump the index version to invalidate old caches. The union still blocks on the very first run after a clean install, but subsequent startups load from cache and are fast. Acceptable if "first-run pause" is documented.
- **Fix alignment + move union to a worker thread**: also move `CascadedPolygonUnion.union()` into a `worker_threads` Worker so the main thread stays responsive even on first run. More complex but eliminates the blocking behaviour entirely.

---

## BUG-30 — Investigation Notes

### Audit of backend source files (2026-06-06)

Reviewed all 10 TypeScript source files. The following was addressed in commit 42688a1:

**File headers added** — all 10 files now open with a single-line role description: `src/types.ts`, `src/index.ts`, `src/lib/geo.ts`, `src/lib/grib.ts`, `src/lib/polar.ts`, `src/lib/landmask.ts`, `src/lib/resources.ts`, `src/lib/setup.ts`, `src/lib/routing/algorithm.ts`, `src/lib/routing/isochrone.ts`.

**"Why" comments added** at 9 locations across 5 files:
- `isochrone.ts`: `COARSE_CONE_HALF_ANGLE_DEG = 90` rationale; `setImmediate` event-loop yield (×3); cosine correction in `pruneToFrontier`; T_bound admissibility of `maxBoatSpeed`
- `landmask.ts`: `edgeCellKey` formula constants; DDA `maxSteps` Manhattan-distance bound; strict-interior `t > 0 && t < 1` in `segmentsIntersect`
- `geo.ts`: `+540` longitude wrap in `destinationPoint`; m/s→knots conversion factor
- `polar.ts`: `bracketIndex` low-end clamp rationale
- `setup.ts`: cache magic+version validation rationale

**SPEC.md corrected** — Phase 2 algorithm description and `coarseHeadingStep` parameter description updated to match current code (the inner two-pass band scan was removed by REQ-43 but the spec was not updated at the time).

### Remaining scope

The frontend (`public/index.html`) has not been audited for missing "why" comments. The backend audit may also have missed non-obvious invariants introduced in future changes.

---

## BUG-31 — Investigation Notes

### Root cause

`public/index.html` line 522, in the SSE `done` handler:

```js
document.getElementById('save-route-btn').style.display = '';
```

Setting `style.display = ''` removes any inline style override, causing the element to fall back to its CSS rule — which is `#save-route-btn { display: none }` (line 120 of the same file). The button is therefore still hidden after the calculation completes.

### Same root cause as BUG-27

BUG-27 had the identical pattern: `style.display = ''` on `#safety-margin-building`, which also had a CSS `display: none` rule. Fixed there by using `'block'` instead.

Note: `style.display = ''` works correctly for elements whose `display: none` is set as an inline `style` attribute in the HTML (e.g. `#safety-margin-wrap` at line 897) — removing the inline override restores the browser default. It only fails when the `none` is declared in a stylesheet rule.

### Fix

Change line 522 from:
```js
document.getElementById('save-route-btn').style.display = '';
```
to:
```js
document.getElementById('save-route-btn').style.display = 'block';
```

### Confirmed

Fix confirmed working by user (2026-06-06). REQ-47 (save route with name dialog) also confirmed working in the same session.

---

## BUG-10 — Investigation Notes

### Root cause

No validation of the start point before the calculation begins. When the start is inside a GSHHG land polygon, `isPointOnLand` (called at the top of each frontier loop iteration) immediately skips it, leaving `candidates` empty after the first step. The algorithm then throws "No reachable positions — check GRIB coverage and polar data", which is misleading: the real cause is the start point being on land.

### Fix

Added an explicit `isPointOnLand` check for the start point in the `/calculate` handler (`src/index.ts`) before the calculation starts. Returns HTTP 400 with the message "Start point is on land — move it to open water". Applied to `activeIndex` (respects safety margin setting). Same check added for the end point (see BUG-32).

---

## BUG-32 — Investigation Notes

### Root cause

`backtrack()` in `isochrone.ts` appends the destination coordinates directly as the first route waypoint without checking the final segment for land crossing. The `arrived` frontier point is within `arrivalRadiusNm` (2 NM) of the destination and in open water, but the straight line from there to a destination on land crosses through it.

Root cause is the same family as BUG-10: no validation that the destination is in open water before routing begins.

### Fix

Same fix as BUG-10 — `isPointOnLand` check for the end point added alongside the start check in the `/calculate` handler. Returns HTTP 400 with "Destination is on land — move it to open water".

### Regression during deployment

First deploy used `npm install --ignore-scripts` in the source build step, which skipped `gdal-async`'s postinstall hook. The bundled `gdal-async` in the tarball then had no native binary, causing the plugin to fail to load entirely. Fixed by following DEVELOPMENT.md correctly: `npm install` (no flags) in step 2 so the binary is downloaded, `--ignore-scripts` only in step 3 (tarball install).

---

## BUG-59 — Investigation Notes

### Root cause

`public/index.html:1298` used `m.waveHeight ?? 0` for the wave height polyline. When wave data was absent at a waypoint (`waveHeight: undefined`), the line plotted that point at 0 m, creating a false "flat calm" reading. The tooltip (`:1623`) correctly omitted the wave line when `m.waveHeight == null`, producing an inconsistency: the graph showed 0 m while the tooltip showed nothing.

Two separate issues were conflated: the graph drew a continuous line through missing-data points, and the tooltip hid its wave line. A user glancing at the graph sees zero wave height (interpreted as safe conditions) while the tooltip correctly indicates no data — a safety hazard.

### Fix

The single continuous `<path>` was replaced with per-segment `<path>` elements — one for each contiguous block of waypoints where `waveHeight != null`. Missing-data waypoints produce clean gaps in the green line. Dots are only drawn where `waveHeight != null` (removed the dark-gray `#313244` fallback dot).

### Scope note

This fix also addressed the primary driver of BUG-50 — the `?? 0` substitution created steep slopes between valid wave values and zero, which amplified the tooltip-vs-line discrepancy.

---

## BUG-50 — Investigation Notes

### Root cause

The conditions graph tooltip (`public/index.html:1616`) used `Math.round(frac * (meta.length - 1))` to snap to the nearest whole waypoint index, but the wave height polyline (`:1298`) drew straight-line segments between adjacent waypoints. At x-positions between waypoints, the tooltip showed one waypoint's raw value while the graph line showed a linear interpolation of two adjacent values.

When wave data was missing at some waypoints (the BUG-59 `?? 0` substitution), the line dropped sharply to zero and climbed back, creating steep slopes. The tooltip near these dips snapped to a nearby valid waypoint with a real value (e.g. 1.5 m), while the graph line at the hover x-position was at an intermediate interpolated value (e.g. 0.7 m). The user saw two different numbers for the same x-position.

### Fix

Replaced `Math.round` nearest-waypoint snapping with fractional index interpolation: `idx0 = Math.floor(exactIdx)`, `idx1 = idx0 + 1`, `t = exactIdx - idx0`. Numerical fields (`tws`, `boatSpeed`, `waveHeight`) are linearly interpolated between `m0` and `m1` using `lerp(a, b) = a + (b - a) * t`. The tooltip value now matches the visual line position at every x-coordinate.

For `waveHeight`, interpolation is only shown when **both** adjacent waypoints have data — consistent with the gap in the broken-line rendering from the BUG-59 fix.

---

## BUG-61 — Investigation Notes

### Symptom

Standard test (Öregrund → Gotska Sandön) — conditions graph shows no wave height (gap in the green line) between May 24 1800 CEST and May 25 0100 CEST. User reports xygrib shows ~0.5 m waves at those coordinates in the same GRIB file.

### GRIB file structure

`Baltic_Centre_ICON_EU_EWAM_20260524-00.grb2` — 1389 bands, 113×84 grid (0.0625°), covering lat [58.03, 63.22], lon [15.97, 23.03].

**All 7 wave parameters** have 79 hourly time steps (May 24 00:00Z – May 27 06:00Z):

| GRIB_ELEMENT | Description | Bands |
|---|---|---|
| HTSGW | Sig. height of combined wind waves + swell | 79 |
| WVHGT | Sig. height of wind waves | 79 |
| SWELL | Sig. height of swell | 79 |
| WVDIR | Wind wave direction | 79 |
| SWDIR | Swell direction | 79 |
| WVPER | Wind wave period | 79 |
| SWPER | Swell period | 79 |

### Fill pattern

**All 7 wave parameters have identical fill values (9999.0) at the same grid cells** — a unified land mask. The Swedish mainland creates a band of 9999 cells that bisects the Öregrund→Gotska Sandön route. The band's latitudinal extent varies by longitude:

| Longitude | Fill band (lat range) | Width |
|-----------|----------------------|-------|
| 17.35°E (Gotska Sandön) | 58.09°N – 59.66°N | 1.56° (~94 nm) |
| 17.5°E | 58.03°N – 59.84°N | 1.81° (~109 nm) |
| 17.7°E | 58.22°N – 59.47°N (multiple bands) | ~1.25° |
| 17.9°E | 58.84°N – 59.09°N | 0.25° (~15 nm) |
| 18.1°E | **no fill — all valid** | 0 |
| 18.3°E (Öregrund) | 59.41°N – 59.66°N | 0.25° |

Valid data exists north of the band (~59.7°N+) and south of it (~58.8°N– at favourable longitudes). The fill pattern is static across all 79 time steps — same cells, same 9999 value, at every forecast hour.

### Root cause: two issues

**Issue 1 — Single-file selection in `getWave()` (`windprovider.ts:60–73`):**

```javascript
getWave(lat, lon, t) {
    const waveFiles = this.sortedFiles.filter(e => e.data?.swhByTime?.size);
    // ...
    const f =
      waveFiles.find(e => coversPoint(e, lat, lon) &&
        e.meta.timeStart <= tMs && e.meta.timeEnd >= tMs) ??
      waveFiles.find(e => coversPoint(e, lat, lon)) ??
      waveFiles[0];
    return getWaveAt(f.data!, lat, lon, tMs);  // ← returns undefined, no fallback
  }
```

The method selects **one** file (Baltic Centre) via a priority chain and returns its result immediately. Even if that file has fill values at the requested position, no other file is tried.

The `Baltic_South_ICON_EU_EWAM_20260606-00.grb2` file has valid HTSGW data at the gap coordinates (0.285 m at Gotska Sandön, 0.355 m at the fill zone midpoint), but it is never consulted because the temporal check excludes it (June 6 > May 24). This is correct per the **Nautical Safety Rule** — using a different forecast as silent fallback is not allowed.

The fix is to iterate through all temporal-matching files and return the first valid result, instead of selecting a single file:

```
for each temporal-matching file:
    v = getWaveAt(file, ...)
    if v !== undefined: return v
→ return undefined
```

This would use a Baltic_South file for May 24 if one existed, but would NOT fall back to a different forecast date.

**Issue 2 — Post-hoc fill-value check in `getWaveAt()` (`grib.ts:187–199`):**

```javascript
const v = bilinear(grid, grib, lat, lon);
return v >= 100 ? undefined : v;
```

The `bilinear` function mixes 9999-fill cells with valid cells, then the code checks if the blended result exceeds 100. This works when 9999 values dominate but is fragile — if a fill cell has small bilinear weight, the blended result could slip under 100 and produce a bogus wave height.

Fix: check each of the four interpolation cells individually before computing the weighted result:

```
grid[i00], grid[i01], grid[i10], grid[i11]
if any >= 100: return undefined
→ compute and return bilinear result
```

### Fix options

| Option | Approach | Effect |
|--------|----------|--------|
| A | Per-cell fill check in `getWaveAt` + multi-file iteration in `getWave` | Robust fill detection + fallback to other same-date files |
| B | Per-cell fill check only | Robust fill detection alone; gap persists without additional GRIB files |
| C | Multi-file iteration only | Fallback works if same-date subregion files exist |
| D | Neither — document as data coverage limitation | Close bug; requires provisioning additional GRIB files |

The visible gap on the standard test requires a `Baltic_South_ICON_EU_EWAM_20260524-00.grb2` (or similar) file to provide coverage. The code fix (option A) makes the fallback work when such files exist, but the test-data only has the Centre file for May 24 — so the gap would persist in the test without adding data files.

### Regarding xygrib

The user reports xygrib shows ~0.5 m waves at the gap coordinates. Since all 7 wave parameters have 9999 at those grid cells, this is unexpected. Possible explanations:
1. xygrib may interpolate across land-masked cells differently (e.g. nearest-neighbour gap-filling)
2. The user may have checked a nearby coordinate within the valid domain
3. The user may have checked a different GRIB file

---

## BUG-60 — Investigation Notes

### Root cause

Y-axis labels were rendered as DOM `<span>` elements inside `#conditions-y-left` / `#conditions-y-right` `<div>`s, positioned using `top: y/VH*100%`. Grid lines and data lines were SVG elements inside an adjacent `<svg>` with `viewBox="0 0 800 184"` and `preserveAspectRatio="none"`.

While both systems should in theory produce the same pixel positions (`y/VH * H_actual`), the DOM labels and SVG content existed in separate coordinate systems that could diverge — especially when the container height differed significantly from VH=184. In fullscreen mode the offset grew proportionally, reaching ~20px at 1080p.

Additionally, a `+3.5` fudge factor in the label `topPct` formula `(y + 3.5) / VH * 100` introduced a small but systematic offset that scaled with container height.

### Fix

Removed the DOM-based label approach entirely. All y-axis labels are now rendered as SVG `<text>` elements pushed into the same `el` array as grid lines and data lines, sharing the same `viewBox` coordinate system:

- Left axis: `<text x="2" y="{y}">` with `fill="#89b4fa"` (blue, matching wind/boat speed)
- Right axis: `<text x="{VW-2}" y="{y}" text-anchor="end">` with `fill="#a6e3a1"` (green, matching wave height)

With `preserveAspectRatio="none"`, all SVG elements scale together linearly. Labels, grid lines, and data now use a single coordinate system and cannot decouple.

### Confirmed

Fix confirmed working by user on 2026-06-12 — graph renders correctly at both default panel height and fullscreen.

---

## BUG-62 — Investigation Notes

### Symptom

Looking at the wave overlay, the coast as well as the Åland islands are completely misplaced. This is true for Gotland and Denmark as well in the 6/6 GRIB files. User later clarified: "It looks like the wave overlay is rendered upside down, that is, the south part is drawn to the north."

### Root cause

The wave overlay (`renderWaveOverlay` in `public/index.html`) builds a canvas where row index `i=0` corresponds to the southernmost latitude (`latMin`), and row `i=nLat` corresponds to the northernmost latitude (`latMax`). The canvas is then passed to `L.imageOverlay(image, gridBounds)` where `gridBounds` is `L.latLngBounds(southWest, northEast)`.

`L.imageOverlay` maps the top edge of the image to the **northern** bound of the rectangle and the bottom edge to the **southern** bound. Since the canvas has south data at row 0 (the top of the image), the overlay appears vertically flipped — south data rendered at the north edge, north data at the south edge.

Compare with the wind overlay (`renderWindOverlay`), which uses `L.marker([lat, lon])` directly — Leaflet's native lat/lng→screen projection correctly maps north to top, south to bottom, with no flip.

### Fix

Invert the row mapping when populating `imageData`: write grid row `i` to canvas row `nLat - i`, so that the top row of the canvas receives the northernmost data and the bottom row receives the southernmost data.

---

## BUG-65 — Investigation Notes

### Symptom

After the BUG-62 row-flip fix, the wave overlay's coastline boundary is still visually offset ~30 km westward relative to the GSHHG basemap coastline.

### Methodology flaw in prior troubleshooting

The `wave-overlay-troubleshooting.md` click-to-inspect test (Step 3) declared the rendering correct, but it only verified that `allWavePoints` contains a coordinate near the clicked position — it cannot detect whether the canvas pixel at that screen location is rendered at the right geographic position. The conclusion was therefore unreliable.

### Diagnostic

A console diagnostic was added to `renderWaveOverlay` comparing, for each sampled latitude row, the geographic longitude implied by the canvas pixel position against the data longitude from the GRIB grid. The diagnostic also logged where the GRIB model's land-sea boundary falls at several reference latitudes.

**Group 1 — pixel-lon vs data-lon (Δ ≈ 0 means rendering is correct):**

```
lat=58.219 j=188  dataLon=17.5313  pixelLon=17.5313  Δ=0.00 km
lat=61.094 j=175  dataLon=16.7188  pixelLon=16.7188  Δ=0.00 km
```

(Two latitude rows returned all-NaN in the grid and were skipped.)

**Group 2 — GRIB land-sea mask boundary (westernmost water point in GRIB data):**

```
lat≈58.5:  westernmost water = 17.5313°E
lat≈59.3:  westernmost water = 17.7813°E
lat≈60.0:  westernmost water = 16.8438°E
```

### Root cause

The rendering math is correct — Δ = 0.00 km at every sampled point. The overlay pixels are placed at exactly the geographic positions the GRIB data says they are.

The visual skew is a data artefact. The ICON-EU/EWAM wave model operates on a 7 km bathymetric grid whose land-sea mask differs from the GSHHG high-resolution shoreline used by Leaflet's basemap tiles. At the Swedish east coast the model boundary is displaced roughly 14–65 km westward:

- lat≈59.3°N: GRIB water starts at 17.78°E vs GSHHG mainland at ~18.0–18.2°E → ~14–25 km offset
- lat≈60.0°N: GRIB water starts at 16.84°E vs GSHHG coast at ~17.5–18°E → ~37–65 km offset

The larger offset at 60°N reflects the Swedish coast being more indented (Gulf of Gävle) at that latitude; the coarse wave model "fills in" the bay and shifts the modelled water boundary far westward.

### Revised finding (2026-06-12) — coordinate error, not data artefact

Comparison with XyGrib using the Denmark GRIB (June 6) proved the previous conclusion wrong. XyGrib shows 0.64 m significant wave height at N56 55.63, E11 18.74 (Kattegat). Our overlay shows nothing at that position — the same gradient is visible in our overlay but displaced onto Denmark's land mass.

XyGrib does not clip or mask the GRIB overlay. It renders at the correct geographic coordinates from the GRIB file. Our overlay renders at wrong coordinates. The diagnostic (Δ = 0.00 km pixel-lon vs data-lon) only proved the canvas pixels match the coordinates returned by `/wave-grid` — it did not prove those coordinates are correct. The coordinate error is upstream, in the GRIB metadata reading or the `/wave-grid` grid construction.

The "30 km skew" attributed to a data artefact for hours was this same coordinate bug, less obviously visible in the Baltic because land is nearby.

### Root cause confirmed (2026-06-12) — mixed-grid GRIB files

The OpenSkiron ICON-EU EWAM files are combined files containing two model grids:

| Grid | Step | Size (Denmark) |
|------|------|----------------|
| Atmospheric (ICON-EU wind) | 0.0625°×0.0625° | 132×113 |
| Ocean wave (EWAM HTSGW) | 0.1°×0.05° | 83×141 |

GDAL derives `ds.geoTransform` from the **first band** (CAPE, atmospheric grid). All 1389 bands — including 553 oceanographic HTSGW bands — are presented through the 132×113 atmospheric grid. `readGrib` reads HTSGW through the wrong grid, producing values at wrong coordinates.

**Verification:** Extracting discipline=10 (oceanographic) messages by scanning the raw GRIB2 binary for the "GRIB" marker (discipline at offset+6, total length at offset+8 as uint64 big-endian), writing them to a GDAL `/vsimem/` virtual file, and opening that file gives the correct 83×141 grid at 0.1°×0.05°. Reading HTSGW at 2026-06-06T01:00Z for N56.93°, E11.31° returns **0.655 m** — matching XyGrib's 0.64 m.

### Fix implemented

- `GribData.swhGrid` added to `types.ts` to carry the wave grid parameters independently
- `extractDisciplineMessages` in `grib.ts` extracts GRIB2 messages by discipline byte
- `readSwhFromOceanMessages` in `grib.ts` opens the extracted messages via vsimem and reads HTSGW with `flipRows`
- `loadGrib` calls `readSwhFromOceanMessages` and overrides `swhByTime`/`swhGrid`
- `getWaveAt` uses `swhGrid` for bilinear interpolation when present
- Integration test added: `getWaveAt` at Kattegat from Denmark GRIB asserts 0.55–0.75 m

### Continued N-S displacement (2026-06-12) — Mercator projection mismatch

After deploying the mixed-grid fix, user reported the wave overlay for the entire Gulf of Finland still appears north of Vantaa (~60.3°N). Pixel-center correction (commit e99c6e6, 0.025° = ~2.8 km) had no visible effect.

**Tooltip evidence:** clicking near Tallinn (59.4°N) in the UI produces a wave-height tooltip with data at the correct position (e.g. `59.45°N, 24.6°E`). This proves the data lookup (`getWaveAt`) and the point coordinates in `allWavePoints` are correct. The mismatch is between the tooltip coordinates and the visual canvas overlay — a rendering placement bug.

**Root cause: linear-latitude canvas stretched in Web Mercator space.**

`renderWaveOverlay` in `public/index.html` builds a canvas where each pixel row corresponds to an equal step in *latitude* (`latStep` degrees per row). Leaflet's `L.imageOverlay` stretches the canvas uniformly in *Web Mercator Y* space (equal Mercator units per screen pixel). These two spacings diverge at higher latitudes.

When multiple GRIB files are loaded, the canvas spans the union of all files' `f.meta` bounds. With all test-data files loaded:
- Canvas bounds: 52.5313°N to 66.7813°N (14.25° range)
- Data at 60.0°N occupies the linear-lat canvas position corresponding to 60.0°N
- After Mercator stretching that pixel appears at **60.77°N** — 85 km too far north

With only Baltic_East loaded (56.47°N–61.72°N, 5.25° range) the error is only 10 km.

**Quantitative verification (node):**

```
All files loaded — canvas 52.5313 to 66.7813
60.0N appears at: 60.767N  shift: 0.767deg = 85 km north
59.7N appears at: 60.470N

Baltic_East only — canvas 56.4688 to 61.7188
60.0N appears at: 60.088N  shift: 0.088deg = 10 km north
```

This is consistent with the user's observation: "the entire wave data for the entire Gulf of Finland is drawn north of Vantaa." At 60.5°N+, the visible first-data row (59.7–60°N) has been pushed to 60.47–60.77°N by Mercator stretching.

**Why the pixel-center fix had no effect:** the Mercator error (~85 km) completely dominates the pixel-center correction (~2.8 km). The pixel-center fix is correct but immaterial compared to this bug.

**Fix required:** build the canvas in Mercator-projected coordinates. Each canvas row must correspond to an equal increment of Mercator Y, not an equal increment of latitude. Then when Leaflet stretches it linearly in Mercator space the data appears at correct positions. The canvas bounds must be expressed in lat (SW/NE corners) as before, but the per-pixel lat→row mapping must use `mercY(lat)` instead of `(lat - latMin) / latStep`.

---

## BUG-79 — Investigation Notes

### Scope of gdal-async usage

`gdal-async` is used in **only one source file**: `src/lib/grib.ts`. All other files (landmask.ts, setup.ts, polar.ts, geo.ts, algorithm.ts, isochrone.ts, index.ts) are independent of it. The gdal-async API surface used:

| API | Use | Replaceable? |
|-----|-----|-------------|
| `gdal.openAsync(path)` | Open GRIB2 file | Yes — pure JS section parser |
| `ds.geoTransform` | Read geotransform (origin, pixel size) | Yes — parse GRIB Section 3 (Grid Definition) |
| `ds.rasterSize` | Read raster dimensions | Yes — parse GRIB Section 3 |
| `ds.bands.count()` / `ds.bands.get(i)` | Iterate bands | Yes — parse sequential GRIB messages |
| `band.getMetadata()` | Extract GRIB_ELEMENT, GRIB_VALID_TIME, etc. | Yes — parse GRIB Section 1 (Identification) + Section 4 (Product Definition) |
| `(band.pixels as any).readAsync(...)` → `Float32Array` | Read decoded pixel data | **Hard part** — requires JPEG2000 decompression for OpenSkiron ICON-EU files |
| `(gdal.vsimem as any).copy(buffer, path)` | Write to virtual filesystem | Trivially replaceable with in-memory `Buffer` |
| `extractDisciplineMessages()` | **Already pure JS** — manual GRIB2 header parsing | No change needed |

**Key finding: gdal-async is a GRIB2+JPEG2000 decoder, not a general GIS tool.** No GDAL warp, reprojection, vector operations, or shapefile reading is performed at runtime. The shapefile/GSHHG handling is done by an offline Python build script (`scripts/prepare-land-data.py` using Fiona/Shapely), not by gdal-async.

### What makes replacement hard

The OpenSkiron ICON-EU GRIB2 files use:
- **JPEG2000 compression** (Section 5 template 5.40) — the data values are stored as a lossless JPEG2000 codestream
- **Complex packing + spatial differencing** (template 5.3) — also used by ICON-EU
- **Rotated latitude/longitude grid** (Grid Definition Template 3.1, or 3.32768 for Arakawa E-grid) — the grid uses a rotated pole, so raw lat/lon pairs must be computed from the rotated coordinates
- **Mixed-grid files** — atmospheric wind (0.0625° regular lat/lon) and ocean wave (0.1°×0.05° EWAM) grids in the same file; currently handled by the already-pure-JS `extractDisciplineMessages()` function

Any replacement must handle all of these.

### Alternatives investigated

#### A. Full-stack GRIB2 parsers (complete gdal-async replacement)

| Package | Type | JPEG2000 | Rotated Grid | Complex Pack. | Status |
|---|---|---|---|---|---|
| **@trkbt10/grib2-wasm** | WASM (MoonBit) | ✅ native WASM decoder | ✅ (GDT 3.1) | ✅ (2,3,40,41) | ✅ **Active 2026**, 0★ |
| **grib2class** (archmoj) | Pure JS | ✅ via jpx.js (PDF.js) | ✅ partial (GDT 3.1 only) | ✅ | ❌ Unmaintained 2020 |
| **grib-js** (gmerciel/rjw57) | Pure JS | ❌ raw bytes only | ❌ | ❌ simple only | ⚠️ Section parser, no decode |
| **vgrib2** (veech) | Pure TS | ❌ raw bytes only | ❌ (GDT 3.0 only) | ❌ simple only | ❌ Unmaintained 2021 |

**`@trkbt10/grib2-wasm`** looked promising on paper (WASM, handles JPEG2000 and rotated grids) but **is not viable in its current state**:
- **Not published on npm** — `npm install @trkbt10/grib2-wasm` returns 404; no prebuilt WASM binary in the repository
- **Cannot build from source** — requires MoonBit compiler; `moon update` segfaults; registry dependencies (`moonbitlang/x`, `gmlewis/io`, `gmlewis/flate`, `gmlewis/zlib`, `trkbt10/jpeg2000`) fail to resolve
- **0 stars, 0 forks, no releases** — project is at a very early stage; source language (MoonBit) is a niche competitor to Rust/WASM with minimal community adoption
- The TypeScript wrapper and API design are good, but the project is not yet ready for production use as a dependency

**`grib2class`** (archmoj, npm: `grib2class@1.0.7`, MIT) is a pure-JS GRIB2 parser that:
- Handles simple packing (5.0), complex packing (5.2), complex + spatial differencing (5.3), and JPEG2000 (5.40) — **JPEG2000 via jpx.js** (Mozilla PDF.js fork, injected as external decoder)
- Handles rotated lat/lon (GDT 3.1) partially; GDT 3.32768 (Arakawa E-grid) is recognised by name but parameters are not read
- Has zero npm dependencies
- Is unmaintained since 2020 (hackathon-grade code) but the core logic is small and could be forked

**`grib-js`** (gmerciel, npm: `grib-js@1.0.0`, MIT) is a fork of `rjw57/grib.js` that:
- Added complex packing + spatial differencing (5.3) data decoder — **does handle template 5.3**
- **Does NOT handle JPEG2000** (5.40) — raw bytes only
- **Does NOT handle rotated lat/lon** (GDT 3.1) — only templates 0, 10, 20, 30, 40, 90
- Good as a metadata/section parser but insufficient as a full replacement

#### B. JPEG2000 decoders (components for composable approach)

| Package | Type | License | Size | Notes |
|---|---|---|---|---|
| **`jpeg2000`** (runk) | Pure JS (PDF.js fork) | Apache-2.0 | ~9KB | Zero deps, works Node+browser, accepts raw codestream, actively maintained |
| **`@cornerstonejs/codec-openjpeg`** | WASM (OpenJPEG) | MIT | ~600KB | Fastest decode, standalone WASM build, medical-imaging context |
| **`@abasb75/jpeg2000-decoder`** | WASM (OpenJPEG) | Unknown | — | No GitHub repo found, risky |

The `jpeg2000` (runk) package is the most practical JPEG2000 decoder for a composable approach: pure JS, no native or WASM dependencies, simple API (`JpxImage.parse(codestream)`), Apache-2.0 license, 4,218 weekly downloads.

#### C. Composable pure-JS pipeline (recommended approach)

A zero-native-dependency pipeline can be built from three components:

```
grib2class (section parser + data unpacking)
  + jpeg2000 (runk, JPEG2000 codestream decoder)
  ← or use only grib-js section parser + manual rotated-grid handling + jpeg2000
```

Both approaches:
- Work on ARM64 (Raspberry Pi) with zero native code
- Have no `node-gyp` or WASM binary requirements
- Can be installed with `--ignore-scripts` (SignalK constraint)

The main implementation work is:
1. Fork/adapt `grib2class` or `grib-js` to extract Section 3 grid parameters and Section 4/5 metadata
2. Feed the JPEG2000 codestream from Section 5/7 to `jpeg2000` decoder for template 5.40
3. Handle rotated lat/lon coordinate computation (GDT 3.1) — non-rotated formula is straightforward; rotated requires applying the south-pole rotation to each lat/lon pair
4. Handle the mixed-grid file structure (already done in `extractDisciplineMessages()`)

#### D. Build gdal-async from source on ARM64 (alternative approach)

gdal-async does not ship prebuilt binaries for linux-arm64 (Raspberry Pi), but it **can** be built from source:
```
npm install gdal-async --build-from-source
```
This requires a C++ toolchain and the GDAL dev libraries on the RPi. The resulting `gdal.node` binary can be bundled in the plugin tarball, similar to how the x64 binary is currently bundled. This avoids any code change in `grib.ts` but adds a build step on an ARM64 machine.

#### E. Shapefile readers (not directly needed at runtime)

The project already handles GSHHG shapefile reading offline via Python. For reference, pure JS alternatives exist:
- **shpjs** — mature pure-JS shapefile→GeoJSON parser (811★, 48 releases since 2013)
- **shapefile** (mbostock) — streaming parser (802★, mature but unmaintained)
- **polygon-clipping** — pure JS boolean polygon ops (Martinez-Rueda-Feito, 1.5M weekly downloads)

These are relevant if the land mask pipeline were ever ported to TypeScript, but not needed for BUG-79.

#### F. SignalK ecosystem

No existing SignalK plugin uses a pure-JS GRIB2 parser. The closest is `signalk-windjs-plugin` which spawns a Java subprocess running `grib2json.jar` — not viable for ARM64 (requires JRE) and fundamentally the same native-dependency problem. No other SignalK plugin provides a reusable GRIB parsing module.

### Recommendation

**Short-term: build gdal-async from source on an ARM64 machine and bundle the binary.** This is the lowest-risk path — zero code changes in `grib.ts`, proven architecture, and the only new cost is a one-time build on a Raspberry Pi (or cross-compilation in CI). The binary is then bundled in `bundledDependencies` as before.

**Medium-term: migrate to a pure-JS composable pipeline.** The most viable package combination is:

| Role | Package | Reason |
|------|---------|--------|
| GRIB2 section parsing | `grib-js` (gmerciel) or fork | Covers Sections 0–6 including complex packing (5.3) |
| JPEG2000 decode | `jpeg2000` (runk) | Pure JS, Apache-2.0, 0 deps, works on all platforms |
| Rotated grid math | Manual (small `geo.ts` addition) | Simple spherical rotation of lat/lon coords |

This eliminates the `bundledDependencies` hack and the `--ignore-scripts` concern entirely, and makes the plugin platform-agnostic.

**`@trkbt10/grib2-wasm`** is worth re-evaluating once it is published on npm with a prebuilt WASM binary, but it is not production-ready today.

### Target platform architecture summary

| Device | CPU | Arch | OS | Node | gdal-async binary? |
|--------|-----|------|----|------|-------------------|
| RPi 3/4/5 | Cortex-A53/A72/A76 | **arm64** (aarch64) | Raspberry Pi OS 64-bit | 22 or 24 (24 recommended) | ❌ — no prebuilt |
| Desktop/server | x86-64 | **x64** | Linux/macOS/Windows | 22 or 24 | ✅ — prebuilt present |
| Cerbo GX (MK1/2) | Allwinner A20, dual Cortex-A7 | **armv7l** (32-bit) | Venus OS (Yocto) | 20 (fixed, Venus OS 3.70) | ❌ — no prebuilt |

Key findings:
- **RPi 3/4/5 must run 64-bit OS** with Node 24. Node.js 24 dropped armv7 support entirely, so 32-bit RPi OS is no longer an option for SignalK. SignalK docs: *"64-bit Raspberry Pi OS is installed on the device (Pi 3, 4 or 5 required). Node.js 24 does not support 32-bit ARM (armv7)."*
- **Cerbo GX is armv7 (32-bit)** with a weak dual-core Cortex-A7 @ 960 MHz, 1 GB RAM. Venus OS ships Node 20. SignalK's CI runs a dedicated armv7 job using `node:20-bookworm-slim` with QEMU — failures are advisory/non-blocking.
- `gdal-async` on npm ships prebuilt `.node` binaries for linux-x64, darwin-x64, darwin-arm64, win32-x64 — **not** for linux-arm64 or linux-armv7.
- **Building gdal-async from source on arm64 is possible** (it uses prebuildify/node-gyp) but requires `g++`, `make`, `python3`, and PROJ/GDAL dev headers. On Venus OS (Cerbo), build tools are available via `opkg` but the CPU is slow (~50 MIPS, half of a Pi 4). Node 20 on armv7 is also below SignalK's current minimum (Node 22), making Cerbo GX a low-priority target for this plugin.

*(End of investigation notes — 2026-06-13)*

---

## BUG-87 — Investigation Notes

### Deploy testing — wind/wave overlay 503 regression

When deploying the BUG-87 debounce fix (commit `389b44a` on `fix/BUG-87-scrubber-debounce`) to the SignalK server container, the wind and wave overlays stopped rendering. Requests to `/wind-grid` and `/wave-grid` returned HTTP 503 with error body `"GRIB data not loaded — fetch /wind-times first"`. The current overlay continued to work normally.

### Investigation

**Server log evidence** (from `docker logs signalk-server`):
```
GET /plugins/signalk-weather-routing/wind-grid?timeIdx=0&path=...  503 1.198 ms - 60
GET /plugins/signalk-weather-routing/wave-grid?timeIdx=0&path=...  503 1.137 ms - 60
GET /plugins/signalk-weather-routing/grib-info                      200 1.476 ms - -
GET /plugins/signalk-weather-routing/current-grid?timeMs=...        200 40.283 ms - -
```

Already present immediately after a `/reload-grib` call. The `wave-grid` request at `timeIdx=0` (no debounce involved) also returned 503 — confirming this was **not** caused by the debounce or AbortController changes in BUG-87.

### Root cause

`scanAndIndexGribDir` in `src/index.ts:86–122` treats wind and current GRIBs differently:

| File type | Lines | Data loaded at scan time? |
|-----------|-------|--------------------------|
| Current | 102, 111–121 | **Yes** — `loadCurrentGrib()` called for the freshest file |
| Wind | 104 | **No** — `data: null` stored, never loaded |

The only paths that load wind GRIB data are:
- **`/wind-times`** (line 497–508) — lazily loads ALL wind files. **Never called by the frontend.**
- **`/calculate`** (line 374–382) — lazily loads only the files selected for the route calculation.

Since the frontend's `initWindScrubber()` (`public/index.html:1719`) never calls `/wind-times`, and `rebuildScrubberTimes()` reconstructs the time axis purely from GRIB metadata (timeStart/timeEnd/nTimes) without loading data, the wind data stays null on every fresh page load or GRIB reload.

**The wind overlay works after a route calculation** because `/calculate` calls `loadGrib()` for the selected files, setting `entry.data` for the remainder of the server session.

**The wave overlay does NOT work after a route calculation** because `fetchAndDrawRoute()` (line 1800–1823) only calls `fetchWindPoints(i0)` after route completion — `fetchWavePoints` is never invoked there. The wave overlay therefore only renders when the user happens to move the scrubber (which calls `fetchWavePoints` via the `input` handler).

### Classification

Both issues are pre-existing — they existed before the BUG-87 debounce fix. The BUG-87 deployment simply made them visible because the user tested the scrubber on a fresh page load.

- **Wind overlay (a)**: pre-existing; mitigated by running any route calculation first.
- **Wave overlay (b)**: pre-existing; mitigated by moving the scrubber after route calculation.

Logged as **BUG-89** (#275). Cross-reference comment posted on BUG-87 (#269).
