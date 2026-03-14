<script>
  import { createAgent } from '../../stores/agents.svelte.js';
  import { closeTab } from '../../stores/tabs.svelte.js';

  let selectedType = $state(null);
  let name = $state('');

  // Ralph fields
  let promptPath = $state('PROMPT.md');
  let judgePath = $state('JUDGE.md');
  let maxIterations = $state(10);

  // Cron fields
  let cronExpression = $state('0 8 * * *');
  let cronPrompt = $state('');

  // One-shot fields
  let taskPrompt = $state('');

  function handleCreate() {
    if (!name.trim()) return;
    const config = { name: name.trim() };
    if (selectedType === 'ralph') {
      config.promptPath = promptPath;
      config.judgePath = judgePath;
      config.maxIterations = maxIterations;
    } else if (selectedType === 'cron') {
      config.expression = cronExpression;
      config.prompt = cronPrompt;
    } else {
      config.prompt = taskPrompt;
    }
    createAgent(selectedType, config);
    closeTab('__agent_new__');
  }

  const CRON_PRESETS = [
    { label: 'Every morning at 8am', value: '0 8 * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every Monday at 9am', value: '0 9 * * 1' },
    { label: 'Every day at midnight', value: '0 0 * * *' },
  ];
</script>

<div class="create-tab">
  {#if !selectedType}
    <!-- Step 1: Pick a type -->
    <div class="create-header">
      <h2>Create an Agent</h2>
      <p class="create-subtitle">Agents run in the background — code, check, schedule, repeat.</p>
    </div>

    <div class="type-cards">
      <!-- Ralph Loop -->
      <button class="type-card" onclick={() => selectedType = 'ralph'}>
        <div class="type-card-icon">&#x27F3;</div>
        <div class="type-card-content">
          <h3>Ralph Loop</h3>
          <p>Autonomous coding loop. You write a task and success criteria — the agent keeps trying until it passes.</p>
          <div class="type-card-how">
            <span class="how-label">How it works:</span>
            Write a <code>PROMPT.md</code> (what to build) and a <code>JUDGE.md</code> (how to know it's done). The agent codes, commits, then a judge checks the diff. Fail? Fresh session, try again. Only the code survives between attempts.
          </div>
          <div class="type-card-example">
            <span class="example-label">Example:</span>
            "Refactor the auth module to use JWT" with judge criteria "all tests pass and no session tokens in cookies"
          </div>
        </div>
      </button>

      <!-- Cron -->
      <button class="type-card" onclick={() => selectedType = 'cron'}>
        <div class="type-card-icon">&#x23F0;</div>
        <div class="type-card-content">
          <h3>Scheduled Task</h3>
          <p>Runs a prompt on a schedule. Survives logout, restarts, and browser closes.</p>
          <div class="type-card-how">
            <span class="how-label">How it works:</span>
            Set a cron schedule and a prompt. The daemon fires it automatically — creates a fresh session each time, runs the prompt, done. Results show up in your session list.
          </div>
          <div class="type-card-example">
            <span class="example-label">Example:</span>
            "Every morning at 8am, check open GitHub issues and draft PRs for any marked urgent"
          </div>
        </div>
      </button>

      <!-- One-shot -->
      <button class="type-card" onclick={() => selectedType = 'oneshot'}>
        <div class="type-card-icon">&#x25CF;</div>
        <div class="type-card-content">
          <h3>Background Task</h3>
          <p>Fire-and-forget. Runs once in the background while you work on other things.</p>
          <div class="type-card-how">
            <span class="how-label">How it works:</span>
            Give it a prompt, hit go. It runs as a background session — you get a notification when it's done. Good for long tasks you don't want to babysit.
          </div>
          <div class="type-card-example">
            <span class="example-label">Example:</span>
            "Write unit tests for every function in lib/utils/"
          </div>
        </div>
      </button>
    </div>

  {:else}
    <!-- Step 2: Configure -->
    <div class="create-header">
      <button class="back-btn" onclick={() => selectedType = null}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>
      <h2>
        {#if selectedType === 'ralph'}New Ralph Loop
        {:else if selectedType === 'cron'}New Scheduled Task
        {:else}New Background Task
        {/if}
      </h2>
    </div>

    <div class="config-form">
      <div class="form-field">
        <label class="form-label">Name</label>
        <input
          type="text"
          class="form-input"
          placeholder={selectedType === 'ralph' ? 'e.g. auth-refactor' : selectedType === 'cron' ? 'e.g. daily-pr-check' : 'e.g. write-tests'}
          bind:value={name}
          onkeydown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
        />
        <span class="form-hint">A short name to identify this agent in the sidebar</span>
      </div>

      {#if selectedType === 'ralph'}
        <div class="form-field">
          <label class="form-label">Task file</label>
          <input type="text" class="form-input" bind:value={promptPath} />
          <span class="form-hint">Markdown file describing what the agent should build. Relative to project root.</span>
        </div>
        <div class="form-field">
          <label class="form-label">Judge file</label>
          <input type="text" class="form-input" bind:value={judgePath} />
          <span class="form-hint">Markdown file with pass/fail criteria. The judge reads the git diff after each attempt.</span>
        </div>
        <div class="form-field">
          <label class="form-label">Max iterations</label>
          <input type="number" class="form-input form-input-short" bind:value={maxIterations} min="1" max="50" />
          <span class="form-hint">Stop after this many attempts even if the judge never passes.</span>
        </div>
      {/if}

      {#if selectedType === 'cron'}
        <div class="form-field">
          <label class="form-label">Schedule</label>
          <input type="text" class="form-input" bind:value={cronExpression} />
          <div class="cron-presets">
            {#each CRON_PRESETS as preset}
              <button class="cron-preset" class:active={cronExpression === preset.value} onclick={() => cronExpression = preset.value}>
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Prompt</label>
          <textarea class="form-textarea" bind:value={cronPrompt} rows="4" placeholder="What should this agent do each time it runs?"></textarea>
        </div>
      {/if}

      {#if selectedType === 'oneshot'}
        <div class="form-field">
          <label class="form-label">Prompt</label>
          <textarea class="form-textarea" bind:value={taskPrompt} rows="6" placeholder="What should this agent do?"></textarea>
        </div>
      {/if}

      <div class="form-actions">
        <button class="cancel-btn" onclick={() => closeTab('__agent_new__')}>Cancel</button>
        <button class="create-btn" onclick={handleCreate} disabled={!name.trim()}>
          {#if selectedType === 'ralph'}Start Ralph Loop
          {:else if selectedType === 'cron'}Create Schedule
          {:else}Run Task
          {/if}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .create-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 32px;
    overflow-y: auto;
    max-width: 700px;
  }

  .create-header {
    margin-bottom: 28px;
  }

  .create-header h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .create-subtitle {
    margin: 6px 0 0;
    font-size: 14px;
    color: var(--text-muted);
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    margin-bottom: 12px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .back-btn:hover {
    color: var(--text);
    background: rgba(var(--overlay-rgb), 0.06);
  }

  /* Type cards */
  .type-cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .type-card {
    display: flex;
    gap: 16px;
    padding: 20px;
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 8px;
    background: rgba(var(--overlay-rgb), 0.02);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .type-card:hover {
    border-color: var(--accent);
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .type-card-icon {
    font-size: 28px;
    flex-shrink: 0;
    width: 40px;
    text-align: center;
    padding-top: 2px;
  }

  .type-card-content {
    flex: 1;
    min-width: 0;
  }

  .type-card-content h3 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .type-card-content p {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .type-card-how, .type-card-example {
    font-size: 12px;
    color: var(--text-dimmer);
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .how-label, .example-label {
    font-weight: 600;
    color: var(--text-muted);
  }

  .type-card-content code {
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

  /* Config form */
  .config-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .form-input {
    padding: 8px 12px;
    border: 1px solid rgba(var(--overlay-rgb), 0.15);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    outline: none;
  }

  .form-input:focus {
    border-color: var(--accent);
  }

  .form-input-short {
    max-width: 100px;
  }

  .form-textarea {
    padding: 8px 12px;
    border: 1px solid rgba(var(--overlay-rgb), 0.15);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    outline: none;
    resize: vertical;
    font-family: inherit;
    line-height: 1.5;
  }

  .form-textarea:focus {
    border-color: var(--accent);
  }

  .form-hint {
    font-size: 12px;
    color: var(--text-dimmer);
  }

  .cron-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .cron-preset {
    padding: 4px 10px;
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 12px;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .cron-preset:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .cron-preset.active {
    background: rgba(var(--overlay-rgb), 0.1);
    border-color: var(--accent);
    color: var(--text);
  }

  .form-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding-top: 8px;
  }

  .cancel-btn {
    padding: 8px 16px;
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    color: var(--text);
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .create-btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.1s;
  }

  .create-btn:hover {
    opacity: 0.9;
  }

  .create-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
