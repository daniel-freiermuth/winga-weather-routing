<script lang="ts">
  interface Props {
    mode: 'route' | 'evaluate';
    onModeChange: (mode: 'route' | 'evaluate') => void;
  }

  let { mode, onModeChange }: Props = $props();
</script>

<div class="mode-switch">
  <button
    class="mode-btn"
    class:active={mode === 'route'}
    onclick={() => onModeChange('route')}
  >
    Route
  </button>
  <button
    class="mode-btn"
    class:active={mode === 'evaluate'}
    onclick={() => onModeChange('evaluate')}
  >
    Evaluate
  </button>
</div>

<style>
  .mode-switch {
    display: flex;
    background: #313244;
    border-radius: 6px;
    padding: 2px;
  }
  .mode-btn {
    flex: 1;
    font-size: 12px;
    padding: 4px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: #a6adc8;
    font-family: inherit;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .mode-btn.active {
    background: #89b4fa;
    color: #1e1e2e;
  }
  .mode-btn:not(.active):hover {
    color: #cdd6f4;
  }
</style>
