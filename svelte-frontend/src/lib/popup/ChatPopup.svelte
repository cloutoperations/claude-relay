<script>
  import { renderMarkdown, highlightCodeBlocks } from '../../utils/markdown.js';
  import { toggleMinimize, closePopup, sendPopupMessage, sendPopupPermissionResponse, stopPopupProcessing, minimizeAll } from '../../stores/popups.js';
  import { switchSession } from '../../stores/sessions.js';

  let { popup } = $props();

  let inputText = $state('');
  let bodyEl;
  let textareaEl;
  let prevMsgCount = 0;

  // Auto-scroll when new messages arrive
  $effect(() => {
    const count = popup.messages.length;
    if (bodyEl && count > prevMsgCount && !popup.minimized) {
      requestAnimationFrame(() => {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      });
    }
    prevMsgCount = count;
  });

  // Also auto-scroll on streaming text updates
  $effect(() => {
    if (popup.currentText && bodyEl && !popup.minimized) {
      requestAnimationFrame(() => {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      });
    }
  });

  // Highlight code in assistant messages after render
  $effect(() => {
    if (bodyEl && popup.messages.length > 0) {
      requestAnimationFrame(() => {
        bodyEl.querySelectorAll('pre code:not(.hljs)').forEach(block => {
          try { import('highlight.js').then(m => m.default.highlightElement(block)); } catch {}
        });
      });
    }
  });

  function handleSend() {
    if (popup.processing && !inputText.trim()) {
      stopPopupProcessing(popup.sessionId);
      return;
    }
    if (!inputText.trim()) return;
    sendPopupMessage(popup.sessionId, inputText.trim());
    inputText = '';
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = Math.min(textareaEl.scrollHeight, 100) + 'px';
    }
  }

  function handleHeaderClick(e) {
    if (e.target.closest('.cp-actions')) return;
    toggleMinimize(popup.sessionId);
  }

  function handleExpand(e) {
    e.stopPropagation();
    minimizeAll();
    closePopup(popup.sessionId);
    switchSession(popup.sessionId);
  }

  function handleClose(e) {
    e.stopPropagation();
    closePopup(popup.sessionId);
  }

  function handleMinimize(e) {
    e.stopPropagation();
    toggleMinimize(popup.sessionId);
  }

  function handleAllow(requestId) {
    sendPopupPermissionResponse(popup.sessionId, requestId, 'allow');
  }

  function handleDeny(requestId) {
    sendPopupPermissionResponse(popup.sessionId, requestId, 'deny');
  }

  function truncate(str, len) {
    return str.length <= len ? str : str.substring(0, len) + '\u2026';
  }

  // Collapse consecutive tool messages for cleaner display
  function shouldShowTool(messages, index) {
    const msg = messages[index];
    if (msg.type !== 'tool') return true;
    // Always show running tools
    if (msg.status === 'running') return true;
    // Show error tools
    if (msg.status === 'error') return true;
    // For done tools, collapse if next message is also a done tool
    const next = messages[index + 1];
    if (next && next.type === 'tool' && next.status !== 'running') return false;
    return true;
  }
</script>

<div
  class="chat-popup"
  class:minimized={popup.minimized}
  class:cp-processing={popup.processing || popup.status === 'processing'}
  class:cp-done={popup.status === 'done' || popup.status === 'idle'}
  class:cp-permission={popup.status === 'permission'}
  class:has-unread={popup.hasUnread}
