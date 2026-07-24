# winga-weather-routing — Specification

## Open Requirements

| # | Requirement | Status |
|---|---|---|
| [REQ-133](https://github.com/kristianwiklund/signalk-weather-routing/issues/361) | Overhaul the route comfort constraint subsystem. Current constraints (max wind speed and max wave height) are insufficient: wind comfort should account for true wind angle (a close-hauled leg in strong wind is far more punishing than a downwind leg), the wave constraint should consider wave direction relative to course, and a combined comfort score should replace independent thresholds. | open |
| [REQ-134](https://github.com/kristianwiklund/signalk-weather-routing/issues/362) | Add an optional preference to target a daylight landfall — avoid scheduling arrival between sunset and sunrise. Sun position is computed in pure math (per REQ-9). Interacts with the departure sweep feature (REQ-90). | open |
| [REQ-135](https://github.com/kristianwiklund/signalk-weather-routing/issues/363) | Model wind-against-current sea state as part of the comfort/constraint subsystem. Wind blowing against a strong opposing current creates steep, breaking seas far worse than the significant wave height alone suggests (e.g. Agulhas, Gulf Stream, Alderney Race). | open |
| [REQ-115](https://github.com/kristianwiklund/signalk-weather-routing/issues/259) | Dedicated motoring mode for route calculation where the boat travels under engine at a fixed speed regardless of wind. Unlike motor-fallback (which motors only below a threshold), this applies at all times and does not require a polar diagram. Motor speed is boat speed through water (STW); current drift is still applied. | open |
| [REQ-90](https://github.com/kristianwiklund/signalk-weather-routing/issues/167) | Calculate routes for multiple departure times in one operation. The user specifies a sweep interval and number of alternatives (e.g. every 6 h, 5 departures). Results are presented as a comparison table showing departure time, ETA, and worst wind speed for each alternative. | open |
| [REQ-59](https://github.com/kristianwiklund/signalk-weather-routing/issues/59) | Traffic separation zone handling. | open |
| [REQ-60](https://github.com/kristianwiklund/signalk-weather-routing/issues/91) | Among otherwise equal routes, prefer candidates further from land — a soft reward in frontier pruning, not a hard distance constraint. | open |
