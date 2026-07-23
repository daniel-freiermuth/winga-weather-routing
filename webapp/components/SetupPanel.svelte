<script lang="ts">
  import ModeSwitch from './ModeSwitch.svelte';
  import WaypointInput from './WaypointInput.svelte';

  interface Waypoint {
    id: string;
    label: string;
    value: { lat: number; lon: number } | null;
  }

  interface Props {
    mode: 'route' | 'evaluate';
    waypoints: Waypoint[];
    skWaypoints: { label: string; lat: number; lon: number }[];
    vesselPosition: { lat: number; lon: number } | null;
    waypointRoutes: { label: string; coords: number[][] }[];
    departureTime: string;
    canCalculate: boolean;
    calcHint: string;
    isCalculating: boolean;
    calcProgress: number;
    showProgress: boolean;
    canAnalyse: boolean;
    analyseHint: string;
    isAnalysing: boolean;
    statusText: string;
    statusType: string;
    onWaypointChange: (index: number, point: { lat: number; lon: number } | null) => void;
    onWaypointAdd: () => void;
    onWaypointRemove: (index: number) => void;
    onWaypointReorder: (fromIndex: number, toIndex: number) => void;
    onLoadRoute: (routeIndex: number) => void;
    onCalculate: () => void;
    onAnalyse: () => void;
    onModeChange: (mode: 'route' | 'evaluate') => void;
    onWaypointRouteChange?: (e: Event) => void;
  }

  let {
    mode,
    waypoints,
    skWaypoints = [],
    vesselPosition = null,
    waypointRoutes = [],
    departureTime = $bindable(),
    canCalculate = false,
    calcHint = '',
    isCalculating = false,
    calcProgress = 0,
    showProgress = false,
    canAnalyse = false,
    analyseHint = '',
    isAnalysing = false,
    statusText = 'Ready',
    statusType = '',
    onWaypointChange,
    onWaypointAdd,
    onWaypointRemove,
    onWaypointReorder,
    onLoadRoute,
    onCalculate,
    onAnalyse,
    onModeChange,
    onWaypointRouteChange,
  }: Props = $props();

  // Drag state
  let dragIndex: number | null = $state(null);
  let dropTargetIndex: number | null = $state(null);

  function handleDragStart(e: DragEvent, index: number) {
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    if (dragIndex === null || dragIndex === index) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropTargetIndex = index;
  }

  function handleDragEnter(e: DragEvent, index: number) {
    if (dragIndex === null || dragIndex === index) return;
    e.preventDefault();
    dropTargetIndex = index;
  }

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      onWaypointReorder(dragIndex, index);
    }
    dragIndex = null;
    dropTargetIndex = null;
  }

  function handleDragEnd() {
    dragIndex = null;
    dropTargetIndex = null;
  }

  function handleLoadRoute(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === '') return;
    const idx = parseInt(val);
    if (!isNaN(idx)) {
      onLoadRoute(idx);
      (e.target as HTMLSelectElement).value = '';
    }
  }
</script>

