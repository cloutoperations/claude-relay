<script>
  import { activeFile, fileLoading, closeFile } from '../../stores/files.js';
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

  function handleClose() {
    closeFile();
  }
</script>

{#if $activeFile || $fileLoading}
  <div class="file-viewer">
    <div class="fv-header">
      <div class="fv-path" title={$activeFile?.path || ''}>
        <span class="fv-name">{fileName($activeFile?.path || '')}</span>
        <span class="fv-full-path">{$activeFile?.path || ''}</span>
      </div>
      <div class="fv-actions">
        {#if $activeFile?.content}
          <button class="fv-btn" onclick={handleCopy} title="Copy content">
            {#if copyState === 'copied'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        {/if}
        <button class="fv-btn" onclick={handleClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <div class="fv-content">
      {#if $fileLoading}
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

  .fv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    min-width: 0;
  }

  .fv-path {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .fv-name {
    font-size: 13px;
    font-weight: 600;
    color: #d4d0c8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fv-full-path {
    font-size: 11px;
    color: #6b6760;
    font-family: 'SF Mono', Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fv-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

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
    padding: 16px 20px;
    font-size: 14px;
    line-height: 1.6;
    color: #d4d0c8;
  }

  .fv-markdown :global(h1),
  .fv-markdown :global(h2),
  .fv-markdown :global(h3) {
    margin-top: 1.2em;
    margin-bottom: 0.4em;
    color: #e8e5de;
  }

  .fv-markdown :global(code) {
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .fv-markdown :global(pre) {
    background: #262523;
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
  }

  .fv-markdown :global(pre code) {
    background: none;
    padding: 0;
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
