<script>
  import UserMessage from './UserMessage.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import SystemMessage from './SystemMessage.svelte';
  import ToolItem from './ToolItem.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import TaskWidget from './TaskWidget.svelte';
  import TurnMeta from './TurnMeta.svelte';
  import PermissionRequest from './PermissionRequest.svelte';
  import AskUser from './AskUser.svelte';
  import SearchTimeline from './SearchTimeline.svelte';
  // ThinkingIndicator replaced by inline live-status

  let {
    messages = [],
    processing = false,
    activity = null,
    thinking = { active: false, text: '' },
    loadingHistory = false,
    loadingEarlier = false,
    hasEarlier = false,
    compact = false,
    onPermissionRespond = null,
    onLoadEarlier = null,
    shouldCollapseTool = null,
    taskItems = null,
  } = $props();

  // Hidden tools that should never render
  const HIDDEN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode']);

  // Task tools rendered via TaskWidget instead of individual items
  const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite']);

  // Compute display items: group consecutive tools, replace task tools with widget, etc.
  let displayItems = $derived.by(() => {
    const items = [];
    let currentGroup = null;
    let taskWidgetInserted = false;

    function flushGroup() {
      if (!currentGroup) return;
      if (currentGroup.tools.length === 1) {
        // Single tool — render as regular item, keep its properties
        items.push({ ...currentGroup.tools[0], _key: currentGroup.tools[0].toolId });
      } else {
        items.push(currentGroup);
      }
      currentGroup = null;
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Task tools → insert widget once, skip individual items
      if (msg.type === 'tool' && (msg.isTaskTool || TASK_TOOLS.has(msg.name))) {
        if (!taskWidgetInserted) {
          flushGroup();
          items.push({ type: 'task_widget', _key: 'task-widget' });
          taskWidgetInserted = true;
        }
        continue;
      }

      // Hidden tools — skip entirely
      if (msg.type === 'tool' && HIDDEN_TOOLS.has(msg.name)) {
        continue;
      }

      // Visible tools → group consecutive ones
      if (msg.type === 'tool') {
        if (!currentGroup) {
          currentGroup = {
            type: 'tool_group',
            tools: [msg],
            _key: 'tg-' + (msg.toolId || i),
          };
        } else {
          currentGroup.tools.push(msg);
        }
        continue;
      }

      // Non-tool → flush any pending group, then add item
      flushGroup();
      items.push(msg);
    }

    flushGroup();
    return items;
  });

  const thinkingVerbs = [
    'Thinking', 'Reasoning', 'Analyzing', 'Considering', 'Processing',
    'Evaluating', 'Pondering', 'Exploring', 'Investigating', 'Working'
  ];
  let thinkingVerb = $state(thinkingVerbs[0]);

  // Pick a new random verb when processing or thinking starts
  $effect(() => {
    if (processing) {
      thinkingVerb = thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
    }
  });

  $effect(() => {
    if (thinking.active) {
      thinkingVerb = thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
    }
  });

  // Count running agents for status line context
  let runningAgentCount = $derived(
    processing ? messages.filter(m => m.type === 'tool' && m.isAgent && m.status === 'running').length : 0
  );

  // --- Windowed rendering ---
  // Only render last WINDOW_SIZE items initially; user can load more.
  const WINDOW_SIZE = 150;
  let renderAll = $state(false);

  let visibleItems = $derived.by(() => {
    if (renderAll || displayItems.length <= WINDOW_SIZE) return displayItems;
    return displayItems.slice(-WINDOW_SIZE);
  });

  let hiddenCount = $derived(displayItems.length - visibleItems.length);

  function loadAllMessages() {
    renderAll = true;
  }

  // Reset window when messages change drastically (session switch)
  $effect(() => {
    if (displayItems.length <= WINDOW_SIZE) {
      renderAll = false;
    }
  });

  let messagesEl = $state(null);
  let isUserScrolledUp = false;
  let prevMessageCount = 0;
  let sentinelEl = $state(null);
  let loadEarlierDebounce = null;

  function scrollToBottom() {
    if (!messagesEl || isUserScrolledUp) return;
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function handleScroll() {
    if (!messagesEl) return;
    const threshold = 100;
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
    isUserScrolledUp = !atBottom;
  }

  // Preserve scroll position when messages are prepended (earlier history loaded)
  $effect(() => {
    const count = messages.length;
    if (count > prevMessageCount && prevMessageCount > 0 && isUserScrolledUp && messagesEl) {
      // Messages were added — if user was scrolled up, they were prepended
      // Save scroll height before DOM updates, restore after
      const oldHeight = messagesEl.scrollHeight;
      requestAnimationFrame(() => {
        if (messagesEl) {
          const newHeight = messagesEl.scrollHeight;
          messagesEl.scrollTop += (newHeight - oldHeight);
        }
      });
    }
    prevMessageCount = count;
  });

  // Reset scroll state when loading new session history
  $effect(() => {
    if (loadingHistory) {
      isUserScrolledUp = false;
      prevMessageCount = 0;
    }
  });

  // Scroll to bottom when history finishes loading
  $effect(() => {
    if (!loadingHistory && messages.length > 0 && !isUserScrolledUp) {
      setTimeout(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 50);
    }
  });

  // Auto-scroll on new messages (during live streaming) — only if at bottom
  $effect(() => {
    messages; // subscribe
    scrollToBottom();
  });

  $effect(() => {
    if (thinking.active) scrollToBottom();
  });

  // Intersection observer — auto-load earlier when scrolled to top
  $effect(() => {
    if (!sentinelEl || !hasEarlier || !onLoadEarlier || compact) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingEarlier) {
        // Debounce to avoid rapid-fire requests
        if (loadEarlierDebounce) clearTimeout(loadEarlierDebounce);
        loadEarlierDebounce = setTimeout(() => onLoadEarlier(), 300);
      }
    }, { root: messagesEl, threshold: 0 });
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  });
</script>

