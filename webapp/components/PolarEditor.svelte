<script lang="ts">
  import { parsePolarCsv, interpolateBoatSpeed } from '../../src/lib/polar';
  import type { PolarData } from '../../src/types';

  interface Props {
    visible: boolean;
    polarCsv: string | null;
    onPolarChange: (csv: string) => void;
    onClose: () => void;
  }

  let { visible, polarCsv, onPolarChange, onClose }: Props = $props();

  // ── Layout constants ──
  // Center of the polar at left edge; semicircle sweeps right.
  // 0° TWA at top (CX, CY-R), 90° at right (CX+R, CY), 180° at bottom (CX, CY+R).
  const CX = 45;
  const CY = 255;
  const RADIUS = 220;
  const VB_W = 340;
  const VB_H = 530;

  // ── TWS color palette (blues→greens→oranges→reds) ──
  const PALETTE = [
    '#74c7ec', '#89b4fa', '#89dceb', '#94e2d5', '#a6e3a1',
    '#f9e2af', '#fab387', '#eba0ac', '#f38ba8', '#cba6f7',
    '#f5c2e7', '#b4befe',
  ];
  function twsColor(idx: number): string {
    return PALETTE[idx % PALETTE.length]!;
  }

  // ── Component state ──
  let polar = $state<PolarData>({ tws: [], twa: [], speeds: [] });
  let savedCsv = $state<string | null>(null);
  let editMode = $state(false);
  let hoverTws = $state<number | null>(null);
  let hoverTwa = $state<number | null>(null);
  let hoverBoatSpeed = $state<number | null>(null);
  let hoverPos = $state<{ x: number; y: number } | null>(null);
  let highlightTwsIdx = $state<number | null>(null);
  let dragState = $state<{ twaIdx: number; twsIdx: number } | null>(null);
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  // Quick-generate inputs
  let upwind = $state('5.5');
  let beam = $state('6.5');
  let downwind = $state('6.0');
  let genStatus = $state('');
  let genStatusColor = $state('#a6e3a1');

  // Add TWS input
  let newTwsValue = $state('');

  // ── Derived values ──
  let maxSpeed = $derived.by(() => {
    let m = 2;
    for (const row of polar.speeds) {
      for (const s of row) {
        if (s > m) m = s;
      }
    }
    // Round up to a nice grid ceiling
    return Math.ceil(m / 2) * 2 + 2;
  });

  let gridSpeeds = $derived.by(() => {
    const step = maxSpeed <= 8 ? 2 : maxSpeed <= 16 ? 2 : maxSpeed <= 24 ? 4 : Math.ceil(maxSpeed / 6);
    const lines: number[] = [];
    for (let s = step; s <= maxSpeed; s += step) lines.push(s);
    return lines;
  });

  const GRID_ANGLES = [0, 30, 60, 90, 120, 150, 180];

  // Compute all TWS curves: for each TWS, sample speed at every 1° TWA
  let twsCurves = $derived.by(() => {
    if (polar.tws.length === 0) return [];
    return polar.tws.map((tws, twsIdx) => {
      const points: { x: number; y: number }[] = [];
      for (let twa = 0; twa <= 180; twa++) {
        const speed = interpolateBoatSpeed(polar, twa, tws);
        points.push(toSvg(twa, speed));
      }
      return { tws, twsIdx, points, color: twsColor(twsIdx) };
    });
  });

  // Hover interpolated curve at hoverTws
  let hoverCurve = $derived.by(() => {
    if (hoverTws === null || polar.tws.length === 0) return null;
    const points: { x: number; y: number }[] = [];
    for (let twa = 0; twa <= 180; twa++) {
      const speed = interpolateBoatSpeed(polar, twa, hoverTws);
      points.push(toSvg(twa, speed));
    }
    return points;
  });

  // ── Parse polar CSV on mount/change ──
  $effect(() => {
    if (visible && polarCsv) {
      polar = parsePolarCsv(polarCsv);
      savedCsv = polarCsv;
      editMode = false;
    }
  });

  // ── Coordinate conversion ──
  // TWA 0° = straight up (negative Y from center), 180° = straight down
  // Only the right half is shown (sin(0..180°) ≥ 0)
  function toSvg(twaDeg: number, speed: number): { x: number; y: number } {
    const angle = (twaDeg * Math.PI) / 180;
    const r = (speed / maxSpeed) * RADIUS;
    return {
      x: CX + r * Math.sin(angle),
      y: CY - r * Math.cos(angle),
    };
  }

  function svgToSpeedAngle(sx: number, sy: number): { speed: number; twaDeg: number } {
    const dx = sx - CX;
    const dy = sy - CY;
    const r = Math.sqrt(dx * dx + dy * dy);
    const speed = (r / RADIUS) * maxSpeed;
    // atan2(dx, -dy) gives angle from north (0° up) clockwise
    const twaDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return { speed: Math.max(0, speed), twaDeg };
  }

  // Map SVG mouse position to an SVG-coordinate point
  function clientToSvg(e: MouseEvent): { x: number; y: number } | null {
    if (!svgEl) return null;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    const s = pt.matrixTransform(ctm.inverse());
    return { x: s.x, y: s.y };
  }

  // ── SVG path from points ──
  function pathD(points: { x: number; y: number }[]): string {
    if (points.length === 0) return '';
    let d = `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += `L${points[i]!.x.toFixed(1)},${points[i]!.y.toFixed(1)}`;
    }
    return d;
  }

  // ── Mouse interaction ──
  function handleSvgMouseMove(e: MouseEvent) {
    const pt = clientToSvg(e);
    if (!pt) return;
    hoverPos = pt;

    if (dragState) {
      // Dragging a vertex: constrain angle, change speed
      const { speed } = svgToSpeedAngle(pt.x, pt.y);
      polar.speeds[dragState.twaIdx]![dragState.twsIdx] = Math.round(Math.max(0, speed) * 10) / 10;
    } else if (polar.tws.length > 0) {
      // Map radial distance → TWS for hover curve
      const { speed, twaDeg } = svgToSpeedAngle(pt.x, pt.y);
      const maxTws = Math.max(35, polar.tws[polar.tws.length - 1]!);
      const frac = Math.min(1, Math.max(0, speed / maxSpeed));
      const tws = Math.round(frac * maxTws * 10) / 10;
      hoverTws = tws;
      // Compute TWA and boat speed at this position
      const twa = Math.max(0, Math.min(180, twaDeg));
      hoverTwa = Math.round(twa);
      hoverBoatSpeed = tws > 0 ? Math.round(interpolateBoatSpeed(polar, twa, tws) * 10) / 10 : 0;
    }
  }

  function handleSvgMouseLeave() {
    if (!dragState) {
      hoverTws = null;
      hoverTwa = null;
      hoverBoatSpeed = null;
      hoverPos = null;
    }
  }

  function handleSvgMouseUp() {
    dragState = null;
  }

  function handleVertexDown(twaIdx: number, twsIdx: number, e: MouseEvent) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragState = { twaIdx, twsIdx };
  }

  function handleVertexContext(twaIdx: number, e: MouseEvent) {
    if (!editMode) return;
    e.preventDefault();
    if (polar.twa.length <= 3) return;
    // Remove this TWA row
    const newTwa = polar.twa.filter((_, i) => i !== twaIdx);
    const newSpeeds = polar.speeds.filter((_, i) => i !== twaIdx);
    polar = { tws: [...polar.tws], twa: newTwa, speeds: newSpeeds };
  }

  function handleCurveClick(twsIdx: number, e: MouseEvent) {
    if (!editMode) return;
    e.stopPropagation();
    const pt = clientToSvg(e);
    if (!pt) return;
    const { twaDeg } = svgToSpeedAngle(pt.x, pt.y);
    const twa = Math.round(Math.max(0, Math.min(180, twaDeg)));
    if (polar.twa.includes(twa)) return;
    // Interpolate speeds at this TWA for all TWS columns
    const newRow = polar.tws.map((tws) =>
      Math.round(interpolateBoatSpeed(polar, twa, tws) * 10) / 10
    );
    const idx = polar.twa.findIndex((t) => t > twa);
    const insertAt = idx === -1 ? polar.twa.length : idx;
    const newTwa = [...polar.twa];
    const newSpeeds = polar.speeds.map((r) => [...r]);
    newTwa.splice(insertAt, 0, twa);
    newSpeeds.splice(insertAt, 0, newRow);
    polar = { tws: [...polar.tws], twa: newTwa, speeds: newSpeeds };
  }

  // ── TWS column management ──
  function addTwsColumn() {
    const val = parseFloat(newTwsValue);
    if (isNaN(val) || val <= 0) return;
    if (polar.tws.includes(val)) return;
    const idx = polar.tws.findIndex((t) => t > val);
    const insertAt = idx === -1 ? polar.tws.length : idx;
    const newTws = [...polar.tws];
    newTws.splice(insertAt, 0, val);
    const newSpeeds = polar.speeds.map((row, twaI) => {
      const nr = [...row];
      const speed = polar.tws.length > 0
        ? Math.round(interpolateBoatSpeed(polar, polar.twa[twaI]!, val) * 10) / 10
        : 0;
      nr.splice(insertAt, 0, speed);
      return nr;
    });
    polar = { tws: newTws, twa: [...polar.twa], speeds: newSpeeds };
    newTwsValue = '';
  }

  function removeTwsColumn(twsIdx: number) {
    if (polar.tws.length <= 1) return;
    polar = {
      tws: polar.tws.filter((_, i) => i !== twsIdx),
      twa: [...polar.twa],
      speeds: polar.speeds.map((row) => row.filter((_, i) => i !== twsIdx)),
    };
  }

  // ── Quick generate (same cosine interpolation as SettingsModal) ──
  function generatePolar() {
    const u = parseFloat(upwind);
    const b = parseFloat(beam);
    const d = parseFloat(downwind);
    if (isNaN(u) || isNaN(b) || isNaN(d)) {
      genStatus = 'Enter all three speeds';
      genStatusColor = '#f38ba8';
      return;
    }

    const refTws = 12;
    const twsValues = [6, 8, 10, 12, 14, 16, 20, 25];
    const twaValues = [45, 52, 60, 75, 90, 110, 130, 150, 170, 180];

    // Anchor points: upwind speed at ~55° TWA, beam at 90°, downwind at 150°
    // Below 52° TWA: ramp from 0 at 45° to upwind speed at 52°
    const speedAtTwa = (twa: number): number => {
      if (twa <= 45) return 0;
      if (twa <= 52) return u * ((twa - 45) / 7);
      if (twa <= 90) return u + ((b - u) * (1 - Math.cos(((twa - 52) / 38) * Math.PI))) / 2;
      if (twa <= 150) return b + ((d - b) * (1 - Math.cos(((twa - 90) / 60) * Math.PI))) / 2;
      return d * (1 - 0.15 * ((twa - 150) / 30));
    };

    const speeds: number[][] = [];
    for (const twa of twaValues) {
      const base = speedAtTwa(twa);
      speeds.push(
        twsValues.map((tws) =>
          Math.round(base * Math.min(1.3, Math.sqrt(tws / refTws)) * 10) / 10
        )
      );
    }

    polar = { tws: twsValues, twa: twaValues, speeds };
    genStatus = `Generated: ${u}/${b}/${d} kn (upwind/beam/downwind)`;
    genStatusColor = '#a6e3a1';
    editMode = true;
  }

  // ── File import ──
  function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const csv = reader.result as string;
      polar = parsePolarCsv(csv);
      savedCsv = csv;
      editMode = false;
      genStatus = `Loaded: ${file.name}`;
      genStatusColor = '#a6e3a1';
    };
    reader.readAsText(file);
  }

  // ── Serialization ──
  function polarToCsv(p: PolarData): string {
    let csv = 'twa/tws;' + p.tws.join(';') + '\n';
    for (let i = 0; i < p.twa.length; i++) {
      csv += String(p.twa[i]) + ';' + p.speeds[i]!.map((s) => s.toFixed(1)).join(';') + '\n';
    }
    return csv;
  }

  // ── Save / Cancel / Reset ──
  function handleSave() {
    const csv = polarToCsv(polar);
    localStorage.setItem('wr-polar-csv', csv);
    onPolarChange(csv);
    savedCsv = csv;
    editMode = false;
    onClose();
  }

  function handleCancel() {
    if (savedCsv) polar = parsePolarCsv(savedCsv);
    editMode = false;
    onClose();
  }

  function handleReset() {
    if (savedCsv) {
      polar = parsePolarCsv(savedCsv);
    } else if (polarCsv) {
      polar = parsePolarCsv(polarCsv);
    }
    editMode = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if visible}
<div class="overlay" onclick={handleCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <!-- Header -->
    <div class="header">
      <h2>Polar Diagram</h2>
      <div class="header-actions">
        <button
          class="mode-btn"
          class:active={editMode}
          onclick={() => (editMode = !editMode)}
        >
          {editMode ? 'Done Editing' : 'Edit Diagram'}
        </button>
        <button class="close-btn" onclick={handleCancel} aria-label="Close">✕</button>
      </div>
    </div>

    <!-- Import / Quick generate bar -->
    <div class="import-bar">
      <label class="file-label">
        📁 Import CSV
        <input type="file" accept=".csv,.txt" onchange={handleFileUpload} />
      </label>
      <div class="gen-group">
        <span class="gen-label">Generate from typical speeds at 12 kn TWS:</span>
        <div class="gen-inputs">
          <label class="gen-field">Upwind (55°) <input type="number" step="0.1" min="0" placeholder="kn" bind:value={upwind} class="gen-input" /></label>
          <label class="gen-field">Beam (90°) <input type="number" step="0.1" min="0" placeholder="kn" bind:value={beam} class="gen-input" /></label>
          <label class="gen-field">Downwind (150°) <input type="number" step="0.1" min="0" placeholder="kn" bind:value={downwind} class="gen-input" /></label>
          <button class="gen-btn" onclick={generatePolar}>Generate</button>
        </div>
      </div>
      {#if genStatus}
        <span class="gen-status" style="color: {genStatusColor}">{genStatus}</span>
      {/if}
    </div>

    <div class="polar-note">
      The polar diagram shows <strong>boat speed through water</strong> for each combination of
      <strong>True Wind Angle</strong> (TWA) and <strong>True Wind Speed</strong> (TWS).
      Both are relative to the water, not the ground:
      TWA is measured between the wind direction and the boat's <em>course through water</em>
      (including leeway), not the compass heading.
      TWS is the <em>wind speed over water</em> — when ocean current is present, the routing
      algorithm subtracts the current vector from the true wind before reading the polar.
    </div>

    <!-- Main content: SVG + side panel -->
    <div class="content">
      <!-- SVG polar diagram -->
      <div class="svg-wrap">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <svg
          bind:this={svgEl}
          viewBox="0 0 {VB_W} {VB_H}"
          xmlns="http://www.w3.org/2000/svg"
          onmousemove={handleSvgMouseMove}
          onmouseleave={handleSvgMouseLeave}
          onmouseup={handleSvgMouseUp}
        >
          <!-- Grid: concentric semicircle arcs (speed rings) -->
          {#each gridSpeeds as speed}
            {@const r = (speed / maxSpeed) * RADIUS}
            <path
              d="M{CX},{CY - r} A{r},{r} 0 0,1 {CX},{CY + r}"
              fill="none"
              stroke="#313244"
              stroke-width="0.5"
            />
            <!-- Speed label on the vertical axis, left of center -->
            <text
              x={CX - 5}
              y={CY - r + 3}
              class="grid-label"
              text-anchor="end"
            >{speed}</text>
          {/each}

          <!-- Grid: radial lines at key TWA angles -->
          {#each GRID_ANGLES as twa}
            {@const angle = (twa * Math.PI) / 180}
            {@const ex = CX + RADIUS * Math.sin(angle)}
            {@const ey = CY - RADIUS * Math.cos(angle)}
            <line
              x1={CX} y1={CY}
              x2={ex} y2={ey}
              stroke="#313244"
              stroke-width="0.5"
            />
            <!-- TWA label at end of radial line -->
            {@const lr = RADIUS + 12}
            {@const lx = CX + lr * Math.sin(angle)}
            {@const ly = CY - lr * Math.cos(angle) + 3}
            <text
              x={lx} y={ly}
              class="grid-label"
              text-anchor={twa === 0 || twa === 180 ? 'middle' : 'start'}
            >{twa}°</text>
          {/each}

          <!-- TWS curves -->
          {#each twsCurves as curve}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <path
              d={pathD(curve.points)}
              fill="none"
              stroke={curve.color}
              stroke-width={highlightTwsIdx === curve.twsIdx ? 3 : 1.5}
              opacity={highlightTwsIdx !== null && highlightTwsIdx !== curve.twsIdx ? 0.25 : 1}
              class="tws-curve"
              style="cursor: {editMode ? 'crosshair' : 'default'}"
              onclick={(e) => handleCurveClick(curve.twsIdx, e)}
            />
            <!-- TWS label at 180° end of curve -->
            {@const last = curve.points[180]}
            {#if last}
              <text
                x={last.x + 4}
                y={last.y + 3}
                fill={curve.color}
                class="curve-label"
              >{curve.tws}kn</text>
            {/if}
          {/each}

          <!-- Hover interpolated curve (dashed white) -->
          {#if hoverCurve && !dragState}
            <path
              d={pathD(hoverCurve)}
              fill="none"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-dasharray="4,3"
              opacity="0.6"
              pointer-events="none"
            />
          {/if}

          <!-- Edit mode: draggable vertex handles -->
          {#if editMode}
            {#each polar.twa as twa, twaIdx}
              {#each polar.tws as _tws, twsIdx}
                {@const spd = polar.speeds[twaIdx]?.[twsIdx] ?? 0}
                {@const pt = toSvg(twa, spd)}
                {@const dragging = dragState?.twaIdx === twaIdx && dragState?.twsIdx === twsIdx}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={dragging ? 5 : 3.5}
                  fill={twsColor(twsIdx)}
                  stroke={dragging ? '#ffffff' : 'none'}
                  stroke-width={dragging ? 1.5 : 0}
                  class="vertex-handle"
                  onmousedown={(e) => handleVertexDown(twaIdx, twsIdx, e)}
                  oncontextmenu={(e) => handleVertexContext(twaIdx, e)}
                />
              {/each}
            {/each}
          {/if}

          <!-- Hover tooltip -->
          {#if hoverTws !== null && hoverPos && !dragState}
            {@const tx = Math.min(hoverPos.x + 10, VB_W - 80)}
            {@const ty = Math.max(hoverPos.y - 12, 14)}
            <rect
              x={tx} y={ty - 11}
              width="76" height="30" rx="3"
              fill="#1e1e2e" stroke="#45475a" stroke-width="0.5"
              opacity="0.92" pointer-events="none"
            />
            <text x={tx + 4} y={ty} fill="#cdd6f4" font-size="9" pointer-events="none">
              TWS {hoverTws.toFixed(1)} kn
            </text>
            {#if hoverTwa !== null && hoverBoatSpeed !== null}
              <text x={tx + 4} y={ty + 12} fill="#a6adc8" font-size="8" pointer-events="none">
                TWA {hoverTwa}° → {hoverBoatSpeed} kn
              </text>
            {/if}
          {/if}
        </svg>
      </div>

      <!-- Side panel: legend + TWS management -->
      <div class="side-panel">
        <h3>Wind Speeds</h3>
        <div class="legend">
          {#each polar.tws as tws, idx}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="legend-item"
              onmouseenter={() => (highlightTwsIdx = idx)}
              onmouseleave={() => (highlightTwsIdx = null)}
            >
              <span class="legend-swatch" style="background:{twsColor(idx)}"></span>
              <span class="legend-val">{tws} kn</span>
              {#if editMode && polar.tws.length > 1}
                <button class="legend-del" onclick={() => removeTwsColumn(idx)} aria-label="Remove {tws} kn">✕</button>
              {/if}
            </div>
          {/each}
        </div>

        {#if editMode}
          <div class="add-tws">
            <input
              type="number" step="1" min="1"
              placeholder="TWS kn"
              bind:value={newTwsValue}
              class="tws-input"
              onkeydown={(e) => { if (e.key === 'Enter') addTwsColumn(); }}
            />
            <button class="add-btn" onclick={addTwsColumn}>+ TWS</button>
          </div>
          <p class="hint">
            Drag handles to change speed.<br/>
            Click a curve to add a TWA point.<br/>
            Right-click a handle to delete its TWA row.
          </p>
        {/if}

        {#if polar.twa.length > 0}
          <div class="data-summary">
            <h3>Data</h3>
            <p>{polar.twa.length} TWA × {polar.tws.length} TWS</p>
            <p>TWA: {polar.twa[0]}° – {polar.twa[polar.twa.length - 1]}°</p>
            <p>TWS: {polar.tws[0]} – {polar.tws[polar.tws.length - 1]} kn</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Bottom action bar -->
    <div class="bottom-bar">
      <button class="btn cancel" onclick={handleCancel}>Cancel</button>
      <button class="btn reset" onclick={handleReset}>Reset</button>
      <button class="btn save" onclick={handleSave} disabled={polar.tws.length === 0}>Save</button>
    </div>
  </div>
</div>
{/if}

<style>
  /* ── Overlay & modal ── */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9000;
  }
  .modal {
    background: #1e2230;
    border: 1px solid #45475a;
    border-radius: 10px;
    width: 92vw;
    max-width: 1000px;
    max-height: 94vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  .polar-note {
    font-size: 10px;
    color: #6c7086;
    line-height: 1.5;
    padding: 4px 16px;
    border-bottom: 1px solid #313244;
  }
  .polar-note strong { color: #a6adc8; }
  .polar-note em { color: #89b4fa; font-style: normal; }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid #45475a;
  }
  .header h2 {
    margin: 0;
    font-size: 15px;
    color: #cdd6f4;
    font-weight: 600;
  }
  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .mode-btn {
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid #45475a;
    background: #313244;
    color: #cdd6f4;
    transition: background 0.15s;
  }
  .mode-btn.active {
    background: #89b4fa;
    color: #1e1e2e;
    border-color: #89b4fa;
    font-weight: 600;
  }
  .close-btn {
    background: none;
    border: none;
    color: #6c7086;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .close-btn:hover {
    color: #cdd6f4;
  }

  /* ── Import bar ── */
  .import-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 16px;
    border-bottom: 1px solid #313244;
    flex-wrap: wrap;
  }
  .file-label {
    font-size: 12px;
    color: #89b4fa;
    cursor: pointer;
    padding: 3px 10px;
    border: 1px solid #45475a;
    border-radius: 4px;
    background: #313244;
    white-space: nowrap;
  }
  .file-label input {
    display: none;
  }
  .gen-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .gen-label {
    font-size: 11px;
    color: #a6adc8;
  }
  .gen-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .gen-field {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: #6c7086;
  }
  .gen-input {
    width: 56px;
    padding: 3px 5px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 3px;
    font-size: 12px;
  }
  .gen-input:focus {
    outline: none;
    border-color: #89b4fa;
  }
  .gen-btn {
    padding: 3px 10px;
    background: #89b4fa;
    color: #1e1e2e;
    border: none;
    border-radius: 3px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .gen-btn:hover {
    background: #74c7ec;
  }
  .gen-status {
    font-size: 11px;
  }

  /* ── Content area ── */
  .content {
    display: flex;
    flex: 1;
    overflow: auto;
    padding: 10px 16px;
    gap: 16px;
    min-height: 0;
  }
  .svg-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  .svg-wrap svg {
    width: 100%;
    max-width: 550px;
    height: auto;
  }

  /* ── SVG styling ── */
  .grid-label {
    fill: #6c7086;
    font-size: 8px;
    font-family: inherit;
  }
  .curve-label {
    font-size: 7.5px;
    font-weight: 600;
    font-family: inherit;
  }
  .tws-curve {
    transition: opacity 0.15s;
  }
  .vertex-handle {
    cursor: grab;
    transition: r 0.1s;
  }
  .vertex-handle:hover {
    stroke: #ffffff;
    stroke-width: 1.5;
  }

  /* ── Side panel ── */
  .side-panel {
    width: 170px;
    flex-shrink: 0;
  }
  .side-panel h3 {
    margin: 0 0 8px;
    font-size: 13px;
    color: #cdd6f4;
    font-weight: 600;
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: default;
  }
  .legend-item:hover {
    background: #313244;
  }
  .legend-swatch {
    width: 14px;
    height: 3px;
    border-radius: 1px;
    flex-shrink: 0;
  }
  .legend-val {
    font-size: 12px;
    color: #cdd6f4;
  }
  .legend-del {
    margin-left: auto;
    background: none;
    border: none;
    color: #f38ba8;
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.5;
  }
  .legend-del:hover {
    opacity: 1;
  }

  .add-tws {
    display: flex;
    gap: 4px;
    margin-top: 10px;
  }
  .tws-input {
    width: 55px;
    padding: 3px 5px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 3px;
    font-size: 12px;
  }
  .tws-input:focus {
    outline: none;
    border-color: #89b4fa;
  }
  .add-btn {
    padding: 3px 8px;
    background: #313244;
    color: #a6e3a1;
    border: 1px solid #45475a;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }
  .add-btn:hover {
    background: #45475a;
  }

  .hint {
    font-size: 10px;
    color: #6c7086;
    margin-top: 10px;
    line-height: 1.5;
  }

  .data-summary {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid #313244;
  }
  .data-summary p {
    font-size: 11px;
    color: #6c7086;
    margin: 2px 0;
  }

  /* ── Bottom bar ── */
  .bottom-bar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 16px;
    border-top: 1px solid #45475a;
  }
  .btn {
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn.cancel {
    background: #45475a;
    color: #cdd6f4;
  }
  .btn.cancel:hover {
    background: #585b70;
  }
  .btn.reset {
    background: #313244;
    color: #f9e2af;
    border: 1px solid #45475a;
  }
  .btn.reset:hover {
    background: #45475a;
  }
  .btn.save {
    background: #89b4fa;
    color: #1e1e2e;
    font-weight: 600;
  }
  .btn.save:hover {
    background: #74c7ec;
  }
  .btn.save:disabled {
    background: #45475a;
    color: #6c7086;
    cursor: not-allowed;
  }
</style>
