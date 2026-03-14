// Session settings — per-session SDK parameters (effort level)
// Sent to server on change. Server merges into sdk.query() options.

import { send } from './ws.svelte.js';

// Global defaults (applied to all new sessions)
export let sessionSettings = $state({
  effort: '',          // '' = default (SDK decides), 'low', 'medium', 'high', 'max'
});

// Push current settings to server
export function sendSettings() {
  send({ type: 'session_settings', effort: sessionSettings.effort || null });
}
