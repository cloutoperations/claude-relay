// Chat Popup module — LinkedIn/Messenger-style floating session windows

var ctx;
var containerEl;
var popups = {};         // sessionId -> popup state
var MAX_POPUPS = 5;

export function initChatPopups(context) {
  ctx = context;
  containerEl = document.getElementById("chat-popups");
}

export function openPopup(sessionId, title) {
  // Already open? Un-minimize and focus
  if (popups[sessionId]) {
    var p = popups[sessionId];
    if (p.minimized) toggleMinimize(sessionId);
    scrollToBottom(p);
    p.inputEl.focus();
    return;
  }

  // Enforce max popups — close the oldest minimized one, or minimize+close the oldest
  var ids = Object.keys(popups);
  if (ids.length >= MAX_POPUPS) {
    // Find a minimized popup to close first
    var toClose = null;
    for (var i = 0; i < ids.length; i++) {
      if (popups[ids[i]].minimized) { toClose = ids[i]; break; }
    }
    // If none minimized, close the oldest open one
    if (!toClose) toClose = ids[0];
    closePopup(toClose);
  }

  var p = createPopupState(sessionId, title || "Session");
  popups[sessionId] = p;
  containerEl.appendChild(p.el);
  lucide.createIcons({ nodes: [p.el] });

  // Tell server to start streaming this session's data
  if (ctx.sendWs) {
    ctx.sendWs({ type: "popup_open", sessionId: sessionId });
  }

  p.inputEl.focus();
}

export function closePopup(sessionId) {
  var p = popups[sessionId];
  if (!p) return;
  p.el.remove();
  delete popups[sessionId];

  if (ctx.sendWs) {
    ctx.sendWs({ type: "popup_close", sessionId: sessionId });
  }
}

export function isPopupOpen(sessionId) {
  return !!popups[sessionId];
}

export function getOpenPopupIds() {
  return Object.keys(popups);
}

// Route an incoming WS message to the correct popup
export function routePopupMessage(sessionId, msg) {
  var p = popups[sessionId];
  if (!p) return;

  var t = msg.type;

  if (t === "popup_history_start") {
    p.bodyEl.innerHTML = "";
    p.loadingHistory = true;
    return;
  }

  if (t === "popup_history_done") {
    p.loadingHistory = false;
    scrollToBottom(p);
    return;
  }

  if (t === "user_message") {
    appendUserMessage(p, msg.text || "");
    if (!p.loadingHistory) scrollToBottom(p);
    return;
  }

  if (t === "delta" || t === "assistant_delta") {
    hideThinking(p);  // Clear thinking indicator when real content arrives
    appendDelta(p, msg.text || msg.delta || "");
    if (!p.loadingHistory) scrollToBottom(p);
    return;
  }

  if (t === "thinking_start") {
    p.thinking = true;
    showThinking(p);
    return;
  }

  if (t === "thinking_delta") {
    // Just keep the indicator alive
    return;
  }

  if (t === "thinking_stop") {
    p.thinking = false;
    hideThinking(p);
    return;
  }

  if (t === "tool_start") {
    hideThinking(p);
    finishAssistantBlock(p);
    appendTool(p, msg.toolName || msg.name || "tool", "running", msg.toolUseId);
    if (!p.loadingHistory) scrollToBottom(p);
    return;
  }

  if (t === "tool_executing") {
    updateTool(p, msg.toolUseId, "running");
    return;
  }

  if (t === "tool_result") {
    updateTool(p, msg.toolUseId, msg.is_error ? "error" : "done");
    return;
  }

  if (t === "permission_request" || t === "permission_request_pending") {
    finishAssistantBlock(p);
    appendPermission(p, msg);
    updatePopupStatus(p, "permission");
    if (p.minimized) p.el.classList.add("has-unread");
    if (!p.loadingHistory) scrollToBottom(p);
    return;
  }

  if (t === "permission_resolved" || t === "permission_cancel") {
    resolvePermission(p, msg.requestId, msg.decision || "cancel");
    updatePopupStatus(p, p.processing ? "processing" : "idle");
    return;
  }

  if (t === "ask_user") {
    finishAssistantBlock(p);
    // Render as a simple info line for now
    appendInfo(p, "Claude is asking: " + (msg.question || ""));
    return;
  }

  if (t === "status") {
    p.processing = msg.status === "processing";
    updatePopupStatus(p, msg.status);
    return;
  }

  if (t === "result") {
    finishAssistantBlock(p);
    p.processing = false;
    return;
  }

  if (t === "done") {
    finishAssistantBlock(p);
    p.processing = false;
    updatePopupStatus(p, "done");
    if (p.minimized) p.el.classList.add("has-unread");
    return;
  }

  if (t === "info") {
    appendInfo(p, msg.text || "");
    return;
  }

  if (t === "title_update") {
    p.titleEl.textContent = msg.title || "Session";
    p.title = msg.title || "Session";
    return;
  }

  if (t === "error") {
    finishAssistantBlock(p);
    appendInfo(p, "Error: " + (msg.text || msg.message || "Unknown error"));
    if (p.minimized) p.el.classList.add("has-unread");
    return;
  }

  if (t === "compacting") {
    appendInfo(p, "Compacting context...");
    return;
  }

  if (t === "subagent_activity" || t === "subagent_tool" || t === "subagent_done") {
    // Simplified: show as tool-like entries
    if (t === "subagent_activity") appendTool(p, "Agent: " + (msg.title || "subagent"), "running", msg.agentId);
    if (t === "subagent_done") updateTool(p, msg.agentId, "done");
    return;
  }

  // Silently ignore types we don't render in popups:
  // history_meta, history_prepend, history_done, context_usage, message_uuid,
  // session_switched, session_list, client_count, rewind_*, slash_command_result, etc.
}

