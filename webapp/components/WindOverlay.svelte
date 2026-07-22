<script lang="ts">
  // Renderless Svelte component — manages wind barb markers on the map.
  // Subscribes to windPoints + windOverlayVisible stores and re-renders
  // when data or visibility changes. Data re-fetch on map move is handled
  // by app.ts (calls fetchWindPoints which updates the windPoints store).

  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import maplibregl from 'maplibre-gl';
  import { mapInstance, windPoints, windOverlayVisible } from '../stores';
  import { windBarbSvg } from '../wind-barb';

  let markers: maplibregl.Marker[] = [];
  let map: maplibregl.Map | null = null;

  function clearMarkers() {
    for (const m of markers) m.remove();
    markers = [];
  }

  function render() {
    if (!map) return;
    clearMarkers();
    if (!get(windOverlayVisible)) return;

    const points = get(windPoints);
    if (points.length === 0) return;

    const bounds = map.getBounds();
    const MIN_PX = 40;
    const keptPx: { x: number; y: number }[] = [];

    for (const { lat, lon, u, v } of points) {
      if (lat < bounds.getSouth() || lat > bounds.getNorth() ||
          lon < bounds.getWest() || lon > bounds.getEast()) continue;
      const spd = Math.sqrt(u * u + v * v) * 1.94384;
      if (spd < 0.5) continue;

      const px = map.project([lon, lat]);
      let tooClose = false;
      for (const p of keptPx) {
        const dx = p.x - px.x, dy = p.y - px.y;
        if (dx * dx + dy * dy < MIN_PX * MIN_PX) { tooClose = true; break; }
      }
      if (tooClose) continue;

      keptPx.push(px);
      const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

      const el = document.createElement('div');
      el.style.width = '30px';
      el.style.height = '36px';
      el.style.opacity = '0.85';
      el.style.pointerEvents = 'none';
      el.style.filter = 'drop-shadow(0 0 2px rgba(0,0,0,0.9))';
      el.innerHTML = windBarbSvg(spd, dir, '#ffffff');

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom-left' })
        .setLngLat([lon, lat])
        .addTo(map);
      markers.push(marker);
    }
  }

  const unsubs: (() => void)[] = [];
  let mapReady = false;

  unsubs.push(mapInstance.subscribe((m) => {
    if (!m || mapReady) return;
    mapReady = true;
    map = m;
    unsubs.push(windPoints.subscribe(() => render()));
    unsubs.push(windOverlayVisible.subscribe(() => render()));
  }));

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    clearMarkers();
  });
</script>
