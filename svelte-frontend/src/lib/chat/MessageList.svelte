<script>
  import { messages, processing, activity, thinking, historyDone } from '../../stores/chat.js';
  import UserMessage from './UserMessage.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import SystemMessage from './SystemMessage.svelte';
  import ToolItem from './ToolItem.svelte';
  import PermissionRequest from './PermissionRequest.svelte';
  import AskUser from './AskUser.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';

  let messagesEl;
  let isUserScrolledUp = false;

  function scrollToBottom() {
    if (!messagesEl || isUserScrolledUp) return;
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
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
    $messages; // subscribe
    scrollToBottom();
  });

  $effect(() => {
    if ($thinking.active) scrollToBottom();
  });
</script>

<div class="message-list" bind:this={messagesEl} onscroll={handleScroll}>
  {#each $messages as msg, i (msg.uuid || msg.toolId || msg.requestId || i)}
    {#if msg.type === 'user'}
      <UserMessage text={msg.text} images={msg.images} pastes={msg.pastes} />
    {:else if msg.type === 'assistant'}
      <AssistantMessage text={msg.text} finalized={msg.finalized} />
    {:else if msg.type === 'system'}
      <SystemMessage text={msg.text} isError={msg.isError} />
    {:else if msg.type === 'tool'}
      <ToolItem name={msg.name} status={msg.status} input={msg.input} output={msg.output} />
    {:else if msg.type === 'permission'}
      <PermissionRequest requestId={msg.requestId} toolName={msg.toolName} input={msg.input} resolved={msg.resolved} decision={msg.decision} />
    {:else if msg.type === 'ask_user'}
      <AskUser requestId={msg.requestId} question={msg.question} answered={msg.answered} />
    {/if}
  {/each}

  {#if $thinking.active}
    <ThinkingIndicator text={$thinking.text} />
  {/if}

  {#if $processing && $activity}
    <div class="activity-indicator">
      <span class="activity-dot"></span>
      {$activity}
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

  .message-list::-webkit-scrollbar { width: 6px; }
  .message-list::-webkit-scrollbar-track { background: transparent; }
  .message-list::-webkit-scrollbar-thumb { background: #3e3c37; border-radius: 3px; }

  .activity-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #908b81;
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
</style>
