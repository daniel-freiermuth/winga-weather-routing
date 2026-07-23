# signalk-weather-routing

> [!CAUTION]
> **Experimental — read before use.**
>
> - Calculated routes have not been validated by sailing them and **may cross land or shallow water**.
> - Weather forecasts change. The route calculated now may not reflect conditions at departure time. Always obtain up-to-date forecasts and check for NOTAMs and local hazards.
> - This plugin **does not replace good seamanship**, a qualified navigator, or certified navigation software. Use is entirely at your own risk.

A SignalK webapp that calculates time-optimal sailing routes using live weather forecasts and the isochrone method.

![logo](wr-icon-128px.png)

## Features

- Time-optimal isochrone routing using ECMWF weather forecasts
- Automatic land avoidance using [GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/) high-resolution coastlines
- Wind, wave height, and ocean current overlays with a time scrubber
- Conditions graph showing wind, wave, and boat speed along the calculated route
- Route weather analysis — per-waypoint forecast along any route
- Routes saved to SignalK `resources/routes` — visible in freeboard-sk
- No server-side setup needed — all computation runs in the browser

![Weather routing webapp](screenshot2.jpg)

## Requirements

- SignalK server >= 2.0.0
- A polar diagram (upload CSV or enter upwind/beam/downwind speeds)
- A modern browser (WebGL required for MapLibre GL JS)

## Installation

Install from the **SignalK App Store** (Server → Appstore → Available) and restart SignalK.

No additional configuration is needed.

## Usage

Open the webapp at `http://<your-signalk-host>:3000/signalk-weather-routing/`.

### Basic workflow

1. **Load a polar** — upload a CSV file or enter upwind/beam/downwind boat speeds to generate one
2. **Set departure** — click "Set on map" and click the map, use vessel position, or select a SignalK route
3. **Set destination** — same options
4. **Set departure time** — defaults to the next half-hour
5. **Calculate Route** — isochrones are drawn live; the finished route shows wind barbs and ETAs

### Route waypoints

Select a route from the **Route waypoints** dropdown to route through its intermediate waypoints in order. The route's first and last waypoints become departure and destination.

### Route weather analysis

Click **Analyse Route Weather** to compute per-waypoint forecasts along any route (set or selected). Shows a table with ETA, wind, wave, TWA, and boat speed at each waypoint, plus markers on the map.

### Routing options

- **Coast avoidance** — enabled by default; uses GSHHG coastlines
- **Safety margin** — dilates coastline by 0.5 NM
- **Motor** — set threshold and motor speed for light-wind legs
- **Wait for wind** — hold position through calm patches
- **Max wind / max wave** — avoid areas exceeding limits

### Map layers

Toggle overlays in the Layers panel:
- **Wind overlay** — wind barbs showing speed and direction
- **Wave height** — colour raster (blue → red)
- **Currents** — cyan arrows showing ocean current
- **Land overlay** — coastline polygons
- **Isochrones** — frontier lines from route calculation
- **Regions** — SignalK avoidance regions

### Time scrubber

Drag the slider to browse forecast times. The wind, wave, and current overlays update to the selected time. After route calculation, the scrubber locks to the route's time range and highlights the corresponding leg.

### Conditions graph

Below the map — shows wind speed, boat speed, and wave height along the calculated route over time. Click to expand fullscreen.

## Polar diagram format

Standard ORC/OpenCPN semicolon-delimited CSV:

```
twa/tws;6;8;10;12;14;16;20
52;4.5;5.2;5.8;6.1;6.3;6.4;6.5
...
```

Or enter three speeds (upwind/beam/downwind at 12 kn TWS) and click "Generate" for a simple polar.

## Land data

Land avoidance uses [GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/) v2.3.7 (GNU LGPL v3). Pre-built binary indices are bundled — no download needed.

High-resolution coastlines (~100 m) are available from [weather-routing-hires-land-data](https://github.com/kristianwiklund/weather-routing-hires-land-data).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).
