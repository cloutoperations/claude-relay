<script>
  import { escapeHtml } from '../../utils/markdown.js';

  let { text = '', images = null, pastes = null } = $props();
</script>

<div class="msg-user">
  <div class="bubble" dir="auto">
    {#if images && images.length > 0}
      <div class="bubble-images">
        {#each images as img}
          <img class="bubble-img" src="data:{img.mediaType};base64,{img.data}" alt="Attached" />
        {/each}
      </div>
    {/if}

    {#if pastes && pastes.length > 0}
      <div class="bubble-pastes">
        {#each pastes as paste}
          <div class="bubble-paste">
            <span class="bubble-paste-preview">{paste.substring(0, 60).replace(/\n/g, ' ')}{paste.length > 60 ? '...' : ''}</span>
            <span class="bubble-paste-label">PASTED</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if text}
      <span>{text}</span>
    {/if}
  </div>
</div>

<style>
  .msg-user {
    display: flex;
    justify-content: flex-end;
    margin: 8px 0;
  }

  .bubble {
    max-width: 85%;
    padding: 10px 14px;
    background: #35332f;
    border-radius: 18px 18px 4px 18px;
    font-size: 14px;
    line-height: 1.5;
    color: #e8e5de;
    word-wrap: break-word;
  }

  .bubble-images {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .bubble-img {
    max-width: 200px;
    max-height: 200px;
    border-radius: 8px;
    cursor: pointer;
  }

  .bubble-pastes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }

  .bubble-paste {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .bubble-paste-preview {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #908b81;
  }

  .bubble-paste-label {
    font-size: 10px;
    font-weight: 600;
    color: #6d6860;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
