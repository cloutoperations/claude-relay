<script>
  import { send } from '../../stores/ws.svelte.js';

  let {
    requestId,
    question = '',
    questions = null,
    answered = false,
    compact = false,
  } = $props();

  let selections = $state({});
  let multiSelections = $state({});
  let otherTexts = $state({});
  let selectedAnswer = $state(null);

  let questionList = $derived(questions && questions.length > 0 ? questions : [{ question }]);
  let isSingleQuestion = $derived(questionList.length === 1);

  function selectOption(qIdx, label, isMulti) {
    if (answered) return;
    if (isMulti) {
      let set = new Set(multiSelections[qIdx] || []);
      if (set.has(label)) set.delete(label); else set.add(label);
      multiSelections = { ...multiSelections, [qIdx]: [...set] };
      otherTexts = { ...otherTexts, [qIdx]: '' };
    } else {
      selections = { ...selections, [qIdx]: label };
      otherTexts = { ...otherTexts, [qIdx]: '' };
      // Single-select with single question: auto-submit
      if (isSingleQuestion) {
        submitAnswers({ [qIdx]: label });
      }
    }
  }

  function handleOtherInput(qIdx, value) {
    otherTexts = { ...otherTexts, [qIdx]: value };
    if (value.trim()) {
      selections = { ...selections, [qIdx]: undefined };
      multiSelections = { ...multiSelections, [qIdx]: [] };
    }
  }

  function handleOtherKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitAll();
    }
  }

  function buildAnswers() {
    let answers = {};
    for (let i = 0; i < questionList.length; i++) {
      const q = questionList[i];
      const isMulti = q.multiSelect || false;
      if (otherTexts[i] && otherTexts[i].trim()) {
        answers[i] = otherTexts[i].trim();
      } else if (isMulti && multiSelections[i] && multiSelections[i].length > 0) {
        answers[i] = multiSelections[i].join(', ');
      } else if (selections[i]) {
        answers[i] = selections[i];
      }
    }
    return answers;
  }

  function submitAll() {
    const answers = buildAnswers();
    if (Object.keys(answers).length === 0) return;
    submitAnswers(answers);
  }

  function submitAnswers(answers) {
    selectedAnswer = answers;
    send({ type: 'ask_user_response', requestId, toolId: requestId, answers });
  }

  function skip() {
    send({ type: 'stop' });
  }

  function isSelected(qIdx, label) {
    const q = questionList[qIdx];
    if (q && q.multiSelect) {
      return (multiSelections[qIdx] || []).includes(label);
    }
    return selections[qIdx] === label;
  }

  function getAnswerDisplay(qIdx) {
    if (!selectedAnswer) return null;
    return selectedAnswer[qIdx] || null;
  }
</script>

<div class="ask-user" class:answered class:compact>
  <div class="ask-header">
    <span class="ask-icon">?</span>
    <span class="ask-title">Question</span>
  </div>

  {#each questionList as q, qIdx}
    <div class="ask-question-block">
      {#if q.header}
        <div class="ask-section-header">{q.header}</div>
      {/if}
      <div class="ask-question-text">{q.question || ''}</div>

      {#if answered}
        {#if getAnswerDisplay(qIdx)}
          <div class="ask-selected-answer">{getAnswerDisplay(qIdx)}</div>
        {/if}
      {:else if q.options && q.options.length > 0}
        <div class="ask-options">
          {#each q.options as opt}
            <button
              class="ask-option"
              class:selected={isSelected(qIdx, opt.label)}
              class:has-preview={!!opt.preview}
              onclick={() => selectOption(qIdx, opt.label, q.multiSelect || false)}
            >
              <span class="option-label">{opt.label}</span>
              {#if opt.description}
                <span class="option-desc">{opt.description}</span>
              {/if}
              {#if opt.preview}
                <pre class="option-preview">{opt.preview}</pre>
              {/if}
            </button>
          {/each}
        </div>

        <div class="ask-other-row">
          <input
            type="text"
            class="ask-other-input"
            placeholder="Other..."
            value={otherTexts[qIdx] || ''}
            oninput={(e) => handleOtherInput(qIdx, e.target.value)}
            onkeydown={handleOtherKeydown}
          />
        </div>
      {:else}
        <div class="ask-input-row">
          <input
            type="text"
            class="ask-input"
            value={otherTexts[qIdx] || ''}
            oninput={(e) => handleOtherInput(qIdx, e.target.value)}
            onkeydown={handleOtherKeydown}
            placeholder="Type your answer..."
          />
        </div>
      {/if}
    </div>
  {/each}

  {#if !answered}
    <div class="ask-actions">
      {#if !isSingleQuestion || questionList.some(q => q.multiSelect)}
        <button class="ask-submit" onclick={submitAll}>Submit</button>
      {:else if !questionList[0]?.options || questionList[0]?.options.length === 0}
        <button class="ask-submit" onclick={submitAll}>Send</button>
      {/if}
      <button class="ask-skip" onclick={skip}>Skip</button>
    </div>
  {:else}
    <div class="ask-answered-label">Answered</div>
  {/if}
</div>

<style>
  .ask-user {
    margin: 8px 0;
    background: var(--bg-alt);
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 12px;
    animation: askSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes askSlideIn {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .ask-user.answered {
    border-color: var(--border);
    opacity: 0.7;
  }

  .ask-user.compact {
    padding: 10px;
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
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .ask-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .ask-question-block {
    margin-bottom: 10px;
  }

  .ask-question-block:last-child {
    margin-bottom: 0;
  }

  .ask-section-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 4px;
  }

  .ask-question-text {
    font-size: 14px;
    color: var(--text);
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .ask-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .ask-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-deeper);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .ask-option:hover {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.08);
  }

  .ask-option.selected {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.15);
    color: var(--accent);
  }

  .option-label {
    font-weight: 500;
  }

  .option-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.3;
  }

  .ask-option.selected .option-desc {
    color: var(--accent);
    opacity: 0.8;
  }

  .option-preview {
    width: 100%;
    margin-top: 4px;
    padding: 6px 8px;
    background: var(--code-bg);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-x: auto;
  }

  .ask-option.has-preview {
    width: 100%;
  }

  .ask-other-row {
    margin-bottom: 4px;
  }

  .ask-other-input,
  .ask-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-deeper);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .ask-other-input:focus,
  .ask-input:focus {
    border-color: var(--accent);
  }

  .ask-input-row {
    display: flex;
    gap: 8px;
  }

  .ask-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .ask-submit {
    padding: 6px 16px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: var(--text-on-accent);
    font-size: 13px;
    cursor: pointer;
  }

  .ask-submit:hover {
    filter: brightness(1.1);
  }

  .ask-skip {
    padding: 6px 16px;
    background: var(--bg-deeper);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .ask-skip:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .ask-selected-answer {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
  }

  .ask-answered-label {
    font-size: 12px;
    color: var(--text-dimmer);
    font-style: italic;
    margin-top: 6px;
  }
</style>
