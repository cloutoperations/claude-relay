<script>
  import { popups } from '../../stores/popups.js';
  import { workspaceEnabled } from '../../stores/ui.js';
  import ChatPopup from './ChatPopup.svelte';

  let popupList = $derived(Object.values($popups));
</script>

<div class="chat-popups" class:rail-offset={$workspaceEnabled}>
  {#each popupList as popup (popup.sessionId)}
    <ChatPopup {popup} />
  {/each}
</div>

<style>
  .chat-popups {
    position: fixed;
    bottom: 0;
    right: 16px;
    display: flex;
    flex-direction: row-reverse;
    align-items: flex-end;
    gap: 6px;
    z-index: 1000;
    pointer-events: none;
  }

  .chat-popups > :global(*) {
    pointer-events: auto;
  }

  /* Shift when rail is visible */
  @media (min-width: 901px) {
    .chat-popups.rail-offset {
      right: 256px;
    }
  }

  @media (max-width: 500px) {
    .chat-popups {
      right: 8px;
      left: 8px;
      flex-direction: column;
    }
  }
</style>
