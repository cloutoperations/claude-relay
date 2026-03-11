<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard, focusedArea } from '../../stores/board.js';
  import { sessions } from '../../stores/sessions.js';
  import { projectInfo } from '../../stores/chat.js';
  import AreaZone from './AreaZone.svelte';
  import ActivityStream from './ActivityStream.svelte';
  import CockpitStrip from './CockpitStrip.svelte';

  onMount(() => {
    if (!$boardData) fetchBoard();

    function handleEsc(e) {
      if (e.key === 'Escape' && $focusedArea) {
        focusedArea.set(null);
      }
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  });

  // Sort areas by weight (most active first)
  let sortedAreas = $derived.by(() => {
    if (!$boardData) return [];
    return [...$boardData.areas].sort((a, b) => areaWeight(b) - areaWeight(a));
  });

  function areaWeight(area) {
    let sessionCount = (area.areaSessions?.length || 0);
    let processingCount = (area.areaSessions?.filter(s => s.isProcessing).length || 0);
    for (const p of area.projects) {
      sessionCount += p.sessions.length;
      processingCount += p.sessions.filter(s => s.isProcessing).length;
      for (const sub of p.subProjects) {
        if (sub.sessions) {
          sessionCount += sub.sessions.length;
          processingCount += sub.sessions.filter(s => s.isProcessing).length;
        }
      }
    }
    return area.projects.length * 2
      + sessionCount * 3
      + processingCount * 5
      + (processingCount > 0 ? 2 : 0)
      + ((area.presentState || area.desiredState) ? 1 : 0);
  }

  // Grid sizing class based on weight
  function areaGridClass(area) {
    const w = areaWeight(area);
    if (w >= 9) return 'grid-large';
    if (w >= 4) return 'grid-medium';
    return 'grid-small';
  }

  let focused = $derived($focusedArea);
  let focusedAreaData = $derived.by(() => {
    if (!focused || !$boardData) return null;
    return $boardData.areas.find(a => a.name === focused) || null;
  });
  let otherAreas = $derived.by(() => {
    if (!focused) return [];
    return sortedAreas.filter(a => a.name !== focused);
  });
</script>

<div class="command-post">
  {#if $boardLoading && !$boardData}
    <div class="cp-loading">
      <div class="cp-spinner"></div>
      <span>Loading workspace...</span>
    </div>
  {:else if $boardData}
    <!-- Cockpit strip at top -->
    <CockpitStrip />

    {#if focused && focusedAreaData}
      <!-- ZOOMED MODE: focused area + compact pills for others -->
      <div class="cp-zoomed">
        <!-- Compact strip at top -->
        <div class="compact-strip">
          {#each otherAreas as area (area.name)}
            <AreaZone
              {area}
              compact={true}
              onFocus={() => focusedArea.set(area.name)}
            />
          {/each}
        </div>

        <!-- Focused area takes rest of space -->
        <AreaZone
          area={focusedAreaData}
          focused={true}
          onUnfocus={() => focusedArea.set(null)}
        />
      </div>
    {:else}
      <!-- OVERVIEW MODE: grid of all areas -->
      <div class="cp-overview">
        <div class="cp-grid">
          {#each sortedAreas as area (area.name)}
            <div class="grid-cell {areaGridClass(area)}">
              <AreaZone
                {area}
                onFocus={() => focusedArea.set(area.name)}
              />
            </div>
          {/each}
        </div>

        {#if $boardData.looseSessions?.length > 0}
          <div class="loose-bar">
            <span class="loose-label">{$boardData.looseSessions.length} untagged sessions</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Activity stream at bottom -->
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
  }

  .cp-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #6b6760;
    font-size: 14px;
  }

  .cp-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid #3e3c37;
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Overview mode */
  .cp-overview {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .cp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .grid-cell.grid-large {
    grid-column: span 2;
  }

  .grid-cell.grid-medium {
    /* default 1 col span */
  }

  .grid-cell.grid-small {
    /* default 1 col span */
  }

  /* On smaller screens, don't span 2 */
  @media (max-width: 700px) {
    .grid-cell.grid-large {
      grid-column: span 1;
    }
  }

  .loose-bar {
    text-align: center;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .loose-label {
    font-size: 12px;
    color: #6b6760;
  }

  /* Zoomed mode */
  .cp-zoomed {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .compact-strip {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    overflow-x: auto;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    scrollbar-width: none;
  }

  .compact-strip::-webkit-scrollbar {
    display: none;
  }
</style>
