<script lang="ts">
  import type { WaypointWeather } from '../route-weather';

  interface Props {
    data: WaypointWeather[];
  }

  let { data }: Props = $props();

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const windArrow = (dir: number | null) => {
    if (dir == null) return '';
    const chars = ['↓','↙','←','↖','↑','↗','→','↘'];
    return chars[Math.round(dir / 45) % 8] ?? '↓';
  };

  const last = $derived(data[data.length - 1]);
</script>

{#if data.length > 0}
<div class="route-weather-table">
  <div class="header">Route Weather</div>
  <div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>WP</th>
          <th>ETA</th>
          <th class="r">Dist</th>
          <th class="r">Wind</th>
          <th class="r">Gust</th>
          <th class="r">TWA</th>
          <th class="r">SOG</th>
          <th class="r">Wave</th>
        </tr>
      </thead>
      <tbody>
        {#each data as r}
          {@const gustWarning = r.gustKn != null && r.gustKn > 30}
          <tr class:departure={r.idx === 0} class:gust-warning={gustWarning}>
            <td class="wp">{r.idx + 1}</td>
            <td class="eta">{formatTime(r.eta)}</td>
            <td class="r">{r.cumDistNm}</td>
            <td class="r wind">{r.twsKn != null ? `${windArrow(r.twdDeg)} ${r.twsKn}` : '—'}</td>
            <td class="r" class:gust-text={gustWarning}>{r.gustKn ?? '—'}</td>
            <td class="r">{r.twaAbs != null ? `${r.twaAbs}°` : '—'}</td>
            <td class="r">{r.boatSpeedKn ?? '—'}</td>
            <td class="r">{r.waveHeightM ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
      {#if last}
        <tfoot>
          <tr class="summary">
            <td colspan="2">Total</td>
            <td class="r">{last.cumDistNm} nm</td>
            <td class="r" colspan="2">{last.cumDurationH} h</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
</div>
{/if}

<style>
  .route-weather-table {
    margin-top: 8px;
  }
  .header {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #a6adc8;
    margin-bottom: 4px;
  }
  .table-scroll {
    max-height: 300px;
    overflow-y: auto;
  }
  table {
    width: 100%;
    font-size: 11px;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    padding: 2px 4px;
    color: #a6adc8;
    border-bottom: 1px solid #45475a;
  }
  th.r, td.r { text-align: right; }
  td {
    padding: 3px 4px;
    border-bottom: 1px solid #313244;
  }
  td.wp { color: #89b4fa; }
  td.eta { white-space: nowrap; }
  td.wind { white-space: nowrap; }
  tr.departure { background: #313244; }
  tr.gust-warning { background: #3a1f28; }
  .gust-text { color: #f38ba8; }
  .summary {
    font-weight: 600;
    border-top: 2px solid #45475a;
  }
  .summary td { padding: 4px; }
</style>
