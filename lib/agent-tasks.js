var fs = require("fs");
var path = require("path");
var { createMessageQueue, AGENT_SKILLS, BASE_SYSTEM_APPEND } = require("./sdk/index");

// --- Task definitions ---
// Each task has: description, prompt (what to do), outputInstruction (how to format result)

var TASKS = {
  "status-check": {
    description: "Present state + session activity + drift signals",
    prompt: [
      "Run a strategic status check. You are the honest observer inside the TOTE loop.",
      "",
      "STEP 1 — Read strategic context:",
      "- gtd/strategy/goals.md (the gate — what we're trying to achieve)",
      "- gtd/strategy/strategy.md (standards, review cadence)",
      "- The latest session summary folder in gtd/strategy/02-operations/sessions/ (read session-summary.md AND standing-ops-tote.md)",
      "",
      "STEP 2 — Read each area's TOTE status file:",
      "- gtd/chatting/ (look for the main .md TOTE file)",
      "- gtd/marketing/ (same)",
      "- gtd/content/, gtd/finance/, gtd/hiring/, gtd/personal/, gtd/system/",
      "For each area: what's the present state? What are the test criteria? Are lagging/leading indicators moving?",
      "",
      "STEP 3 — Check recent activity:",
      "- Run: git log --since='2 weeks ago' --oneline --stat (to see what actually shipped)",
      "- Categorize commits by area based on file paths:",
      "  gtd/chatting/ or code/scraper/ → chatting",
      "  gtd/marketing/ or code/reddit-pipeline/ → marketing",
      "  code/claude-relay/ → system (flag if not in allocation)",
      "  gtd/strategy/ → strategy",
      "  etc.",
      "- Calculate rough % of work per area from commit activity",
      "",
      "STEP 4 — Session hygiene:",
      "- Session files live in .claude-relay/sessions-*/*.jsonl — each file's first line is JSON with {type:'meta', title, projectPath, createdAt}",
      "- Run: find .claude-relay/sessions-* -name '*.jsonl' -mtime -7 to find recently active sessions",
      "- For each recent session, read the first line to get its title and projectPath",
      "- Flag sessions with no projectPath (untagged — not assigned to any area)",
      "- Flag sessions older than 7 days with recent activity but no clear outcome",
      "- Note what Calvin has been working on based on session titles and activity",
      "",
      "STEP 5 — Drift detection:",
      "- Compare actual commit activity (step 3) to the allocation percentages in standing-ops-tote.md",
      "- Check: has anything boundary-crossing shipped? Or just comfortable meta-work?",
      "- Check: is any area getting 0% attention despite being in the allocation?",
      "- Apply the procrastination detection criteria from gtd/strategy/04-resources/test-criteria.md",
      "",
      "Be honest. Don't soften the assessment. If the work is drifting, say so clearly.",
    ].join("\n"),
    outputInstruction: [
      "",
      "IMPORTANT: End your response with a fenced JSON block containing structured data:",
      "```json",
      '{',
      '  "gate": "current gate text",',
      '  "lastReview": "YYYY-MM-DD",',
      '  "nextReview": "YYYY-MM-DD",',
      '  "areas": [',
      '    { "name": "area-name", "status": "green|yellow|red", "summary": "one line of what is actually happening, not what is planned" }',
      '  ],',
      '  "allocationActual": { "area-name": 35, "other-area": 15 },',
      '  "allocationPlanned": { "area-name": 35, "other-area": 15 },',
      '  "priorities": ["top priority 1", "top priority 2", "top priority 3"],',
      '  "driftSignals": ["specific drift or procrastination patterns with evidence"],',
      '  "sessionHygiene": { "untagged": 0, "stale": 0, "notes": "any issues" },',
      '  "shippedThisCycle": ["concrete things that actually shipped (not specced, shipped)"],',
      '  "notStarted": ["planned items from standing-ops-tote that show no evidence of progress"]',
      '}',
      "```",
    ].join("\n"),
  },

  "gate-check": {
    description: "Evaluate standing-ops-tote tests against repo evidence",
    prompt: [
      "Run a gate check — evaluate each test from the current cycle against actual evidence.",
      "",
      "STEP 1 — Read the tests to evaluate:",
      "- Find the latest session folder in gtd/strategy/02-operations/sessions/",
      "- Read standing-ops-tote.md — find the 'Tests' section (these are the specific tests for THIS cycle)",
      "- Also read gtd/strategy/goals.md for the overall gate",
      "",
      "STEP 2 — For EACH test, search for evidence:",
      "- Don't guess. Don't infer. Actually look.",
      "- Use Glob and Grep to find relevant files, code, configs",
      "- Check git log for commits related to each test",
      "- Check if files/code that the test expects actually exist and are functional",
      "- For 'is X running?' tests: look for evidence of execution (logs, data files, recent changes)",
      "- For 'is X built?' tests: look for the actual code/files",
      "- For 'has X happened?' tests: look for evidence in session files, notes, or git history",
      "",
      "STEP 3 — Compare to previous gate check:",
      "- Read gtd/strategy/cockpit-state.json for previous testStatus",
      "- Note which tests improved, declined, or stayed the same",
      "",
      "Score each test: PASS (clear evidence), CONCERN (partial/ambiguous), FAIL (no evidence or contradicting evidence).",
      "Be strict. 'Planned' is not 'done'. 'Specced' is not 'shipped'.",
    ].join("\n"),
    outputInstruction: [
      "",
      "IMPORTANT: End your response with a fenced JSON block:",
      "```json",
      '{',
      '  "gate": "current gate text",',
      '  "reviewDate": "date of the session these tests come from",',
      '  "tests": [',
      '    { "label": "test label exactly as written in standing-ops-tote", "status": "pass|concern|fail", "evidence": "what you actually found (or did not find)", "trend": "improving|declining|static|new" }',
      '  ],',
      '  "summary": "one paragraph honest assessment of gate progress"',
      '}',
      "```",
    ].join("\n"),
    onComplete: function(result, cwd) {
      if (!result.data || !result.data.tests) return;
      var statePath = path.join(cwd, "gtd", "strategy", "cockpit-state.json");
      var state = {};
      try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) { console.warn("[agent] Failed to read cockpit-state.json for gate-check:", e.message); }
      state.testStatus = {};
      for (var i = 0; i < result.data.tests.length; i++) {
        var t = result.data.tests[i];
        state.testStatus[t.label] = t.status === "pass";
      }
      state.lastAgentRun = { task: "gate-check", time: Date.now() };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      console.log("[agent-tasks] Updated cockpit-state.json with gate-check results");
    },
  },

  "drift-check": {
    description: "Allocation drift + procrastination detection",
    prompt: [
      "Run a drift check — compare what's actually being worked on to what was planned.",
      "",
      "STEP 1 — Read the plan:",
      "- Find the latest session folder in gtd/strategy/02-operations/sessions/",
      "- Read standing-ops-tote.md — find the allocation percentages and critical path",
      "- Read session-summary.md — find the selected candidate and its allocation breakdown",
      "",
      "STEP 2 — Read reality:",
      "- Run: git log --since='2 weeks ago' --oneline --stat",
      "- Categorize EVERY commit by area based on file paths changed:",
      "  gtd/chatting/ or code/scraper/ → chatting",
      "  gtd/marketing/ or code/reddit-pipeline/ or code/auto-follower/ → marketing",
      "  code/claude-relay/ → system/relay",
      "  gtd/strategy/ → strategy",
      "  code/phone-automation/ → marketing/phones",
      "  gtd/finance/ → finance",
      "  gtd/hiring/ → hiring",
      "  gtd/content/ → content",
      "  gtd/personal/ → personal",
      "- Count commits per category and calculate actual percentages",
      "",
      "STEP 3 — Run procrastination detection (from gtd/strategy/04-resources/test-criteria.md section 3):",
      "- Has anything shipped this week? (boundary-crossing action, not spec/plan/framework)",
      "- What boundary-crossing action is NOT being done?",
      "- Is there always one more comfortable thing before the uncomfortable thing?",
      "- Is the current work generating more of itself? (meta-work loop)",
      "- Would a naive outsider say this is the simplest path to the gate?",
      "",
      "STEP 4 — Check critical path items:",
      "- For each item in the critical path (from standing-ops-tote.md):",
      "  - Is there any evidence of progress in git log?",
      "  - Is it on track, behind, or not started?",
      "",
      "Be brutally honest. The whole point is to catch drift before it wastes a cycle.",
    ].join("\n"),
    outputInstruction: [
      "",
      "IMPORTANT: End your response with a fenced JSON block:",
      "```json",
      '{',
      '  "planned": { "area": "percent", "area2": "percent" },',
      '  "actual": { "area": "percent", "area2": "percent" },',
      '  "driftAreas": [',
      '    { "area": "name", "planned": 35, "actual": 5, "severity": "high|medium|low", "note": "what should be happening vs what is" }',
      '  ],',
      '  "procrastination": {',
      '    "shippedThisWeek": ["list of boundary-crossing things that shipped"],',
      '    "avoiding": ["uncomfortable things not being done"],',
      '    "metaWorkLoop": "description of any self-generating comfortable work pattern",',
      '    "verdict": "on-track|drifting|procrastinating"',
      '  },',
      '  "criticalPath": [',
      '    { "item": "description", "status": "done|in-progress|not-started|behind", "evidence": "what you found" }',
      '  ]',
      '}',
      "```",
    ].join("\n"),
  },

  "update-dashboard": {
    description: "Update markdown files to reflect current state for cockpit parsing",
    prompt: [
      "Update the strategy dashboard data so the cockpit widget shows accurate information.",
      "",
      "STEP 1 — Understand what the cockpit parses:",
      "The /api/board/strategy endpoint extracts from the latest session summary:",
      "- Candidate name (from ## Selection section)",
      "- Next review date",
      "- Allocation percentages (table after ## Selection)",
      "- Gap analysis table (area, present, desired, gap, urgency)",
      "- Tests table (check label + evidence)",
      "- One-sentence strategic summary",
      "It also reads goals.md for the gate and strategy.md for last reviewed date.",
      "",
      "STEP 2 — Check what needs updating:",
      "- Read the latest session summary in gtd/strategy/02-operations/sessions/",
      "- Read gtd/strategy/strategy.md",
      "- Read gtd/strategy/goals.md",
      "- Check if dates, allocation percentages, gap analysis, and tests are current",
      "",
      "STEP 3 — Update files:",
      "- Only edit what's actually stale or wrong",
      "- Make sure the session-summary.md has proper markdown tables that the parser can extract",
      "- Update strategy.md 'Last reviewed' date if a review just happened",
      "- Don't fabricate data — only update from what's in the repo",
    ].join("\n"),
    outputInstruction: [
      "",
      "IMPORTANT: End your response with a fenced JSON block summarizing what you changed:",
      "```json",
      '{',
      '  "filesUpdated": ["list of files you edited"],',
      '  "changes": ["brief description of each change"]',
      '}',
      "```",
    ].join("\n"),
  },
};

