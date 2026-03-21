var { buildSystemPrompt } = require("./prompts");

function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end: function() {
      ended = true;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
      queue.length = 0;
    },
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) {
            waiting = resolve;
          });
        },
      };
    },
  };
}

function createQueryManager(ctx) {
  var cwd = ctx.cwd;
  var sm = ctx.sessionManager;
  var send = ctx.send;
  var sendToViewers = ctx.sendToViewers;
  var sendAndRecord = ctx.sendAndRecord;
  var pushModule = ctx.pushModule;
  var slug = ctx.slug;
  var getSDK = ctx.getSDK;
  var skills = ctx.skills;
  var dangerouslySkipPermissions = ctx.dangerouslySkipPermissions;
  var onSessionRekey = ctx.onSessionRekey;
  var handleCanUseTool = ctx.handleCanUseTool;
  var processSDKMessage = ctx.processSDKMessage;

  function buildContentBlocks(text, images) {
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }
    return content;
  }

  async function processQueryStream(session) {
    try {
      console.log("[sdk] processQueryStream started for session:", session.cliSessionId);
      var msgCount = 0;
      for await (var msg of session.queryInstance) {
        msgCount++;
        if (msgCount <= 10 || msg.type === "result" || msg.type === "error" || msg.session_id) {
          console.log("[sdk] stream msg #" + msgCount + ":", msg.type, msg.subtype || "", "sid:", session.cliSessionId, "msg.session_id:", msg.session_id || "none");
        }
        processSDKMessage(session, msg);
      }
      console.log("[sdk] stream ended normally, total msgs:", msgCount, "session:", session.cliSessionId);
    } catch (err) {
      console.log("[sdk] stream threw error:", err.message, "session:", session.cliSessionId);
      if (session.isProcessing) {
        if (err.name === "AbortError" || (session.abortController && session.abortController.signal.aborted)) {
          session.isProcessing = false;
          sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
          sendAndRecord(session, { type: "done", code: 0 });
        } else if (err.message && err.message.indexOf("exited with code") !== -1 && !session._retried) {
          session._retried = true;
          var retryOldId = session.cliSessionId;
          console.log("[sdk] Process exited, retrying fresh (was: " + (retryOldId || "new") + ")");
          sm.clearSessionId(session);
          if (onSessionRekey) onSessionRekey(retryOldId, session.cliSessionId);
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          sendAndRecord(session, { type: "info", text: "Connection lost \u2014 reconnecting..." });
          var lastText = "";
          for (var hi = session.history.length - 1; hi >= 0; hi--) {
            if (session.history[hi].type === "user_message" && session.history[hi].text) {
              lastText = session.history[hi].text;
              break;
            }
          }
          startQuery(session, lastText || "continue", null, session._account);
          return;
        } else {
          session.isProcessing = false;
          sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
          sendAndRecord(session, { type: "done", code: 1 });
          if (pushModule) {
            pushModule.sendPush({
              type: "error",
              slug: slug,
              title: "Connection Lost",
              body: "Claude process disconnected: " + (err.message || "unknown error"),
              tag: "claude-error",
            });
          }
        }
        sm.broadcastSessionList();
      }
    } finally {
      if (session._retried && session.queryInstance) {
        session._retried = false;
        return;
      }
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      if (session.isProcessing) {
        session.isProcessing = false;
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
      }
    }
  }

  async function getOrCreateRewindQuery(session, account) {
    if (session.queryInstance) return { query: session.queryInstance, isTemp: false, cleanup: function() {} };

    var sdk;
    try { sdk = await getSDK(); } catch (e) {
      send({ type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      throw e;
    }
    var mq = createMessageQueue();
    var rewindOpts = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      enableFileCheckpointing: true,
      resume: session.cliSessionId,
    };
    if (account && account.configDir && account.name !== "default") {
      rewindOpts.env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: account.configDir });
    }
    var tempQuery = sdk.query({ prompt: mq, options: rewindOpts });
    (async function() { try { for await (var msg of tempQuery) {} } catch(e) {} })();
    return {
      query: tempQuery,
      isTemp: true,
      cleanup: function() { try { mq.end(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images, account) {
    console.log("[sdk] startQuery called, session:", session.cliSessionId, "_tempId:", !!session._tempId, "account:", account ? account.name : "none");
    var sdk;
    try { sdk = await getSDK(); } catch (e) {
      console.log("[sdk] getSDK failed:", e.message);
      session.isProcessing = false;
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    if (account) session._account = account;

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.streamedText = false;
    session.responsePreview = "";

    var content = buildContentBlocks(text, images);
    session.messageQueue.push({ type: "user", message: { role: "user", content: content } });
    session.abortController = new AbortController();

    var queryOptions = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      betas: ["context-1m-2025-08-07"],
      extraArgs: { "replay-user-messages": null },
      abortController: session.abortController,
      promptSuggestions: true,
      systemPrompt: buildSystemPrompt(session, skills),
      canUseTool: function(toolName, input, toolOpts) {
        return handleCanUseTool(session, toolName, input, toolOpts);
      },
    };

    if (account && account.configDir && account.name !== "default") {
      queryOptions.env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: account.configDir });
    }
    if (session.querySettings && session.querySettings.effort) {
      queryOptions.effort = session.querySettings.effort;
    }
    if (sm.currentModel) queryOptions.model = sm.currentModel;
    if (sm.currentEffort && !queryOptions.effort) queryOptions.effort = sm.currentEffort;
    if (dangerouslySkipPermissions) {
      queryOptions.permissionMode = "bypassPermissions";
      queryOptions.allowDangerouslySkipPermissions = true;
    }
    if (session.cliSessionId && !session._tempId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
      }
    }

    console.log("[sdk] Creating query, resume:", queryOptions.resume || "none", "env CLAUDE_CONFIG_DIR:", queryOptions.env ? queryOptions.env.CLAUDE_CONFIG_DIR : "default");
    try {
      session.queryInstance = sdk.query({ prompt: session.messageQueue, options: queryOptions });
      console.log("[sdk] Query created successfully");
    } catch (e) {
      console.log("[sdk] Query creation failed:", e.message);
      session.isProcessing = false;
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to start query: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    processQueryStream(session).catch(function(err) {
      console.log("[sdk] processQueryStream error:", err.message);
    });
  }

  function pushMessage(session, text, images) {
    if (!session.messageQueue) return;
    var content = buildContentBlocks(text, images);
    session.messageQueue.push({ type: "user", message: { role: "user", content: content } });
  }

  async function warmup() {
    try {
      var sdk = await getSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();
      var warmupOptions = { cwd: cwd, settingSources: ["user", "project", "local"], abortController: ac };
      if (dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }
      var stream = sdk.query({ prompt: mq, options: warmupOptions });
      var fs = require("fs");
      var path = require("path");
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          if (msg.skills) sm.skillNames = new Set(msg.skills);
          if (msg.slash_commands) {
            var wFilteredNames = msg.slash_commands.filter(function(name) {
              return !sm.skillNames || !sm.skillNames.has(name);
            });
            sm.slashCommands = wFilteredNames.map(function(name) {
              var desc = "";
              try {
                var cmdPath = path.join(cwd, ".claude", "commands", name + ".md");
                var content = fs.readFileSync(cmdPath, "utf8");
                desc = content.split("\n")[0].trim().substring(0, 80);
              } catch (e) {}
              return { name: name, desc: desc };
            });
            send({ type: "slash_commands", commands: sm.slashCommands });
          }
          if (msg.model) sm.currentModel = msg.model;
          try {
            var models = await stream.supportedModels();
            sm.availableModels = models || [];
          } catch (e) { console.warn("[sdk-bridge] Failed to fetch models:", e.message || e); }
          send({ type: "model_info", model: sm.currentModel || "", models: sm.availableModels || [] });
          ac.abort();
          break;
        }
      }
    } catch (e) {
      if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
        send({ type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      }
    }
  }

  async function setModel(session, model) {
    if (!session.queryInstance) {
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      ctx.broadcastConfigState();
      return;
    }
    try {
      await session.queryInstance.setModel(model);
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      ctx.broadcastConfigState();
    } catch (e) {
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to switch model: " + (e.message || e) });
    }
  }

  async function setPermissionMode(session, mode) {
    if (dangerouslySkipPermissions) return;
    if (!session.queryInstance) {
      sm.currentPermissionMode = mode;
      ctx.broadcastConfigState();
      return;
    }
    try {
      await session.queryInstance.setPermissionMode(mode);
      sm.currentPermissionMode = mode;
      ctx.broadcastConfigState();
    } catch (e) {
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to set permission mode: " + (e.message || e) });
    }
  }

  function setEffort(effort) {
    sm.currentEffort = effort || "";
    ctx.broadcastConfigState();
  }

  async function stopTask(session, taskId, toolUseId) {
    if (!session || !session.queryInstance) return;
    var resolvedId = taskId;
    if (!resolvedId && toolUseId && session.taskIdMap) {
      resolvedId = session.taskIdMap[toolUseId];
    }
    if (!resolvedId) {
      console.log("[sdk] stopTask: no taskId found for toolUseId:", toolUseId);
      if (session.abortController) session.abortController.abort();
      return;
    }
    try {
      await session.queryInstance.stopTask(resolvedId);
      console.log("[sdk] stopTask sent for taskId:", resolvedId);
    } catch (e) {
      console.error("[sdk] stopTask error:", e.message);
      if (session.abortController) session.abortController.abort();
    }
  }

  return {
    startQuery: startQuery,
    pushMessage: pushMessage,
    getOrCreateRewindQuery: getOrCreateRewindQuery,
    warmup: warmup,
    setModel: setModel,
    setPermissionMode: setPermissionMode,
    setEffort: setEffort,
    stopTask: stopTask,
  };
}

module.exports = { createQueryManager, createMessageQueue };
