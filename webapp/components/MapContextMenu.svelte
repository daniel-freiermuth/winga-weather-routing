<script lang="ts">
  interface Props {
    visible: boolean;
    x: number;
    y: number;
    onSetStart: () => void;
    onSetEnd: () => void;
    onAddWaypoint: () => void;
    onClose: () => void;
  }

  let { visible, x, y, onSetStart, onSetEnd, onAddWaypoint, onClose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  function handleClickOutside(e: MouseEvent) {
    if (visible && menuEl && !menuEl.contains(e.target as Node)) {
      onClose();
    }
  }

  function handleItem(action: () => void) {
    action();
    onClose();
  }
</script>

<svelte:document onclick={handleClickOutside} />

{#if visible}
  <div
    class="context-menu"
    bind:this={menuEl}
    style:left="{x}px"
    style:top="{y}px"
  >
    <button class="menu-item" onclick={() => handleItem(onSetStart)}>Set as start</button>
    <button class="menu-item" onclick={() => handleItem(onSetEnd)}>Set as destination</button>
    <button class="menu-item" onclick={() => handleItem(onAddWaypoint)}>Add as waypoint</button>
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    background: #2a2f45;
    border: 1px solid #45475a;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    overflow: hidden;
  }
  .menu-item {
    display: block;
    width: 100%;
    padding: 8px 16px;
    font-size: 13px;
    color: #cdd6f4;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    white-space: nowrap;
  }
  .menu-item:hover {
    background: #313244;
  }
</style>
