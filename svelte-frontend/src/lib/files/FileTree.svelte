<script>
  import { treeData, expandedDirs, toggleDir, openFile, loadRootDir, activeFilePath } from '../../stores/files.svelte.js';
  import { onMount } from 'svelte';

  onMount(() => {
    // Load root directory on mount
    if (!treeData['.']?.loaded) loadRootDir();
  });

  function getIcon(entry) {
    if (entry.type === 'dir') return 'dir';
    const ext = entry.name.split('.').pop().toLowerCase();
    const map = {
      js: 'js', mjs: 'js', ts: 'ts', svelte: 'svelte', json: 'json',
      md: 'md', css: 'css', html: 'html', py: 'py', sh: 'sh',
      png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img',
    };
    return map[ext] || 'file';
  }

  function iconColor(icon) {
    const colors = {
      dir: '#c5a13e', js: '#f0d85e', ts: '#4a90d9', svelte: '#ff3e00',
      json: '#8b8', css: '#5b9fd6', html: '#e06050', py: '#5b9fd6',
      md: '#908b81', sh: '#57ab5a', img: '#c084fc', file: '#6b6760',
    };
    return colors[icon] || '#6b6760';
  }

  function sortEntries(entries) {
    if (!entries) return [];
    return [...entries].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      // Hidden files last
      const aHidden = a.name.startsWith('.');
      const bHidden = b.name.startsWith('.');
      if (aHidden && !bHidden) return 1;
      if (!aHidden && bHidden) return -1;
      return a.name.localeCompare(b.name);
    });
  }

  function renderDir(dirPath) {
    const data = treeData[dirPath];
    if (!data?.loaded) return [];
    return sortEntries(data.children);
  }

  function handleClick(entry) {
    if (entry.type === 'dir') {
      toggleDir(entry.path);
    } else {
      openFile(entry.path);
    }
  }
</script>

{#snippet treeNode(entries, depth)}
  {#each entries as entry (entry.path || entry.name)}
    {@const icon = getIcon(entry)}
    {@const isDir = entry.type === 'dir'}
    {@const isExpanded = expandedDirs.value.has(entry.path)}
    {@const isActive = !isDir && activeFilePath.value === entry.path}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tree-item"
      class:dir={isDir}
      class:expanded={isExpanded}
      class:active={isActive}
      style="padding-left: {12 + depth * 16}px"
      onclick={() => handleClick(entry)}
    >
      {#if isDir}
        <svg class="tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>
      {/if}
      <span class="tree-icon" style="color: {iconColor(icon)}">
        {#if isDir}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.8"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        {/if}
      </span>
      <span class="tree-name">{entry.name}</span>
    </div>
    {#if isDir && isExpanded}
      {@render treeNode(renderDir(entry.path), depth + 1)}
      {#if !treeData[entry.path]?.loaded}
        <div class="tree-loading" style="padding-left: {12 + (depth + 1) * 16}px">Loading...</div>
      {/if}
    {/if}
  {/each}
{/snippet}

<div class="file-tree-scroll">
<div class="file-tree">
  {#if treeData['.']?.loaded}
    {@render treeNode(renderDir('.'), 0)}
  {:else}
    <div class="tree-loading">Loading files...</div>
  {/if}
</div>
</div>

<style>
  .file-tree-scroll {
    overflow-x: auto;
    max-width: 100%;
  }

  .file-tree {
    padding: 4px 0;
    width: fit-content;
    min-width: 100%;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    transition: background 0.1s, color 0.1s;
    user-select: none;
    white-space: nowrap;
  }

  .tree-item:hover {
    background: rgba(var(--overlay-rgb), 0.04);
    color: var(--text);
  }

  .tree-item.active {
    background: var(--accent-12);
    color: var(--accent);
  }

  .tree-chevron {
    flex-shrink: 0;
    transition: transform 0.15s;
    opacity: 0.5;
  }

  .tree-item.expanded .tree-chevron {
    transform: rotate(90deg);
  }

  .tree-item:not(.dir) {
    padding-left: calc(var(--padding-left, 12px) + 14px);
  }

  .tree-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .tree-name {
    white-space: nowrap;
  }

  .tree-loading {
    font-size: 11px;
    color: var(--text-dimmer);
    padding: 4px 8px;
    font-style: italic;
  }
</style>
