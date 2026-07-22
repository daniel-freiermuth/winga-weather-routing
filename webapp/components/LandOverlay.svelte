<script lang="ts">
  // Renderless Svelte component — renders land polygons (original + dilated safety margin)
  // as GeoJSON source + fill/line layers on the map.

  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { mapInstance, landOverlayVisible } from '../stores';
  import * as dataLayer from '../data-layer';

  const ORIG_SOURCE = 'land-orig';
  const ORIG_FILL = 'land-orig-fill';
  const ORIG_LINE = 'land-orig-line';
  const DILATED_SOURCE = 'land-dilated';
  const DILATED_FILL = 'land-dilated-fill';
  const DILATED_LINE = 'land-dilated-line';

  interface Props {
    /** Callback to query whether safety margin is enabled in routing options */
    useSafetyMargin: () => boolean;
  }

  let { useSafetyMargin }: Props = $props();

  let map: import('maplibre-gl').Map | null = null;
  let renderToken = 0;

  function removeLayers(sourceId: string, fillId: string, lineId: string) {
    if (!map) return;
    if (map.getLayer(lineId)) map.removeLayer(lineId);
    if (map.getLayer(fillId)) map.removeLayer(fillId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  function removeAll() {
    removeLayers(ORIG_SOURCE, ORIG_FILL, ORIG_LINE);
    removeLayers(DILATED_SOURCE, DILATED_FILL, DILATED_LINE);
  }

  async function render() {
    if (!map) return;
    const token = ++renderToken;

    removeAll();

    if (!get(landOverlayVisible)) return;

    // Load land data on first use
    if (!dataLayer.landDataReady()) {
      try {
        await dataLayer.loadLandData('./data/edge-index.bin.gz', './data/dilated-edge-index.bin.gz');
      } catch (e) {
        console.warn('Land data load failed:', e);
        return;
      }
    }
    if (token !== renderToken) return;

    const b = map.getBounds();
    const bbox = { latMin: b.getSouth(), latMax: b.getNorth(), lonMin: b.getWest(), lonMax: b.getEast() };

    const data = dataLayer.getLandPolygonsGeoJSON(bbox, false);
    if (token !== renderToken || !get(landOverlayVisible)) return;

    map.addSource(ORIG_SOURCE, { type: 'geojson', data: data as GeoJSON.GeoJSON });
    map.addLayer({
      id: ORIG_FILL,
      type: 'fill',
      source: ORIG_SOURCE,
      paint: { 'fill-color': '#45475a', 'fill-opacity': 0.6 },
    });
    map.addLayer({
      id: ORIG_LINE,
      type: 'line',
      source: ORIG_SOURCE,
      paint: { 'line-color': '#6c7086', 'line-width': 0.5 },
    });

    const safetyOn = dataLayer.dilatedLandDataReady() && useSafetyMargin();
    if (safetyOn) {
      const data2 = dataLayer.getLandPolygonsGeoJSON(bbox, true);
      if (token !== renderToken || !get(landOverlayVisible)) return;

      map.addSource(DILATED_SOURCE, { type: 'geojson', data: data2 as GeoJSON.GeoJSON });
      map.addLayer({
        id: DILATED_FILL,
        type: 'fill',
        source: DILATED_SOURCE,
        paint: { 'fill-color': '#585b70', 'fill-opacity': 0.4 },
      });
      map.addLayer({
        id: DILATED_LINE,
        type: 'line',
        source: DILATED_SOURCE,
        paint: { 'line-color': '#9399b2', 'line-width': 0.5 },
      });
    }
  }

  const unsubs: (() => void)[] = [];

  onMount(() => {
    map = get(mapInstance);

    unsubs.push(landOverlayVisible.subscribe(() => void render()));

    if (map) {
      const handler = () => { if (get(landOverlayVisible)) void render(); };
      map.on('moveend', handler);
      unsubs.push(() => map!.off('moveend', handler));
    }
  });

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    removeAll();
  });
</script>
