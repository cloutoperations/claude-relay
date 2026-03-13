#!/usr/bin/env node
// Opens a persistent browser window for dev testing.
// Run: node dev-browser.mjs
// Screenshot on demand: touch /tmp/relay-test/capture to trigger one

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';

const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173';
const outDir = '/tmp/relay-test';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false, args: ['--window-size=1280,900'] });
const context = await browser.newContext({ viewport: null }); // null = follow window size
const page = await context.newPage();

// Capture console errors
const errors = [];
page.on('console', msg => {
  const line = `[${msg.type()}] ${msg.text()}`;
  errors.push(line);
  if (msg.type() === 'error') console.log(line);
});
page.on('pageerror', err => {
  errors.push(`[CRASH] ${err.message}`);
  console.log(`[CRASH] ${err.message}`);
});

// On-demand screenshot: touch /tmp/relay-test/capture to trigger
setInterval(async () => {
  if (existsSync(`${outDir}/capture`)) {
    try { unlinkSync(`${outDir}/capture`); } catch {}
    try {
      await page.screenshot({ path: `${outDir}/screenshot.png`, fullPage: false });
      writeFileSync(`${outDir}/console.log`, errors.join('\n'));
      console.log('Screenshot captured');
    } catch {}
  }
}, 500);

console.log(`Opening ${url}...`);
console.log('Browser is open. Touch /tmp/relay-test/capture for a screenshot.');
console.log('Press Ctrl+C to close.');

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

// Keep alive
await new Promise(() => {});
