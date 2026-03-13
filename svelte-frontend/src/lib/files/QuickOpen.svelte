<script>
  import { searchFiles, fileSearchResults, openFile, fileSearchQuery } from '../../stores/files.svelte.js';

  let { visible = false, onClose = null } = $props();

  let query = $state('');
  let activeIndex = $state(-1);
  let inputEl = $state(null);

  $effect(() => {
    if (visible && inputEl) {
      query = '';
      activeIndex = -1;
      fileSearchQuery.value = '';
      setTimeout(() => inputEl?.focus(), 50);
    }
  });

  function handleInput() {
    activeIndex = -1;
    searchFiles(query);
  }

  function handleKeydown(e) {
    const results = fileSearchResults.value;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        activeIndex = (activeIndex + 1) % results.length;
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        activeIndex = (activeIndex - 1 + results.length) % results.length;
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        selectResult(results[activeIndex]);
      }
      return;
    }
  }

  function selectResult(result) {
    openFile(result.path || result);
    onClose?.();
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 4 ? '.../' + parts.slice(-4).join('/') : p;
  }

  function fileName(p) {
    if (!p) return '';
    return p.split('/').pop();
  }

  function dirPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="qo-overlay" onclick={handleOverlayClick}>
    <div class="qo-dialog">
      <div class="qo-input-wrap">
        <svg class="qo-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          class="qo-input"
          type="text"
          placeholder="Search files..."
          bind:value={query}
          bind:this={inputEl}
          oninput={handleInput}
          onkeydown={handleKeydown}
        />
      </div>
      {#if fileSearchResults.value.length > 0}
        <div class="qo-results">
          {#each fileSearchResults.value as result, i}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="qo-result"
              class:active={i === activeIndex}
              onclick={() => selectResult(result)}
              onmouseenter={() => activeIndex = i}
            >
              <span class="qo-result-name">{fileName(result.path || result)}</span>
              <span class="qo-result-path">{shortPath(dirPath(result.path || result))}</span>
            </div>
          {/each}
        </div>
      {:else if query.trim()}
        <div class="qo-empty">No files found</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .qo-overlay {
    position: fixed;
    inset: 0;
    background: rgba(var(--shadow-rgb), 0.5);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
  }

  .qo-dialog {
    width: 480px;
    max-width: 90vw;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(var(--shadow-rgb), 0.5);
    overflow: hidden;
  }

  .qo-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.06);
  }

  .qo-icon {
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .qo-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: 15px;
    min-width: 0;
  }

  .qo-input::placeholder {
    color: var(--text-dimmer);
  }

  .qo-results {
    max-height: 320px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .qo-results::-webkit-scrollbar { width: 5px; }
  .qo-results::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb), 0.1); border-radius: 3px; }

  .qo-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .qo-result:hover,
  .qo-result.active {
    background: var(--accent-12);
  }

  .qo-result-name {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    flex-shrink: 0;
  }

  .qo-result.active .qo-result-name {
    color: var(--accent);
  }

  .qo-result-path {
    font-size: 11px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .qo-empty {
    padding: 20px 16px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dimmer);
  }
</style>
