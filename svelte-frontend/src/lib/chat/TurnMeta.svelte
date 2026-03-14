<script>
  let { cost = null, duration = null, usage = null, compact = false } = $props();

  let display = $derived.by(() => {
    const parts = [];
    if (cost != null) parts.push('$' + cost.toFixed(4));
    if (duration != null) parts.push((duration / 1000).toFixed(1) + 's');
    if (usage) {
      const inTok = usage.input_tokens || usage.inputTokens || 0;
      const outTok = usage.output_tokens || usage.outputTokens || 0;
      const cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
      const totalIn = inTok + cacheRead + cacheWrite;
      if (totalIn || outTok) {
        let tokenStr = formatTokens(totalIn) + ' in / ' + formatTokens(outTok) + ' out';
        if (cacheRead > 0) tokenStr += ' (' + Math.round(cacheRead / totalIn * 100) + '% cached)';
        parts.push(tokenStr);
      }
    }
    return parts.join(' \u00b7 ');
  });

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
</script>

{#if display}
  <div class="turn-meta" class:compact>{display}</div>
{/if}

<style>
  .turn-meta {
    font-size: 12px;
    color: var(--text-dimmer);
    padding: 8px 0 2px;
    margin: 8px 0 12px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.08);
  }

  .turn-meta.compact {
    font-size: 11px;
    margin: 2px 0 8px;
  }
</style>