// --- Task runner ---

var activeTask = null; // only one task at a time

async function runAgentTask(taskName, opts) {
  // opts: { cwd, getSDK, onProgress(text), onComplete(result) }
  if (activeTask) {
    throw new Error("Agent task already running: " + activeTask);
  }

  var task = TASKS[taskName];
  if (!task) {
    throw new Error("Unknown task: " + taskName);
  }

  activeTask = taskName;
  console.log("[agent-tasks] Starting task:", taskName);

  try {
    var sdk = await opts.getSDK();
    var mq = createMessageQueue();

    // Send the task prompt
    var fullPrompt = task.prompt + "\n" + task.outputInstruction;
    mq.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: fullPrompt }] },
    });
    // End the queue immediately — single-shot task, no follow-up messages
    mq.end();

    var strategySkill = AGENT_SKILLS["strategy"] || "";
    var systemAppend = BASE_SYSTEM_APPEND + "\n" + strategySkill;

    var queryOptions = {
      cwd: opts.cwd,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    };

    var queryStream = sdk.query({
      prompt: mq,
      options: queryOptions,
    });

    // Collect the full response text + stream live activity
    var fullText = "";
    var toolIdMap = {}; // tool_use_id → { name, detail }
    for await (var msg of queryStream) {
      if (!msg) continue;

      // SDK streams top-level message types: assistant, user (tool results), system, result
      if (msg.type === "assistant" && msg.message && msg.message.content) {
        var content = msg.message.content;
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "text" && block.text) {
            fullText += block.text;
            if (opts.onProgress) opts.onProgress({ type: "text", text: block.text });
          }
          if (block.type === "thinking" && block.thinking) {
            var snippet = block.thinking.length > 120 ? block.thinking.slice(-120) : block.thinking;
            if (opts.onProgress) opts.onProgress({ type: "thinking", text: snippet });
          }
          if (block.type === "tool_use") {
            var toolDetail = "";
            if (block.input) {
              if (block.input.file_path) toolDetail = block.input.file_path.replace(/.*\//, '');
              else if (block.input.pattern) toolDetail = block.input.pattern;
              else if (block.input.command) toolDetail = block.input.command.substring(0, 60);
              else if (block.input.path) toolDetail = block.input.path.replace(/.*\//, '');
            }
            toolIdMap[block.id] = { name: block.name, detail: toolDetail };
            if (opts.onProgress) opts.onProgress({ type: "tool_start", tool: block.name, id: block.id, detail: toolDetail });
          }
        }
      }

      // Tool results come back as user messages
      if (msg.type === "user" && msg.message && msg.message.content) {
        var uc = msg.message.content;
        for (var j = 0; j < uc.length; j++) {
          if (uc[j].type === "tool_result") {
            var tid = uc[j].tool_use_id || "";
            var toolInfo = toolIdMap[tid] || {};
            var preview = "";
            if (typeof uc[j].content === "string") {
              preview = uc[j].content.substring(0, 150);
            } else if (Array.isArray(uc[j].content)) {
              for (var k = 0; k < uc[j].content.length; k++) {
                if (uc[j].content[k].type === "text") {
                  preview = uc[j].content[k].text.substring(0, 150);
                  break;
                }
              }
            }
            if (opts.onProgress) opts.onProgress({ type: "tool_result", tool: toolInfo.name || tid, id: tid, detail: toolInfo.detail || "", output: preview });
          }
        }
      }

      // Result message — final output
      if (msg.type === "result") {
        if (msg.result && !fullText) {
          fullText = typeof msg.result === "string" ? msg.result : "";
        }
      }
    }

    // Parse structured JSON output
    var structured = null;
    var jsonMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        structured = JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.log("[agent-tasks] Failed to parse JSON output:", e.message);
      }
    }

    var result = { text: fullText, data: structured };

    // Run task-specific onComplete handler
    if (task.onComplete) {
      try {
        task.onComplete(result, opts.cwd);
      } catch (e) {
        console.log("[agent-tasks] onComplete error:", e.message);
      }
    }

    // Persist run result to cockpit-state.json (latest + history)
    if (structured) {
      try {
        var statePath = path.join(opts.cwd, "gtd", "strategy", "cockpit-state.json");
        var state = {};
        try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) { console.warn("[agent] Failed to read cockpit-state.json for result save:", e.message); }
        if (!state.lastRuns) state.lastRuns = {};
        if (!state.runHistory) state.runHistory = [];
        var runEntry = { task: taskName, data: structured, time: Date.now() };
        state.lastRuns[taskName] = { data: structured, time: Date.now() };
        state.lastAgentRun = { task: taskName, time: Date.now() };
        // Keep last 20 runs
        state.runHistory.unshift(runEntry);
        if (state.runHistory.length > 20) state.runHistory = state.runHistory.slice(0, 20);
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        console.log("[agent-tasks] Saved " + taskName + " result to cockpit-state.json");
      } catch (e) {
        console.log("[agent-tasks] Failed to save result:", e.message);
      }
    }

    if (opts.onComplete) opts.onComplete(result);

    console.log("[agent-tasks] Task complete:", taskName, structured ? "(structured output parsed)" : "(no structured output)");
    return result;
  } finally {
    activeTask = null;
  }
}

function isRunning() {
  return activeTask !== null;
}

function getRunningTask() {
  return activeTask;
}

module.exports = { TASKS, runAgentTask, isRunning, getRunningTask };