<div class="message-list-wrap" class:compact>
<div class="message-list" class:compact bind:this={messagesEl} onscroll={handleScroll}>
  {#if loadingHistory}
    <div class="loading-history">
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
      <span>Loading history...</span>
    </div>
  {/if}

  {#if hasEarlier && onLoadEarlier}
    <!-- Sentinel for intersection observer — triggers auto-load on scroll -->
    <div class="load-earlier-sentinel" bind:this={sentinelEl}></div>
    {#if loadingEarlier}
      <div class="loading-earlier">
        <div class="loading-dots"><span></span><span></span><span></span></div>
        <span>Loading earlier messages...</span>
      </div>
    {/if}
  {/if}

  {#if hiddenCount > 0}
    <button class="load-earlier" onclick={loadAllMessages}>
      Show {hiddenCount} more (already loaded)
    </button>
  {/if}

  {#each visibleItems as item, i (item._key || item.uuid || item.toolId || item.requestId || 'i' + i)}
    <div class="msg-item">
    {#if item.type === 'user'}
      <UserMessage text={item.text} images={item.images} pastes={item.pastes} imageCount={item.imageCount || 0} {compact} />
    {:else if item.type === 'assistant'}
      <AssistantMessage text={item.text} finalized={item.finalized} {compact} />
    {:else if item.type === 'system' || item.type === 'info'}
      <SystemMessage text={item.text} isError={item.isError} {compact} />
    {:else if item.type === 'tool_group'}
      <ToolGroup tools={item.tools} {compact} />
    {:else if item.type === 'tool'}
      <ToolItem name={item.name} status={item.status} input={item.input} output={item.output} subtitle={item.subtitle} subTools={item.subTools} {compact} />
    {:else if item.type === 'task_widget'}
      <TaskWidget {compact} items={taskItems} />
    {:else if item.type === 'turn_meta'}
      <TurnMeta cost={item.cost} duration={item.duration} {compact} />
    {:else if item.type === 'permission'}
      <PermissionRequest
        requestId={item.requestId}
        toolName={item.toolName}
        input={item.input}
        inputSummary={item.inputSummary}
        resolved={item.resolved}
        decision={item.decision}
        {compact}
        {onPermissionRespond}
      />
    {:else if item.type === 'ask_user'}
      <AskUser requestId={item.requestId} question={item.question} answered={item.answered} {compact} />
    {/if}
    </div>
  {/each}

  {#if processing}
    <div class="msg-item">
    <div class="live-status" class:compact>
      {#if thinking.active}
        <div class="live-status-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="live-status-text">{thinkingVerb}...</span>
      {:else if activity}
        <div class="live-status-spinner"></div>
        {#if runningAgentCount > 1}
          <span class="live-status-badge">{runningAgentCount} agents</span>
        {/if}
        <span class="live-status-text">{activity}</span>
      {:else}
        <div class="live-status-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="live-status-text">{thinkingVerb}...</span>
      {/if}
    </div>
    </div>
  {/if}
</div>
{#if !compact}
  <SearchTimeline {messagesEl} messageCount={messages.length} {messages} />
{/if}
</div>

<style>
  .message-list-wrap {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message-list.compact {
    padding: 14px 14px 10px;
    gap: 6px;
  }

  .msg-item {
    max-width: 900px;
    width: 100%;
    align-self: center;
    box-sizing: border-box;
  }

  .load-earlier-sentinel {
    height: 1px;
    width: 100%;
  }

  .loading-earlier {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .load-earlier {
    align-self: center;
    padding: 6px 16px;
    background: var(--accent-8);
    border: 1px solid var(--accent-20);
    border-radius: 8px;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 8px;
    transition: background 0.15s;
  }

  .load-earlier:hover {
    background: var(--accent-15);
  }

  .message-list::-webkit-scrollbar { width: 6px; }
  .message-list::-webkit-scrollbar-track { background: transparent; }
  .message-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .message-list.compact::-webkit-scrollbar { width: 5px; }
  .message-list.compact::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb),0.08); }
  .message-list.compact::-webkit-scrollbar-thumb:hover { background: rgba(var(--overlay-rgb),0.14); }

  .live-status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    margin: 4px 0;
  }

  .live-status.compact {
    padding: 4px 10px;
    gap: 8px;
  }

  .live-status-text {
    font-size: 12px;
    color: var(--accent);
    font-family: 'SF Mono', 'Fira Code', monospace;
    animation: fadeIn 0.2s ease;
  }

  .live-status.compact .live-status-text {
    font-size: 11px;
    color: var(--accent);
  }

  .live-status-spinner {
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--accent-25);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .live-status.compact .live-status-spinner {
    width: 10px;
    height: 10px;
  }

  .live-status-dots {
    display: flex;
    gap: 3px;
  }

  .live-status-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: statusBounce 1.4s ease-in-out infinite;
  }

  .live-status.compact .live-status-dots span {
    width: 4px;
    height: 4px;
    background: var(--accent);
  }

  .live-status-dots span:nth-child(2) { animation-delay: 0.2s; }
  .live-status-dots span:nth-child(3) { animation-delay: 0.4s; }

  .live-status-badge {
    font-size: 10px;
    color: var(--accent);
    padding: 1px 5px;
    background: var(--accent-12);
    border-radius: 3px;
    flex-shrink: 0;
    font-weight: 600;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes statusBounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-3px); }
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .loading-history {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px;
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .loading-dots {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
  }

  .loading-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dimmer);
    animation: bounce 1.4s ease-in-out infinite;
  }

  .loading-dots span:nth-child(2) { animation-delay: 0.16s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.32s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
</style>
