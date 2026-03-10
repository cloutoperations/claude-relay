<script>
  import { renderMarkdown, highlightCodeBlocks } from '../../utils/markdown.js';

  let { text = '', finalized = false } = $props();

  let contentEl;
  let lastHighlighted = '';

  $effect(() => {
    if (contentEl && text) {
      contentEl.innerHTML = renderMarkdown(text);
      // Only highlight when finalized or periodically
      if (finalized && lastHighlighted !== text) {
        lastHighlighted = text;
        highlightCodeBlocks(contentEl);
      }
    }
  });

  // Debounced highlighting during streaming
  let highlightTimer;
  $effect(() => {
    if (contentEl && text && !finalized) {
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        highlightCodeBlocks(contentEl);
      }, 300);
    }
    return () => clearTimeout(highlightTimer);
  });

  // Copy handler
  let copyState = 'idle'; // idle | primed | done
  let resetTimer;

  function handleClick(e) {
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
<div class="msg-assistant" class:copy-primed={copyState === 'primed'} class:copy-done={copyState === 'done'} onclick={handleClick}>
  <div class="md-content" dir="auto" bind:this={contentEl}></div>
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

<style>
  .msg-assistant {
    margin: 4px 0;
    padding: 4px 0;
    position: relative;
    cursor: default;
  }

  .md-content {
    font-size: 14px;
    line-height: 1.6;
    color: #e8e5de;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* Markdown content styles */
  .md-content :global(p) {
    margin: 0.5em 0;
  }

  .md-content :global(p:first-child) {
    margin-top: 0;
  }

  .md-content :global(pre) {
    background: #1a1918;
    border: 1px solid #3e3c37;
    border-radius: 8px;
    padding: 12px;
    overflow-x: auto;
    margin: 8px 0;
    position: relative;
  }

  .md-content :global(code) {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
  }

  .md-content :global(:not(pre) > code) {
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .md-content :global(a) {
    color: #da7756;
    text-decoration: none;
  }

  .md-content :global(a:hover) {
    text-decoration: underline;
  }

  .md-content :global(ul), .md-content :global(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  .md-content :global(li) {
    margin: 0.25em 0;
  }

  .md-content :global(blockquote) {
    border-left: 3px solid #3e3c37;
    padding-left: 12px;
    margin: 8px 0;
    color: #908b81;
  }

  .md-content :global(h1), .md-content :global(h2), .md-content :global(h3) {
    margin: 1em 0 0.5em;
    font-weight: 600;
    color: #e8e5de;
  }

  .md-content :global(h1) { font-size: 1.3em; }
  .md-content :global(h2) { font-size: 1.15em; }
  .md-content :global(h3) { font-size: 1.05em; }

  .md-content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
  }

  .md-content :global(th), .md-content :global(td) {
    border: 1px solid #3e3c37;
    padding: 6px 10px;
    font-size: 13px;
  }

  .md-content :global(th) {
    background: #2a2924;
  }

  .md-content :global(hr) {
    border: none;
    border-top: 1px solid #3e3c37;
    margin: 16px 0;
  }

  .msg-copy-hint {
    font-size: 11px;
    color: #6d6860;
    padding: 4px 0;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .msg-assistant:hover .msg-copy-hint {
    opacity: 1;
  }

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

  :global(pre:hover .code-copy-btn) {
    opacity: 1;
  }

  :global(.code-copy-btn:hover) {
    color: #e8e5de;
  }
</style>
