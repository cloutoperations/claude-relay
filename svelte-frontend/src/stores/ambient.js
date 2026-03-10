// Ambient state store — tracks per-session status for rail/popups
import { writable, get } from 'svelte/store';
import { onMessage } from './ws.js';

// Map of sessionId -> { status, permissionRequest, askUser, needsAttention }
export const ambientState = writable({});

export function updateAmbient(sessionId, event) {
  ambientState.update(state => {
    const s = state[sessionId] || {};

    if (event.type === 'status') {
      s.status = event.status;
    } else if (event.type === 'permission_request') {
      s.permissionRequest = event;
      s.needsAttention = true;
    } else if (event.type === 'done') {
      s.status = 'idle';
      s.needsAttention = false;
      s.permissionRequest = null;
      s.askUser = null;
    } else if (event.type === 'ask_user') {
      s.askUser = event;
      s.needsAttention = true;
    }

    s.lastEventTime = Date.now();
    return { ...state, [sessionId]: s };
  });
}

// Listen for ambient broadcasts from server
onMessage((msg) => {
  if (msg.type === 'ambient') {
    updateAmbient(msg.sessionId, msg.event);
  }
});
