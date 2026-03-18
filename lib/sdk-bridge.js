const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ─── Agent Skills: custom system prompt injections per projectPath ───
// When a session has a projectPath matching a key here, the skill text
// is appended to the system prompt. This makes sessions in specific areas
// behave as specialized agents.
var AGENT_SKILLS = {
  "strategy": [
    "",
    "═══ STRATEGY AGENT ═══",
    "",
    "You are the Strategy Agent for Clout Operations (Strawberry Solutions BV).",
    "You are Calvin's honest observer inside the TOTE loop — not a generic assistant.",
    "",
    "YOUR ROLE:",
    "- Be the honest observer that tells the truth about what's actually happening vs what was planned",
    "- Run TOTE-based strategic reviews (Trigger → Present State → Desired State → Test → Operations → Test → Exit)",
    "- Build present state from EVIDENCE: git log, actual files, shipped code — not plans or specs",
    "- Detect drift: compare actual work (commits) to planned allocation percentages",
    "- Catch procrastination: comfortable meta-work disguised as progress",
    "- Challenge over-building: architecture before shipping, specs without contact with reality",
    "- Track session hygiene: find untagged sessions, stale sessions, orphaned work",
    "- Document decisions with reasoning in gtd/strategy/04-resources/decisions/",
    "",
    "STRATEGIC CONTEXT:",
    "- Purpose: Build systems and train people to create freedom",
    "- Current Gate: First chatter operational at $500/day",
    "- 11 core principles in purpose.md — especially: close the loop, simplicity first, output is not outcome",
    "- Anti-patterns: architecture before shipping, spec-to-ship ratio skew, productive procrastination",
    "- Monthly strategic review cycle, TOTE framework at every level (strategy → area → project → daily)",
    "- The 8-piece TOTE: Trigger, Present State, Desired State, Test (first), Operations, Decision Point, Test (second), Exit",
    "",
    "KEY FILES:",
    "- gtd/strategy/strategy.md — master TOTE, standards, recurring tasks",
    "- gtd/strategy/purpose.md — purpose, 11 principles, drift signals",
    "- gtd/strategy/vision.md — 3-5 year vision",
    "- gtd/strategy/goals.md — current gate, milestone sequence",
    "- gtd/strategy/02-operations/strategic-review-tote.md — the 6-step review process",
    "- gtd/strategy/04-resources/test-criteria.md — candidate evaluation (6 sections: principles, switching point, procrastination, external, methodology, strengths/weaknesses)",
    "- gtd/strategy/04-resources/strategy-agent-spec.md — what this agent should do and how",
    "- gtd/strategy/04-resources/decisions/ — decision log",
    "- gtd/strategy/02-operations/sessions/ — past session summaries (each has session-summary.md + standing-ops-tote.md)",
    "- Area TOTEs: gtd/chatting/, gtd/marketing/, gtd/content/, gtd/finance/, gtd/hiring/, gtd/personal/, gtd/system/",
    "",
    "GUIDED REVIEW MODE:",
    "When Calvin starts a strategy session or asks for a review, follow this process:",
    "",
    "Step 1: BUILD PRESENT STATE (do autonomously, then present)",
    "- Read all area TOTEs, recent sessions, git log since last review",
    "- Build honest present state for each area",
    "- Identify what shipped vs what was specced",
    "- Present findings → WAIT for Calvin's input ('Does this match your sense? Anything I'm missing?')",
    "",
    "Step 2: GAP ANALYSIS (present, then wait)",
    "- Compare present to desired state from goals.md",
    "- Rank gaps by urgency",
    "- Present gap table → WAIT for Calvin to confirm or adjust priorities",
    "",
    "Step 3: GENERATE CANDIDATES (present options, don't pick)",
    "- Create 2-3 candidate operation sets with allocation %, specific actions, timeline",
    "- Present → WAIT for Calvin's input ('Which resonates? What's missing?')",
    "",
    "Step 4: TEST CANDIDATES (run tests, present results)",
    "- Run selected candidate(s) through test-criteria.md (all 6 sections)",
    "- Score each: PASS / CONCERN / FAIL",
    "- Present → WAIT for Calvin to review and override if needed",
    "",
    "Step 5: SELECT & DOCUMENT (collaborative)",
    "- Based on test results + Calvin's input, propose selection",
    "- Write session-summary.md and standing-ops-tote.md",
    "- Update cockpit-state.json",
    "- WAIT for Calvin's confirmation before writing",
    "",
    "BEHAVIOR:",
    "- Evidence over inference. Don't guess — read files, check git log, look at what exists.",
    "- 'Specced' is not 'shipped'. 'Planned' is not 'done'. Be strict about this distinction.",
    "- Be direct and honest. If the work is drifting into comfortable meta-work, say so.",
    "- When you detect procrastination patterns, name them specifically with evidence.",
    "- Start every session by reading strategy.md and the latest session summary for context.",
    "- After any review or decision: update the cockpit dashboard files so the widget reflects reality.",
    "",
    "You have full access to the codebase and all gtd/ files.",
    "═══════════════════════",
    "",
  ].join("\n"),
};

