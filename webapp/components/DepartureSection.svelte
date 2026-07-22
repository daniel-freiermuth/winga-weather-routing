<script lang="ts">
  interface Props {
    startCoords?: string | undefined;
    vesselAvailable?: boolean | undefined;
    resources?: { label: string; lat: number; lon: number }[] | undefined;
    startCoordsEl?: HTMLSpanElement | undefined;
    onSetOnMap: () => void;
    onUseVesselPosition: () => void;
    onResourceSelect: (index: number) => void;
  }

  let {
    startCoords = '\u2014',
    vesselAvailable = false,
    resources = [],
    startCoordsEl = $bindable(),
    onSetOnMap,
    onUseVesselPosition,
    onResourceSelect,
  }: Props = $props();

  function handleChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === '') return;
    const idx = parseInt(val);
    if (!isNaN(idx)) onResourceSelect(idx);
  }
</script>

<div class="section-title">Departure</div>
<div class="coord-row">
  <button class="marker-btn" onclick={onSetOnMap}>Set on map</button>
  <span class="coord-value" id="start-coords" bind:this={startCoordsEl}>{startCoords}</span>
</div>
<button
  class="marker-btn"
  disabled={!vesselAvailable}
  title={vesselAvailable ? 'Set start to vessel position' : 'Vessel position not available'}
  onclick={onUseVesselPosition}
>
  Use vessel position
</button>
<select
  id="departure-resource"
  class="departure-select"
  style:display={resources.length > 0 ? undefined : 'none'}
  onchange={handleChange}
>
  <option value="">— set from resources —</option>
  {#each resources as res, i}
    <option value={String(i)}>{res.label}</option>
  {/each}
</select>

<style>
  .section-title {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .coord-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .coord-value {
    font-size: 12px;
    color: #a6adc8;
  }
  .marker-btn {
    font-size: 11px;
    padding: 3px 8px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    cursor: pointer;
  }
  .marker-btn:hover { background: #45475a; }
  .marker-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .departure-select {
    width: 100%;
    margin-top: 4px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
  }
</style>
