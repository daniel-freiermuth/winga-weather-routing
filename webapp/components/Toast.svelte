<script lang="ts">
  interface Props {
    message: string;
    type: 'error' | 'warning' | 'info';
    visible: boolean;
    onDismiss: () => void;
  }

  let { message, type, visible, onDismiss }: Props = $props();

  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (visible && type !== 'error') {
      clearTimeout(timer);
      timer = setTimeout(() => {
        onDismiss();
      }, 5000);
    }
    return () => clearTimeout(timer);
  });
</script>

{#if visible}
  <div
    class="toast {type}"
    role="alert"
  >
    <span class="toast-message">{message}</span>
    <button class="toast-close" onclick={onDismiss} aria-label="Dismiss">✕</button>
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: fadeIn 0.2s ease-out;
    max-width: 90%;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .toast.error {
    background: #45475a;
    color: #f38ba8;
  }
  .toast.warning {
    background: #3a3520;
    color: #f9e2af;
  }
  .toast.info {
    background: #313244;
    color: #cdd6f4;
  }
  .toast-message {
    flex: 1;
  }
  .toast-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.7;
    line-height: 1;
  }
  .toast-close:hover {
    opacity: 1;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
