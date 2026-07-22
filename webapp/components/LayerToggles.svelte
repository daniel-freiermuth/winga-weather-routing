<script lang="ts">
  interface RegionInfo {
    id: string;
    name: string;
    avoided: boolean;
  }

  interface Props {
    regionEnabled?: boolean;
    windVisible: boolean;
    waveVisible: boolean;
    currentVisible: boolean;
    landVisible: boolean;
    regionVisible: boolean;
    isochroneVisible: boolean;
    regions?: RegionInfo[];
    onToggleRegionAvoid?: (id: string, avoid: boolean) => void;
  }

  let {
    regionEnabled = false,
    windVisible = $bindable(),
    waveVisible = $bindable(),
    currentVisible = $bindable(),
    landVisible = $bindable(),
    regionVisible = $bindable(),
    isochroneVisible = $bindable(),
    regions = [],
    onToggleRegionAvoid,
  }: Props = $props();
</script>

<div class="section">
  <div class="section-title">Layers</div>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={landVisible} />
    <span>Land overlay</span>
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={windVisible} />
    Wind overlay
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={waveVisible} />
    Wave overlay
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={currentVisible} />
    Currents
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={isochroneVisible} />
    Isochrones
  </label>
  <label class="layer-toggle">
    <input type="checkbox" bind:checked={regionVisible} disabled={!regionEnabled} />
    Regions
  </label>
  {#if regions.length > 0}
    <div class="region-list">
      {#each regions as reg}
        <label
          class="region-item"
          class:avoided={reg.avoided}
        >
          <input
            type="checkbox"
            checked={reg.avoided}
            onchange={() => onToggleRegionAvoid?.(reg.id, !reg.avoided)}
          />
          <span class="region-name">{reg.name}</span>
        </label>
      {/each}
    </div>
  {/if}
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
  .region-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    max-height: 180px;
    overflow-y: auto;
  }
  .region-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #cdd6f4;
    background: #2a2f45;
    border: 1px solid transparent;
  }
  .region-item.avoided {
    background: #3a1f28;
    border-color: #f38ba8;
  }
  .region-item input[type='checkbox'] {
    accent-color: #f38ba8;
    cursor: pointer;
  }
  .region-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
