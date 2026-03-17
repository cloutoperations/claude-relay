<script>
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import Link from '@tiptap/extension-link';
  import Underline from '@tiptap/extension-underline';
  import Highlight from '@tiptap/extension-highlight';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Color } from '@tiptap/extension-color';
  import TextAlign from '@tiptap/extension-text-align';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import Image from '@tiptap/extension-image';
  import { Table } from '@tiptap/extension-table';
  import { TableRow } from '@tiptap/extension-table-row';
  import { TableCell } from '@tiptap/extension-table-cell';
  import { TableHeader } from '@tiptap/extension-table-header';
  // GlobalDragHandle removed — crashes on drag with our ProseMirror version
  // Block reordering via Alt+Up/Alt+Down keyboard shortcuts instead
  import { Extension } from '@tiptap/core';
  import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
  import { editorDragging } from '../../stores/ui.svelte.js';
  import { Markdown } from 'tiptap-markdown';
  import { getBasePath } from '../../stores/ws.svelte.js';
  import { openFile } from '../../stores/files.svelte.js';
  import { panes, paneLayout, activePaneId } from '../../stores/panes.svelte.js';

  let { content = '', path = '', onDirty = null } = $props();

  // Known file extensions for link detection
  const FILE_EXTS = new Set(['md','mdx','js','mjs','ts','tsx','svelte','json','yaml','yml','toml','css','html','sh','py','txt','csv','sql']);

  // Link tooltip
  let linkTooltip = $state(null); // { x, y, href, resolved, isFile, label }
  let linkHideTimer = null;
  let scrollAreaEl = $state(null);

  function resolvePath(base, rel) {
    const parts = base ? base.split('/') : [];
    for (const seg of rel.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  }

  function showLinkTooltip(link) {
    let href = link.getAttribute('href');
    if (!href) return;
    const isExternal = /^https?:\/\//.test(href);
    if (!isExternal) { try { href = decodeURIComponent(href); } catch {} }
    const resolved = isExternal ? href : resolveFromHere(href);
    const isFile = !isExternal && isFilePath(resolved);
    const rect = link.getBoundingClientRect();
    const scrollRect = scrollAreaEl?.getBoundingClientRect() || { left: 0, top: 0 };
    linkTooltip = {
      x: rect.left - scrollRect.left,
      y: rect.bottom - scrollRect.top + 4,
      href, resolved, isFile, isExternal,
      label: resolved.split('/').pop() || href,
    };
  }

  function handleLinkOpen() {
    if (!linkTooltip) return;
    if (linkTooltip.isExternal) {
      window.open(linkTooltip.href, '_blank');
    } else if (linkTooltip.isFile) {
      const resolved = linkTooltip.resolved;
      if (isDirectory(resolved)) {
        revealInTree(resolved.replace(/\/$/, ''));
        toggleDir(resolved.replace(/\/$/, ''));
      } else {
        openFile(resolved);
      }
    }
    linkTooltip = null;
  }

  function tooltipMouseEnter() {
    if (linkHideTimer) { clearTimeout(linkHideTimer); linkHideTimer = null; }
  }
  function tooltipMouseLeave() {
    linkHideTimer = setTimeout(() => { linkTooltip = null; }, 150);
  }

  // Check if text looks like a file/directory path
  function isFilePath(text) {
    if (!text || !text.includes('/')) return false;
    // Skip if it contains spaces, commas, or other non-path chars (likely prose)
    if (/[, ]/.test(text.replace(/\/$/, ''))) return false;
    // Has a known file extension
    const ext = text.split('.').pop()?.toLowerCase();
    if (ext && FILE_EXTS.has(ext)) return true;
    // Directory path (ends with /)
    if (text.endsWith('/')) return true;
    // Multi-segment path with only path-like characters
    if (/^[\w.@-]+(\/[\w.@-]+)+\/?$/.test(text)) return true;
    return false;
  }

  function isDirectory(text) {
    if (!text) return false;
    if (text.endsWith('/')) return true;
    // No file extension = probably a directory
    const last = text.split('/').pop();
    return !last.includes('.');
  }

  // Resolve a path from the current file's perspective.
  // Strategy: walk up the directory chain from the file's parent dir,
  // checking if the first segment of relPath exists at each level.
  // This handles paths like "scripts/" resolving to the nearest parent
  // that contains a "scripts" directory.
  function resolveFromHere(relPath) {
    try { relPath = decodeURIComponent(relPath); } catch {}
    if (relPath.startsWith('./') || relPath.startsWith('../')) {
      const dir = path.split('/').slice(0, -1).join('/');
      return resolvePath(dir, relPath);
    }
    // Already rooted at a known top-level directory — use as-is
    const firstSeg = relPath.split('/')[0];
    if (['gtd', 'code'].includes(firstSeg)) return relPath;
    // Walk up from the file's directory, trying each ancestor as base.
    // For "scripts/edge-cases.md" in file "gtd/chatting/02-operations/scripts/scripts-tote.md":
    //   try: gtd/chatting/02-operations/scripts/scripts/edge-cases.md  (too deep)
    //   try: gtd/chatting/02-operations/scripts/edge-cases.md          ← match
    const fileParts = path.split('/').slice(0, -1); // parent dir segments
    // Try from innermost to outermost ancestor
    for (let i = fileParts.length; i >= 1; i--) {
      const candidate = fileParts.slice(0, i).join('/') + '/' + relPath;
      // If first segment of relPath matches a sibling directory name at this level,
      // this is likely the right base. We can't check the filesystem from the browser,
      // so use a heuristic: prefer the level where relPath's first segment matches
      // a segment already in the path (suggesting it's a sibling).
      const parentDir = fileParts.slice(0, i).join('/');
      // Check if this ancestor's path already contains the first segment as a child
      // (i.e., the first segment of relPath equals one of fileParts at level i)
      if (i < fileParts.length && fileParts[i] === firstSeg) {
        // relPath starts with a sibling dir at this level
        return fileParts.slice(0, i).join('/') + '/' + relPath;
      }
    }
    // Fallback: resolve from the file's grandparent directory (one above the file's folder)
    if (fileParts.length > 1) {
      return fileParts.slice(0, -1).join('/') + '/' + relPath;
    }
    return relPath;
  }

  // --- File path overlay buttons ---
  // Rendered OUTSIDE the contenteditable as absolutely-positioned overlays.
  // Zero ProseMirror conflicts — we just read code element positions.

  // Set up link hover for <a> tags
  function setupLinkDetection() {
    if (!editorEl) return;

    // Hover detection for <a> links only (not code paths — those are click-to-open)
    editorEl.addEventListener('mouseover', (e) => {
      const link = e.target.closest('a.ne-link');
      if (!link) return;
      if (linkHideTimer) { clearTimeout(linkHideTimer); linkHideTimer = null; }
      let href = link.getAttribute('href');
      if (!href) return;
      const isExternal = /^https?:\/\//.test(href);
      if (!isExternal) { try { href = decodeURIComponent(href); } catch {} }
      const resolved = isExternal ? href : resolveFromHere(href);
      const isFile = !isExternal && isFilePath(resolved);
      const rect = link.getBoundingClientRect();
      const scrollRect = scrollAreaEl?.getBoundingClientRect() || { left: 0, top: 0 };
      linkTooltip = {
        x: rect.left - scrollRect.left,
        y: rect.bottom - scrollRect.top + 4,
        href, resolved, isFile, isExternal,
        label: resolved.split('/').pop() || href,
      };
    });

    editorEl.addEventListener('mouseout', (e) => {
      if (e.target.closest('a.ne-link')) {
        linkHideTimer = setTimeout(() => { linkTooltip = null; }, 300);
      }
    });

    // File path clicks + <a> link clicks handled via handleClick in editorProps
  }

  let editorEl = $state(null);
  let editor = $state(null);
  let dirty = $state(false);
  let saving = $state(false);
  let saveStatus = $state('');
  let autoSaveTimer = null;

  // Slash menu
  let slashOpen = $state(false);
  let slashPos = $state({ x: 0, y: 0 });
  let slashFilter = $state('');
  let slashIdx = $state(0);

  // Floating toolbar
  let toolbar = $state(null); // { x, y, multiBlock }


  // Block hover handle + menu
  let hoveredBlock = $state(null); // { top, pos, el }
  let blockHideTimer = null;
  let blockMenu = $state(null); // { pos }

  // View mode: 'editor' or 'markdown'
  let viewMode = $state('editor');
  let rawMarkdown = $state('');

  function toggleViewMode() {
    if (viewMode === 'editor') {
      rawMarkdown = getMarkdown();
      viewMode = 'markdown';
    } else {
      // Switching back — update editor with raw changes
      if (editor && rawMarkdown !== getMarkdown()) {
        editor.commands.setContent(rawMarkdown);
        dirty = true;
        onDirty?.(true);
        scheduleAutoSave();
      }
      viewMode = 'editor';
    }
  }

  function handleRawInput(e) {
    rawMarkdown = e.target.value;
    dirty = true;
    onDirty?.(true);
    scheduleAutoSave();
  }

  // Override save for markdown mode
  const originalGetMarkdown = () => {
    if (viewMode === 'markdown') return rawMarkdown;
    if (!editor) return '';
    return editor.storage.markdown?.getMarkdown?.() || '';
  };

  // Mouse-based block drag state (no HTML5 drag API)
  let isDraggingBlock = $state(false);
  let dragGhost = $state(null); // { x, y, text }
  let dropIndicator = $state(null); // { top } — horizontal line showing drop position
  let dragSourcePos = null;
  let dragTargetPos = null;

  const BLOCK_TYPES = [
    { cat: 'Text', items: [
      { label: 'Text', icon: 'T', cmd: (e) => e.chain().focus().setParagraph().run() },
      { label: 'Heading 1', icon: 'H1', cmd: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
      { label: 'Heading 2', icon: 'H2', cmd: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: 'Heading 3', icon: 'H3', cmd: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    ]},
    { cat: 'Lists', items: [
      { label: 'Bullet List', icon: '•', cmd: (e) => e.chain().focus().toggleBulletList().run() },
      { label: 'Numbered List', icon: '1.', cmd: (e) => e.chain().focus().toggleOrderedList().run() },
      { label: 'To-do List', icon: '☐', cmd: (e) => e.chain().focus().toggleTaskList().run() },
    ]},
    { cat: 'Blocks', items: [
      { label: 'Code Block', icon: '</>', cmd: (e) => e.chain().focus().toggleCodeBlock().run() },
      { label: 'Blockquote', icon: '"', cmd: (e) => e.chain().focus().toggleBlockquote().run() },
      { label: 'Divider', icon: '—', cmd: (e) => e.chain().focus().setHorizontalRule().run() },
      { label: 'Table', icon: '⊞', cmd: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3 }).run() },
      { label: 'Image', icon: '🖼', cmd: (e) => { const url = prompt('Image URL:'); if (url) e.chain().focus().setImage({ src: url }).run(); } },
    ]},
  ];

  const ALL_ITEMS = BLOCK_TYPES.flatMap(g => g.items);

  let filteredItems = $derived.by(() => {
    if (!slashFilter) return ALL_ITEMS;
    const f = slashFilter.toLowerCase();
    return ALL_ITEMS.filter(i => i.label.toLowerCase().includes(f));
  });

  const COLORS = [
    { label: 'Default', value: null },
    { label: 'Red', value: '#E5534B' },
    { label: 'Orange', value: '#DA7756' },
    { label: 'Yellow', value: '#E5A84B' },
    { label: 'Green', value: '#57AB5A' },
    { label: 'Blue', value: '#569CD6' },
    { label: 'Purple', value: '#C586C0' },
  ];

  // Auto-save
  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (dirty && !saving) handleSave();
    }, 1500);
  }

  onMount(() => {
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
          codeBlock: { HTMLAttributes: { class: 'ne-code-block' } },
          dropcursor: { color: 'var(--accent)', width: 2 },
        }),
        Placeholder.configure({ placeholder: 'Type / for commands...' }),
        Link.configure({ openOnClick: false, HTMLAttributes: { class: 'ne-link' } }),
        Underline,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({ inline: false }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        // Block reordering via keyboard (Alt+Up/Down) — no drag API needed
        // Set editorDragging flag when drag starts/ends inside editor
        Extension.create({
          name: 'editorDragFlag',
          addProseMirrorPlugins() {
            return [new Plugin({
              key: new PluginKey('editorDragFlag'),
              props: {
                handleDOMEvents: {
                  dragstart() { editorDragging.value = true; return false; },
                  dragend() { editorDragging.value = false; return false; },
                  drop() { editorDragging.value = false; return false; },
                  // Block hover tracking for our grip handle + menu
                  mouseover(view, event) {
                    const target = event.target;
                    if (!target?.closest) return false;
                    const editorDom = view.dom;
                    let blockEl = target.closest('p, h1, h2, h3, h4, li, pre, blockquote, hr, table, ul[data-type="taskList"]');
                    if (!blockEl || !editorDom.contains(blockEl)) return false;
                    while (blockEl.parentElement && blockEl.parentElement !== editorDom) blockEl = blockEl.parentElement;
                    // Skip update if already hovering the same block element
                    if (hoveredBlock && hoveredBlock.el === blockEl) {
                      if (blockHideTimer) { clearTimeout(blockHideTimer); blockHideTimer = null; }
                      return false;
                    }
                    const rect = blockEl.getBoundingClientRect();
                    const scrollArea = editorDom.closest('.ne-scroll-area');
                    const scrollRect = scrollArea?.getBoundingClientRect() || editorDom.getBoundingClientRect();
                    // Don't call view.posAtDOM here — it forces ProseMirror to lazily render
                    // offscreen content, causing DOM mutations and visual flicker.
                    // pos is resolved on-demand when the grip is clicked (see getHoveredPos).
                    hoveredBlock = { top: rect.top - scrollRect.top + (scrollArea?.scrollTop || 0), left: rect.left - scrollRect.left - 24, el: blockEl };
                    if (blockHideTimer) { clearTimeout(blockHideTimer); blockHideTimer = null; }
                    return false;
                  },
                  mouseleave(view, event) {
                    // Don't hide if mouse moved to the grip handle or block menu
                    const related = event.relatedTarget;
                    if (related?.closest?.('.ne-grip, .ne-blockmenu, .ne-blockmenu-backdrop')) return false;
                    if (!blockMenu) blockHideTimer = setTimeout(() => { if (!blockMenu) hoveredBlock = null; }, 200);
                    return false;
                  },
                },
              },
            })];
          },
        }),
        Markdown.configure({
          html: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: '',
      editorProps: {
        attributes: { class: 'ne-prosemirror' },
        handleClick: (view, pos, event) => {
          const code = event.target.closest('code');
          if (!code) return false;
          const text = code.textContent.trim();
          if (!isFilePath(text)) return false;
          event.preventDefault();
          const filePath = isDirectory(text)
            ? resolveFromHere(text).replace(/\/$/, '')
            : resolveFromHere(text);
          // Ensure a split pane to the right exists
          const fileTabId = '__file__:' + filePath;
          if (!panes.find(p => p.tabIds.includes(fileTabId))) {
            const idx = panes.findIndex(p => p.id === activePaneId.value);
            if (!(idx >= 0 && idx < panes.length - 1) && panes.length < 6 && window.innerWidth >= 768) {
              const newId = 'pane-' + Date.now();
              panes.push({ id: newId, activeTabId: '__home__', tabIds: ['__home__'] });
              Object.assign(paneLayout, { direction: 'horizontal', ratios: Array(panes.length).fill(1 / panes.length) });
            }
          }
          openFile(filePath);
          return true;
        },
        handleKeyDown: (view, event) => {
          // Cmd+S
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            handleSave();
            return true;
          }
          // Slash menu nav
          if (slashOpen) {
            if (event.key === 'ArrowDown') { event.preventDefault(); slashIdx = Math.min(slashIdx + 1, filteredItems.length - 1); return true; }
            if (event.key === 'ArrowUp') { event.preventDefault(); slashIdx = Math.max(slashIdx - 1, 0); return true; }
            if (event.key === 'Enter') { event.preventDefault(); runSlashCommand(slashIdx); return true; }
            if (event.key === 'Escape') { slashOpen = false; return true; }
            if (event.key === 'Backspace' && !slashFilter) { slashOpen = false; }
          }
          // Alt+Up/Down to move blocks (like VS Code)
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            moveBlock(event.key === 'ArrowUp' ? -1 : 1);
            return true;
          }
          // Tab indent
          if (event.key === 'Tab' && !event.shiftKey) {
            if (editor.can().sinkListItem('listItem') || editor.can().sinkListItem('taskItem')) {
              event.preventDefault();
              editor.chain().focus().sinkListItem('listItem').run() || editor.chain().focus().sinkListItem('taskItem').run();
              return true;
            }
          }
          if (event.key === 'Tab' && event.shiftKey) {
            if (editor.can().liftListItem('listItem') || editor.can().liftListItem('taskItem')) {
              event.preventDefault();
              editor.chain().focus().liftListItem('listItem').run() || editor.chain().focus().liftListItem('taskItem').run();
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        dirty = true;
        onDirty?.(true);
        scheduleAutoSave();

        // Slash trigger
        const { from } = ed.state.selection;
        const textBefore = ed.state.doc.textBetween(Math.max(0, from - 20), from, '\n');
        const m = textBefore.match(/\/(\w*)$/);
        if (m) {
          slashFilter = m[1].toLowerCase();
          slashIdx = 0;
          try {
            const coords = ed.view.coordsAtPos(from);
            slashPos = { x: coords.left, y: coords.bottom + 4 };
          } catch {}
          slashOpen = true;
        } else if (slashOpen) {
          slashOpen = false;
        }
      },
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to } = ed.state.selection;
        if (from !== to && to - from > 1) {
          try {
            const coords = ed.view.coordsAtPos(from);
            const end = ed.view.coordsAtPos(to);
            // Detect if selection spans multiple blocks (top-level or list items)
            const fromResolved = ed.state.doc.resolve(from);
            const toResolved = ed.state.doc.resolve(to);
            const sameTopBlock = fromResolved.before(1) === toResolved.before(1);
            // Also check if we're in a list and spanning multiple list items
            const spansList = fromResolved.depth >= 2 && toResolved.depth >= 2 && fromResolved.before(2) !== toResolved.before(2);
            const multiBlock = !sameTopBlock || spansList || (to - from > 100);
            const toolbarY = Math.min(coords.top, end.top) - 48;
            toolbar = { x: (coords.left + end.left) / 2, y: Math.max(8, toolbarY), multiBlock };
          } catch { toolbar = null; }
        } else {
          toolbar = null;
        }
      },
    });

    if (content) {
      editor.commands.setContent(content);
      setTimeout(() => { dirty = false; onDirty?.(false); }, 50);
    }

    setupLinkDetection();
  });

  onDestroy(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (dirty && editor && path) {
      const md = getMarkdown();
      if (md) fetch(getBasePath() + 'api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: md }),
      }).catch(() => {});
    }
    if (editor) editor.destroy();
  });

  $effect(() => {
    if (editor && content !== undefined) {
      const cur = getMarkdown();
      if (Math.abs(cur.length - content.length) > 50 || !cur.startsWith(content.substring(0, 30))) {
        editor.commands.setContent(content);
        dirty = false;
        onDirty?.(false);
      }
    }
  });

  function moveBlock(direction) {
    if (!editor) return;
    const { state, dispatch } = editor.view;
    const sel = state.selection;
    const resolved = sel.$from || state.doc.resolve(sel.from);
    // Find the top-level node
    if (resolved.depth < 1) return;
    const nodePos = resolved.before(1);
    const node = state.doc.nodeAt(nodePos);
    if (!node) return;
    const nodeEnd = nodePos + node.nodeSize;

    if (direction === -1 && nodePos > 0) {
      const posResolved = state.doc.resolve(nodePos);
      const prevIdx = posResolved.index(0) - 1;
      if (prevIdx < 0) return;
      const prevNode = state.doc.child(prevIdx);
      const prevPos = nodePos - prevNode.nodeSize;
      const tr = state.tr;
      const slice = tr.doc.slice(nodePos, nodeEnd);
      tr.delete(nodePos, nodeEnd);
      tr.insert(prevPos, slice.content);
      tr.setSelection(TextSelection.near(tr.doc.resolve(prevPos)));
      dispatch(tr);
    } else if (direction === 1 && nodeEnd < state.doc.content.size) {
      const posResolved = state.doc.resolve(nodePos);
      const nextIdx = posResolved.index(0) + 1;
      if (nextIdx >= state.doc.childCount) return;
      const nextNode = state.doc.child(nextIdx);
      const tr = state.tr;
      const slice = tr.doc.slice(nodePos, nodeEnd);
      tr.delete(nodePos, nodeEnd);
      const insertPos = nodePos + nextNode.nodeSize;
      tr.insert(insertPos, slice.content);
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos)));
      dispatch(tr);
    }
  }

  // Lazily resolve ProseMirror position from a hovered block's DOM element.
  // Called only on click/drag — NOT on hover — to avoid triggering lazy rendering.
  function getHoveredPos() {
    if (!editor || !hoveredBlock) return null;
    try { return editor.view.posAtDOM(hoveredBlock.el, 0); } catch { return null; }
  }

  // Mouse-based block drag (no HTML5 drag API — avoids pane system conflict)
  // Differentiates click (opens menu) from drag (moves block) via movement threshold
  function startBlockDrag(e) {
    if (!editor || !hoveredBlock || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const { el } = hoveredBlock;
    const pos = getHoveredPos();
    if (pos == null) return;
    let sourcePos;
    try {
      const resolved = editor.state.doc.resolve(pos);
      sourcePos = resolved.before(1);
    } catch { return; }

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const ghostText = el.textContent?.substring(0, 40) || 'Block';

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return; // threshold before drag starts

      if (!moved) {
        // First real movement — start drag
        moved = true;
        isDraggingBlock = true;
        blockMenu = null;
        dragSourcePos = sourcePos;
      }

      dragGhost = { x: ev.clientX, y: ev.clientY, text: ghostText };

      // Find drop position
      const editorDom = editor.view.dom;
      const scrollArea = editorDom.closest('.ne-scroll-area');
      if (!scrollArea) return;

      let closestTop = null;
      let closestPos = null;
      let minDist = Infinity;

      // Walk top-level children
      for (let i = 0; i < editorDom.childNodes.length; i++) {
        const child = editorDom.childNodes[i];
        if (!(child instanceof HTMLElement)) continue;
        const rect = child.getBoundingClientRect();
        const scrollRect = scrollArea.getBoundingClientRect();

        // Check distance to top edge of this block
        const topDist = Math.abs(ev.clientY - rect.top);
        if (topDist < minDist) {
          minDist = topDist;
          closestTop = rect.top - scrollRect.top + scrollArea.scrollTop;
          try { closestPos = editor.view.posAtDOM(child, 0); } catch {}
        }
        // Also check bottom edge of last block
        const botDist = Math.abs(ev.clientY - rect.bottom);
        if (botDist < minDist) {
          minDist = botDist;
          closestTop = rect.bottom - scrollRect.top + scrollArea.scrollTop;
          try {
            const p = editor.view.posAtDOM(child, 0);
            const r = editor.state.doc.resolve(p);
            closestPos = r.after(1);
          } catch {}
        }
      }

      if (closestTop !== null) {
        dropIndicator = { top: closestTop };
        dragTargetPos = closestPos;
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      if (!moved) {
        // Was a click, not a drag — let onclick handle it (open block menu)
        isDraggingBlock = false;
        dragGhost = null;
        dropIndicator = null;
        return;
      }

      if (dragSourcePos != null && dragTargetPos != null && dragSourcePos !== dragTargetPos && editor) {
        try {
          const { state, dispatch } = editor.view;
          const node = state.doc.nodeAt(dragSourcePos);
          if (node) {
            const nodeEnd = dragSourcePos + node.nodeSize;
            const tr = state.tr;

            if (dragTargetPos > dragSourcePos) {
              // Moving down
              const slice = tr.doc.slice(dragSourcePos, nodeEnd);
              const adjustedTarget = dragTargetPos - node.nodeSize;
              tr.delete(dragSourcePos, nodeEnd);
              tr.insert(Math.min(adjustedTarget, tr.doc.content.size), slice.content);
            } else {
              // Moving up
              const slice = tr.doc.slice(dragSourcePos, nodeEnd);
              tr.delete(dragSourcePos, nodeEnd);
              tr.insert(dragTargetPos, slice.content);
            }
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(dragTargetPos, tr.doc.content.size))));
            dispatch(tr);
          }
        } catch (err) {
          console.warn('[editor] Block move failed:', err.message);
        }
      }

      isDraggingBlock = false;
      dragGhost = null;
      dropIndicator = null;
      dragSourcePos = null;
      dragTargetPos = null;
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Lift selection out of list before transforming to heading/paragraph/quote
  function liftFromList() {
    if (!editor) return;
    // Try lifting from all list types
    try {
      while (editor.can().liftListItem('listItem')) {
        editor.chain().focus().liftListItem('listItem').run();
      }
    } catch {}
    try {
      while (editor.can().liftListItem('taskItem')) {
        editor.chain().focus().liftListItem('taskItem').run();
      }
    } catch {}
  }

  function getMarkdown() {
    if (viewMode === 'markdown') return rawMarkdown;
    if (!editor) return '';
    return editor.storage.markdown?.getMarkdown?.() || '';
  }

  function runSlashCommand(idx) {
    if (!editor || idx < 0 || idx >= filteredItems.length) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from, '\n');
    const m = textBefore.match(/\/(\w*)$/);
    if (m) editor.chain().focus().deleteRange({ from: from - m[0].length, to: from }).run();
    filteredItems[idx].cmd(editor);
    slashOpen = false;
  }

  async function handleSave() {
    if (!editor || !path || saving) return;
    saving = true;
    saveStatus = '';
    const md = getMarkdown();
    if (!md || md.length < 2) { saving = false; saveStatus = 'error'; return; }
    try {
      const res = await fetch(getBasePath() + 'api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: md }),
      });
      if (res.ok) {
        dirty = false;
        onDirty?.(false);
        saveStatus = 'saved';
        setTimeout(() => { if (saveStatus === 'saved') saveStatus = ''; }, 2000);
      } else { saveStatus = 'error'; }
    } catch { saveStatus = 'error'; }
    saving = false;
  }
