var fs = require("fs");
var path = require("path");
var { execFileAsync, expandSlashCommand } = require("./utils");

module.exports = {
  async stop(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (session && session.isProcessing) {
      if (session.queryInstance && session.queryInstance.interrupt) {
        session.queryInstance.interrupt().catch(function () {});
      }
      if (session.abortController) {
        session.abortController.abort();
      }
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
          ctx.sm.sendAndRecord(sessionRef, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
          ctx.sm.sendAndRecord(sessionRef, { type: "done", code: 0 });
          ctx.sm.broadcastSessionList();
        }
      }, 2000);
    }
  },

  async force_stop(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (session) {
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
      ctx.sm.sendAndRecord(session, { type: "info", text: "Session force-stopped" });
      ctx.sm.sendAndRecord(session, { type: "done", code: 1 });
      ctx.sm.broadcastSessionList();
    }
  },

  async set_model(ctx, ws, msg) {
    if (!msg.model) return;
    var session = ctx.getClientSession(ws);
    if (session) {
      ctx.sdk.setModel(session, msg.model);
    }
  },

  async session_settings(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (msg.effort != null) {
      ctx.sdk.setEffort(msg.effort || "");
      if (session) {
        session.querySettings = session.querySettings || {};
        session.querySettings.effort = msg.effort || "";
      }
    }
  },

  async set_permission_mode(ctx, ws, msg) {
    if (!msg.mode) return;
    var session = ctx.getClientSession(ws);
    if (session) {
      ctx.sdk.setPermissionMode(session, msg.mode);
    }
  },

  async stop_task(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (session) {
      ctx.sdk.stopTask(session, msg.taskId || null, msg.toolUseId || null);
    }
  },

  async rewind_preview(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (!session || !session.cliSessionId || !msg.uuid) return;
    var result;
    try {
      result = await ctx.sdk.getOrCreateRewindQuery(session, ctx.resolveAccount(session));
      var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
      var diffs = {};
      var changedFiles = preview.filesChanged || [];
      for (var f = 0; f < changedFiles.length; f++) {
        try {
          var diffResult = await execFileAsync(
            "git", ["diff", "HEAD", "--", changedFiles[f]],
            { cwd: ctx.cwd, encoding: "utf8", timeout: 5000 }
          );
          diffs[changedFiles[f]] = diffResult.stdout || "";
        } catch (e) { diffs[changedFiles[f]] = ""; }
      }
      ctx.sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
    } catch (err) {
      ctx.sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
    } finally {
      if (result && result.isTemp) result.cleanup();
    }
  },

  async rewind_execute(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (!session || !session.cliSessionId || !msg.uuid) return;
    await ctx.sm.ensureHistoryLoadedAsync(session);
    var mode = msg.mode || "both";
    var result;
    try {
      if (mode !== "chat") {
        result = await ctx.sdk.getOrCreateRewindQuery(session, ctx.resolveAccount(session));
        await result.query.rewindFiles(msg.uuid, { dryRun: false });
      }
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
            ctx.sendToSessionViewers(session.cliSessionId, { type: "rewind_error", text: "Rewind failed: no user message found before target" });
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
      ctx.sm.saveSessionFile(session);
      var rewindViewers = ctx.sessionViewers[session.cliSessionId];
      if (rewindViewers) {
        for (var clientWs of rewindViewers) {
          ctx.sm.switchSessionForClient(clientWs, session.cliSessionId, ctx.sendTo);
        }
      }
      ctx.sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
      ctx.sm.broadcastSessionList();
    } catch (err) {
      ctx.sendToSessionViewers(session.cliSessionId, { type: "rewind_error", text: "Rewind failed: " + err.message });
    } finally {
      if (result && result.isTemp) result.cleanup();
    }
  },

  async ask_user_response(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
    if (!session) return;
    var toolId = msg.toolId || msg.requestId;
    var answers = msg.answers || {};
    var pending = session.pendingAskUser[toolId];
    if (!pending) return;
    delete session.pendingAskUser[toolId];
    ctx.sm.sendAndRecord(session, { type: "ask_user_answered", requestId: toolId, toolId: toolId });
    pending.resolve({
      behavior: "allow",
      updatedInput: Object.assign({}, pending.input, { answers: answers }),
    });
  },

  async input_sync(ctx, ws, msg) {
    var clientState = ctx.clients.get(ws);
    if (clientState) {
      ctx.sendToSessionViewersExcept(clientState.sessionId, ws, msg);
    }
  },

  async permission_response(ctx, ws, msg) {
    var session = ctx.getClientSession(ws);
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
    ctx.sm.sendAndRecord(session, {
      type: "permission_resolved",
      requestId: requestId,
      decision: decision,
    });
  },

  async ambient_permission_response(ctx, ws, msg) {
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
    ctx.sm.sendAndRecord(targetSession, {
      type: "permission_resolved",
      requestId: requestId,
      decision: decision,
    });
  },

  async message(ctx, ws, msg) {
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0) && (!msg.documents || msg.documents.length === 0)) return;

    var session = ctx.getClientSession(ws);
    if (!session) {
      console.log("[project] No session found for client, sessionId:", ctx.clients.get(ws) ? ctx.clients.get(ws).sessionId : "no client state");
      return;
    }
    console.log("[project] Message for session:", session.cliSessionId, "_tempId:", !!session._tempId, "isProcessing:", session.isProcessing, "hasQuery:", !!session.queryInstance, "images:", (msg.images || []).length, "docs:", (msg.documents || []).length, "pastes:", (msg.pastes || []).length);

    var userMsg = { type: "user_message", text: msg.text || "" };
    if (msg.images && msg.images.length > 0) {
      userMsg.imageCount = msg.images.length;
      var imgDir = path.join(ctx.sm.sessionsDir || path.join(ctx.cwd, ".claude-relay", "sessions"), "images");
      await fs.promises.mkdir(imgDir, { recursive: true }).catch(function() {});
      userMsg.imagePaths = [];
      for (var ii = 0; ii < msg.images.length; ii++) {
        var img = msg.images[ii];
        var rawExt = (img.mediaType || "image/png").split("/")[1] || "png";
        var ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) || "png";
        var imgName = session.cliSessionId.substring(0, 12) + "-" + Date.now() + "-" + ii + "." + ext;
        var imgPath = path.join(imgDir, imgName);
        try {
          await fs.promises.writeFile(imgPath, Buffer.from(img.data, "base64"));
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
    await ctx.sm.ensureHistoryLoadedAsync(session);
    session.history.push(userMsg);
    ctx.sm.appendToSessionFile(session, userMsg);
    ctx.sendToSessionViewersExcept(session.cliSessionId, ws, userMsg);

    if (!session.title) {
      session.title = (msg.text || (msg.documents && msg.documents.length > 0 ? msg.documents[0].name || "Document" : "Image")).substring(0, 50);
      ctx.sm.saveSessionFile(session);
      ctx.sm.broadcastSessionList();
    }

    var fullText = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    var mediaAttachments = msg.images || [];
    if (msg.documents && msg.documents.length > 0) {
      var MAX_DOCUMENTS = 10;
      var MAX_DOC_BASE64_LENGTH = 67 * 1024 * 1024;
      if (msg.documents.length > MAX_DOCUMENTS) {
        console.warn("[project] Too many documents (" + msg.documents.length + "), limiting to " + MAX_DOCUMENTS);
        msg.documents = msg.documents.slice(0, MAX_DOCUMENTS);
      }
      var uploadsDir = path.join(ctx.cwd, ".claude-relay", "uploads");
      await fs.promises.mkdir(uploadsDir, { recursive: true }).catch(function() {});
      for (var di = 0; di < msg.documents.length; di++) {
        var doc = msg.documents[di];
        if (doc.data && doc.data.length > MAX_DOC_BASE64_LENGTH) {
          console.warn("[project] Document '" + (doc.name || "unknown") + "' too large (" + Math.round(doc.data.length / 1024 / 1024) + "MB base64), skipping (limit: 50MB decoded)");
          continue;
        }
        var safeName = (doc.name || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
        var docPath = path.join(uploadsDir, Date.now() + "-" + safeName);
        try {
          await fs.promises.writeFile(docPath, Buffer.from(doc.data, "base64"));
          if (fullText) fullText += "\n\n";
          fullText += "[Uploaded file: " + docPath + " — please read this file to see its contents]";
          console.log("[project] Saved uploaded document:", docPath);
        } catch (e) {
          console.error("[project] Failed to save document:", e.message);
        }
      }
    }

    fullText = expandSlashCommand(fullText, ctx.cwd);

    if (session.status && session.status !== 'open') {
      session.status = 'open';
      ctx.sm.saveSessionFile(session);
    }

    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      ctx.sendToSessionViewers(session.cliSessionId, { type: "status", status: "processing" });
      if (!ctx._warmedUp) { ctx._warmedUp = true; ctx.sdk.warmup(); }
      if (!session.queryInstance) {
        ctx.sdk.startQuery(session, fullText, mediaAttachments, ctx.resolveAccount(session));
      } else {
        ctx.sdk.pushMessage(session, fullText, mediaAttachments);
      }
    } else {
      ctx.sdk.pushMessage(session, fullText, mediaAttachments);
    }
    ctx.sm.broadcastSessionList();
  },
};
