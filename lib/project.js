var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { createSessionManager } = require("./sessions");
var { createSDKBridge } = require("./sdk-bridge");
var { createTerminalManager } = require("./terminal-manager");
var { execFileSync, execFile } = require("child_process");
var { fetchAllUsage } = require("./usage");
var agentTasks = require("./agent-tasks");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- Slash command expansion ---
// Reads .claude/commands/*.md and expands /commandname [args] into the full prompt
function expandSlashCommand(text, projectPath) {
  if (!text || !text.startsWith("/")) return text;
  var match = text.match(/^\/(\S+)\s*(.*)?$/s);
  if (!match) return text;
  var cmdName = match[1];
  var args = (match[2] || "").trim();

  // Skip built-in commands that aren't ours
  if (["help", "clear", "exit", "quit", "compact", "fast"].indexOf(cmdName) !== -1) return text;

  var cmdPath = path.join(projectPath, ".claude", "commands", cmdName + ".md");
  try {
    if (!fs.existsSync(cmdPath)) return text;
    var template = fs.readFileSync(cmdPath, "utf8");
    // Replace $ARGUMENTS placeholder with actual args
    var expanded = template.replace(/\$ARGUMENTS/g, args || "(none)");
    console.log("[cmd] Expanded /" + cmdName + " → " + expanded.length + " chars");
    return expanded;
  } catch (e) {
    return text;
  }
}