</script>

<div class="notion-editor">
  <div class="ne-status-bar">
    <div class="ne-status-left">
      {#if saving}
        <span class="ne-saving-spinner"></span>
      {:else if dirty}
        <span class="ne-dirty-dot"></span>
      {:else if saveStatus === 'saved'}
        <span class="ne-status-text saved">Saved</span>
      {:else if saveStatus === 'error'}
        <span class="ne-status-text error">Save failed</span>
      {/if}
    </div>
    <button class="ne-mode-toggle" onclick={toggleViewMode} title={viewMode === 'editor' ? 'View raw markdown' : 'Back to editor'}>
      {#if viewMode === 'editor'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      {/if}
    </button>
  </div>

  {#if viewMode === 'markdown'}
    <div class="ne-raw-wrap">
      <textarea class="ne-raw-textarea" value={rawMarkdown} oninput={handleRawInput} spellcheck="false"></textarea>
    </div>
  {/if}
  <div class="ne-scroll-area" style:display={viewMode === 'editor' ? '' : 'none'} bind:this={scrollAreaEl}>
  <div class="ne-editor-wrap" bind:this={editorEl}></div>


  <!-- Link hover tooltip -->
  {#if linkTooltip}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ne-link-tooltip" style="left:{linkTooltip.x}px;top:{linkTooltip.y}px"
      onmouseenter={tooltipMouseEnter} onmouseleave={tooltipMouseLeave}>
      {#if linkTooltip.isFile}
        <button class="ne-link-open" onclick={handleLinkOpen}>
          {#if isDirectory(linkTooltip.resolved)}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Browse {linkTooltip.label}
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Open {linkTooltip.label}
          {/if}
        </button>
      {:else}
        <a class="ne-link-external" href={linkTooltip.href} target="_blank" rel="noopener" onclick={() => linkTooltip = null}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          {linkTooltip.label}
        </a>
      {/if}
    </div>
  {/if}

  <!-- Block handle (grip icon) — inside scroll area so it scrolls with content -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="ne-grip"
    class:visible={!!hoveredBlock}
    class:menu-open={!!blockMenu}
    style="top:{hoveredBlock?.top ?? 0}px;left:{hoveredBlock?.left ?? -40}px"
    onmouseenter={() => { if (blockHideTimer) { clearTimeout(blockHideTimer); blockHideTimer = null; } }}
    onmouseleave={() => { if (!blockMenu && !isDraggingBlock) blockHideTimer = setTimeout(() => hoveredBlock = null, 200); }}
    onmousedown={startBlockDrag}
    onclick={(e) => {
      e.stopPropagation();
      const pos = getHoveredPos();
      if (editor && pos != null) {
        try { const r = editor.state.doc.resolve(pos); editor.commands.setNodeSelection(r.before(1)); } catch {}
      }
      blockMenu = blockMenu ? null : { pos };
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
      <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
    </svg>
  </div>

  <!-- Block menu (grip click) — the main block operations menu -->
  {#if blockMenu && hoveredBlock}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ne-blockmenu-backdrop" onclick={() => blockMenu = null}></div>
    <div class="ne-blockmenu" style="top:{hoveredBlock.top}px;left:{hoveredBlock.left + 26}px"
      onmouseenter={() => { if (blockHideTimer) { clearTimeout(blockHideTimer); blockHideTimer = null; } }}>

      <div class="ne-bm-header">Turn into</div>
      {#each [
        { label: 'Text', icon: 'T', cmd: () => { liftFromList(); editor.chain().focus().setParagraph().run(); } },
        { label: 'Heading 1', icon: 'H1', cmd: () => { liftFromList(); editor.chain().focus().toggleHeading({ level: 1 }).run(); } },
        { label: 'Heading 2', icon: 'H2', cmd: () => { liftFromList(); editor.chain().focus().toggleHeading({ level: 2 }).run(); } },
        { label: 'Heading 3', icon: 'H3', cmd: () => { liftFromList(); editor.chain().focus().toggleHeading({ level: 3 }).run(); } },
        { label: 'Bullet List', icon: '•', cmd: () => editor.chain().focus().toggleBulletList().run() },
        { label: 'Numbered List', icon: '1.', cmd: () => editor.chain().focus().toggleOrderedList().run() },
        { label: 'To-do List', icon: '☐', cmd: () => editor.chain().focus().toggleTaskList().run() },
        { label: 'Code Block', icon: '</>', cmd: () => editor.chain().focus().toggleCodeBlock().run() },
        { label: 'Quote', icon: '"', cmd: () => { liftFromList(); editor.chain().focus().toggleBlockquote().run(); } },
      ] as item}
        <button class="ne-bm-item" onclick={() => { item.cmd(); blockMenu = null; }}>
          <span class="ne-bm-icon">{item.icon}</span> {item.label}
        </button>
      {/each}

      <div class="ne-bm-sep"></div>
      <div class="ne-bm-header">Color</div>
      <div class="ne-bm-color-row">
        {#each COLORS as c}
          <button class="ne-bm-color-swatch" style={c.value ? `background:${c.value}` : 'background:var(--text)'} onclick={() => {
            if (c.value) editor.chain().focus().setColor(c.value).run();
            else editor.chain().focus().unsetColor().run();
            blockMenu = null;
          }}></button>
        {/each}
      </div>

      <div class="ne-bm-sep"></div>
      <div class="ne-bm-header">Actions</div>
      <button class="ne-bm-item" onclick={() => { moveBlock(-1); blockMenu = null; }}>
        <span class="ne-bm-icon">↑</span> Move Up <kbd>⌥↑</kbd>
      </button>
      <button class="ne-bm-item" onclick={() => { moveBlock(1); blockMenu = null; }}>
        <span class="ne-bm-icon">↓</span> Move Down <kbd>⌥↓</kbd>
      </button>
      <button class="ne-bm-item" onclick={() => {
        if (editor) {
          const { from, to } = editor.state.selection;
          const text = editor.state.doc.textBetween(from, to, '\n');
          navigator.clipboard.writeText(text).catch(() => {});
        }
        blockMenu = null;
      }}>
        <span class="ne-bm-icon">⎘</span> Copy
      </button>
      <button class="ne-bm-item" onclick={() => {
        if (editor && blockMenu?.pos != null) {
          try {
            const r = editor.state.doc.resolve(blockMenu.pos);
            const nodePos = r.before(1);
            const node = editor.state.doc.nodeAt(nodePos);
            if (node) {
              const slice = editor.state.doc.slice(nodePos, nodePos + node.nodeSize);
              editor.chain().focus().insertContentAt(nodePos + node.nodeSize, slice.content.toJSON()).run();
            }
          } catch {}
        }
        blockMenu = null;
      }}>
        <span class="ne-bm-icon">⧉</span> Duplicate
      </button>
      <button class="ne-bm-item danger" onclick={() => {
        if (editor && blockMenu?.pos != null) {
          try {
            const r = editor.state.doc.resolve(blockMenu.pos);
            const nodePos = r.before(1);
            const node = editor.state.doc.nodeAt(nodePos);
            if (node) editor.chain().focus().deleteRange({ from: nodePos, to: nodePos + node.nodeSize }).run();
          } catch {}
        }
        blockMenu = null;
        hoveredBlock = null;
      }}>
        <span class="ne-bm-icon">×</span> Delete
      </button>
    </div>
  {/if}

  <!-- Drop indicator line -->
  {#if dropIndicator}
    <div class="ne-drop-line" style="top:{dropIndicator.top}px"></div>
  {/if}

  </div><!-- end ne-scroll-area -->

  <!-- Drag ghost (follows cursor) -->
  {#if dragGhost}
    <div class="ne-drag-ghost" style="left:{dragGhost.x + 12}px;top:{dragGhost.y - 12}px">
      {dragGhost.text}
    </div>
  {/if}

  <!-- Slash menu -->
  {#if slashOpen && filteredItems.length > 0}
    <div class="ne-slash" style="left:{slashPos.x}px;top:{slashPos.y}px">
      {#each BLOCK_TYPES as group}
        {@const items = group.items.filter(i => !slashFilter || i.label.toLowerCase().includes(slashFilter))}
        {#if items.length > 0}
          <div class="ne-slash-cat">{group.cat}</div>
          {#each items as item}
            {@const globalIdx = filteredItems.indexOf(item)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="ne-slash-item" class:sel={globalIdx === slashIdx}
              onclick={() => runSlashCommand(globalIdx)}
              onmouseenter={() => slashIdx = globalIdx}>
              <span class="ne-slash-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Floating toolbar -->
  {#if toolbar && editor && !blockMenu}
    <div class="ne-toolbar" style="left:{toolbar.x}px;top:{toolbar.y}px">
      <!-- Inline formatting -->
      <button class="ne-tb" class:on={editor.isActive('bold')} onclick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button class="ne-tb" class:on={editor.isActive('italic')} onclick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button class="ne-tb" class:on={editor.isActive('underline')} onclick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <button class="ne-tb" class:on={editor.isActive('strike')} onclick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
      <button class="ne-tb" class:on={editor.isActive('code')} onclick={() => editor.chain().focus().toggleCode().run()}><code>&lt;&gt;</code></button>
      <div class="ne-tb-sep"></div>
      <button class="ne-tb" class:on={editor.isActive('link')} onclick={() => {
        if (editor.isActive('link')) editor.chain().focus().unsetLink().run();
        else { const url = prompt('URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <div class="ne-tb-sep"></div>
      <!-- Colors -->
      {#each COLORS as c}
        <button class="ne-tb ne-color" style={c.value ? `color:${c.value}` : ''} onclick={() => {
          if (c.value) editor.chain().focus().setColor(c.value).run();
          else editor.chain().focus().unsetColor().run();
        }}>A</button>
      {/each}
      <div class="ne-tb-sep"></div>
      <!-- Highlights -->
      {#each [{ l: 'Yellow', v: '#E5A84B30' }, { l: 'Green', v: '#57AB5A30' }, { l: 'Blue', v: '#569CD630' }, { l: 'Red', v: '#E5534B30' }] as h}
        <button class="ne-tb ne-hl" style="background:{h.v}" onclick={() => editor.chain().focus().toggleHighlight({ color: h.v }).run()}></button>
      {/each}
      <!-- Block transforms (shown when selection spans multiple blocks or is large) -->
      {#if toolbar.multiBlock}
        <div class="ne-tb-sep"></div>
        <div class="ne-tb-group">
          <span class="ne-tb-label">Turn into:</span>
          <button class="ne-tb" onclick={() => { liftFromList(); editor.chain().focus().setParagraph().run(); }}>T</button>
          <button class="ne-tb" onclick={() => { liftFromList(); editor.chain().focus().toggleHeading({ level: 1 }).run(); }}>H1</button>
          <button class="ne-tb" onclick={() => { liftFromList(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}>H2</button>
          <button class="ne-tb" onclick={() => { liftFromList(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}>H3</button>
          <button class="ne-tb" onclick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
          <button class="ne-tb" onclick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
          <button class="ne-tb" onclick={() => editor.chain().focus().toggleTaskList().run()}>☐</button>
          <button class="ne-tb" onclick={() => { liftFromList(); editor.chain().focus().toggleBlockquote().run(); }}>"</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notion-editor { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }

  .ne-status-bar { display: flex; align-items: center; justify-content: space-between; padding: 2px 14px; flex-shrink: 0; min-height: 0; height: 20px; }
  .ne-status-left { display: flex; align-items: center; gap: 6px; }
  .ne-dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: nePulse 2s ease-in-out infinite; }
  @keyframes nePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .ne-status-text { font-size: 11px; color: var(--text-dimmer); }
  .ne-status-text.saved { color: var(--success); }
  .ne-status-text.error { color: var(--error); }
  .ne-saving-spinner { width: 10px; height: 10px; border: 1.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .ne-mode-toggle {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; border-radius: 5px;
    font-size: 11px; color: var(--text-dimmer);
    cursor: pointer; transition: all 0.12s;
  }
  .ne-mode-toggle:hover { background: rgba(var(--overlay-rgb), 0.06); color: var(--text-muted); }

  .ne-raw-wrap { flex: 1; overflow: hidden; display: flex; }
  .ne-raw-textarea {
    flex: 1; width: 100%; resize: none; border: none; outline: none;
    padding: 20px 24px 100px;
    background: var(--code-bg); color: var(--text);
    font-family: var(--font-mono); font-size: 13px; line-height: 1.6;
    scrollbar-width: thin;
  }

  .ne-scroll-area { flex: 1; overflow-y: auto; scrollbar-width: thin; position: relative; }
  .ne-editor-wrap { }

  /* ─── ProseMirror Content ─── */
  .ne-editor-wrap :global(.ne-prosemirror) {
    outline: none;
    font-size: 15px; line-height: 1.7; color: var(--text);
    padding: 20px 24px 100px; position: relative;
  }

  /* Block hover — Notion style */
  .ne-editor-wrap :global(.ne-prosemirror > *) {
    border-radius: 4px; transition: background 0.08s;
    padding: 2px 4px; margin-left: -4px; margin-right: -4px;
  }
  .ne-editor-wrap :global(.ne-prosemirror > *:hover) { background: rgba(var(--overlay-rgb), 0.025); }

  .ne-editor-wrap :global(.ne-prosemirror p) { margin: 0 0 4px; }
  .ne-editor-wrap :global(.ne-prosemirror h1) { font-size: 28px; font-weight: 700; margin: 28px 0 8px; line-height: 1.3; }
  .ne-editor-wrap :global(.ne-prosemirror h2) { font-size: 22px; font-weight: 600; margin: 22px 0 6px; line-height: 1.3; border-top: 1px solid rgba(var(--overlay-rgb), 0.06); padding-top: 8px; }
  .ne-editor-wrap :global(.ne-prosemirror h3) { font-size: 17px; font-weight: 600; margin: 16px 0 4px; line-height: 1.4; }
  .ne-editor-wrap :global(.ne-prosemirror h4) { font-size: 15px; font-weight: 600; margin: 12px 0 2px; color: var(--text-secondary); }

  .ne-editor-wrap :global(.ne-prosemirror ul),
  .ne-editor-wrap :global(.ne-prosemirror ol) { padding-left: 24px; margin: 2px 0 8px; }
  .ne-editor-wrap :global(.ne-prosemirror li) { margin: 1px 0; }
  .ne-editor-wrap :global(.ne-prosemirror li p) { margin: 0; }

  /* Task list (checkboxes) */
  .ne-editor-wrap :global(.ne-prosemirror ul[data-type="taskList"]) { list-style: none; padding-left: 4px; }
  .ne-editor-wrap :global(.ne-prosemirror li[data-type="taskItem"]) { display: flex; align-items: flex-start; gap: 8px; }
  .ne-editor-wrap :global(.ne-prosemirror li[data-type="taskItem"] > label) { margin-top: 4px; cursor: pointer; }
  .ne-editor-wrap :global(.ne-prosemirror li[data-type="taskItem"][data-checked="true"] > div > p) { text-decoration: line-through; color: var(--text-dimmer); }

  .ne-editor-wrap :global(.ne-prosemirror blockquote) {
    border-left: 3px solid var(--accent-40); padding: 4px 16px; margin: 6px 0;
    color: var(--text-muted); background: rgba(var(--overlay-rgb), 0.02); border-radius: 0 4px 4px 0;
  }

  .ne-editor-wrap :global(.ne-code-block) {
    background: var(--code-bg); border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px; padding: 14px 16px; font-family: var(--font-mono);
    font-size: 13px; line-height: 1.5; overflow-x: auto; margin: 6px 0;
  }

  .ne-editor-wrap :global(.ne-prosemirror code) {
    background: rgba(var(--overlay-rgb), 0.08); padding: 2px 5px; border-radius: 4px;
    font-family: var(--font-mono); font-size: 0.9em; color: var(--accent);
  }

  .ne-editor-wrap :global(.ne-prosemirror hr) { border: none; border-top: 1px solid rgba(var(--overlay-rgb), 0.10); margin: 20px 0; }
  .ne-editor-wrap :global(.ne-link) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }

  /* Inline code with paths — clickable with ↗ indicator via ::after.
     handleClick in editorProps handles the actual click + split pane logic.
     ProseMirror can't strip ::after pseudo-elements. */
  .ne-editor-wrap :global(.ne-prosemirror code) {
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .ne-editor-wrap :global(.ne-prosemirror code:hover) {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
  }
  .ne-editor-wrap :global(.ne-prosemirror code:active) {
    background: rgba(var(--accent-rgb), 0.25);
  }
  .ne-editor-wrap :global(.ne-prosemirror code::after) {
    content: ' ↗';
    font-size: 0.8em;
    color: var(--accent);
    opacity: 0.4;
    transition: opacity 0.12s;
  }
  .ne-editor-wrap :global(.ne-prosemirror code:hover::after) {
    opacity: 1;
  }
  /* Don't show ↗ on code inside code blocks */
  .ne-editor-wrap :global(.ne-code-block code::after),
  .ne-editor-wrap :global(pre code::after) {
    display: none;
  }
  .ne-editor-wrap :global(.ne-code-block code),
  .ne-editor-wrap :global(pre code) {
    cursor: text;
  }


  /* ─── Link hover tooltip ─── */
  .ne-link-tooltip {
    position: absolute;
    z-index: 200;
    display: flex;
    animation: tooltipIn 0.12s ease-out;
  }

  @keyframes tooltipIn {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ne-link-open, .ne-link-external {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: var(--bg-raised, var(--bg-alt));
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 8px;
    color: var(--accent);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(var(--shadow-rgb), 0.15);
    transition: background 0.12s, border-color 0.12s;
  }

  .ne-link-open:hover, .ne-link-external:hover {
    background: rgba(var(--accent-rgb), 0.1);
    border-color: rgba(var(--accent-rgb), 0.25);
  }
  .ne-editor-wrap :global(.ne-prosemirror strong) { font-weight: 600; color: var(--text); }
  .ne-editor-wrap :global(.ne-prosemirror img) { max-width: 100%; border-radius: 8px; margin: 8px 0; }

  /* Table */
  .ne-editor-wrap :global(.ne-prosemirror table) { border-collapse: collapse; width: 100%; margin: 8px 0; }
  .ne-editor-wrap :global(.ne-prosemirror td),
  .ne-editor-wrap :global(.ne-prosemirror th) {
    border: 1px solid rgba(var(--overlay-rgb), 0.12); padding: 8px 12px; text-align: left; font-size: 13px;
  }
  .ne-editor-wrap :global(.ne-prosemirror th) { background: rgba(var(--overlay-rgb), 0.04); font-weight: 600; }

  /* Placeholder */
  .ne-editor-wrap :global(.is-editor-empty:first-child::before) {
    content: attr(data-placeholder); float: left; color: var(--text-dimmer); pointer-events: none; height: 0;
  }

  /* Drop cursor */
  .ne-editor-wrap :global(.ProseMirror-dropcursor) { background: var(--accent) !important; height: 2px !important; }

  /* Selection styling */
  .ne-editor-wrap :global(.ProseMirror-selectednode) {
    outline: 2px solid var(--accent-40);
    border-radius: 4px;
  }

  /* Block reorder hint */
  .ne-bm-item kbd {
    margin-left: auto;
    font-size: 9px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: inherit;
  }

  /* ─── Grip Handle ─── */
  .ne-grip {
    position: absolute;
    width: 22px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-dimmer); opacity: 0;
    cursor: pointer; border-radius: 4px;
    transition: opacity 0.12s, background 0.1s, color 0.1s;
    z-index: 10; user-select: none;
    pointer-events: none;
  }
  .ne-grip.visible { opacity: 0.5; pointer-events: auto; }
  .ne-grip.visible:hover, .ne-grip.menu-open { opacity: 1 !important; background: rgba(var(--overlay-rgb), 0.08); color: var(--text-muted); pointer-events: auto; }

  /* ─── Block Menu ─── */
  .ne-blockmenu-backdrop { position: fixed; inset: 0; z-index: 299; }
  .ne-blockmenu {
    position: absolute; z-index: 300;
    width: 210px; max-height: 70vh; overflow-y: auto; background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 10px; box-shadow: 0 8px 24px rgba(var(--shadow-rgb), 0.4);
    padding: 4px; animation: neSlide 0.12s ease-out;
  }

  .ne-bm-header { padding: 6px 8px 2px; font-size: 10px; font-weight: 600; color: var(--text-dimmer); text-transform: uppercase; letter-spacing: 0.5px; }
  .ne-bm-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 5px 8px; border-radius: 6px; font-size: 12px;
    color: var(--text-secondary); cursor: pointer; transition: background 0.06s; text-align: left;
  }
  .ne-bm-item:hover { background: rgba(var(--overlay-rgb), 0.08); }
  .ne-bm-item.danger { color: var(--error); }
  .ne-bm-item.danger:hover { background: var(--error-8); }
  .ne-bm-icon {
    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    background: rgba(var(--overlay-rgb), 0.05); border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 4px; font-size: 11px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;
  }
  .ne-bm-sep { height: 1px; background: rgba(var(--overlay-rgb), 0.08); margin: 4px 0; }
  .ne-bm-color-row { display: flex; gap: 4px; padding: 4px 8px; }
  .ne-bm-color-swatch {
    width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
    border: 1px solid rgba(var(--overlay-rgb), 0.12); transition: transform 0.1s;
  }
  .ne-bm-color-swatch:hover { transform: scale(1.15); }

  /* ─── Mouse-based drag ─── */
  .ne-drag-ghost {
    position: fixed;
    z-index: 999;
    padding: 4px 10px;
    background: var(--bg-raised);
    border: 1px solid var(--accent-40);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(var(--shadow-rgb), 0.3);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.9;
  }

  .ne-drop-line {
    position: absolute;
    left: calc(50% - 360px);
    right: calc(50% - 360px);
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    z-index: 50;
    pointer-events: none;
    transition: top 0.05s;
  }
  @media (max-width: 840px) { .ne-drop-line { left: 20px; right: 20px; } }

  /* ─── Slash Menu ─── */
  .ne-slash {
    position: fixed; z-index: 300; width: 240px; max-height: 320px; overflow-y: auto;
    background: var(--bg-raised); border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 12px; box-shadow: 0 8px 32px rgba(var(--shadow-rgb), 0.4);
    padding: 6px; animation: neSlide 0.12s ease-out;
  }
  @keyframes neSlide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

  .ne-slash-cat { padding: 6px 8px 2px; font-size: 10px; font-weight: 600; color: var(--text-dimmer); text-transform: uppercase; letter-spacing: 0.5px; }

  .ne-slash-item {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px;
    border-radius: 8px; cursor: pointer; transition: background 0.06s; font-size: 13px; color: var(--text-secondary);
  }
  .ne-slash-item:hover, .ne-slash-item.sel { background: rgba(var(--overlay-rgb), 0.08); }

  .ne-slash-icon {
    width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    background: rgba(var(--overlay-rgb), 0.05); border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;
  }

  /* ─── Floating Toolbar ─── */
  .ne-toolbar {
    position: fixed; z-index: 300; display: flex; gap: 1px; flex-wrap: wrap; max-width: 400px;
    background: var(--bg-raised); border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 8px; box-shadow: 0 4px 16px rgba(var(--shadow-rgb), 0.3);
    padding: 3px; transform: translateX(-50%); animation: neSlide 0.1s ease-out;
  }

  .ne-tb {
    min-width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    border-radius: 4px; font-size: 12px; color: var(--text-muted); cursor: pointer; transition: all 0.08s; padding: 0 4px;
  }
  .ne-tb:hover { background: rgba(var(--overlay-rgb), 0.08); color: var(--text); }
  .ne-tb.on { background: var(--accent-15); color: var(--accent); }
  .ne-tb code { font-size: 10px; font-family: var(--font-mono); }

  .ne-tb-sep { width: 1px; margin: 3px 1px; background: rgba(var(--overlay-rgb), 0.10); }

  .ne-color { font-weight: 700; font-size: 13px; }
  .ne-hl { width: 18px; height: 18px; min-width: 18px; border-radius: 3px; border: 1px solid rgba(var(--overlay-rgb), 0.1); }

  .ne-tb-group { display: flex; align-items: center; gap: 1px; }
  .ne-tb-label { font-size: 10px; color: var(--text-dimmer); padding: 0 4px; white-space: nowrap; }
</style>
