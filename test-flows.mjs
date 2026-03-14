#!/usr/bin/env node
// Integration test — exercises key UI flows and captures state at each step.
// Usage: node test-flows.mjs [--headed]

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const url = 'http://localhost:5173';
const headed = process.argv.includes('--headed');
const outDir = '/tmp/relay-test';
mkdirSync(outDir, { recursive: true });

const logs = [];
let stepNum = 0;

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on('console', msg => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') {
    logs.push(`[${type}] ${msg.text()}`);
  }
});
page.on('pageerror', err => {
  logs.push(`[CRASH] ${err.message}`);
});

async function step(name, fn) {
  stepNum++;
  console.log(`\n=== Step ${stepNum}: ${name} ===`);
  try {
    await fn();
    await page.waitForTimeout(1500);
    const path = `${outDir}/step${stepNum}-${name.replace(/\s+/g, '-')}.png`;
    await page.screenshot({ path });
    console.log(`  Screenshot: ${path}`);
    const newErrors = logs.filter(l => l.includes('[CRASH]') || l.includes('[error]'));
    if (newErrors.length > 0) console.log(`  ERRORS:`, newErrors.slice(-3));
    else console.log(`  OK — no errors`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    const path = `${outDir}/step${stepNum}-FAILED.png`;
    await page.screenshot({ path }).catch(() => {});
  }
}

// --- Tests ---

await step('load app', async () => {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
});

await step('check sidebar sessions', async () => {
  // Click SESSIONS to expand
  const sessionsBtn = page.locator('text=SESSIONS').first();
  if (await sessionsBtn.isVisible()) {
    await sessionsBtn.click();
    await page.waitForTimeout(1000);
  }
});

await step('open first session', async () => {
  // Find a session in the sidebar and click it
  const sessionItems = page.locator('.session-item, .sidebar-session, [class*="session"]').first();
  if (await sessionItems.isVisible()) {
    await sessionItems.click();
  } else {
    // Try clicking any session-like element in the sidebar
    const sidebarLinks = page.locator('.sidebar-content a, .sidebar-content [onclick], .sidebar-content button').first();
    if (await sidebarLinks.isVisible()) await sidebarLinks.click();
    else console.log('  No session elements found to click');
  }
});

await step('check messages loaded', async () => {
  // Check if message list has content
  const msgCount = await page.locator('.msg-item, .message-list .msg-assistant, .message-list .msg-item').count();
  console.log(`  Message items in DOM: ${msgCount}`);

  // Check for loading indicator
  const loading = await page.locator('.loading-history, .loading-dots, text=Loading').count();
  console.log(`  Loading indicators: ${loading}`);

  // Check if input area exists
  const input = await page.locator('textarea').count();
  console.log(`  Textarea inputs: ${input}`);
});

await step('check tab bar', async () => {
  const tabCount = await page.locator('.tab-bar .tab, [class*="tab-item"], [class*="tab-bar"] button').count();
  console.log(`  Tabs in bar: ${tabCount}`);
});

await step('check pane content', async () => {
  // What's in the main content area?
  const paneText = await page.locator('.pane-content, .content-area, .main-area').first().innerText().catch(() => '(not found)');
  console.log(`  Pane content (first 200 chars): ${paneText.substring(0, 200)}`);
});

await step('create new session', async () => {
  const newBtn = page.locator('text=New Session').first();
  if (await newBtn.isVisible()) {
    await newBtn.click();
    await page.waitForTimeout(2000);
  } else {
    console.log('  New Session button not found');
  }
});

await step('check new session tab', async () => {
  const tabCount = await page.locator('.tab-bar .tab, [class*="tab-item"]').count();
  console.log(`  Tabs after new session: ${tabCount}`);

  // Check for input area in the new session
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible()) {
    console.log('  Input area visible — session is active');
  }
});

await step('type a message (dont send)', async () => {
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible()) {
    await textarea.fill('Test message from Playwright - do not send');
    console.log('  Typed test message');
  }
});

await step('final state', async () => {
  // Dump DOM structure summary
  const appHTML = await page.evaluate(() => {
    const app = document.querySelector('#app');
    if (!app) return 'no #app';
    // Get class names of top-level children
    return Array.from(app.children).map(el =>
      `<${el.tagName.toLowerCase()} class="${el.className}"> (${el.children.length} children)`
    ).join('\n');
  });
  console.log(`  App DOM structure:\n${appHTML}`);
});

// --- Summary ---
console.log('\n\n========= SUMMARY =========');
console.log(`Steps run: ${stepNum}`);
console.log(`Console errors: ${logs.filter(l => l.includes('[error]') || l.includes('[CRASH]')).length}`);
console.log(`Console warnings: ${logs.filter(l => l.includes('[warning]')).length}`);
if (logs.length > 0) {
  console.log('\nAll console output:');
  for (const l of logs) console.log(`  ${l}`);
}
console.log(`\nScreenshots in: ${outDir}/`);

writeFileSync(`${outDir}/console-full.log`, logs.join('\n') || '(no output)');

await browser.close();
