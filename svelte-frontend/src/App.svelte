<script>
  import { onMount } from 'svelte';
  import { connect, connected, onMessage } from './stores/ws.js';
  import { sessions, activeSessionId, activeSession } from './stores/sessions.js';
  import { messages, processing, activity, thinking, historyDone, projectInfo, clientCount, sendMessage, stopProcessing } from './stores/chat.js';
  import { popups, updatePopupTitle } from './stores/popups.js';

  import Header from './lib/layout/Header.svelte';
  import Sidebar from './lib/layout/Sidebar.svelte';
  import MessageList from './lib/chat/MessageList.svelte';
  import InputArea from './lib/chat/InputArea.svelte';
  import FileViewer from './lib/files/FileViewer.svelte';
  import QuickOpen from './lib/files/QuickOpen.svelte';
  import ChatPopupManager from './lib/popup/ChatPopupManager.svelte';
  import Workbench from './lib/board/Workbench.svelte';
  import DrilldownView from './lib/board/DrilldownView.svelte';
  import { hasOpenFiles } from './stores/files.js';
  import { filePanelVisible } from './stores/ui.js';
  import { drilldownView, navigateHome } from './stores/board.js';

  let quickOpenVisible = $state(false);

  // Resizable split panel — persist width across refresh
  const SPLIT_KEY = 'claude-relay-split-width';
  let filePanelWidth = $state(
    (() => { try { return parseInt(localStorage.getItem(SPLIT_KEY)) || 480; } catch { return 480; } })()
  );
  let isResizing = $state(false);

  onMount(() => {
    connect();

    function handleKeydown(e) {
      if (e.key === 'o' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        quickOpenVisible = !quickOpenVisible;
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  // Update popup titles when session list changes
  onMessage((msg) => {
    if (msg.type === 'session_list') {
      const openIds = Object.keys($popups);
      for (const s of (msg.sessions || [])) {
        if (openIds.includes(s.id) && s.title) {
          updatePopupTitle(s.id, s.title);
        }
      }
    }
  });

  let sessionTitle = $derived($activeSession?.title || '');
  let showFilePanel = $derived($hasOpenFiles && $filePanelVisible && $connected);
  let showSplit = $derived(showFilePanel);

  function handleSend(text) {
    sendMessage(text);
  }

  function handleStop() {
    stopProcessing();
  }

  function startResize(e) {
    e.preventDefault();
    isResizing = true;

    const startX = e.clientX;
    const startWidth = filePanelWidth;

    function onMove(e) {
      // Dragging left = wider file panel (since it's on the right)
      const delta = startX - e.clientX;
      filePanelWidth = Math.max(280, Math.min(window.innerWidth * 0.6, startWidth + delta));
    }

    function onUp() {
      isResizing = false;
      try { localStorage.setItem(SPLIT_KEY, String(filePanelWidth)); } catch {}
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
</script>

<Sidebar projectName={$projectInfo.name || 'Claude Relay'} />

<div class="main-area">
  <Header
    projectName={$projectInfo.name || 'Claude Relay'}
    sessionTitle={sessionTitle}
    clientCount={$clientCount > 1 ? $clientCount : 0}
    accountId={$activeSession?.accountId}
    accounts={$projectInfo.accounts || []}
  />

  <div class="content-area" class:split={showSplit} class:resizing={isResizing}>
    {#if !$connected}
      <div class="connect-overlay">
        <div class="connect-spinner"></div>
        <div class="connect-text">Connecting to relay...</div>
      </div>
    {:else}
      <!-- Left panel: chat (if session) or workbench/drilldown -->
      <div class="chat-panel">
        {#if $activeSessionId}
          <MessageList
            messages={$messages}
            processing={$processing}
            activity={$activity}
            thinking={$thinking}
          />
          <InputArea
            processing={$processing}
            onSend={handleSend}
            onStop={handleStop}
          />
        {:else if $drilldownView}
          <DrilldownView />
        {:else}
          <Workbench />
        {/if}
      </div>

      <!-- Right panel: files (split) -->
      {#if showFilePanel}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="resize-handle" onmousedown={startResize}></div>
        <div class="file-panel" style="width: {filePanelWidth}px">
          <FileViewer />
        </div>
      {/if}
    {/if}
  </div>
</div>

<ChatPopupManager />
<QuickOpen visible={quickOpenVisible} onClose={() => quickOpenVisible = false} />

<style>
  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .content-area.split {
    flex-direction: row;
  }

  /* Disable text selection while resizing */
  .content-area.resizing {
    user-select: none;
    cursor: col-resize;
  }

  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .file-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  .resize-handle {
    width: 5px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
    transition: background 0.15s;
  }

  .resize-handle:hover,
  .resizing .resize-handle {
    background: rgba(218, 119, 86, 0.3);
  }

  .connect-overlay {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .connect-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid #3e3c37;
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .connect-text {
    font-size: 14px;
    color: #908b81;
  }

  @media (max-width: 768px) {
    .content-area.split {
      flex-direction: column;
    }

    .file-panel {
      width: 100% !important;
      height: 40vh;
      border-left: none;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .resize-handle {
      display: none;
    }
  }
</style>
