import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;
var _switchTab = null;

export function switchTab(tabName) {
  if (_switchTab) _switchTab(tabName);
}

// --- Session search ---
var searchQuery = "";
var searchMatchIds = null; // null = no search, Set of matched session IDs
var searchDebounce = null;
var cachedSessions = [];

// --- Ready (unread done) tracking ---
var prevProcessing = new Set(); // session IDs that were processing last render
var readySessions = (function() {
  try {
    var stored = JSON.parse(localStorage.getItem("ready-sessions") || "[]");
    return new Set(stored);
  } catch(e) { return new Set(); }
})();

function saveReadySessions() {
  try { localStorage.setItem("ready-sessions", JSON.stringify([...readySessions])); } catch(e) {}
}

// --- Multi-account colors ---
var ACCOUNT_COLORS = ["#C4956D", "#8AAF7D", "#B88FAD", "#6DA0B8"];

function accountColor(accountId) {
  if (!ctx || !ctx.accounts) return ACCOUNT_COLORS[0];
  var accounts = ctx.accounts;
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].id === accountId) return ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
  }
  return ACCOUNT_COLORS[0];
}

// --- Account picker state ---
var accountPickerEl = null;

// --- Session context menu ---
var sessionCtxMenu = null;
var sessionCtxSessionId = null;

function closeSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
    sessionCtxSessionId = null;
  }
}

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid) {
  closeSessionCtxMenu();
  sessionCtxSessionId = sessionId;

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startInlineRename(sessionId, title);
  });
  menu.appendChild(renameItem);

  if (cliSid) {
    var copyResumeItem = document.createElement("button");
    copyResumeItem.className = "session-ctx-item";
    copyResumeItem.innerHTML = iconHtml("copy") + " <span>Copy resume command</span>";
    copyResumeItem.addEventListener("click", function (e) {
      e.stopPropagation();
      copyToClipboard("claude --resume " + cliSid).then(function () {
        copyResumeItem.innerHTML = iconHtml("check") + " <span>Copied!</span>";
        refreshIcons();
        setTimeout(function () { closeSessionCtxMenu(); }, 800);
      });
    });
    menu.appendChild(copyResumeItem);
  }

  var deleteItem = document.createElement("button");
  deleteItem.className = "session-ctx-item session-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    ctx.showConfirm('Delete "' + (title || "New Session") + '"? This session and its history will be permanently removed.', function () {
      var ws = ctx.ws;
      if (ws && ctx.connected) {
        ws.send(JSON.stringify({ type: "delete_session", id: sessionId }));
      }
    });
  });
  menu.appendChild(deleteItem);

  anchorBtn.parentElement.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: align to right edge of parent, below the button
  requestAnimationFrame(function () {
    var rect = menu.getBoundingClientRect();
    var parentRect = menu.parentElement.getBoundingClientRect();
    // If menu overflows below the sidebar, flip up
    var sidebarRect = ctx.sessionListEl.getBoundingClientRect();
    if (rect.bottom > sidebarRect.bottom) {
      menu.style.top = "auto";
      menu.style.bottom = "100%";
      menu.style.marginBottom = "2px";
    }
  });
}

// --- Account picker for new session ---
function closeAccountPicker() {
  if (accountPickerEl) {
    accountPickerEl.remove();
    accountPickerEl = null;
  }
}

export function showAccountPicker(anchorEl) {
  closeAccountPicker();
  var accounts = ctx.accounts;
  if (!accounts || accounts.length <= 1) {
    // Single account — just create session directly
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
    return;
  }

  var picker = document.createElement("div");
  picker.className = "account-picker";

  for (var i = 0; i < accounts.length; i++) {
    (function(account, idx) {
      var item = document.createElement("button");
      item.className = "account-picker-item";
      var dot = document.createElement("span");
      dot.className = "account-dot";
      dot.style.background = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
      item.appendChild(dot);
      var label = document.createElement("span");
      label.textContent = account.email;
      item.appendChild(label);
      item.addEventListener("click", function(e) {
        e.stopPropagation();
        closeAccountPicker();
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          window.open(location.pathname + location.search + "#s=new&account=" + encodeURIComponent(account.id), "_blank");
          return;
        }
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "new_session", accountId: account.id }));
          closeSidebar();
        }
      });
      picker.appendChild(item);
    })(accounts[i], i);
  }

  // Use fixed positioning so the picker isn't clipped by overflow:auto parents
  var target = anchorEl || ctx.newSessionBtn;
  var rect = target.getBoundingClientRect();
  picker.style.left = rect.left + "px";
  picker.style.width = Math.max(rect.width, 220) + "px";
  // Position above the button if there's room, otherwise below
  if (rect.top > 200) {
    picker.style.bottom = (window.innerHeight - rect.top + 4) + "px";
  } else {
    picker.style.top = (rect.bottom + 4) + "px";
  }
  document.body.appendChild(picker);
  accountPickerEl = picker;

  // Close on outside click
  setTimeout(function() {
    function onClickOutside(e) {
      if (!picker.contains(e.target)) {
        closeAccountPicker();
        document.removeEventListener("click", onClickOutside, true);
      }
    }
    document.addEventListener("click", onClickOutside, true);
  }, 0);
}

