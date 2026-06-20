# Backlog Priority

Proposed priority ordering of the full open backlog, from a sailing/operational
perspective (sailing-expert-advisor review #2, 2026-06-20, after the gap-proposal
walkthrough added REQ-130…REQ-136). This is advisory — it records the recommended
sequencing and rationale, not a commitment.

## Ranking

| Rank | Item | Verdict |
|---|---|---|
| 1 | REQ-136 — GRIB coverage-edge hard failure audit | Safety-critical. A route silently extrapolated past the GRIB edge is a lie a sailor follows into the dark. The only item that can directly get someone hurt. |
| 2 | REQ-90 — departure-time sweep | The go/no-go tool. Turns the plugin from a calculator into a planner. Every offshore sailor plans a departure, not "a route". Ship with BUG-129 fix included (the sweep multiplies hot-path cost). |
| 3 | REQ-133 — comfort constraints overhaul (TWA + wave direction) | Passage survivability. "Wind 28 kn, within limit" is a lie if it's 28 kn on the nose — close-hauled in a gale is a different universe from downwind. Exhausted crews make mistakes. |
| 4 | BUG-127 — wave overlay corruption on scrub | Active lie to current users, today. Display that lies destroys trust. Fix alongside the top three. |
| 5 | REQ-131 — GRIB selector overlay (timeline + age/granularity warnings) | Trust + decision support. Subsumes REQ-130, REQ-64, REQ-88, REQ-120 — commit to this as one effort; don't half-build the others. |
| 6 | REQ-132 — low-confidence forecast horizon shading | Decision honesty. A fresh 120 h GRIB is still wrong at 120 h. Strongly coupled to REQ-90. |
| 7 | REQ-134 — daylight landfall preference | Landfall safety. Cheap (pure sun math). Only meaningful once REQ-90 exists. |
| 8 | BUG-120 — `nTimes` contradiction in BUGS.md | Docs integrity. Resolve empirically; one of the two contradicting entries must go. |
| 9 | BUG-129 — `getWind()` double-scan | Performance, gated by REQ-90. Doesn't matter for one route; matters a lot when the sweep runs 5× departures on a Pi on battery. Fix as part of REQ-90. |
| 10 | REQ-129 — per-segment GRIB source indicator | Trust scaffolding ("this leg driven by 06z ICON"). Empty body needs filling (see notes). |
| 11 | REQ-135 — wind-against-current sea state model | Regionally safety-critical (Agulhas, Gulf Stream, Alderney Race, Cape Horn), generally niche. Blocked by BUG-86. |
| 12 | BUG-86 — tidal current GRIB untested | "Untested" is the worst status. Either test+support or test+explicitly reject; don't leave it ambiguous. |
| 13 | REQ-115 — motoring mode | Real for motorsailers and calm-passage planning. Subset of users; not core routing value. Fixed speed is STW (see REQ-115 clarification). |
| 14 | REQ-60 — soft land-distance reward | Comfort, not safety (hard GSHHG avoidance already handles danger). Drop the "postponed" tag — re-tag normal-low; it isn't postponed-worthy, just genuinely low. |
| 15 | REQ-59 — TSS handling | Coastal/regional/legal. Real in the English Channel, North Sea, Baltic; irrelevant for 95% of an ocean crossing. Rank low unless user base is N-European coastal. |

REQ-130 (scrubber granularity) is intentionally absent from the numbered list —
merge into REQ-131 (see notes).

## Dependencies & sequencing

- **REQ-136 is foundational and standalone.** Nothing depends on it technically; everything depends on it morally. Do it first.
- **REQ-90 is the keystone of the "decision" band.** REQ-132, REQ-134, and BUG-129 only earn their value once the sweep exists. Build REQ-90 and fix BUG-129 in the same effort.
- **REQ-133 before trusting REQ-90's "worst wind" column.** A sweep showing "27 kn" is misleading if 27 kn close-hauled isn't distinguished from 27 kn downwind. If REQ-133 can't land fully before REQ-90, at least label the sweep output as TWA-blind.
- **REQ-131 subsumes REQ-130, REQ-64, REQ-88, REQ-120.** Commit to REQ-131 as the single GRIB-management UX redesign; do not build REQ-130 standalone.
- **REQ-132 and REQ-134 are sweep-adjacent enhancements** — queue right behind REQ-90; cheap, and make the sweep output honest.
- **REQ-135 is blocked by BUG-86.** Don't attempt wind-against-current modelling until the current GRIB it reads is trustworthy in tidal waters.
- **BUG-127, BUG-120, REQ-129** are independent trust/hygiene items — slottable into any sprint.

## Items to downgrade, merge, or drop

- **REQ-130 → MERGE into REQ-131.** REQ-131 explicitly subsumes it. Building the granularity-aware scrubber standalone is throwaway work. Close REQ-130 as "folded into REQ-131" when REQ-131 is planned.
- **REQ-129 → FILL THE EMPTY BODY or drop.** SPEC.md has only the ID; the real intent lives in GitHub issue #351's title ("Route view shows which GRIB file supplies data per route segment"). Per project rules an unwritten requirement is undecided. Lift the issue title into the body or remove the entry.
- **BUG-120 → RESOLVE the contradiction; one BUGS.md entry must go.** It cannot be both "open: never read at runtime" and "won't-fix: frontend reads it." Determine empirically and keep the single entry that matches reality.
- **REQ-60 → DROP the "postponed — future sprint" tag; re-tag normal-low.** The previous review was right that the tag is wrong — it isn't postponed-worthy, just genuinely low priority.
- **REQ-59 → keep, but rank honestly by reach.** Bump if the user base is heavily N-European coastal; leave low if ocean-passaging.

## Top-3 do-first

1. **REQ-136** — only item that can directly get someone hurt.
2. **REQ-90** — the decision that matters (ship with BUG-129 fix included).
3. **REQ-133** — the constraint actually doing its job.

Honorable in-sprint inclusion: **BUG-127** — a live lie to every current user.