var BASE_SYSTEM_APPEND = [
  "IMPORTANT: You are running inside a remote web-based relay (claude-relay). There is no interactive terminal.",
  "NEVER run long-lived or blocking processes via the Bash tool. This includes:",
  "- Servers (Spring Boot, Express, Flask, Rails, etc.)",
  "- Build watch modes (gradle bootRun, npm run dev, tsc --watch, etc.)",
  "- REPLs or interactive shells",
  "- Commands with sleep, tail -f, or indefinite waits",
  "- Daemon processes that don't exit on their own",
  "If the user asks you to run a server or long-lived process, use the Bash tool with run_in_background=true, or tell the user to run it in a terminal instead.",
  "For builds, use one-shot commands (e.g. './gradlew build' not './gradlew bootRun').",
  "If a Bash command might take more than 30 seconds, set an appropriate timeout.",
].join("\n");

// Load agent skills from .claude-relay/skills/*.md if available, else return null (use built-in)
function loadAgentSkills(cwd) {
  var skillsDir = path.join(cwd, ".claude-relay", "skills");
  var skills = {};
  try {
    var files = fs.readdirSync(skillsDir);
    for (var i = 0; i < files.length; i++) {
      if (files[i].endsWith(".md")) {
        var name = files[i].replace(".md", "");
        skills[name] = fs.readFileSync(path.join(skillsDir, files[i]), "utf8");
      }
    }
  } catch (e) {
    // Directory doesn't exist or can't be read — use built-in defaults
    return null;
  }
  return Object.keys(skills).length > 0 ? skills : null;
}

function buildSystemPrompt(session, skills) {
  var append = BASE_SYSTEM_APPEND;
  var activeSkills = skills || AGENT_SKILLS;

  // Inject agent skill if session has a matching projectPath
  var p = session.projectPath || "";
  // Match exact path or first segment (e.g. "strategy" matches "strategy" and "strategy/some-project")
  var skillKey = p.split("/")[0];
  if (skillKey && activeSkills[skillKey]) {
    append = append + "\n" + activeSkills[skillKey];
    console.log("[sdk] Injecting agent skill for projectPath:", p, "→", skillKey);
  }

  // Per-session custom prompt override
  if (session.customPrompt) {
    append = append + "\n\n" + session.customPrompt;
    console.log("[sdk] Appending customPrompt for session:", session.cliSessionId, "(" + session.customPrompt.length + " chars)");
  }

  return {
    type: "preset",
    preset: "claude_code",
    append: append,
  };
}

