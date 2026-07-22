<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { drawMeteogram, setupMeteogramTooltip } from '../meteogram';
  import type { WaypointWeather } from '../route-weather';

  interface Props {
    data: WaypointWeather[];
  }

  let { data }: Props = $props();

  let canvas: HTMLCanvasElement;
  let tooltip: HTMLElement;
  let collapsed = $state(false);

  onMount(async () => {
    await tick(); // wait for DOM layout
    drawMeteogram(canvas, data);
    setupMeteogramTooltip(canvas, tooltip, data);
  });

  // Redraw when data changes
  $effect(() => {
    if (canvas && data.length > 0) {
      drawMeteogram(canvas, data);
      setupMeteogramTooltip(canvas, tooltip, data);
    }
  });
</script>

{#if data.length > 1}
<div class="meteogram-panel">
  <button class="handle" onclick={() => collapsed = !collapsed}>
    <span>Route weather forecast</span>
    <span class="toggle">{collapsed ? '▶' : '▼'}</span>
  </button>
  {#if !collapsed}
    <div class="body">
      <canvas bind:this={canvas}></canvas>
      <div class="tooltip" bind:this={tooltip}></div>
    </div>
  {/if}
</div>
{/if}

<style>
  .meteogram-panel {
    display: flex;
    flex-direction: column;
    background: #1e2230;
    border-top: 2px solid #313244;
  }
  .handle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 12px;
    background: #2a2f45;
    font-size: 11px;
    color: #6c7086;
    cursor: pointer;
    user-select: none;
    border: none;
    text-align: left;
  }
  .handle:hover { background: #313244; }
  .toggle {
    background: #363a4f;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .body {
    height: 180px;
    position: relative;
  }
  canvas {
    width: 100%;
    height: 100%;
  }
  .tooltip {
    display: none;
    position: absolute;
    background: #1e1e2e;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 11px;
    pointer-events: none;
    z-index: 10;
    white-space: nowrap;
  }
</style>
