<script>
  let { text = '', images = null, pastes = null, documents = null, documentCount = 0, documentNames = null, imageCount = 0, compact = false } = $props();
  let expandedPastes = $state(new Set());

  function togglePaste(idx) {
    if (expandedPastes.has(idx)) {
      expandedPastes.delete(idx);
    } else {
      expandedPastes.add(idx);
    }
    expandedPastes = new Set(expandedPastes);
  }
</script>

<div class="msg-user" class:compact>
  <div class="bubble" dir="auto">
    {#if images && images.length > 0}
      <div class="bubble-images">
        {#each images as img}
          <img class="bubble-img" src={img.url || `data:${img.mediaType};base64,${img.data}`} alt="Attached" />
        {/each}
      </div>
    {:else if imageCount > 0}
      <div class="bubble-image-placeholder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        {imageCount} image{imageCount > 1 ? 's' : ''} attached
      </div>
    {/if}

    {#if documents && documents.length > 0}
      <div class="bubble-docs">
        {#each documents as doc}
          <div class="bubble-doc">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {doc.name || 'document'}
          </div>
        {/each}
      </div>
    {:else if documentCount > 0}
      <div class="bubble-doc">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        {#if documentNames && documentNames.length > 0}
          {documentNames.join(', ')}
        {:else}
          {documentCount} document{documentCount > 1 ? 's' : ''} attached
        {/if}
      </div>
    {/if}

    {#if pastes && pastes.length > 0}
      <div class="bubble-pastes">
        {#each pastes as paste, idx}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="bubble-paste" class:expanded={expandedPastes.has(idx)} onclick={() => togglePaste(idx)}>
            {#if expandedPastes.has(idx)}
              <pre class="bubble-paste-full">{paste}</pre>
              <span class="bubble-paste-collapse">COLLAPSE</span>
            {:else}
              <span class="bubble-paste-preview">{paste.substring(0, 80).replace(/\n/g, ' ')}{paste.length > 80 ? '...' : ''}</span>
              <span class="bubble-paste-label">PASTED · {paste.split('\n').length} lines</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if text}
      <span>{text}</span>
    {/if}
  </div>
</div>

<style>
  .msg-user {
    display: flex;
    justify-content: flex-end;
    margin: 8px 0;
  }

  .msg-user.compact {
    margin: 2px 0;
    padding: 2px 0;
  }

  .bubble {
    max-width: 70%;
    padding: 10px 14px;
    background: var(--bg-alt);
    border-radius: 18px 18px 4px 18px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text);
    word-wrap: break-word;
  }

  .compact .bubble {
    max-width: 82%;
    padding: 8px 12px;
    background: var(--accent);
    color: white;
    border-radius: 14px 14px 4px 14px;
    font-size: 13px;
    line-height: 1.45;
    font-weight: 400;
  }

  .bubble-images {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .bubble-img {
    max-width: 200px;
    max-height: 200px;
    border-radius: 8px;
    cursor: pointer;
  }

  .compact .bubble-img {
    max-width: 120px;
    max-height: 120px;
  }

  .bubble-image-placeholder {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin-bottom: 6px;
    background: rgba(var(--overlay-rgb), 0.06);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .compact .bubble-image-placeholder {
    color: rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.1);
    font-size: 11px;
    padding: 4px 8px;
  }

  .bubble-docs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }

  .bubble-doc {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin-bottom: 6px;
    background: rgba(var(--overlay-rgb), 0.06);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .bubble-doc svg { flex-shrink: 0; }

  .compact .bubble-doc {
    color: rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.1);
    font-size: 11px;
    padding: 4px 8px;
  }

  .bubble-pastes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }

  .bubble-paste {
    padding: 6px 10px;
    background: rgba(var(--overlay-rgb), 0.05);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .bubble-paste:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .bubble-paste.expanded {
    background: var(--bg-deeper);
    border-color: var(--border);
  }

  .compact .bubble-paste {
    font-size: 11px;
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.1);
  }

  .bubble-paste-preview {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .compact .bubble-paste-preview {
    color: rgba(255,255,255,0.7);
  }

  .bubble-paste-label {
    float: right;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .compact .bubble-paste-label {
    color: rgba(255,255,255,0.5);
  }

  .bubble-paste-full {
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    margin: 4px 0;
    padding: 0;
    background: none;
  }

  .compact .bubble-paste-full {
    color: rgba(255,255,255,0.85);
    font-size: 10px;
    max-height: 200px;
  }

  .bubble-paste-collapse {
    display: block;
    text-align: right;
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
  }
</style>
