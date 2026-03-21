var path = require("path");
var { execFileAsync } = require("./utils");

module.exports = {
  async git_status(ctx, ws, msg) {
    try {
      var { stdout } = await execFileAsync("git", ["status", "--porcelain", "-uall"],
        { cwd: ctx.cwd, encoding: "utf8", timeout: 10000 });
      var staged = [];
      var changed = [];
      var untracked = [];
      var lines = stdout.split("\n");
      for (var si = 0; si < lines.length; si++) {
        var line = lines[si];
        if (!line || line.length < 4) continue;
        var x = line[0];
        var y = line[1];
        var filePath = line.substring(3);
        var oldPath = null;
        var renameIdx = filePath.indexOf(" -> ");
        if (renameIdx !== -1) {
          oldPath = filePath.substring(0, renameIdx);
          filePath = filePath.substring(renameIdx + 4);
        }
        if (x === "M" || x === "A" || x === "D" || x === "R" || x === "C") {
          staged.push({ status: x, path: filePath, oldPath: oldPath });
        }
        if (y === "M" || y === "D") {
          changed.push({ status: y, path: filePath });
        }
        if (x === "?" && y === "?") {
          untracked.push({ status: "?", path: filePath });
        }
      }
      ctx.sendTo(ws, { type: "git_status_result", staged: staged, changed: changed, untracked: untracked });
    } catch (err) {
      ctx.sendTo(ws, { type: "git_status_result", staged: [], changed: [], untracked: [], error: err.message });
    }
  },

  async git_stage(ctx, ws, msg) {
    var paths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
    for (var gi = 0; gi < paths.length; gi++) {
      if (!paths[gi] || paths[gi].indexOf("..") !== -1) {
        ctx.sendTo(ws, { type: "git_action_result", action: "stage", error: "Invalid path" });
        return;
      }
    }
    try {
      await execFileAsync("git", ["add", "--"].concat(paths), { cwd: ctx.cwd, timeout: 5000 });
      ctx.sendTo(ws, { type: "git_action_result", action: "stage", success: true });
    } catch (e) {
      ctx.sendTo(ws, { type: "git_action_result", action: "stage", error: e.message });
    }
  },

  async git_unstage(ctx, ws, msg) {
    var uPaths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
    for (var ui = 0; ui < uPaths.length; ui++) {
      if (!uPaths[ui] || uPaths[ui].indexOf("..") !== -1) {
        ctx.sendTo(ws, { type: "git_action_result", action: "unstage", error: "Invalid path" });
        return;
      }
    }
    try {
      await execFileAsync("git", ["reset", "HEAD", "--"].concat(uPaths), { cwd: ctx.cwd, timeout: 5000 });
      ctx.sendTo(ws, { type: "git_action_result", action: "unstage", success: true });
    } catch (e) {
      ctx.sendTo(ws, { type: "git_action_result", action: "unstage", error: e.message });
    }
  },

  async git_discard(ctx, ws, msg) {
    var dPaths = Array.isArray(msg.paths) ? msg.paths : [msg.path];
    for (var di = 0; di < dPaths.length; di++) {
      if (!dPaths[di] || dPaths[di].indexOf("..") !== -1) {
        ctx.sendTo(ws, { type: "git_action_result", action: "discard", error: "Invalid path" });
        return;
      }
    }
    try {
      await execFileAsync("git", ["checkout", "--"].concat(dPaths), { cwd: ctx.cwd, timeout: 5000 });
      ctx.sendTo(ws, { type: "git_action_result", action: "discard", success: true });
    } catch (e) {
      ctx.sendTo(ws, { type: "git_action_result", action: "discard", error: e.message });
    }
  },

  async git_diff_working(ctx, ws, msg) {
    var wdPath = msg.path;
    if (!wdPath || wdPath.indexOf("..") !== -1) {
      ctx.sendTo(ws, { type: "git_diff_working_result", path: wdPath, diff: "", error: "Invalid path" });
      return;
    }
    var wdArgs = msg.staged ? ["diff", "--cached", "--", wdPath] : ["diff", "--", wdPath];
    try {
      var { stdout } = await execFileAsync("git", wdArgs, { cwd: ctx.cwd, encoding: "utf8", timeout: 5000 });
      ctx.sendTo(ws, { type: "git_diff_working_result", path: wdPath, staged: !!msg.staged, diff: stdout || "" });
    } catch (e) {
      ctx.sendTo(ws, { type: "git_diff_working_result", path: wdPath, diff: "", error: e.message });
    }
  },

  async fs_git_diff(ctx, ws, msg) {
    var diffPath = msg.path;
    var hash = msg.hash;
    var hash2 = msg.hash2 || null;
    if (!diffPath || !hash) {
      ctx.sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Missing params" });
      return;
    }
    var hashRe = /^[0-9a-f]{7,64}$/i;
    if (!hashRe.test(hash) || (hash2 && !hashRe.test(hash2))) {
      ctx.sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Invalid hash" });
      return;
    }
    if (diffPath.indexOf("..") !== -1) {
      ctx.sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Invalid path" });
      return;
    }
    var gitDiffArgs = hash2 ? ["diff", hash, hash2, "--", diffPath] : ["show", hash, "--format=", "--", diffPath];
    try {
      var { stdout } = await execFileAsync("git", gitDiffArgs, { cwd: ctx.cwd, encoding: "utf8", timeout: 5000 });
      ctx.sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: stdout || "" });
    } catch (e) {
      ctx.sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: "", error: e.message });
    }
  },

  async fs_file_at(ctx, ws, msg) {
    var atPath = msg.path;
    var atHash = msg.hash;
    if (!atPath || !atHash) {
      ctx.sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Missing params" });
      return;
    }
    if (!/^[0-9a-f]{7,64}$/i.test(atHash)) {
      ctx.sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Invalid hash" });
      return;
    }
    if (atPath.indexOf("..") !== -1) {
      ctx.sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Invalid path" });
      return;
    }
    var atAbsPath = path.resolve(ctx.cwd, atPath);
    var atRelPath = path.relative(ctx.cwd, atAbsPath);
    try {
      var { stdout } = await execFileAsync("git", ["show", atHash + ":" + atRelPath], { cwd: ctx.cwd, encoding: "utf8", timeout: 5000 });
      ctx.sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: stdout });
    } catch (e) {
      ctx.sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: e.message });
    }
  },

  async fs_file_history(ctx, ws, msg) {
    var histPath = msg.path;
    if (!histPath) {
      ctx.sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: [] });
      return;
    }
    var absHistPath = path.resolve(ctx.cwd, histPath);
    var entries = [];

    // Collect session edits
    ctx.sm.sessions.forEach(function (session) {
      var sessionLocalId = session.cliSessionId;
      var sessionTitle = session.title || "Untitled";
      var histLen = session.history.length || 1;

      for (var hi = 0; hi < session.history.length; hi++) {
        var entry = session.history[hi];
        if (entry.type !== "tool_executing") continue;
        if (entry.name !== "Edit" && entry.name !== "Write") continue;
        if (!entry.input || !entry.input.file_path) continue;
        if (entry.input.file_path !== absHistPath) continue;

        var assistantUuid = null;
        var uuidIndex = -1;
        for (var hj = hi - 1; hj >= 0; hj--) {
          if (session.history[hj].type === "message_uuid" && session.history[hj].messageType === "assistant") {
            assistantUuid = session.history[hj].uuid;
            uuidIndex = hj;
            break;
          }
        }

        var messageSnippet = "";
        var searchFrom = uuidIndex >= 0 ? uuidIndex : hi;
        for (var hk = searchFrom - 1; hk >= 0; hk--) {
          if (session.history[hk].type === "user_message" && session.history[hk].text) {
            messageSnippet = session.history[hk].text.trim().substring(0, 100);
            break;
          }
        }

        var assistantSnippet = "";
        var deltaChunks = [];
        for (var hd = hi - 1; hd >= 0; hd--) {
          var hEntry = session.history[hd];
          if (hEntry.type === "tool_start") continue;
          if (hEntry.type === "delta" && hEntry.text) {
            deltaChunks.unshift(hEntry.text);
          } else {
            break;
          }
        }
        if (deltaChunks.length === 0) {
          for (var hd2 = hi - 1; hd2 >= 0; hd2--) {
            var hEntry2 = session.history[hd2];
            if (hEntry2.type === "tool_start" || hEntry2.type === "tool_executing" || hEntry2.type === "tool_result") continue;
            if (hEntry2.type === "delta" && hEntry2.text) {
              for (var hd3 = hd2; hd3 >= 0; hd3--) {
                var hEntry3 = session.history[hd3];
                if (hEntry3.type === "tool_start") continue;
                if (hEntry3.type === "delta" && hEntry3.text) {
                  deltaChunks.unshift(hEntry3.text);
                } else {
                  break;
                }
              }
              break;
            } else {
              break;
            }
          }
        }
        assistantSnippet = deltaChunks.join("").trim().substring(0, 150);

        var tStart = session.createdAt || 0;
        var tEnd = session.lastActivity || tStart;
        var ts = tStart + Math.floor((hi / histLen) * (tEnd - tStart));

        var editRecord = {
          source: "session",
          timestamp: ts,
          sessionLocalId: sessionLocalId,
          sessionTitle: sessionTitle,
          assistantUuid: assistantUuid,
          toolId: entry.id,
          messageSnippet: messageSnippet,
          assistantSnippet: assistantSnippet,
          toolName: entry.name,
        };

        if (entry.name === "Edit") {
          editRecord.old_string = entry.input.old_string || "";
          editRecord.new_string = entry.input.new_string || "";
        } else {
          editRecord.isFullWrite = true;
        }

        entries.push(editRecord);
      }
    });

    // Collect git commits
    try {
      var { stdout } = await execFileAsync("git", ["log", "--format=%H|%at|%an|%s", "--follow", "--", histPath],
        { cwd: ctx.cwd, encoding: "utf8", timeout: 5000 });
      if (stdout) {
        var gitLines = stdout.trim().split("\n");
        for (var gi = 0; gi < gitLines.length; gi++) {
          if (!gitLines[gi]) continue;
          var parts = gitLines[gi].split("|");
          if (parts.length < 4) continue;
          entries.push({
            source: "git",
            hash: parts[0],
            timestamp: parseInt(parts[1], 10) * 1000,
            author: parts[2],
            message: parts.slice(3).join("|"),
          });
        }
      }
    } catch (e) { /* git log failed, just return session entries */ }
    entries.sort(function (a, b) { return b.timestamp - a.timestamp; });
    ctx.sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: entries });
  },
};