function requestNewSession(e, anchorEl) {
  if (ctx.accounts && ctx.accounts.length > 1) {
    showAccountPicker(anchorEl);
  } else {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  }
}

function startInlineRename(sessionId, currentTitle) {
  var el = ctx.sessionListEl.querySelector('.session-item[data-session-id="' + sessionId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentTitle || "New Session";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
    }
    // Restore text (server will send updated session_list)
    textSpan.innerHTML = originalHtml;
    if (newTitle && newTitle !== currentTitle) {
      textSpan.textContent = newTitle;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function getDateGroup(ts) {
  var now = new Date();
  var d = new Date(ts);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var weekAgo = new Date(today.getTime() - 7 * 86400000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  var lower = text.toLowerCase();
  var qLower = query.toLowerCase();
  var idx = lower.indexOf(qLower);
  if (idx === -1) return escapeHtml(text);
  var before = text.substring(0, idx);
  var match = text.substring(idx, idx + query.length);
  var after = text.substring(idx + query.length);
  return escapeHtml(before) + '<mark class="session-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

function renderSessionItem(s) {
  var el = document.createElement("a");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  var dimmed = searchMatchIds !== null && !isMatch;
  var isActive = s.id === ctx.activeSessionId;
  el.className = "session-item" + (isActive ? " active" : "") + (isMatch ? " search-match" : "") + (dimmed ? " search-dimmed" : "");
  el.dataset.sessionId = s.id;
  el.href = location.pathname + location.search + "#s=" + s.id;

  // Account dot (only when multiple accounts)
  var hasAccountDot = ctx.accounts && ctx.accounts.length > 1;
  if (hasAccountDot) {
    var dot = document.createElement("span");
    var dotClass = "session-account-dot";
    if (s.isProcessing) dotClass += " processing";
    else if (readySessions.has(s.id)) dotClass += " ready";
    dot.className = dotClass;
    dot.style.background = accountColor(s.accountId || (ctx.accounts[0] && ctx.accounts[0].id));
    el.appendChild(dot);
  }

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  textSpan.innerHTML = highlightMatch(s.title || "New Session", searchQuery);
  el.appendChild(textSpan);

  var isReady = readySessions.has(s.id);

  // Processing indicator — right side dot (only when no account dot)
  if (s.isProcessing && !hasAccountDot) {
    var proc = document.createElement("span");
    proc.className = "session-processing";
    el.appendChild(proc);
  } else if (isReady) {
    // "Ready" badge — session finished processing, not yet viewed
    var badge = document.createElement("span");
    badge.className = "session-ready-badge";
    el.appendChild(badge);
  }

  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function(id, title, cliSid, btn) {
    return function(e) {
      e.stopPropagation();
      e.preventDefault();
      showSessionCtxMenu(btn, id, title, cliSid);
    };
  })(s.id, s.title, s.cliSessionId, moreBtn));
  el.appendChild(moreBtn);

  el.addEventListener("click", (function (id) {
    return function (e) {
      // Let modifier clicks (ctrl/cmd/middle) open in new tab natively
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        closeSidebar();
      }
    };
  })(s.id));

  // Middle-click support
  el.addEventListener("auxclick", function (e) {
    if (e.button === 1) {
      // Let browser handle natively — <a> tag will open in new tab
      return;
    }
  });

  return el;
}

export function clearReady(sessionId) {
  readySessions.delete(sessionId);
  saveReadySessions();
}

export function renderSessionList(sessions) {
  if (sessions) {
    // Detect processing → done transitions
    var nowProcessing = new Set();
    for (var pi = 0; pi < sessions.length; pi++) {
      if (sessions[pi].isProcessing) nowProcessing.add(sessions[pi].id);
    }
    // Sessions that were processing before but aren't now → "ready"
    var changed = false;
    prevProcessing.forEach(function(id) {
      if (!nowProcessing.has(id) && id !== ctx.activeSessionId) {
        readySessions.add(id);
        changed = true;
      }
    });
    if (changed) saveReadySessions();
    prevProcessing = nowProcessing;
    cachedSessions = sessions;
  }

  ctx.sessionListEl.innerHTML = "";

  // Sort by lastActivity descending (most recent first)
  var sorted = cachedSessions.slice().sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var currentGroup = "";
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var group = getDateGroup(s.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      var header = document.createElement("div");
      header.className = "session-group-header";
      header.textContent = group;
      ctx.sessionListEl.appendChild(header);
    }
    ctx.sessionListEl.appendChild(renderSessionItem(s));
  }
  refreshIcons();
  updatePageTitle();
}

