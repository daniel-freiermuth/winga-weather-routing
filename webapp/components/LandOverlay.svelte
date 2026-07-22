<script lang="ts">
  // Renderless Svelte component — renders land polygons (original + dilated safety margin)
  // as GeoJSON canvas layers on the map.

  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { mapInstance, landOverlayVisible } from '../stores';
  import * as dataLayer from '../data-layer';

  const L = globalThis.L as typeof import('leaflet');

  interface Props {
    /** Callback to query whether safety margin is enabled in routing options */
    useSafetyMargin: () => boolean;
  }

  let { useSafetyMargin }: Props = $props();

  let layerOrig: L.GeoJSON | null = null;
  let layerDilated: L.GeoJSON | null = null;
  let map: L.Map | null = null;
  let renderToken = 0;

  async function render() {
    if (!map) return;
    const token = ++renderToken;

    if (layerOrig) { map.removeLayer(layerOrig); layerOrig = null; }
    if (layerDilated) { map.removeLayer(layerDilated); layerDilated = null; }

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

    // The GeoJSON data is typed as GeoJSON.FeatureCollection but L.geoJSON accepts a broader type
    layerOrig = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      style: { color: '#6c7086', weight: 0.5, fillColor: '#45475a', fillOpacity: 0.6, pane: 'landPane' },
      renderer: L.canvas({ pane: 'landPane' }),
    } as L.GeoJSONOptions).addTo(map);

    const safetyOn = dataLayer.dilatedLandDataReady() && useSafetyMargin();
    if (safetyOn) {
      const data2 = dataLayer.getLandPolygonsGeoJSON(bbox, true);
      if (token !== renderToken || !get(landOverlayVisible)) return;

      layerDilated = L.geoJSON(data2 as unknown as GeoJSON.GeoJsonObject, {
        style: { color: '#9399b2', weight: 0.5, fillColor: '#585b70', fillOpacity: 0.4, pane: 'landDilatedPane' },
        renderer: L.canvas({ pane: 'landDilatedPane' }),
      } as L.GeoJSONOptions).addTo(map);
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
    if (layerOrig && map) map.removeLayer(layerOrig);
    if (layerDilated && map) map.removeLayer(layerDilated);
  });
</script>
