<script>
  import hljs, { getLang } from './hljs-setup.js';

  let { content = '', filePath = '' } = $props();

  // Parse line-numbered content (e.g. "   1→code here")
  const LINE_PATTERN = /^\s*(\d+)[→\t](.*)$/;

  let parsed = $derived.by(() => {
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0) return null;

    // Check if this is line-numbered content
    let matchCount = 0;
    const checkCount = Math.min(lines.length, 5);
    for (let i = 0; i < checkCount; i++) {
      if (LINE_PATTERN.test(lines[i])) matchCount++;
    }
    if (matchCount < Math.ceil(checkCount * 0.6)) return null;

    const numbers = [];
    const code = [];
    for (const line of lines) {
      const m = line.match(LINE_PATTERN);
      if (m) {
        numbers.push(m[1]);
        code.push(m[2]);
      } else {
        numbers.push('');
        code.push(line);
      }
    }
    return { numbers, code };
  });

  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
  }

  let highlighted = $derived.by(() => {
    if (!parsed) return null;
    const lang = getLang(filePath);
    const src = parsed.code.join('\n');
    if (!lang) return null;
    try {
      return hljs.highlight(src, { language: lang }).value;
    } catch { return null; }
  });
</script>

{#if parsed}
  <div class="code-view">
    <div class="code-header">
      <span class="code-path">{shortPath(filePath)}</span>
      <span class="code-lines">{parsed.numbers.length} lines</span>
    </div>
    <div class="code-body">
      <pre class="code-gutter">{parsed.numbers.join('\n')}</pre>
      {#if highlighted}
        <pre class="code-content"><code>{@html highlighted}</code></pre>
      {:else}
        <pre class="code-content">{parsed.code.join('\n')}</pre>
      {/if}
    </div>
  </div>
{:else}
  <pre class="code-plain">{content}</pre>
{/if}

<style>
  .code-view {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-alt);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }

  .code-path { color: var(--text-muted); }
  .code-lines { color: var(--border); font-size: 10px; }

  .code-body {
    display: flex;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-deeper);
  }

  .code-gutter {
    padding: 4px 8px 4px 6px;
    text-align: right;
    color: var(--border);
    user-select: none;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    margin: 0;
    line-height: 1.45;
    min-width: 32px;
  }

  .code-content {
    padding: 4px 8px;
    margin: 0;
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.45;
    color: var(--text);
  }

  .code-plain {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-deeper);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }

  /* hljs token colors */
  .code-content :global(.hljs-keyword),
  .code-content :global(.hljs-selector-tag) { color: var(--hl-keyword); }
  .code-content :global(.hljs-string),
  .code-content :global(.hljs-template-variable) { color: var(--hl-string); }
  .code-content :global(.hljs-number),
  .code-content :global(.hljs-literal) { color: var(--hl-number); }
  .code-content :global(.hljs-comment) { color: var(--hl-comment); font-style: italic; }
  .code-content :global(.hljs-function),
  .code-content :global(.hljs-title) { color: var(--hl-function); }
  .code-content :global(.hljs-built_in) { color: var(--hl-regexp); }
  .code-content :global(.hljs-type),
  .code-content :global(.hljs-class) { color: var(--hl-regexp); }
  .code-content :global(.hljs-attr),
  .code-content :global(.hljs-attribute) { color: var(--hl-attr); }
  .code-content :global(.hljs-variable) { color: var(--hl-attr); }
  .code-content :global(.hljs-params) { color: var(--hl-attr); }
  .code-content :global(.hljs-meta) { color: var(--hl-function); }
  .code-content :global(.hljs-property) { color: var(--hl-attr); }
  .code-content :global(.hljs-punctuation) { color: var(--text-muted); }
</style>