// --- Shared constants ---
var IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".cache", "dist", "build", ".claude-relay"]);
var BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".pyc", ".o", ".a", ".class",
]);
var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
var FS_MAX_SIZE = 512 * 1024;
var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safePath(base, requested) {
  var resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  // Reject symlinks before following them (lstat doesn't follow symlinks)
  try {
    var lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) return null;
  } catch (e) { /* new file, doesn't exist yet — OK */ }
  try {
    var real = fs.realpathSync(resolved);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

/**
 * Create a project context — per-project state and handlers.
 * opts: { cwd, slug, title, pushModule, debug, dangerouslySkipPermissions, currentVersion }
 */
function createProjectContext(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug;
  var project = path.basename(cwd);
  var title = opts.title || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var currentVersion = opts.currentVersion;
  var lanHost = opts.lanHost || null;
  var accountLabel = opts.accountLabel || null;
  var accounts = opts.accounts || [];
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };

  // Resolve account object from session's accountId (or default to first)
  function resolveAccount(session) {
    if (!accounts.length) return null;
    if (session && session.accountId) {
      for (var i = 0; i < accounts.length; i++) {
        if (accounts[i].name === session.accountId) return accounts[i];
      }
    }
    return accounts[0];
  }

  // --- Per-project clients ---
  var clients = new Map();  // ws -> { sessionId: cliSessionId string | null, popups: Set }
  var sessionViewers = {};  // sessionId -> Set<ws> — reverse index for fast viewer lookup

  function addViewer(sessionId, ws) {
    if (!sessionId) return;
    if (!sessionViewers[sessionId]) sessionViewers[sessionId] = new Set();
    sessionViewers[sessionId].add(ws);
  }

  function removeViewer(sessionId, ws) {
    if (!sessionId || !sessionViewers[sessionId]) return;
    sessionViewers[sessionId].delete(ws);
    if (sessionViewers[sessionId].size === 0) delete sessionViewers[sessionId];
  }

  function setClientSession(ws, newSessionId) {
    var state = clients.get(ws);
    if (!state) return;
    var oldSessionId = state.sessionId;
    if (oldSessionId === newSessionId) return;
    removeViewer(oldSessionId, ws);
    state.sessionId = newSessionId;
    addViewer(newSessionId, ws);
  }

  function send(obj) {
    var data = JSON.stringify(obj);
    for (var [ws] of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcastClientCount() {
    send({ type: "client_count", count: clients.size });
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var [ws] of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  function sendToSessionViewers(sessionId, obj) {
    var data = JSON.stringify(obj);
    var popupData = null; // lazy-build tagged version
    var sentCount = 0;
    // Use reverse index for primary viewers
    var viewers = sessionViewers[sessionId];
    if (viewers) {
      for (var ws of viewers) {
        if (ws.readyState === 1) {
          ws.send(data);
          sentCount++;
        }
      }
    }
    // Iterate clients for popup viewers (popups are less frequent, no reverse index needed)
    for (var [ws2, state] of clients) {
      if (ws2.readyState !== 1) continue;
      if (state.popups.has(sessionId)) {
        if (!popupData) popupData = JSON.stringify(Object.assign({}, obj, { _popupSessionId: sessionId }));
        ws2.send(popupData);
        sentCount++;
      }
    }
    if (sentCount === 0 && obj.type !== "status") {
      console.log("[project] WARNING: sendToSessionViewers found 0 viewers for session:", sessionId, "type:", obj.type, "clients:", clients.size, "popups:", Array.from(clients.values()).map(function(s) { return Array.from(s.popups); }));
    }
    // Ambient broadcast: send key events to non-viewers so side rail stays updated
    var t = obj.type;
    if (t === "permission_request" || t === "done" || t === "status" || t === "ask_user") {
      var ambient = JSON.stringify({ type: "ambient", sessionId: sessionId, event: obj });
      for (var [ws3, state2] of clients) {
        if (state2.sessionId !== sessionId && !state2.popups.has(sessionId) && ws3.readyState === 1) {
          ws3.send(ambient);
        }
      }
    }
  }

  function sendToSessionViewersExcept(sessionId, sender, obj) {
    var data = JSON.stringify(obj);
    var popupData = null;
    // Use reverse index for primary viewers
    var viewers = sessionViewers[sessionId];
    if (viewers) {
      for (var ws of viewers) {
        if (ws === sender || ws.readyState !== 1) continue;
        ws.send(data);
      }
    }
    // Iterate clients for popup viewers
    for (var [ws2, state] of clients) {
      if (ws2 === sender || ws2.readyState !== 1) continue;
      if (state.popups.has(sessionId)) {
        if (!popupData) popupData = JSON.stringify(Object.assign({}, obj, { _popupSessionId: sessionId }));
        ws2.send(popupData);
      }
    }
  }

  // --- File watcher ---
  var fileWatcher = null;
  var watchedPath = null;
  var watchDebounce = null;

  function startFileWatch(relPath) {
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (watchedPath === relPath) return;
    stopFileWatch();
    watchedPath = relPath;
    try {
      fileWatcher = fs.watch(absPath, function () {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(function () {
          try {
            var stat = fs.statSync(absPath);
            var ext = path.extname(absPath).toLowerCase();
            if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return;
            var content = fs.readFileSync(absPath, "utf8");
            send({ type: "fs_file_changed", path: relPath, content: content, size: stat.size });
          } catch (e) {
            stopFileWatch();
          }
        }, 200);
      });
      fileWatcher.on("error", function () { stopFileWatch(); });
    } catch (e) {
      watchedPath = null;
    }
  }

  function stopFileWatch() {
    if (fileWatcher) {
      try { fileWatcher.close(); } catch (e) {}
      fileWatcher = null;
    }
    clearTimeout(watchDebounce);
    watchDebounce = null;
    watchedPath = null;
  }

  // --- Directory watcher ---
  var dirWatchers = {};  // relPath -> { watcher, debounce }
  var dirWatcherOrder = []; // LRU list of relPaths
  var MAX_WATCHERS = 50;

  function startDirWatch(relPath) {
    if (dirWatchers[relPath]) return;
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    // Enforce watcher limit: close oldest (LRU) watcher before adding
    if (dirWatcherOrder.length >= MAX_WATCHERS) {
      var oldest = dirWatcherOrder.shift();
      stopDirWatch(oldest);
    }
    try {
      var watcherEntry = { watcher: null, debounce: null };
      var watcher = fs.watch(absPath, function () {
        clearTimeout(watcherEntry.debounce);
        watcherEntry.debounce = setTimeout(function () {
          // Re-read directory and broadcast to all clients
          try {
            var items = fs.readdirSync(absPath, { withFileTypes: true });
            var entries = [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
              entries.push({
                name: items[i].name,
                type: items[i].isDirectory() ? "dir" : "file",
                path: path.relative(cwd, path.join(absPath, items[i].name)).split(path.sep).join("/"),
              });
            }
            send({ type: "fs_dir_changed", path: relPath, entries: entries });
            // Invalidate search index so Cmd+O picks up new/deleted files
            _fileIndex = null;
            _fileIndexTime = 0;
          } catch (e) {
            stopDirWatch(relPath);
          }
        }, 300);
      });
      watcher.on("error", function () { stopDirWatch(relPath); });
      watcherEntry.watcher = watcher;
      dirWatchers[relPath] = watcherEntry;
      dirWatcherOrder.push(relPath);
    } catch (e) {}
  }

  function stopDirWatch(relPath) {
    var entry = dirWatchers[relPath];
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch (e) {}
      delete dirWatchers[relPath];
      var idx = dirWatcherOrder.indexOf(relPath);
      if (idx !== -1) dirWatcherOrder.splice(idx, 1);
    }
  }

  function stopAllDirWatches() {
    var paths = Object.keys(dirWatchers);
    for (var i = 0; i < paths.length; i++) {
      stopDirWatch(paths[i]);
    }
  }

  // --- Cached file index for search ---
  var _fileIndex = null;
  var _fileIndexTime = 0;
  var _fileIndexBuilding = false;
  var FILE_INDEX_TTL = 15000; // 15 seconds — faster refresh for new files

  var MAX_INDEX_DEPTH = 20;

  function buildFileIndexAsync() {
    if (_fileIndexBuilding) return Promise.resolve(_fileIndex || []);
    _fileIndexBuilding = true;
    return new Promise(function(resolve) {
      var entries = [];
      var stack = [{ dir: cwd, rel: "", depth: 0 }];
      function step() {
        var batch = 0;
        while (stack.length > 0 && batch < 50) {
          batch++;
          var item = stack.pop();
          if (item.depth > MAX_INDEX_DEPTH) continue;
          var items;
          try { items = fs.readdirSync(item.dir, { withFileTypes: true }); } catch (e) { continue; }
          for (var i = 0; i < items.length; i++) {
            var child = items[i];
            var rel = item.rel ? item.rel + "/" + child.name : child.name;
            if (child.isDirectory()) {
              if (IGNORED_DIRS.has(child.name)) continue;
              // Skip symlink directories
              if (child.isSymbolicLink()) continue;
              stack.push({ dir: path.join(item.dir, child.name), rel: rel, depth: item.depth + 1 });
            } else {
              entries.push({ name: child.name, nameLower: child.name.toLowerCase(), path: rel });
            }
          }
        }
        if (stack.length > 0) {
          setImmediate(step);
        } else {
          _fileIndex = entries;
          _fileIndexTime = Date.now();
          _fileIndexBuilding = false;
          resolve(entries);
        }
      }
      step();
    });
  }

  function getFileIndex() {
    var now = Date.now();
    if (!_fileIndex || now - _fileIndexTime > FILE_INDEX_TTL) {
      buildFileIndexAsync();
    }
    return _fileIndex || [];
  }

  // Pre-build index in background on startup
  buildFileIndexAsync();

  // --- Session manager ---
  var sm = createSessionManager({ cwd: cwd, send: send, accounts: accounts });
  sm.setSendToViewers(sendToSessionViewers);

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    sendToViewers: sendToSessionViewers,
    pushModule: pushModule,
    getSDK: getSDK,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    onSessionRekey: function(oldId, newId) {
      // Atomically move the reverse index entry from oldId to newId
      if (sessionViewers[oldId]) {
        sessionViewers[newId] = sessionViewers[oldId];
        delete sessionViewers[oldId];
        // Update all clients in the set to reflect the new sessionId
        for (var ws of sessionViewers[newId]) {
          var state = clients.get(ws);
          if (state) state.sessionId = newId;
        }
      }
      // Also update popup viewers
      for (var [ws2, state2] of clients) {
        if (state2.popups.has(oldId)) {
          state2.popups.delete(oldId);
          state2.popups.add(newId);
        }
      }
    },
    onFileChange: function(filePath) {
      // Invalidate file search index so Cmd+O finds new files immediately
      _fileIndex = null;
      _fileIndexTime = 0;
      // Refresh the parent directory in the file tree for all clients
      var absFilePath = safePath(cwd, filePath) || filePath;
      var parentDir = path.dirname(absFilePath);
      var relParent = path.relative(cwd, parentDir).split(path.sep).join("/") || ".";
      // Delay slightly to ensure the file is fully written
      setTimeout(function() {
        try {
          var items = fs.readdirSync(parentDir, { withFileTypes: true });
          var entries = [];
          for (var i = 0; i < items.length; i++) {
            if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
            entries.push({
              name: items[i].name,
              type: items[i].isDirectory() ? "dir" : "file",
              path: path.relative(cwd, path.join(parentDir, items[i].name)).split(path.sep).join("/"),
            });
          }
          send({ type: "fs_dir_changed", path: relParent, entries: entries });
        } catch (e) {}
        // Rebuild search index in background
        buildFileIndexAsync();
      }, 500);
    },
  });

  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });


  // --- WS connection handler ---
  var _warmedUp = false;
  function handleConnection(ws) {
    clients.set(ws, { sessionId: null, popups: new Set() });
    broadcastClientCount();
    // Lazy warmup on first client connection (not on startup — avoids blocking event loop)
    if (!_warmedUp) { _warmedUp = true; sdk.warmup(); }

    // Send cached state
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, lanHost: lanHost, accountLabel: accountLabel, accounts: accounts.map(function(a) { return { id: a.name, email: a.email }; }), projectCount: getProjectCount(), projects: getProjectList() });
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    // Send unified config state
    sendTo(ws, {
      type: "config_state",
      model: sm.currentModel || "",
      effort: sm.currentEffort || "",
      fastMode: sm.fastMode || false,
      permissionMode: sm.currentPermissionMode || "default",
    });
    sendTo(ws, { type: "term_list", terminals: tm.list() });

    // Session list (no active flag — client determines its own)
    sendTo(ws, {
      type: "session_list",
      sessions: [].concat(Array.from(sm.sessions.values())).map(function (s) {
        return {
          id: s.cliSessionId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
          accountId: s.accountId || null,
          projectPath: s.projectPath || null,
        };
      }),
    });

    // Determine which session this client should view
    var requestedSessionId = null;
    try {
      var urlParams = new URLSearchParams(ws._relayQuery || "");
      var sParam = urlParams.get("s");
      if (sParam) requestedSessionId = sParam;
    } catch(e) {}

    var targetSession = null;
    if (requestedSessionId && sm.sessions.has(requestedSessionId)) {
      targetSession = sm.sessions.get(requestedSessionId);
    } else {
      targetSession = sm.getDefaultSession();
    }

    if (targetSession) {
      setClientSession(ws, targetSession.cliSessionId);
      sm.switchSessionForClient(ws, targetSession.cliSessionId, sendTo);
    }

    ws.on("message", function (raw) {
      var msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      handleMessage(ws, msg);
    });

    ws.on("close", function () {
      handleDisconnection(ws);
    });
  }

  // --- Per-client session lookup helper ---
  function getClientSession(ws) {
    var state = clients.get(ws);
    return state ? sm.sessions.get(state.sessionId) : null;
  }

  // --- WS message handler ---
  function handleMessage(ws, msg) {
    if (msg.type === "push_subscribe") {
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription, msg.replaceEndpoint);
      return;
    }

    if (msg.type === "load_more_history") {
      // Support both main session and popup/tab sessions via sessionId
      var histSession = msg.sessionId ? sm.sessions.get(msg.sessionId) : getClientSession(ws);
      if (!histSession || typeof msg.before !== "number") return;
      sm.ensureHistoryLoaded(histSession);
      if (!histSession.history) histSession.history = [];
      var before = Math.min(msg.before, histSession.history.length);
      var from = sm.findTurnBoundary(histSession.history, Math.max(0, before - sm.HISTORY_PAGE_SIZE));
      var to = before;
      var items = histSession.history.slice(from, to);
      sendTo(ws, {
        type: "history_prepend",
        sessionId: msg.sessionId || null,
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return;
    }

    if (msg.type === "new_session") {
      var newSession = sm.createSession(ws, sendTo, msg.accountId || null, null, msg._requestId);
      if (msg.projectPath) {
        newSession.projectPath = msg.projectPath;
        sm.saveSessionFile(newSession);
      }
      setClientSession(ws, newSession.cliSessionId);
      return;
    }

    if (msg.type === "resume_session") {
      if (!msg.cliSessionId) return;
      var resumed = sm.resumeSession(msg.cliSessionId, ws, sendTo);
      setClientSession(ws, resumed.cliSessionId);
      return;
    }

    if (msg.type === "switch_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        setClientSession(ws, msg.id);
        sm.switchSessionForClient(ws, msg.id, sendTo);
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "leave_session") {
      // Bug 8: client entered home view — stop routing messages to it
      setClientSession(ws, null);
      return;
    }

    // tab_subscribe/tab_unsubscribe are the new protocol for IDE tabs.
    // They work identically to popup_open/popup_close but signal intent clearly.
    if (msg.type === "tab_subscribe") { msg.type = "popup_open"; }
    if (msg.type === "tab_unsubscribe") { msg.type = "popup_close"; }

    if (msg.type === "popup_open") {
      var popupSession = msg.sessionId && sm.sessions.get(msg.sessionId);
      if (!popupSession) {
        // Session doesn't exist (stale localStorage after restart) — send empty history
        // so client clears loadingHistory instead of hanging forever
        sendTo(ws, { type: "popup_history_start", sessionId: msg.sessionId, total: 0, from: 0 });
        sendTo(ws, { type: "popup_history_done", sessionId: msg.sessionId });
        return;
      }
      var cstate = clients.get(ws);
      cstate.popups.add(msg.sessionId);
      if (msg.skip_history) {
        // Just register for routing — no history replay, no start/done
        // (avoids wiping existing client-side messages on reconnect)
      } else {
        // Lazy-load history from disk if not yet loaded
        sm.ensureHistoryLoaded(popupSession);
        if (!popupSession.history) popupSession.history = [];
        // Replay history with popup tag so client routes to the right popup
        var total = popupSession.history.length;
        console.log("[project] Replaying history for", msg.sessionId.substring(0, 12), "total:", total);
        // Send ALL history — no truncation. Client handles rendering performance.
        var fromIdx = 0;
        sendTo(ws, { type: "popup_history_start", sessionId: msg.sessionId, total: total, from: fromIdx });
        for (var phi = fromIdx; phi < total; phi++) {
          sendTo(ws, Object.assign({}, popupSession.history[phi], { _popupSessionId: msg.sessionId }));
        }
        sendTo(ws, { type: "popup_history_done", sessionId: msg.sessionId });
      }
      // Send processing status if active
      if (popupSession.isProcessing) {
        sendTo(ws, { type: "status", status: "processing", _popupSessionId: msg.sessionId });
      }
      // Re-send pending permissions
      var pendingIds = Object.keys(popupSession.pendingPermissions);
      for (var ppi = 0; ppi < pendingIds.length; ppi++) {
        var p = popupSession.pendingPermissions[pendingIds[ppi]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          _popupSessionId: msg.sessionId,
        });
      }
      return;
    }

    if (msg.type === "popup_close") {
      var cstate = clients.get(ws);
      if (cstate) cstate.popups.delete(msg.sessionId);
      return;
    }

    if (msg.type === "popup_message") {
      // Message sent from a popup chat input — route to the target session
      var targetSession = sm.sessions.get(msg.sessionId);
      if (!targetSession) return;
      if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.documents || msg.documents.length === 0)) return;
      // Temporarily remove this session from popups to avoid duplicate user_message
      // (the popup already rendered it locally, and sendToSessionViewersExcept would
      // send it back via the popups set)
      var cstate = clients.get(ws);
      var origSessionId = cstate.sessionId;
      cstate.popups.delete(msg.sessionId);
      setClientSession(ws, msg.sessionId);
      try {
        var rerouted = { type: "message", text: msg.text };
        if (msg.images) rerouted.images = msg.images;
        if (msg.pastes) rerouted.pastes = msg.pastes;
        if (msg.documents) rerouted.documents = msg.documents;
        handleMessage(ws, rerouted);
      } finally {
        setClientSession(ws, origSessionId);
        cstate.popups.add(msg.sessionId);
      }
      return;
    }

    if (msg.type === "popup_stop") {
      var targetSession = sm.sessions.get(msg.sessionId);
      if (!targetSession || !targetSession.isProcessing) return;
      if (targetSession.queryInstance && targetSession.queryInstance.interrupt) {
        targetSession.queryInstance.interrupt().catch(function () {});
      }
      if (targetSession.abortController) {
        targetSession.abortController.abort();
      }
      return;
    }

    if (msg.type === "popup_permission_response") {
      var targetSession = sm.sessions.get(msg.sessionId);
      if (!targetSession) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = targetSession.pendingPermissions[requestId];
      if (!pending) return;
      if (pending._timeout) clearTimeout(pending._timeout);
      delete targetSession.pendingPermissions[requestId];
      if (decision === "allow") {
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied permission" });
      }
      sm.sendAndRecord(targetSession, { type: "permission_resolved", requestId: requestId, decision: decision });
      return;
    }

    if (msg.type === "delete_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.deleteSession(msg.id, clients, sendTo);
      }
      return;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        s.title = String(msg.title).substring(0, 100);
        sm.saveSessionFile(s);
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "search_sessions") {
      var results = sm.searchSessions(msg.query || "");
      sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
      return;
    }

    if (msg.type === "fork_session") {
      var sourceSessionId = msg.sessionId;
      if (!sourceSessionId || !sm.sessions.has(sourceSessionId)) return;
      var sourceSession = sm.sessions.get(sourceSessionId);
      var requestId = msg._requestId || crypto.randomUUID();
      // Create a new session for the fork
      var forkedSession = sm.createSession(ws, sendTo, sourceSession.accountId || null, sourceSession.projectPath || null, requestId);
      // Copy the source session's CLI session ID so SDK can fork from it
      forkedSession._forkFrom = sourceSessionId;
      forkedSession.title = (sourceSession.title || "Session") + " (fork)";
      sm.saveSessionFile(forkedSession);
      sm.broadcastSessionList();
      console.log("[project] Forked session", sourceSessionId, "→", forkedSession.cliSessionId);
      return;
    }

    if (msg.type === "archive_session") {
      var archiveId = msg.sessionId;
      if (archiveId && sm.sessions.has(archiveId)) {
        var archiveSession = sm.sessions.get(archiveId);
        archiveSession.archived = Date.now();
        sm.saveSessionFile(archiveSession);
        sm.broadcastSessionList();
        console.log("[project] Archived session:", archiveId);
      }
      return;
    }

    if (msg.type === "unarchive_session") {
      var unarchiveId = msg.sessionId;
      if (unarchiveId && sm.sessions.has(unarchiveId)) {
        var unarchiveSession = sm.sessions.get(unarchiveId);
        unarchiveSession.archived = null;
        sm.saveSessionFile(unarchiveSession);
        sm.broadcastSessionList();
        console.log("[project] Unarchived session:", unarchiveId);
      }
      return;
    }

    if (msg.type === "bulk_archive") {
      var maxAge = msg.olderThan || (7 * 24 * 60 * 60 * 1000); // default 7 days
      var cutoff = Date.now() - maxAge;
      var count = 0;
      sm.sessions.forEach(function(s) {
        if (!s.archived && !s.isProcessing && (s.lastActivity || s.createdAt || 0) < cutoff) {
          s.archived = Date.now();
          sm.saveSessionFile(s);
          count++;
        }
      });
      sm.broadcastSessionList();
      sendTo(ws, { type: "bulk_archive_result", count: count });
      console.log("[project] Bulk archived", count, "sessions older than", Math.round(maxAge / 86400000) + "d");
      return;
    }

    if (msg.type === "set_system_prompt") {
      var targetSessionId = msg.sessionId;
      if (!targetSessionId || !sm.sessions.has(targetSessionId)) return;
      var targetSession = sm.sessions.get(targetSessionId);
      targetSession.customPrompt = msg.prompt ? String(msg.prompt).substring(0, 10000) : null;
      console.log("[project] Set customPrompt for session:", targetSessionId, targetSession.customPrompt ? targetSession.customPrompt.length + " chars" : "cleared");
      sendTo(ws, { type: "system_prompt_set", sessionId: targetSessionId, success: true });
      return;
    }

    if (msg.type === "process_stats") {
      var sessionCount = sm.sessions.size;
      var processingCount = 0;
      sm.sessions.forEach(function (s) {
        if (s.isProcessing) processingCount++;
      });
      var mem = process.memoryUsage();
      sendTo(ws, {
        type: "process_stats",
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
        sessions: sessionCount,
        processing: processingCount,
        clients: clients.size,
        terminals: tm.list().length,
      });
      return;
    }

    if (msg.type === "get_usage") {
      fetchAllUsage(accounts).then(function (data) {
        sendTo(ws, { type: "usage_data", accounts: data, timestamp: Date.now() });
      }).catch(function (e) {
        sendTo(ws, { type: "usage_data", error: e.message, accounts: [], timestamp: Date.now() });
      });
      return;
    }

    if (msg.type === "stop") {
      var session = getClientSession(ws);
      if (session && session.isProcessing) {
        // Try graceful interrupt first, then escalate to close()
        if (session.queryInstance && session.queryInstance.interrupt) {
          session.queryInstance.interrupt().catch(function () {});
        }
        if (session.abortController) {
          session.abortController.abort();
        }
        // Escalate: if still processing after 2s, close() immediately
        var sessionRef = session;
        setTimeout(function () {
          if (sessionRef.isProcessing && sessionRef.queryInstance) {
            console.log("[project] Stop escalating to close()");
            if (sessionRef.queryInstance.close) {
              try { sessionRef.queryInstance.close(); } catch (e) {}
            }
            sessionRef.queryInstance = null;
            sessionRef.messageQueue = null;
            sessionRef.abortController = null;
            sessionRef.blocks = {};
            sessionRef.sentToolResults = {};
            sessionRef.pendingPermissions = {};
            sessionRef.pendingAskUser = {};
            sessionRef.isProcessing = false;
            sm.sendAndRecord(sessionRef, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
            sm.sendAndRecord(sessionRef, { type: "done", code: 0 });
            sm.broadcastSessionList();
          }
        }, 2000);
      }
      return;
    }

    if (msg.type === "force_stop") {
      var session = getClientSession(ws);
      if (session) {
        // Force-kill the underlying claude process and all its children
        if (session.queryInstance && session.queryInstance.close) {
          try { session.queryInstance.close(); } catch (e) {}
        }
        if (session.abortController) {
          try { session.abortController.abort(); } catch (e) {}
        }
        if (session.messageQueue) {
          try { session.messageQueue.end(); } catch (e) {}
        }
        session.queryInstance = null;
        session.messageQueue = null;
        session.abortController = null;
        session.blocks = {};
        session.sentToolResults = {};
        session.pendingPermissions = {};
        session.pendingAskUser = {};
        session.isProcessing = false;
        sm.sendAndRecord(session, { type: "info", text: "Session force-stopped" });
        sm.sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "set_model" && msg.model) {
      var session = getClientSession(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "session_settings") {
      var session = getClientSession(ws);
      if (msg.effort != null) {
        sdk.setEffort(msg.effort || "");
        if (session) {
          session.querySettings = session.querySettings || {};
          session.querySettings.effort = msg.effort || "";
        }
      }
      return;
    }

    if (msg.type === "set_permission_mode" && msg.mode) {
      var session = getClientSession(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      return;
    }

    if (msg.type === "stop_task") {
      var session = getClientSession(ws);
      if (session) {
        sdk.stopTask(session, msg.taskId || null, msg.toolUseId || null);
      }
      return;
    }

    if (msg.type === "rewind_preview") {
      var session = getClientSession(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return;

      (async function () {
        var result;
        try {
          result = await sdk.getOrCreateRewindQuery(session, resolveAccount(session));
          var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
          var diffs = {};
          var changedFiles = preview.filesChanged || [];
          for (var f = 0; f < changedFiles.length; f++) {
            try {
              diffs[changedFiles[f]] = execFileSync(
                "git", ["diff", "HEAD", "--", changedFiles[f]],
                { cwd: cwd, encoding: "utf8", timeout: 5000 }
              ) || "";
            } catch (e) { diffs[changedFiles[f]] = ""; }
          }
          sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "rewind_execute") {
      var session = getClientSession(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return;
      sm.ensureHistoryLoaded(session);
      var mode = msg.mode || "both";

      (async function () {
        var result;
        try {
          // File restoration (skip for chat-only mode)
          if (mode !== "chat") {
            result = await sdk.getOrCreateRewindQuery(session, resolveAccount(session));
            await result.query.rewindFiles(msg.uuid, { dryRun: false });
          }

          // Conversation rollback (skip for files-only mode)
          if (mode !== "files") {
            var targetIdx = -1;
            for (var i = 0; i < session.messageUUIDs.length; i++) {
              if (session.messageUUIDs[i].uuid === msg.uuid) {
                targetIdx = i;
                break;
              }
            }

            if (targetIdx >= 0) {
              var trimTo = session.messageUUIDs[targetIdx].historyIndex;
              var foundUserMsg = false;
              for (var k = trimTo - 1; k >= 0; k--) {
                if (session.history[k].type === "user_message") {
                  trimTo = k;
                  foundUserMsg = true;
                  break;
                }
              }
              if (!foundUserMsg) {
                sendToSessionViewers(session.cliSessionId, { type: "rewind_error", text: "Rewind failed: no user message found before target" });
                return;
              }
              session.history = session.history.slice(0, trimTo);
              session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
            }

            session.lastRewindUuid = msg.uuid;
          }

          if (session.abortController) {
            try { session.abortController.abort(); } catch (e) {}
          }
          if (session.messageQueue) {
            try { session.messageQueue.end(); } catch (e) {}
          }
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          session.blocks = {};
          session.sentToolResults = {};
          session.pendingPermissions = {};
          session.pendingAskUser = {};
          session.isProcessing = false;

          sm.saveSessionFile(session);
          // Replay to all clients viewing this session (use reverse index)
          var rewindViewers = sessionViewers[session.cliSessionId];
          if (rewindViewers) {
            for (var clientWs of rewindViewers) {
              sm.switchSessionForClient(clientWs, session.cliSessionId, sendTo);
            }
          }
          sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
          sm.broadcastSessionList();
        } catch (err) {
          sendToSessionViewers(session.cliSessionId, { type: "rewind_error", text: "Rewind failed: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "ask_user_response") {
      var session = getClientSession(ws);
      if (!session) return;
      var toolId = msg.toolId || msg.requestId;
      var answers = msg.answers || {};
      var pending = session.pendingAskUser[toolId];
      if (!pending) return;
      delete session.pendingAskUser[toolId];
      sm.sendAndRecord(session, { type: "ask_user_answered", requestId: toolId, toolId: toolId });
      pending.resolve({
        behavior: "allow",
        updatedInput: Object.assign({}, pending.input, { answers: answers }),
      });
      return;
    }

    if (msg.type === "input_sync") {
      var clientState = clients.get(ws);
      if (clientState) {
        sendToSessionViewersExcept(clientState.sessionId, ws, msg);
      }
      return;
    }

    if (msg.type === "permission_response") {
      var session = getClientSession(ws);
      if (!session) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = session.pendingPermissions[requestId];
      if (!pending) return;
      if (pending._timeout) clearTimeout(pending._timeout);
      delete session.pendingPermissions[requestId];

      if (decision === "allow" || decision === "allow_always") {
        if (decision === "allow_always") {
          if (!session.allowedTools) session.allowedTools = {};
          session.allowedTools[pending.toolName] = true;
        }
        // Auto-accept edits: allow Edit, Write, Bash for this session
        if (msg.acceptEdits) {
          if (!session.allowedTools) session.allowedTools = {};
          session.allowedTools["Edit"] = true;
          session.allowedTools["Write"] = true;
          session.allowedTools["Bash"] = true;
          session.allowedTools["ExitPlanMode"] = true;
        }
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        var denyMessage = "User denied permission";
        if (msg.feedback) denyMessage = msg.feedback;
        pending.resolve({ behavior: "deny", message: denyMessage });
      }

      sm.sendAndRecord(session, {
        type: "permission_resolved",
        requestId: requestId,
        decision: decision,
      });

      return;
    }

    // --- Ambient permission response (from side rail for non-focused sessions) ---
    if (msg.type === "ambient_permission_response") {
      var targetSession = sm.sessions.get(msg.sessionId);
      if (!targetSession) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = targetSession.pendingPermissions[requestId];
      if (!pending) return;
      if (pending._timeout) clearTimeout(pending._timeout);
      delete targetSession.pendingPermissions[requestId];

      if (decision === "allow") {
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied permission" });
      }

      sm.sendAndRecord(targetSession, {
        type: "permission_resolved",
        requestId: requestId,
        decision: decision,
      });
      return;
    }

    // --- File browser ---
    if (msg.type === "fs_list") {
      var fsDir = safePath(cwd, msg.path || ".");
      if (!fsDir) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return;
      }
      try {
        var items = fs.readdirSync(fsDir, { withFileTypes: true });
        var entries = [];
        for (var fi = 0; fi < items.length; fi++) {
          var item = items[fi];
          if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
          entries.push({
            name: item.name,
            type: item.isDirectory() ? "dir" : "file",
            path: path.relative(cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
          });
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        // Auto-watch the directory for changes
        startDirWatch(msg.path || ".");
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    if (msg.type === "fs_read") {
      var fsFile = safePath(cwd, msg.path);
      if (!fsFile) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        return;
      }
      try {
        var stat = fs.statSync(fsFile);
        var ext = path.extname(fsFile).toLowerCase();
        if (stat.size > FS_MAX_SIZE) {
          sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
          return;
        }
        if (BINARY_EXTS.has(ext)) {
          var result = { type: "fs_read_result", path: msg.path, binary: true, size: stat.size };
          if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
          sendTo(ws, result);
          return;
        }
        var content = fs.readFileSync(fsFile, "utf8");
        sendTo(ws, { type: "fs_read_result", path: msg.path, content: content, size: stat.size });
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
      return;
    }

    // --- File search ---
    if (msg.type === "fs_search") {
      // If index is stale or empty, rebuild before searching
      if (!_fileIndex || Date.now() - _fileIndexTime > FILE_INDEX_TTL) {
        buildFileIndexAsync().then(function() {
          var q = (msg.query || "").toLowerCase().trim();
          if (!q) { sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: [] }); return; }
          var results = [];
          for (var k = 0; k < _fileIndex.length && results.length < 40; k++) {
            if (_fileIndex[k].nameLower.indexOf(q) !== -1) {
              results.push({ name: _fileIndex[k].name, path: _fileIndex[k].path, type: "file" });
            }
          }
          sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: results });
        });
        return true;
      }
      var query = (msg.query || "").trim().toLowerCase();
      if (!query) {
        sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: [] });
        return;
      }
      var fileIndex = getFileIndex();
      var searchResults = [];
      for (var si = 0; si < fileIndex.length; si++) {
        if (searchResults.length >= 50) break;
        if (fileIndex[si].nameLower.indexOf(query) !== -1) {
          searchResults.push({ name: fileIndex[si].name, path: fileIndex[si].path, type: "file" });
        }
      }
      searchResults.sort(function (a, b) {
        var aExact = a.name.toLowerCase() === query ? 0 : 1;
        var bExact = b.name.toLowerCase() === query ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.name.localeCompare(b.name);
      });
      sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: searchResults });
      return;
    }

    // --- File watcher ---
    if (msg.type === "fs_watch") {
      if (msg.path) startFileWatch(msg.path);
      return;
    }

    if (msg.type === "fs_unwatch") {
      stopFileWatch();
      return;
    }

    // --- File edit history ---
    if (msg.type === "fs_file_history") {
      var histPath = msg.path;
      if (!histPath) {
        sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: [] });
        return;
      }
      var absHistPath = path.resolve(cwd, histPath);
      var entries = [];

      // Collect session edits
      sm.sessions.forEach(function (session) {
        var sessionLocalId = session.cliSessionId;
        var sessionTitle = session.title || "Untitled";
        var histLen = session.history.length || 1;

        for (var hi = 0; hi < session.history.length; hi++) {
          var entry = session.history[hi];
          if (entry.type !== "tool_executing") continue;
          if (entry.name !== "Edit" && entry.name !== "Write") continue;
          if (!entry.input || !entry.input.file_path) continue;
          if (entry.input.file_path !== absHistPath) continue;

          // Find parent assistant UUID + message snippet by scanning backwards
          var assistantUuid = null;
          var uuidIndex = -1;
          for (var hj = hi - 1; hj >= 0; hj--) {
            if (session.history[hj].type === "message_uuid" && session.history[hj].messageType === "assistant") {
              assistantUuid = session.history[hj].uuid;
              uuidIndex = hj;
              break;
            }
          }

          // Find user prompt by scanning backwards from the assistant uuid
          var messageSnippet = "";
          var searchFrom = uuidIndex >= 0 ? uuidIndex : hi;
          for (var hk = searchFrom - 1; hk >= 0; hk--) {
            if (session.history[hk].type === "user_message" && session.history[hk].text) {
              messageSnippet = session.history[hk].text.trim().substring(0, 100);
              break;
            }
          }

          // Collect Claude's explanation: scan backwards from tool_executing
          // to find the nearest delta text block (skipping tool_start).
          // If no delta found immediately before this tool, scan past
          // intervening tool blocks to find the last delta text within
          // the same assistant turn.
          var assistantSnippet = "";
          var deltaChunks = [];
          for (var hd = hi - 1; hd >= 0; hd--) {
            var hEntry = session.history[hd];
            if (hEntry.type === "tool_start") continue;
            if (hEntry.type === "delta" && hEntry.text) {
              deltaChunks.unshift(hEntry.text);
            } else {
              break;
            }
          }
          if (deltaChunks.length === 0) {
            // No delta immediately before; scan past tool blocks
            // to find the nearest preceding delta in the same turn
            for (var hd2 = hi - 1; hd2 >= 0; hd2--) {
              var hEntry2 = session.history[hd2];
              if (hEntry2.type === "tool_start" || hEntry2.type === "tool_executing" || hEntry2.type === "tool_result") continue;
              if (hEntry2.type === "delta" && hEntry2.text) {
                // Found a delta before an earlier tool in the same turn.
                // Collect this contiguous block of deltas.
                for (var hd3 = hd2; hd3 >= 0; hd3--) {
                  var hEntry3 = session.history[hd3];
                  if (hEntry3.type === "tool_start") continue;
                  if (hEntry3.type === "delta" && hEntry3.text) {
                    deltaChunks.unshift(hEntry3.text);
                  } else {
                    break;
                  }
                }
                break;
              } else {
                // Hit message_uuid, user_message, etc. Stop.
                break;
              }
            }
          }
          assistantSnippet = deltaChunks.join("").trim().substring(0, 150);

          // Approximate timestamp: interpolate between session creation and last activity
          var tStart = session.createdAt || 0;
          var tEnd = session.lastActivity || tStart;
          var ts = tStart + Math.floor((hi / histLen) * (tEnd - tStart));

          var editRecord = {
            source: "session",
            timestamp: ts,
            sessionLocalId: sessionLocalId,
            sessionTitle: sessionTitle,
            assistantUuid: assistantUuid,
            toolId: entry.id,
            messageSnippet: messageSnippet,
            assistantSnippet: assistantSnippet,
            toolName: entry.name,
          };

          if (entry.name === "Edit") {
            editRecord.old_string = entry.input.old_string || "";
            editRecord.new_string = entry.input.new_string || "";
          } else {
            editRecord.isFullWrite = true;
          }

          entries.push(editRecord);
        }
      });

      // Collect git commits
      try {
        var gitLog = execFileSync(
          "git", ["log", "--format=%H|%at|%an|%s", "--follow", "--", histPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 }
        );
        var gitLines = gitLog.trim().split("\n");
        for (var gi = 0; gi < gitLines.length; gi++) {
          if (!gitLines[gi]) continue;
          var parts = gitLines[gi].split("|");
          if (parts.length < 4) continue;
          entries.push({
            source: "git",
            hash: parts[0],
            timestamp: parseInt(parts[1], 10) * 1000,
            author: parts[2],
            message: parts.slice(3).join("|"),
          });
        }
      } catch (e) {
        // Not a git repo or file not tracked, that's fine
      }

      // Sort by timestamp descending (newest first)
      entries.sort(function (a, b) { return b.timestamp - a.timestamp; });

      sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: entries });
      return;
    }

    // --- Git status ---
    if (msg.type === "git_status") {
      try {
        var statusOut = execFileSync("git", ["status", "--porcelain", "-uall"],
          { cwd: cwd, encoding: "utf8", timeout: 5000 });
        var staged = [];
        var changed = [];
        var untracked = [];
        var lines = statusOut.split("\n");
        for (var si = 0; si < lines.length; si++) {
          var line = lines[si];
          if (!line || line.length < 4) continue;
          var x = line[0]; // index status
          var y = line[1]; // worktree status
          var filePath = line.substring(3);
          // Handle renames: "R  old -> new"
          var oldPath = null;
          var renameIdx = filePath.indexOf(" -> ");
          if (renameIdx !== -1) {
            oldPath = filePath.substring(0, renameIdx);
            filePath = filePath.substring(renameIdx + 4);
          }
          // Staged changes (index column)
          if (x === "M" || x === "A" || x === "D" || x === "R" || x === "C") {
            staged.push({ status: x, path: filePath, oldPath: oldPath });
          }
          // Unstaged changes (worktree column)
          if (y === "M" || y === "D") {
            changed.push({ status: y, path: filePath });
          }
          // Untracked
          if (x === "?" && y === "?") {
            untracked.push({ status: "?", path: filePath });
          }
        }
        sendTo(ws, { type: "git_status_result", staged: staged, changed: changed, untracked: untracked });
      } catch (e) {
        sendTo(ws, { type: "git_status_result", staged: [], changed: [], untracked: [], error: e.message });
      }
      return;
    }

    // --- Git stage / unstage / discard ---
    if (msg.type === "git_stage") {
      var paths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
      // Reject path traversal
      for (var gi = 0; gi < paths.length; gi++) {
        if (!paths[gi] || paths[gi].indexOf("..") !== -1) {
          sendTo(ws, { type: "git_action_result", action: "stage", error: "Invalid path" });
          return;
        }
      }
      try {
        execFileSync("git", ["add", "--"].concat(paths), { cwd: cwd, timeout: 5000 });
        sendTo(ws, { type: "git_action_result", action: "stage", success: true });
      } catch (e) {
        sendTo(ws, { type: "git_action_result", action: "stage", error: e.message });
      }
      return;
    }

    if (msg.type === "git_unstage") {
      var uPaths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
      for (var ui = 0; ui < uPaths.length; ui++) {
        if (!uPaths[ui] || uPaths[ui].indexOf("..") !== -1) {
          sendTo(ws, { type: "git_action_result", action: "unstage", error: "Invalid path" });
          return;
        }
      }
      try {
        execFileSync("git", ["reset", "HEAD", "--"].concat(uPaths), { cwd: cwd, timeout: 5000 });
        sendTo(ws, { type: "git_action_result", action: "unstage", success: true });
      } catch (e) {
        sendTo(ws, { type: "git_action_result", action: "unstage", error: e.message });
      }
      return;
    }

    if (msg.type === "git_discard") {
      var dPaths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
      for (var di = 0; di < dPaths.length; di++) {
        if (!dPaths[di] || dPaths[di].indexOf("..") !== -1) {
          sendTo(ws, { type: "git_action_result", action: "discard", error: "Invalid path" });
          return;
        }
      }
      try {
        execFileSync("git", ["checkout", "--"].concat(dPaths), { cwd: cwd, timeout: 5000 });
        sendTo(ws, { type: "git_action_result", action: "discard", success: true });
      } catch (e) {
        sendTo(ws, { type: "git_action_result", action: "discard", error: e.message });
      }
      return;
    }

    // --- Git working tree diff ---
    if (msg.type === "git_diff_working") {
      var wdPath = msg.path;
      if (!wdPath || wdPath.indexOf("..") !== -1) {
        sendTo(ws, { type: "git_diff_working_result", path: wdPath, diff: "", error: "Invalid path" });
        return;
      }
      try {
        var wdDiff;
        if (msg.staged) {
          wdDiff = execFileSync("git", ["diff", "--cached", "--", wdPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        } else {
          wdDiff = execFileSync("git", ["diff", "--", wdPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        }
        sendTo(ws, { type: "git_diff_working_result", path: wdPath, staged: !!msg.staged, diff: wdDiff || "" });
      } catch (e) {
        sendTo(ws, { type: "git_diff_working_result", path: wdPath, diff: "", error: e.message });
      }
      return;
    }

    // --- Git diff for file history ---
    if (msg.type === "fs_git_diff") {
      var diffPath = msg.path;
      var hash = msg.hash;
      var hash2 = msg.hash2 || null;
      if (!diffPath || !hash) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Missing params" });
        return;
      }
      // Validate git hashes
      var hashRe = /^[0-9a-f]{7,64}$/i;
      if (!hashRe.test(hash) || (hash2 && !hashRe.test(hash2))) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Invalid hash" });
        return;
      }
      // Reject path traversal
      if (diffPath.indexOf("..") !== -1) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Invalid path" });
        return;
      }
      try {
        var diff;
        if (hash2) {
          diff = execFileSync("git", ["diff", hash, hash2, "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        } else {
          diff = execFileSync("git", ["show", hash, "--format=", "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        }
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: diff || "" });
      } catch (e) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: "", error: e.message });
      }
      return;
    }

    // --- File content at a git commit ---
    if (msg.type === "fs_file_at") {
      var atPath = msg.path;
      var atHash = msg.hash;
      if (!atPath || !atHash) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Missing params" });
        return;
      }
      // Validate git hash
      if (!/^[0-9a-f]{7,64}$/i.test(atHash)) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Invalid hash" });
        return;
      }
      // Reject path traversal
      if (atPath.indexOf("..") !== -1) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Invalid path" });
        return;
      }
      try {
        // Convert to repo-relative path (git show requires hash:relative/path)
        var atAbsPath = path.resolve(cwd, atPath);
        var atRelPath = path.relative(cwd, atAbsPath);
        var content = execFileSync("git", ["show", atHash + ":" + atRelPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 });
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: content });
      } catch (e) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: e.message });
      }
      return;
    }

    // --- Web terminal ---
    if (msg.type === "term_create") {
      var t = tm.create(msg.cols || 80, msg.rows || 24);
      if (!t) {
        sendTo(ws, { type: "term_error", error: "Cannot create terminal (node-pty not available or limit reached)" });
        return;
      }
      tm.attach(t.id, ws);
      send({ type: "term_list", terminals: tm.list() });
      sendTo(ws, { type: "term_created", id: t.id });
      return;
    }

    if (msg.type === "term_attach") {
      if (msg.id) tm.attach(msg.id, ws);
      return;
    }

    if (msg.type === "term_detach") {
      if (msg.id) tm.detach(msg.id, ws);
      return;
    }

    if (msg.type === "term_input") {
      if (msg.id) tm.write(msg.id, msg.data);
      return;
    }

    if (msg.type === "term_resize") {
      if (msg.id && msg.cols > 0 && msg.rows > 0) {
        tm.resize(msg.id, msg.cols, msg.rows);
      }
      return;
    }

    if (msg.type === "term_close") {
      if (msg.id) {
        tm.close(msg.id);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type === "term_rename") {
      if (msg.id && msg.title) {
        tm.rename(msg.id, msg.title);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type !== "message") return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0) && (!msg.documents || msg.documents.length === 0)) return;

    var session = getClientSession(ws);
    if (!session) {
      console.log("[project] No session found for client, sessionId:", clients.get(ws) ? clients.get(ws).sessionId : "no client state");
      return;
    }
    console.log("[project] Message for session:", session.cliSessionId, "_tempId:", !!session._tempId, "isProcessing:", session.isProcessing, "hasQuery:", !!session.queryInstance, "images:", (msg.images || []).length, "docs:", (msg.documents || []).length, "pastes:", (msg.pastes || []).length);

    var userMsg = { type: "user_message", text: msg.text || "" };
    if (msg.images && msg.images.length > 0) {
      userMsg.imageCount = msg.images.length;
      // Save images to disk and store paths in history
      var imgDir = path.join(sm.sessionsDir || path.join(cwd, ".claude-relay", "sessions"), "images");
      try { fs.mkdirSync(imgDir, { recursive: true }); } catch (e) {}
      userMsg.imagePaths = [];
      for (var ii = 0; ii < msg.images.length; ii++) {
        var img = msg.images[ii];
        var rawExt = (img.mediaType || "image/png").split("/")[1] || "png";
        // Sanitize extension — only allow safe characters
        var ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) || "png";
        var imgName = session.cliSessionId.substring(0, 12) + "-" + Date.now() + "-" + ii + "." + ext;
        var imgPath = path.join(imgDir, imgName);
        try {
          fs.writeFileSync(imgPath, Buffer.from(img.data, "base64"));
          userMsg.imagePaths.push(imgName);
        } catch (e) {
          console.error("[project] Failed to save image:", e.message);
        }
      }
    }
    if (msg.pastes && msg.pastes.length > 0) {
      userMsg.pastes = msg.pastes;
    }
    if (msg.documents && msg.documents.length > 0) {
      userMsg.documentCount = msg.documents.length;
      userMsg.documentNames = msg.documents.map(function(d) { return d.name || "document"; });
    }
    sm.ensureHistoryLoaded(session);
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);
    sendToSessionViewersExcept(session.cliSessionId, ws, userMsg);

    if (!session.title) {
      session.title = (msg.text || (msg.documents && msg.documents.length > 0 ? msg.documents[0].name || "Document" : "Image")).substring(0, 50);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    var fullText = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    // Handle documents: save to project dir and tell Claude to read them
    var mediaAttachments = msg.images || [];
    if (msg.documents && msg.documents.length > 0) {
      var uploadsDir = path.join(cwd, ".claude-relay", "uploads");
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
      for (var di = 0; di < msg.documents.length; di++) {
        var doc = msg.documents[di];
        // Sanitize filename
        var safeName = (doc.name || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
        var docPath = path.join(uploadsDir, Date.now() + "-" + safeName);
        try {
          fs.writeFileSync(docPath, Buffer.from(doc.data, "base64"));
          if (fullText) fullText += "\n\n";
          fullText += "[Uploaded file: " + docPath + " — please read this file to see its contents]";
          console.log("[project] Saved uploaded document:", docPath);
        } catch (e) {
          console.error("[project] Failed to save document:", e.message);
        }
      }
    }

    // Expand slash commands from .claude/commands/
    fullText = expandSlashCommand(fullText, cwd);

    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      sendToSessionViewers(session.cliSessionId, { type: "status", status: "processing" });
      if (!session.queryInstance) {
        sdk.startQuery(session, fullText, mediaAttachments, resolveAccount(session));
      } else {
        sdk.pushMessage(session, fullText, mediaAttachments);
      }
    } else {
      sdk.pushMessage(session, fullText, mediaAttachments);
    }
    sm.broadcastSessionList();
  }

  // --- WS disconnection handler ---
  function handleDisconnection(ws) {
    // Clean up pending permission requests for the disconnecting client's session
    var clientState = clients.get(ws);
    if (clientState && clientState.sessionId) {
      var session = sm.sessions.get(clientState.sessionId);
      if (session) {
        // Check if any other client is still viewing this session (use reverse index)
        var viewers = sessionViewers[clientState.sessionId];
        var hasOtherViewer = viewers && viewers.size > 1; // >1 because ws is still in the set
        // If no other viewers, deny all pending permission requests
        if (!hasOtherViewer) {
          var pendingIds = Object.keys(session.pendingPermissions);
          for (var pi = 0; pi < pendingIds.length; pi++) {
            var pending = session.pendingPermissions[pendingIds[pi]];
            if (pending._timeout) clearTimeout(pending._timeout);
            delete session.pendingPermissions[pendingIds[pi]];
            pending.resolve({ behavior: "deny", message: "Client disconnected" });
          }
        }
      }
      // Remove from reverse index
      removeViewer(clientState.sessionId, ws);
    }
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) {
      stopFileWatch();
      stopAllDirWatches();
    }
    broadcastClientCount();
  }

  // --- Handle project-scoped HTTP requests ---
  function handleHTTP(req, res, urlPath) {
    // Serve session images
    if (req.method === "GET" && urlPath.startsWith("/api/session-image/")) {
      var imgName = urlPath.substring("/api/session-image/".length);
      // Sanitize — no path traversal
      if (imgName.includes("..") || imgName.includes("/")) {
        res.writeHead(400);
        res.end("Bad request");
        return true;
      }
      var imgDir = path.join(sm.sessionsDir || path.join(cwd, ".claude-relay", "sessions"), "images");
      var imgPath = path.join(imgDir, imgName);
      try {
        var content = fs.readFileSync(imgPath);
        var ext = path.extname(imgName).substring(1);
        var mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" }[ext] || "image/png";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(content);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (body) {
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function (e) {
        console.error("[project] push-subscribe error:", e.message || e);
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      parseJsonBody(req).then(function (data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;
          delete session.pendingPermissions[requestId];
          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }
          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });
        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function (e) {
        console.error("[project] permission-response error:", e.message || e);
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileContent = fs.readFileSync(absFile);
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // PDF generation: run md-to-pdf.mjs and return the PDF
    if (req.method === "GET" && urlPath.startsWith("/api/pdf?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      if (!absFile.endsWith(".md") && !absFile.endsWith(".mdx")) {
        res.writeHead(400); res.end("Only markdown files supported"); return true;
      }
      try { fs.accessSync(absFile); } catch (e) { res.writeHead(404); res.end("File not found"); return true; }

      // Find md-to-pdf.mjs — look in common locations
      var scriptPaths = [
        path.resolve(cwd, "code/scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "../scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "../../code/scripts/md-to-pdf.mjs"),
      ];
      var scriptPath = null;
      for (var si = 0; si < scriptPaths.length; si++) {
        try { fs.accessSync(scriptPaths[si]); scriptPath = scriptPaths[si]; break; } catch (e) {}
      }
      if (!scriptPath) { res.writeHead(500); res.end("md-to-pdf.mjs not found"); return true; }

      var os = require("os");
      var tmpOut = path.join(os.tmpdir(), "claude-relay-pdf-" + Date.now() + ".pdf");
      execFile("node", [scriptPath, absFile, "--output", tmpOut, "--brand", "clout"], {
        timeout: 30000,
        cwd: cwd,
      }, function (err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        try {
          var pdfBuf = fs.readFileSync(tmpOut);
          var baseName = path.basename(absFile, path.extname(absFile));
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="' + baseName + ' - Clout Operations.pdf"',
            "Content-Length": pdfBuf.length,
          });
          res.end(pdfBuf);
          try { fs.unlinkSync(tmpOut); } catch (e) {}
        } catch (e) {
          res.writeHead(500); res.end("Failed to read generated PDF");
        }
      });
      return true;
    }

    // Board: GTD structure endpoint
    if (req.method === "GET" && urlPath === "/api/board") {
      var gtdPath = path.join(cwd, "gtd");
      try { fs.accessSync(gtdPath); } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"No gtd/ directory found in project"}');
        return true;
      }
      var skipAreas = new Set(["archive", "someday", "4-areas"]);
      var areaDirs = [];
      try { areaDirs = fs.readdirSync(gtdPath).filter(function (d) {
        if (d.startsWith(".")) return false;
        if (skipAreas.has(d)) return false;
        try { return fs.statSync(path.join(gtdPath, d)).isDirectory(); } catch(e) { return false; }
      }); } catch(e) {}

      // Build session -> projectPath index from session meta
      var sessionsByProject = {};
      var looseSessions = [];
      sm.sessions.forEach(function (session) {
        if (session._tempId) return;
        if (session.archived) return; // exclude archived sessions from board
        // Count turns and cost from loaded history (cheap — only if already in memory)
        var turnCount = 0;
        var totalCost = 0;
        var lastUserMessage = "";
        if (session.history) {
          for (var hi = 0; hi < session.history.length; hi++) {
            if (session.history[hi].type === "user_message") {
              turnCount++;
              if (session.history[hi].text) lastUserMessage = session.history[hi].text;
            }
            if (session.history[hi].type === "result" && session.history[hi].cost != null) totalCost += session.history[hi].cost;
          }
        }
        if (lastUserMessage.length > 120) lastUserMessage = lastUserMessage.substring(0, 120);
        var s = { id: session.cliSessionId, title: session.title || "", isProcessing: session.isProcessing || false, accountId: session.accountId || null, createdAt: session.createdAt, lastActivity: session.lastActivity, turnCount: turnCount, totalCost: Math.round(totalCost * 10000) / 10000, lastUserMessage: lastUserMessage };
        if (session.projectPath) {
          if (!sessionsByProject[session.projectPath]) sessionsByProject[session.projectPath] = [];
          sessionsByProject[session.projectPath].push(s);
        } else {
          looseSessions.push(s);
        }
      });

      var areas = areaDirs.map(function (areaName) {
        var areaDir = path.join(gtdPath, areaName);
        // Read area TOTE doc
        var docPath = path.join(areaDir, areaName + ".md");
        var presentState = "";
        var desiredState = "";
        try {
          var doc = fs.readFileSync(docPath, "utf8");
          // Extract present state
          var psMatch = doc.match(/\*\*Present State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Desired State|\*\*Test|\*\*Operations|\*\*Exit)/i);
          if (psMatch) presentState = psMatch[1].trim().split("\n").slice(0, 3).join(" ").substring(0, 200);
          // Extract desired state
          var dsMatch = doc.match(/\*\*Desired State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Test|\*\*Operations|\*\*Exit)/i);
          if (dsMatch) desiredState = dsMatch[1].trim().split("\n").slice(0, 3).join(" ").substring(0, 200);
        } catch(e) {}

        // Read projects
        var projectsDir = path.join(areaDir, "01-projects");
        var projects = [];
        try {
          var entries = fs.readdirSync(projectsDir);
          for (var pi = 0; pi < entries.length; pi++) {
            var entry = entries[pi];
            var entryPath = path.join(projectsDir, entry);
            var projectPath = areaName + "/01-projects/" + entry;
            var stat;
            try { stat = fs.statSync(entryPath); } catch(e) { continue; }
            if (stat.isDirectory()) {
              // Find sub-projects inside directory
              var subProjects = [];
              try {
                var subs = fs.readdirSync(entryPath);
                for (var si = 0; si < subs.length; si++) {
                  var subName = subs[si];
                  var subFullPath = path.join(entryPath, subName);
                  try {
                    if (fs.statSync(subFullPath).isDirectory()) {
                      var subPath = projectPath + "/" + subName;
                      subProjects.push({
                        name: subName,
                        path: subPath,
                        sessions: sessionsByProject[subPath] || [],
                      });
                    }
                  } catch(e) {}
                }
              } catch(e) {}
              projects.push({
                name: entry,
                path: projectPath,
                isDir: true,
                subProjects: subProjects,
                sessions: sessionsByProject[projectPath] || [],
              });
            } else if (entry.endsWith(".md")) {
              projects.push({
                name: entry.replace(/\.md$/, ""),
                path: projectPath,
                isDir: false,
                subProjects: [],
                sessions: sessionsByProject[projectPath] || [],
              });
            }
          }
        } catch(e) {}

        // Check for inbox
        var hasInbox = false;
        try { fs.accessSync(path.join(areaDir, "inbox.md")); hasInbox = true; } catch(e) {}

        // Read operations from 02-operations/
        var operations = [];
        var opsDir = path.join(areaDir, "02-operations");
        try {
          var opEntries = fs.readdirSync(opsDir);
          for (var oi = 0; oi < opEntries.length; oi++) {
            var opName = opEntries[oi];
            if (opName.startsWith(".")) continue;
            var opPath = path.join(opsDir, opName);
            var opStat;
            try { opStat = fs.statSync(opPath); } catch(e) { continue; }
            var isDir = opStat.isDirectory();

            // Handle both directory-based operations and flat .md file operations
            var opDescription = "";
            var opDocs = [];
            var opDisplayName = opName;

            if (isDir) {
              try {
                var opFiles = fs.readdirSync(opPath);
                for (var of2 = 0; of2 < opFiles.length; of2++) {
                  if (opFiles[of2].startsWith(".")) continue;
                  opDocs.push(opFiles[of2]);
                }
                // Try reading the main TOTE doc (same name as dir, or first .md)
                var opDocPath = path.join(opPath, opName + ".md");
                try { fs.accessSync(opDocPath); } catch(e) {
                  var firstMd = opDocs.find(function(f) { return f.endsWith(".md"); });
                  if (firstMd) opDocPath = path.join(opPath, firstMd);
                  else opDocPath = null;
                }
                if (opDocPath) {
                  try {
                    var opDoc = fs.readFileSync(opDocPath, "utf8");
                    var opLines = opDoc.split("\n").filter(function(l) { return l.trim() && !l.startsWith("#") && !l.startsWith("---"); });
                    opDescription = opLines.slice(0, 3).join(" ").substring(0, 200);
                  } catch(e) {}
                }
              } catch(e) {}
            } else if (opName.endsWith(".md")) {
              // Flat .md file = single-doc operation
              opDisplayName = opName.replace(/\.md$/, "");
              opDocs.push(opName);
              try {
                var opDoc = fs.readFileSync(opPath, "utf8");
                var opLines = opDoc.split("\n").filter(function(l) { return l.trim() && !l.startsWith("#") && !l.startsWith("---"); });
                opDescription = opLines.slice(0, 3).join(" ").substring(0, 200);
              } catch(e) {}
            } else {
              continue; // skip non-md, non-directory entries
            }

            operations.push({
              name: opDisplayName,
              description: opDescription,
              docs: opDocs,
              path: areaName + "/02-operations/" + opName,
            });
          }
        } catch(e) {}

        // Add files list to each project
        for (var fi2 = 0; fi2 < projects.length; fi2++) {
          var proj = projects[fi2];
          if (proj.isDir) {
            var projFiles = [];
            try {
              var pf = fs.readdirSync(path.join(gtdPath, proj.path));
              for (var pfi = 0; pfi < pf.length; pfi++) {
                if (pf[pfi].startsWith(".")) continue;
                if (pf[pfi].endsWith(".md") || pf[pfi].endsWith(".json") || pf[pfi].endsWith(".yaml")) {
                  projFiles.push(pf[pfi]);
                }
              }
            } catch(e) {}
            proj.files = projFiles;
          }
        }

        // Collect area-level sessions (projectPath === areaName)
        var areaSessions = sessionsByProject[areaName] || [];

        return {
          name: areaName,
          presentState: presentState,
          desiredState: desiredState,
          projects: projects,
          operations: operations,
          hasInbox: hasInbox,
          areaSessions: areaSessions,
        };
      });

      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify({ areas: areas, looseSessions: looseSessions }));
      return true;
    }

    // Board: read a specific GTD file (area doc, project doc, etc.)
    if (req.method === "GET" && urlPath.startsWith("/api/board/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var filePath = params.get("path");
      if (!filePath) { res.writeHead(400); res.end("Missing path"); return true; }
      // Only allow reading from gtd/ directory
      var absPath = path.resolve(cwd, "gtd", filePath);
      if (!absPath.startsWith(path.resolve(cwd, "gtd"))) { res.writeHead(403); res.end("Access denied"); return true; }
      if (!absPath.endsWith(".md")) { res.writeHead(403); res.end("Only .md files"); return true; }
      try {
        var content = fs.readFileSync(absPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(content);
      } catch(e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Board: tag a session with a projectPath
    if (req.method === "POST" && urlPath === "/api/board/tag-session") {
      parseJsonBody(req).then(function (body) {
        var sessionId = body.sessionId;
        var projectPath = body.projectPath || null;
        if (!sessionId) { res.writeHead(400); res.end('{"error":"missing sessionId"}'); return; }
        var session = sm.sessions.get(sessionId);
        if (!session) { res.writeHead(404); res.end('{"error":"session not found"}'); return; }
        session.projectPath = projectPath;
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function (e) { console.error("[project] tag-session error:", e.message || e); res.writeHead(400); res.end("Bad request"); });
      return true;
    }

    // Files: save file content
    if (req.method === "POST" && urlPath === "/api/files/save") {
      parseJsonBody(req).then(function (body) {
        var filePath = body.path;
        var content = body.content;
        if (!filePath || content == null) { res.writeHead(400); res.end('{"error":"missing path or content"}'); return; }
        // Security: only allow writing within cwd
        var absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(path.resolve(cwd) + path.sep)) { res.writeHead(403); res.end('{"error":"access denied"}'); return; }
        // Only allow text files
        var ext = path.extname(absPath).toLowerCase();
        var allowedExts = [".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".js", ".ts", ".css", ".html", ".svelte"];
        if (!allowedExts.includes(ext)) { res.writeHead(403); res.end('{"error":"file type not allowed: ' + ext + '"}'); return; }
        try {
          fs.writeFileSync(absPath, content, "utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
          console.log("[project] Saved file:", filePath);
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      }).catch(function (e) { res.writeHead(400); res.end("Bad request"); });
      return true;
    }

    // Board: rename a session
    if (req.method === "POST" && urlPath === "/api/board/rename-session") {
      parseJsonBody(req).then(function (body) {
        var sessionId = body.sessionId;
        var title = body.title;
        if (!sessionId || !title) { res.writeHead(400); res.end('{"error":"missing sessionId or title"}'); return; }
        var session = sm.sessions.get(sessionId);
        if (!session) { res.writeHead(404); res.end('{"error":"session not found"}'); return; }
        session.title = String(title).substring(0, 100);
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function (e) { console.error("[project] rename-session error:", e.message || e); res.writeHead(400); res.end("Bad request"); });
      return true;
    }

    // Board: strategy data (parsed from latest strategy session)
    if (req.method === "GET" && urlPath === "/api/board/strategy") {
      var stratSessionsDir = path.join(cwd, "gtd", "strategy", "02-operations", "sessions");
      var goalsPath = path.join(cwd, "gtd", "strategy", "goals.md");
      var strategyPath = path.join(cwd, "gtd", "strategy", "strategy.md");
      var result = { gate: null, candidateName: null, sessionDate: null, nextReview: null, allocation: [], gaps: [], tests: [], oneSentence: null, lastReviewed: null };

      // Find latest session directory (date-prefixed, sorted)
      try {
        var sessionDirs = fs.readdirSync(stratSessionsDir).filter(function (d) {
          return /^\d{4}-\d{2}-\d{2}/.test(d);
        }).sort();
        if (sessionDirs.length > 0) {
          var latestDir = sessionDirs[sessionDirs.length - 1];
          var dateMatch = latestDir.match(/^(\d{4}-\d{2}-\d{2})/);
          result.sessionDate = dateMatch ? dateMatch[1] : null;
          var summaryPath = path.join(stratSessionsDir, latestDir, "session-summary.md");
          try {
            var summary = fs.readFileSync(summaryPath, "utf8");

            // Parse candidate name from ## Selection -> **Candidate X: "Name"**
            var candMatch = summary.match(/\*\*Candidate [A-Z]:\s*"?([^"*\n]+)"?\*\*/);
            if (candMatch) result.candidateName = candMatch[1].trim();
            // Also try from title
            if (!result.candidateName) {
              var titleMatch = summary.match(/^#\s+Strategic Review Session.*?—\s*(.+)/m);
              if (titleMatch) result.candidateName = titleMatch[1].trim();
            }

            // Parse next review date — handles **Next review:** 2026-03-18 format
            var nextMatch = summary.match(/\*?\*?[Nn]ext\s+(?:review|check)\*?\*?[:\s*]+(\d{4}-\d{2}-\d{2})/);
            if (nextMatch) result.nextReview = nextMatch[1];

            // Parse allocation table ONLY from after ## Selection (the chosen candidate)
            var selectionSection = summary.split(/## Selection/)[1];
            if (selectionSection) {
              // Find the first allocation table after selection (Calvin's allocation)
              var calvinSection = selectionSection.match(/### Calvin's allocation[\s\S]*?(?=###|$)/);
              var allocSource = calvinSection ? calvinSection[0] : selectionSection.split(/## /)[0];
              var allocLines = allocSource.match(/\|[^|]*\|\s*\*\*\d+%\*\*[^|]*\|[^|]*\|/g);
              if (allocLines) {
                for (var ai = 0; ai < allocLines.length; ai++) {
                  var trackMatch = allocLines[ai].match(/\|\s*\*\*([^*]+)\*\*\s*\|\s*\*\*(\d+)%\*\*/);
                  if (trackMatch) {
                    result.allocation.push({ track: trackMatch[1].trim(), percent: parseInt(trackMatch[2]) });
                  }
                }
              }
            }

            // Parse gap analysis table — each row has 5 columns with ** markup in gap and urgency
            var gapSection = summary.match(/## Step 3: Gap Analysis[\s\S]*?(?=\n---|\n## )/);
            if (gapSection) {
              // Match table rows (skip header and separator)
              var gapRows = gapSection[0].split("\n").filter(function (line) {
                return line.startsWith("|") && !line.match(/^\|\s*[-]+/) && !line.match(/^\|\s*Area/);
              });
              for (var gi = 0; gi < gapRows.length; gi++) {
                var cells = gapRows[gi].split("|").map(function (c) { return c.trim(); }).filter(Boolean);
                if (cells.length >= 5) {
                  // Extract urgency: strip ** and anything after space/paren
                  var rawUrgency = cells[4].replace(/\*\*/g, "").trim();
                  var urgency = rawUrgency.split(/[\s(]/)[0];
                  result.gaps.push({
                    area: cells[0],
                    present: cells[1],
                    desired: cells[2],
                    gap: cells[3].replace(/\*\*/g, "").trim(),
                    urgency: urgency
                  });
                }
              }
            }

            // Parse tests table: | Check | Evidence |
            var testsSection = summary.match(/### Tests[^\n]*\n[\s\S]*?\n\n/);
            if (testsSection) {
              var testLines = testsSection[0].match(/\|\s*[^|]+\?\s*\|[^|]*\|/g);
              if (testLines) {
                for (var ti = 0; ti < testLines.length; ti++) {
                  var testMatch = testLines[ti].match(/\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
                  if (testMatch) {
                    result.tests.push({ label: testMatch[1].trim(), evidence: testMatch[2].trim() });
                  }
                }
              }
            }

            // Parse one-sentence version
            var oneMatch = summary.match(/## The one-sentence version\s*\n+\*\*([^*]+)\*\*/);
            if (oneMatch) result.oneSentence = oneMatch[1].trim();

          } catch (e) { /* no session summary */ }
        }
      } catch (e) { /* no sessions dir */ }

      // Parse gate from goals.md
      try {
        var goalsContent = fs.readFileSync(goalsPath, "utf8");
        var gateMatch = goalsContent.match(/## Current Focus\s*\n+\*\*([^*]+)\*\*/);
        if (gateMatch) result.gate = gateMatch[1].trim();
      } catch (e) {}

      // Parse last reviewed from strategy.md
      try {
        var stratContent = fs.readFileSync(strategyPath, "utf8");
        var reviewedMatch = stratContent.match(/## Last Reviewed\s*\n+(\d{4}-\d{2}-\d{2})/);
        if (reviewedMatch) result.lastReviewed = reviewedMatch[1];
      } catch (e) {}

      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify(result));
      return true;
    }

    // Board: cockpit state (test checkboxes, notes)
    if (urlPath === "/api/board/cockpit-state") {
      var cockpitStatePath = path.join(cwd, "gtd", "strategy", "cockpit-state.json");

      if (req.method === "GET") {
        try {
          var stateContent = fs.readFileSync(cockpitStatePath, "utf8");
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
          res.end(stateContent);
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"sessionDate":null,"testStatus":{},"notes":[]}');
        }
        return true;
      }

      if (req.method === "POST") {
        parseJsonBody(req).then(function (body) {
          try {
            fs.writeFileSync(cockpitStatePath, JSON.stringify(body, null, 2));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch (e) {
            res.writeHead(500); res.end('{"error":"Failed to write cockpit state"}');
          }
        }).catch(function (e) { console.error("[project] cockpit-state error:", e.message || e); res.writeHead(400); res.end("Bad request"); });
        return true;
      }
    }

    // --- Agent task endpoints ---
    if (req.method === "GET" && urlPath === "/api/agent/tasks") {
      var taskList = Object.keys(agentTasks.TASKS).map(function (k) {
        return { id: k, description: agentTasks.TASKS[k].description };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tasks: taskList, running: agentTasks.getRunningTask() }));
      return true;
    }

    // Get task prompt text for interactive injection into a session
    if (req.method === "GET" && urlPath.startsWith("/api/agent/task-prompt")) {
      var taskParam = new URL(req.url, "http://x").searchParams.get("task");
      var taskDef = taskParam && agentTasks.TASKS[taskParam];
      if (!taskDef) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown task: " + taskParam }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ task: taskParam, prompt: taskDef.prompt + "\n" + taskDef.outputInstruction }));
      return true;
    }

    if (req.method === "POST" && urlPath === "/api/agent/run") {
      parseJsonBody(req).then(async function (body) {
        var taskName = body.task;
        if (!taskName || !agentTasks.TASKS[taskName]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown task: " + taskName }));
          return;
        }
        if (agentTasks.isRunning()) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Task already running: " + agentTasks.getRunningTask() }));
          return;
        }

        var runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
        send({ type: "agent_task_start", runId: runId, task: taskName });

        // Run async — respond immediately with runId
        agentTasks.runAgentTask(taskName, {
          cwd: cwd,
          getSDK: getSDK,
          onProgress: function (evt) {
            send({ type: "agent_task_progress", runId: runId, event: evt });
          },
          onComplete: function (result) {
            send({ type: "agent_task_done", runId: runId, task: taskName, data: result.data });
          },
        }).catch(function (e) {
          console.log("[agent] Task error:", e.message);
          send({ type: "agent_task_error", runId: runId, error: e.message });
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, runId: runId, task: taskName }));
      }).catch(function (e) { console.error("[project] agent-run error:", e.message || e); res.writeHead(400); res.end("Bad request"); });
      return true;
    }

    // Session messages endpoint — read recent messages from a session
    if (req.method === "GET" && urlPath.startsWith("/api/sessions/") && urlPath.includes("/messages")) {
      var sessionIdMatch = urlPath.match(/\/api\/sessions\/([^/]+)\/messages/);
      if (sessionIdMatch) {
        var targetId = decodeURIComponent(sessionIdMatch[1]);
        var targetSession = sm.sessions.get(targetId);
        if (!targetSession) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"session not found"}');
          return true;
        }
        // Extract limit from query string (default 50)
        var msgLimit = 50;
        var qIdx = urlPath.indexOf("?");
        if (qIdx !== -1) {
          var params = new URLSearchParams(urlPath.substring(qIdx));
          if (params.get("limit")) msgLimit = parseInt(params.get("limit")) || 50;
        }
        // Return last N history entries, filtering to user/assistant messages and results
        var messages = [];
        var history = targetSession.history || [];
        var startIdx = Math.max(0, history.length - msgLimit * 3); // over-scan to get enough
        for (var hi = startIdx; hi < history.length; hi++) {
          var h = history[hi];
          if (h.type === "user_message") {
            messages.push({ type: "user", text: h.text || "" });
          } else if (h.type === "delta" || h.type === "assistant_delta") {
            // Accumulate assistant text
            var lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.type === "assistant") {
              lastMsg.text += (h.text || h.delta || "");
            } else {
              messages.push({ type: "assistant", text: h.text || h.delta || "" });
            }
          } else if (h.type === "tool_start") {
            // Finalize any in-progress assistant
            messages.push({ type: "tool", name: h.name || h.toolName || "tool" });
          } else if (h.type === "result" || h.type === "done") {
            // Mark turn boundary — finalize assistant
            var lastA = messages[messages.length - 1];
            if (lastA && lastA.type === "assistant") lastA.done = true;
          }
        }
        // Trim to limit
        if (messages.length > msgLimit) messages = messages.slice(-msgLimit);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
        res.end(JSON.stringify({ sessionId: targetId, title: targetSession.title || "", messages: messages }));
        return true;
      }
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project, slug: slug }));
      return true;
    }

    return false; // not handled
  }

  // --- Destroy ---
  function destroy() {
    stopFileWatch();
    stopAllDirWatches();
    // Force-kill all active sessions and their subprocess trees
    sm.sessions.forEach(function (session) {
      if (session.queryInstance && session.queryInstance.close) {
        try { session.queryInstance.close(); } catch (e) {}
      }
      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
    });
    // Kill all terminals
    tm.destroyAll();
    for (var [ws] of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
  }

  // --- Status info ---
  function getStatus() {
    var sessionCount = sm.sessions.size;
    var hasProcessing = false;
    sm.sessions.forEach(function (s) {
      if (s.isProcessing) hasProcessing = true;
    });
    return {
      slug: slug,
      path: cwd,
      project: project,
      title: title,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
    };
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, lanHost: lanHost, accountLabel: accountLabel, accounts: accounts.map(function(a) { return { id: a.name, email: a.email }; }), projectCount: getProjectCount(), projects: getProjectList() });
  }

  return {
    cwd: cwd,
    slug: slug,
    project: project,
    clients: clients,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    handleDisconnection: handleDisconnection,
    handleHTTP: handleHTTP,
    getStatus: getStatus,
    setTitle: setTitle,
    warmup: function () { sdk.warmup(); },
    destroy: destroy,
  };
}

function parseJsonBody(req) {
  var MAX_BODY_SIZE = 1024 * 1024; // 1 MB
  var TIMEOUT_MS = 10000; // 10 seconds
  return new Promise(function (resolve, reject) {
    var body = "";
    var size = 0;
    var timer = setTimeout(function () {
      req.destroy();
      var err = new Error("Request timeout");
      err.statusCode = 408;
      reject(err);
    }, TIMEOUT_MS);
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        clearTimeout(timer);
        var err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on("end", function () {
      clearTimeout(timer);
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on("error", function (e) {
      clearTimeout(timer);
      reject(e);
    });
  });
}

module.exports = { createProjectContext: createProjectContext };
