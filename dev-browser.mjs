#!/usr/bin/env node
// Persistent dev browser — state (localStorage, tabs) survives between runs.
// Both user and Claude see the same browser.
//
// Usage:
//   node dev-browser.mjs           — open with saved state
//   node dev-browser.mjs --reset   — clear state and start fresh
//
// Claude reads state via:
//   cat /tmp/relay-test/dev-state.json     — current app state (updated every 3s)
//   /tmp/relay-test/dev-screenshot.png     — latest screenshot (updated every 3s)
//   touch /tmp/relay-test/capture          — force immediate capture
//
// The browser stays open until you close it or Ctrl+C.

import { chromium } from 'playwright';
import { existsSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173';
const USER_DATA_DIR = join(process.env.HOME, '.claude-relay', 'dev-browser');
const outDir = '/tmp/relay-test';
const SCREENSHOT_PATH = join(outDir, 'dev-screenshot.png');
const STATE_PATH = join(outDir, 'dev-state.json');
const CAPTURE_FLAG = join(outDir, 'capture');

// Reset if requested
if (process.argv.includes('--reset')) {
  if (existsSync(USER_DATA_DIR)) {
    rmSync(USER_DATA_DIR, { recursive: true });
    console.log('Browser state reset.');
  }
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'],
});

const page = browser.pages()[0] || await browser.newPage();

// Console error capture
const errors = [];
page.on('console', msg => {
  const line = `[${msg.type()}] ${msg.text()}`;
  errors.push(line);
  if (msg.type() === 'error' || msg.text().includes('[restore]') || msg.text().includes('[router]')) console.log(line);
});
page.on('pageerror', err => {
  const line = `[CRASH] ${err.message}`;
  errors.push(line);
  console.log(line);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

console.log('Dev browser open — ' + url);
console.log('User data: ' + USER_DATA_DIR);
console.log('State file: ' + STATE_PATH);
console.log('Screenshot: ' + SCREENSHOT_PATH);
console.log('');
console.log('Ctrl+C to close. --reset to clear state.');

// Dump state + screenshot
async function dumpState() {
  try {
    const state = await page.evaluate(() => ({
      url: location.href,
      tabs: Array.from(document.querySelectorAll('.tab-list .tab')).map(t => ({
        title: t.getAttribute('title'),
        active: t.classList.contains('active'),
      })),
      panes: Array.from(document.querySelectorAll('.pane')).map(p => ({
        loading: !!p.querySelector('.loading-history'),
        msgs: p.querySelectorAll('.msg-item').length,
      })),
      popups: Array.from(document.querySelectorAll('.chat-popup')).map(p => ({
        title: p.querySelector('.cp-title')?.innerText || '',
        msgs: p.querySelectorAll('.msg-item').length,
      })),
      connected: !!document.querySelector('[class*=connected]'),
      errors: [],
      localStorage: {
        tabs: localStorage.getItem('claude-relay-tabs')?.substring(0, 500) || null,
        panes: localStorage.getItem('claude-relay-panes')?.substring(0, 500) || null,
        popups: localStorage.getItem('claude-relay-popups')?.substring(0, 500) || null,
      },
    }));
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    await page.screenshot({ path: SCREENSHOT_PATH });
  } catch (e) {
    console.error('[dumpState error]', e.message);
  }
}

// Auto-dump every 3 seconds
const interval = setInterval(dumpState, 3000);

// On-demand capture and reload via touch files
const RELOAD_FLAG = join(outDir, 'reload');
setInterval(async () => {
  if (existsSync(CAPTURE_FLAG)) {
    try { unlinkSync(CAPTURE_FLAG); } catch {}
    await dumpState();
    writeFileSync(join(outDir, 'console.log'), errors.join('\n'));
    console.log('Captured on demand');
  }
  if (existsSync(RELOAD_FLAG)) {
    try { unlinkSync(RELOAD_FLAG); } catch {}
    console.log('Reloading page...');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await dumpState();
    console.log('Reloaded');
  }
}, 500);

// Cleanup on exit
browser.on('disconnected', () => {
  clearInterval(interval);
  console.log('\nBrowser closed.');
  process.exit(0);
});

process.on('SIGINT', async () => {
  clearInterval(interval);
  await dumpState();
  await browser.close();
  process.exit(0);
});
