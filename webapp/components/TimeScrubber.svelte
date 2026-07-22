<script lang="ts">
  let expanded = $state(true);

  // ── Element refs for parent access ──────────────────────────────────────────
  let panelEl = $state<HTMLDivElement | undefined>();
  let labelEl = $state<HTMLSpanElement | undefined>();
  let rangeEl = $state<HTMLInputElement | undefined>();
  let nowMarkerEl = $state<HTMLDivElement | undefined>();
  let coverageBarEl = $state<HTMLDivElement | undefined>();
  let trackWrapperEl = $state<HTMLDivElement | undefined>();
  let jumpToNowEl = $state<HTMLButtonElement | undefined>();
  let rangeToggleEl = $state<HTMLButtonElement | undefined>();
  let useAsDepartureEl = $state<HTMLButtonElement | undefined>();
  let rightSpacerEl = $state<HTMLDivElement | undefined>();

  function toggle() {
    expanded = !expanded;
  }

  export function getElements() {
    return {
      panel: panelEl,
      label: labelEl,
      range: rangeEl,
      nowMarker: nowMarkerEl,
      coverageBar: coverageBarEl,
      trackWrapper: trackWrapperEl,
      jumpToNow: jumpToNowEl,
      rangeToggle: rangeToggleEl,
      useAsDeparture: useAsDepartureEl,
      rightSpacer: rightSpacerEl,
    };
  }
</script>

<div id="time-scrubber-panel" bind:this={panelEl}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div id="scrubber-handle" title={expanded ? 'Collapse panel' : 'Expand panel'} onclick={toggle}>
    <span>Time scrubber</span>
    <span id="scrubber-toggle">{expanded ? '\u25B2' : '\u25BC'}</span>
  </div>
  {#if expanded}
    <div id="scrubber-body">
      <span id="time-scrubber-label" bind:this={labelEl}></span>
      <button id="use-as-departure" title="Set this time as the route departure time" bind:this={useAsDepartureEl}>
        Use as departure
      </button>
      <div id="scrubber-track-wrapper" bind:this={trackWrapperEl}>
        <div id="scrubber-now-marker" bind:this={nowMarkerEl}></div>
        <div id="scrubber-coverage-bar" bind:this={coverageBarEl}></div>
        <input type="range" id="time-scrubber" min="0" max="0" value="0" bind:this={rangeEl} />
      </div>
      <button id="jump-to-now" title="Jump scrubber to current time" bind:this={jumpToNowEl}>Now</button>
      <button
        id="scrubber-range-toggle"
        title="Toggle between route duration and full GRIB range"
        style="display: none"
        bind:this={rangeToggleEl}
      >
        Full range
      </button>
      <div id="time-scrubber-right-spacer" bind:this={rightSpacerEl}></div>
    </div>
  {/if}
</div>

<style>
  #time-scrubber-panel {
    display: none;
    flex-direction: column;
    overflow: hidden;
    background: #1e2230;
    border-top: 1px solid #313244;
    flex-shrink: 0;
  }
  #scrubber-handle {
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
  #scrubber-handle:hover {
    background: #313244;
  }
  #scrubber-body {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
  }
  #scrubber-toggle {
    background: #363a4f;
    padding: 1px 6px;
    border-radius: 3px;
  }
  #scrubber-handle:hover #scrubber-toggle {
    background: #45475a;
  }
  #time-scrubber-label {
    font-size: 11px;
    color: #a6adc8;
    white-space: nowrap;
    width: 130px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #scrubber-track-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    position: relative;
    padding-top: 8px;
  }
  #scrubber-coverage-bar {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  #scrubber-now-marker {
    position: absolute;
    top: 0;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 7px solid #f9e2af;
    transform: translateX(-50%);
    display: none;
    pointer-events: none;
  }
  #time-scrubber {
    width: 100%;
    accent-color: #89b4fa;
    cursor: pointer;
  }
  #time-scrubber-right-spacer {
    flex-shrink: 0;
    display: none;
    width: 52px;
  }
  #use-as-departure {
    font-size: 10px;
    color: #a6adc8;
    background: transparent;
    border: 1px solid #45475a;
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  #use-as-departure:hover {
    color: #cdd6f4;
    border-color: #89b4fa;
  }
  #jump-to-now {
    font-size: 10px;
    color: #a6adc8;
    background: transparent;
    border: 1px solid #45475a;
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
    flex-shrink: 0;
  }
  #jump-to-now:hover {
    color: #cdd6f4;
    border-color: #89b4fa;
  }
  #scrubber-range-toggle {
    font-size: 10px;
    color: #a6adc8;
    background: transparent;
    border: 1px solid #45475a;
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
    flex-shrink: 0;
  }
  #scrubber-range-toggle:hover {
    color: #cdd6f4;
    border-color: #89b4fa;
  }
</style>
