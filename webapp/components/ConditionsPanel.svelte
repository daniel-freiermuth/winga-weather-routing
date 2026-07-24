<script lang="ts">
  import { tick } from 'svelte';
  import type { WaypointMeta } from '../types';

  interface Props {
    visible: boolean;
    expanded: boolean;
    meta: WaypointMeta[];
    scrubberTimeMs: number | null;
    onToggle: () => void;
    onTimeClick: (timeMs: number) => void;
  }
  let { visible, expanded, meta, scrubberTimeMs, onToggle, onTimeClick }: Props = $props();

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
  const WIND_STOPS: [number, number, number, number][] = [
    [  0,   98, 113, 183],
    [  5,   57, 163, 171],
    [ 10,   75, 178, 101],
    [ 15,  150, 201,  63],
    [ 20,  233, 212,  60],
    [ 25,  233, 161,  45],
    [ 30,  232, 104,  43],
    [ 40,  199,  51,  61],
    [ 50,  145,  46, 120],
    [ 60,  113,  31, 106],
    [ 80,   80,  10,  80],
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
  const hasWow = $derived(meta.some(m => m.wowTws != null));

  // Wind speed unit cycling: kn → m/s → km/h → Bft
  const WIND_UNITS = ['kn', 'm/s', 'km/h', 'Bft'] as const;
  type WindUnit = typeof WIND_UNITS[number];
  let windUnit = $state<WindUnit>('kn');

  function cycleWindUnit() {
    const idx = WIND_UNITS.indexOf(windUnit);
    windUnit = WIND_UNITS[(idx + 1) % WIND_UNITS.length]!;
  }

  /** Convert knots to the active wind unit. */
  function convertWind(kn: number): string {
    switch (windUnit) {
      case 'kn': return kn.toFixed(1);
      case 'm/s': return (kn * 0.514444).toFixed(1);
      case 'km/h': return (kn * 1.852).toFixed(1);
      case 'Bft': {
        const bft = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
        let b = 0;
        for (b = 0; b < bft.length; b++) { if (kn < bft[b]!) break; }
        return String(b);
      }
    }
  }

  /** Encounter wave period (s) — perceived by the moving boat.
   *  Uses deep-water dispersion: ω_e = ω₀(1 − ω₀·V·cos(μ)/g). */
  function encounterPeriod(m: WaypointMeta): number | undefined {
    if (m.wavePeriod == null || m.waveDir == null || m.boatSpeed == null) return undefined;
    const T = m.wavePeriod;
    if (T < 0.5) return undefined;
    const V = m.boatSpeed * 0.514444; // knots → m/s
    // μ = angle between heading (CTW) and wave propagation direction
    // waveDir = FROM convention; propagation = waveDir + 180
    const wavePropDir = (m.waveDir + 180) % 360;
    const mu = Math.abs(((m.heading - wavePropDir + 540) % 360) - 180); // 0=following, 180=head
    const omega0 = 2 * Math.PI / T;
    const g = 9.81;
    const omegaE = omega0 * (1 - (omega0 / g) * V * Math.cos(mu * Math.PI / 180));
    if (omegaE < 0.05) return undefined; // boat outruns waves — period undefined
    return 2 * Math.PI / omegaE;
  }

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

  // Active column: closest waypoint to scrubber time
  const activeCol = $derived.by(() => {
    if (scrubberTimeMs == null || meta.length === 0) return -1;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < meta.length; i++) {
      const diff = Math.abs(new Date(meta[i]!.time).getTime() - scrubberTimeMs);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  });

  function handleColClick(colIdx: number) {
    const m = meta[colIdx];
    if (m) onTimeClick(new Date(m.time).getTime());
  }

  // Auto-scroll to keep active column in view
  let tableWrap = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (activeCol < 0 || !tableWrap || !expanded) return;
    void tick().then(() => {
      if (!tableWrap) return;
      const th = tableWrap.querySelector(`.time-cell:nth-child(${String(activeCol + 2)})`) as HTMLElement | null;
      if (!th) return;
      const wrapRect = tableWrap.getBoundingClientRect();
      const thRect = th.getBoundingClientRect();
      const thCenter = (thRect.left + thRect.right) / 2;
      // Visible zone boundaries: middle 50% of the scroll container
      const visLeft = wrapRect.left + wrapRect.width * 0.25;
      const visRight = wrapRect.left + wrapRect.width * 0.75;
      if (thCenter < visLeft) {
        // Scroll left to center the column
        tableWrap.scrollLeft += thCenter - (wrapRect.left + wrapRect.width * 0.5);
      } else if (thCenter > visRight) {
        // Scroll right to center the column
        tableWrap.scrollLeft += thCenter - (wrapRect.left + wrapRect.width * 0.5);
      }
    });
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
    <div class="table-wrap" bind:this={tableWrap}>
      <table>
        <thead>
          <tr class="date-row">
            <th class="label-cell"></th>
            {#each dateGroups as g}
              <th colspan={g.count} class="date-cell">{g.date}</th>
            {/each}
          </tr>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <tr class="time-row">
            <th class="label-cell"></th>
            {#each meta as m, i}
              <th
                class="time-cell"
                class:departure={i === 0}
                class:active={i === activeCol}
                onclick={() => handleColClick(i)}
              >{formatTime(m.time)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#snippet dataRow(label: string, unit: string, values: (string | null)[], colorFn?: (i: number) => string | null, onUnitClick?: () => void, tip?: string)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <tr>
              <td class="label-cell" title={tip}>{#if unit}<span class="unit" class:unit-clickable={onUnitClick != null} onclick={onUnitClick}>{unit}</span> {/if}{label}</td>
              {#each values as v, i}
                <td
                  class="data-cell"
                  class:wind={colorFn != null && colorFn(i) != null}
                  class:active={i === activeCol}
                  style:background-color={colorFn?.(i) ?? undefined}
                  onclick={() => handleColClick(i)}
                >{v ?? '—'}</td>
              {/each}
            </tr>
          {/snippet}

          {@render dataRow('TWS', windUnit,
            meta.map(m => convertWind(m.tws)),
            (i) => windColor(meta[i]!.tws),
            cycleWindUnit,
            'True Wind Speed — forecast wind speed (not adjusted for current)')}
          {#if hasGust}
            {@render dataRow('Gust', windUnit,
              meta.map(m => m.gustKn != null ? convertWind(m.gustKn) : null),
              (i) => { const g = meta[i]!.gustKn; return g != null ? windColor(g) : null; },
              cycleWindUnit,
              'Gust speed — peak wind speed from the forecast model')}
          {/if}
          {@render dataRow('Wind', '°',
            meta.map(m => `${windArrow(m.windDir)}${Math.round(m.windDir)}`),
            undefined, undefined,
            'True wind direction — where the wind blows FROM (meteorological convention)')}
          {#if hasWow}
            {@render dataRow('WoW', windUnit,
              meta.map(m => m.wowTws != null ? convertWind(m.wowTws) : null),
              (i) => { const w = meta[i]!.wowTws; return w != null ? windColor(w) : null; },
              cycleWindUnit,
              'Wind over Water speed — true wind minus current (what the boat feels)')}
            {@render dataRow('WoW dir', '°',
              meta.map(m => m.wowDir != null ? `${windArrow(m.wowDir)}${Math.round(m.wowDir)}` : null),
              undefined, undefined,
              'Wind over Water direction — true wind adjusted for current (FROM convention)')}
          {/if}
          {@render dataRow('TWA', '°',
            meta.map(m => `${Math.round(m.twa)}`),
            undefined, undefined,
            'True Wind Angle — |CTW − WoW direction|, the angle the boat sails relative to the wind-over-water')}
          {@render dataRow('CTW', '°',
            meta.map(m => `${Math.round(m.heading)}`),
            undefined, undefined,
            'Course Through Water — direction the boat moves through the water (before current drift)')}
          {@render dataRow('STW', 'kn',
            meta.map(m => m.boatSpeed != null ? m.boatSpeed.toFixed(1) : null),
            undefined, undefined,
            'Speed Through Water — boat speed from the polar diagram at this TWS/TWA')}
          {@render dataRow('COG', '°',
            meta.map(m => m.cogDeg != null ? `${Math.round(m.cogDeg)}` : null),
            undefined, undefined,
            'Course Over Ground — actual track direction including current drift')}
          {@render dataRow('SOG', 'kn',
            meta.map(m => m.sogKn != null ? m.sogKn.toFixed(1) : null),
            undefined, undefined,
            'Speed Over Ground — actual speed including current (distance / time between waypoints)')}
          {#if hasWave}
            {@render dataRow('Wave', 'm',
              meta.map(m => m.waveHeight != null ? m.waveHeight.toFixed(1) : null),
              undefined, undefined,
              'Significant Wave Height — average height of the highest ⅓ of waves (Hs)')}
          {/if}
          {#if hasWavePeriod}
            {@render dataRow('Period', 's',
              meta.map(m => m.wavePeriod != null ? m.wavePeriod.toFixed(1) : null),
              undefined, undefined,
              'Mean Wave Period — average time between successive wave crests')}
            {@render dataRow('Enc. per.', 's',
              meta.map(m => { const te = encounterPeriod(m); return te != null ? te.toFixed(1) : null; }),
              undefined, undefined,
              'Encounter Period — wave period as felt by the moving boat (deep-water approximation; less accurate in shallow water < ~30 m for 6 s waves)')}
            {@render dataRow('Wave dir', '°',
              meta.map(m => m.waveDir != null ? `${windArrow(m.waveDir)}${Math.round(m.waveDir)}` : null),
              undefined, undefined,
              'Wave Direction — where waves propagate FROM')}
          {/if}
          {#if hasCurrent}
            {@render dataRow('Current', 'kn',
              meta.map(m => m.currentSpeedKn != null ? m.currentSpeedKn.toFixed(1) : null),
              undefined, undefined,
              'Ocean Current Speed — from CMEMS forecast')}
            {@render dataRow('Cur dir', '°',
              meta.map(m => m.currentDir != null ? `${windArrow((m.currentDir + 180) % 360)}${Math.round(m.currentDir)}` : null),
              undefined, undefined,
              'Current Direction — where the current flows TOWARDS (arrow shows flow direction)')}
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
    scroll-behavior: smooth;
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
  .unit-clickable {
    cursor: pointer;
    text-decoration: underline dotted;
    color: #89b4fa;
  }
  .unit-clickable:hover {
    color: #b4d0fb;
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
    cursor: pointer;
  }
  .time-cell:hover { color: #cdd6f4; }
  .time-cell.departure {
    color: #89b4fa;
    font-weight: 600;
  }
  .data-cell {
    font-size: 11px;
    padding: 2px 4px;
    text-align: center;
    border-bottom: 1px solid #2a2f45;
    cursor: pointer;
  }
  tr:hover .data-cell:not(.wind):not(.active) {
    background: #313244;
  }
  .data-cell.wind {
    color: #fff;
    font-weight: 600;
    text-shadow: 0 0 3px rgba(0,0,0,0.5);
  }
  /* Active column — scrubber indicator */
  .time-cell.active {
    color: #f9e2af;
    font-weight: 700;
  }
  .data-cell.active:not(.wind) {
    box-shadow: inset 2px 0 0 #f9e2af, inset -2px 0 0 #f9e2af;
  }
  .data-cell.active.wind {
    box-shadow: inset 2px 0 0 rgba(255,255,255,0.7), inset -2px 0 0 rgba(255,255,255,0.7);
  }
  .time-cell.active::after {
    content: '▼';
    display: block;
    font-size: 6px;
    line-height: 1;
    color: #f9e2af;
  }
</style>
