<script>
  import { popups, popupOrder, movePopup } from '../../stores/popups.svelte.js';
  import { workspaceEnabled } from '../../stores/ui.svelte.js';
  import ChatPopup from './ChatPopup.svelte';

  // Ordered list of popups based on popupOrder
  let popupList = $derived.by(() => {
    const order = popupOrder;
    const all = popups;
    // Use order for known popups, append any unordered ones at the end
    const ordered = order.filter(id => all[id]).map(id => ({ ...all[id], sessionId: id }));
    const orderedIds = new Set(order);
    for (const [id, p] of Object.entries(all)) {
      if (!orderedIds.has(id)) ordered.push({ ...p, sessionId: id });
    }
    return ordered;
  });

  // Drag state
  let dragId = $state(null);
  let dropTargetId = $state(null);

  function handleDragStart(e, sessionId) {
    dragId = sessionId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sessionId);
  }

  function handleDragEnd() {
    dragId = null;
    dropTargetId = null;
  }

  function handleDragOver(e, sessionId) {
    if (!dragId || dragId === sessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropTargetId = sessionId;
  }

  function handleDragLeave(e, sessionId) {
    if (dropTargetId === sessionId) dropTargetId = null;
  }

  function handleDrop(e, sessionId) {
    e.preventDefault();
    if (!dragId || dragId === sessionId) return;
    const order = popupOrder;
    const targetIndex = order.indexOf(sessionId);
    if (targetIndex >= 0) {
      movePopup(dragId, targetIndex);
    }
    dragId = null;
    dropTargetId = null;
  }
</script>

<div class="chat-popups" class:rail-offset={workspaceEnabled.value}>
  {#each popupList as popup (popup.sessionId)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="popup-drag-wrapper"
      class:dragging={dragId === popup.sessionId}
      class:drop-target={dropTargetId === popup.sessionId}
      draggable="true"
      ondragstart={(e) => handleDragStart(e, popup.sessionId)}
      ondragend={handleDragEnd}
      ondragover={(e) => handleDragOver(e, popup.sessionId)}
      ondragleave={(e) => handleDragLeave(e, popup.sessionId)}
      ondrop={(e) => handleDrop(e, popup.sessionId)}
    >
      <ChatPopup {popup} />
    </div>
  {/each}
</div>

<style>
  .chat-popups {
    position: fixed;
    bottom: 0;
    right: 16px;
    left: 0;
    display: flex;
    flex-direction: row-reverse;
    align-items: flex-end;
    gap: 6px;
    z-index: 1000;
    pointer-events: none;
    overflow-x: auto;
    overflow-y: visible;
    padding-left: 16px;
  }

  /* Hide scrollbar by default, show on hover */
  .chat-popups::-webkit-scrollbar { height: 4px; }
  .chat-popups::-webkit-scrollbar-track { background: transparent; }
  .chat-popups::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb), 0.1); border-radius: 2px; }
  .chat-popups::-webkit-scrollbar-thumb:hover { background: rgba(var(--overlay-rgb), 0.2); }

  .popup-drag-wrapper {
    pointer-events: auto;
    transition: opacity 0.15s;
  }

  .popup-drag-wrapper.dragging {
    opacity: 0.4;
  }

  .popup-drag-wrapper.drop-target {
    border-left: 2px solid var(--accent);
    border-radius: 2px;
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
