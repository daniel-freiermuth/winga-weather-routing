<script lang="ts">
  // Renderless Svelte component — renders land polygons (original + dilated safety margin)
  // as GeoJSON source + fill/line layers on the map.

  import { onDestroy } from 'svelte';
  import * as dataLayer from '../data-layer';

  const ORIG_SOURCE = 'land-orig';
  const ORIG_FILL = 'land-orig-fill';
  const ORIG_LINE = 'land-orig-line';
  const DILATED_SOURCE = 'land-dilated';
  const DILATED_FILL = 'land-dilated-fill';
  const DILATED_LINE = 'land-dilated-line';

  interface Props {
    map: import('maplibre-gl').Map | null;
    visible: boolean;
    /** Callback to query whether safety margin is enabled in routing options */
    useSafetyMargin: () => boolean;
  }

  let { map, visible, useSafetyMargin }: Props = $props();

  let renderToken = 0;
  let moveendHandler: (() => void) | null = null;
  let currentMap: import('maplibre-gl').Map | null = null;

  function removeLayers(m: import('maplibre-gl').Map, sourceId: string, fillId: string, lineId: string) {
    if (m.getLayer(lineId)) m.removeLayer(lineId);
    if (m.getLayer(fillId)) m.removeLayer(fillId);
    if (m.getSource(sourceId)) m.removeSource(sourceId);
  }

  function removeAll(m: import('maplibre-gl').Map) {
    removeLayers(m, ORIG_SOURCE, ORIG_FILL, ORIG_LINE);
    removeLayers(m, DILATED_SOURCE, DILATED_FILL, DILATED_LINE);
  }

  async function doRender(m: import('maplibre-gl').Map, vis: boolean) {
    const token = ++renderToken;

    removeAll(m);

    if (!vis) return;

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

    const b = m.getBounds();
    const bbox = { latMin: b.getSouth(), latMax: b.getNorth(), lonMin: b.getWest(), lonMax: b.getEast() };

    const data = dataLayer.getLandPolygonsGeoJSON(bbox, false);
    if (token !== renderToken) return;

    m.addSource(ORIG_SOURCE, { type: 'geojson', data: data as GeoJSON.GeoJSON });
    m.addLayer({
      id: ORIG_FILL,
      type: 'fill',
      source: ORIG_SOURCE,
      paint: { 'fill-color': '#45475a', 'fill-opacity': 0.6 },
    });
    m.addLayer({
      id: ORIG_LINE,
      type: 'line',
      source: ORIG_SOURCE,
      paint: { 'line-color': '#6c7086', 'line-width': 0.5 },
    });

    const safetyOn = dataLayer.dilatedLandDataReady() && useSafetyMargin();
    if (safetyOn) {
      const data2 = dataLayer.getLandPolygonsGeoJSON(bbox, true);
      if (token !== renderToken) return;

      m.addSource(DILATED_SOURCE, { type: 'geojson', data: data2 as GeoJSON.GeoJSON });
      m.addLayer({
        id: DILATED_FILL,
        type: 'fill',
        source: DILATED_SOURCE,
        paint: { 'fill-color': '#585b70', 'fill-opacity': 0.4 },
      });
      m.addLayer({
        id: DILATED_LINE,
        type: 'line',
        source: DILATED_SOURCE,
        paint: { 'line-color': '#9399b2', 'line-width': 0.5 },
      });
    }
  }

  function cleanupMoveend() {
    if (moveendHandler && currentMap) {
      currentMap.off('moveend', moveendHandler);
      moveendHandler = null;
    }
  }

  $effect(() => {
    const m = map;
    const vis = visible;

    // Setup/teardown moveend handler when map changes
    if (m !== currentMap) {
      cleanupMoveend();
      currentMap = m;
      if (m) {
        moveendHandler = () => { if (visible) void doRender(m, true); };
        m.on('moveend', moveendHandler);
      }
    }

    if (m) void doRender(m, vis);
  });

  onDestroy(() => {
    cleanupMoveend();
    if (currentMap) removeAll(currentMap);
  });
</script>
