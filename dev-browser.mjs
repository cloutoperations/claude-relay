#!/usr/bin/env node
// CDP dev browser — launches Chrome with remote debugging port.
// Auto-reloads on dist/ changes. Console errors printed to stdout.
// Claude queries the DOM directly via CDP (http://127.0.0.1:9200/json).
//
// Usage:
//   node dev-browser.mjs                — launch Chrome and connect
//   node dev-browser.mjs --attach       — attach to already-running Chrome
//   node dev-browser.mjs --port 9333    — use a different debugging port

import { spawn } from 'child_process';
import { existsSync, mkdirSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import WebSocket from 'ws';

// --- Config ---
const DEFAULT_PORT = 9200;
const portArg = process.argv.indexOf('--port');
const CDP_PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1]) : DEFAULT_PORT;
const ATTACH_ONLY = process.argv.includes('--attach');
const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:2680';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA_DIR = join(process.env.HOME, '.claude-relay', 'chrome-dev');

mkdirSync(USER_DATA_DIR, { recursive: true });

// --- State ---
let ws = null;
let msgId = 0;
const pending = new Map();

// --- CDP helpers ---
function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function waitForChrome(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const data = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
      JSON.parse(data);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`Chrome not responding on port ${CDP_PORT} after ${maxWait}ms`);
}

// --- Launch Chrome ---
if (!ATTACH_ONLY) {
  console.log(`Launching Chrome with --remote-debugging-port=${CDP_PORT}...`);
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  chromeProc.unref();
  console.log(`Chrome PID: ${chromeProc.pid}`);
} else {
  console.log(`Attaching to Chrome on port ${CDP_PORT}...`);
}

// --- Connect ---
await waitForChrome();

const tabsJson = await httpGet(`http://127.0.0.1:${CDP_PORT}/json`);
const tabs = JSON.parse(tabsJson);
let target = tabs.find(t => t.type === 'page' && t.url.includes('localhost')) || tabs.find(t => t.type === 'page');
if (!target) {
  console.error('No page target found. Tabs:', tabs.map(t => t.url));
  process.exit(1);
}

console.log(`Connected to: ${target.url}`);

ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
});

// Handle CDP messages
ws.on('message', raw => {
  const msg = JSON.parse(raw);

  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, timeout } = pending.get(msg.id);
    clearTimeout(timeout);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }

  // Print console errors to stdout
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    const level = msg.params.type;
    if (level === 'error' || level === 'warning') console.log(`[${level}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const desc = msg.params.exceptionDetails?.exception?.description || 'unknown';
    console.log(`[EXCEPTION] ${desc}`);
  }
});

// Enable CDP domains
await cdpSend('Runtime.enable');
await cdpSend('Console.enable');
await cdpSend('Network.enable');
await cdpSend('Page.enable');

console.log('CDP ready');

// --- Auto-reload on dist/ changes ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'svelte-frontend', 'dist');
let reloadDebounce = null;

if (existsSync(distDir)) {
  watch(distDir, { recursive: true }, (event, filename) => {
    if (reloadDebounce) clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(async () => {
      console.log(`[reload] ${filename} changed`);
      try {
        await cdpSend('Page.reload', { ignoreCache: true });
      } catch (e) {
        console.error('[reload error]', e.message);
      }
    }, 500);
  });
  console.log('Watching dist/ for auto-reload');
}

console.log(`\nChrome CDP on :${CDP_PORT} → ${target.url}`);
console.log('Ctrl+C to disconnect. Chrome stays open.\n');

// Cleanup
ws.on('close', () => {
  console.log('\nChrome disconnected.');
  process.exit(0);
});

process.on('SIGINT', () => {
  ws.close();
  console.log('\nDisconnected. Chrome stays open.');
  process.exit(0);
});
