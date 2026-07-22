<script lang="ts">
  // Renderless Svelte component — renders wave height heatmap as an image source + raster layer.

  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { ImageSource } from 'maplibre-gl';
  import { mapInstance, wavePoints, waveOverlayVisible, waveGridMetaStore, waveOverlayMaxMStore } from '../stores';

  const SOURCE_ID = 'wave-overlay';
  const LAYER_ID = 'wave-overlay-layer';

  let map: import('maplibre-gl').Map | null = null;

  function removeOverlay() {
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function render() {
    if (!map) return;
    removeOverlay();
    if (!get(waveOverlayVisible)) return;

    const allPts = get(wavePoints);
    const meta = get(waveGridMetaStore);
    if (allPts.length === 0 || !meta) return;

    const pts = allPts.filter((p) => p.waveHeight != null);
    if (pts.length === 0) return;

    const { latMin, latMax, lonMin, lonMax, latStep, lonStep } = meta;
    const nLat = Math.round((latMax - latMin) / latStep);
    const nLon = Math.round((lonMax - lonMin) / lonStep);

    const grid = new Float32Array((nLat + 1) * (nLon + 1));
    grid.fill(NaN);
    for (const { lat, lon, waveHeight } of pts) {
      const i = Math.round((lat - latMin) / latStep);
      const j = Math.round((lon - lonMin) / lonStep);
      grid[i * (nLon + 1) + j] = waveHeight;
    }

    const canvas = document.createElement('canvas');
    canvas.width = nLon + 1;
    canvas.height = nLat + 1;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(nLon + 1, nLat + 1);
    const maxH = get(waveOverlayMaxMStore) || 3.0;

    // Canvas rows spaced in Web Mercator Y for correct projection
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const mercToLat = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
    const yTop = mercY(latMax + latStep / 2);
    const yBot = mercY(latMin - latStep / 2);

    for (let canvasRow = 0; canvasRow <= nLat; canvasRow++) {
      const lat = mercToLat(yTop - (canvasRow / nLat) * (yTop - yBot));
      const i = Math.round((lat - latMin) / latStep);
      if (i < 0 || i > nLat) continue;
      for (let j = 0; j <= nLon; j++) {
        const h = grid[i * (nLon + 1) + j]!;
        const idx = (canvasRow * (nLon + 1) + j) * 4;
        if (isNaN(h) || h < 0.2) {
          imageData.data[idx + 3] = 0;
        } else {
          const t = Math.max(0, Math.min(1, h / maxH));
          const hue = 240 - t * 240;
          const hh = hue / 60;
          const c = 0.5;
          const x = c * (1 - Math.abs((hh % 2) - 1));
          let r1 = 0, g1 = 0, b1 = 0;
          if (hh < 1) { r1 = c; g1 = x; }
          else if (hh < 2) { r1 = x; g1 = c; }
          else if (hh < 3) { g1 = c; b1 = x; }
          else if (hh < 4) { g1 = x; b1 = c; }
          else if (hh < 5) { r1 = x; b1 = c; }
          else { r1 = c; b1 = x; }
          imageData.data[idx] = Math.round(r1 * 255);
          imageData.data[idx + 1] = Math.round(g1 * 255);
          imageData.data[idx + 2] = Math.round(b1 * 255);
          imageData.data[idx + 3] = 178;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const half_lat = latStep / 2;
    const half_lon = lonStep / 2;
    const url = canvas.toDataURL();
    // Image source coordinates: [topLeft, topRight, bottomRight, bottomLeft] as [lng, lat]
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [lonMin - half_lon, latMax + half_lat],  // top-left
      [lonMax + half_lon, latMax + half_lat],  // top-right
      [lonMax + half_lon, latMin - half_lat],  // bottom-right
      [lonMin - half_lon, latMin - half_lat],  // bottom-left
    ];

    if (map.getSource(SOURCE_ID)) {
      (map.getSource(SOURCE_ID) as ImageSource).updateImage({ url, coordinates });
    } else {
      map.addSource(SOURCE_ID, {
        type: 'image',
        url,
        coordinates,
      });
      map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: { 'raster-opacity': 1.0 },
      });
    }
  }

  const unsubs: (() => void)[] = [];
  let mapReady = false;

  unsubs.push(mapInstance.subscribe((m) => {
    if (!m || mapReady) return;
    mapReady = true;
    map = m;
    unsubs.push(wavePoints.subscribe(() => render()));
    unsubs.push(waveOverlayVisible.subscribe(() => render()));
    unsubs.push(waveGridMetaStore.subscribe(() => render()));
  }));

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    removeOverlay();
  });
</script>
