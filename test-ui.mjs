#!/usr/bin/env node
// Quick UI test — opens the relay in a real browser, captures screenshot + console errors.
// Usage: node test-ui.mjs [url] [--headed]
//   url defaults to http://localhost:5173
//   --headed opens a visible browser window

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173';
const headed = process.argv.includes('--headed');
const outDir = '/tmp/relay-test';

try { (await import('fs')).mkdirSync(outDir, { recursive: true }); } catch {}

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// Collect console messages
const logs = [];
page.on('console', msg => {
  const type = msg.type();
  const text = msg.text();
  if (type === 'error' || type === 'warning') {
    logs.push(`[${type}] ${text}`);
  }
});

// Collect page errors (uncaught exceptions)
page.on('pageerror', err => {
  logs.push(`[CRASH] ${err.message}\n${err.stack || ''}`);
});

console.log(`Opening ${url}...`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(e => {
  logs.push(`[NAVIGATION] ${e.message}`);
});

// Wait for app to settle
await page.waitForTimeout(3000);

// Take screenshot
const screenshotPath = `${outDir}/screenshot.png`;
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log(`Screenshot: ${screenshotPath}`);

// Dump console errors
const logPath = `${outDir}/console.log`;
writeFileSync(logPath, logs.join('\n') || '(no errors)');
console.log(`Console log: ${logPath}`);
console.log(`\n--- ${logs.length} console errors/warnings ---`);
for (const l of logs) console.log(l);

// Get page title and visible text summary
const title = await page.title();
const bodyText = await page.evaluate(() => {
  const el = document.querySelector('#app');
  return el ? el.innerText.substring(0, 500) : '(no #app element)';
});
console.log(`\nTitle: ${title}`);
console.log(`Visible text:\n${bodyText.substring(0, 300)}`);

await browser.close();