// Update session title if it changes (from session list updates)
export function updatePopupTitle(sessionId, title) {
  var p = popups[sessionId];
  if (p && title) {
    p.titleEl.textContent = title;
    p.title = title;
  }
}

// --- Internal ---

function createPopupState(sessionId, title) {
  var el = document.createElement("div");
  el.className = "chat-popup";
  el.dataset.session = sessionId;

  el.innerHTML =
    '<div class="chat-popup-header">' +
      '<span class="chat-popup-dot"></span>' +
      '<span class="chat-popup-title">' + escapeHtml(truncate(title, 30)) + '</span>' +
      '<div class="chat-popup-actions">' +
        '<button class="cp-btn-minimize" title="Minimize"><i data-lucide="minus"></i></button>' +
        '<button class="cp-btn-expand" title="Open full"><i data-lucide="maximize-2"></i></button>' +
        '<button class="cp-btn-close" title="Close"><i data-lucide="x"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="chat-popup-body"></div>' +
    '<div class="chat-popup-input-area">' +
      '<textarea class="chat-popup-input" rows="1" placeholder="Message..." enterkeyhint="send"></textarea>' +
      '<button class="chat-popup-send" title="Send"><i data-lucide="arrow-up"></i></button>' +
    '</div>';

  var bodyEl = el.querySelector(".chat-popup-body");
  var inputEl = el.querySelector(".chat-popup-input");
  var sendBtn = el.querySelector(".chat-popup-send");
  var titleEl = el.querySelector(".chat-popup-title");

  // Header click = toggle minimize
  el.querySelector(".chat-popup-header").addEventListener("click", function (e) {
    if (e.target.closest(".chat-popup-actions")) return;
    toggleMinimize(sessionId);
  });

  el.querySelector(".cp-btn-minimize").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleMinimize(sessionId);
  });

  el.querySelector(".cp-btn-expand").addEventListener("click", function (e) {
    e.stopPropagation();
    closePopup(sessionId);
    if (ctx.onExpand) ctx.onExpand(sessionId);
  });

  el.querySelector(".cp-btn-close").addEventListener("click", function (e) {
    e.stopPropagation();
    closePopup(sessionId);
  });

  // Input handling
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPopupMessage(sessionId);
    }
  });

  inputEl.addEventListener("input", function () {
    // Auto-resize
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 100) + "px";
  });

  sendBtn.addEventListener("click", function () {
    sendPopupMessage(sessionId);
  });

  return {
    el: el,
    bodyEl: bodyEl,
    inputEl: inputEl,
    sendBtn: sendBtn,
    titleEl: titleEl,
    sessionId: sessionId,
    title: title,
    minimized: false,
    processing: false,
    thinking: false,
    loadingHistory: false,
    currentAssistantEl: null,
    currentFullText: "",
    tools: {},            // toolUseId -> el
    thinkingEl: null,
  };
}

