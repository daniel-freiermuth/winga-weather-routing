<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    visible: boolean;
    expanded: boolean;
    fullscreen: boolean;
    graphHeight: number;
    svgContent: string;
    svgViewBox: string;
    hasWave: boolean;
    onToggle: () => void;
    onFullscreenToggle: () => void;
  }
  let {
    visible, expanded, fullscreen, graphHeight,
    svgContent, svgViewBox, hasWave,
    onToggle, onFullscreenToggle,
  }: Props = $props();

  // Bind refs for graph-tooltip (imperative SVG tooltip is OK)
  let svgEl = $state<SVGSVGElement | undefined>();
  let panelEl = $state<HTMLDivElement | undefined>();

  export function getSvgEl(): SVGSVGElement | undefined { return svgEl; }

  function handleClick() {
    if (fullscreen) {
      onFullscreenToggle();
      return;
    }
    onToggle();
  }

  function svgClick() {
    onFullscreenToggle();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && fullscreen) onFullscreenToggle();
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  let panelHeight = $derived(
    fullscreen ? '' : expanded ? `${graphHeight}px` : '24px'
  );
</script>

{#if visible}
<div
  bind:this={panelEl}
  class="conditions-panel"
  class:conditions-fullscreen={fullscreen}
  style:height={panelHeight}
  style:display="flex"
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="conditions-handle" onclick={handleClick}>
    <span>Conditions along route</span>
    <span class="conditions-toggle">
      {expanded ? '\u25BC' : '\u25B6'}
    </span>
  </div>
  <div class="conditions-body">
    <div class="conditions-y-left"></div>
    <div class="conditions-svg-wrapper">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        bind:this={svgEl}
        class="conditions-svg"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        viewBox={svgViewBox}
        style:display={expanded ? '' : 'none'}
        style:cursor={fullscreen ? 'zoom-out' : 'zoom-in'}
        onclick={svgClick}
      >{@html svgContent}</svg>
    </div>
    {#if hasWave}
      <div class="conditions-y-right"></div>
    {/if}
  </div>
</div>
{/if}

<style>
  .conditions-panel {
    height: 200px;
    background: #1e2230;
    border-top: 2px solid #313244;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .conditions-handle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 12px;
    background: #2a2f45;
    font-size: 11px;
    color: #6c7086;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }
  .conditions-handle:hover {
    background: #313244;
  }
  .conditions-toggle {
    background: #363a4f;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .conditions-handle:hover .conditions-toggle {
    background: #45475a;
  }
  .conditions-body {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    padding: 0 10px;
    gap: 8px;
  }
  .conditions-y-left {
    width: 130px;
    flex-shrink: 0;
    position: relative;
  }
  .conditions-y-right {
    width: 52px;
    flex-shrink: 0;
    position: relative;
  }
  .conditions-svg-wrapper {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .conditions-svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .conditions-fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh !important;
    z-index: 8000;
  }
</style>
