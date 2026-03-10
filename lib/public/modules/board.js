// Board module — TOTE Command Post view
// Renders GTD areas, projects, and sessions as an interactive workspace board

var ctx;
var boardEl;
var boardData = null;
var expandedArea = null;
var expandedProject = null;
var boardVisible = false;

export function initBoard(context) {
  ctx = context;
  boardEl = ctx.$("board-view");
}

export function showBoard() {
  boardVisible = true;
  boardEl.classList.remove("hidden");
  fetchBoard();
}

export function hideBoard() {
  boardVisible = false;
  boardEl.classList.add("hidden");
  expandedArea = null;
  expandedProject = null;
}

export function isBoardVisible() {
  return boardVisible;
}

export function updateBoardSessions() {
  if (boardVisible && !expandedArea && !expandedProject) {
    fetchBoard();
  }
}

function fetchBoard() {
  fetch(ctx.basePath + "api/board")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      boardData = data;
      if (expandedArea) {
        renderAreaDetail(expandedArea);
      } else if (expandedProject) {
        renderProjectDetail(expandedProject.area, expandedProject.project);
      } else {
        renderBoard(data);
      }
    })
    .catch(function (err) {
      boardEl.innerHTML = '<div class="board-error">Failed to load board: ' + err.message + '</div>';
    });
}

