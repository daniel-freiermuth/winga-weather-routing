<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { conditionsExpanded, conditionsFullscreen, conditionsGraphHeight } from '../stores';

  let expanded = $state(true);
  let fullscreen = $state(false);
  let graphHeight = $state(200);

  const unsubExpanded = conditionsExpanded.subscribe((v) => (expanded = v));
  const unsubFullscreen = conditionsFullscreen.subscribe((v) => (fullscreen = v));
  const unsubHeight = conditionsGraphHeight.subscribe((v) => (graphHeight = v));

  onDestroy(() => {
    unsubExpanded();
    unsubFullscreen();
    unsubHeight();
  });

  function enterFullscreen() {
    conditionsFullscreen.set(true);
  }

  function exitFullscreen() {
    conditionsFullscreen.set(false);
  }

  function handleClick() {
    if (fullscreen) {
      exitFullscreen();
      return;
    }
    conditionsExpanded.set(!expanded);
  }

  function svgClick() {
    if (fullscreen) exitFullscreen();
    else enterFullscreen();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && fullscreen) exitFullscreen();
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  let panelHeight = $derived(
    fullscreen ? '' : expanded ? `${graphHeight}px` : '24px'
  );
</script>

<div
  id="conditions-panel"
  class="conditions-panel"
  class:conditions-fullscreen={fullscreen}
  style:height={panelHeight}
>
  <div id="conditions-handle" class="conditions-handle" onclick={handleClick}>
    <span>Conditions along route</span>
    <span id="conditions-toggle" class="conditions-toggle">
      {expanded ? '▼' : '▶'}
    </span>
  </div>
  <div id="conditions-body" class="conditions-body">
    <div id="conditions-y-left" class="conditions-y-left"></div>
    <div id="conditions-svg-wrapper" class="conditions-svg-wrapper">
      <svg
        id="conditions-svg"
        class="conditions-svg"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style:display={expanded ? '' : 'none'}
        style:cursor={fullscreen ? 'zoom-out' : 'zoom-in'}
        onclick={svgClick}
      ></svg>
    </div>
    <div id="conditions-y-right" class="conditions-y-right"></div>
  </div>
</div>

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
    display: none;
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
