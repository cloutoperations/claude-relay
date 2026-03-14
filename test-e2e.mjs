#!/usr/bin/env node
// End-to-end test of core relay UI flows
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:5173';
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];

page.on('pageerror', err => errors.push(err.message.substring(0, 150)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().substring(0, 150)); });

console.log('Testing', url, '...\n');
await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

// Test 1: App loads
const title = await page.title();
console.log('1. App loads:', title === 'Claude Relay' ? 'PASS' : 'FAIL (' + title + ')');

// Test 2: WS connected
const connected = await page.evaluate(() => document.body.innerText.includes('Connected'));
console.log('2. WS connected:', connected ? 'PASS' : 'FAIL');

// Test 3: Sessions loaded
const sessionCount = await page.evaluate(() => {
  const text = document.body.innerText;
  const match = text.match(/SESSIONS\s+(\d+)/);
  return match ? parseInt(match[1]) : 0;
});
console.log('3. Sessions loaded:', sessionCount > 0 ? `PASS (${sessionCount})` : 'FAIL');

// Test 4: Areas/board rendered
const areas = await page.evaluate(() => {
  const text = document.body.innerText;
  const areaNames = ['CHATTING', 'PERSONAL', 'STRATEGY', 'MARKETING', 'FINANCE'];
  return areaNames.filter(a => text.includes(a));
});
console.log('4. Board areas:', areas.length > 0 ? `PASS (${areas.join(', ')})` : 'FAIL');

// Test 5: New Session button
const hasNewSession = await page.evaluate(() => {
  return !!([...document.querySelectorAll('button, [role=button], div')]
    .find(b => b.textContent.trim().includes('New Session')));
});
console.log('5. New Session btn:', hasNewSession ? 'PASS' : 'FAIL');

// Test 6: Click a session from the sidebar
await page.evaluate(() => {
  const el = document.querySelector('[class*="session"]');
  if (el) el.click();
});
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/relay-test/e2e-after-click.png' });

const afterClick = await page.evaluate(() => {
  const text = document.body.innerText;
  // Check for loading history, chat content, or tab bar
  const hasLoading = text.includes('Loading history');
  const hasChat = text.includes('Connecting') || document.querySelector('[class*="msg-"]') !== null;
  const hasTab = document.querySelector('[class*="tab"]') !== null;
  return { hasLoading, hasChat, hasTab };
});
console.log('6. After session click:', JSON.stringify(afterClick));

// Test 7: No critical errors
const critical = errors.filter(e => !e.includes('404') && !e.includes('favicon') && !e.includes('JSHandle'));
console.log('7. Console errors:', critical.length === 0 ? 'PASS (none)' : `FAIL (${critical.length})`);
critical.forEach(e => console.log('   ', e));

// Test 8: Check for popup functionality
const popupExists = await page.evaluate(() => {
  return document.querySelector('[class*="popup"]') !== null ||
         document.querySelector('[class*="Popup"]') !== null;
});
console.log('8. Popup rendered:', popupExists ? 'PASS' : 'NO POPUP (ok if none open)');

console.log('\nScreenshots in /tmp/relay-test/');
await page.screenshot({ path: '/tmp/relay-test/e2e-final.png', fullPage: true });
await browser.close();

const passed = [title === 'Claude Relay', connected, sessionCount > 0, areas.length > 0, hasNewSession, critical.length === 0];
const total = passed.length;
const ok = passed.filter(Boolean).length;
console.log(`\n${ok}/${total} core tests passed.`);
if (ok < total) process.exit(1);
