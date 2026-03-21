var fs = require("fs");
var path = require("path");
var { execFile } = require("child_process");
var { promisify } = require("util");

var execFileAsync = promisify(execFile);

function safePath(base, requested) {
  var resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    var lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) return null;
  } catch (e) { /* new file, doesn't exist yet — OK */ }
  try {
    var real = fs.realpathSync(resolved);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

function expandSlashCommand(text, projectPath) {
  if (!text || !text.startsWith("/")) return text;
  var match = text.match(/^\/(\S+)\s*(.*)?$/s);
  if (!match) return text;
  var cmdName = match[1];
  var args = (match[2] || "").trim();

  if (["help", "clear", "exit", "quit", "compact", "fast"].indexOf(cmdName) !== -1) return text;

  var cmdPath = path.join(projectPath, ".claude", "commands", cmdName + ".md");
  try {
    if (!fs.existsSync(cmdPath)) return text;
    var template = fs.readFileSync(cmdPath, "utf8");
    var expanded = template.replace(/\$ARGUMENTS/g, args || "(none)");
    console.log("[cmd] Expanded /" + cmdName + " → " + expanded.length + " chars");
    return expanded;
  } catch (e) {
    return text;
  }
}

function parseJsonBody(req) {
  var MAX_BODY_SIZE = 1024 * 1024;
  var TIMEOUT_MS = 10000;
  return new Promise(function (resolve, reject) {
    var body = "";
    var size = 0;
    var timer = setTimeout(function () {
      req.destroy();
      var err = new Error("Request timeout");
      err.statusCode = 408;
      reject(err);
    }, TIMEOUT_MS);
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        clearTimeout(timer);
        var err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on("end", function () {
      clearTimeout(timer);
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on("error", function (e) {
      clearTimeout(timer);
      reject(e);
    });
  });
}

module.exports = { execFileAsync, safePath, expandSlashCommand, parseJsonBody };
