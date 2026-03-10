<script>
  import { connected } from '../../stores/ws.js';
  import { slashCommands } from '../../stores/chat.js';

  let {
    processing = false,
    compact = false,
    onSend = null,
    onStop = null,
  } = $props();

  let inputText = $state('');
  let textareaEl = $state(null);
  let showSlashMenu = $state(false);
  let slashActiveIdx = $state(0);

  // Built-in commands
  const builtinCommands = [
    { name: 'clear', desc: 'Clear conversation' },
    { name: 'context', desc: 'Context window usage' },
    { name: 'rewind', desc: 'Toggle rewind mode' },
    { name: 'usage', desc: 'Toggle usage panel' },
    { name: 'status', desc: 'Process status' },
  ];

  let allCommands = $derived([...builtinCommands, ...$slashCommands]);

  let filteredCommands = $derived.by(() => {
    if (!showSlashMenu) return [];
    const query = inputText.startsWith('/') ? inputText.substring(1).toLowerCase() : '';
    return allCommands.filter(c => c.name.toLowerCase().includes(query)).slice(0, 8);
  });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const maxH = compact ? 100 : 120;
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px';
  }

  function handleSend() {
    if (showSlashMenu && filteredCommands.length > 0) {
      selectSlashCommand(filteredCommands[slashActiveIdx]);
      return;
    }

    if (processing) {
      if (inputText.trim()) {
        onSend?.(inputText.trim());
        inputText = '';
        requestAnimationFrame(autoResize);
      } else {
        onStop?.();
      }
      return;
    }

    if (!inputText.trim()) return;
    onSend?.(inputText.trim());
    inputText = '';
    showSlashMenu = false;
    requestAnimationFrame(autoResize);
  }

  function selectSlashCommand(cmd) {
    inputText = '/' + cmd.name + ' ';
    showSlashMenu = false;
    textareaEl?.focus();
  }

  function handleInput() {
    autoResize();
    // Show slash menu when typing / at start
    if (inputText.startsWith('/') && !inputText.includes(' ')) {
      showSlashMenu = true;
      slashActiveIdx = 0;
    } else {
      showSlashMenu = false;
    }
  }

  function handleKeydown(e) {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx + 1) % filteredCommands.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx - 1 + filteredCommands.length) % filteredCommands.length;
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(filteredCommands[slashActiveIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        showSlashMenu = false;
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="input-area" class:compact class:disconnected={!$connected}>
  <!-- Slash command menu -->
  {#if showSlashMenu && filteredCommands.length > 0 && !compact}
    <div class="slash-menu">
      {#each filteredCommands as cmd, i (cmd.name)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="slash-item"
          class:active={i === slashActiveIdx}
          onclick={() => selectSlashCommand(cmd)}
        >
          <span class="slash-name">/{cmd.name}</span>
          <span class="slash-desc">{cmd.desc}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if compact}
    <!-- Compact: pill input + round send button -->
    <div class="input-wrap-compact">
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        oninput={handleInput}
        onkeydown={handleKeydown}
        rows="1"
        placeholder="Message..."
        enterkeyhint="send"
        disabled={!$connected}
      ></textarea>
    </div>
    <button class="send-round" class:stop={processing && !inputText.trim()} onclick={handleSend} disabled={!$connected}>
      {#if processing && !inputText.trim()}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      {/if}
    </button>
  {:else}
    <!-- Full: boxed textarea + text button -->
    <div class="input-wrapper">
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        oninput={handleInput}
        onkeydown={handleKeydown}
        placeholder={$connected ? 'Message Claude... (type / for commands)' : 'Connecting...'}
        disabled={!$connected}
        rows="1"
      ></textarea>
      <div class="input-bottom">
        <div class="input-left"></div>
        <button
          class="send-btn"
          class:stop={processing && !inputText.trim()}
          onclick={handleSend}
          disabled={!$connected}
        >
          {processing ? (inputText.trim() ? 'Send' : 'Stop') : 'Send'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ─── Shared ─── */
  .input-area {
    flex-shrink: 0;
    position: relative;
  }

  .input-area.disconnected {
    opacity: 0.5;
    pointer-events: none;
  }

  /* ─── Slash menu ─── */
  .slash-menu {
    position: absolute;
    bottom: 100%;
    left: 20px;
    right: 20px;
    background: #2a2924;
    border: 1px solid #3e3c37;
    border-radius: 10px;
    padding: 4px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
    z-index: 10;
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .slash-item:hover,
  .slash-item.active {
    background: rgba(218, 119, 86, 0.12);
  }

  .slash-name {
    font-size: 13px;
    font-weight: 600;
    color: #da7756;
    font-family: 'SF Mono', Menlo, monospace;
    min-width: 80px;
  }

  .slash-desc {
    font-size: 12px;
    color: #908b81;
  }

  /* ─── Full mode ─── */
  .input-area:not(.compact) {
    padding: 12px 20px 16px;
    border-top: 1px solid #2a2924;
  }

  .input-wrapper {
    background: #2a2924;
    border-radius: 12px;
    border: 1px solid #3e3c37;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .input-wrapper:focus-within {
    border-color: #6d6860;
  }

  .input-wrapper textarea {
    width: 100%;
    padding: 12px 14px 4px;
    background: transparent;
    border: none;
    color: #e8e5de;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    outline: none;
    min-height: 24px;
    max-height: 120px;
  }

  .input-wrapper textarea::placeholder {
    color: #6d6860;
  }

  .input-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 8px;
  }

  .input-left {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .send-btn {
    padding: 6px 16px;
    background: #da7756;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .send-btn:hover { background: #c5673e; }
  .send-btn:disabled { opacity: 0.5; cursor: default; }
  .send-btn.stop { background: #e5534b; }
  .send-btn.stop:hover { background: #d04440; }

  /* ─── Compact mode ─── */
  .input-area.compact {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    background: #1a1918;
  }

  .input-wrap-compact {
    flex: 1;
    min-width: 0;
  }

  .input-wrap-compact textarea {
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

  .input-wrap-compact textarea:focus {
    border-color: rgba(218, 119, 86, 0.4);
  }

  .input-wrap-compact textarea::placeholder {
    color: #4a4843;
  }

  .send-round {
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

  .send-round:hover { background: #e08565; transform: scale(1.05); }
  .send-round:active { transform: scale(0.95); }
  .send-round:disabled { opacity: 0.5; cursor: default; }
  .send-round.stop { background: #E5534B; }
  .send-round.stop:hover { background: #f06058; }
</style>
