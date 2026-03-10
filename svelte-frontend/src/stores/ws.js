// WebSocket connection store
import { writable, get } from 'svelte/store';

export const connected = writable(false);
export const wsError = writable(null);

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let messageHandlers = [];

// Derive WS path from current URL (supports multi-project /p/slug/ routing)
// In dev mode (Vite on :5173), Vite proxies /p/... to the relay server.
function getWsUrl() {
  var loc = window.location;
  var proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';

  // Vite dev — proxy through Vite to relay
  if (loc.port === '5173') {
    return proto + '//' + loc.host + '/p/code/ws';
  }

  var slugMatch = loc.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var wsPath = slugMatch ? '/p/' + slugMatch[1] + '/ws' : '/ws';
  return proto + '//' + loc.host + wsPath;
}

export function getBasePath() {
  if (location.port === '5173') {
    return '/p/code/';
  }
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  return slugMatch ? '/p/' + slugMatch[1] + '/' : '/';
}

export function onMessage(handler) {
  messageHandlers.push(handler);
  return () => {
    messageHandlers = messageHandlers.filter(h => h !== handler);
  };
}

export function send(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

export function connect() {
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    connected.set(true);
    wsError.set(null);
    reconnectDelay = 1000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Dispatch a synthetic open event
    dispatch({ type: '__ws_open' });
  };

  ws.onclose = () => {
    connected.set(false);
    dispatch({ type: '__ws_close' });
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    wsError.set('Connection error');
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    dispatch(msg);
  };
}

function dispatch(msg) {
  for (let i = 0; i < messageHandlers.length; i++) {
    try { messageHandlers[i](msg); } catch (e) { console.error('[ws dispatch]', e); }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
