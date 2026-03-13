<script>
  import { openFiles, getActiveFile, activeFilePath, fileLoading } from '../../stores/files.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';

  let copyState = $state('idle');

  let activeFile = $derived(getActiveFile());

  function fileName(path) {
    if (!path) return '';
    return path.split('/').pop();
  }

  function fileExt(path) {
    if (!path) return '';
    return path.split('.').pop().toLowerCase();
  }

  function isMarkdown(path) {
    const ext = fileExt(path);
    return ext === 'md' || ext === 'mdx';
  }

  function handleCopy() {
    if (!activeFile?.content) return;
    navigator.clipboard.writeText(activeFile.content).then(() => {
      copyState = 'copied';
      setTimeout(() => copyState = 'idle', 1500);
    });
  }
</script>

{#if activeFile}
  <div class="file-viewer">
    <!-- Path bar + actions -->
    <div class="fv-toolbar">
      <span class="fv-full-path">{activeFile.path}</span>
      {#if activeFile?.content}
        <button class="fv-btn" onclick={handleCopy} title="Copy content">
          {#if copyState === 'copied'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {/if}
        </button>
      {/if}
    </div>

    <!-- Content -->
    <div class="fv-content">
      {#if fileLoading.value && activeFile?.loading}
        <div class="fv-loading">Loading file...</div>
      {:else if activeFile?.error}
        <div class="fv-error">{activeFile.error}</div>
      {:else if activeFile?.binary && activeFile?.imageUrl}
        <div class="fv-image">
          <img src={activeFile.imageUrl} alt={fileName(activeFile.path)} />
        </div>
      {:else if activeFile?.binary}
        <div class="fv-binary">Binary file ({Math.round((activeFile.size || 0) / 1024)} KB)</div>
      {:else if activeFile?.content != null}
        {#if isMarkdown(activeFile.path)}
          <div class="fv-markdown">{@html renderMarkdown(activeFile.content)}</div>
        {:else}
          <pre class="fv-code"><code>{activeFile.content}</code></pre>
        {/if}
      {:else if activeFile}
        <div class="fv-loading">Loading file...</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-deeper);
  }

  /* ─── Toolbar (path + copy) ─── */
  .fv-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.04);
    flex-shrink: 0;
    gap: 8px;
  }

  .fv-full-path {
    font-size: 11px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  /* ─── Actions ─── */
  .fv-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
    transition: all 0.15s;
  }

  .fv-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text-secondary);
  }

  /* ─── Content ─── */
  .fv-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .fv-content::-webkit-scrollbar { width: 6px; }
  .fv-content::-webkit-scrollbar-track { background: transparent; }
  .fv-content::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb), 0.1); border-radius: 3px; }

  .fv-loading, .fv-error, .fv-binary {
    padding: 24px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .fv-error {
    color: var(--error);
  }

  .fv-code {
    margin: 0;
    padding: 12px 16px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
  }

  .fv-markdown {
    padding: 20px 24px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
    font-family: 'Inter', -apple-system, sans-serif;
  }

  /* Headings */
  .fv-markdown :global(h1) {
    font-size: 1.6em;
    font-weight: 700;
    color: var(--text);
    margin: 1.6em 0 0.6em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.08);
    line-height: 1.3;
  }

  .fv-markdown :global(h1:first-child) { margin-top: 0; }

  .fv-markdown :global(h2) {
    font-size: 1.3em;
    font-weight: 650;
    color: var(--text);
    margin: 1.4em 0 0.5em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.05);
    line-height: 1.3;
  }

  .fv-markdown :global(h3) {
    font-size: 1.1em;
    font-weight: 600;
    color: var(--accent);
    margin: 1.2em 0 0.4em;
  }

  .fv-markdown :global(h4) {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 1.2em 0 0.4em;
  }

  .fv-markdown :global(h5),
  .fv-markdown :global(h6) {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-muted);
    margin: 1em 0 0.3em;
  }

  /* Paragraphs */
  .fv-markdown :global(p) {
    margin: 0.6em 0;
  }

  /* Links */
  .fv-markdown :global(a) {
    color: var(--accent);
    text-decoration: none;
  }
  .fv-markdown :global(a:hover) {
    text-decoration: underline;
  }

  /* Bold and emphasis */
  .fv-markdown :global(strong) { color: var(--text); }

  /* Inline code */
  .fv-markdown :global(code) {
    background: var(--accent-12);
    color: var(--accent);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.85em;
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  }

  /* Code blocks */
  .fv-markdown :global(pre) {
    background: var(--code-bg);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    padding: 14px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 0.8em 0;
  }

  .fv-markdown :global(pre code) {
    background: none;
    color: var(--text);
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  /* Lists */
  .fv-markdown :global(ul),
  .fv-markdown :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.6em;
  }

  .fv-markdown :global(li) {
    margin: 0.25em 0;
  }

  .fv-markdown :global(li > ul),
  .fv-markdown :global(li > ol) {
    margin: 0.15em 0;
  }

  /* Task lists */
  .fv-markdown :global(li input[type="checkbox"]) {
    margin-right: 6px;
    accent-color: var(--accent);
  }

  /* Blockquotes */
  .fv-markdown :global(blockquote) {
    border-left: 3px solid var(--accent);
    margin: 0.8em 0;
    padding: 0.4em 0 0.4em 16px;
    color: var(--text-muted);
    background: rgba(var(--accent-rgb), 0.04);
    border-radius: 0 6px 6px 0;
  }

  .fv-markdown :global(blockquote p) {
    margin: 0.3em 0;
  }

  /* Tables */
  .fv-markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    font-size: 13px;
  }

  .fv-markdown :global(th) {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 2px solid rgba(var(--overlay-rgb), 0.1);
    color: var(--text);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .fv-markdown :global(td) {
    padding: 6px 12px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.04);
    color: var(--text-secondary);
  }

  .fv-markdown :global(tr:nth-child(even)) {
    background: rgba(var(--overlay-rgb), 0.02);
  }

  /* Horizontal rules */
  .fv-markdown :global(hr) {
    border: none;
    height: 1px;
    background: rgba(var(--overlay-rgb), 0.08);
    margin: 1.5em 0;
  }

  /* Images */
  .fv-markdown :global(img) {
    max-width: 100%;
    border-radius: 6px;
    margin: 0.5em 0;
  }

  .fv-image {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .fv-image img {
    max-width: 100%;
    max-height: 400px;
    border-radius: 8px;
  }
</style>
