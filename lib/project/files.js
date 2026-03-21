var fs = require("fs");
var path = require("path");
var { safePath } = require("./utils");
var { IGNORED_DIRS, BINARY_EXTS, IMAGE_EXTS, FS_MAX_SIZE } = require("./constants");

var MAX_WATCHERS = 50;
var FILE_INDEX_TTL = 15000;
var MAX_INDEX_DEPTH = 20;

function createFilesManager(cwd, send) {
  // --- Per-project state ---
  var fileWatcher = null;
  var watchedPath = null;
  var watchDebounce = null;
  var dirWatchers = {};
  var dirWatcherOrder = [];
  var _fileIndex = null;
  var _fileIndexTime = 0;
  var _fileIndexBuilding = false;

  // --- File watcher ---
  function startFileWatch(relPath) {
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (watchedPath === relPath) return;
    stopFileWatch();
    watchedPath = relPath;
    try {
      fileWatcher = fs.watch(absPath, function () {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(async function () {
          try {
            var stat = await fs.promises.stat(absPath);
            var ext = path.extname(absPath).toLowerCase();
            if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return;
            var content = await fs.promises.readFile(absPath, "utf8");
            send({ type: "fs_file_changed", path: relPath, content: content, size: stat.size });
          } catch (e) {
            stopFileWatch();
          }
        }, 200);
      });
      fileWatcher.on("error", function () { stopFileWatch(); });
    } catch (e) {
      watchedPath = null;
    }
  }

  function stopFileWatch() {
    if (fileWatcher) {
      try { fileWatcher.close(); } catch (e) {}
      fileWatcher = null;
    }
    clearTimeout(watchDebounce);
    watchDebounce = null;
    watchedPath = null;
  }

  // --- Directory watcher ---
  function startDirWatch(relPath) {
    if (dirWatchers[relPath]) return;
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (dirWatcherOrder.length >= MAX_WATCHERS) {
      var oldest = dirWatcherOrder.shift();
      stopDirWatch(oldest);
    }
    try {
      var watcherEntry = { watcher: null, debounce: null };
      var watcher = fs.watch(absPath, function () {
        clearTimeout(watcherEntry.debounce);
        watcherEntry.debounce = setTimeout(async function () {
          try {
            var items = await fs.promises.readdir(absPath, { withFileTypes: true });
            var entries = [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
              entries.push({
                name: items[i].name,
                type: items[i].isDirectory() ? "dir" : "file",
                path: path.relative(cwd, path.join(absPath, items[i].name)).split(path.sep).join("/"),
              });
            }
            send({ type: "fs_dir_changed", path: relPath, entries: entries });
            _fileIndex = null;
            _fileIndexTime = 0;
          } catch (e) {
            stopDirWatch(relPath);
          }
        }, 300);
      });
      watcher.on("error", function () { stopDirWatch(relPath); });
      watcherEntry.watcher = watcher;
      dirWatchers[relPath] = watcherEntry;
      dirWatcherOrder.push(relPath);
    } catch (e) { console.warn("[project] Dir watcher setup error:", e.message || e); }
  }

  function stopDirWatch(relPath) {
    var entry = dirWatchers[relPath];
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch (e) {}
      delete dirWatchers[relPath];
      var idx = dirWatcherOrder.indexOf(relPath);
      if (idx !== -1) dirWatcherOrder.splice(idx, 1);
    }
  }

  function stopAllDirWatches() {
    var paths = Object.keys(dirWatchers);
    for (var i = 0; i < paths.length; i++) {
      stopDirWatch(paths[i]);
    }
  }

  // --- Cached file index for search ---
  async function buildFileIndexAsync() {
    if (_fileIndexBuilding) return _fileIndex || [];
    _fileIndexBuilding = true;
    var entries = [];
    var stack = [{ dir: cwd, rel: "", depth: 0 }];
    while (stack.length > 0) {
      var item = stack.pop();
      if (item.depth > MAX_INDEX_DEPTH) continue;
      var items;
      try { items = await fs.promises.readdir(item.dir, { withFileTypes: true }); } catch (e) { continue; }
      for (var i = 0; i < items.length; i++) {
        var child = items[i];
        var rel = item.rel ? item.rel + "/" + child.name : child.name;
        if (child.isDirectory()) {
          if (IGNORED_DIRS.has(child.name)) continue;
          if (child.isSymbolicLink()) continue;
          stack.push({ dir: path.join(item.dir, child.name), rel: rel, depth: item.depth + 1 });
        } else {
          entries.push({ name: child.name, nameLower: child.name.toLowerCase(), path: rel });
        }
      }
    }
    _fileIndex = entries;
    _fileIndexTime = Date.now();
    _fileIndexBuilding = false;
    return entries;
  }

  function getFileIndex() {
    if (!_fileIndex || Date.now() - _fileIndexTime > FILE_INDEX_TTL) {
      buildFileIndexAsync();
    }
    return _fileIndex || [];
  }

  // Start background index build
  buildFileIndexAsync();

  // --- Message handlers ---
  var handlers = {
    async fs_list(ctx, ws, msg) {
      var fsDir = safePath(ctx.cwd, msg.path || ".");
      if (!fsDir) {
        ctx.sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return;
      }
      try {
        var items = await fs.promises.readdir(fsDir, { withFileTypes: true });
        var entries = [];
        for (var fi = 0; fi < items.length; fi++) {
          var item = items[fi];
          if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
          entries.push({
            name: item.name,
            type: item.isDirectory() ? "dir" : "file",
            path: path.relative(ctx.cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
          });
        }
        ctx.sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        startDirWatch(msg.path || ".");
      } catch (e) {
        ctx.sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
    },

    async fs_read(ctx, ws, msg) {
      var readPath = msg.path;
      try { readPath = decodeURIComponent(readPath); } catch (e) {}
      var fsFile = safePath(ctx.cwd, readPath);
      if (!fsFile) {
        var fileName = path.basename(readPath);
        var suffix = readPath;
        var suffixMatch = null;
        var nameMatch = null;
        async function findFile(dir, depth) {
          if (depth > 8 || suffixMatch) return;
          try {
            var entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (var ei = 0; ei < entries.length; ei++) {
              if (suffixMatch) return;
              var e = entries[ei];
              if (e.name.startsWith('.') || e.name === 'node_modules') continue;
              var full = path.join(dir, e.name);
              if (e.isDirectory()) {
                await findFile(full, depth + 1);
              } else if (e.name === fileName) {
                var rel = path.relative(ctx.cwd, full);
                if (rel.endsWith(suffix)) {
                  suffixMatch = full;
                } else if (!nameMatch) {
                  nameMatch = full;
                }
              }
            }
          } catch (err) {}
        }
        await findFile(ctx.cwd, 0);
        var found = suffixMatch || nameMatch;
        if (found) {
          fsFile = safePath(ctx.cwd, path.relative(ctx.cwd, found));
          if (fsFile) readPath = path.relative(ctx.cwd, found);
        }
      }
      if (!fsFile) {
        var testPath = path.resolve(ctx.cwd, readPath);
        try {
          await fs.promises.access(testPath);
          ctx.sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        } catch (e) {
          if (testPath.startsWith(ctx.cwd + path.sep)) {
            ctx.sendTo(ws, { type: "fs_read_result", path: msg.path, error: "File not found" });
          } else {
            ctx.sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
          }
        }
        return;
      }
      try {
        var stat = await fs.promises.stat(fsFile);
        if (stat.isDirectory()) {
          var dirEntries = await fs.promises.readdir(fsFile, { withFileTypes: true });
          var lines = ["# " + path.basename(fsFile), ""];
          var dirs = [], files = [];
          for (var ei = 0; ei < dirEntries.length; ei++) {
            if (dirEntries[ei].name.startsWith(".")) continue;
            if (dirEntries[ei].isDirectory()) dirs.push(dirEntries[ei].name);
            else files.push(dirEntries[ei].name);
          }
          dirs.sort(); files.sort();
          for (var di = 0; di < dirs.length; di++) lines.push("- 📁 `" + dirs[di] + "/`");
          for (var fi = 0; fi < files.length; fi++) lines.push("- `" + files[fi] + "`");
          var dirContent = lines.join("\n");
          var dirResult = { type: "fs_read_result", path: msg.path, content: dirContent, size: dirContent.length };
          if (readPath !== msg.path) dirResult.resolvedPath = readPath;
          ctx.sendTo(ws, dirResult);
          return;
        }
        var ext = path.extname(fsFile).toLowerCase();
        if (stat.size > FS_MAX_SIZE) {
          ctx.sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
          return;
        }
        if (BINARY_EXTS.has(ext)) {
          var result = { type: "fs_read_result", path: msg.path, binary: true, size: stat.size };
          if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
          ctx.sendTo(ws, result);
          return;
        }
        var content = await fs.promises.readFile(fsFile, "utf8");
        var result = { type: "fs_read_result", path: msg.path, content: content, size: stat.size };
        if (readPath !== msg.path) result.resolvedPath = readPath;
        ctx.sendTo(ws, result);
      } catch (e) {
        ctx.sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
    },

    async fs_search(ctx, ws, msg) {
      if (!_fileIndex || Date.now() - _fileIndexTime > FILE_INDEX_TTL) {
        await buildFileIndexAsync();
      }
      var query = (msg.query || "").trim().toLowerCase();
      if (!query) {
        ctx.sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: [] });
        return;
      }
      var fileIndex = getFileIndex();
      var searchResults = [];
      for (var si = 0; si < fileIndex.length; si++) {
        if (searchResults.length >= 50) break;
        if (fileIndex[si].nameLower.indexOf(query) !== -1) {
          searchResults.push({ name: fileIndex[si].name, path: fileIndex[si].path, type: "file" });
        }
      }
      searchResults.sort(function (a, b) {
        var aExact = a.name.toLowerCase() === query ? 0 : 1;
        var bExact = b.name.toLowerCase() === query ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.name.localeCompare(b.name);
      });
      ctx.sendTo(ws, { type: "fs_search_result", query: msg.query || "", results: searchResults });
    },

    async fs_watch(ctx, ws, msg) {
      if (msg.path) startFileWatch(msg.path);
    },

    async fs_unwatch(ctx, ws, msg) {
      stopFileWatch();
    },
  };

  return {
    handlers: handlers,
    destroy: function () {
      stopFileWatch();
      stopAllDirWatches();
    },
  };
}

module.exports = { createFilesManager: createFilesManager };
