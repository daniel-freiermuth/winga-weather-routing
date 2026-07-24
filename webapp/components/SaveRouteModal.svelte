<script lang="ts">
  interface Props {
    visible: boolean;
    onSave: (name: string) => Promise<void>;
    onCancel: () => void;
  }

  let { visible, onSave, onCancel }: Props = $props();

  let routeName = $state(`Weather Route ${new Date().toLocaleString()}`);
  let saving = $state(false);
  let inputEl = $state<HTMLInputElement | undefined>();

  $effect(() => {
    if (visible && inputEl) {
      routeName = `Weather Route ${new Date().toLocaleString()}`;
      requestAnimationFrame(() => { if (inputEl) inputEl.select(); });
    }
  });

  async function handleSave() {
    saving = true;
    try {
      await onSave(routeName.trim() || `Weather Route ${new Date().toLocaleString()}`);
    } finally {
      saving = false;
    }
  }
</script>

{#if visible}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => onCancel()}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <h2>Save Route</h2>
    <input
      type="text"
      bind:this={inputEl}
      bind:value={routeName}
      placeholder="Route name"
    />
    <div class="buttons">
      <button class="cancel" onclick={() => onCancel()}>Cancel</button>
      <button class="save" onclick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9000;
  }
  .modal {
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 8px;
    padding: 20px;
    min-width: 320px;
    max-width: 90vw;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 16px;
    color: #cdd6f4;
  }
  input {
    width: 100%;
    padding: 8px 10px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    font-size: 14px;
    margin-bottom: 16px;
  }
  input:focus { outline: none; border-color: #89b4fa; }
  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  .cancel { background: #45475a; color: #cdd6f4; }
  .cancel:hover { background: #585b70; }
  .save { background: #89b4fa; color: #1e1e2e; font-weight: 600; }
  .save:hover { background: #74c7ec; }
  .save:disabled { background: #45475a; color: #6c7086; cursor: not-allowed; }
</style>
