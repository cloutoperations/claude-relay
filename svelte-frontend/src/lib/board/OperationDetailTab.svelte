<script>
  import { boardData, fetchBoard, fetchBoardFile } from '../../stores/board.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { createSession } from '../../stores/sessions.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';
  import { addTabToPane, findPaneForTab, switchPaneTab, activePaneId } from '../../stores/panes.svelte.js';
  import { onMount } from 'svelte';

  const AREA_PREFIX = '__area__:';

  let { operationPath } = $props();

  let docContent = $state(null);
  let docLoading = $state(false);

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });

  // Find the operation and its parent area
  let operation = $derived.by(() => {
    if (!boardData.value || !operationPath) return null;
    for (const area of boardData.value.areas) {
      const op = area.operations?.find(o => o.path === operationPath);
      if (op) return { ...op, areaName: area.name };
    }
    return null;
  });

  // Load operation doc
  $effect(() => {
    if (!operationPath || !operation) return;
    docContent = null;
    // Try loading the main doc
    const parts = operationPath.split('/');
    const opName = parts[parts.length - 1];
    if (operation.docs?.length > 0) {
      loadDoc(operationPath + '/' + operation.docs[0]);
    } else {
      loadDoc(operationPath + '.md');
    }
  });

  async function loadDoc(path) {
    docLoading = true;
    docContent = await fetchBoardFile(path);
    docLoading = false;
  }

  function formatName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function openAreaTab(areaName) {
    const tabId = AREA_PREFIX + areaName;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }

  function handleNewSession() {
    // Link session to the area (operations live under areas)
    createSession(null, true, operation?.areaName || null);
    setTimeout(() => fetchBoard(), 1500);
  }

  function handleSessionClick(e, session) {
    openTab(session.id, session.title || 'Session');
  }

  // Find sessions relevant to this operation — filter area sessions by operation name
  let operationSessions = $derived.by(() => {
    if (!boardData.value || !operation) return [];
    const area = boardData.value.areas.find(a => a.name === operation.areaName);
    const allSessions = area?.areaSessions || [];
    const opName = operation.name.toLowerCase();
    return allSessions.filter(s => {
      const title = (s.title || '').toLowerCase();
      const pPath = (s.projectPath || '').toLowerCase();
      return title.includes(opName) || pPath.includes(opName);
    });
  });
  // Also keep full area sessions as fallback
  let areaSessions = $derived.by(() => {
    if (!boardData.value || !operation) return [];
    const area = boardData.value.areas.find(a => a.name === operation.areaName);
    return area?.areaSessions || [];
  });
</script>

