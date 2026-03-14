<script>
  import { activeDiff, stageFile, unstageFile, discardFile, refreshStatus } from '../../stores/git.svelte.js';
  import { openFile } from '../../stores/files.svelte.js';

  let lines = $derived.by(() => {
    if (!activeDiff.diff) return [];
    return activeDiff.diff.split('\n').map((text, i) => {
      let type = 'context';
      if (text.startsWith('+++') || text.startsWith('---')) type = 'meta';
      else if (text.startsWith('@@')) type = 'hunk';
      else if (text.startsWith('+')) type = 'add';
      else if (text.startsWith('-')) type = 'del';
      else if (text.startsWith('diff ') || text.startsWith('index ')) type = 'meta';
      return { text, type, num: i };
    });
  });

  let fileName = $derived(activeDiff.path ? activeDiff.path.split('/').pop() : '');
  let filePath = $derived(activeDiff.path || '');

  function handleStage() {
    if (filePath) { stageFile(filePath); refreshStatus(); }
  }

  function handleUnstage() {
    if (filePath) { unstageFile(filePath); refreshStatus(); }
  }

  function handleDiscard() {
    if (filePath && confirm('Discard all changes to ' + fileName + '?')) {
      discardFile(filePath);
      refreshStatus();
    }
  }

  function handleOpenFile() {
    if (filePath) openFile(filePath);
  }
</script>

<div class="diff-viewer">
  {#if !activeDiff.path}
    <div class="diff-empty">Select a file from the git section to view its diff</div>
  {:else}
    <div class="diff-header">
      <div class="diff-file-info">
        <span class="diff-file-name">{fileName}</span>
        <span class="diff-file-path">{filePath}</span>
        {#if activeDiff.staged}
          <span class="diff-staged-badge">staged</span>
        {/if}
      </div>
      <div class="diff-actions">
        {#if activeDiff.staged}
          <button class="diff-action" onclick={handleUnstage}>Unstage</button>
        {:else}
          <button class="diff-action" onclick={handleStage}>Stage</button>
          <button class="diff-action danger" onclick={handleDiscard}>Discard</button>
        {/if}
        <button class="diff-action" onclick={handleOpenFile}>Open File</button>
      </div>
    </div>

    {#if activeDiff.loading}
      <div class="diff-loading">Loading diff...</div>
    {:else if activeDiff.error}
      <div class="diff-error">{activeDiff.error}</div>
    {:else if activeDiff.diff === ''}
      <div class="diff-empty">No changes (file may be staged or binary)</div>
    {:else}
      <div class="diff-content">
        {#each lines as line (line.num)}
          <div class="diff-line {line.type}">
            <span class="diff-line-text">{line.text}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .diff-viewer {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .diff-empty, .diff-loading, .diff-error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dimmer);
    font-size: 14px;
  }

  .diff-error {
    color: #e5534b;
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.08);
    flex-shrink: 0;
  }

  .diff-file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .diff-file-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .diff-file-path {
    font-size: 12px;
    color: var(--text-dimmer);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-staged-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(87, 171, 90, 0.15);
    color: #57ab5a;
  }

  .diff-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .diff-action {
    padding: 4px 10px;
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .diff-action:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .diff-action.danger {
    color: #e5534b;
    border-color: rgba(229, 83, 75, 0.2);
  }

  .diff-action.danger:hover {
    background: rgba(229, 83, 75, 0.08);
  }

  .diff-content {
    flex: 1;
    overflow: auto;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.5;
    padding: 8px 0;
  }

  .diff-line {
    padding: 0 16px;
    white-space: pre;
  }

  .diff-line.add {
    background: rgba(87, 171, 90, 0.12);
    color: #57ab5a;
  }

  .diff-line.del {
    background: rgba(229, 83, 75, 0.12);
    color: #e5534b;
  }

  .diff-line.hunk {
    color: #5b9fd6;
    padding-top: 8px;
    padding-bottom: 4px;
    font-weight: 600;
  }

  .diff-line.meta {
    color: var(--text-dimmer);
    font-style: italic;
  }

  .diff-line.context {
    color: var(--text-muted);
  }

  .diff-line-text {
    white-space: pre;
  }
</style>