function toggleMinimize(sessionId) {
  var p = popups[sessionId];
  if (!p) return;
  p.minimized = !p.minimized;
  p.el.classList.toggle("minimized", p.minimized);
  if (!p.minimized) {
    p.el.classList.remove("has-unread");
    scrollToBottom(p);
    p.inputEl.focus();
  }
}

function sendPopupMessage(sessionId) {
  var p = popups[sessionId];
  if (!p) return;
  var text = p.inputEl.value.trim();
  if (!text) return;
  p.inputEl.value = "";
  p.inputEl.style.height = "auto";

  // Show locally
  appendUserMessage(p, text);
  // Show processing indicator immediately
  p.processing = true;
  updatePopupStatus(p, "processing");
  showThinking(p);
  scrollToBottom(p);

  // Send to server
  if (ctx.sendWs) {
    ctx.sendWs({ type: "popup_message", sessionId: sessionId, text: text });
  }
}

function appendUserMessage(p, text) {
  var el = document.createElement("div");
  el.className = "cp-msg-user";
  el.textContent = text;
  p.bodyEl.appendChild(el);
}

function appendDelta(p, text) {
  if (!p.currentAssistantEl) {
    p.currentAssistantEl = document.createElement("div");
    p.currentAssistantEl.className = "cp-msg-assistant";
    p.currentAssistantEl.innerHTML = '<div class="md-content"></div>';
    p.bodyEl.appendChild(p.currentAssistantEl);
    p.currentFullText = "";
  }
  p.currentFullText += text;
  var mdEl = p.currentAssistantEl.querySelector(".md-content");
  if (ctx.renderMarkdown) {
    mdEl.innerHTML = ctx.renderMarkdown(p.currentFullText);
  } else {
    mdEl.textContent = p.currentFullText;
  }
}

function finishAssistantBlock(p) {
  if (p.currentAssistantEl) {
    // Highlight code blocks
    var codeBlocks = p.currentAssistantEl.querySelectorAll("pre code");
    for (var i = 0; i < codeBlocks.length; i++) {
      try { hljs.highlightElement(codeBlocks[i]); } catch (e) {}
    }
    p.currentAssistantEl = null;
    p.currentFullText = "";
  }
}

function appendTool(p, toolName, status, toolUseId) {
  var el = document.createElement("div");
  el.className = "cp-tool cp-tool-" + status;
  if (toolUseId) el.dataset.toolId = toolUseId;

  var icon = status === "running" ? "loader" : status === "error" ? "alert-circle" : "check-circle";
  el.innerHTML = '<i data-lucide="' + icon + '" class="cp-tool-icon"></i> <span>' + escapeHtml(formatToolName(toolName)) + '</span>';
  p.bodyEl.appendChild(el);
  try { lucide.createIcons({ nodes: [el] }); } catch (e) {}

  if (toolUseId) p.tools[toolUseId] = el;
}

function updateTool(p, toolUseId, status) {
  var el = p.tools[toolUseId];
  if (!el) return;
  el.className = "cp-tool cp-tool-" + status;
  var iconEl = el.querySelector(".cp-tool-icon");
  if (iconEl) {
    var icon = status === "running" ? "loader" : status === "error" ? "alert-circle" : "check-circle";
    iconEl.setAttribute("data-lucide", icon);
    try { lucide.createIcons({ nodes: [el] }); } catch (e) {}
  }
}

