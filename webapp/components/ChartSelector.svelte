<script lang="ts">
  import { onMount } from 'svelte';
  import { mapInstance, skConnected } from '../stores';
  import { get } from 'svelte/store';

  const L = globalThis.L as typeof import('leaflet');

  interface Chart {
    name: string;
    url: string;
    attribution: string;
  }

  interface Props {
    skFetch: (path: string, opts?: RequestInit) => Promise<Response>;
  }

  let { skFetch }: Props = $props();

  let charts = $state<Chart[]>([
    {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  ]);
  let selectedIdx = $state(0);
  let tileLayer: L.TileLayer | null = null;

  function applyChart(chart: Chart) {
    const map = get(mapInstance);
    if (!map) return;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(chart.url, { attribution: chart.attribution, maxZoom: 19 }).addTo(map);
  }

  function handleChange() {
    const chart = charts[selectedIdx];
    if (chart) applyChart(chart);
  }

  onMount(async () => {
    // Load additional charts from SignalK
    if (get(skConnected)) {
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
    }

    // Apply the default chart
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
