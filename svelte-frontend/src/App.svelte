<script>
  import { onMount } from 'svelte';
  import { connect, connected, onMessage } from './stores/ws.js';
  import { sessions } from './stores/sessions.js';
  import { projectInfo, clientCount } from './stores/chat.js';
  import { popups, updatePopupTitle } from './stores/popups.js';
  import { tabs, activeTabId, tabOrder, switchTab, closeTab, sendTabMessage, stopTab, saveTabScroll, saveTabDraft, sendTabPermissionResponse } from './stores/tabs.js';

  import Header from './lib/layout/Header.svelte';
  import TabBar from './lib/layout/TabBar.svelte';
  import Sidebar from './lib/layout/Sidebar.svelte';
  import MessageList from './lib/chat/MessageList.svelte';
  import InputArea from './lib/chat/InputArea.svelte';
  import FileViewer from './lib/files/FileViewer.svelte';
  import QuickOpen from './lib/files/QuickOpen.svelte';
  import ChatPopupManager from './lib/popup/ChatPopupManager.svelte';
  import CommandPost from './lib/board/CommandPost.svelte';
  import CockpitStrip from './lib/board/CockpitStrip.svelte';
  import { hasOpenFiles } from './stores/files.js';
  import { filePanelVisible, cockpitMode } from './stores/ui.js';

  let quickOpenVisible = $state(false);

  // Resizable split panel — persist width across refresh
  const SPLIT_KEY = 'claude-relay-split-width';
  let filePanelWidth = $state(
    (() => { try { return parseInt(localStorage.getItem(SPLIT_KEY)) || Math.min(Math.round(window.innerWidth * 0.35), 640); } catch { return 520; } })()
  );
  let isResizing = $state(false);

  onMount(() => {
    connect();

    function handleKeydown(e) {
      // Cmd+O — quick open
      if (e.key === 'o' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        quickOpenVisible = !quickOpenVisible;
      }
      // Cmd+W — close current tab
      if (e.key === 'w' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if ($activeTabId !== '__home__' && $tabs[$activeTabId]) {
          e.preventDefault();
          closeTab($activeTabId);
        }
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

  // Active tab state
  let activeTab = $derived($tabs[$activeTabId]);
  let isHomeTab = $derived($activeTabId === '__home__');
  let isSessionTab = $derived(!isHomeTab && !!activeTab);

  // Header title from active tab
  let sessionTitle = $derived(activeTab?.title || '');

  // Get account info for active tab's session
  let activeTabSession = $derived.by(() => {
    if (!activeTab) return null;
    return $sessions.find(s => s.id === activeTab.sessionId) || null;
  });

  let showFilePanel = $derived($hasOpenFiles && $filePanelVisible && $connected);
  let showSplit = $derived(showFilePanel);

  // Calculate popup bar height — only if popups overlap with the centered input area
  let chatPanelEl = $state(null);
  let popupBarHeight = $derived.by(() => {
    const list = Object.values($popups);
    if (list.length === 0) return 0;

    const panelRect = chatPanelEl?.getBoundingClientRect();
    if (!panelRect) return 0;
    const inputW = Math.min(900, panelRect.width);
    const inputLeft = panelRect.left + (panelRect.width - inputW) / 2;
    const inputRight = inputLeft + inputW;

    const vpWidth = window.innerWidth;
    let popupRight = vpWidth - 16;
    let maxH = 0;

    for (const p of list) {
      const popupLeft = popupRight - 340;
      if (popupLeft < inputRight && popupRight > inputLeft) {
        maxH = Math.max(maxH, p.minimized ? 40 : 480);
      }
      popupRight = popupLeft - 6;
    }

    return maxH > 0 ? maxH + 8 : 0;
  });

  // Tab send/stop handlers
  function handleTabSend(text) {
    if (isSessionTab) {
      sendTabMessage($activeTabId, text);
    }
  }

  function handleTabStop() {
    if (isSessionTab) {
      stopTab($activeTabId);
    }
  }

  function handleTabPermissionRespond(requestId, decision) {
    if (isSessionTab) {
      sendTabPermissionResponse($activeTabId, requestId, decision);
    }
  }

  // Save scroll position when switching tabs
  let previousTabId = $state(null);
  let messagesElRef = $state(null);

  $effect(() => {
    const current = $activeTabId;
    if (previousTabId && previousTabId !== current && messagesElRef) {
      saveTabScroll(previousTabId, messagesElRef.scrollTop || 0);
    }
    previousTabId = current;
  });

  function startResize(e) {
    e.preventDefault();
    isResizing = true;

    const startX = e.clientX;
    const startWidth = filePanelWidth;

    function onMove(e) {
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
    accountId={activeTabSession?.accountId}
    accounts={$projectInfo.accounts || []}
  />

  <TabBar />

  <div class="content-area" class:split={showSplit} class:resizing={isResizing}>
    {#if !$connected}
      <div class="connect-overlay">
        <div class="connect-spinner"></div>
        <div class="connect-text">Connecting to relay...</div>
      </div>
    {:else}
      <!-- Left panel: chat (if session tab) or command post (home tab) -->
      <div class="chat-panel" bind:this={chatPanelEl} style:padding-bottom="{isSessionTab ? popupBarHeight : 0}px">
        {#if isSessionTab}
          {#key $activeTabId}
            <MessageList
              messages={activeTab.messages}
              processing={activeTab.processing}
              activity={activeTab.activity}
              thinking={{ active: activeTab.thinking, text: '' }}
              loadingHistory={activeTab.loadingHistory}
              onPermissionRespond={handleTabPermissionRespond}
              taskItems={activeTab.tasks}
            />
          {/key}
          <InputArea
            processing={activeTab.processing}
            onSend={handleTabSend}
            onStop={handleTabStop}
          />
        {:else}
          <CommandPost />
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
  {#if $cockpitMode === 'floating'}
    <CockpitStrip mode="floating" />
  {/if}
</div>

<ChatPopupManager />
<QuickOpen visible={quickOpenVisible} onClose={() => quickOpenVisible = false} />

<style>
  .main-area {
    position: relative;
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
    border-left: 1px solid rgba(var(--overlay-rgb), 0.06);
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
    background: var(--accent-30);
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
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .connect-text {
    font-size: 14px;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .content-area.split {
      flex-direction: column;
    }

    .file-panel {
      width: 100% !important;
      height: 40vh;
      border-left: none;
      border-top: 1px solid rgba(var(--overlay-rgb), 0.06);
    }

    .resize-handle {
      display: none;
    }
  }
</style>
