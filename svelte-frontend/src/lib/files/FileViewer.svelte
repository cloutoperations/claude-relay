<script>
  import { openFiles, getActiveFile, activeFilePath, fileLoading } from '../../stores/files.svelte.js';
  import { getBasePath } from '../../stores/ws.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';
  import NotionEditor from './NotionEditor.svelte';

  let { filePath = null } = $props();

  let copyState = $state('idle');
  let editorDirty = $state(false);
  let pdfState = $state('idle');

  function handlePdf() {
    if (!activeFile?.path || pdfState === 'loading') return;
    pdfState = 'loading';
    const pdfUrl = getBasePath() + 'api/pdf?path=' + encodeURIComponent(activeFile.resolvedPath || activeFile.path);
    window.open(pdfUrl, '_blank');
    pdfState = 'done';
    setTimeout(() => pdfState = 'idle', 3000);
  }

  // Use the filePath prop (per-pane) if provided, otherwise fall back to global
  let activeFile = $derived(
    filePath
      ? openFiles.find(f => f.path === filePath) || null
      : getActiveFile()
  );

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
      <span class="fv-full-path">{activeFile.resolvedPath || activeFile.path}</span>
      <div class="fv-actions">
        {#if activeFile?.content && isMarkdown(activeFile.path)}
          <button class="fv-btn" class:fv-btn-loading={pdfState === 'loading'} onclick={handlePdf} title="Download PDF" disabled={pdfState === 'loading'}>
            {#if pdfState === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {:else if pdfState === 'loading'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="fv-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {/if}
          </button>
        {/if}
        {#if activeFile?.content}
          <button class="fv-btn" onclick={handleCopy} title="Copy content">
            {#if copyState === 'copied'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        {/if}
        {#if editorDirty}
          <span class="fv-dirty-dot" title="Unsaved changes"></span>
        {/if}
      </div>
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
          {#key activeFile.path}
            <NotionEditor content={activeFile.content} path={activeFile.path} onDirty={(d) => editorDirty = d} />
          {/key}
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
  .fv-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

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

  .fv-btn-loading {
    opacity: 0.5;
    pointer-events: none;
  }

  .fv-spin {
    animation: fv-spin 1s linear infinite;
  }

  @keyframes fv-spin {
    to { transform: rotate(360deg); }
  }

  .fv-dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 4px;
    flex-shrink: 0;
  }

  /* ─── Content ─── */
  .fv-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
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
