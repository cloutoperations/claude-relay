<script>
  import { chatSearchQuery } from '../../stores/ui.js';

  let { messagesEl = null, messageCount = 0, messages = [] } = $props();

  let hits = $state([]);
  let viewportTop = $state(0);
  let viewportHeight = $state(100);
  let totalHeight = $state(1);
  let timelineEl = $state(null);

  let query = $derived($chatSearchQuery);

  // Scan messages for query matches whenever query or messages change.
  // Uses actual message data (not DOM) so windowed/virtualized messages are still found.
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
    // Find the rendered DOM child closest to this message index.
    // With windowing, not all messages are rendered, so find by approximate position.
    const children = messagesEl.children;
    if (children.length === 0) return;

    // Try to find the child by scanning text content for the snippet keyword
    const lowerQ = (query || '').toLowerCase();
    let targetChild = null;

    for (let i = 0; i < children.length; i++) {
      const text = (children[i].textContent || '').toLowerCase();
      if (text.includes(lowerQ)) {
        // Count how many we've seen to match the right occurrence
        targetChild = children[i];
        // Keep going to find the right one based on position
      }
    }

    if (targetChild) {
      targetChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetChild.classList.add('search-blink');
      setTimeout(() => targetChild.classList.remove('search-blink'), 1500);
    } else {
      // Message not rendered (windowed out) — scroll to approximate position
      const scrollTarget = hit.position * messagesEl.scrollHeight;
      messagesEl.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  }

  // Update viewport indicator on scroll
  $effect(() => {
    const el = messagesEl;
    if (!el || !query) return;

    function onScroll() {
      viewportTop = el.scrollTop;
      viewportHeight = el.clientHeight;
      totalHeight = el.scrollHeight;
    }

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  });

  let viewportIndicatorTop = $derived(
    totalHeight > 0 ? (viewportTop / totalHeight) * 100 : 0
  );
  let viewportIndicatorHeight = $derived(
    totalHeight > 0 ? Math.max(4, (viewportHeight / totalHeight) * 100) : 100
  );
</script>

{#if query && hits.length > 0}
  <div class="search-timeline" bind:this={timelineEl}>
    <!-- Hit count label -->
    <div class="st-count">{hits.length} hit{hits.length !== 1 ? 's' : ''}</div>

    <!-- Track -->
    <div class="st-track">
      <!-- Viewport indicator -->
      <div
        class="st-viewport"
        style="top: {viewportIndicatorTop}%; height: {viewportIndicatorHeight}%"
      ></div>

      <!-- Hit markers -->
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
    position: absolute;
    right: 4px;
    top: 0;
    bottom: 0;
    width: 20px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    pointer-events: none;
  }

  .st-count {
    font-size: 9px;
    color: #da7756;
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
    background: rgba(218, 119, 86, 0.08);
    border: 1px solid rgba(218, 119, 86, 0.15);
    border-radius: 3px;
    pointer-events: none;
    transition: top 0.1s, height 0.1s;
  }

  .st-marker {
    position: absolute;
    left: 0;
    right: 0;
    height: 12px;
    margin-top: -6px;
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
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    box-shadow: 0 0 4px rgba(218, 119, 86, 0.5);
  }

  .st-marker:hover .st-marker-dot {
    background: #e8956e;
    box-shadow: 0 0 8px rgba(218, 119, 86, 0.7);
  }

  /* Global blink animation for search hits */
  :global(.search-blink) {
    animation: searchBlink 0.4s ease-in-out 3 !important;
  }

  @keyframes searchBlink {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 0 2px #da7756; border-radius: 12px; }
  }
</style>
