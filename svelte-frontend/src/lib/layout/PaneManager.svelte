<script>
  import { onDestroy } from 'svelte';
  import { panes, paneLayout, activePaneId, updateRatios, splitPane, addTabToPane, moveTabToPane, closePane } from '../../stores/panes.svelte.js';
  import { tabs } from '../../stores/tabs.svelte.js';
  import { sendTabMessage, stopTab, sendTabPermissionResponse, loadEarlierHistory, openTab } from '../../stores/tabs.svelte.js';
  import { send } from '../../stores/ws.svelte.js';
  import { popups, isPopupOpen } from '../../stores/popups.svelte.js';
  import { promotePopupToTab } from '../../stores/tabs.svelte.js';
  import { sessions as sessionStates } from '../../stores/session-state.svelte.js';
  import { sessionList, createSession, pendingAutoTag } from '../../stores/sessions.svelte.js';
  import { tagSession, boardData, fetchBoard } from '../../stores/board.svelte.js';
  import MessageList from '../chat/MessageList.svelte';
  import InputArea from '../chat/InputArea.svelte';
  import FileViewer from '../files/FileViewer.svelte';
  import CommandPost from '../board/CommandPost.svelte';
  import AreaDetailTab from '../board/AreaDetailTab.svelte';
  import ProjectDetailTab from '../board/ProjectDetailTab.svelte';
  import AgentDetailTab from '../board/AgentDetailTab.svelte';
  import AgentCreateTab from '../board/AgentCreateTab.svelte';
  import OperationDetailTab from '../board/OperationDetailTab.svelte';
  import DiffViewer from '../files/DiffViewer.svelte';

  const FILE_PREFIX = '__file__:';
  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';
  const AGENT_PREFIX = '__agent__:';
  const OPERATION_PREFIX = '__operation__:';

  let paneList = $derived(panes);
  let layout = $derived(paneLayout);
  let currentActivePaneId = $derived(activePaneId.value);

  // Session → projectPath lookup from session list
  function getSessionProjectPath(sessionId) {
    const s = sessionList.find(s => s.id === sessionId);
    return s?.projectPath || null;
  }

  function formatProjectPath(pp) {
    if (!pp) return null;
    const parts = pp.split('/');
    const area = parts[0];
    if (parts.length < 2) return { area, project: null, operation: null, full: pp };
    const isOperation = parts.some(p => p.includes('operations'));
    const leaf = parts[parts.length - 1];
    return { area, project: isOperation ? null : (parts.length > 2 ? leaf : null), operation: isOperation ? leaf : null, full: pp };
  }

  function openAreaTab(areaName) {
    const tabId = AREA_PREFIX + areaName;
    addTabToPane(tabId);
  }

  function openProjectTab(projectPath) {
    const tabId = PROJECT_PREFIX + projectPath;
    addTabToPane(tabId);
  }

  // --- Tag picker state ---
  let tagPickerPane = $state(null); // pane ID where picker is open
  let tagPickerSessionId = $state(null); // the exact session being tagged

  function suggestTag(sessionIdToTag) {
    if (!boardData.value || !sessionIdToTag) return;
    tagPickerPane = null;

    // Build a prompt specific to this session
    const sessionTitle = tabs[sessionIdToTag]?.title || sessionList.find(s => s.id === sessionIdToTag)?.title || 'Untitled';
    const lines = [];
    for (const area of boardData.value.areas) {
      const projects = area.projects.map(p => p.name).join(', ');
      const ops = (area.operations || []).map(o => o.name).join(', ');
      let line = area.name;
      if (projects) line += ' — projects: ' + projects;
      if (ops) line += ' — ops: ' + ops;
      lines.push(line);
    }

    // Override the auto-tag prompt with a session-specific one
    pendingAutoTag.active = true;
    pendingAutoTag.customPrompt = `Tag this session to the right area/project.\n\nSession: "${sessionTitle}" (id: ${sessionIdToTag})\n\nAvailable areas and projects:\n${lines.join('\n')}\n\nUse this command to tag it:\ncurl -X POST http://localhost:2633/p/clout-operations/api/board/tag-session -H 'Content-Type: application/json' -d '{"sessionId":"${sessionIdToTag}","projectPath":"<area-or-project-path>"}'\n\nPick the best match and tag it now.`;

    // Create a new session for the tagging work
    createSession(undefined, true, 'strategy');
  }

  // Auto-reset stale tabs: if a tab shows "Loading session..." for 3s, reset to __home__
  function autoResetStaleTab(node, pane) {
    const timer = setTimeout(() => {
      if (pane.activeTabId && pane.activeTabId !== '__home__' && !tabs[pane.activeTabId]) {
        // Stale tab — remove it and reset
        pane.tabIds = pane.tabIds.filter(id => id === '__home__' || tabs[id] || id.startsWith('__'));
        pane.activeTabId = '__home__';
        // If this pane has no real tabs left in a split, auto-close
        if (paneList.length > 1) {
          const realTabs = pane.tabIds.filter(id => id !== '__home__');
          if (realTabs.length === 0) {
            closePane(pane.id);
          }
        }
      }
    }, 3000);
    return { destroy() { clearTimeout(timer); } };
  }

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

  function handleStopAgent(toolUseId) {
    send({ type: 'stop_task', toolUseId });
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
    if (editorDragging.value) return; // block editor drag — ignore
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
    if (editorDragging.value) { editorDragging.value = false; return; }
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
      <div class="pane-content">
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
        {:else if pane.activeTabId?.startsWith(OPERATION_PREFIX)}
          <OperationDetailTab operationPath={pane.activeTabId.slice(OPERATION_PREFIX.length)} />
        {:else if pane.activeTabId === '__git_diff__'}
          <DiffViewer />
        {:else if pane.activeTabId === '__file__' || pane.activeTabId?.startsWith(FILE_PREFIX)}
          <FileViewer filePath={pane.activeTabId?.startsWith(FILE_PREFIX) ? pane.activeTabId.slice(FILE_PREFIX.length) : null} />
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
              onStopAgent={handleStopAgent}
              onSend={(text) => handleSend(pane.id, pane.activeTabId, text, {})}
              taskItems={sessionStates[pane.activeTabId]?.tasks}
              planMode={sessionStates[pane.activeTabId]?.planMode}
              streamingText={sessionStates[pane.activeTabId]?.currentText || ''}
              isStreaming={sessionStates[pane.activeTabId]?.isStreaming || false}
            />
          {/key}
          {@const pp = formatProjectPath(getSessionProjectPath(pane.activeTabId))}
          {#if pp}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="session-breadcrumb">
              <span class="breadcrumb-link" onclick={() => openAreaTab(pp.area)}>{pp.area}</span>
              {#if pp.project}
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-link" onclick={() => openProjectTab(pp.full)}>{pp.project}</span>
              {/if}
              {#if pp.operation}
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-op">{pp.operation}</span>
              {/if}
              <button class="breadcrumb-untag" onclick={() => { tagSession(pane.activeTabId, null); }} title="Remove tag">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {:else}
            <div class="session-breadcrumb">
              <button class="tag-btn" onclick={() => { tagPickerPane = tagPickerPane === pane.id ? null : pane.id; tagPickerSessionId = pane.activeTabId; fetchBoard(); }} title="Tag to area/project">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              </button>
            </div>
          {/if}
          {#if tagPickerPane === pane.id && boardData.value}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="tag-picker-backdrop" onclick={() => tagPickerPane = null}></div>
            <div class="tag-picker">
              <button class="tag-picker-suggest" onclick={() => suggestTag(tagPickerSessionId)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Ask Claude to suggest
              </button>
              <div class="tag-picker-divider"></div>
              {#each boardData.value.areas as area}
                <button class="tag-picker-area" onclick={() => { tagSession(tagPickerSessionId, area.name); tagPickerPane = null; }}>
                  {area.name}
                </button>
                {#each area.projects as proj}
                  <button class="tag-picker-project" onclick={() => { tagSession(tagPickerSessionId, proj.path); tagPickerPane = null; }}>
                    └ {proj.name}
                  </button>
                {/each}
                {#if area.operations?.length > 0}
                  {#each area.operations as op}
                    <button class="tag-picker-operation" onclick={() => { tagSession(tagPickerSessionId, op.path); tagPickerPane = null; }}>
                      ⚙ {op.name}
                    </button>
                  {/each}
                {/if}
              {/each}
            </div>
          {/if}
          <InputArea
            sessionId={pane.activeTabId}
            processing={sessionStates[pane.activeTabId]?.processing}
            onSend={(text, att) => handleSend(pane.id, pane.activeTabId, text, att)}
            onStop={() => handleStop(pane.activeTabId)}
          />
        {:else if pane.activeTabId && pane.activeTabId !== '__home__' && !pane.activeTabId.startsWith('__')}
          <!-- Tab data not yet loaded — auto-reset stale tabs after 5s -->
          <div class="pane-empty" use:autoResetStaleTab={pane}>
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
    border-color: rgba(var(--accent-rgb), 0.3);
  }

  .pane-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .pane-welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dimmer);
  }

  .welcome-icon {
    opacity: 0.3;
  }

  .welcome-text {
    font-size: 14px;
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

  /* Session breadcrumb */
  .session-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: var(--content-width);
    width: 100%;
    margin: 0 auto;
    padding: 4px 14px;
    box-sizing: border-box;
    font-size: 11px;
    color: var(--text-dimmer);
  }

  .breadcrumb-link {
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.12s;
  }

  .breadcrumb-link:hover {
    color: var(--accent);
  }

  .breadcrumb-sep {
    color: var(--text-dimmer);
    font-size: 10px;
  }

  .tag-btn {
    display: flex; align-items: center; justify-content: center;
    background: none; border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 4px; padding: 2px 6px; cursor: pointer;
    color: var(--text-dimmer); transition: all 0.12s;
  }
  .tag-btn:hover { color: var(--accent); border-color: var(--accent-20); }

  .tag-picker-backdrop {
    position: fixed; inset: 0; z-index: 99;
  }
  .tag-picker {
    position: fixed; bottom: 120px; left: 50%;
    transform: translateX(-50%);
    width: min(400px, 80vw);
    background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 8px; padding: 4px;
    box-shadow: 0 4px 24px rgba(var(--shadow-rgb), 0.4);
    z-index: 100; max-height: 400px; overflow-y: auto;
  }
  .tag-picker-area, .tag-picker-project {
    display: block; width: 100%; text-align: left; padding: 6px 10px;
    background: none; border: none; border-radius: 4px;
    font-size: 12px; cursor: pointer; color: var(--text);
    transition: background 0.1s;
  }
  .tag-picker-area:hover, .tag-picker-project:hover { background: var(--accent-12); }
  .tag-picker-area { font-weight: 600; }
  .tag-picker-project { padding-left: 20px; color: var(--text-muted); font-size: 11px; }
  .tag-picker-operation {
    display: block; width: 100%; text-align: left; padding: 6px 10px 6px 20px;
    background: none; border: none; border-radius: 4px;
    font-size: 11px; cursor: pointer; color: var(--text-dimmer);
    transition: background 0.1s; font-style: italic;
  }
  .tag-picker-operation:hover { background: var(--accent-12); color: var(--text-muted); }

  .tag-picker-suggest {
    display: flex; align-items: center; gap: 8px;
    width: 100%; text-align: left; padding: 8px 10px;
    background: var(--accent-8); border: none; border-radius: 6px;
    font-size: 12px; font-weight: 500; cursor: pointer;
    color: var(--accent); transition: background 0.1s;
  }
  .tag-picker-suggest:hover { background: var(--accent-15); }
  .tag-picker-divider {
    height: 1px; background: rgba(var(--overlay-rgb), 0.08);
    margin: 4px 0;
  }

  .breadcrumb-op { color: var(--text-dimmer); font-style: italic; }

  .breadcrumb-untag {
    display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; margin-left: 4px;
    background: none; border: none; border-radius: 50%;
    color: var(--text-dimmer); cursor: pointer; padding: 0;
    transition: all 0.12s;
  }
  .breadcrumb-untag:hover { color: var(--text-muted); background: rgba(var(--overlay-rgb), 0.06); }

  @keyframes pSpin { to { transform: rotate(360deg); } }
</style>