// --- Area icons ---
var AREA_ICONS = {
  chatting: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  marketing: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  finance: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  strategy: '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>',
  content: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  hiring: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  personal: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

function areaIcon(name) {
  var d = AREA_ICONS[name] || '<rect x="3" y="3" width="18" height="18" rx="2"/>';
  return '<svg class="board-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
}

// --- Clean gap text: strip markdown bullets/bold, condense ---
function cleanGap(text) {
  if (!text) return "";
  return text
    .replace(/^[-*]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Main board ---
function renderBoard(data) {
  // Split into active areas (have projects or TOTE) and empty
  var active = [];
  var empty = [];
  for (var i = 0; i < data.areas.length; i++) {
    if (data.areas[i].projects.length > 0 || data.areas[i].presentState) {
      active.push(data.areas[i]);
    } else {
      empty.push(data.areas[i]);
    }
  }

  var html = '<div class="board-scroll">';
  html += '<div class="board-header">';
  html += '<div class="board-header-left">';
  html += '<h2 class="board-title">Command Post</h2>';
  html += '<span class="board-subtitle">' + active.length + ' areas &middot; ' + countAllProjects(data) + ' projects &middot; ' + data.looseSessions.length + ' sessions</span>';
  html += '</div>';
  html += '<button class="board-refresh-btn" id="board-refresh" title="Refresh">';
  html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  html += '</button>';
  html += '</div>';

  // Active areas
  html += '<div class="board-areas">';
  for (var i = 0; i < active.length; i++) {
    html += renderAreaCard(active[i]);
  }
  html += '</div>';

  // Empty areas as small pills
  if (empty.length > 0) {
    html += '<div class="board-empty-areas">';
    for (var i = 0; i < empty.length; i++) {
      html += '<div class="board-empty-pill" data-area="' + empty[i].name + '">';
      html += areaIcon(empty[i].name);
      html += '<span>' + escapeHtml(formatName(empty[i].name)) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Loose sessions
  if (data.looseSessions.length > 0) {
    html += '<div class="board-loose">';
    html += '<div class="board-loose-header">';
    html += '<h3 class="board-section-title">Unlinked Sessions</h3>';
    html += '<span class="board-loose-count">' + data.looseSessions.length + '</span>';
    html += '</div>';
    html += '<div class="board-loose-list">';
    // Show most recent first, limit to 20
    var sorted = data.looseSessions.slice().sort(function (a, b) { return (b.lastActivity || 0) - (a.lastActivity || 0); });
    var showCount = Math.min(sorted.length, 20);
    for (var li = 0; li < showCount; li++) {
      var ls = sorted[li];
      var age = timeAgo(ls.lastActivity);
      html += '<div class="board-loose-session" data-session="' + ls.id + '">';
      html += '<span class="board-loose-indicator ' + (ls.isProcessing ? 'active' : '') + '"></span>';
      html += '<span class="board-loose-name">' + escapeHtml(truncate(ls.title || "Untitled", 50)) + '</span>';
      html += '<span class="board-loose-age">' + age + '</span>';
      html += '</div>';
    }
    if (sorted.length > 20) {
      html += '<div class="board-loose-more">+' + (sorted.length - 20) + ' older sessions</div>';
    }
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  boardEl.innerHTML = html;
  attachBoardEvents();
}

function renderAreaCard(area) {
  var totalSessions = 0;
  var activeSessions = 0;
  for (var j = 0; j < area.projects.length; j++) {
    totalSessions += area.projects[j].sessions.length;
    for (var k = 0; k < area.projects[j].sessions.length; k++) {
      if (area.projects[j].sessions[k].isProcessing) activeSessions++;
    }
  }

  var gap = cleanGap(area.presentState);
  var goal = cleanGap(area.desiredState);

  var html = '<div class="board-area" data-area="' + area.name + '">';

  // Header
  html += '<div class="board-area-header">';
  html += areaIcon(area.name);
  html += '<h3 class="board-area-name">' + escapeHtml(formatName(area.name)) + '</h3>';
  html += '<div class="board-area-badges">';
  if (area.projects.length > 0) {
    html += '<span class="board-badge">' + area.projects.length + 'p</span>';
  }
  if (totalSessions > 0) {
    html += '<span class="board-badge active">' + totalSessions + 's</span>';
  }
  html += '</div>';
  html += '</div>';

  // Gap
  if (gap || goal) {
    html += '<div class="board-area-gap">';
    if (gap) {
      html += '<div class="board-gap-line">';
      html += '<span class="board-gap-dot now"></span>';
      html += '<span class="board-gap-text">' + escapeHtml(truncate(gap, 100)) + '</span>';
      html += '</div>';
    }
    if (goal) {
      html += '<div class="board-gap-line">';
      html += '<span class="board-gap-dot goal"></span>';
      html += '<span class="board-gap-text">' + escapeHtml(truncate(goal, 100)) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Projects
  if (area.projects.length > 0) {
    html += '<div class="board-projects">';
    for (var j = 0; j < area.projects.length; j++) {
      var proj = area.projects[j];
      var hasActive = proj.sessions.some(function (s) { return s.isProcessing; });
      html += '<div class="board-card" data-area="' + area.name + '" data-project="' + proj.name + '">';
      html += '<span class="board-card-indicator ' + (hasActive ? 'active' : proj.sessions.length > 0 ? 'has-sessions' : '') + '"></span>';
      html += '<span class="board-card-name">' + escapeHtml(formatName(proj.name)) + '</span>';
      if (proj.sessions.length > 0) {
        html += '<span class="board-card-count">' + proj.sessions.length + '</span>';
      }
      if (proj.subProjects.length > 0) {
        html += '<span class="board-card-subs-count">' + proj.subProjects.length + ' sub</span>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// --- Area detail ---
function renderAreaDetail(areaName) {
  var area = findArea(areaName);
  if (!area) { renderBoard(boardData); return; }

  fetch(ctx.basePath + "api/board/file?path=" + encodeURIComponent(areaName + "/" + areaName + ".md"))
    .then(function (r) { return r.text(); })
    .then(function (doc) {
      var html = '<div class="board-scroll"><div class="board-detail">';

      // Breadcrumb
      html += '<div class="board-breadcrumb">';
      html += '<button class="board-crumb" id="board-back">Command Post</button>';
      html += '<span class="board-crumb-sep">/</span>';
      html += '<span class="board-crumb-current">' + escapeHtml(formatName(area.name)) + '</span>';
      html += '</div>';

      // Title + icon
      html += '<div class="board-detail-header">';
      html += areaIcon(area.name);
      html += '<h2 class="board-detail-title">' + escapeHtml(formatName(area.name)) + '</h2>';
      html += '</div>';

      // TOTE grid
      html += '<div class="board-tote">' + renderToteSections(doc) + '</div>';

      // Projects
      if (area.projects.length > 0) {
        html += '<div class="board-detail-section">';
        html += '<h3 class="board-section-title">Projects</h3>';
        html += '<div class="board-detail-projects">';
        for (var j = 0; j < area.projects.length; j++) {
          var proj = area.projects[j];
          var hasActive = proj.sessions.some(function (s) { return s.isProcessing; });
          html += '<div class="board-card board-card-wide" data-area="' + area.name + '" data-project="' + proj.name + '">';
          html += '<span class="board-card-indicator ' + (hasActive ? 'active' : proj.sessions.length > 0 ? 'has-sessions' : '') + '"></span>';
          html += '<div class="board-card-info">';
          html += '<span class="board-card-name">' + escapeHtml(formatName(proj.name)) + '</span>';
          if (proj.subProjects.length > 0) {
            html += '<span class="board-card-meta">' + proj.subProjects.length + ' sub-projects</span>';
          }
          html += '</div>';
          if (proj.sessions.length > 0) {
            html += '<span class="board-card-count">' + proj.sessions.length + '</span>';
          }
          html += '<span class="board-card-arrow">&rsaquo;</span>';
          html += '</div>';
        }
        html += '</div>';
        html += '</div>';
      }

      // Launch
      html += '<div class="board-launch-section">';
      html += '<button class="board-launch-btn" data-area="' + area.name + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
      html += ' Start session for ' + escapeHtml(formatName(area.name));
      html += '</button>';
      html += '</div>';

      html += '</div></div>';
      boardEl.innerHTML = html;
      attachBoardEvents();
    });
}

// --- Project detail ---
function renderProjectDetail(areaName, projectName) {
  var area = findArea(areaName);
  var proj = area ? findProject(area, projectName) : null;
  if (!area || !proj) { renderBoard(boardData); return; }

  var docPath = proj.isDir
    ? areaName + "/01-projects/" + projectName + "/" + projectName + ".md"
    : areaName + "/01-projects/" + projectName + ".md";

  fetch(ctx.basePath + "api/board/file?path=" + encodeURIComponent(docPath))
    .then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (doc) {
      var html = '<div class="board-scroll"><div class="board-detail">';

      // Breadcrumb
      html += '<div class="board-breadcrumb">';
      html += '<button class="board-crumb" id="board-back">Command Post</button>';
      html += '<span class="board-crumb-sep">/</span>';
      html += '<button class="board-crumb" id="board-back-area" data-area="' + areaName + '">' + escapeHtml(formatName(areaName)) + '</button>';
      html += '<span class="board-crumb-sep">/</span>';
      html += '<span class="board-crumb-current">' + escapeHtml(formatName(proj.name)) + '</span>';
      html += '</div>';

      html += '<h2 class="board-detail-title">' + escapeHtml(formatName(proj.name)) + '</h2>';

      // Two-column: doc + sidebar
      html += '<div class="board-project-layout">';

      // Left: doc
      html += '<div class="board-project-main">';
      if (doc) {
        html += '<div class="board-project-doc">' + renderSimpleMarkdown(doc) + '</div>';
      } else {
        html += '<div class="board-project-doc board-empty-doc">No project doc found</div>';
      }
      html += '</div>';

      // Right: sessions + sub-projects
      html += '<div class="board-project-sidebar">';

      // Sub-projects
      if (proj.subProjects.length > 0) {
        html += '<div class="board-sidebar-section">';
        html += '<h4>Sub-projects</h4>';
        for (var si = 0; si < proj.subProjects.length; si++) {
          html += '<div class="board-sidebar-item">';
          html += '<span class="board-sidebar-bullet"></span>';
          html += escapeHtml(formatName(proj.subProjects[si]));
          html += '</div>';
        }
        html += '</div>';
      }

      // Sessions
      html += '<div class="board-sidebar-section">';
      html += '<h4>Sessions</h4>';
      if (proj.sessions.length > 0) {
        for (var si = 0; si < proj.sessions.length; si++) {
          var s = proj.sessions[si];
          html += '<div class="board-session-item" data-session="' + s.id + '">';
          html += '<span class="board-session-indicator ' + (s.isProcessing ? 'active' : '') + '"></span>';
          html += '<span>' + escapeHtml(s.title || "Untitled") + '</span>';
          html += '</div>';
        }
      } else {
        html += '<div class="board-empty-note">No sessions linked yet</div>';
      }
      html += '</div>';

      html += '</div>'; // sidebar
      html += '</div>'; // layout

      // Launch
      html += '<div class="board-launch-section">';
      html += '<button class="board-launch-btn" data-area="' + areaName + '" data-project="' + proj.name + '" data-project-path="' + proj.path + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
      html += ' Start session';
      html += '</button>';
      html += '</div>';

      html += '</div></div>';
      boardEl.innerHTML = html;
      attachBoardEvents();
    });
}

// --- TOTE sections ---
function renderToteSections(doc) {
  var html = '';
  var sections = [
    { label: "Present State", cls: "now", pattern: /\*\*Present State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Desired State|\*\*Test|\*\*Operations|\*\*Exit|$)/i },
    { label: "Desired State", cls: "goal", pattern: /\*\*Desired State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Test|\*\*Operations|\*\*Exit|$)/i },
    { label: "Tests", cls: "test", pattern: /\*\*Test[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Operations|\*\*Exit|$)/i },
    { label: "Operations", cls: "ops", pattern: /\*\*Operations[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Exit|$)/i },
  ];

  for (var i = 0; i < sections.length; i++) {
    var match = doc.match(sections[i].pattern);
    if (match && match[1].trim()) {
      html += '<div class="board-tote-section board-tote-' + sections[i].cls + '">';
      html += '<div class="board-tote-label">' + sections[i].label + '</div>';
      html += '<div class="board-tote-content">' + renderSimpleMarkdown(match[1].trim()) + '</div>';
      html += '</div>';
    }
  }
  return html;
}

// --- Simple markdown renderer ---
function renderSimpleMarkdown(text) {
  var lines = text.split("\n");
  var html = "";
  var inList = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed) {
      if (inList) { html += "</ul>"; inList = false; }
      continue;
    }
    if (trimmed.match(/^[-*]\s/)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + formatInline(trimmed.replace(/^[-*]\s+/, "")) + "</li>";
    } else if (trimmed.match(/^#{1,4}\s/)) {
      if (inList) { html += "</ul>"; inList = false; }
      var level = trimmed.match(/^(#+)/)[1].length;
      var tag = "h" + Math.min(level + 2, 6);
      html += "<" + tag + ">" + formatInline(trimmed.replace(/^#+\s+/, "")) + "</" + tag + ">";
    } else if (trimmed.match(/^\|.*\|$/)) {
      if (inList) { html += "</ul>"; inList = false; }
      // Render table rows
      html += '<div class="board-table-row">' + formatInline(trimmed) + '</div>';
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += "<p>" + formatInline(trimmed) + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

// --- Event binding ---
function attachBoardEvents() {
  var on = function (id, fn) {
    var el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  on("board-refresh", function () { fetchBoard(); });

  on("board-back", function () {
    expandedArea = null;
    expandedProject = null;
    renderBoard(boardData);
  });

  on("board-back-area", function () {
    expandedProject = null;
    var btn = document.getElementById("board-back-area");
    expandedArea = btn.dataset.area;
    renderAreaDetail(expandedArea);
  });

  // Area clicks
  boardEl.querySelectorAll(".board-area-header, .board-empty-pill").forEach(function (el) {
    el.onclick = function () {
      var areaName = (this.closest(".board-area") || this).dataset.area;
      expandedArea = areaName;
      expandedProject = null;
      renderAreaDetail(areaName);
    };
  });

  // Card clicks
  boardEl.querySelectorAll(".board-card").forEach(function (el) {
    el.onclick = function () {
      expandedProject = { area: this.dataset.area, project: this.dataset.project };
      expandedArea = null;
      renderProjectDetail(this.dataset.area, this.dataset.project);
    };
  });

  // Session clicks
  boardEl.querySelectorAll("[data-session]").forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation();
      if (ctx.onSessionOpen) ctx.onSessionOpen(this.dataset.session);
    };
  });

  // Launch buttons
  boardEl.querySelectorAll(".board-launch-btn").forEach(function (el) {
    el.onclick = function () {
      if (ctx.onLaunchSession) ctx.onLaunchSession(this.dataset.area, this.dataset.projectPath || null);
    };
  });
}

// --- Helpers ---

function findArea(name) {
  for (var i = 0; i < boardData.areas.length; i++) {
    if (boardData.areas[i].name === name) return boardData.areas[i];
  }
  return null;
}

function findProject(area, name) {
  for (var i = 0; i < area.projects.length; i++) {
    if (area.projects[i].name === name) return area.projects[i];
  }
  return null;
}

function countAllProjects(data) {
  var n = 0;
  for (var i = 0; i < data.areas.length; i++) n += data.areas[i].projects.length;
  return n;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.substring(0, len).replace(/\s+\S*$/, "") + "...";
}

function formatName(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function timeAgo(ts) {
  if (!ts) return "";
  var diff = Date.now() - ts;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h";
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + "d";
  return Math.floor(days / 30) + "mo";
}
