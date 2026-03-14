<script>
  import { wsState } from '../../stores/ws.svelte.js';
  import { slashCommands } from '../../stores/chat.svelte.js';
  import { tabs, saveTabDraft } from '../../stores/tabs.svelte.js';
  import { sessionSettings, sendSettings } from '../../stores/session-settings.svelte.js';

  let {
    processing = false,
    compact = false,
    sessionId = null,
    onSend = null,
    onStop = null,
  } = $props();

  let inputText = $state('');
  let showEffort = $state(false);
  let attachments = $state([]);  // { type: 'image'|'document'|'text', name, mediaType, data, size }
  let dragging = $state(false);
  let fileInputEl = $state(null);

  // Restore draft text when sessionId changes (tab switch)
  $effect(() => {
    if (sessionId && tabs[sessionId]) {
      inputText = tabs[sessionId].draftText || '';
    }
  });
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

  let allCommands = $derived([...builtinCommands, ...slashCommands]);

  let filteredCommands = $derived.by(() => {
    if (!showSlashMenu) return [];
    const query = inputText.startsWith('/') ? inputText.substring(1).toLowerCase() : '';
    return allCommands.filter(c => c.name.toLowerCase().includes(query)).slice(0, 8);
  });

  const effortLevels = [
    { value: '', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Med' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
  ];

  function setEffort(value) {
    sessionSettings.effort = value;
    sendSettings();
    showEffort = false;
  }

  // --- File handling ---

  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const PDF_TYPE = 'application/pdf';
  const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
    'css', 'html', 'xml', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash',
    'zsh', 'fish', 'sql', 'graphql', 'svelte', 'vue', 'php', 'swift', 'kt', 'scala', 'r',
    'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'ml', 'clj', 'lisp', 'el', 'vim',
    'dockerfile', 'makefile', 'cmake', 'gradle', 'env', 'gitignore', 'editorconfig',
    'csv', 'tsv', 'log', 'diff', 'patch',
  ]);

  function classifyFile(file) {
    const ext = file.name?.split('.').pop()?.toLowerCase() || '';
    // Check extension first — more reliable than MIME (macOS clipboard lies about PDFs)
    if (ext === 'pdf' || file.type === PDF_TYPE) return 'document';
    if (IMAGE_TYPES.has(file.type)) return 'image';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    if (file.type.startsWith('text/')) return 'text';
    // Unknown binary — skip
    return null;
  }

  function readFileAsBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]); // strip data:...;base64,
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(file);
    });
  }

  async function processFiles(files) {
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) continue; // skip files > 50MB
      const kind = classifyFile(file);
      if (!kind) continue;

      if (kind === 'text') {
        const content = await readFileAsText(file);
        attachments = [...attachments, {
          type: 'text', name: file.name, content,
          size: file.size, lines: content.split('\n').length,
        }];
      } else {
        const data = await readFileAsBase64(file);
        attachments = [...attachments, {
          type: kind, name: file.name, mediaType: file.type, data,
          size: file.size,
        }];
      }
    }
  }

  function removeAttachment(idx) {
    attachments = attachments.filter((_, i) => i !== idx);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    dragging = false;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) processFiles(files);
  }

  function handleDragOver(e) {
    e.preventDefault();
    dragging = true;
  }

  function handleDragLeave(e) {
    // Only clear if leaving the input-area itself
    if (!e.currentTarget.contains(e.relatedTarget)) dragging = false;
  }

  function openFilePicker() {
    fileInputEl?.click();
  }

  function handleFileInput(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFiles(files);
    e.target.value = ''; // reset so same file can be re-selected
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }

  // --- Core input ---

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const maxH = compact ? 100 : 120;
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px';
  }

  function handleSend() {
    if (!wsState.connected) return;

    if (showSlashMenu && filteredCommands.length > 0) {
      selectSlashCommand(filteredCommands[slashActiveIdx]);
      return;
    }

    if (processing) {
      if (inputText.trim() || attachments.length > 0) {
        onSend?.(inputText.trim(), collectAttachments());
        inputText = '';
        attachments = [];
        requestAnimationFrame(autoResize);
      } else {
        onStop?.();
      }
      return;
    }

    if (!inputText.trim() && attachments.length === 0) return;
    onSend?.(inputText.trim(), collectAttachments());
    inputText = '';
    attachments = [];
    showSlashMenu = false;
    requestAnimationFrame(autoResize);
  }

  function collectAttachments() {
    if (attachments.length === 0) return null;
    const images = [];
    const documents = [];
    const pastes = [];
    for (const a of attachments) {
      if (a.type === 'image') {
        images.push({ data: a.data, mediaType: a.mediaType });
      } else if (a.type === 'document') {
        documents.push({ data: a.data, mediaType: a.mediaType, name: a.name });
      } else if (a.type === 'text') {
        pastes.push('--- ' + a.name + ' ---\n' + a.content);
      }
    }
    return { images, documents, pastes };
  }

  function selectSlashCommand(cmd) {
    inputText = '/' + cmd.name + ' ';
    showSlashMenu = false;
    textareaEl?.focus();
  }

  let draftSaveTimer = null;
  function handleInput() {
    autoResize();
    if (sessionId) {
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => saveTabDraft(sessionId, inputText), 300);
    }
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

