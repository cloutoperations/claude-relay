const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendToViewers = opts.sendToViewers || send;  // function(sessionId, obj) - send to session viewers
  var accounts = opts.accounts || [];
  var getOtherProjectDirs = opts.getOtherProjectDirs || function() { return []; };

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

  async function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    // Don't persist sessions with temporary UUIDs (not yet confirmed by SDK)
    // EXCEPT expired sessions — they have real history worth keeping
    if (session._tempId && session.status !== "expired") return;
    session.lastActivity = Date.now();
    // Ensure sourceDir is set for new sessions based on their account
    if (!session.sourceDir) {
      session.sourceDir = sessionsDir;
    }
    var fp = sessionFilePath(session.cliSessionId, session.sourceDir);
    try {
      var metaObj = {
        type: "meta",
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.accountId) metaObj.accountId = session.accountId;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      if (session.projectPath) metaObj.projectPath = session.projectPath;
      if (session.archived) metaObj.archived = session.archived;
      if (session.status && session.status !== 'open') metaObj.status = session.status;
      if (session.viewerName) metaObj.viewerName = session.viewerName;
      if (session.boardCardId) metaObj.boardCardId = session.boardCardId;
      var meta = JSON.stringify(metaObj);
      // If history not loaded or empty, just update meta line — don't load 7MB of history for a title change
      if (session.history === null || session.history.length === 0) {
        try {
          var stat = await fs.promises.stat(fp);
          if (stat.size > 200) {
            var existing = await fs.promises.readFile(fp, "utf8");
            var existingLines = existing.split("\n");
            try {
              var firstLine = JSON.parse(existingLines[0]);
              if (firstLine.type === "meta") {
                existingLines[0] = meta;
              } else {
                existingLines.unshift(meta);
              }
            } catch(e3) {
              existingLines.unshift(meta);
            }
            var tmpFp2 = fp + ".tmp";
            await fs.promises.writeFile(tmpFp2, existingLines.join("\n"));
            await fs.promises.rename(tmpFp2, fp);
            return;
          }
        } catch(e2) {} // file doesn't exist yet, safe to create
        if (session.history === null) return; // unloaded session, file should already exist
      }
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      var tmpFp = fp + ".tmp";
      await fs.promises.writeFile(tmpFp, lines.join("\n") + "\n");
      await fs.promises.rename(tmpFp, fp);
    } catch(e) {
      console.error("[session] Failed to save session file:", e.message);
    }
  }

  // --- Session metadata overlay ---
  // Stores extra relay metadata (like boardCardId) separately from CLI-managed .jsonl files.
  // This avoids conflicts with the Claude CLI's own session file management.
  var metaOverlayDir = path.join(cwd, ".claude-relay", "session-meta");
  try { fs.mkdirSync(metaOverlayDir, { recursive: true }); } catch(e) {}

  function saveMetaOverlay(sessionId, data) {
    if (!sessionId) return;
    try {
      var fp = path.join(metaOverlayDir, sessionId + ".json");
      fs.writeFileSync(fp, JSON.stringify(data));
      _metaOverlays[sessionId] = data; // update in-memory cache
    } catch(e) { console.error("[session] Failed to save meta overlay:", e.message); }
  }

  function loadMetaOverlay(sessionId) {
    if (!sessionId) return null;
    try {
      var fp = path.join(metaOverlayDir, sessionId + ".json");
      return JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch(e) { return null; }
  }

  function loadAllMetaOverlays() {
    var overlays = {};
    try {
      var files = fs.readdirSync(metaOverlayDir);
      for (var i = 0; i < files.length; i++) {
        if (!files[i].endsWith(".json")) continue;
        var id = files[i].replace(".json", "");
        try { overlays[id] = JSON.parse(fs.readFileSync(path.join(metaOverlayDir, files[i]), "utf8")); } catch(e) {}
      }
    } catch(e) {}
    return overlays;
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    if (session._tempId && session.status !== "expired") return;
    session.lastActivity = Date.now();
    fs.promises.appendFile(sessionFilePath(session.cliSessionId, session.sourceDir), JSON.stringify(obj) + "\n")
      .catch(function(e) { console.error("[session] Failed to append to session file:", e.message); });
  }

  // Lazy history loading: on startup, only read the first line (metadata) of each session file.
  // Full history is loaded on-demand when a session is first accessed via ensureHistoryLoaded().
  function loadSessionsFromDir(dir, defaultAccountId) {
    var files;
    try { files = fs.readdirSync(dir); } catch (e) { console.warn("[session] readdirSync failed for", dir, ":", e.message); return []; }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var filePath = path.join(dir, files[i]);

      // Read only the first line (metadata) — not the entire file
      var meta;
      var fd = null;
      try {
        fd = fs.openSync(filePath, "r");
        var buf = Buffer.alloc(4096); // metadata line is always < 4KB
        var bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        var firstLine = buf.toString("utf8", 0, bytesRead).split("\n")[0];
        meta = JSON.parse(firstLine);
      } catch (e) { console.warn("[session] Failed to read session meta:", filePath, e.message); continue; } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch {}
      }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      if (!meta.accountId && defaultAccountId) meta.accountId = defaultAccountId;

      var fileMtime = 0;
      try { fileMtime = fs.statSync(filePath).mtimeMs; } catch (e) { console.warn("[session] statSync mtime failed:", filePath, e.message); }
      loaded.push({ meta: meta, history: null, mtime: fileMtime, sourceDir: dir, _historyFile: filePath });
    }
    return loaded;
  }

  // Load full history from disk for a session (called on first access)
  function ensureHistoryLoaded(session) {
    if (session.history !== null) return; // already loaded
    if (session._loadingHistory) return; // concurrent load guard
    session._loadingHistory = true;
    var filePath = session._historyFile;
    if (!filePath) { session.history = []; session._loadingHistory = false; return; }
    try {
      var content = fs.readFileSync(filePath, "utf8");
      var lines = content.trim().split("\n");
      var history = [];
      for (var j = 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        try {
          var entry = JSON.parse(lines[j]);
          if (entry && typeof entry === "object") history.push(entry);
        } catch (e) { console.warn("[session] Skipping corrupt history line", j, "in", filePath, ":", e.message); }
      }
      session.history = history;
      // Reconstruct messageUUIDs
      session.messageUUIDs = [];
      for (var k = 0; k < history.length; k++) {
        if (history[k].type === "message_uuid") {
          session.messageUUIDs.push({ uuid: history[k].uuid, type: history[k].messageType, historyIndex: k });
        }
      }
    } catch (e) {
      console.error("[session] Failed to load history from", filePath, e.message);
      session.history = [];
    } finally {
      session._loadingHistory = false;
    }
  }

  async function ensureHistoryLoadedAsync(session) {
    if (session.history !== null) return;
    // If already loading, wait for it to finish instead of bailing
    if (session._loadingHistory) {
      return session._loadingPromise || Promise.resolve();
    }
    session._loadingHistory = true;
    var filePath = session._historyFile;
    if (!filePath) { session.history = []; session._loadingHistory = false; return; }
    session._loadingPromise = (async function() {
      try {
        var content = await fs.promises.readFile(filePath, "utf8");
        var lines = content.trim().split("\n");
        var history = [];
        for (var j = 1; j < lines.length; j++) {
          if (!lines[j].trim()) continue;
          try {
            var entry = JSON.parse(lines[j]);
            if (entry && typeof entry === "object") history.push(entry);
          } catch (parseErr) {
            console.warn("[session] Skipping corrupt history line", j, "in", filePath);
          }
        }
        session.history = history;
        session.messageUUIDs = [];
        for (var k = 0; k < history.length; k++) {
          if (history[k].type === "message_uuid") {
            session.messageUUIDs.push({ uuid: history[k].uuid, type: history[k].messageType, historyIndex: k });
          }
        }
      } catch (e) {
        console.error("[session] Failed to load history from", filePath, e.message);
        session.history = [];
      } finally {
        session._loadingHistory = false;
        session._loadingPromise = null;
      }
    })();
    return session._loadingPromise;
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
          try { if (!fs.statSync(otherDir).isDirectory()) continue; } catch (e) { console.warn("[session] statSync failed for", otherDir, ":", e.message); continue; }

          // Determine which account this dir belongs to by matching relay home name
          var relayName = entries[ei].replace("sessions-", "");
          var acctSuffix = relayName.replace(/^\.?claude-relay-?/, "");
          var matchedAcctId = null;
          for (var ai = 0; ai < accounts.length; ai++) {
            if (accounts[ai].name === acctSuffix) { matchedAcctId = accounts[ai].name; break; }
          }
          if (!matchedAcctId && accounts.length > 1) matchedAcctId = acctSuffix || accounts[accounts.length - 1].name;

          var otherSessions = loadSessionsFromDir(otherDir, matchedAcctId);
          // Deduplicate by cliSessionId — keep the newer copy (by mtime)
          for (var oi = 0; oi < otherSessions.length; oi++) {
            var cid = otherSessions[oi].meta.cliSessionId;
            if (!(cid in seenCli)) {
              seenCli[cid] = allLoaded.length;
              allLoaded.push(otherSessions[oi]);
            } else {
              var existingIdx = seenCli[cid];
              var existing = allLoaded[existingIdx];
              var incoming = otherSessions[oi];
              if ((incoming.mtime || 0) > (existing.mtime || 0)) {
                // Incoming is newer — keep it
                allLoaded[existingIdx] = incoming;
              }
            }
          }
        }
      } catch (e) { console.warn("[session] Multi-account session scan error:", e.message || e); }
    }

    allLoaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < allLoaded.length; i++) {
      var m = allLoaded[i].meta;
      // History is null (lazy-loaded) — messageUUIDs will be populated by ensureHistoryLoaded()
      var session = {
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        accountId: m.accountId || null,
        sourceDir: allLoaded[i].sourceDir || null,
        _historyFile: allLoaded[i]._historyFile || null,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        lastActivity: allLoaded[i].mtime || m.createdAt || Date.now(),
        history: null, // lazy-loaded via ensureHistoryLoaded()
        messageUUIDs: [],
        lastRewindUuid: m.lastRewindUuid || null,
        projectPath: m.projectPath || null,
        archived: m.archived || null,
        status: m.status || 'open',
        viewerName: m.viewerName || null,
        boardCardId: m.boardCardId || null,
      };
      sessions.set(m.cliSessionId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  // Load meta overlays for use in broadcasts
  var _metaOverlays = loadAllMetaOverlays();
  console.log("[session] Loaded", Object.keys(_metaOverlays).length, "meta overlays from", metaOverlayDir, "keys:", Object.keys(_metaOverlays).map(k => k.substring(0, 12)));

  function getDefaultSession() {
    return sessions.get(defaultSessionId) || null;
  }

  function buildSessionList() {
    return [...sessions.values()].map(function(s) {
      var overlay = _metaOverlays[s.cliSessionId];
      return {
        id: s.cliSessionId,
        cliSessionId: s.cliSessionId || null,
        title: s.title || "New Session",
        isProcessing: s.isProcessing,
        lastActivity: s.lastActivity || s.createdAt || 0,
        accountId: s.accountId || null,
        projectPath: s.projectPath || null,
        archived: s.archived || null,
        status: s.status || 'open',
        viewerName: s.viewerName || null,
        boardCardId: s.boardCardId || (overlay ? overlay.boardCardId : null),
      };
    });
  }

  function getSessionListMessage() {
    return { type: "session_list", sessions: buildSessionList() };
  }

  function broadcastSessionList() {
    send(getSessionListMessage());
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
      status: 'open',
      boardCardId: null,
    };
    sessions.set(tempId, session);
    return session;
  }

  async function createSession(ws, sendToFn, accountId, projectPath, requestId) {
    var session = makeSessionObj();
    if (accountId) session.accountId = accountId;
    if (projectPath) session.projectPath = projectPath;
    if (ws && sendToFn) {
      await switchSessionForClient(ws, session.cliSessionId, sendToFn, requestId);
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

  async function replayHistoryTo(session, fromIndex, sendToFn, ws) {
    await ensureHistoryLoadedAsync(session);
    var total = session.history.length;
    if (typeof fromIndex !== "number") {
      if (total <= HISTORY_PAGE_SIZE) {
        fromIndex = 0;
      } else {
        fromIndex = findTurnBoundary(session.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
    }

    sendToFn(ws, { type: "history_meta", total: total, from: fromIndex });

    // Batch sends to yield the event loop every 50 items
    var BATCH = 50;
    for (var i = fromIndex; i < total; i += BATCH) {
      var end = Math.min(i + BATCH, total);
      for (var j = i; j < end; j++) {
        sendToFn(ws, session.history[j]);
      }
      if (end < total) {
        await new Promise(function(resolve) { setImmediate(resolve); });
      }
    }

    sendToFn(ws, { type: "history_done" });
  }

  async function switchSessionForClient(ws, sessionId, sendToFn, requestId) {
    var session = sessions.get(sessionId);
    if (!session) return;

    var switchMsg = { type: "session_switched", id: session.cliSessionId, cliSessionId: session.cliSessionId };
    if (requestId) switchMsg._requestId = requestId;
    sendToFn(ws, switchMsg);
    await replayHistoryTo(session, undefined, sendToFn, ws);

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

  async function deleteSession(sessionId, clientsMap, sendToFn) {
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
      try { await fs.promises.unlink(sessionFilePath(session.cliSessionId)); } catch(e) {}
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
            await switchSessionForClient(ws, fallbackId, sendToFn);
          } else {
            // No sessions left, create a new one
            var newSession = makeSessionObj();
            state.sessionId = newSession.cliSessionId;
            await switchSessionForClient(ws, newSession.cliSessionId, sendToFn);
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
    // Active sessions always have history loaded; this is a safety fallback
    if (session.history === null) { session.history = []; }
    session.history.push(obj);
    appendToSessionFile(session, obj);
    sendToViewers(session.cliSessionId, obj);
  }

  // Re-key a session when SDK provides the real cliSessionId
  async function rekeySession(oldId, newId) {
    var session = sessions.get(oldId);
    if (!session) return;
    // Sync in-memory state update (callers depend on this being immediate)
    sessions.delete(oldId);
    var wasTempId = session._tempId;
    session.cliSessionId = newId;
    delete session._tempId;
    sessions.set(newId, session);
    if (defaultSessionId === oldId) defaultSessionId = newId;

    // Async file operations
    if (!wasTempId) {
      var oldPath = sessionFilePath(oldId, session.sourceDir);
      var newPath = sessionFilePath(newId, session.sourceDir);
      try { await fs.promises.rename(oldPath, newPath); } catch(e) {}
    }
    await saveSessionFile(session);
  }

  async function resumeSession(cliSessionId, ws, sendToFn, accountId) {
    // Check if this session is already loaded
    if (sessions.has(cliSessionId)) {
      var existing = sessions.get(cliSessionId);
      if (ws && sendToFn) {
        await switchSessionForClient(ws, cliSessionId, sendToFn);
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
      status: 'open',
    };
    sessions.set(cliSessionId, session);
    await saveSessionFile(session);
    if (ws && sendToFn) {
      await switchSessionForClient(ws, cliSessionId, sendToFn);
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
    var mostRecent = allSessions[0] || null;
    for (var i = 1; i < allSessions.length; i++) {
      if ((allSessions[i].lastActivity || 0) > ((mostRecent && mostRecent.lastActivity) || 0)) {
        mostRecent = allSessions[i];
      }
    }
    defaultSessionId = mostRecent ? mostRecent.cliSessionId : null;
  }

  async function searchSessions(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    var seenIds = new Set();
    var sessionList = [...sessions.values()];
    for (var si = 0; si < sessionList.length; si++) {
      var session = sessionList[si];
      var titleMatch = (session.title || "New Session").toLowerCase().indexOf(q) !== -1;
      var idMatch = (session.cliSessionId || "").toLowerCase().indexOf(q) !== -1;
      var contentMatch = false;
      // Lazy-load history async if not yet loaded (so search covers all sessions)
      if (!session.history && session._historyFile) {
        try { await ensureHistoryLoadedAsync(session); } catch (e) { console.warn("[session] Search history load error:", e.message || e); }
      }
      var hist = session.history || [];
      for (var i = 0; i < hist.length; i++) {
        var entry = hist[i];
        if (entry.text && entry.text.toLowerCase().indexOf(q) !== -1) {
          contentMatch = true;
          break;
        }
      }
      if (titleMatch || idMatch || contentMatch) {
        seenIds.add(session.cliSessionId);
        var matchType = (titleMatch || idMatch) && contentMatch ? "both" : (titleMatch || idMatch) ? "title" : "content";
        results.push({
          id: session.cliSessionId,
          cliSessionId: session.cliSessionId || null,
          title: session.title || "New Session",
          isProcessing: session.isProcessing,
          lastActivity: session.lastActivity || session.createdAt || 0,
          matchType: matchType,
        });
      }
    }

    // Also search _old_versions/ directories for archived sessions
    results = results.concat(await searchOldVersions(q, seenIds));

    // Cross-project search: scan other projects' session dirs
    results = results.concat(await searchOtherProjects(q, seenIds));

    return results;
  }

  // Search archived sessions in _old_versions/ dirs on-the-fly (not loaded into memory)
  async function searchOldVersions(q, seenIds) {
    var results = [];
    var oldDirs = [];
    var relayBaseDir = path.join(cwd, ".claude-relay");
    try {
      var entries = await fs.promises.readdir(relayBaseDir);
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].startsWith("sessions")) continue;
        var oldDir = path.join(relayBaseDir, entries[i], "_old_versions");
        try { if ((await fs.promises.stat(oldDir)).isDirectory()) oldDirs.push(oldDir); } catch (e) {}
      }
    } catch (e) { return results; }

    for (var di = 0; di < oldDirs.length; di++) {
      var files;
      try { files = await fs.promises.readdir(oldDirs[di]); } catch (e) { continue; }
      for (var fi = 0; fi < files.length; fi++) {
        if (!files[fi].endsWith(".jsonl")) continue;
        var filePath = path.join(oldDirs[di], files[fi]);

        // Read first line for metadata — use async file handle to avoid FD leaks
        var meta;
        try {
          var fh = await fs.promises.open(filePath, "r");
          try {
            var buf = Buffer.alloc(4096);
            var readResult = await fh.read(buf, 0, 4096, 0);
            var firstLine = buf.toString("utf8", 0, readResult.bytesRead).split("\n")[0];
            meta = JSON.parse(firstLine);
          } finally { await fh.close(); }
        } catch (e) { continue; }
        if (!meta || meta.type !== "meta" || !meta.cliSessionId) continue;
        if (seenIds.has(meta.cliSessionId)) continue;

        var titleMatch = (meta.title || "").toLowerCase().indexOf(q) !== -1;
        var idMatch = meta.cliSessionId.toLowerCase().indexOf(q) !== -1;
        var contentMatch = false;

        if (!titleMatch && !idMatch) {
          try {
            var raw = await fs.promises.readFile(filePath, "utf8");
            contentMatch = raw.toLowerCase().indexOf(q) !== -1;
          } catch (e) {}
        }

        if (titleMatch || idMatch || contentMatch) {
          seenIds.add(meta.cliSessionId);
          var fileMtime = 0;
          try { fileMtime = (await fs.promises.stat(filePath)).mtimeMs; } catch (e) {}
          results.push({
            id: meta.cliSessionId,
            cliSessionId: meta.cliSessionId,
            title: meta.title || "New Session",
            isProcessing: false,
            lastActivity: fileMtime || meta.createdAt || 0,
            matchType: (titleMatch || idMatch) && contentMatch ? "both" : (titleMatch || idMatch) ? "title" : "content",
            archived: true,
          });
        }
      }
    }
    return results;
  }

  // Search sessions in other projects' .claude-relay/ dirs (cross-project search)
  async function searchOtherProjects(q, seenIds) {
    var results = [];
    var otherDirs;
    try { otherDirs = getOtherProjectDirs(); } catch (e) { return results; }

    for (var pi = 0; pi < otherDirs.length; pi++) {
      var relayDir = path.join(otherDirs[pi], ".claude-relay");
      var sessionsDirs;
      try { sessionsDirs = await fs.promises.readdir(relayDir); } catch (e) { continue; }

      for (var si = 0; si < sessionsDirs.length; si++) {
        if (!sessionsDirs[si].startsWith("sessions")) continue;
        var dir = path.join(relayDir, sessionsDirs[si]);
        try { if (!(await fs.promises.stat(dir)).isDirectory()) continue; } catch (e) { continue; }

        var scanDirs = [dir];
        var oldDir = path.join(dir, "_old_versions");
        try { if ((await fs.promises.stat(oldDir)).isDirectory()) scanDirs.push(oldDir); } catch (e) {}

        for (var sdi = 0; sdi < scanDirs.length; sdi++) {
          var files;
          try { files = await fs.promises.readdir(scanDirs[sdi]); } catch (e) { continue; }
          for (var fi = 0; fi < files.length; fi++) {
            if (!files[fi].endsWith(".jsonl")) continue;
            var filePath = path.join(scanDirs[sdi], files[fi]);

            var meta;
            try {
              var fh = await fs.promises.open(filePath, "r");
              try {
                var buf = Buffer.alloc(4096);
                var readResult = await fh.read(buf, 0, 4096, 0);
                var firstLine = buf.toString("utf8", 0, readResult.bytesRead).split("\n")[0];
                meta = JSON.parse(firstLine);
              } finally { await fh.close(); }
            } catch (e) { continue; }
            if (!meta || meta.type !== "meta" || !meta.cliSessionId) continue;
            if (seenIds.has(meta.cliSessionId)) continue;

            var titleMatch = (meta.title || "").toLowerCase().indexOf(q) !== -1;
            var idMatch = meta.cliSessionId.toLowerCase().indexOf(q) !== -1;
            var contentMatch = false;

            if (!titleMatch && !idMatch) {
              try {
                var raw = await fs.promises.readFile(filePath, "utf8");
                contentMatch = raw.toLowerCase().indexOf(q) !== -1;
              } catch (e) {}
            }

            if (titleMatch || idMatch || contentMatch) {
              seenIds.add(meta.cliSessionId);
              var fileMtime = 0;
              try { fileMtime = (await fs.promises.stat(filePath)).mtimeMs; } catch (e) {}
              var projectName = path.basename(otherDirs[pi]);
              results.push({
                id: meta.cliSessionId,
                cliSessionId: meta.cliSessionId,
                title: meta.title || "New Session",
                isProcessing: false,
                lastActivity: fileMtime || meta.createdAt || 0,
                matchType: (titleMatch || idMatch) && contentMatch ? "both" : (titleMatch || idMatch) ? "title" : "content",
                archived: true,
                crossProject: projectName,
              });
            }
          }
        }
      }
    }
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
    getSessionListMessage: getSessionListMessage,
    saveSessionFile: saveSessionFile,
    saveMetaOverlay: saveMetaOverlay,
    clearSessionId: function(session) {
      // Session expired on Anthropic's side — keep history but assign new ID for next query.
      // The old session file stays on disk so the user can still read the conversation.
      var oldId = session.cliSessionId;
      sessions.delete(oldId);
      var newTempId = crypto.randomUUID();
      session.cliSessionId = newTempId;
      session._tempId = true;
      session.status = 'expired';
      sessions.set(newTempId, session);
    },
    appendToSessionFile: appendToSessionFile,
    sendAndRecord: doSendAndRecord,
    findTurnBoundary: findTurnBoundary,
    replayHistoryTo: replayHistoryTo,
    ensureHistoryLoaded: ensureHistoryLoaded,
    ensureHistoryLoadedAsync: ensureHistoryLoadedAsync,
    searchSessions: searchSessions,
    setSendToViewers: setSendToViewers,
  };
}

module.exports = { createSessionManager };
