<script lang="ts">
  interface Props {
    canCalculate: boolean;
    canAnalyse: boolean;
    isCalculating: boolean;
    isAnalysing: boolean;
    hasPendingRoute: boolean;
    calcHint: string;
    analyseHint: string;
    calcProgress: number;
    showProgress: boolean;
    onCalculate: () => void;
    onAnalyse: () => void;
    onRunTest: () => void;
    onRunHelsinki: () => void;
    onRunGothenburg: () => void;
    onSaveRoute: () => void;
  }

  let {
    canCalculate, canAnalyse, isCalculating, isAnalysing,
    hasPendingRoute, calcHint, analyseHint, calcProgress, showProgress,
    onCalculate, onAnalyse, onRunTest, onRunHelsinki, onRunGothenburg, onSaveRoute,
  }: Props = $props();
</script>

<button disabled={!canCalculate || isCalculating} onclick={onCalculate}>
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

<button onclick={onRunTest}>Run test</button>
<button onclick={onRunHelsinki}>Helsinki test</button>
<button onclick={onRunGothenburg}>Gothenburg test</button>
<button disabled={!hasPendingRoute} onclick={onSaveRoute}>Save Route…</button>

<button class="analyse-btn" disabled={!canAnalyse || isAnalysing} onclick={onAnalyse}>
  {isAnalysing ? 'Analysing…' : 'Analyse Route Weather'}
</button>
{#if analyseHint}
  <span class="hint">{analyseHint}</span>
{/if}

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
</style>
