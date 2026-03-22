var crypto = require("crypto");

module.exports = {
  async load_more_history(ctx, ws, msg) {
    var histSession = msg.sessionId ? ctx.sm.sessions.get(msg.sessionId) : ctx.getClientSession(ws);
    if (!histSession || typeof msg.before !== "number") return;
    await ctx.sm.ensureHistoryLoadedAsync(histSession);
    if (!histSession.history) histSession.history = [];
    var before = Math.min(msg.before, histSession.history.length);
    var from = ctx.sm.findTurnBoundary(histSession.history, Math.max(0, before - ctx.sm.HISTORY_PAGE_SIZE));
    var to = before;
    var items = histSession.history.slice(from, to);
    ctx.sendTo(ws, {
      type: "history_prepend",
      sessionId: msg.sessionId || null,
      items: items,
      meta: { from: from, to: to, hasMore: from > 0 },
    });
  },

  async new_session(ctx, ws, msg) {
    var newSession = ctx.sm.createSession(ws, ctx.sendTo, msg.accountId || null, null, msg._requestId);
    if (msg.projectPath) {
      newSession.projectPath = msg.projectPath;
    }
    if (msg.viewerName) {
      newSession.viewerName = msg.viewerName;
    }
    if (msg.projectPath || msg.viewerName) {
      ctx.sm.saveSessionFile(newSession);
    }
    ctx.setClientSession(ws, newSession.cliSessionId);
  },

  async resume_session(ctx, ws, msg) {
    if (!msg.cliSessionId) return;
    var resumed = ctx.sm.resumeSession(msg.cliSessionId, ws, ctx.sendTo);
    ctx.setClientSession(ws, resumed.cliSessionId);
  },

  async switch_session(ctx, ws, msg) {
    if (msg.id && ctx.sm.sessions.has(msg.id)) {
      ctx.setClientSession(ws, msg.id);
      ctx.sm.switchSessionForClient(ws, msg.id, ctx.sendTo);
      ctx.sm.broadcastSessionList();
    }
  },

  async leave_session(ctx, ws, msg) {
    ctx.setClientSession(ws, null);
  },

  async tab_subscribe(ctx, ws, msg) {
    msg.type = "popup_open";
    return module.exports.popup_open(ctx, ws, msg);
  },

  async tab_unsubscribe(ctx, ws, msg) {
    msg.type = "popup_close";
    return module.exports.popup_close(ctx, ws, msg);
  },

  async popup_open(ctx, ws, msg) {
    var popupSession = msg.sessionId && ctx.sm.sessions.get(msg.sessionId);
    if (!popupSession) {
      ctx.sendTo(ws, { type: "popup_history_start", sessionId: msg.sessionId, total: 0, from: 0 });
      ctx.sendTo(ws, { type: "popup_history_done", sessionId: msg.sessionId });
      return;
    }
    var cstate = ctx.clients.get(ws);
    cstate.popups.add(msg.sessionId);
    if (msg.skip_history) {
      // Just register for routing — no history replay
    } else {
      await ctx.sm.ensureHistoryLoadedAsync(popupSession);
      if (!popupSession.history) popupSession.history = [];
      var total = popupSession.history.length;
      console.log("[project] Replaying history for", msg.sessionId.substring(0, 12), "total:", total);
      var fromIdx = 0;
      ctx.sendTo(ws, { type: "popup_history_start", sessionId: msg.sessionId, total: total, from: fromIdx });
      for (var phi = fromIdx; phi < total; phi++) {
        ctx.sendTo(ws, Object.assign({}, popupSession.history[phi], { _popupSessionId: msg.sessionId }));
      }
      ctx.sendTo(ws, { type: "popup_history_done", sessionId: msg.sessionId });
    }
    if (popupSession.isProcessing) {
      ctx.sendTo(ws, { type: "status", status: "processing", _popupSessionId: msg.sessionId });
    }
    var pendingIds = Object.keys(popupSession.pendingPermissions);
    for (var ppi = 0; ppi < pendingIds.length; ppi++) {
      var p = popupSession.pendingPermissions[pendingIds[ppi]];
      ctx.sendTo(ws, {
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        _popupSessionId: msg.sessionId,
      });
    }
  },

  async popup_close(ctx, ws, msg) {
    var cstate = ctx.clients.get(ws);
    if (cstate) cstate.popups.delete(msg.sessionId);
  },

  async popup_message(ctx, ws, msg) {
    var targetSession = ctx.sm.sessions.get(msg.sessionId);
    if (!targetSession) return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.documents || msg.documents.length === 0)) return;
    var cstate = ctx.clients.get(ws);
    var origSessionId = cstate.sessionId;
    cstate.popups.delete(msg.sessionId);
    ctx.setClientSession(ws, msg.sessionId);
    try {
      var rerouted = { type: "message", text: msg.text };
      if (msg.images) rerouted.images = msg.images;
      if (msg.pastes) rerouted.pastes = msg.pastes;
      if (msg.documents) rerouted.documents = msg.documents;
      await ctx.handleMessage(ws, rerouted);
    } finally {
      ctx.setClientSession(ws, origSessionId);
      cstate.popups.add(msg.sessionId);
    }
  },

  async popup_stop(ctx, ws, msg) {
    var targetSession = ctx.sm.sessions.get(msg.sessionId);
    if (!targetSession || !targetSession.isProcessing) return;
    if (targetSession.queryInstance && targetSession.queryInstance.interrupt) {
      targetSession.queryInstance.interrupt().catch(function () {});
    }
    if (targetSession.abortController) {
      targetSession.abortController.abort();
    }
  },

  async popup_permission_response(ctx, ws, msg) {
    var targetSession = ctx.sm.sessions.get(msg.sessionId);
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
    ctx.sm.sendAndRecord(targetSession, { type: "permission_resolved", requestId: requestId, decision: decision });
  },

  async delete_session(ctx, ws, msg) {
    if (msg.id && ctx.sm.sessions.has(msg.id)) {
      ctx.sm.deleteSession(msg.id, ctx.clients, ctx.sendTo);
    }
  },

  async rename_session(ctx, ws, msg) {
    if (msg.id && ctx.sm.sessions.has(msg.id) && msg.title) {
      var s = ctx.sm.sessions.get(msg.id);
      s.title = String(msg.title).substring(0, 100);
      ctx.sm.saveSessionFile(s);
      ctx.sm.broadcastSessionList();
    }
  },

  async search_sessions(ctx, ws, msg) {
    var results = ctx.sm.searchSessions(msg.query || "");
    ctx.sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
  },

  async fork_session(ctx, ws, msg) {
    var sourceSessionId = msg.sessionId;
    if (!sourceSessionId || !ctx.sm.sessions.has(sourceSessionId)) return;
    var sourceSession = ctx.sm.sessions.get(sourceSessionId);
    var requestId = msg._requestId || crypto.randomUUID();
    var forkedSession = ctx.sm.createSession(ws, ctx.sendTo, sourceSession.accountId || null, sourceSession.projectPath || null, requestId);
    forkedSession._forkFrom = sourceSessionId;
    forkedSession.title = (sourceSession.title || "Session") + " (fork)";
    ctx.sm.saveSessionFile(forkedSession);
    ctx.sm.broadcastSessionList();
    console.log("[project] Forked session", sourceSessionId, "→", forkedSession.cliSessionId);
  },

  async archive_session(ctx, ws, msg) {
    var archiveId = msg.sessionId;
    if (archiveId && ctx.sm.sessions.has(archiveId)) {
      var archiveSession = ctx.sm.sessions.get(archiveId);
      archiveSession.archived = Date.now();
      ctx.sm.saveSessionFile(archiveSession);
      ctx.sm.broadcastSessionList();
      console.log("[project] Archived session:", archiveId);
    }
  },

  async unarchive_session(ctx, ws, msg) {
    var unarchiveId = msg.sessionId;
    if (unarchiveId && ctx.sm.sessions.has(unarchiveId)) {
      var unarchiveSession = ctx.sm.sessions.get(unarchiveId);
      unarchiveSession.archived = null;
      ctx.sm.saveSessionFile(unarchiveSession);
      ctx.sm.broadcastSessionList();
      console.log("[project] Unarchived session:", unarchiveId);
    }
  },

  async set_session_status(ctx, ws, msg) {
    var statusId = msg.sessionId;
    var newStatus = msg.status;
    if (statusId && ctx.sm.sessions.has(statusId) && ["open", "done", "waiting"].indexOf(newStatus) !== -1) {
      var statusSession = ctx.sm.sessions.get(statusId);
      statusSession.status = newStatus;
      ctx.sm.saveSessionFile(statusSession);
      ctx.sm.broadcastSessionList();
    }
  },

  async bulk_archive(ctx, ws, msg) {
    var maxAge = msg.olderThan || (7 * 24 * 60 * 60 * 1000);
    var cutoff = Date.now() - maxAge;
    var count = 0;
    ctx.sm.sessions.forEach(function(s) {
      if (!s.archived && !s.isProcessing && (s.lastActivity || s.createdAt || 0) < cutoff) {
        s.archived = Date.now();
        ctx.sm.saveSessionFile(s);
        count++;
      }
    });
    ctx.sm.broadcastSessionList();
    ctx.sendTo(ws, { type: "bulk_archive_result", count: count });
    console.log("[project] Bulk archived", count, "sessions older than", Math.round(maxAge / 86400000) + "d");
  },
};
