<script lang="ts">
  import type { WaypointMeta } from '../types';

  interface Props {
    visible: boolean;
    expanded: boolean;
    meta: WaypointMeta[];
    onToggle: () => void;
  }
  let { visible, expanded, meta, onToggle }: Props = $props();

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  }

  function windArrow(dir: number): string {
    const chars = ['↓','↙','←','↖','↑','↗','→','↘'];
    return chars[Math.round(dir / 45) % 8] ?? '↓';
  }

  // Windy-style wind speed color ramp (knots → background color).
  // Stops based on Windy's wind overlay palette.
  const WIND_STOPS: [number, number, number, number][] = [
    //  kn,   R,   G,   B
    [  0,   98, 113, 183],   // calm — muted blue
    [  5,   57, 163, 171],   // light — teal
    [ 10,   75, 178, 101],   // gentle — green
    [ 15,  150, 201,  63],   // moderate — yellow-green
    [ 20,  233, 212,  60],   // fresh — yellow
    [ 25,  233, 161,  45],   // strong — orange
    [ 30,  232, 104,  43],   // near gale — dark orange
    [ 40,  199,  51,  61],   // gale — red
    [ 50,  145,  46, 120],   // storm — purple
    [ 60,  113,  31, 106],   // violent storm — dark purple
    [ 80,   80,  10,  80],   // hurricane
  ];

  function windColor(kn: number): string {
    if (kn <= WIND_STOPS[0]![0]) {
      const [, r, g, b] = WIND_STOPS[0]!;
      return `rgb(${String(r)},${String(g)},${String(b)})`;
    }
    for (let i = 1; i < WIND_STOPS.length; i++) {
      const [k1, r1, g1, b1] = WIND_STOPS[i]!;
      if (kn <= k1) {
        const [k0, r0, g0, b0] = WIND_STOPS[i - 1]!;
        const f = (kn - k0) / (k1 - k0);
        const r = Math.round(r0 + (r1 - r0) * f);
        const g = Math.round(g0 + (g1 - g0) * f);
        const b = Math.round(b0 + (b1 - b0) * f);
        return `rgb(${String(r)},${String(g)},${String(b)})`;
      }
    }
    const last = WIND_STOPS[WIND_STOPS.length - 1]!;
    return `rgb(${String(last[1])},${String(last[2])},${String(last[3])})`;
  }

  const hasWave = $derived(meta.some(m => m.waveHeight != null));
  const hasWavePeriod = $derived(meta.some(m => m.wavePeriod != null || m.waveDir != null));
  const hasGust = $derived(meta.some(m => m.gustKn != null));
  const hasCurrent = $derived(meta.some(m => m.currentSpeedKn != null));
  const dateGroups = $derived.by(() => {
    const groups: { date: string; count: number }[] = [];
    for (const m of meta) {
      const d = formatDate(m.time);
      const last = groups[groups.length - 1];
      if (last && last.date === d) last.count++;
      else groups.push({ date: d, count: 1 });
    }
    return groups;
  });
</script>