export function handleSearchResults(msg) {
  if (msg.query !== searchQuery) return; // stale response
  var ids = new Set();
  for (var i = 0; i < msg.results.length; i++) {
    ids.add(msg.results[i].id);
  }
  searchMatchIds = ids;
  renderSessionList(null);

  // Build timeline for current session if it matches
  var activeEl = ctx.sessionListEl.querySelector(".session-item.active");
  if (activeEl) {
    var activeId = parseInt(activeEl.dataset.sessionId, 10);
    if (ids.has(activeId)) {
      buildSearchTimeline(searchQuery);
    } else {
      removeSearchTimeline();
    }
  }
}

export function updatePageTitle() {
  var sessionTitle = "";
  var active = findActiveSession();
  if (active) sessionTitle = active.title || "";
  var newTitle;
  if (ctx.projectName && sessionTitle) {
    newTitle = sessionTitle + " - " + ctx.projectName;
  } else if (ctx.projectName) {
    newTitle = ctx.projectName + " - Claude Relay";
  } else {
    newTitle = "Claude Relay";
  }
  document.title = newTitle;
  updateSessionHeader();
}

function findActiveSession() {
  var id = ctx.activeSessionId;
  if (!id) return null;
  for (var i = 0; i < cachedSessions.length; i++) {
    if (cachedSessions[i].id === id) return cachedSessions[i];
  }
  return null;
}

export function updateSessionHeader() {
  var titleEl = document.getElementById("session-title");
  if (!titleEl) return;
  var active = findActiveSession();
  titleEl.textContent = active ? (active.title || "New Session") : "";
}

function startHeaderRename() {
  var titleEl = document.getElementById("session-title");
  if (!titleEl || !titleEl.textContent) return;
  var active = findActiveSession();
  if (!active) return;
  var sessionId = active.id;
  var currentTitle = active.title || "New Session";

  var container = document.getElementById("header-center");
  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-title-input";
  input.value = currentTitle;

  titleEl.style.display = "none";
  container.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
      titleEl.textContent = newTitle;
    }
    input.remove();
    titleEl.style.display = "";
  }

  function cancel() {
    input.remove();
    titleEl.style.display = "";
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit);
}

export function openSidebar() {
  ctx.sidebar.classList.add("open");
  ctx.sidebarOverlay.classList.add("visible");
}

export function closeSidebar() {
  ctx.sidebar.classList.remove("open");
  ctx.sidebarOverlay.classList.remove("visible");
}

