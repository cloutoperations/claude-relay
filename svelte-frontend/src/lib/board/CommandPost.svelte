<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard, focusedArea } from '../../stores/board.js';
  import { sessions } from '../../stores/sessions.js';
  import { projectInfo } from '../../stores/chat.js';
  import { cockpitMode } from '../../stores/ui.js';
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

  // Split into active (has processing or recent sessions) vs quiet areas
  let activeAreas = $derived(sortedAreas.filter(a => areaWeight(a) >= 8));
  let quietAreas = $derived(sortedAreas.filter(a => areaWeight(a) < 8));

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

  // Grid sizing class based on weight — only the top 2 areas span 2 cols
  function areaGridClass(area, index) {
    const w = areaWeight(area);
    if (w >= 20 && index < 2) return 'grid-large';
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
    {#if $cockpitMode !== 'docked' && $cockpitMode !== 'floating'}
      <!-- Cockpit is detached (popup/tab) — show restore button -->
      <div class="cockpit-restore">
        <button class="cockpit-restore-btn" onclick={() => cockpitMode.set('docked')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
          </svg>
          Dock Strategy
        </button>
        <button class="cockpit-restore-btn" onclick={() => cockpitMode.set('floating')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          </svg>
          Float
        </button>
      </div>
    {/if}

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
      <!-- OVERVIEW MODE — always side-by-side on widescreen -->
      <div class="cp-split-overview">
        <div class="cp-split-left">
          <CockpitStrip mode="docked" />
        </div>
        <div class="cp-split-right">
          <div class="cp-grid">
            {#each activeAreas as area, i (area.name)}
              <div class="grid-cell {areaGridClass(area, i)}">
                <AreaZone
                  {area}
                  onFocus={() => focusedArea.set(area.name)}
                />
              </div>
            {/each}
          </div>

          {#if quietAreas.length > 0}
            <div class="grid-divider">
              <span class="grid-divider-text">Other areas</span>
            </div>
            <div class="cp-grid cp-grid-quiet">
              {#each quietAreas as area, i (area.name)}
                <div class="grid-cell grid-small">
                  <AreaZone
                    {area}
                    onFocus={() => focusedArea.set(area.name)}
                  />
                </div>
              {/each}
            </div>
          {/if}

          {#if $boardData.looseSessions?.length > 0}
            <div class="loose-bar">
              <span class="loose-label">{$boardData.looseSessions.length} untagged sessions</span>
            </div>
          {/if}
        </div>
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

  /* Overview mode */
  .cp-overview {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .cp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
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

  .grid-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 8px;
    padding: 0 4px;
  }

  .grid-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .grid-divider-text {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .cp-grid-quiet {
    opacity: 0.85;
  }

  .loose-bar {
    text-align: center;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.04);
  }

  .loose-label {
    font-size: 12px;
    color: var(--text-dimmer);
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
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.04);
    scrollbar-width: none;
  }

  .compact-strip::-webkit-scrollbar {
    display: none;
  }

  /* Cockpit restore bar */
  .cockpit-restore {
    display: flex;
    gap: 8px;
    padding: 8px 24px;
    flex-shrink: 0;
  }

  .cockpit-restore-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    font-size: 11px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.03);
    border: 1px dashed rgba(var(--overlay-rgb), 0.1);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .cockpit-restore-btn:hover {
    background: var(--accent-8);
    color: var(--accent);
    border-color: var(--accent-20);
  }

  /* Split layout: strategy left, areas right */
  .cp-split-overview {
    flex: 1;
    display: flex;
    overflow-y: auto;
    padding: 16px;
    gap: 16px;
    align-items: flex-start;
  }

  .cp-split-left {
    flex: 0 0 auto;
    width: min(50%, 1000px);
    min-width: 600px;
  }

  .cp-split-right {
    flex: 1;
    min-width: 0;
  }

  /* On narrower screens, stack vertically */
  @media (max-width: 900px) {
    .cp-split-overview {
      flex-direction: column;
    }
  }

</style>
