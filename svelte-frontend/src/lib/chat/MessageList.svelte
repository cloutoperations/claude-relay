<script>
  import UserMessage from './UserMessage.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import SystemMessage from './SystemMessage.svelte';
  import ToolItem from './ToolItem.svelte';
  import PermissionRequest from './PermissionRequest.svelte';
  import AskUser from './AskUser.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';

  let {
    messages = [],
    processing = false,
    activity = null,
    thinking = { active: false, text: '' },
    loadingHistory = false,
    compact = false,
    onPermissionRespond = null,
    shouldCollapseTool = null,
  } = $props();

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

  // Collapse consecutive done tools in compact mode
  function shouldShowTool(msgs, index) {
    if (shouldCollapseTool) return shouldCollapseTool(msgs, index);
    if (!compact) return true;
    const msg = msgs[index];
    if (msg.type !== 'tool') return true;
    if (msg.status === 'running' || msg.status === 'error') return true;
    const next = msgs[index + 1];
    if (next && next.type === 'tool' && next.status !== 'running') return false;
    return true;
  }
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

  {#each messages as msg, i (msg.uuid || msg.toolId || msg.requestId || i)}
    {#if msg.type === 'user'}
      <UserMessage text={msg.text} images={msg.images} pastes={msg.pastes} {compact} />
    {:else if msg.type === 'assistant'}
      <AssistantMessage text={msg.text} finalized={msg.finalized} {compact} />
    {:else if msg.type === 'system' || msg.type === 'info'}
      <SystemMessage text={msg.text} isError={msg.isError} {compact} />
    {:else if msg.type === 'tool' && shouldShowTool(messages, i)}
      <ToolItem name={msg.name} status={msg.status} input={msg.input} output={msg.output} {compact} />
    {:else if msg.type === 'permission'}
      <PermissionRequest
        requestId={msg.requestId}
        toolName={msg.toolName}
        input={msg.input}
        inputSummary={msg.inputSummary}
        resolved={msg.resolved}
        decision={msg.decision}
        {compact}
        {onPermissionRespond}
      />
    {:else if msg.type === 'ask_user'}
      <AskUser requestId={msg.requestId} question={msg.question} answered={msg.answered} {compact} />
    {/if}
  {/each}

  {#if thinking.active}
    <ThinkingIndicator text={thinking.text} {compact} />
  {/if}

  {#if processing && activity}
    <div class="activity-indicator" class:compact>
      <span class="activity-dot"></span>
      {activity}
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

  .activity-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #908b81;
  }

  .activity-indicator.compact {
    padding: 4px 10px;
    font-size: 11px;
  }

  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #c5a13e;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

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
