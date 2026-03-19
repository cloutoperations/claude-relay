#!/usr/bin/env node
// Heal sessions: connect to running daemon, find sessions missing JSONL files,
// capture their history via WS replay, and write proper JSONL files.

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const PROJECT_SLUG = 'clout-operations';
const SESSIONS_DIR = '/Users/backstage/WebstormProjects/clout-operations/.claude-relay/sessions';

// Get list of session IDs already on disk
function getExistingSessionIds() {
  const ids = new Set();
  try {
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (f.endsWith('.jsonl')) ids.add(f.replace('.jsonl', ''));
    }
  } catch {}
  // Also check _old_versions
  try {
    for (const f of fs.readdirSync(path.join(SESSIONS_DIR, '_old_versions'))) {
      if (f.endsWith('.jsonl')) ids.add(f.replace('.jsonl', ''));
    }
  } catch {}
  return ids;
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:5173/p/${PROJECT_SLUG}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, predicate, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

function collectHistory(ws, sessionId) {
  return new Promise((resolve, reject) => {
    const history = [];
    let meta = null;
    const timer = setTimeout(() => {
      console.log(`  Timeout collecting history for ${sessionId.substring(0, 11)}, got ${history.length} entries`);
      resolve({ meta, history });
    }, 15000);

    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'session_switched') {
          // Starting history replay
        } else if (msg.type === 'history_start') {
          // History replay beginning
        } else if (msg.type === 'history_done') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve({ meta, history });
        } else if (msg.type === 'session_list') {
          // Ignore
        } else if (msg.type === 'info') {
          // Could be session info or chat info, capture both
          if (msg.cwd) {
            // Project info, skip
          } else {
            history.push(msg);
          }
        } else {
          // Everything else is history
          history.push(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

function writeSessionFile(sessionId, title, history, createdAt) {
  const metaObj = {
    type: 'meta',
    cliSessionId: sessionId,
    title: title || 'Recovered Session',
    createdAt: createdAt || Date.now(),
    status: 'expired',
  };
  const lines = [JSON.stringify(metaObj)];
  for (const entry of history) {
    lines.push(JSON.stringify(entry));
  }
  const fp = path.join(SESSIONS_DIR, sessionId + '.jsonl');
  fs.writeFileSync(fp, lines.join('\n') + '\n');
  return fp;
}

async function main() {
  const existingIds = getExistingSessionIds();
  console.log(`Existing session files on disk: ${existingIds.size}`);

  // Connect and get session list
  const ws = connect();
  const ws1 = await ws;
  console.log('Connected to relay\n');

  // Collect the session list from the info message
  const sessions = [];
  const infoPromise = new Promise((resolve) => {
    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'session_list') {
          ws1.removeListener('message', handler);
          resolve(msg.sessions || []);
        }
      } catch {}
    }
    ws1.on('message', handler);
  });

  const sessionList = await Promise.race([
    infoPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('No session_list received')), 10000)),
  ]);

  console.log(`Sessions in daemon memory: ${sessionList.length}`);

  // Find missing sessions
  const missing = sessionList.filter(s => !existingIds.has(s.id) && !existingIds.has(s.cliSessionId));
  console.log(`Sessions missing JSONL files: ${missing.length}\n`);

  if (missing.length === 0) {
    console.log('All sessions have files on disk. Nothing to heal.');
    ws1.close();
    return;
  }

  for (const s of missing) {
    const sid = s.id || s.cliSessionId;
    console.log(`Healing: ${sid.substring(0, 11)} "${(s.title || '').substring(0, 50)}"`);

    // Switch to session to trigger history replay
    ws1.send(JSON.stringify({ type: 'switch_session', sessionId: sid }));

    const { history } = await collectHistory(ws1, sid);
    console.log(`  Captured ${history.length} history entries`);

    if (history.length > 0) {
      // Extract title and createdAt from history if possible
      const title = s.title || 'Recovered Session';
      const firstTime = history[0] && history[0].timestamp ? history[0].timestamp : Date.now();
      const fp = writeSessionFile(sid, title, history, firstTime);
      console.log(`  Written to: ${fp}`);
    } else {
      console.log(`  Skipping — no history to save`);
    }
  }

  ws1.close();
  console.log('\nDone. All sessions healed.');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
