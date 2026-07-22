<script lang="ts">
  // Manages SignalK region polygons on the map.
  // Shows avoidance regions as semi-transparent red overlays and regular regions as dashed outlines.

  import { onDestroy } from 'svelte';

  const SOURCE_ID = 'regions';
  const FILL_LAYER = 'regions-fill';
  const LINE_AVOIDED = 'regions-line-avoided';
  const LINE_NORMAL = 'regions-line-normal';

  interface RegionEntry {
    id: string;
    name: string;
    geometry: GeoJSON.Geometry | undefined;
  }

  interface Props {
    map: import('maplibre-gl').Map | null;
    visible: boolean;
    skFetch: (path: string, options?: RequestInit) => Promise<Response>;
    onRegionsChange?: (regions: { id: string; name: string; avoided: boolean }[]) => void;
  }

  let { map, visible, skFetch, onRegionsChange }: Props = $props();

  let regionList: RegionEntry[] = [];
  let regionAvoidIds: string[] = [];

  function notifyParent() {
    onRegionsChange?.(regionList.map(r => ({
      id: r.id,
      name: r.name,
      avoided: regionAvoidIds.includes(r.id),
    })));
  }

  async function loadRegions() {
    try {
      const r = await skFetch('/signalk/v2/api/resources/regions');
      if (!r.ok) { regionList = []; notifyParent(); return; }
      const data: unknown = await r.json();
      if (!data || typeof data !== 'object') { regionList = []; notifyParent(); return; }

      regionList = Object.entries(data as Record<string, Record<string, unknown>>)
        .map(([id, entry]) => ({
          id,
          name: (entry?.['name'] as string | undefined) ?? id.slice(0, 8),
          geometry: (entry?.['feature'] as Record<string, unknown> | undefined)?.['geometry'] as GeoJSON.Geometry | undefined,
        }))
        .filter((r) => r.geometry);

      const stored = localStorage.getItem('wr-avoid-regions');
      regionAvoidIds = stored ? (JSON.parse(stored) as string[]) : [];

      notifyParent();
      renderOverlay();
    } catch {
      regionList = [];
      notifyParent();
    }
  }

  export function toggleAvoid(uuid: string, avoid: boolean) {
    if (avoid) {
      if (!regionAvoidIds.includes(uuid)) regionAvoidIds = [...regionAvoidIds, uuid];
    } else {
      regionAvoidIds = regionAvoidIds.filter((id) => id !== uuid);
    }
    localStorage.setItem('wr-avoid-regions', JSON.stringify(regionAvoidIds));
    notifyParent();
    renderOverlay();
  }

  function removeOverlay() {
    if (!map) return;
    if (map.getLayer(LINE_NORMAL)) map.removeLayer(LINE_NORMAL);
    if (map.getLayer(LINE_AVOIDED)) map.removeLayer(LINE_AVOIDED);
    if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function renderOverlay() {
    if (!map) return;
    removeOverlay();
    if (!visible || regionList.length === 0) return;

    const features: GeoJSON.Feature[] = regionList
      .filter(r => r.geometry)
      .map(r => ({
        type: 'Feature' as const,
        id: r.id,
        properties: { name: r.name, avoided: regionAvoidIds.includes(r.id) },
        geometry: r.geometry!,
      }));
    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
    });

    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'avoided'], true],
          'rgba(243,139,168,0.3)',
          'rgba(148,148,148,0.15)',
        ],
        'fill-opacity': 1,
      },
    });
    map.addLayer({
      id: LINE_AVOIDED,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'avoided'], true],
      paint: { 'line-color': '#f38ba8', 'line-width': 2 },
    });
    map.addLayer({
      id: LINE_NORMAL,
      type: 'line',
      source: SOURCE_ID,
      filter: ['!=', ['get', 'avoided'], true],
      paint: { 'line-color': '#6c7086', 'line-width': 1, 'line-dasharray': [4, 4] },
    });
  }

  export function getAvoidIds(): string[] {
    return regionAvoidIds;
  }

  export async function reload(): Promise<void> {
    if (visible) await loadRegions();
  }

  $effect(() => {
    if (!map) return;
    if (visible) void loadRegions();
    else renderOverlay();
  });

  onDestroy(() => removeOverlay());
</script>