function appendPermission(p, msg) {
  var el = document.createElement("div");
  el.className = "cp-permission";
  el.dataset.requestId = msg.requestId || "";

  var toolName = msg.toolName || "tool";
  var inputSummary = "";
  if (msg.toolInput) {
    if (msg.toolInput.command) inputSummary = msg.toolInput.command;
    else if (msg.toolInput.file_path) inputSummary = msg.toolInput.file_path;
    else if (msg.toolInput.path) inputSummary = msg.toolInput.path;
  }

  el.innerHTML =
    '<div class="cp-perm-label">Permission request</div>' +
    '<div class="cp-perm-tool">' + escapeHtml(toolName) + (inputSummary ? ': ' + escapeHtml(truncate(inputSummary, 40)) : '') + '</div>' +
    '<div class="cp-perm-actions">' +
      '<button class="cp-perm-btn cp-perm-allow">Allow</button>' +
      '<button class="cp-perm-btn cp-perm-deny">Deny</button>' +
    '</div>';

  el.querySelector(".cp-perm-allow").addEventListener("click", function () {
    if (ctx.sendWs) {
      ctx.sendWs({ type: "popup_permission_response", sessionId: p.sessionId, requestId: msg.requestId, decision: "allow" });
    }
    resolvePermission(p, msg.requestId, "allow");
  });

  el.querySelector(".cp-perm-deny").addEventListener("click", function () {
    if (ctx.sendWs) {
      ctx.sendWs({ type: "popup_permission_response", sessionId: p.sessionId, requestId: msg.requestId, decision: "deny" });
    }
    resolvePermission(p, msg.requestId, "deny");
  });

  p.bodyEl.appendChild(el);
}

function resolvePermission(p, requestId, decision) {
  var el = p.bodyEl.querySelector('.cp-permission[data-request-id="' + requestId + '"]');
  if (!el) return;
  var actionsEl = el.querySelector(".cp-perm-actions");
  if (actionsEl) {
    actionsEl.innerHTML = '<span style="font-size:11px;color:var(--text-dimmer)">' + (decision === "allow" ? "Allowed" : decision === "deny" ? "Denied" : "Cancelled") + '</span>';
  }
  el.style.borderColor = "var(--border)";
  el.style.background = "none";
}

function showThinking(p) {
  if (p.thinkingEl) return;
  p.thinkingEl = document.createElement("div");
  p.thinkingEl.className = "cp-thinking";
  p.thinkingEl.textContent = "Thinking...";
  p.bodyEl.appendChild(p.thinkingEl);
  scrollToBottom(p);
}

function hideThinking(p) {
  if (p.thinkingEl) {
    p.thinkingEl.remove();
    p.thinkingEl = null;
  }
}

function appendInfo(p, text) {
  var el = document.createElement("div");
  el.className = "cp-info";
  el.textContent = text;
  p.bodyEl.appendChild(el);
}

function updatePopupStatus(p, status) {
  p.el.classList.remove("cp-processing", "cp-done", "cp-permission");
  if (status === "processing") p.el.classList.add("cp-processing");
  else if (status === "done") p.el.classList.add("cp-done");
  else if (status === "permission") p.el.classList.add("cp-permission");
}

function scrollToBottom(p) {
  requestAnimationFrame(function () {
    p.bodyEl.scrollTop = p.bodyEl.scrollHeight;
  });
}

function formatToolName(name) {
  // Convert tool names like "Read" "Edit" "Bash" to friendlier labels
  var map = {
    "Read": "Reading file",
    "Edit": "Editing file",
    "Write": "Writing file",
    "Bash": "Running command",
    "Glob": "Searching files",
    "Grep": "Searching code",
    "Agent": "Running agent",
    "WebSearch": "Searching web",
    "WebFetch": "Fetching URL",
  };
  return map[name] || name;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.substring(0, len) + "\u2026";
}
