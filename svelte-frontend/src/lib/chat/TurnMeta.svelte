<script>
  let { cost = null, duration = null, compact = false } = $props();

  let display = $derived.by(() => {
    const parts = [];
    if (cost != null) parts.push('$' + cost.toFixed(4));
    if (duration != null) parts.push((duration / 1000).toFixed(1) + 's');
    return parts.join(' \u00b7 ');
  });
</script>

{#if display}
  <div class="turn-meta" class:compact>{display}</div>
{/if}

<style>
  .turn-meta {
    font-size: 12px;
    color: var(--text-dimmer);
    padding: 2px 0;
    margin: 4px 0 16px;
  }

  .turn-meta.compact {
    font-size: 11px;
    margin: 2px 0 8px;
  }
</style>