<div class="setup-panel">
  <div class="panel-body">
    <ModeSwitch {mode} {onModeChange} />

    {#if mode === 'route'}
      <!-- Waypoint list -->
      <div class="waypoint-list">
        {#each waypoints as wp, i (wp.id)}
          {@const intermediate = i > 0 && i < waypoints.length - 1}

          {#if dropTargetIndex === i && dragIndex !== null && dragIndex !== i}
            <div class="drop-indicator"></div>
          {/if}

          <div
            class="waypoint-item"
            class:dragging={dragIndex === i}
            draggable="true"
            ondragstart={(e) => handleDragStart(e, i)}
            ondragover={(e) => handleDragOver(e, i)}
            ondragenter={(e) => handleDragEnter(e, i)}
            ondrop={(e) => handleDrop(e, i)}
            ondragend={handleDragEnd}
            role="listitem"
          >
            <div class="drag-handle" title="Drag to reorder">⋮⋮</div>

            <div class="waypoint-input-wrap has-handle">
              <WaypointInput
                label={wp.label}
                value={wp.value}
                suggestions={skWaypoints}
                {vesselPosition}
                onSelect={(point) => onWaypointChange(i, point)}
                onClear={() => onWaypointChange(i, null)}
                removable={intermediate}
                onRemove={() => onWaypointRemove(i)}
              />
            </div>
          </div>

          {#if i < waypoints.length - 1}
            <div class="connector">
              <div class="connector-line"></div>
              <span class="connector-arrow">↓</span>
            </div>
          {/if}
        {/each}
      </div>

      <!-- Add waypoint button -->
      <button class="btn-add-waypoint" onclick={onWaypointAdd}>
        + Add waypoint
      </button>

      <!-- Load from route (subtle, inline) -->
      {#if waypointRoutes.length > 0}
        <select class="input-select load-route-select" onchange={handleLoadRoute}>
          <option value="">or load from SignalK route…</option>
          {#each waypointRoutes as route, i}
            <option value={String(i)}>{route.label}</option>
          {/each}
        </select>
      {/if}

      <!-- Departure Time -->
      <div class="section-title">Departure Time</div>
      <input
        class="input-datetime"
        type="datetime-local"
        bind:value={departureTime}
      />

      <!-- Calculate button -->
      <button
        class="btn-calculate"
        disabled={!canCalculate || isCalculating}
        onclick={onCalculate}
      >
        {isCalculating ? 'Calculating…' : 'Calculate Route'}
      </button>
      {#if calcHint}
        <span class="hint">{calcHint}</span>
      {/if}
      {#if showProgress}
        <div class="progress-wrap">
          <div class="progress-bar" style:width="{calcProgress}%"></div>
        </div>
      {/if}

    {:else}
      <!-- Evaluate mode -->
      <div class="section-title">Select route</div>
      <select class="input-select" onchange={onWaypointRouteChange}>
        <option value="">— select route —</option>
        {#each waypointRoutes as route}
          <option value={route.label}>{route.label}</option>
        {/each}
      </select>

      <!-- Departure Time -->
      <div class="section-title">Departure Time</div>
      <input
        class="input-datetime"
        type="datetime-local"
        bind:value={departureTime}
      />

      <!-- Analyse button -->
      <button
        class="btn-analyse"
        disabled={!canAnalyse || isAnalysing}
        onclick={onAnalyse}
      >
        {isAnalysing ? 'Analysing…' : 'Analyse Route Weather'}
      </button>
      {#if analyseHint}
        <span class="hint">{analyseHint}</span>
      {/if}
    {/if}
  </div>

  <!-- Status bar -->
  <div class="status-bar" class:error={statusType === 'error'} class:success={statusType === 'success'} class:progress={statusType === 'progress'}>
    {statusText}
  </div>
</div>

<style>
  .setup-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Waypoint list */
  .waypoint-list {
    display: flex;
    flex-direction: column;
    margin-top: 8px;
  }
  .waypoint-item {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    position: relative;
  }
  .waypoint-item.dragging {
    opacity: 0.4;
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    padding-top: 18px;
    color: #6c7086;
    cursor: grab;
    font-size: 10px;
    letter-spacing: 1px;
    user-select: none;
    flex-shrink: 0;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .waypoint-input-wrap {
    flex: 1;
    min-width: 0;
  }
  .waypoint-input-wrap.has-handle {
    /* slight indent already handled by flex gap */
  }

  /* Connector between waypoints */
  .connector {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 0;
    margin-left: 20px;
    position: relative;
  }
  .connector-line {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #45475a;
  }
  .connector-arrow {
    position: relative;
    z-index: 1;
    color: #45475a;
    font-size: 10px;
    line-height: 1;
  }

  /* Drop indicator */
  .drop-indicator {
    height: 2px;
    background: #89b4fa;
    border-radius: 1px;
    margin: 2px 0;
  }

  /* Add waypoint button */
  .btn-add-waypoint {
    width: 100%;
    padding: 6px;
    font-size: 12px;
    color: #89b4fa;
    background: transparent;
    border: 1px dashed #45475a;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .btn-add-waypoint:hover {
    background: rgba(137, 180, 250, 0.08);
    border-color: #89b4fa;
  }

  /* Shared styles */
  .section-title {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 8px;
    margin-bottom: 2px;
  }
  .input-select {
    width: 100%;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
  }
  .load-route-select {
    background: transparent;
    border: 1px dashed #45475a;
    color: #6c7086;
    font-size: 11px;
    margin-top: 4px;
  }
  .input-datetime {
    width: 100%;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
    color-scheme: dark;
    box-sizing: border-box;
  }
  .btn-calculate {
    width: 100%;
    margin-top: 8px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 600;
    background: #89b4fa;
    color: #1e1e2e;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .btn-calculate:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-calculate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-analyse {
    width: 100%;
    margin-top: 8px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 600;
    background: #a6e3a1;
    color: #1e1e2e;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .btn-analyse:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-analyse:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .hint {
    font-size: 10px;
    color: #6c7086;
    display: block;
    margin-top: 2px;
  }
  .progress-wrap {
    width: 100%;
    height: 6px;
    background: #313244;
    border-radius: 3px;
    margin-top: 4px;
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    background: #89b4fa;
    border-radius: 3px;
    transition: width 0.2s ease;
  }
  .status-bar {
    padding: 8px 12px;
    font-size: 11px;
    color: #6c7086;
    border-top: 1px solid #45475a;
    background: #1e2230;
  }
  .status-bar.error {
    color: #f38ba8;
  }
  .status-bar.success {
    color: #a6e3a1;
  }
  .status-bar.progress {
    color: #89b4fa;
  }
</style>
