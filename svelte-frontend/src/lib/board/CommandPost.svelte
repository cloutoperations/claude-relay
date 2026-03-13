<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard } from '../../stores/board.svelte.js';
  import ActivityStream from './ActivityStream.svelte';

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });
</script>

<div class="command-post">
  {#if boardLoading.value && !boardData.value}
    <div class="cp-loading">
      <div class="cp-spinner"></div>
      <span>Loading workspace...</span>
    </div>
  {:else if boardData.value}
    <ActivityStream />
  {/if}
</div>

<style>
  .command-post {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .cp-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dimmer);
    font-size: 14px;
  }

  .cp-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

</style>
