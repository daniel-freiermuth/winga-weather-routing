<script lang="ts">
  // Renderless Svelte component — manages a Leaflet LayerGroup on the map.
  // Subscribes to windPoints + windOverlayVisible stores and re-renders
  // when data or visibility changes. Data re-fetch on map move is handled
  // by app.ts (calls fetchWindPoints which updates the windPoints store).

  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { mapInstance, windPoints, windOverlayVisible } from '../stores';
  import { windBarbSvg } from '../wind-barb';

  const L = globalThis.L as typeof import('leaflet');

  let layer: L.LayerGroup | null = null;
  let map: L.Map | null = null;

  function render() {
    if (!map) return;
    if (layer) map.removeLayer(layer);
    layer = null;
    if (!get(windOverlayVisible)) return;

    const points = get(windPoints);
    if (points.length === 0) return;

    layer = L.layerGroup();
    const bounds = map.getBounds();
    const MIN_PX = 40;
    const keptPx: L.Point[] = [];

    for (const { lat, lon, u, v } of points) {
      if (!bounds.contains([lat, lon])) continue;
      const spd = Math.sqrt(u * u + v * v) * 1.94384;
      if (spd < 0.5) continue;

      const px = map.latLngToContainerPoint([lat, lon]);
      let tooClose = false;
      for (const p of keptPx) {
        const dx = p.x - px.x, dy = p.y - px.y;
        if (dx * dx + dy * dy < MIN_PX * MIN_PX) { tooClose = true; break; }
      }
      if (tooClose) continue;

      keptPx.push(px);
      const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
      L.marker([lat, lon], {
        icon: L.divIcon({
          html: `<div style="opacity:0.85;pointer-events:none;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9))">${windBarbSvg(spd, dir, '#ffffff')}</div>`,
          iconSize: [30, 36],
          iconAnchor: [0, 22],
          className: '',
        }),
        pane: 'windOverlayPane',
      }).addTo(layer);
    }
    layer.addTo(map);
  }

  const unsubs: (() => void)[] = [];

  onMount(() => {
    map = get(mapInstance);
    unsubs.push(windPoints.subscribe(() => render()));
    unsubs.push(windOverlayVisible.subscribe(() => render()));
  });

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    if (layer && map) map.removeLayer(layer);
  });
</script>
