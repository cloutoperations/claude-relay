// Workspace module — side rail session browser + ambient state tracking

var ctx;
var railEl;
var wrapperEl;
var enabled = false;
var sessions = [];           // cached session list
var ambientState = {};       // sessionId -> { status, permissionRequest, lastEvent, doneText }

export function initWorkspace(context) {
  ctx = context;
  railEl = ctx.$("workspace-rail");
  wrapperEl = ctx.$("workspace-wrapper");
}

export function enableWorkspace() {
  if (enabled) return;
  enabled = true;
  railEl.classList.remove("hidden");
  wrapperEl.classList.add("workspace-active");
  renderRail();
}

export function disableWorkspace() {
  enabled = false;
  railEl.classList.add("hidden");
  wrapperEl.classList.remove("workspace-active");
}

export function isWorkspaceEnabled() {
  return enabled;
}

export function setFocusedSession(sessionId) {
  // no-op now, kept for API compat
}

export function updateSessions(sessionList) {
  sessions = sessionList || [];
  if (enabled) {
    renderRail();
  }
}

export function handleAmbientEvent(sessionId, event) {
  if (!ambientState[sessionId]) {
    ambientState[sessionId] = {};
  }
  var s = ambientState[sessionId];

  if (event.type === "status") {
    s.status = event.status;
  } else if (event.type === "permission_request") {
    s.permissionRequest = event;
    s.needsAttention = true;
  } else if (event.type === "done") {
    s.status = "idle";
    s.needsAttention = false;
    s.permissionRequest = null;
    s.askUser = null;
  } else if (event.type === "ask_user") {
    s.askUser = event;
    s.needsAttention = true;
  }

  s.lastEventTime = Date.now();

  if (enabled) {
    renderRail();
  }
}

// --- Side rail: full session browser ---
function renderRail() {
  if (!sessions.length) {
    railEl.innerHTML = '<div class="ws-rail-empty">No sessions yet</div>';
    return;
  }

  // Sort: needs attention first, then processing, then recent activity
  var sorted = sessions.slice().sort(function (a, b) {
    var aAmb = ambientState[a.id] || {};
    var bAmb = ambientState[b.id] || {};
    // Needs attention first
    var aAttn = (aAmb.needsAttention || aAmb.permissionRequest || aAmb.askUser) ? 1 : 0;
    var bAttn = (bAmb.needsAttention || bAmb.permissionRequest || bAmb.askUser) ? 1 : 0;
    if (aAttn !== bAttn) return bAttn - aAttn;
    // Processing next
    var aProc = (a.isProcessing || aAmb.status === "processing") ? 1 : 0;
    var bProc = (b.isProcessing || bAmb.status === "processing") ? 1 : 0;
    if (aProc !== bProc) return bProc - aProc;
    // Recent activity
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var html = '<div class="ws-rail-header">Sessions</div>';
  html += '<div class="ws-rail-list">';

  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var amb = ambientState[s.id] || {};
    var statusCls = "idle";
    var statusText = "";

    if (s.isProcessing || amb.status === "processing") {
      statusCls = "processing";
      statusText = "processing\u2026";
    }
    // Only show permission/question if actively pending (not stale)
    if (amb.permissionRequest) {
      statusCls = "permission";
      statusText = "";
    } else if (amb.askUser) {
      statusCls = "question";
      statusText = "needs input";
    }
    // Don't show "done" — it's stale state. Idle is the default.

    html += '<div class="ws-rail-item ws-rail-' + statusCls + '" data-session="' + s.id + '" title="' + escapeHtml(s.title || "Untitled") + '">';
    html += '<div class="ws-rail-item-header">';
    html += '<span class="ws-rail-dot"></span>';
    html += '<span class="ws-rail-title">' + escapeHtml(s.title || "Untitled") + '</span>';
    html += '</div>';

    if (amb.permissionRequest) {
      var pr = amb.permissionRequest;
      var toolName = pr.toolName || "tool";
      html += '<div class="ws-rail-permission">';
      html += '<div class="ws-rail-perm-text">' + escapeHtml(toolName) + '</div>';
      html += '<div class="ws-rail-perm-actions">';
      html += '<button class="ws-rail-btn ws-rail-allow" data-session="' + s.id + '" data-request="' + (pr.requestId || "") + '">Allow</button>';
      html += '<button class="ws-rail-btn ws-rail-deny" data-session="' + s.id + '" data-request="' + (pr.requestId || "") + '">Deny</button>';
      html += '</div>';
      html += '</div>';
    } else if (statusText) {
      html += '<div class="ws-rail-status">' + statusText + '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  railEl.innerHTML = html;

  // Events — click to open popup
  railEl.querySelectorAll(".ws-rail-item").forEach(function (el) {
    el.onclick = function (e) {
      if (e.target.closest(".ws-rail-btn")) return;
      if (ctx.onSessionSwitch) ctx.onSessionSwitch(this.dataset.session);
    };
  });

  // Permission actions
  railEl.querySelectorAll(".ws-rail-allow").forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation();
      var sid = this.dataset.session;
      var rid = this.dataset.request;
      if (ctx.onPermissionResponse) ctx.onPermissionResponse(sid, rid, "allow");
      if (ambientState[sid]) {
        ambientState[sid].permissionRequest = null;
        ambientState[sid].needsAttention = false;
      }
      renderRail();
    };
  });

  railEl.querySelectorAll(".ws-rail-deny").forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation();
      var sid = this.dataset.session;
      var rid = this.dataset.request;
      if (ctx.onPermissionResponse) ctx.onPermissionResponse(sid, rid, "deny");
      if (ambientState[sid]) {
        ambientState[sid].permissionRequest = null;
        ambientState[sid].needsAttention = false;
      }
      renderRail();
    };
  });
}

// --- Helpers ---
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
