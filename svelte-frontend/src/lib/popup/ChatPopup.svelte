<script>
  import { toggleMinimize, closePopup, sendPopupMessage, sendPopupPermissionResponse, stopPopupProcessing } from '../../stores/popups.svelte.js';
  import { promotePopupToTab } from '../../stores/tabs.svelte.js';
  import { sessionList as sessions } from '../../stores/sessions.svelte.js';
  import { sessions as sessionStates } from '../../stores/session-state.svelte.js';
  import { projectInfo } from '../../stores/chat.svelte.js';
  import MessageList from '../chat/MessageList.svelte';
  import InputArea from '../chat/InputArea.svelte';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let { popup } = $props();

  // Session content from unified state (messages, processing, etc.)
  let sessionState = $derived(sessionStates[popup.sessionId]);

  let accounts = $derived(projectInfo.accounts || []);
  let sessionData = $derived(sessions.find(s => s.id === popup.sessionId));
  let accountColor = $derived.by(() => {
    if (accounts.length < 2 || !sessionData?.accountId) return null;
    const idx = accounts.findIndex(a => a.id === sessionData.accountId);
    return ACCOUNT_COLORS[idx >= 0 ? idx % ACCOUNT_COLORS.length : 0];
  });

  function handleHeaderClick(e) {
    if (e.target.closest('.cp-actions')) return;
    toggleMinimize(popup.sessionId);
  }

  function handleExpand(e) {
    e.stopPropagation();
    promotePopupToTab(popup.sessionId);
  }

  function handleClose(e) {
    e.stopPropagation();
    closePopup(popup.sessionId);
  }

  function handleMinimize(e) {
    e.stopPropagation();
    toggleMinimize(popup.sessionId);
  }

  function handleSend(text) {
    sendPopupMessage(popup.sessionId, text);
  }

  function handleStop() {
    stopPopupProcessing(popup.sessionId);
  }

  function handlePermissionRespond(requestId, decision) {
    sendPopupPermissionResponse(popup.sessionId, requestId, decision);
  }

  function truncate(str, len) {
    return str.length <= len ? str : str.substring(0, len) + '\u2026';
  }

  // Resizable height
  const POPUP_HEIGHT_KEY = 'claude-relay-popup-height';
  let savedHeight = null;
  try { savedHeight = parseInt(localStorage.getItem(POPUP_HEIGHT_KEY)); } catch {}
  let popupHeight = $state(savedHeight && savedHeight > 200 ? savedHeight : null);
  let isResizing = $state(false);

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    const startY = e.clientY;
    const startHeight = popupHeight || 380;

    function onMove(e) {
      const delta = startY - e.clientY;
      const newH = Math.max(200, Math.min(window.innerHeight * 0.8, startHeight + delta));
      popupHeight = newH;
    }

    function onUp() {
      isResizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (popupHeight) {
        try { localStorage.setItem(POPUP_HEIGHT_KEY, String(Math.round(popupHeight))); } catch {}
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
</script>

<div
  class="chat-popup"
  class:minimized={popup.minimized}
  class:cp-processing={sessionState?.processing || sessionState?.status === 'processing'}
  class:cp-done={sessionState?.status === 'done' || sessionState?.status === 'idle'}
  class:cp-permission={sessionState?.status === 'permission'}
  class:has-unread={popup.hasUnread}
  class:resizing={isResizing}
  style={popupHeight && !popup.minimized ? `height: ${popupHeight}px` : ''}
>
  <!-- Resize handle at top -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#if !popup.minimized}
    <div class="cp-resize-handle" onmousedown={startResize}></div>
  {/if}

  <!-- Header -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cp-header" onclick={handleHeaderClick}>
    <div class="cp-header-left">
      <span class="cp-dot" style={accountColor ? '--acct-color: ' + accountColor : ''}></span>
      <span class="cp-title">{truncate(popup.title, 28)}</span>
    </div>
    <div class="cp-actions">
      <button onclick={handleMinimize} title="Minimize">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button onclick={handleExpand} title="Open as tab">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
      <button onclick={handleClose} title="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  {#if !popup.minimized}
    <MessageList
      messages={sessionState?.messages || []}
      processing={sessionState?.processing || false}
      activity={sessionState?.activity || null}
      thinking={{ active: sessionState?.thinking || false, text: '' }}
      loadingHistory={sessionState?.loadingHistory || false}
      loadingEarlier={sessionState?.loadingEarlier || false}
      hasEarlier={sessionState?.historyFrom > 0}
      onLoadEarlier={() => { import('../../stores/tabs.svelte.js').then(m => m.loadEarlierHistory(popup.sessionId)); }}
      compact={true}
      onPermissionRespond={handlePermissionRespond}
      taskItems={sessionState?.tasks || []}
    />
    <InputArea
      sessionId={popup.sessionId}
      processing={sessionState?.processing || false}
      compact={true}
      onSend={handleSend}
      onStop={handleStop}
    />
  {/if}
</div>

<style>
  .cp-resize-handle {
    position: absolute;
    top: -3px;
    left: 20px;
    right: 20px;
    height: 6px;
    cursor: ns-resize;
    z-index: 2;
  }

  .cp-resize-handle:hover, .resizing .cp-resize-handle {
    background: var(--accent-25);
    border-radius: 3px;
  }

  .chat-popup {
    position: relative;
    width: clamp(380px, 25vw, 500px);
    height: 380px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -1px 8px rgba(var(--shadow-rgb), 0.15);
    overflow: hidden;
    transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .chat-popup.minimized {
    height: 40px;
    border-radius: 10px 10px 0 0;
  }

  /* ─── Header ─── */
  .cp-header {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 6px 0 14px;
    background: var(--bg-raised);
    cursor: pointer;
    user-select: none;
  }

  .cp-header-left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    flex: 1;
  }

  .cp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--acct-color, var(--border));
    transition: all 0.3s;
  }

  .cp-processing .cp-dot {
    background: var(--acct-color, #da7756);
    box-shadow: 0 0 6px color-mix(in srgb, var(--acct-color, #da7756) 50%, transparent);
    animation: cp-glow 2s ease-in-out infinite;
  }

  .cp-permission .cp-dot {
    background: var(--error);
    box-shadow: 0 0 8px rgba(var(--error-rgb), 0.6);
    animation: cp-glow 1s ease-in-out infinite;
  }

  @keyframes cp-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .cp-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }

  .has-unread .cp-title {
    color: var(--accent);
  }

  .cp-actions {
    display: flex;
    gap: 1px;
    flex-shrink: 0;
  }

  .cp-actions button {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    padding: 0;
  }

  .cp-actions button:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text-muted);
  }

  /* ─── Responsive ─── */
  @media (max-width: 768px) {
    .chat-popup { width: 300px; height: 420px; }
  }

  @media (max-width: 500px) {
    .chat-popup { width: calc(100vw - 16px); height: 50vh; }
  }
</style>
