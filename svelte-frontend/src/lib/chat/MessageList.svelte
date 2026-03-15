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
  import ThinkingBlock from './ThinkingBlock.svelte';

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
    onStopAgent = null,
    onSend = null,
    shouldCollapseTool = null,
    taskItems = null,
    planMode = false,
    streamingText = '',
    isStreaming = false,
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

    // Only keep the last suggestion block — old ones are just clutter
    let lastSuggestionIdx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'suggestions') { lastSuggestionIdx = i; break; }
    }

    return lastSuggestionIdx >= 0
      ? items.filter((item, i) => item.type !== 'suggestions' || i === lastSuggestionIdx)
      : items;
  });

  const thinkingVerbs = [
    'Accomplishing', 'Actioning', 'Architecting', 'Baking', 'Beaming',
    "Beboppin'", 'Befuddling', 'Billowing', 'Blanching', 'Bloviating',
    'Boondoggling', 'Booping', 'Bootstrapping', 'Brewing', 'Burrowing',
    'Calculating', 'Canoodling', 'Caramelizing', 'Cascading', 'Catapulting',
    'Cerebrating', 'Channeling', 'Choreographing', 'Churning', 'Clauding',
    'Coalescing', 'Cogitating', 'Combobulating', 'Composing', 'Computing',
    'Concocting', 'Considering', 'Contemplating', 'Cooking', 'Crafting',
    'Crunching', 'Crystallizing', 'Cultivating', 'Deciphering', 'Deliberating',
    'Dilly-dallying', 'Discombobulating', 'Doodling', 'Drizzling',
    'Effecting', 'Elucidating', 'Enchanting', 'Envisioning', 'Fermenting',
    'Fiddle-faddling', 'Finagling', 'Flambéing', 'Flibbertigibbeting',
    'Flowing', 'Flummoxing', 'Forging', 'Frolicking', 'Frosting',
    'Gallivanting', 'Garnishing', 'Generating', 'Germinating', 'Grooving',
    'Harmonizing', 'Hashing', 'Hatching', 'Hullaballooing', 'Hyperspacing',
    'Ideating', 'Imagining', 'Improvising', 'Incubating', 'Infusing',
    'Jitterbugging', 'Julienning', 'Kneading', 'Leavening', 'Levitating',
    'Lollygagging', 'Manifesting', 'Marinating', 'Meandering', 'Metamorphosing',
    'Moonwalking', 'Moseying', 'Mulling', 'Musing', 'Nebulizing', 'Noodling',
    'Orchestrating', 'Osmosing', 'Percolating', 'Philosophising',
    'Photosynthesizing', 'Pondering', 'Pontificating', 'Precipitating',
    'Prestidigitating', 'Processing', 'Puttering', 'Puzzling', 'Quantumizing',
    'Razzle-dazzling', 'Recombobulating', 'Reticulating', 'Ruminating',
    'Sautéing', 'Scampering', 'Schlepping', 'Seasoning', 'Shenaniganing',
    'Shimmying', 'Simmering', 'Skedaddling', 'Spelunking', 'Sprouting',
    'Stewing', 'Sublimating', 'Swirling', 'Synthesizing', 'Tempering',
    'Thinking', 'Tinkering', 'Tomfoolering', 'Transfiguring', 'Transmuting',
    'Undulating', 'Unfurling', 'Vibing', 'Wandering', 'Warping',
    'Whatchamacalliting', 'Whirlpooling', 'Whisking', 'Wibbling',
    'Working', 'Wrangling', 'Zesting', 'Zigzagging',
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

  // Render all items — no windowing. CSS content-visibility handles render performance.
  let visibleItems = $derived(displayItems);
  let hiddenCount = $derived(0);

  let messagesEl = $state(null);
  let isAtBottom = $state(true);
  let isAtTop = $state(false);
  let showScrollButtons = $state(false);

  function scrollToBottom() {
    if (!messagesEl || !isAtBottom) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function jumpToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  function jumpToTop() {
    if (!messagesEl) return;
    messagesEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Throttled scroll handler — max once per frame
  let scrollTicking = false;
  function handleScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      if (!messagesEl) return;
      const { scrollTop, scrollHeight, clientHeight } = messagesEl;
      isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      isAtTop = scrollTop < 100;
      showScrollButtons = scrollHeight > clientHeight * 2; // only show if content is scrollable
    });
  }

  // Scroll to bottom when history finishes loading
  $effect(() => {
    if (!loadingHistory && messages.length > 0) {
      isAtBottom = true;
      setTimeout(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 50);
    }
  });

  // Auto-scroll on new messages — only if at bottom
  let lastMsgCount = 0;
  $effect(() => {
    const count = messages.length;
    if (count > lastMsgCount && isAtBottom) {
      requestAnimationFrame(scrollToBottom);
    }
    lastMsgCount = count;
  });

  // Auto-scroll during streaming — throttled to avoid jank
  let streamScrollTimer;
  $effect(() => {
    if (streamingText && isAtBottom) {
      if (!streamScrollTimer) {
        streamScrollTimer = setTimeout(() => {
          streamScrollTimer = null;
          scrollToBottom();
        }, 80);
      }
    }
    return () => { if (streamScrollTimer) { clearTimeout(streamScrollTimer); streamScrollTimer = null; } };
  });

  $effect(() => {
    if (thinking.active && isAtBottom) scrollToBottom();
  });
