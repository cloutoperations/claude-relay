const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendToViewers = opts.sendToViewers || send;  // function(sessionId, obj) - send to session viewers
  var accounts = opts.accounts || [];

  // --- Multi-session state ---
  var sessions = new Map();     // cliSessionId -> session object
  var defaultSessionId = null;  // cliSessionId of default session for new connections
  var slashCommands = null;     // shared across sessions
  var skillNames = null;        // Claude-only skills to filter from slash menu

  // --- Session persistence ---
  // Namespace sessions by relay instance to avoid collisions when multiple relays share a project
  var relayHome = process.env.CLAUDE_RELAY_HOME;
  var sessionsSubdir = relayHome ? "sessions-" + path.basename(relayHome) : "sessions";
  var sessionsDir = path.join(cwd, ".claude-relay", sessionsSubdir);
  fs.mkdirSync(sessionsDir, { recursive: true });

  function sessionFilePath(cliSessionId, sourceDir) {
    var dir = sourceDir || sessionsDir;
    return path.join(dir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    // Don't persist sessions with temporary UUIDs (not yet confirmed by SDK)
    if (session._tempId) return;
    session.lastActivity = Date.now();
    // Ensure sourceDir is set for new sessions based on their account
    if (!session.sourceDir) {
      session.sourceDir = sessionsDir;
    }
    var fp = sessionFilePath(session.cliSessionId, session.sourceDir);
    try {
      // Safety: never overwrite a file that has content with an empty history
      if (session.history.length === 0) {
        try {
          var stat = fs.statSync(fp);
          if (stat.size > 200) return; // file has real content, don't nuke it
        } catch(e2) {} // file doesn't exist yet, safe to create
      }
      var metaObj = {
        type: "meta",
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.accountId) metaObj.accountId = session.accountId;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      if (session.projectPath) metaObj.projectPath = session.projectPath;
      var meta = JSON.stringify(metaObj);
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      fs.writeFileSync(fp, lines.join("\n") + "\n");
    } catch(e) {
      console.error("[session] Failed to save session file:", e.message);
    }
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId || session._tempId) return;
    session.lastActivity = Date.now();
    try {
      fs.appendFileSync(sessionFilePath(session.cliSessionId, session.sourceDir), JSON.stringify(obj) + "\n");
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
      var seenCli = {}; // cliSessionId -> index in allLoaded
      for (var li = 0; li < allLoaded.length; li++) {
        seenCli[allLoaded[li].meta.cliSessionId] = li;
      }
      try {
        var entries = fs.readdirSync(relayBaseDir);
        for (var ei = 0; ei < entries.length; ei++) {
          if (!entries[ei].startsWith("sessions-") || entries[ei] === path.basename(sessionsDir)) continue;
          var otherDir = path.join(relayBaseDir, entries[ei]);
          try { if (!fs.statSync(otherDir).isDirectory()) continue; } catch { continue; }

          // Determine which account this dir belongs to by matching relay home name
          var relayName = entries[ei].replace("sessions-", "");
          var acctSuffix = relayName.replace(/^\.?claude-relay-?/, "");
          var matchedAcctId = null;
          for (var ai = 0; ai < accounts.length; ai++) {
            if (accounts[ai].name === acctSuffix) { matchedAcctId = accounts[ai].name; break; }
          }
          if (!matchedAcctId && accounts.length > 1) matchedAcctId = acctSuffix || accounts[accounts.length - 1].name;

          var otherSessions = loadSessionsFromDir(otherDir, matchedAcctId);
          // Deduplicate by cliSessionId — keep the copy with MORE history, delete the other from disk
          for (var oi = 0; oi < otherSessions.length; oi++) {
            var cid = otherSessions[oi].meta.cliSessionId;
            if (!(cid in seenCli)) {
              seenCli[cid] = allLoaded.length;
              allLoaded.push(otherSessions[oi]);
            } else {
              var existingIdx = seenCli[cid];
              var existing = allLoaded[existingIdx];
              var incoming = otherSessions[oi];
              if (incoming.history.length > existing.history.length) {
                // Incoming has more history — keep it, delete the existing's file
                try { fs.unlinkSync(path.join(existing.sourceDir, cid + ".jsonl")); } catch(e) {}
                allLoaded[existingIdx] = incoming;
              } else {
                // Existing has more (or equal) — delete the incoming's duplicate file
                try { fs.unlinkSync(path.join(incoming.sourceDir, cid + ".jsonl")); } catch(e) {}
              }
            }
          }
        }
      } catch (e) {}
    }

    allLoaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < allLoaded.length; i++) {
      var m = allLoaded[i].meta;
      // Reconstruct messageUUIDs from history
      var messageUUIDs = [];
      for (var k = 0; k < allLoaded[i].history.length; k++) {
        if (allLoaded[i].history[k].type === "message_uuid") {
          messageUUIDs.push({ uuid: allLoaded[i].history[k].uuid, type: allLoaded[i].history[k].messageType, historyIndex: k });
        }
      }
      var session = {
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        accountId: m.accountId || null,
        sourceDir: allLoaded[i].sourceDir || null,
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
        projectPath: m.projectPath || null,
      };
      sessions.set(m.cliSessionId, session);
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
  }

  function makeSessionObj() {
    var tempId = crypto.randomUUID();
    var session = {
      queryInstance: null,
      messageQueue: null,
      cliSessionId: tempId,
      _tempId: true,          // flag: not yet confirmed by SDK
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
      projectPath: null,
    };
    sessions.set(tempId, session);
    return session;
  }

  function createSession(ws, sendToFn, accountId, projectPath) {
    var session = makeSessionObj();
    if (accountId) session.accountId = accountId;
    if (projectPath) session.projectPath = projectPath;
    if (ws && sendToFn) {
      switchSessionForClient(ws, session.cliSessionId, sendToFn);
    }
    // Don't set defaultSessionId — only affects the requesting client (Bug 3 fix)
    broadcastSessionList();
    return session;
  }

  var HISTORY_PAGE_SIZE = 2000;

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

  function switchSessionForClient(ws, sessionId, sendToFn) {
    var session = sessions.get(sessionId);
    if (!session) return;

    sendToFn(ws, { type: "session_switched", id: session.cliSessionId, cliSessionId: session.cliSessionId });
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

  function deleteSession(sessionId, clientsMap, sendToFn) {
    var session = sessions.get(sessionId);
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

    if (session.cliSessionId && !session._tempId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(sessionId);

    // Find a fallback session for displaced clients
    var remaining = [...sessions.keys()];
    var fallbackId = remaining.length > 0 ? remaining[remaining.length - 1] : null;

    // Move all clients that were viewing the deleted session
    if (clientsMap) {
      for (var [ws, state] of clientsMap) {
        if (state.sessionId === sessionId) {
          if (fallbackId) {
            state.sessionId = fallbackId;
            switchSessionForClient(ws, fallbackId, sendToFn);
          } else {
            // No sessions left, create a new one
            var newSession = makeSessionObj();
            state.sessionId = newSession.cliSessionId;
            switchSessionForClient(ws, newSession.cliSessionId, sendToFn);
            fallbackId = newSession.cliSessionId; // reuse for other displaced clients
          }
        }
      }
    }

    if (defaultSessionId === sessionId) {
      defaultSessionId = fallbackId;
    }

    broadcastSessionList();
  }

  function doSendAndRecord(session, obj) {
    session.history.push(obj);
    appendToSessionFile(session, obj);
    sendToViewers(session.cliSessionId, obj);
  }

  // Re-key a session when SDK provides the real cliSessionId
  function rekeySession(oldId, newId) {
    var session = sessions.get(oldId);
    if (!session) return;
    sessions.delete(oldId);
    session.cliSessionId = newId;
    delete session._tempId;
    sessions.set(newId, session);
    // Update defaultSessionId if it pointed to the old key
    if (defaultSessionId === oldId) defaultSessionId = newId;
  }

  function resumeSession(cliSessionId, ws, sendToFn, accountId) {
    // Check if this session is already loaded
    if (sessions.has(cliSessionId)) {
      var existing = sessions.get(cliSessionId);
      if (ws && sendToFn) {
        switchSessionForClient(ws, cliSessionId, sendToFn);
      }
      broadcastSessionList();
      return existing;
    }
    var session = {
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
    sessions.set(cliSessionId, session);
    saveSessionFile(session);
    if (ws && sendToFn) {
      switchSessionForClient(ws, cliSessionId, sendToFn);
    }
    // Don't set defaultSessionId — only affects the requesting client (Bug 3 fix)
    broadcastSessionList();
    return session;
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    var initSession = makeSessionObj();
    defaultSessionId = initSession.cliSessionId;
  } else {
    // Set default to the most recently used session
    var allSessions = [...sessions.values()];
    var mostRecent = allSessions[0];
    for (var i = 1; i < allSessions.length; i++) {
      if ((allSessions[i].lastActivity || 0) > (mostRecent.lastActivity || 0)) {
        mostRecent = allSessions[i];
      }
    }
    defaultSessionId = mostRecent.cliSessionId;
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
        if (entry.text && entry.text.toLowerCase().indexOf(q) !== -1) {
          contentMatch = true;
          break;
        }
        if (entry.input) {
          try {
            var inputStr = typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input);
            if (inputStr.toLowerCase().indexOf(q) !== -1) {
              contentMatch = true;
              break;
            }
          } catch (e) {}
        }
        if (entry.result && typeof entry.result === "string" && entry.result.toLowerCase().indexOf(q) !== -1) {
          contentMatch = true;
          break;
        }
      }
      if (titleMatch || contentMatch) {
        results.push({
          id: session.cliSessionId,
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
    rekeySession: rekeySession,
    broadcastSessionList: broadcastSessionList,
    saveSessionFile: saveSessionFile,
    clearSessionId: function(session) {
      // Delete old session file and clear cliSessionId so next query starts fresh
      if (session.cliSessionId && !session._tempId) {
        try { fs.unlinkSync(sessionFilePath(session.cliSessionId, session.sourceDir)); } catch(e) {}
      }
      // Remove from map, assign new temp ID
      sessions.delete(session.cliSessionId);
      var newTempId = crypto.randomUUID();
      session.cliSessionId = newTempId;
      session._tempId = true;
      sessions.set(newTempId, session);
    },
    appendToSessionFile: appendToSessionFile,
    sendAndRecord: doSendAndRecord,
    findTurnBoundary: findTurnBoundary,
    replayHistoryTo: replayHistoryTo,
    searchSessions: searchSessions,
    setSendToViewers: setSendToViewers,
  };
}

module.exports = { createSessionManager };
