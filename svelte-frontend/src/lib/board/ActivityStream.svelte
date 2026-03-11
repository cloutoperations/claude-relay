<script>
  import { onMessage } from '../../stores/ws.js';
  import { sessions } from '../../stores/sessions.js';
  import { openPopup } from '../../stores/popups.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.js';
  import { boardData } from '../../stores/board.js';
  import { onMount } from 'svelte';

  let events = $state([]);
  let prevProcessing = $state(new Set());

  // Track processing state changes from session_list updates
  onMessage((msg) => {
    if (msg.type !== 'session_list') return;
    const currentProcessing = new Set();
    const sessionMap = {};

    for (const s of msg.sessions || []) {
      sessionMap[s.id] = s;
      if (s.isProcessing) currentProcessing.add(s.id);
    }

    // Detect transitions
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
    const data = $boardData;
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
    if ($activeSessionId) leaveSession();
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
    border-top: 1px solid rgba(255, 255, 255, 0.04);
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
    background: rgba(255, 255, 255, 0.06);
  }

  .event-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6b6760;
    flex-shrink: 0;
  }

  .event-dot.processing {
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .event-area {
    font-size: 10px;
    font-weight: 600;
    color: #908b81;
  }

  .event-title {
    font-size: 11px;
    color: #b0ab9f;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .event-verb {
    font-size: 10px;
    color: #6b6760;
  }

  .event-time {
    font-size: 10px;
    color: #5a5650;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
