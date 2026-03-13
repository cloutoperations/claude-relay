<script>
  import { openPopup } from '../../stores/popups.svelte.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.svelte.js';
  import { sidebarOpen } from '../../stores/ui.svelte.js';

  let {
    session,
    size = 'sm',
    onContextMenu = null,
  } = $props();

  let isProcessing = $derived(session?.isProcessing || false);
  let isStale = $derived.by(() => {
    if (!session?.lastActivity) return false;
    const age = Date.now() - new Date(session.lastActivity).getTime();
    return age > 1000 * 60 * 60 * 4; // 4 hours
  });

  function handleClick(e) {
    e.stopPropagation();
    if (activeSessionId.value) leaveSession();
    openPopup(session.id, session.title || 'Session');
    if (window.innerWidth < 1024) sidebarOpen.value = false;
  }

  function handleContextMenu(e) {
    if (onContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, session.id);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="session-bubble {size}"
  class:processing={isProcessing}
  class:idle={!isProcessing && !isStale}
  class:stale={isStale && !isProcessing}
  title={session?.title || 'Untitled session'}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
></span>

<style>
  .session-bubble {
    display: inline-block;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.12s;
  }

  .session-bubble:hover {
    transform: scale(1.4);
  }

  .session-bubble.sm {
    width: 8px;
    height: 8px;
  }

  .session-bubble.md {
    width: 10px;
    height: 10px;
  }

  .session-bubble.processing {
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .session-bubble.idle {
    background: #5b9fd6;
  }

  .session-bubble.stale {
    background: var(--text-dimmer);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
