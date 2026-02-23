export function miniClaudeSvg(size) {
  var s = size || 20;
  var g = [
    [0,0,0,0,0,3,3,0,0,0,0,0],
    [0,0,0,0,0,3,3,0,0,0,0,0],
    [0,0,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,2,1,1,1,1,2,1,0,0],
    [0,0,1,2,1,1,1,1,2,1,0,0],
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [0,0,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,0,1,0,0,1,0,1,0,0],
    [0,0,1,0,1,0,0,1,0,1,0,0],
  ];
  var colors = { 1: "#DA7756", 2: "#2F2E2B", 3: "#E8E5DE" };
  var rects = "";
  for (var r = 0; r < g.length; r++) {
    for (var c = 0; c < g[r].length; c++) {
      if (g[r][c]) rects += '<rect x="' + c + '" y="' + r + '" width="1" height="1" fill="' + colors[g[r][c]] + '"/>';
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="' + s + '" height="' + s + '" style="flex-shrink:0;image-rendering:pixelated">' + rects + '</svg>';
}

export function showToast(message, level, detail, iconHtmlStr) {
  var el = document.createElement("div");
  el.className = "toast";
  if (level) el.classList.add("toast-" + level);
  if (iconHtmlStr) {
    el.innerHTML = iconHtmlStr + '<span>' + message.replace(/</g, "&lt;") + '</span>';
  } else {
    el.textContent = message;
  }
  if (detail) {
    var detailEl = document.createElement("div");
    detailEl.style.cssText = "font-size:11px;opacity:0.7;margin-top:4px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    detailEl.textContent = detail.split("\n")[0];
    el.appendChild(detailEl);
  }
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.classList.add("visible"); });
  var duration = level === "warn" ? 5000 : 1500;
  setTimeout(function () {
    el.classList.remove("visible");
    setTimeout(function () { el.remove(); }, 300);
  }, duration);
}

var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function copyToClipboard(text) {
  var p;
  if (isIOS) {
    // iOS Safari URL-encodes clipboard text that contains colons via the
    // Clipboard API. Use textarea + execCommand to copy raw text instead.
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    document.execCommand("copy");
    document.body.removeChild(ta);
    p = Promise.resolve();
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    p = navigator.clipboard.writeText(text);
  } else {
    var ta2 = document.createElement("textarea");
    ta2.value = text;
    ta2.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta2);
    ta2.focus();
    ta2.setSelectionRange(0, ta2.value.length);
    document.execCommand("copy");
    document.body.removeChild(ta2);
    p = Promise.resolve();
  }
  return p.then(function () { showToast("Copied to clipboard"); });
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
