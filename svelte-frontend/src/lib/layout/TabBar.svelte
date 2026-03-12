<script>
  import { tabs, activeTabId, switchTab, closeTab } from '../../stores/tabs.js';
  import { tabOrder } from '../../stores/tabs.js';

  let tabList = $derived.by(() => {
    const order = $tabOrder;
    const allTabs = $tabs;
    return order.map(id => {
      if (id === '__home__') {
        return { id: '__home__', title: 'Home', isHome: true };
      }
      const tab = allTabs[id];
      if (!tab) return null;
      return {
        id,
        title: tab.title || 'Session',
        processing: tab.processing,
        hasUnread: tab.hasUnread,
        isHome: false,
      };
    }).filter(Boolean);
  });

  let active = $derived($activeTabId);

  function handleTabClick(id) {
    switchTab(id);
    // Clear unread when switching to tab
    if (id !== '__home__') {
      tabs.update(t => {
        if (!t[id]) return t;
        return { ...t, [id]: { ...t[id], hasUnread: false } };
      });
    }
  }

  function handleMiddleClick(e, id) {
    if (e.button === 1 && id !== '__home__') {
      e.preventDefault();
      closeTab(id);
    }
  }

  function handleCloseClick(e, id) {
    e.stopPropagation();
    closeTab(id);
  }

  // Only show tab bar if there are session tabs (not just home)
  let hasSessionTabs = $derived(tabList.length > 1);
</script>

{#if hasSessionTabs}
  <div class="tab-bar">
    <div class="tab-list">
      {#each tabList as tab (tab.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tab"
          class:active={active === tab.id}
          class:home={tab.isHome}
          class:unread={tab.hasUnread}
          onclick={() => handleTabClick(tab.id)}
          onauxclick={(e) => handleMiddleClick(e, tab.id)}
          title={tab.title}
        >
          {#if tab.isHome}
            <svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          {:else}
            {#if tab.processing}
              <span class="tab-spinner"></span>
            {/if}
            <span class="tab-title">{tab.title}</span>
            <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    background: #1a1918;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    min-width: 0;
    height: 36px;
  }

  .tab-list {
    display: flex;
    flex: 1;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: none;
    height: 100%;
  }

  .tab-list::-webkit-scrollbar { display: none; }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
    color: #6b6760;
    cursor: pointer;
    white-space: nowrap;
    border-right: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
    user-select: none;
    height: 100%;
    position: relative;
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #908b81;
  }

  .tab.active {
    background: #222120;
    color: #d4d0c8;
  }

  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: #da7756;
  }

  .tab.unread:not(.active) {
    color: #da7756;
  }

  .tab.home {
    padding: 0 10px;
  }

  .tab-icon {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .tab.active .tab-icon {
    opacity: 1;
    color: #da7756;
  }

  .tab-title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: #5a5650;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #d4d0c8;
  }

  .tab-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: tabSpin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes tabSpin { to { transform: rotate(360deg); } }
</style>
