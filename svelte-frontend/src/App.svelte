<script>
  import { onMount } from 'svelte';
  import { connect, connected, onMessage } from './stores/ws.js';
  import { sessions, activeSessionId, activeSession } from './stores/sessions.js';
  import { messages, processing, activity, thinking, historyDone, projectInfo, clientCount, sendMessage, stopProcessing } from './stores/chat.js';
  import { popups, updatePopupTitle } from './stores/popups.js';

  import Header from './lib/layout/Header.svelte';
  import Sidebar from './lib/layout/Sidebar.svelte';
  import StatusBar from './lib/layout/StatusBar.svelte';
  import MessageList from './lib/chat/MessageList.svelte';
  import InputArea from './lib/chat/InputArea.svelte';
  import FileViewer from './lib/files/FileViewer.svelte';
  import ChatPopupManager from './lib/popup/ChatPopupManager.svelte';
  import { activeFile } from './stores/files.js';

  onMount(() => {
    connect();
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

  function handleSend(text) {
    sendMessage(text);
  }

  function handleStop() {
    stopProcessing();
  }
</script>

<Sidebar projectName={$projectInfo.name || 'Claude Relay'} />

<div class="main-area">
  <Header
    projectName={$projectInfo.name || 'Claude Relay'}
    sessionTitle={sessionTitle}
    clientCount={$clientCount > 1 ? $clientCount : 0}
  />

  <div class="chat-area">
    {#if !$connected}
      <div class="connect-overlay">
        <div class="connect-spinner"></div>
        <div class="connect-text">Connecting to relay...</div>
      </div>
    {:else if $activeFile}
      <FileViewer />
    {:else if !$activeSessionId}
      <div class="home-view">
        <div class="home-content">
          <h1 class="home-title">Claude Relay</h1>
          <p class="home-subtitle">Click a session to open it as a popup</p>
          <div class="home-stats">
            <span class="home-stat">{$sessions.length} sessions</span>
            {#if $projectInfo.version}
              <span class="home-stat">v{$projectInfo.version}</span>
            {/if}
          </div>
        </div>
      </div>
    {:else}
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
    {/if}
  </div>
  <StatusBar />
</div>

<ChatPopupManager />

<style>
  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }

  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
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

  .home-view {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .home-content {
    text-align: center;
    padding: 40px;
  }

  .home-title {
    font-size: 28px;
    font-weight: 600;
    color: #d4d0c8;
    margin-bottom: 8px;
  }

  .home-subtitle {
    font-size: 15px;
    color: #908b81;
    margin-bottom: 20px;
  }

  .home-stats {
    display: flex;
    gap: 16px;
    justify-content: center;
  }

  .home-stat {
    font-size: 13px;
    color: #6d6860;
    background: #2a2924;
    padding: 6px 14px;
    border-radius: 20px;
  }
</style>
