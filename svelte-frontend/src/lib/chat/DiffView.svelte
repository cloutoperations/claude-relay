<script>
  import hljs, { getLang } from './hljs-setup.js';

  let { oldStr = '', newStr = '', filePath = '' } = $props();

  // LCS-based diff
  function diffLines(a, b) {
    const m = a.length, n = b.length;
    const t = new Array((m + 1) * (n + 1)).fill(0);
    const w = n + 1;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        t[i * w + j] = a[i - 1] === b[j - 1]
          ? t[(i - 1) * w + (j - 1)] + 1
          : Math.max(t[(i - 1) * w + j], t[i * w + (j - 1)]);
      }
    }
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: 'equal', oldLine: i, newLine: j, text: a[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || t[i * w + (j - 1)] >= t[(i - 1) * w + j])) {
        ops.push({ type: 'add', oldLine: null, newLine: j, text: b[j - 1] });
        j--;
      } else {
        ops.push({ type: 'remove', oldLine: i, newLine: null, text: a[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return ops;
  }

  function highlightLines(src, lang) {
    if (!lang || !src) return null;
    try {
      return hljs.highlight(src, { language: lang }).value.split('\n');
    } catch { return null; }
  }

  let diff = $derived.by(() => {
    const aLines = oldStr ? oldStr.split('\n') : [];
    const bLines = newStr ? newStr.split('\n') : [];
    const ops = diffLines(aLines, bLines);
    const lang = getLang(filePath);
    const oldHL = highlightLines(oldStr, lang);
    const newHL = highlightLines(newStr, lang);

    return ops.map(op => {
      let html = '';
      if (op.type === 'equal' || op.type === 'remove') {
        if (oldHL && op.oldLine != null && op.oldLine <= oldHL.length) {
          html = oldHL[op.oldLine - 1];
        }
      }
      if (op.type === 'add') {
        if (newHL && op.newLine != null && op.newLine <= newHL.length) {
          html = newHL[op.newLine - 1];
        }
      }
      return { ...op, html: html || null };
    });
  });

  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
  }
</script>

<div class="diff-view">
  <div class="diff-header">
    <span class="diff-path">{shortPath(filePath)}</span>
    <span class="diff-stats">
      <span class="diff-add">+{diff.filter(d => d.type === 'add').length}</span>
      <span class="diff-rm">-{diff.filter(d => d.type === 'remove').length}</span>
    </span>
  </div>
  <div class="diff-body">
    <table class="diff-table">
      <tbody>
        {#each diff as op}
          <tr class="diff-row diff-{op.type}">
            <td class="diff-ln diff-ln-old">{op.oldLine ?? ''}</td>
            <td class="diff-ln diff-ln-new">{op.newLine ?? ''}</td>
            <td class="diff-marker">{op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '}</td>
            <td class="diff-code">
              {#if op.html}
                {@html op.html}
              {:else}
                {op.text}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .diff-view {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #3e3c37;
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #2a2924;
    border-bottom: 1px solid #3e3c37;
    font-size: 11px;
  }

  .diff-path {
    color: #908b81;
  }

  .diff-stats {
    display: flex;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
  }

  .diff-add { color: #5cb85c; }
  .diff-rm { color: #e5534b; }

  .diff-body {
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
    background: #1a1918;
  }

  .diff-table {
    width: 100%;
    border-collapse: collapse;
    line-height: 1.45;
  }

  .diff-row.diff-add {
    background: rgba(92, 184, 92, 0.08);
  }

  .diff-row.diff-remove {
    background: rgba(229, 83, 75, 0.08);
  }

  .diff-ln {
    width: 1px;
    min-width: 32px;
    padding: 0 6px;
    text-align: right;
    color: #4a4843;
    user-select: none;
    vertical-align: top;
    white-space: nowrap;
  }

  .diff-marker {
    width: 1px;
    padding: 0 4px;
    user-select: none;
    vertical-align: top;
    font-weight: 700;
  }

  .diff-row.diff-add .diff-marker { color: #5cb85c; }
  .diff-row.diff-remove .diff-marker { color: #e5534b; }
  .diff-row.diff-equal .diff-marker { color: #3e3c37; }

  .diff-code {
    padding: 0 8px;
    white-space: pre-wrap;
    word-break: break-all;
    color: #d4d0c8;
  }

  /* hljs token colors (minimal dark theme) */
  .diff-code :global(.hljs-keyword),
  .diff-code :global(.hljs-selector-tag) { color: #c586c0; }
  .diff-code :global(.hljs-string),
  .diff-code :global(.hljs-template-variable) { color: #ce9178; }
  .diff-code :global(.hljs-number),
  .diff-code :global(.hljs-literal) { color: #b5cea8; }
  .diff-code :global(.hljs-comment) { color: #6a9955; font-style: italic; }
  .diff-code :global(.hljs-function),
  .diff-code :global(.hljs-title) { color: #dcdcaa; }
  .diff-code :global(.hljs-built_in) { color: #4ec9b0; }
  .diff-code :global(.hljs-type),
  .diff-code :global(.hljs-class) { color: #4ec9b0; }
  .diff-code :global(.hljs-attr),
  .diff-code :global(.hljs-attribute) { color: #9cdcfe; }
  .diff-code :global(.hljs-variable) { color: #9cdcfe; }
  .diff-code :global(.hljs-params) { color: #9cdcfe; }
  .diff-code :global(.hljs-meta) { color: #569cd6; }
  .diff-code :global(.hljs-regexp) { color: #d16969; }
  .diff-code :global(.hljs-tag) { color: #569cd6; }
  .diff-code :global(.hljs-name) { color: #569cd6; }
  .diff-code :global(.hljs-selector-class) { color: #d7ba7d; }
  .diff-code :global(.hljs-selector-id) { color: #d7ba7d; }
  .diff-code :global(.hljs-property) { color: #9cdcfe; }
  .diff-code :global(.hljs-punctuation) { color: #d4d4d4; }
</style>
