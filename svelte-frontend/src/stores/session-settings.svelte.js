// Session settings — per-session SDK parameters (effort level)
// Sent to server on change. Server merges into sdk.query() options.
// Persisted to localStorage so effort survives refresh.

import { send } from './ws.svelte.js';

const EFFORT_KEY = 'claude-relay-effort';

function loadEffort() {
  try { return localStorage.getItem(EFFORT_KEY) || ''; } catch { return ''; }
}

// Global defaults (applied to all new sessions)
export let sessionSettings = $state({
  effort: loadEffort(),  // '' = default (SDK decides), 'low', 'medium', 'high', 'max'
});

// Push current settings to server
export function sendSettings() {
  try { localStorage.setItem(EFFORT_KEY, sessionSettings.effort); } catch {}
  send({ type: 'session_settings', effort: sessionSettings.effort || null });
}
