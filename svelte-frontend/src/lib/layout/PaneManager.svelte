<script>
  import { onDestroy } from 'svelte';
  import { panes, paneLayout, activePaneId, updateRatios, splitPane, addTabToPane, moveTabToPane } from '../../stores/panes.svelte.js';
  import { tabs } from '../../stores/tabs.svelte.js';
  import { sendTabMessage, stopTab, sendTabPermissionResponse, loadEarlierHistory } from '../../stores/tabs.svelte.js';
  import { popups, isPopupOpen } from '../../stores/popups.svelte.js';
  import { promotePopupToTab } from '../../stores/tabs.svelte.js';
  import { sessions as sessionStates } from '../../stores/session-state.svelte.js';
  import MessageList from '../chat/MessageList.svelte';
  import InputArea from '../chat/InputArea.svelte';
  import FileViewer from '../files/FileViewer.svelte';
  import CommandPost from '../board/CommandPost.svelte';
  import AreaDetailTab from '../board/AreaDetailTab.svelte';
  import ProjectDetailTab from '../board/ProjectDetailTab.svelte';
  import AgentDetailTab from '../board/AgentDetailTab.svelte';
  import AgentCreateTab from '../board/AgentCreateTab.svelte';

  const FILE_PREFIX = '__file__:';
  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';
  const AGENT_PREFIX = '__agent__:';

  let paneList = $derived(panes);
  let layout = $derived(paneLayout);
  let currentActivePaneId = $derived(activePaneId.value);

  // --- Resize state ---
  let isResizing = $state(false);
  let resizePaneIdx = $state(0);

  function startResize(e, idx) {
    e.preventDefault();
    isResizing = true;
    resizePaneIdx = idx;

    const startPos = layout.direction === 'vertical' ? e.clientY : e.clientX;
    const container = e.target.closest('.pane-container');
    const totalSize = layout.direction === 'vertical' ? container.offsetHeight : container.offsetWidth;
    const startRatios = [...layout.ratios];

    function onMove(e) {
      const currentPos = layout.direction === 'vertical' ? e.clientY : e.clientX;
      const delta = (currentPos - startPos) / totalSize;
      const newRatios = [...startRatios];
      newRatios[idx] = Math.max(0.15, startRatios[idx] + delta);
      newRatios[idx + 1] = Math.max(0.15, startRatios[idx + 1] - delta);
      updateRatios(newRatios);
    }

    function onUp() {
      isResizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _resizeCleanup = null;
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    _resizeCleanup = onUp; // track for cleanup on destroy
  }

  // Clean up resize listeners if component destroyed mid-drag
  let _resizeCleanup = null;
  onDestroy(() => { if (_resizeCleanup) _resizeCleanup(); });

  // Send/stop for session tabs in a specific pane
  function handleSend(paneId, tabId, text, attachmentData) {
    if (tabId && !tabId.startsWith('__')) {
      const images = attachmentData?.images?.length > 0 ? attachmentData.images : undefined;
      const documents = attachmentData?.documents?.length > 0 ? attachmentData.documents : undefined;
      const pastes = attachmentData?.pastes?.length > 0 ? attachmentData.pastes : undefined;
      sendTabMessage(tabId, text, images, pastes, documents);
    }
  }

  function handleStop(tabId) {
    if (tabId && !tabId.startsWith('__')) {
      stopTab(tabId);
    }
  }

  function handlePermissionRespond(tabId, requestId, decision) {
    if (tabId && !tabId.startsWith('__')) {
      sendTabPermissionResponse(tabId, requestId, decision);
    }
  }

  // --- Drop zone for splitting ---
  let dropZone = $state(null); // 'right' | 'bottom' | null
  let dropPaneId = $state(null);

  function handlePaneDragOver(e, paneId) {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // Detect drop zone: right 20% or bottom 20%
    if (x > w * 0.8) {
      dropZone = 'right';
      dropPaneId = paneId;
    } else if (y > h * 0.8) {
      dropZone = 'bottom';
      dropPaneId = paneId;
    } else {
      dropZone = 'center';
      dropPaneId = paneId;
    }
  }

  function handlePaneDragLeave(e, paneId) {
    if (dropPaneId === paneId) {
      dropZone = null;
      dropPaneId = null;
    }
  }

  function handlePaneDrop(e, paneId) {
    e.preventDefault();
    const tabId = e.dataTransfer.getData('text/plain');
    if (!tabId) { dropZone = null; dropPaneId = null; return; }

    // If dropping a popup, promote it to a tab first
    if (isPopupOpen(tabId)) {
      promotePopupToTab(tabId);
      const zone = dropZone;
      setTimeout(() => {
        if (zone === 'right' && paneList.length < 6) splitPane(tabId, 'horizontal');
        else if (zone === 'bottom' && paneList.length < 6) splitPane(tabId, 'vertical');
        else moveTabToPane(tabId, paneId);
      }, 50);
      dropZone = null;
      dropPaneId = null;
      return;
    }

    if (dropZone === 'right' && paneList.length < 6) {
      splitPane(tabId, 'horizontal');
    } else if (dropZone === 'bottom' && paneList.length < 6) {
      splitPane(tabId, 'vertical');
    } else if (dropZone === 'center') {
      moveTabToPane(tabId, paneId);
    }

    dropZone = null;
    dropPaneId = null;
  }

  // Drag tab between panes
  function handleTabDragStart(e, tabId) {
    if (tabId === '__home__') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }

  // Popup bar height calculation
  // Read saved popup height from localStorage
  let savedPopupH = 380;
  try { const h = parseInt(localStorage.getItem('claude-relay-popup-height')); if (h > 200) savedPopupH = h; } catch {}

  let popupBarHeight = $derived.by(() => {
    const list = Object.values(popups);
    if (list.length === 0) return 0;
    let maxH = 0;
    for (const p of list) {
      maxH = Math.max(maxH, p.minimized ? 40 : savedPopupH);
    }
    return maxH > 0 ? maxH + 8 : 0;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane-container"
  class:split-h={layout.direction === 'horizontal' && paneList.length > 1}
  class:split-v={layout.direction === 'vertical' && paneList.length > 1}
  class:resizing={isResizing}
>
  {#each paneList as pane, idx (pane.id)}
    {#if idx > 0}
      <!-- Resize handle between panes -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="pane-resize-handle"
        class:horizontal={layout.direction === 'horizontal'}
        class:vertical={layout.direction === 'vertical'}
        onmousedown={(e) => startResize(e, idx - 1)}
      ></div>
    {/if}

    <div
      class="pane"
      class:active={currentActivePaneId === pane.id}
      style="flex: {layout.ratios[idx] || 1}"
      ondragover={(e) => handlePaneDragOver(e, pane.id)}
      ondragleave={(e) => handlePaneDragLeave(e, pane.id)}
      ondrop={(e) => handlePaneDrop(e, pane.id)}
      onclick={() => activePaneId.value = pane.id}
    >
      <!-- Drop zone indicators -->
      {#if dropPaneId === pane.id && dropZone === 'right'}
        <div class="drop-indicator right"><span class="drop-label">Split Right</span></div>
      {/if}
      {#if dropPaneId === pane.id && dropZone === 'bottom'}
        <div class="drop-indicator bottom"><span class="drop-label">Split Down</span></div>
      {/if}
      {#if dropPaneId === pane.id && dropZone === 'center'}
        <div class="drop-indicator center"><span class="drop-label">Move Here</span></div>
      {/if}

      <!-- Pane content -->
      <div class="pane-content" style:padding-bottom="{idx === paneList.length - 1 && pane.activeTabId && !pane.activeTabId.startsWith('__') ? popupBarHeight : 0}px">
        {#if pane.activeTabId === '__home__'}
          <CommandPost />
        {:else if pane.activeTabId?.startsWith(AREA_PREFIX)}
          <AreaDetailTab areaName={pane.activeTabId.slice(AREA_PREFIX.length)} />
        {:else if pane.activeTabId?.startsWith(PROJECT_PREFIX)}
          <ProjectDetailTab projectPath={pane.activeTabId.slice(PROJECT_PREFIX.length)} />
        {:else if pane.activeTabId === '__agent_new__'}
          <AgentCreateTab />
        {:else if pane.activeTabId?.startsWith(AGENT_PREFIX)}
          <AgentDetailTab agentId={pane.activeTabId.slice(AGENT_PREFIX.length)} />
        {:else if pane.activeTabId === '__file__' || pane.activeTabId?.startsWith(FILE_PREFIX)}
          <FileViewer />
        {:else if tabs[pane.activeTabId] && sessionStates[pane.activeTabId]}
          {#key pane.activeTabId}
            <MessageList
              messages={sessionStates[pane.activeTabId]?.messages}
              processing={sessionStates[pane.activeTabId]?.processing}
              activity={sessionStates[pane.activeTabId]?.activity}
              thinking={{ active: sessionStates[pane.activeTabId]?.thinking, text: '' }}
              loadingHistory={sessionStates[pane.activeTabId]?.loadingHistory}
              loadingEarlier={sessionStates[pane.activeTabId]?.loadingEarlier || false}
              hasEarlier={sessionStates[pane.activeTabId]?.historyFrom > 0}
              onLoadEarlier={() => loadEarlierHistory(pane.activeTabId)}
              onPermissionRespond={(reqId, decision) => handlePermissionRespond(pane.activeTabId, reqId, decision)}
              taskItems={sessionStates[pane.activeTabId]?.tasks}
            />
          {/key}
          <InputArea
            sessionId={pane.activeTabId}
            processing={sessionStates[pane.activeTabId]?.processing}
            onSend={(text, att) => handleSend(pane.id, pane.activeTabId, text, att)}
            onStop={() => handleStop(pane.activeTabId)}
          />
        {:else if pane.activeTabId && pane.activeTabId !== '__home__'}
          <!-- Tab data not yet loaded (restoring) -->
          <div class="pane-empty">
            <div class="pane-loading-spinner"></div>
            <span>Loading session...</span>
          </div>
        {:else}
          <div class="pane-empty">
            <span>No content</span>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .pane-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .pane-container.split-h {
    flex-direction: row;
  }

  .pane-container.split-v {
    flex-direction: column;
  }

  .pane-container.resizing {
    user-select: none;
  }

  .pane-container.resizing.split-h {
    cursor: col-resize;
  }

  .pane-container.resizing.split-v {
    cursor: row-resize;
  }

  /* Pane */
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .split-h .pane,
  .split-v .pane {
    border: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .split-h .pane.active,
  .split-v .pane.active {
    border-color: rgba(var(--accent-rgb), 0.15);
  }

  .pane-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .pane-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dimmer);
    font-size: 13px;
  }

  .pane-loading-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: pSpin 0.7s linear infinite;
  }

  /* Resize handle */
  .pane-resize-handle {
    flex-shrink: 0;
    background: transparent;
    position: relative;
    z-index: 5;
    transition: background 0.15s;
  }

  .pane-resize-handle.horizontal {
    width: 5px;
    cursor: col-resize;
  }

  .pane-resize-handle.vertical {
    height: 5px;
    cursor: row-resize;
  }

  .pane-resize-handle:hover,
  .resizing .pane-resize-handle {
    background: var(--accent-30);
  }

  /* Drop zone indicators */
  .drop-indicator {
    position: absolute;
    background: rgba(var(--accent-rgb), 0.08);
    border: 2px solid rgba(var(--accent-rgb), 0.4);
    border-radius: 6px;
    z-index: 10;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: dropFadeIn 0.12s ease-out;
  }

  @keyframes dropFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .drop-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
    padding: 4px 10px;
    border-radius: 4px;
    letter-spacing: 0.3px;
  }

  .drop-indicator.right {
    right: 4px;
    top: 4px;
    bottom: 4px;
    width: calc(50% - 8px);
  }

  .drop-indicator.bottom {
    left: 4px;
    right: 4px;
    bottom: 4px;
    height: calc(50% - 8px);
  }

  .drop-indicator.center {
    inset: 4px;
  }

</style>
