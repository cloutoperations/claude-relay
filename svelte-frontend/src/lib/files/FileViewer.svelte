<script>
  import { openFiles, activeFile, activeFilePath, fileLoading, closeFileTab, switchTab } from '../../stores/files.js';
  import { renderMarkdown } from '../../utils/markdown.js';

  let copyState = $state('idle');

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
    if (!$activeFile?.content) return;
    navigator.clipboard.writeText($activeFile.content).then(() => {
      copyState = 'copied';
      setTimeout(() => copyState = 'idle', 1500);
    });
  }

  function handleCloseTab(e, path) {
    e.stopPropagation();
    closeFileTab(path);
  }

  function handleTabMiddleClick(e, path) {
    if (e.button === 1) {
      e.preventDefault();
      closeFileTab(path);
    }
  }
</script>

{#if $openFiles.length > 0}
  <div class="file-viewer">
    <!-- Tab bar -->
    <div class="fv-tabs">
      <div class="fv-tab-list">
        {#each $openFiles as file (file.path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fv-tab"
            class:active={$activeFilePath === file.path}
            onclick={() => switchTab(file.path)}
            onauxclick={(e) => handleTabMiddleClick(e, file.path)}
            title={file.path}
          >
            <span class="fv-tab-name">{fileName(file.path)}</span>
            <button class="fv-tab-close" onclick={(e) => handleCloseTab(e, file.path)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        {/each}
      </div>
      <div class="fv-tab-actions">
        {#if $activeFile?.content}
          <button class="fv-btn" onclick={handleCopy} title="Copy content">
            {#if copyState === 'copied'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <!-- File path subtitle -->
    {#if $activeFile}
      <div class="fv-path-bar">
        <span class="fv-full-path">{$activeFile.path}</span>
      </div>
    {/if}

    <!-- Content -->
    <div class="fv-content">
      {#if $fileLoading && $activeFile?.loading}
        <div class="fv-loading">Loading file...</div>
      {:else if $activeFile?.error}
        <div class="fv-error">{$activeFile.error}</div>
      {:else if $activeFile?.binary && $activeFile?.imageUrl}
        <div class="fv-image">
          <img src={$activeFile.imageUrl} alt={fileName($activeFile.path)} />
        </div>
      {:else if $activeFile?.binary}
        <div class="fv-binary">Binary file ({Math.round(($activeFile.size || 0) / 1024)} KB)</div>
      {:else if $activeFile?.content != null}
        {#if isMarkdown($activeFile.path)}
          <div class="fv-markdown">{@html renderMarkdown($activeFile.content)}</div>
        {:else}
          <pre class="fv-code"><code>{$activeFile.content}</code></pre>
        {/if}
      {:else if $activeFile}
        <div class="fv-loading">Loading file...</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1a1918;
  }

  /* ─── Tab bar ─── */
  .fv-tabs {
    display: flex;
    align-items: center;
    background: #1e1d1a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    min-width: 0;
  }

  .fv-tab-list {
    flex: 1;
    display: flex;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: none;
  }

  .fv-tab-list::-webkit-scrollbar { display: none; }

  .fv-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
    font-size: 12px;
    color: #908b81;
    cursor: pointer;
    white-space: nowrap;
    border-right: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
    user-select: none;
  }

  .fv-tab:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #b0ab9f;
  }

  .fv-tab.active {
    background: #1a1918;
    color: #d4d0c8;
    border-bottom: 2px solid #da7756;
    margin-bottom: -1px;
  }

  .fv-tab-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fv-tab-close {
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
  }

  .fv-tab:hover .fv-tab-close,
  .fv-tab.active .fv-tab-close {
    opacity: 1;
  }

  .fv-tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #d4d0c8;
  }

  .fv-tab-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    padding: 0 8px;
  }

  /* ─── Path bar ─── */
  .fv-path-bar {
    padding: 4px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }

  .fv-full-path {
    font-size: 11px;
    color: #6b6760;
    font-family: 'SF Mono', Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
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
    color: #6b6760;
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
    transition: all 0.15s;
  }

  .fv-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #b0ab9f;
  }

  /* ─── Content ─── */
  .fv-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .fv-content::-webkit-scrollbar { width: 6px; }
  .fv-content::-webkit-scrollbar-track { background: transparent; }
  .fv-content::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

  .fv-loading, .fv-error, .fv-binary {
    padding: 24px;
    text-align: center;
    font-size: 13px;
    color: #6b6760;
  }

  .fv-error {
    color: #e5534b;
  }

  .fv-code {
    margin: 0;
    padding: 12px 16px;
    font-size: 12px;
    line-height: 1.6;
    color: #d4d0c8;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
  }

  .fv-markdown {
    padding: 20px 24px;
    font-size: 14px;
    line-height: 1.7;
    color: #d4d0c8;
    font-family: 'Inter', -apple-system, sans-serif;
  }

  /* Headings */
  .fv-markdown :global(h1) {
    font-size: 1.6em;
    font-weight: 700;
    color: #e8e5de;
    margin: 1.6em 0 0.6em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    line-height: 1.3;
  }

  .fv-markdown :global(h1:first-child) { margin-top: 0; }

  .fv-markdown :global(h2) {
    font-size: 1.3em;
    font-weight: 650;
    color: #e8e5de;
    margin: 1.4em 0 0.5em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    line-height: 1.3;
  }

  .fv-markdown :global(h3) {
    font-size: 1.1em;
    font-weight: 600;
    color: #da7756;
    margin: 1.2em 0 0.4em;
  }

  .fv-markdown :global(h4) {
    font-size: 0.85em;
    font-weight: 600;
    color: #908b81;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 1.2em 0 0.4em;
  }

  .fv-markdown :global(h5),
  .fv-markdown :global(h6) {
    font-size: 0.85em;
    font-weight: 600;
    color: #908b81;
    margin: 1em 0 0.3em;
  }

  /* Paragraphs */
  .fv-markdown :global(p) {
    margin: 0.6em 0;
  }

  /* Links */
  .fv-markdown :global(a) {
    color: #da7756;
    text-decoration: none;
  }
  .fv-markdown :global(a:hover) {
    text-decoration: underline;
  }

  /* Bold and emphasis */
  .fv-markdown :global(strong) { color: #e8e5de; }

  /* Inline code */
  .fv-markdown :global(code) {
    background: rgba(218, 119, 86, 0.1);
    color: #da7756;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.85em;
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  }

  /* Code blocks */
  .fv-markdown :global(pre) {
    background: #1e1d1a;
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 14px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 0.8em 0;
  }

  .fv-markdown :global(pre code) {
    background: none;
    color: #d4d0c8;
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
    accent-color: #da7756;
  }

  /* Blockquotes */
  .fv-markdown :global(blockquote) {
    border-left: 3px solid #da7756;
    margin: 0.8em 0;
    padding: 0.4em 0 0.4em 16px;
    color: #908b81;
    background: rgba(218, 119, 86, 0.04);
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
    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
    color: #e8e5de;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .fv-markdown :global(td) {
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: #b0ab9f;
  }

  .fv-markdown :global(tr:nth-child(even)) {
    background: rgba(255, 255, 255, 0.02);
  }

  /* Horizontal rules */
  .fv-markdown :global(hr) {
    border: none;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
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
