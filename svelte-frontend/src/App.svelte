<script>
  import { onMount } from 'svelte';
  import { connect, wsState } from './stores/ws.svelte.js';
  import './stores/session-router.svelte.js'; // Must import to activate the $effect message router
  import { popups, updatePopupTitle } from './stores/popups.svelte.js';
  import { tabs, activeTabId, closeTab } from './stores/tabs.svelte.js';
  import { createSession } from './stores/sessions.svelte.js';
  import { activeFilePath, closeFileTab } from './stores/files.svelte.js';
  import { panes, activePaneId, splitPane } from './stores/panes.svelte.js';
  import { sidebarOpen, isMobile } from './stores/ui.svelte.js';
  import TabBar from './lib/layout/TabBar.svelte';
  import AreasSidebar from './lib/layout/AreasSidebar.svelte';
  import PaneManager from './lib/layout/PaneManager.svelte';
  import QuickOpen from './lib/files/QuickOpen.svelte';
  import ChatPopupManager from './lib/popup/ChatPopupManager.svelte';
  import ToastBar from './lib/layout/ToastBar.svelte';

  let quickOpenVisible = $state(false);

  onMount(() => {
    // ?reset — clear all persisted UI state (fixes stuck/corrupted tabs)
    if (location.search.includes('reset')) {
      ['claude-relay-tabs', 'claude-relay-panes', 'claude-relay-popups', 'claude-relay-file-tabs', 'claude-relay-active-tab', 'claude-relay-sidebar-sections'].forEach(k => localStorage.removeItem(k));
      history.replaceState(null, '', location.pathname);
      location.reload();
      return;
    }

    // Pass active session ID to WS URL so server starts replaying immediately
    // (zero-delay history load, same as legacy frontend)
    let initialSession = null;
    try {
      const saved = JSON.parse(localStorage.getItem('claude-relay-tabs') || '{}');
      if (saved.activeTabId && !saved.activeTabId.startsWith('__')) initialSession = saved.activeTabId;
    } catch {}
    connect(initialSession);

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
      if (e.key === 'n' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        createSession();
      }
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
  {#if isMobile.value && !sidebarOpen.value}
    <button class="mobile-hamburger" onclick={() => sidebarOpen.value = true} aria-label="Open menu">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  {/if}
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

  .mobile-hamburger {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 50;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .mobile-hamburger:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }
</style>
