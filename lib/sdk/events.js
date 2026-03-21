const fs = require("fs");
const path = require("path");

function createEventProcessor(ctx) {
  var sm = ctx.sessionManager;
  var send = ctx.send;
  var sendToViewers = ctx.sendToViewers;
  var sendAndRecord = ctx.sendAndRecord;
  var pushModule = ctx.pushModule;
  var slug = ctx.slug;
  var cwd = ctx.cwd;
  var skills = ctx.skills;
  var onFileChange = ctx.onFileChange;
  var onSessionRekey = ctx.onSessionRekey;

  function broadcastConfigState() {
    send({
      type: "config_state",
      model: sm.currentModel || "",
      effort: sm.currentEffort || "",
      fastMode: sm.fastMode || false,
      permissionMode: sm.currentPermissionMode || "default",
    });
  }

  function processSDKMessage(session, parsed) {
    // Re-key session ID from authoritative messages
    var isAuthoritativeMessage = (
      parsed.type === "assistant" ||
      parsed.type === "user" ||
      parsed.type === "result" ||
      (parsed.type === "system" && parsed.subtype === "init")
    );
    if (parsed.session_id && isAuthoritativeMessage && session._tempId) {
      var oldId = session.cliSessionId;
      console.log("[sdk] RE-KEY (tempId):", oldId, "->", parsed.session_id, "msgType:", parsed.type, parsed.subtype || "");
      sendToViewers(oldId, { type: "session_id", cliSessionId: parsed.session_id, oldId: oldId });
      sm.rekeySession(oldId, parsed.session_id);
      if (onSessionRekey) onSessionRekey(oldId, parsed.session_id);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    } else if (parsed.session_id && isAuthoritativeMessage && parsed.session_id !== session.cliSessionId) {
      var oldId2 = session.cliSessionId;
      console.log("[sdk] RE-KEY (changed):", oldId2, "->", parsed.session_id, "msgType:", parsed.type, parsed.subtype || "");
      sendToViewers(oldId2, { type: "session_id", cliSessionId: parsed.session_id, oldId: oldId2 });
      sm.rekeySession(oldId2, parsed.session_id);
      if (onSessionRekey) onSessionRekey(oldId2, parsed.session_id);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    // Capture message UUIDs for rewind
    if (parsed.uuid) {
      if (parsed.type === "user" && !parsed.parent_tool_use_id) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.type === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // System init: cache slash_commands, model, skills
    if (parsed.type === "system" && parsed.subtype === "init") {
      if (parsed.skills) {
        sm.skillNames = new Set(parsed.skills);
      }
      if (parsed.slash_commands) {
        console.log("[sdk] init slash_commands:", parsed.slash_commands.join(", "), "skills:", parsed.skills ? parsed.skills.join(", ") : "none");
        var filteredNames = parsed.slash_commands.filter(function(name) {
          return !sm.skillNames || !sm.skillNames.has(name);
        });
        sm.slashCommands = filteredNames.map(function(name) {
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
      if (parsed.model) {
        sm.currentModel = parsed.model;
        send({ type: "model_info", model: parsed.model, models: sm.availableModels || [] });
      }
      if (parsed.fast_mode_state) {
        sm.fastMode = parsed.fast_mode_state === "enabled" || parsed.fast_mode_state === true;
        sendAndRecord(session, { type: "fast_mode_state", enabled: sm.fastMode });
      }
      broadcastConfigState();
    }

    // Stream events (content blocks)
    if (parsed.type === "stream_event" && parsed.event) {
      processStreamEvent(session, parsed.event);

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      if (parsed.parent_tool_use_id) {
        processSubagentMessage(session, parsed);
        return;
      }
      processAssistantOrUserMessage(session, parsed);

    } else if (parsed.type === "result") {
      processResult(session, parsed);

    } else if (parsed.type === "system" && parsed.subtype === "task_started") {
      if (parsed.task_id) {
        if (!session.taskIdMap) session.taskIdMap = {};
        if (parsed.tool_use_id) session.taskIdMap[parsed.tool_use_id] = parsed.task_id;
        sendAndRecord(session, {
          type: "task_started",
          taskId: parsed.task_id,
          toolUseId: parsed.tool_use_id || null,
          description: parsed.description || "",
        });
      }

    } else if (parsed.type === "system" && parsed.subtype === "status") {
      if (parsed.status === "compacting") {
        sendAndRecord(session, { type: "compacting", active: true });
      } else if (session.compacting) {
        sendAndRecord(session, { type: "compacting", active: false });
      }
      session.compacting = parsed.status === "compacting";

    } else if (parsed.type === "tool_progress") {
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_activity",
          parentToolId: parentId,
          text: (parsed.tool_name || "") + (parsed.elapsed_time_seconds > 5 ? " (" + Math.round(parsed.elapsed_time_seconds) + "s)" : ""),
        });
      } else {
        sendAndRecord(session, {
          type: "tool_progress",
          toolId: parsed.tool_use_id,
          toolName: parsed.tool_name || "",
          elapsed: parsed.elapsed_time_seconds || 0,
        });
      }

    } else if (parsed.type === "tool_use_summary") {
      if (parsed.summary) {
        sendAndRecord(session, {
          type: "tool_summary",
          summary: parsed.summary,
          toolIds: parsed.preceding_tool_use_ids || [],
        });
      }

    } else if (parsed.type === "task_notification") {
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_done",
          parentToolId: parentId,
          summary: parsed.summary || "",
          usage: parsed.usage || null,
        });
      }
      sendAndRecord(session, {
        type: "task_notification",
        taskId: parsed.task_id || "",
        status: parsed.status || "completed",
        summary: parsed.summary || "",
        parentToolId: parentId || null,
        usage: parsed.usage || null,
      });

    } else if (parsed.type === "system" && (parsed.subtype === "hook_started" || parsed.subtype === "hook_progress" || parsed.subtype === "hook_response")) {
      sendAndRecord(session, {
        type: "hook_event",
        subtype: parsed.subtype,
        hookName: parsed.hook_name || "",
        hookEvent: parsed.hook_event || "",
        output: parsed.output || parsed.stdout || "",
        outcome: parsed.outcome || null,
      });

    } else if (parsed.type === "system" && parsed.subtype === "compact_boundary") {
      var meta = parsed.compact_metadata || {};
      sendAndRecord(session, {
        type: "compact_boundary",
        trigger: meta.trigger || "auto",
        preTokens: meta.pre_tokens || 0,
      });

    } else if (parsed.type === "system" && parsed.subtype === "files_persisted") {
      sendAndRecord(session, {
        type: "files_persisted",
        files: (parsed.files || []).map(function(f) { return f.filename || f; }),
        failed: (parsed.failed || []).map(function(f) { return { name: f.filename || f, error: f.error || "" }; }),
      });

    } else if (parsed.type === "auth_status") {
      sendAndRecord(session, {
        type: "auth_status",
        isAuthenticating: parsed.isAuthenticating || false,
        error: parsed.error || null,
      });

    } else if (parsed.type === "prompt_suggestion") {
      console.log("[sdk] GOT prompt_suggestion:", JSON.stringify(parsed).substring(0, 200));
      var suggestions = parsed.suggestions || (parsed.suggestion ? [parsed.suggestion] : []);
      if (suggestions.length > 0) {
        sendAndRecord(session, {
          type: "prompt_suggestion",
          suggestions: suggestions,
        });
      }

    } else if (parsed.type && parsed.type !== "system" && parsed.type !== "user") {
      console.warn("[sdk] Unhandled event type:", parsed.type, JSON.stringify(parsed).substring(0, 200));
    }
  }

  function processStreamEvent(session, evt) {
    if (evt.type === "content_block_start") {
      var block = evt.content_block;
      var idx = evt.index;
      if (block.type === "tool_use") {
        session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
        sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
      } else if (block.type === "thinking") {
        session.blocks[idx] = { type: "thinking", thinkingText: "", startTime: Date.now() };
        sendAndRecord(session, { type: "thinking_start" });
      } else if (block.type === "text") {
        session.blocks[idx] = { type: "text" };
      }
    }

    if (evt.type === "content_block_delta" && evt.delta) {
      var idx = evt.index;
      if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
        session.streamedText = true;
        if (session.responsePreview.length < 200) {
          session.responsePreview += evt.delta.text;
        }
        sendAndRecord(session, { type: "delta", text: evt.delta.text });
      } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
        session.blocks[idx].inputJson += evt.delta.partial_json;
      } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
        session.blocks[idx].thinkingText += evt.delta.thinking;
        sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
      }
    }

    if (evt.type === "content_block_stop") {
      var idx = evt.index;
      var block = session.blocks[idx];
      if (block && block.type === "tool_use") {
        var input = {};
        try { input = JSON.parse(block.inputJson); } catch {}
        sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });
        if (onFileChange && (block.name === "Write" || block.name === "Edit") && input.file_path) {
          onFileChange(input.file_path);
        }
        if (block.name === "Task") {
          if (!session.activeTaskToolIds) session.activeTaskToolIds = {};
          session.activeTaskToolIds[block.id] = true;
        }
        if (block.name === "AskUserQuestion" && input.questions) {
          var q = input.questions[0];
          sendAndRecord(session, {
            type: "ask_user",
            requestId: block.id,
            question: q ? q.question : "Waiting for your response",
            questions: input.questions,
          });
          if (pushModule) {
            pushModule.sendPush({
              type: "ask_user",
              slug: slug,
              title: "Claude has a question",
              body: q ? q.question : "Waiting for your response",
              tag: "claude-ask",
            });
          }
        }
      } else if (block && block.type === "thinking") {
        var thinkDuration = block.startTime ? Date.now() - block.startTime : 0;
        sendAndRecord(session, { type: "thinking_stop", duration: thinkDuration });
      }
      delete session.blocks[idx];
    }
  }

  function processAssistantOrUserMessage(session, parsed) {
    var content = parsed.message.content;

    // Fallback: if assistant text wasn't streamed via deltas
    if (parsed.type === "assistant" && !session.streamedText && Array.isArray(content)) {
      var assistantText = content
        .filter(function(c) { return c.type === "text"; })
        .map(function(c) { return c.text; })
        .join("");
      if (assistantText) {
        sendAndRecord(session, { type: "delta", text: assistantText });
      }
    }

    // Check for local slash command output
    if (parsed.type === "user") {
      var fullText = "";
      if (typeof content === "string") {
        fullText = content;
      } else if (Array.isArray(content)) {
        fullText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("\n");
      }
      if (fullText.indexOf("local-command-stdout") !== -1) {
        var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
        if (m) {
          sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
        }
      }
    }

    // Process tool results
    if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
          if (session.activeTaskToolIds && session.activeTaskToolIds[block.tool_use_id]) {
            sendAndRecord(session, {
              type: "subagent_done",
              parentToolId: block.tool_use_id,
            });
            delete session.activeTaskToolIds[block.tool_use_id];
          }
          var resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter(function(c) { return c.type === "text"; })
              .map(function(c) { return c.text; })
              .join("\n");
          }
          session.sentToolResults[block.tool_use_id] = true;
          sendAndRecord(session, {
            type: "tool_result",
            id: block.tool_use_id,
            content: resultText,
            is_error: block.is_error || false,
          });
        }
      }
    }
  }

  function processResult(session, parsed) {
    session.blocks = {};
    session.sentToolResults = {};
    session.pendingPermissions = {};
    session.pendingAskUser = {};
    session.activeTaskToolIds = {};
    session.isProcessing = false;
    session._retried = false;

    var errorCategory = null;
    if (parsed.subtype === "error_max_turns") errorCategory = "max_turns";
    else if (parsed.subtype === "error_max_budget_usd") errorCategory = "max_budget";
    else if (parsed.subtype === "error_during_execution") {
      var errMsg = (parsed.errors && parsed.errors[0]) || "";
      if (errMsg.indexOf("No conversation found") !== -1 || errMsg.indexOf("No message found") !== -1) {
        handleExpiredSession(session, parsed, errMsg);
        return;
      }
      else if (errMsg.indexOf("rate_limit") !== -1 || errMsg.indexOf("rate limit") !== -1 || errMsg.indexOf("429") !== -1) {
        errorCategory = "rate_limit";
        sendAndRecord(session, { type: "rate_limit", text: errMsg });
      }
      else if (errMsg.indexOf("authentication") !== -1 || errMsg.indexOf("OAuth token has expired") !== -1) {
        errorCategory = "auth_failed";
        sendAndRecord(session, { type: "auth_expired", text: "OAuth token expired — re-authenticate to continue.", url: "https://claude.ai/oauth/authorize" });
      }
      else if (errMsg.indexOf("billing") !== -1) errorCategory = "billing_error";
      else if (errMsg.indexOf("prompt") !== -1 && errMsg.indexOf("long") !== -1) errorCategory = "prompt_too_long";
      else if (errMsg.indexOf("context_length") !== -1 || errMsg.indexOf("maximum context length") !== -1) errorCategory = "prompt_too_long";
      else errorCategory = "execution_error";
    }

    if (errorCategory) {
      var errorText = (parsed.errors && parsed.errors.length > 0) ? parsed.errors[0] : errorCategory;
      if (errorCategory === "prompt_too_long") {
        errorText = "Conversation too long to continue. Start a new session.";
        sendAndRecord(session, { type: "context_overflow", text: errorText });
      }
      sendAndRecord(session, { type: "error", text: errorText, category: errorCategory });
    }

    if (parsed.fast_mode_state) {
      sm.fastMode = parsed.fast_mode_state === "enabled" || parsed.fast_mode_state === true;
      sendAndRecord(session, { type: "fast_mode_state", enabled: sm.fastMode });
    }

    console.log("[sdk] Sending result+done for session:", session.cliSessionId, "errorCategory:", errorCategory);
    sendAndRecord(session, {
      type: "result",
      cost: parsed.total_cost_usd,
      duration: parsed.duration_ms,
      usage: parsed.usage || null,
      modelUsage: parsed.modelUsage || null,
      sessionId: parsed.session_id,
      errorCategory: errorCategory,
    });
    sendAndRecord(session, { type: "done", code: errorCategory ? 1 : 0 });

    // Context usage tracking
    if (parsed.modelUsage) {
      var models = Object.keys(parsed.modelUsage);
      for (var mi = 0; mi < models.length; mi++) {
        var mu = parsed.modelUsage[models[mi]];
        if (mu.contextWindow) {
          var used = (mu.inputTokens || 0) + (mu.outputTokens || 0) + (mu.cacheReadInputTokens || 0) + (mu.cacheCreationInputTokens || 0);
          var pct = Math.round((used / mu.contextWindow) * 100);
          sendAndRecord(session, { type: "context_usage", model: models[mi], used: used, max: mu.contextWindow, percent: pct });
          if (pct >= 80) {
            sendAndRecord(session, { type: "info", text: "\u26a0\ufe0f Context " + pct + "% full (" + Math.round(used / 1000) + "K / " + Math.round(mu.contextWindow / 1000) + "K tokens). Consider starting a new session to avoid prompt-too-long errors." });
          }
          break;
        }
      }
    }

    if (pushModule) {
      var preview = (session.responsePreview || "").replace(/\s+/g, " ").trim();
      if (preview.length > 140) preview = preview.substring(0, 140) + "...";
      pushModule.sendPush({
        type: "done",
        slug: slug,
        title: session.title || "Claude",
        body: preview || "Response ready",
        tag: "claude-done",
      });
    }
    session.responsePreview = "";
    session.streamedText = false;
    sm.broadcastSessionList();
  }

  function handleExpiredSession(session, parsed, errMsg) {
    var expiredOldId = session.cliSessionId;
    var hasHistory = session.history && session.history.length > 0;
    console.log("[sdk] Session expired (" + errMsg.substring(0, 60) + "), hasHistory:", hasHistory, "clearing cliSessionId:", expiredOldId);
    if (session.queryInstance && session.queryInstance.close) {
      try { session.queryInstance.close(); } catch (e) {}
    }
    session.queryInstance = null;
    session.messageQueue = null;
    session.abortController = null;
    sm.clearSessionId(session);
    sendToViewers(expiredOldId, { type: "session_id", cliSessionId: session.cliSessionId, oldId: expiredOldId });
    if (onSessionRekey) onSessionRekey(expiredOldId, session.cliSessionId);
    sm.saveSessionFile(session);

    if (hasHistory && !session._expiredRetried) {
      session._expiredRetried = true;
      var lastText = "";
      for (var ri = session.history.length - 1; ri >= 0; ri--) {
        if (session.history[ri].type === "user_message" && session.history[ri].text) {
          lastText = session.history[ri].text;
          break;
        }
      }
      if (lastText) {
        sendAndRecord(session, { type: "info", text: "Session expired \u2014 reconnecting with conversation context..." });
        console.log("[sdk] Auto-retrying expired session with context replay, lastText:", lastText.substring(0, 60));
        ctx.startQuery(session, lastText, null, session._account);
        return;
      }
    }
    sendAndRecord(session, { type: "info", text: "Session expired \u2014 start a new one" });
    sendAndRecord(session, { type: "error", text: "Session expired \u2014 send another message to start fresh.", category: "session_expired" });
    sendAndRecord(session, { type: "done", code: 1 });
    sm.broadcastSessionList();
  }

  // Sub-agent message processing
  function toolActivityTextForSubagent(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + input.file_path.split("/").pop();
    if (name === "Edit" && input && input.file_path) return "Editing " + input.file_path.split("/").pop();
    if (name === "Write" && input && input.file_path) return "Writing " + input.file_path.split("/").pop();
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    return "Running " + name + "...";
  }

  function processSubagentMessage(session, parsed) {
    var parentId = parsed.parent_tool_use_id;
    var content = parsed.message.content;
    if (!Array.isArray(content)) return;

    if (parsed.type === "assistant") {
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_use") {
          sendAndRecord(session, {
            type: "subagent_tool",
            parentToolId: parentId,
            toolName: block.name,
            toolId: block.id,
            text: toolActivityTextForSubagent(block.name, block.input),
          });
        } else if (block.type === "thinking") {
          sendAndRecord(session, { type: "subagent_activity", parentToolId: parentId, text: "Thinking..." });
        } else if (block.type === "text" && block.text) {
          sendAndRecord(session, { type: "subagent_activity", parentToolId: parentId, text: "Writing response..." });
        }
      }
    }
  }

  return {
    processSDKMessage: processSDKMessage,
    broadcastConfigState: broadcastConfigState,
  };
}

module.exports = { createEventProcessor };
