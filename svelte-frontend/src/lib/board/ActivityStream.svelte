<script>
  import { sessionList as sessions } from '../../stores/sessions.svelte.js';
  import { openPopup } from '../../stores/popups.svelte.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.svelte.js';
  import { boardData } from '../../stores/board.svelte.js';
  import { onMount } from 'svelte';

  let events = $state([]);
  // Use plain variable — NOT $state — to avoid $effect read/write loop
  let prevProcessing = new Set();

  // Track processing state changes reactively from sessions store
  $effect(() => {
    const currentProcessing = new Set();
    const sessionMap = {};

    for (const s of sessions || []) {
      sessionMap[s.id] = s;
      if (s.isProcessing) currentProcessing.add(s.id);
    }

    // Detect transitions (prevProcessing is NOT reactive — no loop)
    for (const id of currentProcessing) {
      if (!prevProcessing.has(id)) {
        addEvent(id, sessionMap[id]?.title, findArea(id), 'started');
      }
    }
    for (const id of prevProcessing) {
      if (!currentProcessing.has(id) && sessionMap[id]) {
        addEvent(id, sessionMap[id]?.title, findArea(id), 'finished');
      }
    }

    prevProcessing = currentProcessing;
  });

  function findArea(sessionId) {
    const data = boardData.value;
    if (!data) return '';
    for (const area of data.areas) {
      for (const proj of area.projects) {
        if (proj.sessions.some(s => s.id === sessionId)) return area.name;
        for (const sub of proj.subProjects) {
          if (sub.sessions?.some(s => s.id === sessionId)) return area.name;
        }
      }
    }
    return '';
  }

  function addEvent(sessionId, title, areaName, event) {
    events = [
      { sessionId, title: title || 'Untitled', areaName, event, timestamp: Date.now() },
      ...events,
    ].slice(0, 20);
  }

  function formatAreaName(name) {
    if (!name) return '';
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function relativeTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'now';
    if (diff < 60) return diff + 's';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    return Math.floor(diff / 3600) + 'h';
  }

  function handleClick(e, ev) {
    e.stopPropagation();
    if (activeSessionId.value) leaveSession();
    openPopup(ev.sessionId, ev.title);
  }

  // Refresh times every 30s
  let tick = $state(0);
  onMount(() => {
    const interval = setInterval(() => tick++, 30000);
    return () => clearInterval(interval);
  });

  let visibleEvents = $derived.by(() => {
    void tick;
    const cutoff = Date.now() - 30 * 60 * 1000;
    return events.filter(e => e.timestamp > cutoff);
  });
</script>

{#if visibleEvents.length > 0}
  <div class="activity-stream">
    {#each visibleEvents as ev (ev.sessionId + ev.timestamp)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="stream-event"
        class:started={ev.event === 'started'}
        class:finished={ev.event === 'finished'}
        onclick={(e) => handleClick(e, ev)}
      >
        <span class="event-dot" class:processing={ev.event === 'started'}></span>
        {#if ev.areaName}
          <span class="event-area">{formatAreaName(ev.areaName)}</span>
        {/if}
        <span class="event-title">{ev.title}</span>
        <span class="event-verb">{ev.event}</span>
        <span class="event-time">{relativeTime(ev.timestamp)}</span>
      </span>
    {/each}
  </div>
{/if}

<style>
  .activity-stream {
    display: flex;
    gap: 12px;
    padding: 6px 16px;
    height: 32px;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.04);
    flex-shrink: 0;
    scrollbar-width: none;
  }

  .activity-stream::-webkit-scrollbar {
    display: none;
  }

  .stream-event {
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 6px;
    transition: background 0.12s;
    flex-shrink: 0;
  }

  .stream-event:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .event-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dimmer);
    flex-shrink: 0;
  }

  .event-dot.processing {
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .event-area {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .event-title {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .event-verb {
    font-size: 10px;
    color: var(--text-dimmer);
  }

  .event-time {
    font-size: 10px;
    color: var(--text-dimmer);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