<!-- Hidden file input -->
<input type="file" multiple bind:this={fileInputEl} onchange={handleFileInput} style="display:none"
  accept="image/*,.pdf,.txt,.md,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.json,.yaml,.yml,.toml,.sh,.sql,.svelte,.vue,.php,.swift,.kt,.csv,.log,.diff" />

<div class="input-area" class:compact class:disconnected={!wsState.connected} class:dragging
  ondrop={handleDrop} ondragover={handleDragOver} ondragleave={handleDragLeave}>

  {#if dragging}
    <div class="drop-overlay">Drop files here</div>
  {/if}

  <!-- Effort picker popup -->
  {#if showEffort && !compact}
    <div class="effort-popup">
      <span class="effort-popup-label">Effort level</span>
      <div class="effort-segments">
        {#each effortLevels as level (level.value)}
          <button
            class="effort-seg"
            class:active={sessionSettings.effort === level.value}
            onclick={() => setEffort(level.value)}
          >{level.label}</button>
        {/each}
      </div>
    </div>
  {/if}

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
        onpaste={handlePaste}
        rows="1"
        placeholder={wsState.connected ? 'Message...' : 'Connecting...'}
        enterkeyhint="send"
        disabled={!wsState.connected}
      ></textarea>
    </div>
    <button class="send-round" class:stop={processing && !inputText.trim() && attachments.length === 0} onclick={handleSend} disabled={!wsState.connected}>
      {#if processing && !inputText.trim() && attachments.length === 0}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      {/if}
    </button>
  {:else}
    <!-- Full: boxed textarea + text button -->
    <div class="input-wrapper">
      <!-- Attachment previews -->
      {#if attachments.length > 0}
        <div class="attachments">
          {#each attachments as att, idx (att.name + idx)}
            <div class="attachment-chip" class:image={att.type === 'image'} class:document={att.type === 'document'} class:text={att.type === 'text'}>
              {#if att.type === 'image'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              {:else if att.type === 'document'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
              {/if}
              <span class="attachment-name">{att.name}</span>
              <span class="attachment-size">{formatSize(att.size)}</span>
              <button class="attachment-remove" onclick={() => removeAttachment(idx)} title="Remove">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        placeholder={wsState.connected ? 'Message Claude... (type / for commands, drop files here)' : 'Connecting...'}
        disabled={!wsState.connected}
        rows="1"
      ></textarea>
      <div class="input-bottom">
        <div class="input-left">
          <button class="effort-toggle" class:has-effort={!!sessionSettings.effort} onclick={() => showEffort = !showEffort} title="Set effort level">
            {#if sessionSettings.effort}
              <span class="effort-badge">{sessionSettings.effort}</span>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            {/if}
          </button>
          <button class="attach-btn" onclick={openFilePicker} title="Attach file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
        </div>
        <button
          class="send-btn"
          class:stop={processing && !inputText.trim() && attachments.length === 0}
          onclick={handleSend}
          disabled={!wsState.connected}
        >
          {processing ? (inputText.trim() || attachments.length > 0 ? 'Send ↵' : 'Stop') : 'Send ↵'}
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

  /* ─── Drop overlay ─── */
  .input-area.dragging {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    border-radius: 12px;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(var(--accent-rgb, 197, 103, 62), 0.08);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    z-index: 20;
    pointer-events: none;
  }

  /* ─── Attachments ─── */
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 14px 0;
  }

  .attachment-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: var(--bg-deeper);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 200px;
  }

  .attachment-chip.image { border-color: rgba(var(--accent-rgb, 197, 103, 62), 0.2); }
  .attachment-chip.document { border-color: rgba(220, 120, 50, 0.2); }

  .attachment-chip svg { flex-shrink: 0; color: var(--text-muted); }

  .attachment-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .attachment-size {
    color: var(--text-dimmer);
    flex-shrink: 0;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 10px;
  }

  .attachment-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: all 0.1s;
  }

  .attachment-remove:hover { color: var(--error); background: rgba(var(--error-rgb, 220, 50, 50), 0.1); }

  /* ─── Attach button ─── */
  .attach-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .attach-btn:hover { color: var(--text-muted); background: rgba(var(--overlay-rgb), 0.04); }

  /* ─── Effort picker ─── */
  .effort-popup {
    position: absolute;
    bottom: 100%;
    left: 20px;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 16px rgba(var(--shadow-rgb), 0.3);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .effort-popup-label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .effort-segments {
    display: flex;
    background: var(--bg-deeper);
    border-radius: 6px;
    padding: 2px;
    gap: 1px;
  }

  .effort-seg {
    padding: 4px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
  }

  .effort-seg:hover { color: var(--text); background: rgba(var(--overlay-rgb), 0.04); }
  .effort-seg.active { color: var(--accent); background: var(--accent-12); font-weight: 600; }

  /* ─── Effort toggle button ─── */
  .effort-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    min-width: 26px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0 4px;
    transition: all 0.15s;
  }

  .effort-toggle:hover { color: var(--text-muted); background: rgba(var(--overlay-rgb), 0.04); }
  .effort-toggle.has-effort { color: var(--accent); }

  .effort-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    padding: 1px 6px;
    background: var(--accent-12);
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* ─── Slash menu ─── */
  .slash-menu {
    position: absolute;
    bottom: 100%;
    left: 20px;
    right: 20px;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 16px rgba(var(--shadow-rgb), 0.3);
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
    background: var(--accent-12);
  }

  .slash-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    font-family: 'SF Mono', Menlo, monospace;
    min-width: 80px;
  }

  .slash-desc {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* ─── Full mode ─── */
  .input-area:not(.compact) {
    padding: 12px 20px 16px;
    border-top: 1px solid var(--bg-alt);
    max-width: min(1100px, 90%);
    margin-left: auto;
    margin-right: auto;
    width: 100%;
    box-sizing: border-box;
  }

  .input-wrapper {
    background: var(--bg-alt);
    border-radius: 12px;
    border: 1px solid var(--border);
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .input-wrapper:focus-within {
    border-color: var(--text-dimmer);
  }

  .input-wrapper textarea {
    width: 100%;
    padding: 12px 14px 4px;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    outline: none;
    min-height: 24px;
    max-height: 120px;
  }

  .input-wrapper textarea::placeholder {
    color: var(--text-dimmer);
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
    background: var(--accent);
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
  .send-btn.stop { background: var(--error); }
  .send-btn.stop:hover { background: #d04440; }

  /* ─── Compact mode ─── */
  .input-area.compact {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.05);
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
    background: var(--input-bg);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 18px;
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .input-wrap-compact textarea:focus {
    border-color: var(--accent-40);
  }

  .input-wrap-compact textarea::placeholder {
    color: var(--border);
  }

  .send-round {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
  }

  .send-round:hover { background: var(--accent-hover); transform: scale(1.05); }
  .send-round:active { transform: scale(0.95); }
  .send-round:disabled { opacity: 0.5; cursor: default; }
  .send-round.stop { background: var(--error); }
  .send-round.stop:hover { background: #f06058; }
</style>
