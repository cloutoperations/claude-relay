<script>
  import { toasts } from '../../stores/toasts.svelte.js';
</script>

{#if toasts.length > 0}
  <div class="toast-bar">
    {#each toasts as toast (toast.id)}
      <div class="toast">{toast.message}</div>
    {/each}
  </div>
{/if}

<style>
  .toast-bar {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }

  .toast {
    background: var(--bg-raised);
    color: var(--text);
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(var(--shadow-rgb), 0.3);
    animation: toastIn 0.2s ease-out;
    white-space: nowrap;
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
