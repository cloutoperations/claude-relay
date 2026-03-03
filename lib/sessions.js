const fs = require("fs");
const path = require("path");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendToViewers = opts.sendToViewers || send;  // function(sessionId, obj) - send to session viewers
  var accounts = opts.accounts || [];

  // --- Multi-session state ---
  var nextLocalId = 1;
  var sessions = new Map();     // localId -> session object
  var defaultSessionId = null;  // default session for new connections
  var slashCommands = null;     // shared across sessions
  var skillNames = null;        // Claude-only skills to filter from slash menu

  // --- Session persistence ---
  // Namespace sessions by relay instance to avoid collisions when multiple relays share a project
  var relayHome = process.env.CLAUDE_RELAY_HOME;
  var sessionsSubdir = relayHome ? "sessions-" + path.basename(relayHome) : "sessions";
  var sessionsDir = path.join(cwd, ".claude-relay", sessionsSubdir);
  fs.mkdirSync(sessionsDir, { recursive: true });

  function sessionFilePath(cliSessionId) {
    return path.join(sessionsDir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    session.lastActivity = Date.now();
    try {
      var metaObj = {
        type: "meta",
        localId: session.localId,
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.accountId) metaObj.accountId = session.accountId;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      var meta = JSON.stringify(metaObj);
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      fs.writeFileSync(sessionFilePath(session.cliSessionId), lines.join("\n") + "\n");
    } catch(e) {
      console.error("[session] Failed to save session file:", e.message);
    }
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    session.lastActivity = Date.now();
    try {
      fs.appendFileSync(sessionFilePath(session.cliSessionId), JSON.stringify(obj) + "\n");
    } catch(e) {
      console.error("[session] Failed to append to session file:", e.message);
    }
  }

  function loadSessionsFromDir(dir, defaultAccountId) {
    var files;
    try { files = fs.readdirSync(dir); } catch { return []; }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var content;
      try { content = fs.readFileSync(path.join(dir, files[i]), "utf8"); } catch { continue; }
      var lines = content.trim().split("\n");
      if (lines.length === 0) continue;

      var meta;
      try { meta = JSON.parse(lines[0]); } catch { continue; }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      // Assign accountId: use persisted value, or default for this dir
      if (!meta.accountId && defaultAccountId) meta.accountId = defaultAccountId;

      var history = [];
      for (var j = 1; j < lines.length; j++) {
        try { history.push(JSON.parse(lines[j])); } catch {}
      }

      var fileMtime = 0;
      try { fileMtime = fs.statSync(path.join(dir, files[i])).mtimeMs; } catch {}
      loaded.push({ meta: meta, history: history, mtime: fileMtime, sourceDir: dir });
    }
    return loaded;
  }

  function loadSessions() {
    var allLoaded = [];

    // Load from primary sessions dir (default account)
    var defaultAcctId = accounts.length > 0 ? accounts[0].name : null;
    allLoaded = allLoaded.concat(loadSessionsFromDir(sessionsDir, defaultAcctId));

    // Multi-account: also scan other instance session dirs in the same .claude-relay folder
    if (accounts.length > 1) {
      var relayBaseDir = path.join(cwd, ".claude-relay");
      var seenCli = new Set();
      for (var li = 0; li < allLoaded.length; li++) {
        seenCli.add(allLoaded[li].meta.cliSessionId);
      }
      try {
        var entries = fs.readdirSync(relayBaseDir);
        for (var ei = 0; ei < entries.length; ei++) {
          if (!entries[ei].startsWith("sessions-") || entries[ei] === path.basename(sessionsDir)) continue;
          var otherDir = path.join(relayBaseDir, entries[ei]);
          try { if (!fs.statSync(otherDir).isDirectory()) continue; } catch { continue; }

          // Determine which account this dir belongs to by matching relay home name
          // e.g. "sessions-.claude-relay-2" → relay home was ".claude-relay-2" → account name "2"
          var relayName = entries[ei].replace("sessions-", ""); // e.g. ".claude-relay-2"
          var acctSuffix = relayName.replace(/^\.?claude-relay-?/, ""); // e.g. "2"
          var matchedAcctId = null;
          for (var ai = 0; ai < accounts.length; ai++) {
            if (accounts[ai].name === acctSuffix) { matchedAcctId = accounts[ai].name; break; }
          }
          if (!matchedAcctId && accounts.length > 1) matchedAcctId = acctSuffix || accounts[accounts.length - 1].name;

          var otherSessions = loadSessionsFromDir(otherDir, matchedAcctId);
          // Deduplicate by cliSessionId (in case same session exists in both dirs)
          for (var oi = 0; oi < otherSessions.length; oi++) {
            if (!seenCli.has(otherSessions[oi].meta.cliSessionId)) {
              seenCli.add(otherSessions[oi].meta.cliSessionId);
              allLoaded.push(otherSessions[oi]);
            }
          }
        }
      } catch (e) {}
    }

    allLoaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < allLoaded.length; i++) {
      var m = allLoaded[i].meta;
      var localId = nextLocalId++;
      // Reconstruct messageUUIDs from history
      var messageUUIDs = [];
      for (var k = 0; k < allLoaded[i].history.length; k++) {
        if (allLoaded[i].history[k].type === "message_uuid") {
          messageUUIDs.push({ uuid: allLoaded[i].history[k].uuid, type: allLoaded[i].history[k].messageType, historyIndex: k });
        }
      }
      var session = {
        localId: localId,
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        accountId: m.accountId || null,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        lastActivity: allLoaded[i].mtime || m.createdAt || Date.now(),
        history: allLoaded[i].history,
        messageUUIDs: messageUUIDs,
        lastRewindUuid: m.lastRewindUuid || null,
      };
      sessions.set(localId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  function getDefaultSession() {
    return sessions.get(defaultSessionId) || null;
  }

  function broadcastSessionList() {
    send({
      type: "session_list",
      sessions: [...sessions.values()].map(function(s) {
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
          accountId: s.accountId || null,
        };
      }),
    });
  }

  function makeSessionObj() {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      accountId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
    };
    sessions.set(localId, session);
    return session;
  }

  function createSession(ws, sendToFn, accountId) {
    var session = makeSessionObj();
    if (accountId) session.accountId = accountId;
    if (ws && sendToFn) {
      switchSessionForClient(ws, session.localId, sendToFn);
    }
    defaultSessionId = session.localId;
    broadcastSessionList();
    return session;
  }

  var HISTORY_PAGE_SIZE = 200;

  function findTurnBoundary(history, targetIndex) {
    for (var i = targetIndex; i >= 0; i--) {
      if (history[i] && history[i].type === "user_message") return i;
    }
    return 0;
  }

  function replayHistoryTo(session, fromIndex, sendToFn, ws) {
    var total = session.history.length;
    if (typeof fromIndex !== "number") {
      if (total <= HISTORY_PAGE_SIZE) {
        fromIndex = 0;
      } else {
        fromIndex = findTurnBoundary(session.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
    }

    sendToFn(ws, { type: "history_meta", total: total, from: fromIndex });

    for (var i = fromIndex; i < total; i++) {
      sendToFn(ws, session.history[i]);
    }

    sendToFn(ws, { type: "history_done" });
  }

  function switchSessionForClient(ws, localId, sendToFn) {
    var session = sessions.get(localId);
    if (!session) return;

    sendToFn(ws, { type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null });
    replayHistoryTo(session, undefined, sendToFn, ws);

    if (session.isProcessing) {
      sendToFn(ws, { type: "status", status: "processing" });
    }

    // Re-send any pending permission requests
    var pendingIds = Object.keys(session.pendingPermissions);
    for (var i = 0; i < pendingIds.length; i++) {
      var p = session.pendingPermissions[pendingIds[i]];
      sendToFn(ws, {
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        decisionReason: p.decisionReason,
      });
    }
  }

  function deleteSession(localId, clientsMap, sendToFn) {
    var session = sessions.get(localId);
    if (!session) return;

    // Force-kill the underlying claude process to prevent orphaned children
    if (session.queryInstance && session.queryInstance.close) {
      try { session.queryInstance.close(); } catch(e) {}
    }
    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }

    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);

    // Find a fallback session for displaced clients
    var remaining = [...sessions.keys()];
    var fallbackId = remaining.length > 0 ? remaining[remaining.length - 1] : null;

    // Move all clients that were viewing the deleted session
    if (clientsMap) {
      for (var [ws, state] of clientsMap) {
        if (state.sessionId === localId) {
          if (fallbackId) {
            state.sessionId = fallbackId;
            switchSessionForClient(ws, fallbackId, sendToFn);
          } else {
            // No sessions left, create a new one
            var newSession = makeSessionObj();
            defaultSessionId = newSession.localId;
            state.sessionId = newSession.localId;
            switchSessionForClient(ws, newSession.localId, sendToFn);
            fallbackId = newSession.localId; // reuse for other displaced clients
          }
        }
      }
    }

    if (defaultSessionId === localId) {
      defaultSessionId = fallbackId;
    }

    broadcastSessionList();
  }

  function doSendAndRecord(session, obj) {
    session.history.push(obj);
    appendToSessionFile(session, obj);
    sendToViewers(session.localId, obj);
  }

  function resumeSession(cliSessionId, ws, sendToFn, accountId) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: cliSessionId,
      accountId: accountId || null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "Resumed session",
      createdAt: Date.now(),
      history: [],
      messageUUIDs: [],
    };
    sessions.set(localId, session);
    saveSessionFile(session);
    if (ws && sendToFn) {
      switchSessionForClient(ws, localId, sendToFn);
    }
    defaultSessionId = localId;
    broadcastSessionList();
    return session;
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    var initSession = makeSessionObj();
    defaultSessionId = initSession.localId;
  } else {
    // Set default to the most recently used session
    var allSessions = [...sessions.values()];
    var mostRecent = allSessions[0];
    for (var i = 1; i < allSessions.length; i++) {
      if ((allSessions[i].lastActivity || 0) > (mostRecent.lastActivity || 0)) {
        mostRecent = allSessions[i];
      }
    }
    defaultSessionId = mostRecent.localId;
  }

  function searchSessions(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    sessions.forEach(function (session) {
      var titleMatch = (session.title || "New Session").toLowerCase().indexOf(q) !== -1;
      var contentMatch = false;
      for (var i = 0; i < session.history.length; i++) {
        var entry = session.history[i];
        // Search text fields across all entry types
        if (entry.text && entry.text.toLowerCase().indexOf(q) !== -1) {
          contentMatch = true;
          break;
        }
        // Search tool inputs (file paths, commands, code content)
        if (entry.input) {
          try {
            var inputStr = typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input);
            if (inputStr.toLowerCase().indexOf(q) !== -1) {
              contentMatch = true;
              break;
            }
          } catch (e) {}
        }
        // Search tool results
        if (entry.result && typeof entry.result === "string" && entry.result.toLowerCase().indexOf(q) !== -1) {
          contentMatch = true;
          break;
        }
      }
      if (titleMatch || contentMatch) {
        results.push({
          id: session.localId,
          cliSessionId: session.cliSessionId || null,
          title: session.title || "New Session",
          isProcessing: session.isProcessing,
          lastActivity: session.lastActivity || session.createdAt || 0,
          matchType: titleMatch && contentMatch ? "both" : titleMatch ? "title" : "content",
        });
      }
    });
    return results;
  }

  function setSendToViewers(fn) {
    sendToViewers = fn;
  }

  return {
    get defaultSessionId() { return defaultSessionId; },
    // Backward compat alias
    get activeSessionId() { return defaultSessionId; },
    get nextLocalId() { return nextLocalId; },
    get slashCommands() { return slashCommands; },
    set slashCommands(v) { slashCommands = v; },
    get skillNames() { return skillNames; },
    set skillNames(v) { skillNames = v; },
    sessions: sessions,
    HISTORY_PAGE_SIZE: HISTORY_PAGE_SIZE,
    getDefaultSession: getDefaultSession,
    createSession: createSession,
    switchSessionForClient: switchSessionForClient,
    deleteSession: deleteSession,
    resumeSession: resumeSession,
    broadcastSessionList: broadcastSessionList,
    saveSessionFile: saveSessionFile,
    appendToSessionFile: appendToSessionFile,
    sendAndRecord: doSendAndRecord,
    findTurnBoundary: findTurnBoundary,
    replayHistoryTo: replayHistoryTo,
    searchSessions: searchSessions,
    setSendToViewers: setSendToViewers,
  };
}

module.exports = { createSessionManager };
