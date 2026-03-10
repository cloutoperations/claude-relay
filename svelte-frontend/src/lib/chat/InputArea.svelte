<script>
  import { sendMessage, stopProcessing, processing } from '../../stores/chat.js';
  import { connected } from '../../stores/ws.js';

  let inputText = $state('');
  let textareaEl;

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
  }

  function handleSend() {
    if ($processing) {
      if (inputText.trim()) {
        // Continue — send while processing
        sendMessage(inputText.trim());
        inputText = '';
        autoResize();
      } else {
        // Stop
        stopProcessing();
      }
      return;
    }

    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    inputText = '';
    requestAnimationFrame(autoResize);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function getSendLabel() {
    if ($processing) {
      return inputText.trim() ? 'Send' : 'Stop';
    }
    return 'Send';
  }
</script>

<div class="input-area" class:disconnected={!$connected}>
  <div class="input-wrapper">
    <textarea
      bind:this={textareaEl}
      bind:value={inputText}
      oninput={autoResize}
      onkeydown={handleKeydown}
      placeholder={$connected ? 'Message Claude...' : 'Connecting...'}
      disabled={!$connected}
      rows="1"
    ></textarea>
    <div class="input-bottom">
      <div class="input-left">
        <!-- Attach button placeholder -->
      </div>
      <button
        class="send-btn"
        class:stop={$processing && !inputText.trim()}
        onclick={handleSend}
        disabled={!$connected}
      >
        {getSendLabel()}
      </button>
    </div>
  </div>
</div>

<style>
  .input-area {
    padding: 12px 20px 16px;
    border-top: 1px solid #2a2924;
  }

  .input-area.disconnected {
    opacity: 0.5;
    pointer-events: none;
  }

  .input-wrapper {
    background: #2a2924;
    border-radius: 12px;
    border: 1px solid #3e3c37;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .input-wrapper:focus-within {
    border-color: #6d6860;
  }

  textarea {
    width: 100%;
    padding: 12px 14px 4px;
    background: transparent;
    border: none;
    color: #e8e5de;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    outline: none;
    min-height: 24px;
    max-height: 120px;
  }

  textarea::placeholder {
    color: #6d6860;
  }

  .input-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 8px;
  }

  .input-left {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .send-btn {
    padding: 6px 16px;
    background: #da7756;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .send-btn:hover {
    background: #c5673e;
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .send-btn.stop {
    background: #e5534b;
  }

  .send-btn.stop:hover {
    background: #d04440;
  }
</style>
