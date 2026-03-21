const fs = require("fs");
const path = require("path");

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
    return null;
  }
  return Object.keys(skills).length > 0 ? skills : null;
}

function buildConversationContext(session) {
  if (!session.history || session.history.length === 0) return "";
  var lines = [];
  var totalLen = 0;
  var MAX_CONTEXT_CHARS = 80000;

  for (var i = 0; i < session.history.length; i++) {
    var entry = session.history[i];
    var text = "";
    if (entry.type === "user_message" && entry.text) {
      text = "USER: " + entry.text.substring(0, 2000);
    } else if (entry.type === "assistant" && entry.text) {
      text = "ASSISTANT: " + entry.text.substring(0, 4000);
    } else if (entry.type === "info" && entry.text) {
      text = "INFO: " + entry.text.substring(0, 200);
    }
    if (!text) continue;
    if (totalLen + text.length > MAX_CONTEXT_CHARS) {
      while (lines.length > 0 && totalLen + text.length > MAX_CONTEXT_CHARS) {
        totalLen -= lines[0].length;
        lines.shift();
      }
    }
    lines.push(text);
    totalLen += text.length;
  }

  if (lines.length === 0) return "";
  return [
    "",
    "═══ PRIOR CONVERSATION CONTEXT ═══",
    "The original SDK session expired, but here is the conversation history from this session.",
    "Continue naturally from where the conversation left off. Do NOT say this is a fresh conversation.",
    "",
  ].concat(lines).concat([
    "",
    "═══ END PRIOR CONTEXT ═══",
    "",
  ]).join("\n");
}

function buildSystemPrompt(session, skills, instancePrompt) {
  var append = BASE_SYSTEM_APPEND;

  if (instancePrompt) {
    append = append + "\n\n" + instancePrompt;
  }

  var activeSkills = skills || AGENT_SKILLS;

  var p = session.projectPath || "";
  var skillKey = p.split("/")[0];
  if (skillKey && activeSkills[skillKey]) {
    append = append + "\n" + activeSkills[skillKey];
    console.log("[sdk] Injecting agent skill for projectPath:", p, "→", skillKey);
  }

  if (session.customPrompt) {
    append = append + "\n\n" + session.customPrompt;
    console.log("[sdk] Appending customPrompt for session:", session.cliSessionId, "(" + session.customPrompt.length + " chars)");
  }

  if (session.status === "expired" && session.history && session.history.length > 0) {
    var context = buildConversationContext(session);
    if (context) {
      append = append + "\n" + context;
      console.log("[sdk] Injecting expired session context:", context.length, "chars from", session.history.length, "history entries");
    }
  }

  return {
    type: "preset",
    preset: "claude_code",
    append: append,
  };
}

module.exports = { AGENT_SKILLS, BASE_SYSTEM_APPEND, loadAgentSkills, buildConversationContext, buildSystemPrompt };
