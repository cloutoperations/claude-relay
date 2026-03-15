<script>
  import { renderMarkdown, highlightCodeBlocks } from '../../utils/markdown.js';

  let { text = '', finalized = false, compact = false } = $props();

  // Render markdown reactively — no bind:this race condition
  let renderedHtml = $derived(text ? renderMarkdown(text) : '');

  // Highlight code blocks after HTML is in the DOM
  let contentEl = $state(null);
  let lastHighlighted = '';

  $effect(() => {
    if (contentEl && renderedHtml && finalized && lastHighlighted !== text) {
      lastHighlighted = text;
      // Use tick to ensure DOM has updated with {@html}
      queueMicrotask(() => highlightCodeBlocks(contentEl));
    }
  });

  // Debounced highlighting during streaming
  let highlightTimer;
  $effect(() => {
    if (contentEl && renderedHtml && !finalized) {
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        highlightCodeBlocks(contentEl);
      }, 300);
    }
    return () => clearTimeout(highlightTimer);
  });

  // Copy handler (full mode only)
  let copyState = $state('idle');
  let resetTimer;

  function handleClick(e) {
    if (compact) return;
    if (e.target.closest('a, pre, code, button')) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    clearTimeout(resetTimer);
    navigator.clipboard.writeText(text).then(() => {
      copyState = 'done';
      resetTimer = setTimeout(() => { copyState = 'idle'; }, 1500);
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if compact}
  <div class="msg-assistant-compact">
    <div class="md-content compact" dir="auto" bind:this={contentEl}>{@html renderedHtml}</div>
  </div>
{:else}
  <div class="msg-assistant" class:copy-done={copyState === 'done'} onclick={handleClick}>
    <div class="md-content" dir="auto" bind:this={contentEl}>{@html renderedHtml}</div>
    {#if finalized || copyState !== 'idle'}
      <div class="msg-copy-hint">
        {#if copyState === 'idle'}
          Copy
        {:else}
          Copied!
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ─── Full mode ─── */
  .msg-assistant {
    margin: 4px 0;
    padding: 4px 0;
    position: relative;
    cursor: default;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.04);
    padding-top: 12px;
    margin-top: 8px;
    animation: assistMsgIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes assistMsgIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  /* ─── Compact mode ─── */
  .msg-assistant-compact {
    display: flex;
    padding: 2px 0;
  }

  .msg-assistant-compact .md-content {
    max-width: 92%;
    padding: 8px 12px;
    background: var(--sidebar-bg);
    border-radius: 14px 14px 14px 4px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    word-wrap: break-word;
  }

  /* ─── Shared md-content ─── */
  .md-content {
    font-size: 14px;
    line-height: 1.65;
    color: var(--text);
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .md-content :global(p) { margin: 0.6em 0; }
  .md-content :global(p:first-child) { margin-top: 0; }
  .md-content :global(p:last-child) { margin-bottom: 0; }

  .md-content :global(pre) {
    background: var(--bg-deeper);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    margin: 10px 0;
    position: relative;
    line-height: 1.5;
  }

  .md-content :global(code) {
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
    font-size: 12.5px;
  }

  .md-content :global(:not(pre) > code) {
    background: var(--accent-12);
    color: var(--hl-constant);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.88em;
  }

  .md-content :global(a) { color: var(--accent); text-decoration: none; }
  .md-content :global(a:hover) { text-decoration: underline; }

  .md-content :global(ul), .md-content :global(ol) { padding-left: 1.6em; margin: 0.6em 0; }
  .md-content :global(li) { margin: 0.3em 0; }
  .md-content :global(li::marker) { color: var(--text-dimmer); }

  .md-content :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding: 4px 14px;
    margin: 10px 0;
    color: var(--text-secondary);
    background: rgba(var(--accent-rgb), 0.04);
    border-radius: 0 6px 6px 0;
  }

  .md-content :global(h1), .md-content :global(h2), .md-content :global(h3),
  .md-content :global(h4) {
    margin: 1.1em 0 0.5em;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .md-content :global(h1) { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .md-content :global(h2) { font-size: 1.2em; }
  .md-content :global(h3) { font-size: 1.05em; color: var(--accent); }
  .md-content :global(h4) { font-size: 0.95em; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }

  .md-content :global(.table-wrap) { overflow-x: auto; margin: 10px 0; border-radius: 8px; border: 1px solid var(--border); }
  .md-content :global(table) { border-collapse: collapse; width: 100%; }
  .md-content :global(th), .md-content :global(td) { border: 1px solid var(--border); padding: 8px 12px; font-size: 13px; }
  .md-content :global(th) { background: var(--bg-alt); font-weight: 600; color: var(--text-secondary); white-space: nowrap; text-align: left; }
  .md-content :global(tr:nth-child(even) td) { background: rgba(var(--overlay-rgb), 0.015); }

  .md-content :global(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

  .md-content :global(strong) { color: var(--text); font-weight: 600; }
  .md-content :global(em) { color: var(--text-secondary); }

  /* ─── Compact overrides ─── */
  .md-content.compact { font-size: 13px; }
  .md-content.compact :global(p) { margin: 0 0 8px; }
  .md-content.compact :global(ul),
  .md-content.compact :global(ol) { margin: 4px 0; padding-left: 18px; }
  .md-content.compact :global(li) { margin: 2px 0; }
  .md-content.compact :global(pre) {
    font-size: 11px;
    padding: 8px 10px;
    border-radius: 8px;
    margin: 6px 0;
    background: var(--bg-deeper);
    border: 1px solid rgba(var(--overlay-rgb), 0.04);
  }
  .md-content.compact :global(code) { font-size: 11.5px; }
  .md-content.compact :global(:not(pre) > code) { font-size: 12px; background: rgba(var(--overlay-rgb), 0.06); padding: 1px 5px; }

  /* ─── Copy hint (full mode only) ─── */
  .msg-copy-hint {
    font-size: 11px;
    color: var(--text-dimmer);
    padding: 4px 0;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .msg-assistant:hover .msg-copy-hint { opacity: 1; }

  .msg-assistant.copy-done .msg-copy-hint {
    opacity: 1;
    color: var(--success);
  }

  :global(.code-copy-btn) {
    position: absolute;
    top: 8px;
    right: 8px;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s;
  }

  :global(pre:hover .code-copy-btn) { opacity: 0.7; }
  :global(.code-copy-btn:hover) { opacity: 1; color: var(--text); }
</style>
