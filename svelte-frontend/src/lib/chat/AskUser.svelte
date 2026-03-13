<script>
  import { send } from '../../stores/ws.svelte.js';

  let { requestId, question = '', answered = false } = $props();
  let response = $state('');

  function submit() {
    if (!response.trim()) return;
    send({ type: 'ask_user_response', requestId, text: response.trim() });
    response = '';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="ask-user" class:answered>
  <div class="ask-header">
    <span class="ask-icon">?</span>
    <span class="ask-title">Question</span>
  </div>
  <div class="ask-question">{question}</div>
  {#if !answered}
    <div class="ask-input-row">
      <input
        type="text"
        class="ask-input"
        bind:value={response}
        onkeydown={handleKeydown}
        placeholder="Type your answer..."
      />
      <button class="ask-submit" onclick={submit}>Send</button>
    </div>
  {:else}
    <div class="ask-answered">Answered</div>
  {/if}
</div>

<style>
  .ask-user {
    margin: 8px 0;
    background: var(--bg-alt);
    border: 1px solid #4a90d9;
    border-radius: 8px;
    padding: 12px;
  }

  .ask-user.answered {
    border-color: var(--border);
    opacity: 0.7;
  }

  .ask-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .ask-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #4a90d9;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
  }

  .ask-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .ask-question {
    font-size: 14px;
    color: var(--text);
    margin-bottom: 10px;
    line-height: 1.5;
  }

  .ask-input-row {
    display: flex;
    gap: 8px;
  }

  .ask-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-deeper);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    outline: none;
  }

  .ask-input:focus {
    border-color: #4a90d9;
  }

  .ask-submit {
    padding: 8px 16px;
    background: #4a90d9;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
  }

  .ask-submit:hover {
    filter: brightness(1.1);
  }

  .ask-answered {
    font-size: 12px;
    color: var(--text-dimmer);
    font-style: italic;
  }
</style>