export function initSidebar(_ctx) {
  ctx = _ctx;

  // --- Session title click-to-rename ---
  var sessionTitleEl = document.getElementById("session-title");
  if (sessionTitleEl) {
    sessionTitleEl.addEventListener("click", function () { startHeaderRename(); });
  }

  document.addEventListener("click", function () { closeSessionCtxMenu(); });

  ctx.hamburgerBtn.addEventListener("click", function () {
    ctx.sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  ctx.sidebarOverlay.addEventListener("click", closeSidebar);

  // --- Desktop sidebar collapse/expand ---
  function toggleSidebarCollapse() {
    var layout = ctx.$("layout");
    var collapsed = layout.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : ""); } catch (e) {}
  }

  ctx.sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  ctx.sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage (desktop only)
  try {
    if (localStorage.getItem("sidebar-collapsed") === "1") {
      ctx.$("layout").classList.add("sidebar-collapsed");
    }
  } catch (e) {}

  // --- ESC to close sidebar ---
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ctx.sidebar.classList.contains("open")) {
      closeSidebar();
    }
  });

  // --- Header new-session button ---
  var headerNewBtn = document.getElementById("header-new-session-btn");
  if (headerNewBtn) {
    headerNewBtn.addEventListener("click", function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        window.open(location.pathname + location.search + "#s=new", "_blank");
        return;
      }
      requestNewSession(e, headerNewBtn);
    });
  }

  ctx.newSessionBtn.addEventListener("click", function (e) {
    // Modifier click → open new session in a new tab
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      window.open(location.pathname + location.search + "#s=new", "_blank");
      return;
    }
    requestNewSession(e, ctx.newSessionBtn);
  });

  // --- Session search ---
  var searchBtn = ctx.$("search-session-btn");
  var searchBox = ctx.$("session-search");
  var searchInput = ctx.$("session-search-input");

  function openSearch() {
    searchBox.classList.remove("hidden");
    searchBtn.classList.add("active");
    searchInput.value = "";
    searchQuery = "";
    setTimeout(function () { searchInput.focus(); }, 50);
  }

  function closeSearch() {
    searchBox.classList.add("hidden");
    searchBtn.classList.remove("active");
    searchInput.value = "";
    searchQuery = "";
    searchMatchIds = null;
    if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
    removeSearchTimeline();
    renderSessionList(null);
  }

  searchBtn.addEventListener("click", function () {
    if (searchBox.classList.contains("hidden")) {
      openSearch();
    } else {
      closeSearch();
    }
  });

  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value.trim();
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!searchQuery) {
      searchMatchIds = null;
      removeSearchTimeline();
      renderSessionList(null);
      return;
    }
    searchDebounce = setTimeout(function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "search_sessions", query: searchQuery }));
      }
    }, 200);
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });

  // --- Resume session modal ---
  var resumeModal = ctx.$("resume-modal");
  var resumeInput = ctx.$("resume-session-input");
  var resumeOk = ctx.$("resume-ok");
  var resumeCancel = ctx.$("resume-cancel");

  function openResumeModal() {
    resumeModal.classList.remove("hidden");
    resumeInput.value = "";
    setTimeout(function () { resumeInput.focus(); }, 50);
  }

  function closeResumeModal() {
    resumeModal.classList.add("hidden");
    resumeInput.value = "";
  }

  function submitResume() {
    var val = resumeInput.value.trim();
    if (!val) return;
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "resume_session", cliSessionId: val }));
    }
    closeResumeModal();
    closeSidebar();
  }

  ctx.resumeSessionBtn.addEventListener("click", openResumeModal);
  resumeOk.addEventListener("click", submitResume);
  resumeCancel.addEventListener("click", closeResumeModal);
  resumeModal.querySelector(".confirm-backdrop").addEventListener("click", closeResumeModal);

  resumeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitResume();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeResumeModal();
    }
  });

  // --- Sidebar tabs ---
  var tabBtns = document.querySelectorAll(".sidebar-tab");
  var filesPanel = ctx.$("sidebar-panel-files");
  var sessionsPanel = ctx.$("sidebar-panel-sessions");

  function doSwitchTab(tabName) {
    for (var i = 0; i < tabBtns.length; i++) {
      if (tabBtns[i].dataset.tab === tabName) {
        tabBtns[i].classList.add("active");
      } else {
        tabBtns[i].classList.remove("active");
      }
    }
    if (tabName === "files") {
      filesPanel.classList.remove("hidden");
      sessionsPanel.classList.add("hidden");
      if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
    } else {
      sessionsPanel.classList.remove("hidden");
      filesPanel.classList.add("hidden");
    }
    try { localStorage.setItem("sidebar-tab", tabName); } catch (e) {}
  }
  _switchTab = doSwitchTab;

  for (var i = 0; i < tabBtns.length; i++) {
    (function(btn) {
      btn.addEventListener("click", function() {
        doSwitchTab(btn.dataset.tab);
      });
    })(tabBtns[i]);
  }

  // Restore last active tab visual state only (don't trigger callback during init —
  // filebrowser module isn't initialized yet, loadRootDirectory would fail)
  try {
    var savedTab = localStorage.getItem("sidebar-tab");
    if (savedTab === "sessions") {
      for (var j = 0; j < tabBtns.length; j++) {
        tabBtns[j].classList.toggle("active", tabBtns[j].dataset.tab === "sessions");
      }
      sessionsPanel.classList.remove("hidden");
      filesPanel.classList.add("hidden");
    }
    // else: files tab is already default from HTML
  } catch (e) {}
}

