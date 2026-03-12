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
    if (!finalized) return;

    if (copyState === 'idle') {
      copyState = 'primed';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { copyState = 'idle'; }, 3000);
    } else if (copyState === 'primed') {
      clearTimeout(resetTimer);
      navigator.clipboard.writeText(text).then(() => {
        copyState = 'done';
        resetTimer = setTimeout(() => { copyState = 'idle'; }, 1500);
      });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if compact}
  <div class="msg-assistant-compact">
    <div class="md-content compact" dir="auto" bind:this={contentEl}>{@html renderedHtml}</div>
  </div>
{:else}
  <div class="msg-assistant" class:copy-primed={copyState === 'primed'} class:copy-done={copyState === 'done'} onclick={handleClick}>
    <div class="md-content" dir="auto" bind:this={contentEl}>{@html renderedHtml}</div>
    {#if finalized}
      <div class="msg-copy-hint">
        {#if copyState === 'idle'}
          Click to grab this
        {:else if copyState === 'primed'}
          Click again to grab
        {:else}
          Grabbed!
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
  }

  /* ─── Compact mode ─── */
  .msg-assistant-compact {
    display: flex;
    padding: 2px 0;
  }

  .msg-assistant-compact .md-content {
    max-width: 92%;
    padding: 8px 12px;
    background: #262523;
    border-radius: 14px 14px 14px 4px;
    font-size: 13px;
    color: #c8c3b8;
    line-height: 1.5;
    word-wrap: break-word;
  }

  /* ─── Shared md-content ─── */
  .md-content {
    font-size: 14px;
    line-height: 1.65;
    color: #e8e5de;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .md-content :global(p) { margin: 0.6em 0; }
  .md-content :global(p:first-child) { margin-top: 0; }
  .md-content :global(p:last-child) { margin-bottom: 0; }

  .md-content :global(pre) {
    background: #1a1918;
    border: 1px solid #3e3c37;
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    margin: 10px 0;
    position: relative;
    line-height: 1.5;
  }

  .md-content :global(code) {
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
    font-size: 13px;
  }

  .md-content :global(:not(pre) > code) {
    background: rgba(218, 119, 86, 0.1);
    color: #e0a889;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.88em;
  }

  .md-content :global(a) { color: #da7756; text-decoration: none; }
  .md-content :global(a:hover) { text-decoration: underline; }

  .md-content :global(ul), .md-content :global(ol) { padding-left: 1.6em; margin: 0.6em 0; }
  .md-content :global(li) { margin: 0.3em 0; }
  .md-content :global(li::marker) { color: #6d6860; }

  .md-content :global(blockquote) {
    border-left: 3px solid #da7756;
    padding: 4px 14px;
    margin: 10px 0;
    color: #b0aa9e;
    background: rgba(218, 119, 86, 0.04);
    border-radius: 0 6px 6px 0;
  }

  .md-content :global(h1), .md-content :global(h2), .md-content :global(h3),
  .md-content :global(h4) {
    margin: 1.1em 0 0.5em;
    font-weight: 600;
    color: #f0ede6;
    letter-spacing: -0.01em;
  }

  .md-content :global(h1) { font-size: 1.4em; border-bottom: 1px solid #3e3c37; padding-bottom: 6px; }
  .md-content :global(h2) { font-size: 1.2em; }
  .md-content :global(h3) { font-size: 1.05em; color: #da7756; }
  .md-content :global(h4) { font-size: 0.95em; color: #b0aa9e; text-transform: uppercase; letter-spacing: 0.03em; }

  .md-content :global(.table-wrap) { overflow-x: auto; margin: 10px 0; border-radius: 8px; border: 1px solid #3e3c37; }
  .md-content :global(table) { border-collapse: collapse; width: 100%; }
  .md-content :global(th), .md-content :global(td) { border: 1px solid #3e3c37; padding: 8px 12px; font-size: 13px; }
  .md-content :global(th) { background: #2a2924; font-weight: 600; color: #c8c3b8; white-space: nowrap; text-align: left; }
  .md-content :global(tr:nth-child(even) td) { background: rgba(255, 255, 255, 0.015); }

  .md-content :global(hr) { border: none; border-top: 1px solid #3e3c37; margin: 20px 0; }

  .md-content :global(strong) { color: #f0ede6; font-weight: 600; }
  .md-content :global(em) { color: #c8c3b8; }

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
    background: #141312;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }
  .md-content.compact :global(code) { font-size: 11.5px; }
  .md-content.compact :global(:not(pre) > code) { font-size: 12px; background: rgba(255, 255, 255, 0.06); padding: 1px 5px; }

  /* ─── Copy hint (full mode only) ─── */
  .msg-copy-hint {
    font-size: 11px;
    color: #6d6860;
    padding: 4px 0;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .msg-assistant:hover .msg-copy-hint { opacity: 1; }

  .msg-assistant.copy-primed {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
  }

  .msg-assistant.copy-done .msg-copy-hint {
    opacity: 1;
    color: #5cb85c;
  }

  :global(.code-copy-btn) {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #2a2924;
    border: 1px solid #3e3c37;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    color: #908b81;
    opacity: 0;
    transition: opacity 0.2s;
  }

  :global(pre:hover .code-copy-btn) { opacity: 1; }
  :global(.code-copy-btn:hover) { color: #e8e5de; }
</style>
