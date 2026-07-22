<script lang="ts">
  import type { Map } from 'maplibre-gl';

  interface Chart {
    name: string;
    url: string;
    attribution: string;
  }

  interface Props {
    map: Map | null;
    skConnected: boolean;
    skFetch: (path: string, opts?: RequestInit) => Promise<Response>;
  }

  let { map, skConnected, skFetch }: Props = $props();

  const CHART_SOURCE = 'chart-tiles';
  const CHART_LAYER = 'chart-tiles';

  let charts = $state<Chart[]>([
    {
      name: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  ]);
  let selectedIdx = $state(0);
  let initialized = false;

  function expandTileUrls(url: string): string[] {
    if (url.includes('{s}')) {
      return ['a', 'b', 'c'].map((s) => url.replace('{s}', s));
    }
    return [url];
  }

  function applyChart(chart: Chart) {
    if (!map) return;
    if (map.getLayer(CHART_LAYER)) map.removeLayer(CHART_LAYER);
    if (map.getSource(CHART_SOURCE)) map.removeSource(CHART_SOURCE);
    if (map.getLayer('osm')) map.removeLayer('osm');
    if (map.getSource('osm')) map.removeSource('osm');

    map.addSource(CHART_SOURCE, {
      type: 'raster',
      tiles: expandTileUrls(chart.url),
      tileSize: 256,
      attribution: chart.attribution,
    });
    const firstLayer = map.getStyle().layers[0];
    map.addLayer(
      { id: CHART_LAYER, type: 'raster', source: CHART_SOURCE },
      firstLayer?.id,
    );
  }

  function handleChange() {
    const chart = charts[selectedIdx];
    if (chart) applyChart(chart);
  }

  $effect(() => {
    if (!map || initialized) return;
    initialized = true;

    // Load additional charts from SignalK
    if (skConnected) {
      void (async () => {
        try {
          const r = await skFetch('/signalk/v2/api/resources/charts');
          if (r.ok) {
            const data: Record<string, { name?: string; url?: string; serverType?: string }> = await r.json();
            for (const [id, chart] of Object.entries(data)) {
              if (chart.serverType !== 'tilelayer') continue;
              if (chart.url?.includes('.mvt')) continue;
              charts = [...charts, {
                name: chart.name ?? id,
                url: (chart.url ?? '').replace(/\$z/g, '{z}').replace(/\$x/g, '{x}').replace(/\$y/g, '{y}'),
                attribution: chart.name ?? id,
              }];
            }
          }
        } catch {
          /* fall back to OSM only */
        }
      })();
    }

    const first = charts[0];
    if (first) applyChart(first);
  });
</script>

<div class="chart-selector">
  <div class="section-title">Chart</div>
  <select bind:value={selectedIdx} onchange={handleChange}>
    {#each charts as chart, i}
      <option value={i}>{chart.name}</option>
    {/each}
  </select>
</div>

<style>
  .chart-selector { display: flex; flex-direction: column; gap: 4px; }
  .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #a6adc8; }
  select {
    width: 100%; padding: 4px 8px;
    background: #313244; color: #cdd6f4;
    border: 1px solid #45475a; border-radius: 4px;
    font-size: 12px;
  }
</style>
