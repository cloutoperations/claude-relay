// WebSocket connection store — Svelte 5 runes
// Single source of truth for WS state. No handler arrays.
//
// Exported state uses object wrappers because Svelte 5 doesn't allow
// exporting $state that gets reassigned. Components read wsState.connected, etc.

let ws = $state(null);
let reconnectTimer = null;
let reconnectDelay = 1000;

export const wsState = $state({
  connected: false,
  error: null,
  incoming: null,
});

// Message callback — set by session-router, called on every WS message.
// This replaces the $effect pattern which caused effect_update_depth_exceeded.
let _onMessage = null;
export function setOnMessage(fn) { _onMessage = fn; }

// Convenience aliases for internal use
function setConnected(v) { wsState.connected = v; }
function setError(v) { wsState.error = v; }
function setIncoming(v) { wsState.incoming = v; if (_onMessage) _onMessage(v); }

// Derive WS path from current URL (supports multi-project /p/slug/ routing)
function getWsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';

  // Vite dev — proxy through Vite to relay
  if (loc.port === '5173') {
    return proto + '//' + loc.host + '/p/clout-operations/ws';
  }

  const slugMatch = loc.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  const wsPath = slugMatch ? '/p/' + slugMatch[1] + '/ws' : '/ws';
  return proto + '//' + loc.host + wsPath;
}

export function getBasePath() {
  if (location.port === '5173') {
    return '/p/clout-operations/';
  }
  const slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  return slugMatch ? '/p/' + slugMatch[1] + '/' : '/';
}

export function send(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  } else if (typeof obj === 'object' && obj.type) {
    console.warn('[ws] Dropped message (not connected):', obj.type);
  }
}

export function connect(sessionId) {
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  let url = getWsUrl();
  if (sessionId) url += (url.includes('?') ? '&' : '?') + 's=' + sessionId;
  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnected(true);
    setError(null);
    reconnectDelay = 1000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Synthetic open event for reconnect handling
    setIncoming({ type: '__ws_open', _ts: Date.now() });
  };

  ws.onclose = () => {
    setConnected(false);
    setIncoming({ type: '__ws_close', _ts: Date.now() });
    scheduleReconnect();
  };

  ws.onerror = () => {
    setError('Connection error');
  };

  ws.onmessage = (event) => {
    try {
      setIncoming(JSON.parse(event.data));
    } catch (e) {}
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