// --- Search hit timeline (right-side markers) ---
var searchTimelineScrollHandler = null;
var activeSearchQuery = ""; // query active in the timeline

export function getActiveSearchQuery() {
  return searchQuery;
}

export function buildSearchTimeline(query) {
  removeSearchTimeline();
  if (!query) return;
  activeSearchQuery = query;

  var q = query.toLowerCase();
  var messagesEl = ctx.messagesEl;

  // Collect all message elements that contain the query
  var allMsgs = messagesEl.querySelectorAll(".msg-user, .msg-assistant");
  var hits = [];
  for (var i = 0; i < allMsgs.length; i++) {
    var msgEl = allMsgs[i];
    var textEl = msgEl.querySelector(".bubble") || msgEl.querySelector(".md-content");
    if (!textEl) continue;
    var text = textEl.textContent || "";
    if (text.toLowerCase().indexOf(q) === -1) continue;

    // Extract a snippet around the match
    var idx = text.toLowerCase().indexOf(q);
    var start = Math.max(0, idx - 10);
    var end = Math.min(text.length, idx + query.length + 10);
    var snippet = (start > 0 ? "\u2026" : "") + text.substring(start, end) + (end < text.length ? "\u2026" : "");
    hits.push({ el: msgEl, snippet: snippet });
  }

  if (hits.length === 0) return;

  var timeline = document.createElement("div");
  timeline.className = "search-timeline";
  timeline.id = "search-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    var pct = hits.length === 1 ? 50 : 6 + (i / (hits.length - 1)) * 88;

    var snippetText = hit.snippet;
    if (snippetText.length > 24) snippetText = snippetText.substring(0, 24) + "\u2026";

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker search-hit-marker";
    marker.innerHTML = iconHtml("search") + '<span class="marker-text">' + escapeHtml(snippetText) + '</span>';
    marker.style.top = pct + "%";
    marker.dataset.offsetTop = hit.el.offsetTop;

    (function(targetEl, markerEl) {
      markerEl.addEventListener("click", function() {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        targetEl.classList.remove("search-blink");
        void targetEl.offsetWidth; // force reflow
        targetEl.classList.add("search-blink");
      });
    })(hit.el, marker);

    track.appendChild(marker);
  }

  timeline.appendChild(track);

  // Position to align with messages area
  var appEl = ctx.$("app");
  var headerEl = ctx.$("header");
  var inputAreaEl = ctx.$("input-area");
  var appRect = appEl.getBoundingClientRect();
  var headerRect = headerEl.getBoundingClientRect();
  var inputRect = inputAreaEl.getBoundingClientRect();

  timeline.style.top = (headerRect.bottom - appRect.top + 4) + "px";
  timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timeline);
  refreshIcons();

  searchTimelineScrollHandler = function() { updateSearchTimelineViewport(track, viewport); };
  messagesEl.addEventListener("scroll", searchTimelineScrollHandler);
  updateSearchTimelineViewport(track, viewport);
}

function updateSearchTimelineViewport(track, viewport) {
  if (!track) return;
  var messagesEl = ctx.messagesEl;
  var scrollH = messagesEl.scrollHeight;
  var viewH = messagesEl.clientHeight;
  if (scrollH <= viewH) {
    viewport.style.top = "0";
    viewport.style.height = "100%";
  } else {
    var viewTop = messagesEl.scrollTop / scrollH;
    var viewBot = (messagesEl.scrollTop + viewH) / scrollH;
    viewport.style.top = (viewTop * 100) + "%";
    viewport.style.height = ((viewBot - viewTop) * 100) + "%";
  }

  var markers = track.querySelectorAll(".search-hit-marker");
  var vTop = messagesEl.scrollTop;
  var vBot = vTop + viewH;

  for (var i = 0; i < markers.length; i++) {
    var msgTop = parseInt(markers[i].dataset.offsetTop, 10);
    if (msgTop >= vTop && msgTop <= vBot) {
      markers[i].classList.add("in-view");
    } else {
      markers[i].classList.remove("in-view");
    }
  }
}

export function removeSearchTimeline() {
  var existing = document.getElementById("search-timeline");
  if (existing) existing.remove();
  if (searchTimelineScrollHandler && ctx.messagesEl) {
    ctx.messagesEl.removeEventListener("scroll", searchTimelineScrollHandler);
    searchTimelineScrollHandler = null;
  }
  activeSearchQuery = "";
}
