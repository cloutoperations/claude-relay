// Markdown rendering utilities
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

marked.use({ gfm: true, breaks: false });

// Match relative file paths like gtd/strategy/foo.md, code/relay/lib/server.js
// Must have at least one slash and end with a known file extension.
const FILE_EXT = 'md|js|mjs|cjs|ts|tsx|svelte|json|yaml|yml|toml|css|html|sh|py|rs|go|java|kt|sql|txt|csv|env|lock|xml|svg|png|jpg|jpeg|gif|pdf';
const FILE_PATH_RE = new RegExp(
  '(/?(?:[\\w@~][\\w.@~-]*/)+[\\w.@~-]+\\.(?:' + FILE_EXT + '))(?=[\\s,;:)\\]"\'<]|$)',
  'g'
);

// TLD-like first segments that indicate a URL, not a file path
const URL_SEGMENTS = new Set(['com', 'org', 'net', 'io', 'co', 'dev', 'app', 'edu', 'gov', 'www']);

// Linkify file paths in rendered HTML. Skips <pre> blocks and existing <a> tags.
// Inline <code> is linkified (Claude often wraps paths in backticks).
function linkifyFilePaths(html) {
  // Split on <pre> blocks and <a> tags only — these should never be modified.
  // Inline <code> tags ARE processed since Claude wraps file paths in backticks.
  const parts = html.split(/(<pre[\s>][\s\S]*?<\/pre>|<a[\s>][\s\S]*?<\/a>)/gi);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue; // skip <pre>/<a> blocks
    parts[i] = parts[i].replace(FILE_PATH_RE, (match, path, offset, str) => {
      const before = str.slice(Math.max(0, offset - 3), offset);
      if (before.endsWith('/') || before.endsWith('="') || before.endsWith("='")) return match;
      if (/:\/\/$/.test(before)) return match;
      const firstSeg = path.split('/')[0].toLowerCase();
      if (URL_SEGMENTS.has(firstSeg)) return match;
      const escaped = path.replace(/"/g, '&quot;');
      const filename = path.split('/').pop();
      const dir = path.split('/').slice(0, -1).join('/');
      const dimDir = dir ? `<span class="file-link-dir">${dir}/</span>` : '';
      return `<a class="file-link" data-file-path="${escaped}" title="${escaped}">${dimDir}${filename}</a>`;
    });
  }
  return parts.join('');
}

export function renderMarkdown(text) {
  let html = DOMPurify.sanitize(marked.parse(text));
  // Wrap tables in scrollable container
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  // Make file paths clickable
  html = linkifyFilePaths(html);
  return html;
}

export function highlightCodeBlocks(el) {
  if (!el) return;
  el.querySelectorAll('pre code:not(.hljs):not(.language-mermaid)').forEach((block) => {
    hljs.highlightElement(block);
  });
  // Add copy buttons to code blocks
  el.querySelectorAll('pre:not(.has-copy-btn):not([data-mermaid-processed])').forEach((pre) => {
    if (!pre.querySelector('code')) return;
    pre.classList.add('has-copy-btn');
    pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.title = 'Copy';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
