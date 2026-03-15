<script>
  import { toasts } from '../../stores/toasts.svelte.js';

  function dismiss(id) {
    const idx = toasts.findIndex(t => t.id === id);
    if (idx >= 0) toasts.splice(idx, 1);
  }
</script>

{#if toasts.length > 0}
  <div class="toast-bar">
    {#each toasts as toast (toast.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="toast" onclick={() => dismiss(toast.id)}>
        <span class="toast-msg">{toast.message}</span>
        <button class="toast-close" onclick={(e) => { e.stopPropagation(); dismiss(toast.id); }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
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
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-raised);
    color: var(--text);
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: var(--radius-md, 8px);
    padding: 10px 14px;
    font-size: 13px;
    box-shadow: 0 4px 20px rgba(var(--shadow-rgb), 0.35);
    animation: toastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: pointer;
    pointer-events: auto;
    transition: opacity 0.15s, transform 0.15s;
  }

  .toast:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 24px rgba(var(--shadow-rgb), 0.4);
  }

  .toast-msg {
    flex: 1;
  }

  .toast-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: none;
    border: none;
    border-radius: 50%;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    transition: color 0.12s, background 0.12s;
    flex-shrink: 0;
  }

  .toast-close:hover {
    color: var(--text);
    background: rgba(var(--overlay-rgb), 0.08);
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateY(12px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
