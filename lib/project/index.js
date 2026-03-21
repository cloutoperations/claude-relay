var fs = require("fs");
var path = require("path");
var { createSessionManager } = require("../sessions");
var { createSDKBridge } = require("../sdk/index");
var { createTerminalManager } = require("../terminal-manager");
var { fetchAllUsage } = require("../usage");
var agentTasks = require("../agent-tasks");
var { IGNORED_DIRS } = require("./constants");
var { safePath } = require("./utils");
var { createFilesManager } = require("./files");
var { createHTTPHandler } = require("./http");

// Handler modules — each exports { message_type: async fn(ctx, ws, msg) }
var gitHandlers = require("./git");
var sessionHandlers = require("./sessions");
var chatHandlers = require("./chat");
var terminalHandlers = require("./terminal");
var systemHandlers = require("./system");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// Static handlers (shared across all projects)
var staticHandlers = Object.assign({},
  gitHandlers,
  sessionHandlers,
  chatHandlers,
  terminalHandlers,
  systemHandlers
);

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
  var clients = new Map();
  var sessionViewers = {};

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

  function sendToSessionViewers(sessionId, obj) {
    var data = JSON.stringify(obj);
    var popupData = null;
    var sentCount = 0;
    var viewers = sessionViewers[sessionId];
    if (viewers) {
      for (var ws of viewers) {
        if (ws.readyState === 1) { ws.send(data); sentCount++; }
      }
    }
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
    var viewers = sessionViewers[sessionId];
    if (viewers) {
      for (var ws of viewers) {
        if (ws === sender || ws.readyState !== 1) continue;
        ws.send(data);
      }
    }
    for (var [ws2, state] of clients) {
      if (ws2 === sender || ws2.readyState !== 1) continue;
      if (state.popups.has(sessionId)) {
        if (!popupData) popupData = JSON.stringify(Object.assign({}, obj, { _popupSessionId: sessionId }));
        ws2.send(popupData);
      }
    }
  }

  function getClientSession(ws) {
    var state = clients.get(ws);
    return state ? sm.sessions.get(state.sessionId) : null;
  }

  // --- Per-project files manager (watchers, index, handlers) ---
  var filesManager = createFilesManager(cwd, send);

  // Merge static + per-project file handlers into dispatch table
  var handlers = Object.assign({}, staticHandlers, filesManager.handlers);

  // --- Session manager ---
  var sm = createSessionManager({ cwd: cwd, send: send, accounts: accounts, getOtherProjectDirs: function() {
    var dirs = [];
    try {
      var all = getProjectList();
      for (var i = 0; i < all.length; i++) {
        if (all[i].path && all[i].path !== cwd) dirs.push(all[i].path);
      }
    } catch (e) { console.warn("[project] getOtherProjectDirs error:", e.message); }
    return dirs;
  }});
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
    toolRestrictions: opts.toolRestrictions || null,
    instancePrompt: opts.instancePrompt || null,
    onSessionRekey: function(oldId, newId) {
      if (sessionViewers[oldId]) {
        sessionViewers[newId] = sessionViewers[oldId];
        delete sessionViewers[oldId];
        for (var ws of sessionViewers[newId]) {
          var state = clients.get(ws);
          if (state) state.sessionId = newId;
        }
      }
      for (var [ws2, state2] of clients) {
        if (state2.popups.has(oldId)) {
          state2.popups.delete(oldId);
          state2.popups.add(newId);
        }
      }
    },
    onFileChange: function(filePath) {
      var absFilePath = safePath(cwd, filePath) || filePath;
      var parentDir = path.dirname(absFilePath);
      var relParent = path.relative(cwd, parentDir).split(path.sep).join("/") || ".";
      setTimeout(async function() {
        try {
          var items = await fs.promises.readdir(parentDir, { withFileTypes: true });
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
        } catch (e) { console.warn("[project] fs_dir_changed error:", e.message || e); }
      }, 500);
    },
  });

  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });

  // --- Shared context for handlers ---
  var _warmedUp = false;
  var ctx = {
    cwd: cwd,
    slug: slug,
    project: project,
    clients: clients,
    sessionViewers: sessionViewers,
    sm: sm,
    sdk: sdk,
    tm: tm,
    send: send,
    sendTo: sendTo,
    sendToSessionViewers: sendToSessionViewers,
    sendToSessionViewersExcept: sendToSessionViewersExcept,
    getClientSession: getClientSession,
    setClientSession: setClientSession,
    resolveAccount: resolveAccount,
    accounts: accounts,
    debug: debug,
    pushModule: pushModule,
    fetchAllUsage: fetchAllUsage,
    agentTasks: agentTasks,
    getSDK: getSDK,
    _warmedUp: _warmedUp,
    handleMessage: handleMessage,
  };

  // --- HTTP handler ---
  var httpHandler = createHTTPHandler(ctx);

  // --- WS message dispatch ---
  async function handleMessage(ws, msg) {
    var handler = handlers[msg.type];
    if (handler) {
      try {
        await handler(ctx, ws, msg);
      } catch (err) {
        console.error("[project] Handler error for", msg.type, ":", err.message || err);
      }
      return;
    }
    // Unknown message type — ignore silently
  }

  // --- WS connection handler ---
  function handleConnection(ws) {
    clients.set(ws, { sessionId: null, popups: new Set() });
    broadcastClientCount();

    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, lanHost: lanHost, accountLabel: accountLabel, accounts: accounts.map(function(a) { return { id: a.name, email: a.email }; }), projectCount: getProjectCount(), projects: getProjectList() });
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    sendTo(ws, {
      type: "config_state",
      model: sm.currentModel || "",
      effort: sm.currentEffort || "",
      fastMode: sm.fastMode || false,
      permissionMode: sm.currentPermissionMode || "default",
    });
    sendTo(ws, { type: "term_list", terminals: tm.list() });

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

    var requestedSessionId = null;
    try {
      var urlParams = new URLSearchParams(ws._relayQuery || "");
      var sParam = urlParams.get("s");
      if (sParam) requestedSessionId = sParam;
    } catch(e) { console.warn("[project] Failed to parse session query param:", e.message); }

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

  // --- WS disconnection handler ---
  function handleDisconnection(ws) {
    var clientState = clients.get(ws);
    if (clientState && clientState.sessionId) {
      var session = sm.sessions.get(clientState.sessionId);
      if (session) {
        var viewers = sessionViewers[clientState.sessionId];
        var hasOtherViewer = viewers && viewers.size > 1;
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
      removeViewer(clientState.sessionId, ws);
    }
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) {
      filesManager.destroy();
    }
    broadcastClientCount();
  }

  // --- Destroy ---
  function destroy() {
    filesManager.destroy();
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
    tm.destroyAll();
    for (var [ws] of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
  }

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
    handleHTTP: httpHandler,
    getStatus: getStatus,
    setTitle: setTitle,
    warmup: function () { sdk.warmup(); },
    destroy: destroy,
  };
}

module.exports = { createProjectContext: createProjectContext };
