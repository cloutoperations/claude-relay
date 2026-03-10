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
  // ThinkingIndicator replaced by inline live-status

  let {
    messages = [],
    processing = false,
    activity = null,
    thinking = { active: false, text: '' },
    loadingHistory = false,
    compact = false,
    onPermissionRespond = null,
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

  // Pick a new random verb when thinking starts
  $effect(() => {
    if (thinking.active) {
      thinkingVerb = thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
    }
  });

  // Count running agents for status line context
  let runningAgentCount = $derived(
    processing ? messages.filter(m => m.type === 'tool' && m.isAgent && m.status === 'running').length : 0
  );

  let messagesEl;
  let isUserScrolledUp = false;

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

  // Auto-scroll on new messages
  $effect(() => {
    messages; // subscribe
    scrollToBottom();
  });

  $effect(() => {
    if (thinking.active) scrollToBottom();
  });
</script>

<div class="message-list" class:compact bind:this={messagesEl} onscroll={handleScroll}>
  {#if loadingHistory}
    <div class="loading-history">
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
      <span>Loading history...</span>
    </div>
  {/if}

  {#each displayItems as item, i (item._key || item.uuid || item.toolId || item.requestId || i)}
    {#if item.type === 'user'}
      <UserMessage text={item.text} images={item.images} pastes={item.pastes} {compact} />
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
  {/each}

  {#if processing}
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
  {/if}
</div>

<style>
  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message-list.compact {
    padding: 14px 14px 10px;
    gap: 6px;
  }

  .message-list::-webkit-scrollbar { width: 6px; }
  .message-list::-webkit-scrollbar-track { background: transparent; }
  .message-list::-webkit-scrollbar-thumb { background: #3e3c37; border-radius: 3px; }

  .message-list.compact::-webkit-scrollbar { width: 5px; }
  .message-list.compact::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
  .message-list.compact::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }

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
    color: #da7756;
    font-family: 'SF Mono', 'Fira Code', monospace;
    animation: fadeIn 0.2s ease;
  }

  .live-status.compact .live-status-text {
    font-size: 11px;
    color: #da7756;
  }

  .live-status-spinner {
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
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
    background: #da7756;
    animation: statusBounce 1.4s ease-in-out infinite;
  }

  .live-status.compact .live-status-dots span {
    width: 4px;
    height: 4px;
    background: #da7756;
  }

  .live-status-dots span:nth-child(2) { animation-delay: 0.2s; }
  .live-status-dots span:nth-child(3) { animation-delay: 0.4s; }

  .live-status-badge {
    font-size: 10px;
    color: #da7756;
    padding: 1px 5px;
    background: rgba(218, 119, 86, 0.12);
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
    color: #5a5650;
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
    background: #5a5650;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .loading-dots span:nth-child(2) { animation-delay: 0.16s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.32s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
</style>
