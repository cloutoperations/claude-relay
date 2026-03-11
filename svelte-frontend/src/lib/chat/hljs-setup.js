import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import php from 'highlight.js/lib/languages/php';
import scss from 'highlight.js/lib/languages/scss';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('php', php);
hljs.registerLanguage('scss', scss);

export const EXT_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  css: 'css', scss: 'scss',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', svelte: 'xml',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', swift: 'swift', php: 'php',
};

export function getLang(path) {
  if (!path) return null;
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? (EXT_MAP[ext] || null) : null;
}

export default hljs;
