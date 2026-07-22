<script lang="ts">
  let coastAvoidance = $state(true);
  let safetyMargin = $state(false);
  let motorBelowKn = $state('');
  let motorSpeedKn = $state('');
  let waitForWind = $state(false);
  let maxWindKn = $state('');
  let maxWaveM = $state('');
  let waypointLabels = $state(true);
  let waypointLabelInterval = $state('0');

  // Expose values for app.ts to read
  export function getOptions() {
    return {
      useLandAvoidance: coastAvoidance,
      useSafetyMargin: safetyMargin,
      motorBelowKn: parseFloat(motorBelowKn) || undefined,
      motorSpeedKn: parseFloat(motorSpeedKn) || undefined,
      waitForWind: waitForWind || undefined,
      maxWindKn: parseFloat(maxWindKn) || undefined,
      maxWaveM: parseFloat(maxWaveM) || undefined,
      waypointLabels,
      waypointLabelInterval: parseFloat(waypointLabelInterval) || 0,
    };
  }
</script>

<div class="routing-options">
  <div class="section-title">Routing Options</div>

  <label class="toggle">
    <input type="checkbox" bind:checked={coastAvoidance} /> Coast avoidance
  </label>

  <label class="toggle">
    <input type="checkbox" bind:checked={safetyMargin} /> Safety margin (0.5 NM)
  </label>

  <div class="group">
    <span class="label">Motor</span>
    <div class="motor-row">
      <span class="label">below</span>
      <input type="number" min="0" max="20" step="0.5" placeholder="kn" bind:value={motorBelowKn} />
      <span class="label">kn, speed</span>
      <input type="number" min="0" max="20" step="0.5" placeholder="kn" bind:value={motorSpeedKn} />
      <span class="label">kn</span>
    </div>
  </div>

  <label class="toggle">
    <input type="checkbox" bind:checked={waitForWind} /> Wait for wind
  </label>

  <label class="field">
    <span class="label">Max wind (kn, empty = no limit)</span>
    <input type="number" min="0" max="200" step="1" bind:value={maxWindKn} />
  </label>

  <label class="field">
    <span class="label">Max wave (m, empty = no limit)</span>
    <input type="number" min="0" max="30" step="0.5" bind:value={maxWaveM} />
  </label>

  <div class="labels-row">
    <label class="toggle">
      <input type="checkbox" bind:checked={waypointLabels} /> Waypoint labels every
    </label>
    <input type="number" min="0" max="48" step="1" class="interval-input" bind:value={waypointLabelInterval} />
    <span class="label">h (0 = all)</span>
  </div>
</div>

<style>
  .routing-options { display: flex; flex-direction: column; gap: 6px; }
  .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #a6adc8; }
  .toggle { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
  .label { font-size: 11px; color: #a6adc8; white-space: nowrap; }
  .group { display: flex; flex-direction: column; gap: 2px; }
  .motor-row { display: flex; gap: 4px; align-items: center; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  input[type="number"] {
    background: #313244; color: #cdd6f4;
    border: 1px solid #45475a; border-radius: 4px;
    padding: 3px 6px; font-size: 12px; width: 60px;
  }
  .field input[type="number"] { width: 100%; }
  .labels-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .interval-input { width: 50px; }
  input[type="checkbox"] { accent-color: #89b4fa; }
</style>
