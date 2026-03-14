<script>
  import { chatSearchQuery } from '../../stores/ui.svelte.js';

  let { messagesEl = null, messageCount = 0, messages = [] } = $props();

  let hits = $state([]);
  let containerRect = $state(null);
  let viewportTop = $state(0);
  let viewportHeight = $state(100);
  let totalHeight = $state(1);

  let query = $derived(chatSearchQuery.value);

  // Scan messages for query matches whenever query or messages change.
  $effect(() => {
    const q = query;
    const _count = messageCount; // subscribe
    const msgs = messages;
    if (!q || !msgs || msgs.length === 0) {
      hits = [];
      return;
    }

    const timer = setTimeout(() => scanMessageData(q, msgs), 150);
    return () => clearTimeout(timer);
  });

  function getMessageText(msg) {
    if (!msg) return '';
    if (msg.type === 'user' || msg.type === 'assistant') return msg.text || '';
    if (msg.type === 'system' || msg.type === 'info') return msg.text || '';
    if (msg.type === 'tool') return (msg.name || '') + ' ' + (msg.subtitle || '') + ' ' + (msg.output || '');
    if (msg.type === 'tool_group' && msg.tools) return msg.tools.map(t => (t.name || '') + ' ' + (t.subtitle || '')).join(' ');
    return '';
  }

  function scanMessageData(q, msgs) {
    const lowerQ = q.toLowerCase();
    const found = [];
    const total = msgs.length;

    for (let i = 0; i < total; i++) {
      const text = getMessageText(msgs[i]);
      if (!text) continue;
      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(lowerQ);
      if (idx === -1) continue;

      // Snippet
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + lowerQ.length + 20);
      let snippet = text.substring(start, end).trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < text.length) snippet = snippet + '...';

      found.push({
        msgIndex: i,
        position: total > 1 ? i / (total - 1) : 0.5,
        snippet,
      });
    }

    hits = found;
  }

  function scrollToHit(hit) {
    if (!messagesEl) return;

    // Scroll to position in the scroll container (maps linearly to message index)
    const scrollTarget = hit.position * (messagesEl.scrollHeight - messagesEl.clientHeight);
    messagesEl.scrollTo({ top: scrollTarget, behavior: 'smooth' });

    // After scroll completes, find and highlight the nearest matching element
    const lowerQ = (query || '').toLowerCase();
    if (!lowerQ) return;

    setTimeout(() => {
      const children = messagesEl.querySelectorAll('.msg-item');
      // Find the visible element closest to the scroll target that contains the query
      let best = null;
      let bestDist = Infinity;
      const viewMid = messagesEl.scrollTop + messagesEl.clientHeight / 2;

      for (let i = 0; i < children.length; i++) {
        const text = (children[i].textContent || '').toLowerCase();
        if (!text.includes(lowerQ)) continue;
        const elMid = children[i].offsetTop + children[i].offsetHeight / 2;
        const dist = Math.abs(elMid - viewMid);
        if (dist < bestDist) {
          bestDist = dist;
          best = children[i];
        }
      }

      if (best) {
        best.classList.add('search-blink');
        const el = best;
        setTimeout(() => { if (el.isConnected) el.classList.remove('search-blink'); }, 1500);
      }
    }, 400);
  }

  // Track container position + scroll state using rAF for fixed positioning
  $effect(() => {
    const el = messagesEl;
    if (!el || !query || hits.length === 0) {
      containerRect = null;
      return;
    }

    let rafId;
    function update() {
      const rect = el.getBoundingClientRect();
      containerRect = { top: rect.top, right: rect.right, height: rect.height };
      viewportTop = el.scrollTop;
      viewportHeight = el.clientHeight;
      totalHeight = el.scrollHeight;
      rafId = requestAnimationFrame(update);
    }

    update();
    return () => cancelAnimationFrame(rafId);
  });

  let viewportIndicatorTop = $derived(
    totalHeight > 0 ? (viewportTop / totalHeight) * 100 : 0
  );
  let viewportIndicatorHeight = $derived(
    totalHeight > 0 ? Math.max(4, (viewportHeight / totalHeight) * 100) : 100
  );
</script>

{#if query && hits.length > 0 && containerRect}
  <div
    class="search-timeline"
    style="position:fixed; top:{containerRect.top}px; left:{containerRect.right - 24}px; height:{containerRect.height}px; width:24px; z-index:9999;"
  >
    <div class="st-count">{hits.length} hit{hits.length !== 1 ? 's' : ''}</div>

    <div class="st-track">
      <div
        class="st-viewport"
        style="top: {viewportIndicatorTop}%; height: {viewportIndicatorHeight}%"
      ></div>

      {#each hits as hit, i}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="st-marker"
          style="top: {hit.position * 100}%"
          onclick={() => scrollToHit(hit)}
          title={hit.snippet}
        >
          <div class="st-marker-dot"></div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .search-timeline {
    display: flex;
    flex-direction: column;
    pointer-events: none;
  }

  .st-count {
    font-size: 9px;
    color: var(--accent);
    text-align: center;
    padding: 4px 0 2px;
    font-weight: 600;
    letter-spacing: 0.2px;
    pointer-events: auto;
    white-space: nowrap;
  }

  .st-track {
    flex: 1;
    position: relative;
    margin: 2px 0 8px;
  }

  .st-viewport {
    position: absolute;
    left: 2px;
    right: 2px;
    background: var(--accent-8);
    border: 1px solid var(--accent-15);
    border-radius: 3px;
    pointer-events: none;
    transition: top 0.1s, height 0.1s;
  }

  .st-marker {
    position: absolute;
    left: 0;
    right: 0;
    height: 14px;
    margin-top: -7px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.1s;
  }

  .st-marker:hover {
    transform: scale(1.5);
  }

  .st-marker-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px rgba(var(--accent-rgb), 0.6);
  }

  .st-marker:hover .st-marker-dot {
    background: var(--accent-hover);
    box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.8);
  }

  /* Global blink animation for search hits */
  :global(.search-blink) {
    animation: searchBlink 0.4s ease-in-out 3 !important;
  }

  @keyframes searchBlink {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 0 2px var(--accent); border-radius: 12px; }
  }
</style>
