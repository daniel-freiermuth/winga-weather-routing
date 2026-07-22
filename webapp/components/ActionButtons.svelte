<script lang="ts">
  interface Props {
    canCalculate: boolean;
    canAnalyse: boolean;
    hasPendingRoute: boolean;
    analyseHint: string;
    calcHint: string;
    onCalculate: () => void;
    onRunTest: () => void;
    onRunHelsinki: () => void;
    onRunGothenburg: () => void;
    onSaveRoute: () => void;
    onAnalyse: () => void;
  }

  let {
    canCalculate,
    canAnalyse,
    hasPendingRoute,
    analyseHint,
    calcHint,
    onCalculate,
    onRunTest,
    onRunHelsinki,
    onRunGothenburg,
    onSaveRoute,
    onAnalyse,
  }: Props = $props();
</script>

<button id="calculate" disabled={!canCalculate} onclick={onCalculate}>Calculate Route</button>
{#if calcHint}
  <span class="hint" id="calc-hint">{calcHint}</span>
{/if}
<button id="run-test" onclick={onRunTest}>Run test</button>
<button id="run-helsinki-test" onclick={onRunHelsinki}>Helsinki test</button>
<button id="run-gothenburg-test" onclick={onRunGothenburg}>Gothenburg test</button>
<button id="save-route-btn" disabled={!hasPendingRoute} onclick={onSaveRoute}>Save Route…</button>

<button id="analyse-weather-btn" disabled={!canAnalyse} class="analyse-btn" onclick={onAnalyse}>Analyse Route Weather</button>
{#if analyseHint}
  <span class="hint" id="analyse-hint">{analyseHint}</span>
{/if}

<div id="route-weather-panel" style="display:none;margin-top:8px;max-height:300px;overflow-y:auto"></div>

<div id="progress-bar-wrap" style="display: none">
  <div id="progress-bar"></div>
</div>

<div id="status-box">Ready</div>

<style>
  .analyse-btn {
    background: #a6e3a1;
    color: #1e1e2e;
    margin-top: 4px;
  }
  .hint {
    font-size: 10px;
    color: #6c7086;
    display: block;
    margin-top: 2px;
  }
</style>
