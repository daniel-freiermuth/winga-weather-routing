<script lang="ts">
  import { onMount } from 'svelte';

  interface RegionInfo {
    id: string;
    name: string;
    avoided: boolean;
  }

  interface Props {
    windVisible: boolean;
    waveVisible: boolean;
    currentVisible: boolean;
    landVisible: boolean;
    isochroneVisible: boolean;
    regionVisible: boolean;
    regionEnabled: boolean;
    regions: RegionInfo[];
    onToggleRegionAvoid?: (id: string, avoid: boolean) => void;
  }

  let {
    windVisible = $bindable(),
    waveVisible = $bindable(),
    currentVisible = $bindable(),
    landVisible = $bindable(),
    isochroneVisible = $bindable(),
    regionVisible = $bindable(),
    regionEnabled,
    regions = [],
    onToggleRegionAvoid,
  }: Props = $props();

  let expanded = $state(false);
  let containerEl: HTMLDivElement | undefined = $state();

  function toggle() {
    expanded = !expanded;
  }

  function handleClickOutside(e: MouseEvent) {
    if (expanded && containerEl && !containerEl.contains(e.target as Node)) {
      expanded = false;
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  });
</script>

<div class="layer-control" bind:this={containerEl}>
  <button class="layer-btn" onclick={toggle} aria-label="Toggle layer controls">
    ≡
  </button>
  {#if expanded}
    <div class="layer-panel">
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={landVisible} />
        <span>Land overlay</span>
      </label>
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={windVisible} />
        <span>Wind overlay</span>
      </label>
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={waveVisible} />
        <span>Wave overlay</span>
      </label>
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={currentVisible} />
        <span>Currents</span>
      </label>
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={isochroneVisible} />
        <span>Isochrones</span>
      </label>
      <label class="layer-toggle">
        <input type="checkbox" bind:checked={regionVisible} disabled={!regionEnabled} />
        <span>Regions</span>
      </label>
      {#if regions.length > 0}
        <div class="region-list">
          {#each regions as reg}
            <label class="region-item" class:avoided={reg.avoided}>
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
  {/if}
</div>

<style>
  .layer-control {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 10;
  }
  .layer-btn {
    width: 36px;
    height: 36px;
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    color: #cdd6f4;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .layer-btn:hover {
    background: #45475a;
  }
  .layer-panel {
    position: absolute;
    top: 40px;
    right: 0;
    background: #1e2230;
    border: 1px solid #45475a;
    border-radius: 8px;
    padding: 8px;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: panelFadeIn 0.15s ease-out;
  }
  .layer-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #cdd6f4;
    cursor: pointer;
    font-size: 13px;
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
  @keyframes panelFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
