<script lang="ts">
  interface Props {
    message: string;
    type: 'error' | 'warning';
    visible: boolean;
    onClose: () => void;
  }

  let { message, type, visible, onClose }: Props = $props();
</script>

{#if visible}
<div class="failure-popup {type}">
  <span>{message}</span>
  <button onclick={onClose}>×</button>
</div>
{/if}

<style>
  .failure-popup {
    position: fixed;
    top: 8px;
    right: 8px;
    background: #45475a;
    color: #f38ba8;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 9000;
  }
  .failure-popup.warning { color: #f9e2af; }
  .failure-popup.error { color: #f38ba8; }
</style>