>
  <!-- Header -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cp-header" onclick={handleHeaderClick}>
    <div class="cp-header-left">
      <span class="cp-dot"></span>
      <span class="cp-title">{truncate(popup.title, 28)}</span>
    </div>
    <div class="cp-actions">
      <button onclick={handleMinimize} title="Minimize">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button onclick={handleExpand} title="Open full">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
      <button onclick={handleClose} title="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  {#if !popup.minimized}
    <!-- Messages -->
    <div class="cp-body" bind:this={bodyEl}>
      {#if popup.loadingHistory}
        <div class="cp-loading">
          <div class="cp-loading-dots">
            <span></span><span></span><span></span>
          </div>
          <span>Loading history...</span>
        </div>
      {/if}

      {#each popup.messages as msg, i (i)}
        {#if msg.type === 'user'}
          <div class="cp-row-user">
            <div class="cp-msg-user">{msg.text}</div>
          </div>
        {:else if msg.type === 'assistant'}
          <div class="cp-row-assistant">
            <div class="cp-msg-assistant">
              <div class="md-content">{@html renderMarkdown(msg.text)}</div>
            </div>
          </div>
        {:else if msg.type === 'tool' && shouldShowTool(popup.messages, i)}
          <div class="cp-tool cp-tool-{msg.status}">
            <div class="cp-tool-indicator">
              {#if msg.status === 'running'}
                <div class="cp-tool-spinner"></div>
              {:else if msg.status === 'error'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              {:else}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {/if}
            </div>
            <span class="cp-tool-name">{msg.name}</span>
          </div>
        {:else if msg.type === 'permission'}
          <div class="cp-permission-block" class:resolved={msg.resolved}>
            <div class="cp-perm-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Permission needed</span>
            </div>
            <div class="cp-perm-tool">{msg.toolName}{msg.inputSummary ? ': ' + truncate(msg.inputSummary, 36) : ''}</div>
            {#if !msg.resolved}
              <div class="cp-perm-actions">
                <button class="cp-perm-btn allow" onclick={() => handleAllow(msg.requestId)}>Allow</button>
                <button class="cp-perm-btn deny" onclick={() => handleDeny(msg.requestId)}>Deny</button>
              </div>
            {:else}
              <div class="cp-perm-resolved">
                {#if msg.decision === 'allow'}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Allowed
                {:else}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  {msg.decision === 'deny' ? 'Denied' : 'Cancelled'}
                {/if}
              </div>
            {/if}
          </div>
        {:else if msg.type === 'info'}
          <div class="cp-info">{msg.text}</div>
        {/if}
      {/each}

      {#if popup.thinking}
        <div class="cp-thinking">
          <div class="cp-thinking-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Input -->
    <div class="cp-input-area">
      <div class="cp-input-wrap">
        <textarea
          bind:this={textareaEl}
          bind:value={inputText}
          oninput={handleInput}
          onkeydown={handleKeydown}
          rows="1"
          placeholder="Message..."
          enterkeyhint="send"
        ></textarea>
      </div>
      <button class="cp-send" class:stop={popup.processing && !inputText.trim()} onclick={handleSend}>
        {#if popup.processing && !inputText.trim()}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .chat-popup {
    width: 340px;
    height: 480px;
    display: flex;
    flex-direction: column;
    background: #1a1918;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow:
      0 -2px 16px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(0, 0, 0, 0.2);
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
    background: #222120;
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
    background: #4a4843;
    transition: all 0.3s;
  }

  .cp-processing .cp-dot {
    background: #da7756;
    box-shadow: 0 0 6px rgba(218, 119, 86, 0.5);
    animation: cp-glow 2s ease-in-out infinite;
  }

  .cp-permission .cp-dot {
    background: #E5534B;
    box-shadow: 0 0 8px rgba(229, 83, 75, 0.6);
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
    color: #c8c3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }

  .has-unread .cp-title {
    color: #da7756;
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
    color: #5a5650;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    padding: 0;
  }

  .cp-actions button:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #a09a90;
  }

  /* ─── Body ─── */
  .cp-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.08) transparent;
    background: #1a1918;
  }

  .cp-body::-webkit-scrollbar { width: 5px; }
  .cp-body::-webkit-scrollbar-track { background: transparent; }
  .cp-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
  .cp-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }

  /* ─── Messages ─── */
  .cp-row-user {
    display: flex;
    justify-content: flex-end;
    padding: 2px 0;
  }

  .cp-msg-user {
    max-width: 82%;
    padding: 8px 12px;
    background: #da7756;
    color: white;
    border-radius: 14px 14px 4px 14px;
    font-size: 13px;
    line-height: 1.45;
    word-wrap: break-word;
    font-weight: 400;
  }

  .cp-row-assistant {
    display: flex;
    padding: 2px 0;
  }

  .cp-msg-assistant {
    max-width: 92%;
    padding: 8px 12px;
    background: #262523;
    border-radius: 14px 14px 14px 4px;
    font-size: 13px;
    color: #c8c3b8;
    line-height: 1.5;
    word-wrap: break-word;
  }

  .cp-msg-assistant :global(.md-content) { font-size: 13px; }
  .cp-msg-assistant :global(.md-content p) { margin: 0 0 8px; }
  .cp-msg-assistant :global(.md-content p:last-child) { margin-bottom: 0; }
  .cp-msg-assistant :global(.md-content ul),
  .cp-msg-assistant :global(.md-content ol) { margin: 4px 0; padding-left: 18px; }
  .cp-msg-assistant :global(.md-content li) { margin: 2px 0; }
  .cp-msg-assistant :global(.md-content pre) {
    font-size: 11px;
    padding: 8px 10px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 6px 0;
    background: #141312;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }
  .cp-msg-assistant :global(.md-content code) {
    font-size: 11.5px;
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  }
  .cp-msg-assistant :global(.md-content code:not(pre code)) {
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  .cp-msg-assistant :global(.md-content a) {
    color: #da7756;
    text-decoration: none;
  }
  .cp-msg-assistant :global(.md-content a:hover) {
    text-decoration: underline;
  }
  .cp-msg-assistant :global(.md-content strong) {
    color: #ddd8ce;
    font-weight: 600;
  }

  /* ─── Tool indicators ─── */
  .cp-tool {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px;
    margin: 1px 0;
    font-size: 11px;
    color: #5a5650;
    border-radius: 6px;
  }

  .cp-tool-indicator {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cp-tool-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: cp-spin 0.7s linear infinite;
  }

  @keyframes cp-spin {
    to { transform: rotate(360deg); }
  }

  .cp-tool-name { font-weight: 500; }
  .cp-tool-running { color: #da7756; }
  .cp-tool-done { color: #4a4843; }
  .cp-tool-done .cp-tool-indicator { color: #57AB5A; }
  .cp-tool-error { color: #E5534B; }

  /* ─── Permission ─── */
  .cp-permission-block {
    padding: 10px 12px;
    border: 1px solid rgba(218, 119, 86, 0.25);
    border-radius: 10px;
    background: rgba(218, 119, 86, 0.04);
    margin: 4px 0;
  }

  .cp-permission-block.resolved {
    border-color: rgba(255, 255, 255, 0.06);
    background: none;
    opacity: 0.6;
  }

  .cp-perm-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #da7756;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .cp-perm-tool {
    font-size: 12px;
    font-weight: 500;
    color: #c8c3b8;
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', Menlo, monospace;
    background: rgba(255, 255, 255, 0.03);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .cp-perm-actions { display: flex; gap: 8px; }

  .cp-perm-btn {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cp-perm-btn.allow {
    background: #57AB5A;
    color: white;
  }
  .cp-perm-btn.allow:hover { background: #63bc66; }
  .cp-perm-btn.deny {
    background: rgba(255, 255, 255, 0.06);
    color: #908B81;
  }
  .cp-perm-btn.deny:hover { background: rgba(255, 255, 255, 0.1); color: #c8c3b8; }

  .cp-perm-resolved {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #5a5650;
    font-weight: 500;
  }

  /* ─── Info ─── */
  .cp-info {
    font-size: 11px;
    color: #5a5650;
    text-align: center;
    padding: 6px 10px;
    font-style: italic;
  }

  /* ─── Thinking dots ─── */
  .cp-thinking {
    padding: 4px 0;
  }

  .cp-thinking-dots,
  .cp-loading-dots {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
  }

  .cp-thinking-dots span,
  .cp-loading-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5a5650;
    animation: cp-bounce 1.4s ease-in-out infinite;
  }

  .cp-thinking-dots span:nth-child(2),
  .cp-loading-dots span:nth-child(2) { animation-delay: 0.16s; }
  .cp-thinking-dots span:nth-child(3),
  .cp-loading-dots span:nth-child(3) { animation-delay: 0.32s; }

  @keyframes cp-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

  /* ─── Loading ─── */
  .cp-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px;
    color: #5a5650;
    font-size: 11px;
  }

  /* ─── Input area ─── */
  .cp-input-area {
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px 12px;
    background: #1a1918;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .cp-input-wrap {
    flex: 1;
    min-width: 0;
  }

  .cp-input-area textarea {
    width: 100%;
    min-height: 34px;
    max-height: 100px;
    padding: 7px 12px;
    background: #262523;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px;
    color: #e0dbd2;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .cp-input-area textarea:focus {
    border-color: rgba(218, 119, 86, 0.4);
  }

  .cp-input-area textarea::placeholder {
    color: #4a4843;
  }

  .cp-send {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #da7756;
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
  }

  .cp-send:hover {
    background: #e08565;
    transform: scale(1.05);
  }

  .cp-send:active {
    transform: scale(0.95);
  }

  .cp-send.stop {
    background: #E5534B;
  }

  .cp-send.stop:hover {
    background: #f06058;
  }

  /* ─── Responsive ─── */
  @media (max-width: 768px) {
    .chat-popup { width: 300px; height: 420px; }
  }

  @media (max-width: 500px) {
    .chat-popup { width: calc(100vw - 16px); height: 50vh; }
  }
</style>