</script>

<div class="message-list-wrap" class:compact>
<div class="message-list" class:compact bind:this={messagesEl} onscroll={handleScroll}>
  {#if loadingHistory}
    <div class="skeleton-loading">
      <div class="skeleton-row user">
        <div class="skeleton-block" style="width: 45%; height: 32px"></div>
      </div>
      <div class="skeleton-row assistant">
        <div class="skeleton-block" style="width: 80%; height: 16px"></div>
        <div class="skeleton-block" style="width: 65%; height: 16px"></div>
        <div class="skeleton-block" style="width: 40%; height: 16px"></div>
      </div>
      <div class="skeleton-row user">
        <div class="skeleton-block" style="width: 55%; height: 32px"></div>
      </div>
      <div class="skeleton-row assistant">
        <div class="skeleton-block" style="width: 70%; height: 16px"></div>
        <div class="skeleton-block" style="width: 90%; height: 16px"></div>
        <div class="skeleton-block" style="width: 50%; height: 16px"></div>
      </div>
      <div class="skeleton-row user">
        <div class="skeleton-block" style="width: 35%; height: 32px"></div>
      </div>
    </div>
  {/if}


  {#each visibleItems as item, i (item._key || item.uuid || item.toolId || item.requestId || 'i' + i)}
    <div class="msg-item" class:streaming-msg={item.type === 'assistant' && item.streaming} data-key={item._key || item.toolId || item.requestId || ''}>
    {#if item.type === 'user'}
      <UserMessage text={item.text} images={item.images} pastes={item.pastes} documents={item.documents} documentCount={item.documentCount || 0} documentNames={item.documentNames} imageCount={item.imageCount || 0} {compact} />
    {:else if item.type === 'assistant'}
      <AssistantMessage text={item.text} finalized={item.finalized} {compact} />
    {:else if item.type === 'system' || item.type === 'info'}
      <SystemMessage text={item.text} isError={item.isError} {compact} />
    {:else if item.type === 'tool_group'}
      <ToolGroup tools={item.tools} {compact} {onStopAgent} />
    {:else if item.type === 'tool'}
      <ToolItem name={item.name} status={item.status} input={item.input} output={item.output} subtitle={item.subtitle} subTools={item.subTools} toolId={item.toolId} summary={item.summary} usage={item.usage} {compact} {onStopAgent} />
    {:else if item.type === 'task_widget'}
      <TaskWidget {compact} items={taskItems} />
    {:else if item.type === 'thinking'}
      <ThinkingBlock text={item.text} duration={item.duration} {compact} />
    {:else if item.type === 'turn_meta'}
      <TurnMeta cost={item.cost} duration={item.duration} usage={item.usage} {compact} />
    {:else if item.type === 'permission'}
      <PermissionRequest
        requestId={item.requestId}
        toolName={item.toolName}
        input={item.input}
        inputSummary={item.inputSummary}
        decisionReason={item.decisionReason}
        resolved={item.resolved}
        decision={item.decision}
        {compact}
        {onPermissionRespond}
      />
    {:else if item.type === 'ask_user'}
      <AskUser requestId={item.requestId} question={item.question} questions={item.questions} answered={item.answered} {compact} />
    {:else if item.type === 'suggestions' && !item._dismissed}
      <div class="suggestion-chips" class:compact>
        {#each item.items as suggestion}
          <button class="suggestion-chip" onclick={() => onSend && onSend(suggestion)}>{suggestion}</button>
        {/each}
        <button class="suggestion-dismiss" onclick={() => { item._dismissed = true; }} title="Dismiss">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    {/if}
    </div>
  {/each}

  {#if processing}
    <div class="msg-item">
    {#if planMode}
      <div class="plan-mode-banner" class:compact>
        <svg class="plan-mode-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
        <span class="plan-mode-label">Plan Mode</span>
      </div>
    {/if}
    <div class="live-status" class:compact>
      {#if planMode}<span class="live-status-badge plan-badge">PLAN</span>{/if}
      {#if runningAgentCount > 1}
        <span class="live-status-badge">{runningAgentCount} agents</span>
      {/if}
      {#if activity}
        <span class="live-status-wave">
          {#each activity.split('') as char, i}
            <span style="animation-delay: {i * 0.03}s">{char}</span>
          {/each}
        </span>
      {:else}
        <span class="live-status-wave">
          {#each (thinkingVerb + '...').split('') as char, i}
            <span style="animation-delay: {i * 0.04}s">{char}</span>
          {/each}
        </span>
      {/if}
    </div>
    </div>
  {/if}
</div>
{#if showScrollButtons && !isAtBottom}
  <div class="scroll-buttons">
    <button class="scroll-btn" onclick={jumpToBottom} title="Scroll to bottom">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/></svg>
    </button>
  </div>
{:else if showScrollButtons && isAtBottom && !isAtTop}
  <div class="scroll-buttons">
    <button class="scroll-btn" onclick={jumpToTop} title="Scroll to top">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
    </button>
  </div>
{/if}
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

  .scroll-buttons {
    position: absolute;
    right: 20px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 5;
  }

  .scroll-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--text-muted);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(var(--shadow-rgb), 0.2);
    transition: all 0.15s;
    padding: 0;
  }

  .scroll-btn:hover {
    background: var(--bg-raised);
    color: var(--accent);
    border-color: var(--accent-25);
    transform: scale(1.1);
  }

  .scroll-btn:active {
    transform: scale(0.95);
  }

  .compact .scroll-buttons {
    right: 10px;
    bottom: 8px;
    gap: 4px;
  }

  .compact .scroll-btn {
    width: 28px;
    height: 28px;
  }

  .compact .scroll-btn svg {
    width: 12px;
    height: 12px;
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .message-list.compact {
    padding: 14px 14px 10px;
    gap: 4px;
  }

  .msg-item {
    max-width: var(--content-width);
    animation: msgFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    width: 100%;
    align-self: center;
    box-sizing: border-box;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .load-earlier-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0 12px;
    min-height: 48px;
  }

  .load-earlier-spinner {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--accent);
    font-size: 12px;
    font-family: 'SF Mono', Menlo, monospace;
    animation: fadeIn 0.2s ease;
  }

  .le-ring {
    width: 18px;
    height: 18px;
    border: 2px solid var(--accent-20);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .load-earlier-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dimmer);
    font-size: 11px;
    opacity: 0.5;
    transition: opacity 0.2s;
  }

  .load-earlier-zone:hover .load-earlier-hint {
    opacity: 1;
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

  .message-list { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .message-list:hover { scrollbar-color: rgba(var(--overlay-rgb), 0.10) transparent; }
  .message-list::-webkit-scrollbar { width: 6px; }
  .message-list::-webkit-scrollbar-track { background: transparent; }
  .message-list::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; transition: background 0.3s; }
  .message-list:hover::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb), 0.10); }
  .message-list::-webkit-scrollbar-thumb:hover { background: rgba(var(--overlay-rgb), 0.18); }

  .message-list.compact::-webkit-scrollbar { width: 5px; }
  .message-list.compact::-webkit-scrollbar-thumb { background: transparent; }
  .message-list.compact:hover::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb),0.08); }
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
    animation: statusPulse 1.6s ease-in-out infinite;
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

  /* ─── Plan mode banner ─── */
  .plan-mode-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0 0;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.10), rgba(139, 92, 246, 0.10));
    border: 1px solid rgba(99, 102, 241, 0.25);
    border-radius: 6px;
    animation: fadeIn 0.2s ease;
  }

  .plan-mode-banner.compact {
    padding: 4px 10px;
    margin: 2px 0 0;
  }

  .plan-mode-icon {
    color: rgb(129, 120, 240);
    flex-shrink: 0;
  }

  .plan-mode-banner.compact .plan-mode-icon {
    width: 12px;
    height: 12px;
  }

  .plan-mode-label {
    font-size: 12px;
    font-weight: 600;
    color: rgb(129, 120, 240);
    font-family: 'SF Mono', 'Fira Code', monospace;
    letter-spacing: 0.3px;
  }

  .plan-mode-banner.compact .plan-mode-label {
    font-size: 11px;
  }

  .plan-badge {
    background: rgba(99, 102, 241, 0.15) !important;
    color: rgb(129, 120, 240) !important;
    font-size: 9px !important;
    letter-spacing: 0.5px;
  }

  /* ─── Wave animation for live status ─── */
  .live-status-wave {
    display: inline-flex;
    font-size: 12px;
    color: var(--accent);
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .live-status-wave span {
    display: inline-block;
    animation: charWave 2s ease-in-out infinite;
    white-space: pre;
  }

  .live-status.compact .live-status-wave {
    font-size: 11px;
  }

  @keyframes charWave {
    0%, 100% { opacity: 0.5; transform: translateY(0); }
    25% { opacity: 1; transform: translateY(-1.5px); }
    50% { opacity: 0.7; transform: translateY(0); }
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  /* ─── Streaming message reveal effect ─── */
  .streaming-msg {
    animation: none;
  }

  /* Subtle reveal — avoid flashing on rapid deltas */
  .streaming-msg :global(.md-content > :last-child) {
    animation: textReveal 0.15s ease-out;
  }

  @keyframes textReveal {
    from { opacity: 0.85; }
    to { opacity: 1; }
  }

  @keyframes msgFadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .skeleton-loading {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    max-width: var(--content-width);
    margin: 0 auto;
    width: 100%;
  }

  .skeleton-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .skeleton-row.user {
    align-items: flex-end;
  }

  .skeleton-row.assistant {
    align-items: flex-start;
  }

  .skeleton-block {
    background: linear-gradient(
      90deg,
      rgba(var(--overlay-rgb), 0.04) 0%,
      rgba(var(--overlay-rgb), 0.10) 40%,
      rgba(var(--overlay-rgb), 0.04) 80%
    );
    background-size: 200% 100%;
    border-radius: 8px;
    animation: skeletonShimmer 1.8s ease-in-out infinite;
  }

  @keyframes skeletonShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ─── Suggestion chips ─── */
  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 0;
  }

  .suggestion-chips.compact {
    gap: 6px;
    padding: 6px 0;
  }

  .suggestion-chip {
    font-size: 12px;
    color: var(--accent);
    background: var(--accent-8);
    border: 1px solid var(--accent-20);
    border-radius: 16px;
    padding: 5px 14px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
    line-height: 1.3;
  }

  .suggestion-chips.compact .suggestion-chip {
    font-size: 11px;
    padding: 4px 12px;
    border-radius: 14px;
  }

  .suggestion-chip:hover {
    background: var(--accent-15);
    border-color: var(--accent-30);
  }

  .suggestion-chip:active {
    transform: scale(0.97);
  }

  .suggestion-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 50%;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: all 0.15s;
    align-self: center;
  }

  .suggestion-dismiss:hover {
    color: var(--text-muted);
    background: rgba(var(--overlay-rgb), 0.06);
    border-color: rgba(var(--overlay-rgb), 0.12);
  }
</style>
