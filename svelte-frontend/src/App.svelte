<script>
  import { onMount } from 'svelte';
  import { connect, wsState } from './stores/ws.svelte.js';
  import './stores/session-router.svelte.js'; // Must import to activate the $effect message router
  import { popups, updatePopupTitle } from './stores/popups.svelte.js';
  import { tabs, activeTabId, closeTab } from './stores/tabs.svelte.js';
  import { activeFilePath, closeFileTab } from './stores/files.svelte.js';
  import { panes, activePaneId, splitPane } from './stores/panes.svelte.js';
  import TabBar from './lib/layout/TabBar.svelte';
  import AreasSidebar from './lib/layout/AreasSidebar.svelte';
  import PaneManager from './lib/layout/PaneManager.svelte';
  import QuickOpen from './lib/files/QuickOpen.svelte';
  import ChatPopupManager from './lib/popup/ChatPopupManager.svelte';
  import ToastBar from './lib/layout/ToastBar.svelte';

  let quickOpenVisible = $state(false);

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
        if (activeTabId.value === '__file__' && activeFilePath.value) {
          e.preventDefault();
          closeFileTab(activeFilePath.value);
        } else if (activeTabId.value !== '__home__' && tabs[activeTabId.value]) {
          e.preventDefault();
          closeTab(activeTabId.value);
        }
      }
      // Cmd+\ — split active tab right
      if (e.key === '\\' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const activePane = panes.find(p => p.id === activePaneId.value);
        if (activePane && activePane.activeTabId !== '__home__') {
          splitPane(activePane.activeTabId, 'horizontal');
        }
      }
      // Cmd+1/2/3 — focus pane 1/2/3
      if ((e.key === '1' || e.key === '2' || e.key === '3') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const idx = parseInt(e.key) - 1;
        if (panes[idx]) {
          e.preventDefault();
          activePaneId.value = panes[idx].id;
        }
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<AreasSidebar />

<div class="main-area">
  <TabBar />

  <div class="content-area">
    {#if !wsState.connected}
      <div class="connect-overlay">
        <div class="connect-spinner"></div>
        <div class="connect-text">Connecting to relay...</div>
      </div>
    {:else}
      <PaneManager />
    {/if}
  </div>
</div>

<ChatPopupManager />
<QuickOpen visible={quickOpenVisible} onClose={() => quickOpenVisible = false} />
<ToastBar />

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
</style>
