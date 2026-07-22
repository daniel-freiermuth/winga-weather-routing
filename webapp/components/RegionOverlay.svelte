<script lang="ts">
  // Renderless Svelte component — manages SignalK region polygons on the map.
  // Shows avoidance regions as semi-transparent red overlays and regular regions as dashed outlines.
  // The region list sidebar is managed here via direct DOM for now.

  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { mapInstance, regionOverlayVisible } from '../stores';

  const SOURCE_ID = 'regions';
  const FILL_LAYER = 'regions-fill';
  const LINE_AVOIDED = 'regions-line-avoided';
  const LINE_NORMAL = 'regions-line-normal';

  interface RegionEntry {
    id: string;
    name: string;
    geometry: GeoJSON.Geometry | undefined;
    _id?: string;
  }

  interface Props {
    skFetch: (path: string, options?: RequestInit) => Promise<Response>;
    escapeHtml: (s: string) => string;
  }

  let { skFetch, escapeHtml }: Props = $props();

  let map: import('maplibre-gl').Map | null = null;
  let regionList: RegionEntry[] = [];
  let regionAvoidIds: string[] = [];

  async function loadRegions() {
    try {
      const r = await skFetch('/signalk/v2/api/resources/regions');
      if (!r.ok) { regionList = []; return; }
      const data: unknown = await r.json();
      if (!data || typeof data !== 'object') { regionList = []; return; }

      regionList = Object.entries(data as Record<string, Record<string, unknown>>)
        .map(([id, entry]) => ({
          id,
          name: (entry?.['name'] as string | undefined) ?? id.slice(0, 8),
          geometry: (entry?.['feature'] as Record<string, unknown> | undefined)?.['geometry'] as GeoJSON.Geometry | undefined,
        }))
        .filter((r) => r.geometry);

      const stored = localStorage.getItem('wr-avoid-regions');
      regionAvoidIds = stored ? (JSON.parse(stored) as string[]) : [];

      renderRegionList();
      renderOverlay();
      const toggle = document.getElementById('region-toggle') as HTMLButtonElement | null;
      if (toggle) toggle.disabled = false;
    } catch {
      regionList = [];
    }
  }

  function renderRegionList() {
    const container = document.getElementById('region-list');
    if (!container) return;
    if (regionList.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    container.innerHTML = regionList
      .map((reg) => {
        const id = reg.id ?? '';
        const name = reg.name ?? id.slice(0, 8);
        const isAvoided = regionAvoidIds.includes(id);
        return `
      <label class="region-item" data-uuid="${escapeHtml(id)}"
        style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;
               cursor:pointer;font-size:12px;color:#cdd6f4;background:${isAvoided ? '#3a1f28' : '#2a2f45'};
               border:1px solid ${isAvoided ? '#f38ba8' : 'transparent'}">
        <input type="checkbox" ${isAvoided ? 'checked' : ''} style="accent-color:#f38ba8;cursor:pointer">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</span>
      </label>`;
      })
      .join('');

    container.querySelectorAll('.region-item').forEach((el) => {
      const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!cb) return;
      cb.addEventListener('change', () => {
        void toggleRegionAvoid((el as HTMLElement).dataset['uuid'] ?? '', cb.checked);
      });
    });
  }

  async function toggleRegionAvoid(uuid: string, avoid: boolean) {
    await loadRegions();
    if (avoid) {
      if (!regionAvoidIds.includes(uuid)) regionAvoidIds.push(uuid);
    } else {
      regionAvoidIds = regionAvoidIds.filter((id) => id !== uuid);
    }
    renderRegionList();
    renderOverlay();
    localStorage.setItem('wr-avoid-regions', JSON.stringify(regionAvoidIds));
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
    if (!get(regionOverlayVisible) || regionList.length === 0) return;

    const avoidedFeatures: GeoJSON.Feature[] = [];
    const normalFeatures: GeoJSON.Feature[] = [];
    for (const reg of regionList) {
      if (!reg.geometry) continue;
      const id = reg.id ?? '';
      const isAvoided = regionAvoidIds.includes(id);
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        id,
        properties: { name: reg.name ?? '', avoided: isAvoided },
        geometry: reg.geometry,
      };
      if (isAvoided) avoidedFeatures.push(feature);
      else normalFeatures.push(feature);
    }
    const features = [...avoidedFeatures, ...normalFeatures];
    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
    });

    // Fill layer with data-driven color based on "avoided" property
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
    // Avoided regions: solid line, weight 2
    map.addLayer({
      id: LINE_AVOIDED,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'avoided'], true],
      paint: {
        'line-color': '#f38ba8',
        'line-width': 2,
      },
    });

    // Normal regions: dashed line, weight 1
    map.addLayer({
      id: LINE_NORMAL,
      type: 'line',
      source: SOURCE_ID,
      filter: ['!=', ['get', 'avoided'], true],
      paint: {
        'line-color': '#6c7086',
        'line-width': 1,
        'line-dasharray': [4, 4],
      },
    });
  }

  /** Called from app.ts to get the list of avoided region IDs for routing */
  export function getAvoidIds(): string[] {
    return regionAvoidIds;
  }

  /** Called from app.ts to reload regions (e.g. after SK connection) */
  export async function reload(): Promise<void> {
    if (get(regionOverlayVisible)) await loadRegions();
  }

  const unsubs: (() => void)[] = [];
  let mapReady = false;

  unsubs.push(mapInstance.subscribe((m) => {
    if (!m || mapReady) return;
    mapReady = true;
    map = m;
    unsubs.push(regionOverlayVisible.subscribe((visible) => {
      if (visible) void loadRegions();
      else renderOverlay();
    }));
  }));

  onDestroy(() => {
    unsubs.forEach(fn => fn());
    removeOverlay();
  });
</script>
