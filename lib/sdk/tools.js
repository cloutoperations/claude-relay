const crypto = require("crypto");

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
  /\bsleep\s+\d{2,}\b/,
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

function createToolHandler(ctx) {
  var sendAndRecord = ctx.sendAndRecord;
  var pushModule = ctx.pushModule;
  var slug = ctx.slug;

  function handleCanUseTool(session, toolName, input, opts) {
    // Block long-running Bash commands
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

    // Auto-approve if tool was previously allowed
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Regular permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
        _timeout: null,
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
          if (!session.pendingPermissions[requestId]) return;
          clearTimeout(permTimeout);
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  return handleCanUseTool;
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

module.exports = { createToolHandler, permissionPushTitle, permissionPushBody, BLOCKED_CMD_PATTERNS, isBlockingCommand };