{#if !operation}
  <div class="od-loading">
    <div class="od-spinner"></div>
    <span>Loading operation...</span>
  </div>
{:else}
  <div class="operation-detail">
    <div class="od-content">
      <!-- Breadcrumb -->
      <div class="od-breadcrumb">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="od-crumb clickable" onclick={() => openAreaTab(operation.areaName)}>{formatName(operation.areaName)}</span>
        <span class="od-crumb-sep">/</span>
        <span class="od-crumb dimmed">operations</span>
        <span class="od-crumb-sep">/</span>
        <span class="od-crumb current">{operation.name}</span>
      </div>

      <!-- Header -->
      <div class="od-header">
        <h2 class="od-title">{formatName(operation.name)}</h2>
        <button class="od-action" onclick={handleNewSession}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session
        </button>
      </div>

      <div class="od-path">{operationPath}</div>

      {#if operation.description}
        <div class="od-description">{operation.description}</div>
      {/if}

      <!-- Docs list -->
      {#if operation.docs?.length > 1}
        <div class="od-section">
          <h3 class="od-section-title">Documents ({operation.docs.length})</h3>
          <div class="od-docs-list">
            {#each operation.docs as doc}
              <div class="od-doc-item">{doc}</div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Operation-specific sessions -->
      {#if operationSessions.length > 0}
        <div class="od-section">
          <h3 class="od-section-title">Sessions ({operationSessions.length})</h3>
          <div class="od-sessions-list">
            {#each operationSessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="od-session" onclick={(e) => handleSessionClick(e, session)}>
                <span class="od-session-dot" class:processing={session.isProcessing}></span>
                <span class="od-session-title">{session.title || 'Untitled'}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- All area sessions -->
      {#if areaSessions.length > 0}
        <div class="od-section">
          <h3 class="od-section-title">All {formatName(operation.areaName)} Sessions ({areaSessions.length})</h3>
          <div class="od-sessions-list">
            {#each areaSessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="od-session" onclick={(e) => handleSessionClick(e, session)}>
                <span class="od-session-dot" class:processing={session.isProcessing}></span>
                <span class="od-session-title">{session.title || 'Untitled'}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Document content -->
      {#if docLoading}
        <div class="od-doc-loading">Loading document...</div>
      {:else if docContent}
        <div class="od-section">
          <h3 class="od-section-title">Document</h3>
          <div class="od-doc">{@html renderMarkdown(docContent)}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .operation-detail { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
  .od-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-dimmer); font-size: 13px; }
  .od-spinner { width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: odSpin 0.7s linear infinite; }
  .od-content { padding: 20px 24px; max-width: 800px; }

  .od-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dimmer); margin-bottom: 12px; }
  .od-crumb.clickable { cursor: pointer; color: var(--text-muted); }
  .od-crumb.clickable:hover { color: var(--accent); }
  .od-crumb.current { color: var(--text); font-weight: 500; }
  .od-crumb.dimmed { color: var(--text-dimmer); }
  .od-crumb-sep { color: var(--text-dimmer); font-size: 10px; }

  .od-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .od-title { font-size: 20px; font-weight: 600; color: var(--text); margin: 0; }
  .od-action { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: var(--accent-12); border: 1px solid var(--accent-20); border-radius: 8px; color: var(--accent); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
  .od-action:hover { background: var(--accent-20); }

  .od-path { font-size: 11px; color: var(--text-dimmer); font-family: 'SF Mono', Menlo, monospace; margin-bottom: 16px; }
  .od-description { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px; padding: 10px 12px; background: rgba(var(--overlay-rgb), 0.03); border-radius: 8px; }

  .od-section { margin-bottom: 20px; }
  .od-section-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 0 0 8px; }

  .od-docs-list { display: flex; flex-direction: column; gap: 4px; }
  .od-doc-item { font-size: 12px; color: var(--text-muted); padding: 4px 8px; background: rgba(var(--overlay-rgb), 0.03); border-radius: 4px; font-family: 'SF Mono', Menlo, monospace; }

  .od-sessions-list { display: flex; flex-direction: column; gap: 2px; }
  .od-session { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: pointer; transition: background 0.12s; }
  .od-session:hover { background: rgba(var(--overlay-rgb), 0.04); }
  .od-session-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-dimmer); flex-shrink: 0; }
  .od-session-dot.processing { background: var(--accent); animation: odPulse 1.5s ease-in-out infinite; }
  .od-session-title { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .od-doc-loading { font-size: 12px; color: var(--text-dimmer); padding: 12px 0; }
  .od-doc { font-size: 14px; line-height: 1.6; color: var(--text); }
  .od-doc :global(h1), .od-doc :global(h2), .od-doc :global(h3) { margin: 1em 0 0.5em; font-weight: 600; }
  .od-doc :global(p) { margin: 0.5em 0; }
  .od-doc :global(ul), .od-doc :global(ol) { padding-left: 1.5em; }
  .od-doc :global(code) { background: var(--bg-deeper); padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  .od-doc :global(pre) { background: var(--bg-deeper); padding: 12px; border-radius: 6px; overflow-x: auto; }

  @keyframes odSpin { to { transform: rotate(360deg); } }
  @keyframes odPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
