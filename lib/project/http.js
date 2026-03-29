var fs = require("fs");
var path = require("path");
var { execFile } = require("child_process");
var { safePath, parseJsonBody } = require("./utils");
var { IMAGE_EXTS, MIME_TYPES } = require("./constants");

function createHTTPHandler(ctx) {
  var cwd = ctx.cwd;
  var sm = ctx.sm;
  var pushModule = ctx.pushModule;
  var agentTasks = ctx.agentTasks;
  var getSDK = ctx.getSDK;

  return async function handleHTTP(req, res, urlPath) {
    // Serve session images
    if (req.method === "GET" && urlPath.startsWith("/api/session-image/")) {
      var imgName = urlPath.substring("/api/session-image/".length);
      if (imgName.includes("..") || imgName.includes("/")) {
        res.writeHead(400);
        res.end("Bad request");
        return true;
      }
      var imgDir = path.join(sm.sessionsDir || path.join(cwd, ".claude-relay", "sessions"), "images");
      var imgPath = path.join(imgDir, imgName);
      try {
        var content = await fs.promises.readFile(imgPath);
        var ext = path.extname(imgName).substring(1);
        var mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" }[ext] || "image/png";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(content);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      try {
        var body = await parseJsonBody(req);
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) {
        console.error("[project] push-subscribe error:", e.message || e);
        res.writeHead(400);
        res.end("Bad request");
      }
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      try {
        var data = await parseJsonBody(req);
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return true;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;
          delete session.pendingPermissions[requestId];
          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }
          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });
        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      } catch (e) {
        console.error("[project] permission-response error:", e.message || e);
        res.writeHead(400);
        res.end("Bad request");
      }
      return true;
    }

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileContent = await fs.promises.readFile(absFile);
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "private, max-age=3600, immutable" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // PDF generation
    if (req.method === "GET" && urlPath.startsWith("/api/pdf?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      if (!absFile.endsWith(".md") && !absFile.endsWith(".mdx")) {
        res.writeHead(400); res.end("Only markdown files supported"); return true;
      }
      try { await fs.promises.access(absFile); } catch (e) { res.writeHead(404); res.end("File not found"); return true; }

      var scriptPaths = [
        path.resolve(cwd, "code/scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "../scripts/md-to-pdf.mjs"),
        path.resolve(cwd, "../../code/scripts/md-to-pdf.mjs"),
      ];
      var scriptPath = null;
      for (var si = 0; si < scriptPaths.length; si++) {
        try { await fs.promises.access(scriptPaths[si]); scriptPath = scriptPaths[si]; break; } catch (e) {}
      }
      if (!scriptPath) { res.writeHead(500); res.end("md-to-pdf.mjs not found"); return true; }

      var os = require("os");
      var tmpOut = path.join(os.tmpdir(), "claude-relay-pdf-" + Date.now() + ".pdf");
      try {
        await new Promise(function(resolve, reject) {
          execFile("node", [scriptPath, absFile, "--output", tmpOut, "--brand", "clout"], {
            timeout: 30000, cwd: cwd,
          }, function (err) { if (err) reject(err); else resolve(); });
        });
        var pdfBuf = await fs.promises.readFile(tmpOut);
        var baseName = path.basename(absFile, path.extname(absFile));
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="' + baseName + ' - Clout Operations.pdf"',
          "Content-Length": pdfBuf.length,
        });
        res.end(pdfBuf);
        try { await fs.promises.unlink(tmpOut); } catch (e) {}
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // Board: GTD structure endpoint
    if (req.method === "GET" && urlPath === "/api/board") {
      var gtdPath = path.join(cwd, "gtd");
      try { await fs.promises.access(gtdPath); } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"No gtd/ directory found in project"}');
        return true;
      }
      var skipAreas = new Set(["archive", "4-areas"]);
      var areaDirs = [];
      try {
        var allDirs = await fs.promises.readdir(gtdPath);
        for (var adi = 0; adi < allDirs.length; adi++) {
          var d = allDirs[adi];
          if (d.startsWith(".") || skipAreas.has(d)) continue;
          try { var ds = await fs.promises.stat(path.join(gtdPath, d)); if (ds.isDirectory()) areaDirs.push(d); } catch(e) { console.warn("[http] stat failed for gtd entry:", d, e.message); }
        }
      } catch(e) { console.warn("[http] readdir failed for gtd path:", e.message); }

      var sessionsByProject = {};
      var looseSessions = [];
      sm.sessions.forEach(function (session) {
        if (session._tempId) return;
        if (session.archived) return;
        var turnCount = 0;
        var totalCost = 0;
        var lastUserMessage = "";
        if (session.history) {
          for (var hi = 0; hi < session.history.length; hi++) {
            if (session.history[hi].type === "user_message") {
              turnCount++;
              if (session.history[hi].text) lastUserMessage = session.history[hi].text;
            }
            if (session.history[hi].type === "result" && session.history[hi].cost != null) totalCost += session.history[hi].cost;
          }
        }
        if (lastUserMessage.length > 120) lastUserMessage = lastUserMessage.substring(0, 120);
        var s = { id: session.cliSessionId, title: session.title || "", isProcessing: session.isProcessing || false, accountId: session.accountId || null, createdAt: session.createdAt, lastActivity: session.lastActivity, turnCount: turnCount, totalCost: Math.round(totalCost * 10000) / 10000, lastUserMessage: lastUserMessage, status: session.status || 'open' };
        if (session.projectPath) {
          if (!sessionsByProject[session.projectPath]) sessionsByProject[session.projectPath] = [];
          sessionsByProject[session.projectPath].push(s);
        } else {
          looseSessions.push(s);
        }
      });

      var areas = [];
      for (var aIdx = 0; aIdx < areaDirs.length; aIdx++) {
        var areaName = areaDirs[aIdx];
        var areaDir = path.join(gtdPath, areaName);
        var docPath = path.join(areaDir, areaName + ".md");
        var presentState = "";
        var desiredState = "";
        try {
          var doc = await fs.promises.readFile(docPath, "utf8");
          var psMatch = doc.match(/\*\*Present State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Desired State|\*\*Test|\*\*Operations|\*\*Exit)/i);
          if (psMatch) presentState = psMatch[1].trim().split("\n").slice(0, 3).join(" ").substring(0, 200);
          var dsMatch = doc.match(/\*\*Desired State[^*]*\*\*:?\s*([\s\S]*?)(?=\*\*Test|\*\*Operations|\*\*Exit)/i);
          if (dsMatch) desiredState = dsMatch[1].trim().split("\n").slice(0, 3).join(" ").substring(0, 200);
        } catch(e) { console.warn("[http] Failed to read area doc:", docPath, e.message); }

        var projectsDir = path.join(areaDir, "01-projects");
        var projects = [];
        try {
          var entries = await fs.promises.readdir(projectsDir);
          for (var pi = 0; pi < entries.length; pi++) {
            var entry = entries[pi];
            if (entry.startsWith("_") || entry.startsWith(".")) continue;
            var entryPath = path.join(projectsDir, entry);
            var projectPath = areaName + "/01-projects/" + entry;
            var stat;
            try { stat = await fs.promises.stat(entryPath); } catch(e) { console.warn("[http] stat failed:", entryPath, e.message); continue; }
            if (stat.isDirectory()) {
              var subProjects = [];
              try {
                var subs = await fs.promises.readdir(entryPath);
                for (var si = 0; si < subs.length; si++) {
                  var subName = subs[si];
                  var subFullPath = path.join(entryPath, subName);
                  try {
                    var subStat = await fs.promises.stat(subFullPath);
                    if (subStat.isDirectory()) {
                      var subPath = projectPath + "/" + subName;
                      subProjects.push({ name: subName, path: subPath, sessions: sessionsByProject[subPath] || [] });
                    }
                  } catch(e) { console.warn("[http] stat failed for sub-project:", subFullPath, e.message); }
                }
              } catch(e) { console.warn("[http] readdir failed for project dir:", entryPath, e.message); }
              projects.push({ name: entry, path: projectPath, isDir: true, subProjects: subProjects, sessions: sessionsByProject[projectPath] || [] });
            } else if (entry.endsWith(".md")) {
              projects.push({ name: entry.replace(/\.md$/, ""), path: projectPath, isDir: false, subProjects: [], sessions: sessionsByProject[projectPath] || [] });
            }
          }
        } catch(e) { console.warn("[http] readdir failed for 01-projects:", projectsDir, e.message); }

        var hasInbox = false;
        try { await fs.promises.access(path.join(areaDir, "inbox.md")); hasInbox = true; } catch(e) { /* expected: inbox.md may not exist */ }

        var operations = [];
        var opsDir = path.join(areaDir, "02-operations");
        try {
          var opEntries = await fs.promises.readdir(opsDir);
          for (var oi = 0; oi < opEntries.length; oi++) {
            var opName = opEntries[oi];
            if (opName.startsWith(".")) continue;
            var opPath = path.join(opsDir, opName);
            var opStat;
            try { opStat = await fs.promises.stat(opPath); } catch(e) { console.warn("[http] stat failed for operation:", opPath, e.message); continue; }
            var isDir = opStat.isDirectory();
            var opDescription = "";
            var opDocs = [];
            var opDisplayName = opName;
            if (isDir) {
              try {
                var opFiles = await fs.promises.readdir(opPath);
                for (var of2 = 0; of2 < opFiles.length; of2++) {
                  if (opFiles[of2].startsWith(".")) continue;
                  opDocs.push(opFiles[of2]);
                }
                var opDocPath = path.join(opPath, opName + ".md");
                try { await fs.promises.access(opDocPath); } catch(e) { /* expected: named doc may not exist */
                  var firstMd = opDocs.find(function(f) { return f.endsWith(".md"); });
                  if (firstMd) opDocPath = path.join(opPath, firstMd);
                  else opDocPath = null;
                }
                if (opDocPath) {
                  try {
                    var opDoc = await fs.promises.readFile(opDocPath, "utf8");
                    var opLines = opDoc.split("\n").filter(function(l) { return l.trim() && !l.startsWith("#") && !l.startsWith("---"); });
                    opDescription = opLines.slice(0, 3).join(" ").substring(0, 200);
                  } catch(e) { console.warn("[http] Failed to read operation doc:", opDocPath, e.message); }
                }
              } catch(e) { console.warn("[http] readdir failed for operation dir:", opPath, e.message); }
            } else if (opName.endsWith(".md")) {
              opDisplayName = opName.replace(/\.md$/, "");
              opDocs.push(opName);
              try {
                var opDoc = await fs.promises.readFile(opPath, "utf8");
                var opLines = opDoc.split("\n").filter(function(l) { return l.trim() && !l.startsWith("#") && !l.startsWith("---"); });
                opDescription = opLines.slice(0, 3).join(" ").substring(0, 200);
              } catch(e) { console.warn("[http] Failed to read operation file:", opPath, e.message); }
            } else {
              continue;
            }
            operations.push({ name: opDisplayName, description: opDescription, docs: opDocs, path: areaName + "/02-operations/" + opName });
          }
        } catch(e) { console.warn("[http] readdir failed for 02-operations:", opsDir, e.message); }

        for (var fi2 = 0; fi2 < projects.length; fi2++) {
          var proj = projects[fi2];
          if (proj.isDir) {
            var projFiles = [];
            try {
              var pf = await fs.promises.readdir(path.join(gtdPath, proj.path));
              for (var pfi = 0; pfi < pf.length; pfi++) {
                if (pf[pfi].startsWith(".")) continue;
                if (pf[pfi].endsWith(".md") || pf[pfi].endsWith(".json") || pf[pfi].endsWith(".yaml")) {
                  projFiles.push(pf[pfi]);
                }
              }
            } catch(e) { console.warn("[http] readdir failed for project files:", proj.path, e.message); }
            proj.files = projFiles;
          }
        }

        var areaSessions = sessionsByProject[areaName] || [];
        areas.push({ name: areaName, presentState: presentState, desiredState: desiredState, projects: projects, operations: operations, hasInbox: hasInbox, areaSessions: areaSessions });
      }

      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify({ areas: areas, looseSessions: looseSessions }));
      return true;
    }

    // Board: read a specific GTD file
    if (req.method === "GET" && urlPath.startsWith("/api/board/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var filePath = params.get("path");
      if (!filePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absPath = path.resolve(cwd, "gtd", filePath);
      if (!absPath.startsWith(path.resolve(cwd, "gtd"))) { res.writeHead(403); res.end("Access denied"); return true; }
      if (!absPath.endsWith(".md")) { res.writeHead(403); res.end("Only .md files"); return true; }
      try {
        var content = await fs.promises.readFile(absPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(content);
      } catch(e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Board: tag a session with a projectPath
    if (req.method === "POST" && urlPath === "/api/board/tag-session") {
      try {
        var body = await parseJsonBody(req);
        var sessionId = body.sessionId;
        var projectPath = body.projectPath || null;
        if (!sessionId) { res.writeHead(400); res.end('{"error":"missing sessionId"}'); return true; }
        var session = sm.sessions.get(sessionId);
        if (!session) { res.writeHead(404); res.end('{"error":"session not found"}'); return true; }
        session.projectPath = projectPath;
        await sm.saveSessionFile(session);
        sm.broadcastSessionList();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) { console.error("[project] tag-session error:", e.message || e); res.writeHead(400); res.end("Bad request"); }
      return true;
    }

    // Files: save file content
    if (req.method === "POST" && urlPath === "/api/files/save") {
      try {
        var body = await parseJsonBody(req);
        var filePath = body.path;
        var content = body.content;
        if (!filePath || content == null) { res.writeHead(400); res.end('{"error":"missing path or content"}'); return true; }
        var absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(path.resolve(cwd) + path.sep)) { res.writeHead(403); res.end('{"error":"access denied"}'); return true; }
        var ext = path.extname(absPath).toLowerCase();
        var allowedExts = [".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".js", ".ts", ".css", ".html", ".svelte"];
        if (!allowedExts.includes(ext)) { res.writeHead(403); res.end('{"error":"file type not allowed: ' + ext + '"}'); return true; }
        await fs.promises.writeFile(absPath, content, "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        console.log("[project] Saved file:", filePath);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    // Board: rename a session
    if (req.method === "POST" && urlPath === "/api/board/rename-session") {
      try {
        var body = await parseJsonBody(req);
        var sessionId = body.sessionId;
        var title = body.title;
        if (!sessionId || !title) { res.writeHead(400); res.end('{"error":"missing sessionId or title"}'); return true; }
        var session = sm.sessions.get(sessionId);
        if (!session) { res.writeHead(404); res.end('{"error":"session not found"}'); return true; }
        session.title = String(title).substring(0, 100);
        await sm.saveSessionFile(session);
        sm.broadcastSessionList();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) { console.error("[project] rename-session error:", e.message || e); res.writeHead(400); res.end("Bad request"); }
      return true;
    }

    // Board: proxy cards from strategy board API (avoids CORS)
    if (req.method === "GET" && urlPath === "/api/board-cards") {
      var boardUrl = ctx.boardApiUrl;
      if (!boardUrl) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
        return true;
      }
      try {
        var fetchUrl = boardUrl + "/api/cards";
        var resp = await fetch(fetchUrl);
        var data = await resp.text();
        res.writeHead(resp.status, { "Content-Type": "application/json" });
        res.end(data);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Board API unreachable: " + e.message }));
      }
      return true;
    }

    // Board: proxy single card detail from strategy board API
    if (req.method === "GET" && urlPath.startsWith("/api/board-cards/")) {
      var cardId = urlPath.substring("/api/board-cards/".length);
      var boardUrl = ctx.boardApiUrl;
      if (!boardUrl || !cardId) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"not found"}');
        return true;
      }
      try {
        var resp = await fetch(boardUrl + "/api/cards/" + cardId);
        var data = await resp.text();
        res.writeHead(resp.status, { "Content-Type": "application/json" });
        res.end(data);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Board API unreachable: " + e.message }));
      }
      return true;
    }

    // Board: proxy card link/unlink to strategy board API
    if ((req.method === "POST" || req.method === "DELETE") && urlPath.match(/^\/api\/board-cards\/\d+\/link$/)) {
      var cardIdMatch = urlPath.match(/^\/api\/board-cards\/(\d+)\/link$/);
      var boardUrl = ctx.boardApiUrl;
      if (!boardUrl || !cardIdMatch) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"not found"}');
        return true;
      }
      try {
        var body = await parseJsonBody(req);
        var resp = await fetch(boardUrl + "/api/cards/" + cardIdMatch[1] + "/link", {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        var data = await resp.text();
        res.writeHead(resp.status, { "Content-Type": "application/json" });
        res.end(data);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Board API unreachable: " + e.message }));
      }
      return true;
    }

    // Board: strategy data
    if (req.method === "GET" && urlPath === "/api/board/strategy") {
      var stratSessionsDir = path.join(cwd, "gtd", "strategy", "02-operations", "sessions");
      var goalsPath = path.join(cwd, "gtd", "strategy", "goals.md");
      var strategyPath = path.join(cwd, "gtd", "strategy", "strategy.md");
      var result = { gate: null, candidateName: null, sessionDate: null, nextReview: null, allocation: [], gaps: [], tests: [], oneSentence: null, lastReviewed: null };

      try {
        var allStratDirs = await fs.promises.readdir(stratSessionsDir);
        var sessionDirs = allStratDirs.filter(function (d) {
          return /^\d{4}-\d{2}-\d{2}/.test(d);
        }).sort();
        if (sessionDirs.length > 0) {
          var latestDir = sessionDirs[sessionDirs.length - 1];
          var dateMatch = latestDir.match(/^(\d{4}-\d{2}-\d{2})/);
          result.sessionDate = dateMatch ? dateMatch[1] : null;
          var summaryPath = path.join(stratSessionsDir, latestDir, "session-summary.md");
          try {
            var summary = await fs.promises.readFile(summaryPath, "utf8");
            var candMatch = summary.match(/\*\*Candidate [A-Z]:\s*"?([^"*\n]+)"?\*\*/);
            if (candMatch) result.candidateName = candMatch[1].trim();
            if (!result.candidateName) {
              var titleMatch = summary.match(/^#\s+Strategic Review Session.*?—\s*(.+)/m);
              if (titleMatch) result.candidateName = titleMatch[1].trim();
            }
            var nextMatch = summary.match(/\*?\*?[Nn]ext\s+(?:review|check)\*?\*?[:\s*]+(\d{4}-\d{2}-\d{2})/);
            if (nextMatch) result.nextReview = nextMatch[1];
            var selectionSection = summary.split(/## Selection/)[1];
            if (selectionSection) {
              var calvinSection = selectionSection.match(/### Calvin's allocation[\s\S]*?(?=###|$)/);
              var allocSource = calvinSection ? calvinSection[0] : selectionSection.split(/## /)[0];
              var allocLines = allocSource.match(/\|[^|]*\|\s*\*\*\d+%\*\*[^|]*\|[^|]*\|/g);
              if (allocLines) {
                for (var ai = 0; ai < allocLines.length; ai++) {
                  var trackMatch = allocLines[ai].match(/\|\s*\*\*([^*]+)\*\*\s*\|\s*\*\*(\d+)%\*\*/);
                  if (trackMatch) {
                    result.allocation.push({ track: trackMatch[1].trim(), percent: parseInt(trackMatch[2]) });
                  }
                }
              }
            }
            var gapSection = summary.match(/## Step 3: Gap Analysis[\s\S]*?(?=\n---|\n## )/);
            if (gapSection) {
              var gapRows = gapSection[0].split("\n").filter(function (line) {
                return line.startsWith("|") && !line.match(/^\|\s*[-]+/) && !line.match(/^\|\s*Area/);
              });
              for (var gi = 0; gi < gapRows.length; gi++) {
                var cells = gapRows[gi].split("|").map(function (c) { return c.trim(); }).filter(Boolean);
                if (cells.length >= 5) {
                  var rawUrgency = cells[4].replace(/\*\*/g, "").trim();
                  var urgency = rawUrgency.split(/[\s(]/)[0];
                  result.gaps.push({ area: cells[0], present: cells[1], desired: cells[2], gap: cells[3].replace(/\*\*/g, "").trim(), urgency: urgency });
                }
              }
            }
            var testsSection = summary.match(/### Tests[^\n]*\n[\s\S]*?\n\n/);
            if (testsSection) {
              var testLines = testsSection[0].match(/\|\s*[^|]+\?\s*\|[^|]*\|/g);
              if (testLines) {
                for (var ti = 0; ti < testLines.length; ti++) {
                  var testMatch = testLines[ti].match(/\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
                  if (testMatch) {
                    result.tests.push({ label: testMatch[1].trim(), evidence: testMatch[2].trim() });
                  }
                }
              }
            }
            var oneMatch = summary.match(/## The one-sentence version\s*\n+\*\*([^*]+)\*\*/);
            if (oneMatch) result.oneSentence = oneMatch[1].trim();
          } catch (e) { console.warn("[http] Failed to read strategy session summary:", e.message); }
        }
      } catch (e) { console.warn("[http] Failed to scan strategy sessions dir:", e.message); }

      try {
        var goalsContent = await fs.promises.readFile(goalsPath, "utf8");
        var gateMatch = goalsContent.match(/## Current Focus\s*\n+\*\*([^*]+)\*\*/);
        if (gateMatch) result.gate = gateMatch[1].trim();
      } catch (e) { console.warn("[http] Failed to read goals.md:", e.message); }

      try {
        var stratContent = await fs.promises.readFile(strategyPath, "utf8");
        var reviewedMatch = stratContent.match(/## Last Reviewed\s*\n+(\d{4}-\d{2}-\d{2})/);
        if (reviewedMatch) result.lastReviewed = reviewedMatch[1];
      } catch (e) { console.warn("[http] Failed to read strategy.md:", e.message); }

      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify(result));
      return true;
    }

    // Board: cockpit state
    if (urlPath === "/api/board/cockpit-state") {
      if (req.method === "GET") {
        try {
          var cockpitStatePath = path.join(cwd, "gtd", "strategy", "cockpit-state.json");
          var stateContent = await fs.promises.readFile(cockpitStatePath, "utf8");
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
          res.end(stateContent);
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"sessionDate":null,"testStatus":{},"notes":[]}');
        }
        return true;
      }
      if (req.method === "POST") {
        try {
          var body = await parseJsonBody(req);
          var cockpitStatePath = path.join(cwd, "gtd", "strategy", "cockpit-state.json");
          await fs.promises.writeFile(cockpitStatePath, JSON.stringify(body, null, 2));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) { console.error("[project] cockpit-state error:", e.message || e); res.writeHead(400); res.end("Bad request"); }
        return true;
      }
    }

    // Agent task endpoints
    if (req.method === "GET" && urlPath === "/api/agent/tasks") {
      var taskList = Object.keys(agentTasks.TASKS).map(function (k) {
        return { id: k, description: agentTasks.TASKS[k].description };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tasks: taskList, running: agentTasks.getRunningTask() }));
      return true;
    }

    if (req.method === "GET" && urlPath.startsWith("/api/agent/task-prompt")) {
      var taskParam = new URL(req.url, "http://x").searchParams.get("task");
      var taskDef = taskParam && agentTasks.TASKS[taskParam];
      if (!taskDef) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown task: " + taskParam }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ task: taskParam, prompt: taskDef.prompt + "\n" + taskDef.outputInstruction }));
      return true;
    }

    if (req.method === "POST" && urlPath === "/api/agent/run") {
      try {
        var body = await parseJsonBody(req);
        var taskName = body.task;
        if (!taskName || !agentTasks.TASKS[taskName]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown task: " + taskName }));
          return true;
        }
        if (agentTasks.isRunning()) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Task already running: " + agentTasks.getRunningTask() }));
          return true;
        }
        var runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
        ctx.send({ type: "agent_task_start", runId: runId, task: taskName });
        agentTasks.runAgentTask(taskName, {
          cwd: cwd,
          getSDK: getSDK,
          onProgress: function (evt) { ctx.send({ type: "agent_task_progress", runId: runId, event: evt }); },
          onComplete: function (result) { ctx.send({ type: "agent_task_done", runId: runId, task: taskName, data: result.data }); },
        }).catch(function (e) {
          console.log("[agent] Task error:", e.message);
          ctx.send({ type: "agent_task_error", runId: runId, error: e.message });
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, runId: runId, task: taskName }));
      } catch (e) { console.error("[project] agent-run error:", e.message || e); res.writeHead(400); res.end("Bad request"); }
      return true;
    }

    // Session messages endpoint
    if (req.method === "GET" && urlPath.startsWith("/api/sessions/") && urlPath.includes("/messages")) {
      var sessionIdMatch = urlPath.match(/\/api\/sessions\/([^/]+)\/messages/);
      if (sessionIdMatch) {
        var targetId = decodeURIComponent(sessionIdMatch[1]);
        var targetSession = sm.sessions.get(targetId);
        if (!targetSession) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"session not found"}');
          return true;
        }
        var msgLimit = 50;
        var qIdx = urlPath.indexOf("?");
        if (qIdx !== -1) {
          var params = new URLSearchParams(urlPath.substring(qIdx));
          if (params.get("limit")) msgLimit = parseInt(params.get("limit")) || 50;
        }
        var messages = [];
        var history = targetSession.history || [];
        var startIdx = Math.max(0, history.length - msgLimit * 3);
        for (var hi = startIdx; hi < history.length; hi++) {
          var h = history[hi];
          if (h.type === "user_message") {
            messages.push({ type: "user", text: h.text || "" });
          } else if (h.type === "delta" || h.type === "assistant_delta") {
            var lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.type === "assistant") {
              lastMsg.text += (h.text || h.delta || "");
            } else {
              messages.push({ type: "assistant", text: h.text || h.delta || "" });
            }
          } else if (h.type === "tool_start") {
            messages.push({ type: "tool", name: h.name || h.toolName || "tool" });
          } else if (h.type === "result" || h.type === "done") {
            var lastA = messages[messages.length - 1];
            if (lastA && lastA.type === "assistant") lastA.done = true;
          }
        }
        if (messages.length > msgLimit) messages = messages.slice(-msgLimit);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
        res.end(JSON.stringify({ sessionId: targetId, title: targetSession.title || "", messages: messages }));
        return true;
      }
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ cwd: cwd, project: ctx.project, slug: ctx.slug }));
      return true;
    }

    return false;
  };
}

module.exports = { createHTTPHandler };
