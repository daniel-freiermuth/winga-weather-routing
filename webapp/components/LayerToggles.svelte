<script lang="ts">
  import {
    windOverlayVisible,
    waveOverlayVisible,
    currentOverlayVisible,
    landOverlayVisible,
    regionOverlayVisible,
    isochroneVisible,
  } from '../stores';

  interface Props {
    regionEnabled?: boolean;
  }

  let { regionEnabled = false }: Props = $props();

  let windChecked = $state(true);
  let waveChecked = $state(false);
  let currentChecked = $state(false);
  let landChecked = $state(false);
  let isochroneChecked = $state(true);
  let regionChecked = $state(false);

  $effect(() => {
    windOverlayVisible.set(windChecked);
  });
  $effect(() => {
    waveOverlayVisible.set(waveChecked);
  });
  $effect(() => {
    currentOverlayVisible.set(currentChecked);
  });
  $effect(() => {
    landOverlayVisible.set(landChecked);
  });
  $effect(() => {
    isochroneVisible.set(isochroneChecked);
  });
  $effect(() => {
    regionOverlayVisible.set(regionChecked);
  });
</script>

<div class="section">
  <div class="section-title">Layers</div>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={landChecked} />
    <span>Land overlay</span>
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={windChecked} />
    Wind overlay
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={waveChecked} />
    Wave overlay
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={currentChecked} />
    Currents
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={isochroneChecked} />
    Isochrones
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={regionChecked} disabled={!regionEnabled} />
    Regions
  </label>
  <div
    id="region-list"
    style="display: none; flex-direction: column; gap: 4px; margin-top: 4px; max-height: 180px; overflow-y: auto"
  ></div>
</div>

<div id="wave-legend" class:visible={waveChecked}>
  <div id="wave-legend-bar"></div>
  <div id="wave-legend-labels">
    <span id="wave-legend-min">0</span>
    <span id="wave-legend-max">3 m</span>
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #a6adc8;
  }
  .layer-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #cdd6f4;
    cursor: pointer;
    font-size: 14px;
  }
  .layer-toggle input[type='checkbox'] {
    accent-color: #89b4fa;
    cursor: pointer;
  }
  .layer-toggle input[type='checkbox']:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  #wave-legend {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(30, 30, 46, 0.85);
    border-radius: 4px;
    padding: 4px 8px;
    z-index: 1000;
    display: none;
    flex-direction: column;
    gap: 2px;
    font-size: 10px;
    color: #cdd6f4;
  }
  #wave-legend.visible {
    display: flex;
  }
  #wave-legend-bar {
    width: 120px;
    height: 10px;
    border-radius: 2px;
    background: linear-gradient(to right, #00f, #0ff, #0f0, #ff0, #f00);
  }
  #wave-legend-labels {
    display: flex;
    justify-content: space-between;
  }
</style>
