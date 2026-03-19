#!/usr/bin/env node
// Diagnostic: test cross-project session search for e032319a
// Connects via WS to the daemon and sends a search_sessions message directly.

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const PROJECT_SLUG = 'clout-operations';
const SEARCH_QUERY = 'e032319a';

// Connect via Vite proxy (handles auth automatically)
async function test() {
  const wsUrl = `ws://localhost:5173/p/${PROJECT_SLUG}/ws`;
  console.log(`Connecting to ${wsUrl}...`);

  const ws = new WebSocket(wsUrl);

  let gotInfo = false;
  let gotResults = false;

  ws.on('open', () => {
    console.log('WS connected\n');
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // Log the info message to see project list
    if (msg.type === 'info' && !gotInfo) {
      gotInfo = true;
      console.log('=== INFO MESSAGE ===');
      console.log('  project:', msg.project);
      console.log('  cwd:', msg.cwd);
      console.log('  slug:', msg.slug);
      console.log('  projectCount:', msg.projectCount);
      console.log('  projects:', JSON.stringify(msg.projects, null, 4));
      console.log('');

      // Now send search
      console.log(`=== SENDING SEARCH: "${SEARCH_QUERY}" ===`);
      ws.send(JSON.stringify({ type: 'search_sessions', query: SEARCH_QUERY }));
    }

    // Log search results
    if (msg.type === 'search_results' && !gotResults) {
      gotResults = true;
      console.log('\n=== SEARCH RESULTS ===');
      console.log('  query:', msg.query);
      console.log('  count:', (msg.results || []).length);
      if (msg.results && msg.results.length > 0) {
        for (const r of msg.results) {
          console.log(`  - ${r.id} "${r.title}" matchType=${r.matchType} archived=${r.archived || false} crossProject=${r.crossProject || 'none'}`);
        }
      } else {
        console.log('  NO RESULTS');
      }
      console.log('');

      // Also search for "Reddit" to test title search
      console.log('=== SENDING SEARCH: "Reddit Rebuild" ===');
      ws.send(JSON.stringify({ type: 'search_sessions', query: 'Reddit Rebuild', _searchSeq: 2 }));
    }

    if (msg.type === 'search_results' && gotResults && msg.query === 'Reddit Rebuild') {
      console.log('\n=== SEARCH RESULTS (Reddit Rebuild) ===');
      console.log('  count:', (msg.results || []).length);
      if (msg.results && msg.results.length > 0) {
        for (const r of msg.results) {
          console.log(`  - ${r.id} "${r.title}" matchType=${r.matchType} archived=${r.archived || false} crossProject=${r.crossProject || 'none'}`);
        }
      } else {
        console.log('  NO RESULTS');
      }

      // Done
      ws.close();
    }
  });

  ws.on('error', (e) => {
    console.error('WS error:', e.message);
  });

  ws.on('close', (code) => {
    console.log(`\nWS closed (code ${code})`);
    process.exit(0);
  });

  // Timeout after 10s
  setTimeout(() => {
    console.log('\nTimeout — closing');
    ws.close();
  }, 10000);
}

test();
