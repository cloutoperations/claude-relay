<script>
  let { cost = null, duration = null, usage = null, compact = false } = $props();

  const cookingVerbs = [
    'Cooked', 'Baked', 'Sautéed', 'Simmered', 'Brewed', 'Stewed',
    'Whipped up', 'Roasted', 'Grilled', 'Marinated', 'Fermented',
    'Caramelized', 'Seasoned', 'Crafted', 'Forged', 'Conjured',
  ];

  function funDuration(ms) {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return secs + 's';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + 'm ' + s + 's';
  }

  let display = $derived.by(() => {
    const parts = [];
    if (cost != null) parts.push('$' + cost.toFixed(4));
    if (duration != null) {
      const verb = cookingVerbs[Math.floor(duration * 7 % cookingVerbs.length)];
      parts.push(verb + ' in ' + funDuration(duration));
    }
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
  <div class="turn-meta" class:compact>
    <span class="turn-meta-line"></span>
    <span class="turn-meta-text">{display}</span>
    <span class="turn-meta-line"></span>
  </div>
{/if}

<style>
  .turn-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: var(--text-dimmer);
    padding: 4px 0;
    margin: 10px 0 14px;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .turn-meta:hover {
    opacity: 1;
  }

  .turn-meta-line {
    flex: 1;
    height: 1px;
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .turn-meta-text {
    flex-shrink: 0;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
  }

  .turn-meta.compact {
    font-size: 10px;
    margin: 4px 0 8px;
    gap: 8px;
  }

  .turn-meta.compact .turn-meta-text {
    font-size: 9px;
  }
</style>
