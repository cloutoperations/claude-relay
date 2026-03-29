// Ambient state store — tracks per-session status for rail/popups.
// No message handling — session-router updates us directly.

// Map of sessionId -> { status, permissionRequest, askUser, needsAttention, lastEventTime }
export let ambientState = $state({});

export function cleanupAmbient(sessionId) {
  delete ambientState[sessionId];
}

export function updateAmbient(sessionId, event) {
  const s = ambientState[sessionId] || {};

  if (event.type === 'status') s.status = event.status;
  else if (event.type === 'permission_request') { s.permissionRequest = event; s.needsAttention = true; }
  else if (event.type === 'done') { s.status = 'idle'; s.needsAttention = false; s.permissionRequest = null; s.askUser = null; }
  else if (event.type === 'ask_user') { s.askUser = event; s.needsAttention = true; }

  s.lastEventTime = Date.now();
  ambientState[sessionId] = s;
}