{#if visible}
<div class="panel" class:collapsed={!expanded}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle" onclick={onToggle}>
    <span>Conditions along route</span>
    <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
  </div>

  {#if expanded && meta.length > 0}
    <div class="table-wrap">
      <table>
        <!-- Date header row -->
        <thead>
          <tr class="date-row">
            <th class="label-cell"></th>
            {#each dateGroups as g}
              <th colspan={g.count} class="date-cell">{g.date}</th>
            {/each}
          </tr>
          <!-- Time header row -->
          <tr class="time-row">
            <th class="label-cell"></th>
            {#each meta as m, i}
              <th class="time-cell" class:departure={i === 0}>{formatTime(m.time)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="label-cell">TWS <span class="unit">kn</span></td>
            {#each meta as m}
              <td class="data-cell wind" style:background-color={windColor(m.tws)}>{m.tws.toFixed(1)}</td>
            {/each}
          </tr>
          {#if hasGust}
            <tr>
              <td class="label-cell">Gust <span class="unit">kn</span></td>
              {#each meta as m}
                <td class="data-cell wind" style:background-color={windColor(m.gustKn ?? 0)}>{m.gustKn != null ? m.gustKn.toFixed(1) : '—'}</td>
              {/each}
            </tr>
          {/if}
          <tr>
            <td class="label-cell">Wind</td>
            {#each meta as m}
              <td class="data-cell">{windArrow(m.windDir)}{Math.round(m.windDir)}°</td>
            {/each}
          </tr>
          <tr>
            <td class="label-cell">TWA</td>
            {#each meta as m}
              <td class="data-cell">{Math.round(m.twa)}°</td>
            {/each}
          </tr>
          <tr>
            <td class="label-cell">CTW</td>
            {#each meta as m}
              <td class="data-cell">{Math.round(m.heading)}°</td>
            {/each}
          </tr>
          <tr>
            <td class="label-cell">STW <span class="unit">kn</span></td>
            {#each meta as m}
              <td class="data-cell">{m.boatSpeed != null ? m.boatSpeed.toFixed(1) : '—'}</td>
            {/each}
          </tr>
          <tr>
            <td class="label-cell">COG</td>
            {#each meta as m}
              <td class="data-cell">{m.cogDeg != null ? `${Math.round(m.cogDeg)}°` : '—'}</td>
            {/each}
          </tr>
          <tr>
            <td class="label-cell">SOG <span class="unit">kn</span></td>
            {#each meta as m}
              <td class="data-cell">{m.sogKn != null ? m.sogKn.toFixed(1) : '—'}</td>
            {/each}
          </tr>
          {#if hasWave}
            <tr>
              <td class="label-cell">Wave <span class="unit">m</span></td>
              {#each meta as m}
                <td class="data-cell">{m.waveHeight != null ? m.waveHeight.toFixed(1) : '—'}</td>
              {/each}
            </tr>
          {/if}
          {#if hasWavePeriod}
            <tr>
              <td class="label-cell">Period <span class="unit">s</span></td>
              {#each meta as m}
                <td class="data-cell">{m.wavePeriod != null ? m.wavePeriod.toFixed(1) : '—'}</td>
              {/each}
            </tr>
            <tr>
              <td class="label-cell">Wave dir</td>
              {#each meta as m}
                <td class="data-cell">{m.waveDir != null ? `${windArrow(m.waveDir)}${Math.round(m.waveDir)}°` : '—'}</td>
              {/each}
            </tr>
          {/if}
          {#if hasCurrent}
            <tr>
              <td class="label-cell">Current <span class="unit">kn</span></td>
              {#each meta as m}
                <td class="data-cell">{m.currentSpeedKn != null ? m.currentSpeedKn.toFixed(1) : '—'}</td>
              {/each}
            </tr>
            <tr>
              <td class="label-cell">Cur dir</td>
              {#each meta as m}
                <td class="data-cell">{m.currentDir != null ? `${windArrow((m.currentDir + 180) % 360)}${Math.round(m.currentDir)}°` : '—'}</td>
              {/each}
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>
{/if}

<style>
  .panel {
    background: #1e2230;
    border-top: 1px solid #313244;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel.collapsed {
    max-height: 24px;
  }
  .handle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #a6adc8;
    background: #2a2f45;
    user-select: none;
    flex-shrink: 0;
  }
  .handle:hover { background: #313244; }
  .toggle-icon { font-size: 10px; }
  .table-wrap {
    overflow-x: auto;
    overflow-y: hidden;
  }
  table {
    border-collapse: collapse;
    color: #cdd6f4;
    white-space: nowrap;
  }
  .label-cell {
    position: sticky;
    left: 0;
    background: #1e2230;
    z-index: 2;
    font-size: 10px;
    font-weight: 600;
    color: #a6adc8;
    padding: 2px 8px 2px 6px;
    text-align: right;
    border-right: 1px solid #45475a;
  }
  .unit {
    font-weight: 400;
    color: #585b70;
  }
  .date-cell {
    font-size: 9px;
    color: #6c7086;
    padding: 1px 4px;
    text-align: center;
    border-bottom: none;
  }
  .time-cell {
    font-size: 9px;
    color: #a6adc8;
    padding: 1px 4px;
    text-align: center;
    border-bottom: 1px solid #45475a;
    min-width: 40px;
  }
  .time-cell.departure {
    color: #89b4fa;
    font-weight: 600;
  }
  .data-cell {
    font-size: 11px;
    padding: 2px 4px;
    text-align: center;
    border-bottom: 1px solid #2a2f45;
  }
  tr:hover .data-cell:not(.wind) {
    background: #313244;
  }
  .data-cell.wind {
    color: #fff;
    font-weight: 600;
    text-shadow: 0 0 3px rgba(0,0,0,0.5);
  }
</style>
