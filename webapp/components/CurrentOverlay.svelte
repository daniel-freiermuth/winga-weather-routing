<script lang="ts">
  // Renderless Svelte component — manages ocean current arrows on the map.

  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { mapInstance, currentPoints, currentOverlayVisible } from '../stores';

  const L = globalThis.L as typeof import('leaflet');

  let layer: L.LayerGroup | null = null;
  let map: L.Map | null = null;

  function render() {
    if (!map) return;
    if (layer) map.removeLayer(layer);
    layer = null;
    if (!get(currentOverlayVisible)) return;

    const points = get(currentPoints);
    if (points.length === 0) return;

    layer = L.layerGroup();
    const bounds = map.getBounds();
    const MIN_PX = 40;
    const keptPx: L.Point[] = [];

    for (const { lat, lon, u, v } of points) {
      if (!bounds.contains([lat, lon])) continue;
      const spd = Math.sqrt(u * u + v * v) * 1.94384;
      if (spd < 0.05) continue;

      const px = map.latLngToContainerPoint([lat, lon]);
      let tooClose = false;
      for (const p of keptPx) {
        const dx = p.x - px.x, dy = p.y - px.y;
        if (dx * dx + dy * dy < MIN_PX * MIN_PX) { tooClose = true; break; }
      }
      if (tooClose) continue;
      keptPx.push(px);

      const dir = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
      const len = Math.min(28, Math.max(8, spd * 16));
      const rad = (dir * Math.PI) / 180;
      const dx = Math.sin(rad) * len, dy = -Math.cos(rad) * len;
      const svg =
        `<svg width="40" height="40" viewBox="-20 -20 40 40" xmlns="http://www.w3.org/2000/svg">` +
        `<line x1="0" y1="0" x2="${dx.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#74c7ec" stroke-width="2" stroke-linecap="round"/>` +
        `<polygon points="${dx.toFixed(1)},${dy.toFixed(1)} ` +
        `${(dx - 5 * Math.cos(rad) - 3 * Math.sin(rad)).toFixed(1)},${(dy + 5 * Math.sin(rad) - 3 * Math.cos(rad)).toFixed(1)} ` +
        `${(dx - 5 * Math.cos(rad) + 3 * Math.sin(rad)).toFixed(1)},${(dy + 5 * Math.sin(rad) + 3 * Math.cos(rad)).toFixed(1)}" ` +
        `fill="#74c7ec"/>` +
        `</svg>`;
      L.marker([lat, lon], {
        icon: L.divIcon({
          html: `<div style="opacity:0.85;pointer-events:none">${svg}</div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          className: '',
        }),
        pane: 'currentOverlayPane',
      }).addTo(layer);
    }
    layer.addTo(map);
  }

  const unsubs: (() => void)[] = [];

  onMount(() => {
    map = get(mapInstance);
    unsubs.push(currentPoints.subscribe(() => render()));
    unsubs.push(currentOverlayVisible.subscribe(() => render()));
  });

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    if (layer && map) map.removeLayer(layer);
  });
</script>