// Async message queue for streaming input to SDK
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
      queue.length = 0; // free references
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

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var skills = loadAgentSkills(cwd) || AGENT_SKILLS;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;   // session manager instance
  var send = opts.send;           // broadcast to all clients
  var sendToViewers = opts.sendToViewers || send;  // function(sessionId, obj) - send to session viewers
  var pushModule = opts.pushModule;
  var getSDK = opts.getSDK;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var onFileChange = opts.onFileChange || null;  // callback(filePath) when Write/Edit executes
  var onSessionRekey = opts.onSessionRekey || null;  // callback(oldId, newId) when session ID changes

  // Build content blocks array for user messages (images + text)
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

  // Broadcast unified config state to all clients
  function broadcastConfigState() {
    send({
      type: "config_state",
      model: sm.currentModel || "",
      effort: sm.currentEffort || "",
      fastMode: sm.fastMode || false,
      permissionMode: sm.currentPermissionMode || "default",
    });
  }

  function sendAndRecord(session, obj) {
    sm.sendAndRecord(session, obj);
  }

  function processSDKMessage(session, parsed) {
    // Extract session_id from any message that carries it
    // IMPORTANT: Only re-key on authoritative messages (init, assistant, user, result).
    // Hook messages (hook_started, hook_response, hook_progress) carry a hook subprocess
    // session_id that is NOT the conversation session ID. Using a positive match is defensive
    // against any new SDK event types that might carry subprocess session IDs.
    var isAuthoritativeMessage = (
      parsed.type === "assistant" ||
      parsed.type === "user" ||
      parsed.type === "result" ||
      (parsed.type === "system" && parsed.subtype === "init")
    );
    if (parsed.session_id && isAuthoritativeMessage && session._tempId) {
      // SDK provided the real session ID — re-key the sessions Map
      var oldId = session.cliSessionId;
      console.log("[sdk] RE-KEY (tempId):", oldId, "->", parsed.session_id, "msgType:", parsed.type, parsed.subtype || "");
      // Notify viewers BEFORE re-keying so they can be found by the old sessionId
      sendToViewers(oldId, { type: "session_id", cliSessionId: parsed.session_id, oldId: oldId });
      sm.rekeySession(oldId, parsed.session_id);
      if (onSessionRekey) onSessionRekey(oldId, parsed.session_id);
      // session.cliSessionId and _tempId are now updated by rekeySession
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    } else if (parsed.session_id && isAuthoritativeMessage && parsed.session_id !== session.cliSessionId) {
      // Session ID changed (e.g. after rewind) — re-key
      var oldId2 = session.cliSessionId;
      console.log("[sdk] RE-KEY (changed):", oldId2, "->", parsed.session_id, "msgType:", parsed.type, parsed.subtype || "");
      // Notify viewers BEFORE re-keying so they can be found by the old sessionId
      sendToViewers(oldId2, { type: "session_id", cliSessionId: parsed.session_id, oldId: oldId2 });
      sm.rekeySession(oldId2, parsed.session_id);
      if (onSessionRekey) onSessionRekey(oldId2, parsed.session_id);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    // Capture message UUIDs for rewind support
    if (parsed.uuid) {
      if (parsed.type === "user" && !parsed.parent_tool_use_id) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.type === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // Cache slash_commands and model from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init") {
      if (parsed.skills) {
        sm.skillNames = new Set(parsed.skills);
      }
      if (parsed.slash_commands) {
        console.log("[sdk] init slash_commands:", parsed.slash_commands.join(", "), "skills:", parsed.skills ? parsed.skills.join(", ") : "none");
        var filteredNames = parsed.slash_commands.filter(function(name) {
          return !sm.skillNames || !sm.skillNames.has(name);
        });
        // Enrich with descriptions from .claude/commands/*.md first lines
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

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

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

          // Notify file change for Write/Edit so file tree + search index update
          if (onFileChange && (block.name === "Write" || block.name === "Edit") && input.file_path) {
            onFileChange(input.file_path);
          }

          // Track active Task tools for sub-agent done detection
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

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      // Sub-agent messages: extract tool_use blocks for activity display
      if (parsed.parent_tool_use_id) {
        processSubagentMessage(session, parsed);
        return;
      }

      var content = parsed.message.content;

      // Fallback: if assistant text wasn't streamed via deltas, send it now
      if (parsed.type === "assistant" && !session.streamedText && Array.isArray(content)) {
        var assistantText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("");
        if (assistantText) {
          sendAndRecord(session, { type: "delta", text: assistantText });
        }
      }

      // Check for local slash command output in user messages
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

      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
            // Clear active Task tool when its result arrives
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

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.activeTaskToolIds = {};
      session.isProcessing = false;
      session._retried = false; // reset retry flag on success

      // Categorize errors from SDK result
      var errorCategory = null;
      if (parsed.subtype === "error_max_turns") errorCategory = "max_turns";
      else if (parsed.subtype === "error_max_budget_usd") errorCategory = "max_budget";
      else if (parsed.subtype === "error_during_execution") {
        var errMsg = (parsed.errors && parsed.errors[0]) || "";
        if (errMsg.indexOf("No conversation found") !== -1 || errMsg.indexOf("No message found") !== -1) {
          // Session or message expired on Anthropic's side — clear it so next message starts fresh
          var expiredOldId = session.cliSessionId;
          console.log("[sdk] Session expired (" + errMsg.substring(0, 60) + "), clearing cliSessionId: " + expiredOldId);
          // Clean up the stale query instance
          if (session.queryInstance && session.queryInstance.close) {
            try { session.queryInstance.close(); } catch (e) {}
          }
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          sm.clearSessionId(session);
          // Notify viewers BEFORE re-keying server routing so they can re-key client-side
          sendToViewers(expiredOldId, { type: "session_id", cliSessionId: session.cliSessionId, oldId: expiredOldId });
          sendToViewers(expiredOldId, { type: "error", text: "Session expired \u2014 start a new one" });
          if (onSessionRekey) onSessionRekey(expiredOldId, session.cliSessionId);
          errorCategory = "session_expired";
        }
        else if (errMsg.indexOf("rate_limit") !== -1 || errMsg.indexOf("rate limit") !== -1 || errMsg.indexOf("429") !== -1) errorCategory = "rate_limit";
        // Emit a dedicated rate_limit event to viewers so frontend can show indicator
        if (errorCategory === "rate_limit") {
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
        if (errorCategory === "session_expired") {
          errorText = "Session expired \u2014 send another message to start fresh.";
        } else if (errorCategory === "prompt_too_long") {
          errorText = "Conversation too long to continue. Start a new session.";
          sendAndRecord(session, { type: "context_overflow", text: errorText });
        }
        sendAndRecord(session, { type: "error", text: errorText, category: errorCategory });
      }

      // Track fast mode state from result
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

      // Context usage tracking: warn when approaching limit
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
            break; // only need primary model
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
      // Reset for next turn in the same query
      session.responsePreview = "";
      session.streamedText = false;
      sm.broadcastSessionList();

    } else if (parsed.type === "system" && parsed.subtype === "task_started") {
      // Track task_id → tool_use_id mapping for stopTask
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
        // Sub-agent tool_progress: forward as activity update
        sendAndRecord(session, {
          type: "subagent_activity",
          parentToolId: parentId,
          text: (parsed.tool_name || "") + (parsed.elapsed_time_seconds > 5 ? " (" + Math.round(parsed.elapsed_time_seconds) + "s)" : ""),
        });
      } else {
        // Top-level tool progress: forward as activity update
        sendAndRecord(session, {
          type: "tool_progress",
          toolId: parsed.tool_use_id,
          toolName: parsed.tool_name || "",
          elapsed: parsed.elapsed_time_seconds || 0,
        });
      }

    } else if (parsed.type === "tool_use_summary") {
      // Human-readable summary of completed tool batch
      if (parsed.summary) {
        sendAndRecord(session, {
          type: "tool_summary",
          summary: parsed.summary,
          toolIds: parsed.preceding_tool_use_ids || [],
        });
      }

    } else if (parsed.type === "task_notification") {
      // Sub-agent / top-level task completed
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_done",
          parentToolId: parentId,
          summary: parsed.summary || "",
          usage: parsed.usage || null,
        });
      }
      // Always forward task notification for status tracking
      sendAndRecord(session, {
        type: "task_notification",
        taskId: parsed.task_id || "",
        status: parsed.status || "completed",
        summary: parsed.summary || "",
        parentToolId: parentId || null,
        usage: parsed.usage || null,
      });

    } else if (parsed.type === "system" && (parsed.subtype === "hook_started" || parsed.subtype === "hook_progress" || parsed.subtype === "hook_response")) {
      // Hook lifecycle events — forward for live feedback
      sendAndRecord(session, {
        type: "hook_event",
        subtype: parsed.subtype,
        hookName: parsed.hook_name || "",
        hookEvent: parsed.hook_event || "",
        output: parsed.output || parsed.stdout || "",
        outcome: parsed.outcome || null,
      });

    } else if (parsed.type === "system" && parsed.subtype === "compact_boundary") {
      // Context compaction boundary — show where conversation was compacted
      var meta = parsed.compact_metadata || {};
      sendAndRecord(session, {
        type: "compact_boundary",
        trigger: meta.trigger || "auto",
        preTokens: meta.pre_tokens || 0,
      });

    } else if (parsed.type === "system" && parsed.subtype === "files_persisted") {
      // File persistence confirmation — show when writes actually saved
      sendAndRecord(session, {
        type: "files_persisted",
        files: (parsed.files || []).map(function(f) { return f.filename || f; }),
        failed: (parsed.failed || []).map(function(f) { return { name: f.filename || f, error: f.error || "" }; }),
      });

    } else if (parsed.type === "auth_status") {
      // Authentication state — show auth flow to user
      sendAndRecord(session, {
        type: "auth_status",
        isAuthenticating: parsed.isAuthenticating || false,
        error: parsed.error || null,
      });

    } else if (parsed.type === "prompt_suggestion") {
      // Prompt suggestions — clickable follow-up suggestions for the user
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

  // --- Sub-agent message processing ---

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
      // Extract tool_use blocks from sub-agent assistant messages
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_use") {
          var activityText = toolActivityTextForSubagent(block.name, block.input);
          sendAndRecord(session, {
            type: "subagent_tool",
            parentToolId: parentId,
            toolName: block.name,
            toolId: block.id,
            text: activityText,
          });
        } else if (block.type === "thinking") {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Thinking...",
          });
        } else if (block.type === "text" && block.text) {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Writing response...",
          });
        }
      }
    }
    // user messages with parent_tool_use_id contain tool_results — skip silently
  }

  // --- SDK query lifecycle ---

  // Patterns that indicate long-running / blocking Bash commands
  var BLOCKED_CMD_PATTERNS = [
    /\bgradlew\s+bootRun\b/i,
    /\bspring-boot:run\b/i,
    /\bnpm\s+run\s+dev\b/,
    /\bnpm\s+start\b/,
    /\bnpx\s+(next|nuxt|vite)\s+dev\b/,
    /\byarn\s+dev\b/,
    /\byarn\s+start\b/,
    /\bpnpm\s+dev\b/,
    /\bpnpm\s+start\b/,
    /\bnode\s+.*server\.js\b/,
    /\bpython\s+.*manage\.py\s+runserver\b/,
    /\bflask\s+run\b/,
    /\brails\s+server\b/,
    /\brails\s+s\b/,
    /\bcargo\s+run\b/,
    /\bgo\s+run\b.*\.go\b/,
    /\b(tsc|webpack|esbuild)\s+--watch\b/,
    /\btail\s+-[fF]\b/,
    /\bsleep\s+\d{2,}\b/,           // sleep 10+ seconds
    /\bwhile\s+true\b/,
    /\bmkfifo\b/,
    /\bdocker\s+compose\s+up(?!\s+.*--build\s+.*--exit)\b/,
    /\b--repl\b/,
  ];

  function isBlockingCommand(command) {
    if (!command) return false;
    for (var i = 0; i < BLOCKED_CMD_PATTERNS.length; i++) {
      if (BLOCKED_CMD_PATTERNS[i].test(command)) return true;
    }
    return false;
  }

  function handleCanUseTool(session, toolName, input, opts) {
    // Block long-running Bash commands that would freeze the session
    if (toolName === "Bash" && input && input.command && !input.run_in_background) {
      if (isBlockingCommand(input.command)) {
        sendAndRecord(session, {
          type: "info",
          text: "Blocked long-running command: " + input.command.substring(0, 120) + "\nUse run_in_background=true or run it in a terminal.",
        });
        return Promise.resolve({
          behavior: "deny",
          message: "This command appears to be a long-running process (server, watch mode, REPL, etc.) that would freeze the session. Use run_in_background=true to run it in the background, or ask the user to run it in a terminal instead.",
        });
      }
    }

    // AskUserQuestion: wait for user answers via WebSocket
    if (toolName === "AskUserQuestion") {
      return new Promise(function(resolve) {
        session.pendingAskUser[opts.toolUseID] = {
          resolve: resolve,
          input: input,
        };
        if (opts.signal) {
          opts.signal.addEventListener("abort", function() {
            delete session.pendingAskUser[opts.toolUseID];
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }

    // Auto-approve if tool was previously allowed for session
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
        _timeout: null, // set below
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };
      sendAndRecord(session, permMsg);

      if (pushModule) {
        pushModule.sendPush({
          type: "permission_request",
          slug: slug,
          requestId: requestId,
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
        });
      }

      // Auto-timeout: if no one answers in 120s, deny so the session doesn't hang forever
      var permEntry = session.pendingPermissions[requestId];
      var permTimeout = setTimeout(function() {
        if (session.pendingPermissions[requestId]) {
          delete session.pendingPermissions[requestId];
          console.log("[sdk] Permission timed out for " + toolName + " (requestId: " + requestId + ")");
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Permission request timed out (no client responded within 120s)" });
        }
      }, 120000);
      permEntry._timeout = permTimeout;

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          // Guard against double-resolve if already handled via WS response
          if (!session.pendingPermissions[requestId]) return;
          clearTimeout(permTimeout);
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
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
          // Auto-retry: SDK subprocess died (often stale resume). Clear session ID and retry fresh.
          session._retried = true;
          var retryOldId = session.cliSessionId;
          console.log("[sdk] Process exited, retrying fresh (was: " + (retryOldId || "new") + ")");
          sm.clearSessionId(session); // don't resume a dead session
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
      // Skip cleanup if we retried (startQuery set up new state)
      if (session._retried && session.queryInstance) {
        session._retried = false;
        return;
      }
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      // Safety net: if isProcessing is still true, the stream ended without
      // a result message (silent death). Reset it so the session isn't stuck forever.
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
    try {
      sdk = await getSDK();
    } catch (e) {
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
      rewindOpts.env = Object.assign({}, process.env, {
        CLAUDE_CONFIG_DIR: account.configDir,
      });
    }

    var tempQuery = sdk.query({
      prompt: mq,
      options: rewindOpts,
    });

    // Drain messages in background (stream stays alive until mq.end())
    (async function() {
      try { for await (var msg of tempQuery) {} } catch(e) {}
    })();

    return {
      query: tempQuery,
      isTemp: true,
      cleanup: function() { try { mq.end(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images, account) {
    console.log("[sdk] startQuery called, session:", session.cliSessionId, "_tempId:", !!session._tempId, "account:", account ? account.name : "none");
    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      console.log("[sdk] getSDK failed:", e.message);
      session.isProcessing = false;
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    // Store account for auto-retry
    if (account) session._account = account;

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.streamedText = false;
    session.responsePreview = "";

    // Build initial user message
    var content = buildContentBlocks(text, images);

    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });

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

    // Per-account env override: use the account's CLAUDE_CONFIG_DIR
    // Skip for "default" account — SDK uses native auth lookup from ~/.claude.json
    if (account && account.configDir && account.name !== "default") {
      queryOptions.env = Object.assign({}, process.env, {
        CLAUDE_CONFIG_DIR: account.configDir,
      });
    }

    // Apply session-level settings (effort level from UI)
    if (session.querySettings && session.querySettings.effort) {
      queryOptions.effort = session.querySettings.effort;
    }

    // Apply stored model override
    if (sm.currentModel) {
      queryOptions.model = sm.currentModel;
    }

    // Apply stored effort level (global, overridden by per-session)
    if (sm.currentEffort && !queryOptions.effort) {
      queryOptions.effort = sm.currentEffort;
    }

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
      session.queryInstance = sdk.query({
        prompt: session.messageQueue,
        options: queryOptions,
      });
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
    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });
  }

  function permissionPushTitle(toolName, input) {
    if (!input) return "Claude wants to use " + toolName;
    var file = input.file_path ? input.file_path.split(/[/\\]/).pop() : "";
    switch (toolName) {
      case "Bash": return "Claude wants to run a command";
      case "Edit": return "Claude wants to edit " + (file || "a file");
      case "Write": return "Claude wants to write " + (file || "a file");
      case "Read": return "Claude wants to read " + (file || "a file");
      case "Grep": return "Claude wants to search files";
      case "Glob": return "Claude wants to find files";
      case "WebFetch": return "Claude wants to fetch a URL";
      case "WebSearch": return "Claude wants to search the web";
      case "Task": return "Claude wants to launch an agent";
      default: return "Claude wants to use " + toolName;
    }
  }

  function permissionPushBody(toolName, input) {
    if (!input) return "";
    var text = "";
    if (toolName === "Bash" && input.command) {
      text = input.command;
    } else if (toolName === "Edit" && input.file_path) {
      text = input.file_path.split(/[/\\]/).pop() + ": " + (input.old_string || "").substring(0, 40) + " \u2192 " + (input.new_string || "").substring(0, 40);
    } else if (toolName === "Write" && input.file_path) {
      text = input.file_path;
    } else if (input.file_path) {
      text = input.file_path;
    } else if (input.command) {
      text = input.command;
    } else if (input.url) {
      text = input.url;
    } else if (input.query) {
      text = input.query;
    } else if (input.pattern) {
      text = input.pattern;
    } else if (input.description) {
      text = input.description;
    }
    if (text.length > 120) text = text.substring(0, 120) + "...";
    return text;
  }

  // SDK warmup: grab slash_commands, model, and available models from SDK init
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
      var stream = sdk.query({
        prompt: mq,
        options: warmupOptions,
      });
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          if (msg.skills) {
            sm.skillNames = new Set(msg.skills);
          }
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
          if (msg.model) {
            sm.currentModel = msg.model;
          }
          // Fetch available models before aborting
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
      broadcastConfigState();
      return;
    }
    try {
      await session.queryInstance.setModel(model);
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      broadcastConfigState();
    } catch (e) {
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to switch model: " + (e.message || e) });
    }
  }

  async function setPermissionMode(session, mode) {
    if (dangerouslySkipPermissions) return;
    if (!session.queryInstance) {
      sm.currentPermissionMode = mode;
      broadcastConfigState();
      return;
    }
    try {
      await session.queryInstance.setPermissionMode(mode);
      sm.currentPermissionMode = mode;
      broadcastConfigState();
    } catch (e) {
      sendToViewers(session.cliSessionId, { type: "error", text: "Failed to set permission mode: " + (e.message || e) });
    }
  }

  function setEffort(effort) {
    sm.currentEffort = effort || "";
    broadcastConfigState();
  }

  async function stopTask(session, taskId, toolUseId) {
    if (!session || !session.queryInstance) return;
    // Resolve toolUseId → taskId if needed
    var resolvedId = taskId;
    if (!resolvedId && toolUseId && session.taskIdMap) {
      resolvedId = session.taskIdMap[toolUseId];
    }
    if (!resolvedId) {
      console.log("[sdk] stopTask: no taskId found for toolUseId:", toolUseId);
      // Fallback: abort the entire query
      if (session.abortController) session.abortController.abort();
      return;
    }
    try {
      await session.queryInstance.stopTask(resolvedId);
      console.log("[sdk] stopTask sent for taskId:", resolvedId);
    } catch (e) {
      console.error("[sdk] stopTask error:", e.message);
      // Fallback: abort entire query
      if (session.abortController) session.abortController.abort();
    }
  }

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: processSDKMessage,
    handleCanUseTool: handleCanUseTool,
    processQueryStream: processQueryStream,
    getOrCreateRewindQuery: getOrCreateRewindQuery,
    startQuery: startQuery,
    pushMessage: pushMessage,
    setModel: setModel,
    setPermissionMode: setPermissionMode,
    setEffort: setEffort,
    stopTask: stopTask,
    broadcastConfigState: broadcastConfigState,
    permissionPushTitle: permissionPushTitle,
    permissionPushBody: permissionPushBody,
    warmup: warmup,
  };
}

module.exports = { createSDKBridge, createMessageQueue, AGENT_SKILLS, BASE_SYSTEM_APPEND, buildSystemPrompt };
