import puppeteer from 'puppeteer';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('clout-operations'));
  if (!page) { console.log('No relay tab'); browser.disconnect(); return; }

  console.log('Connected:', page.url());

  // First check current state
  const state1 = await page.evaluate(() => ({
    hasWidget: !!document.querySelector('.widget'),
    hasBadge: !!document.querySelector('.widget-badge'),
    activeSession: !!document.querySelector('.message-list:not(.compact)'), // fullscreen chat active
    boardVisible: !!document.querySelector('.command-post'),
  }));
  console.log('\nBefore:', JSON.stringify(state1));

  // Click on a session to go fullscreen
  const clicked = await page.evaluate(() => {
    const sessionItem = document.querySelector('.session-item, .session-row, [class*="session"]');
    if (sessionItem) { sessionItem.click(); return sessionItem.textContent?.trim()?.substring(0, 50); }
    return null;
  });
  console.log('Clicked session:', clicked);
  await wait(1500);

  // Check if widget is still visible
  const state2 = await page.evaluate(() => {
    const widget = document.querySelector('.widget');
    const badge = document.querySelector('.widget-badge');
    const el = widget || badge;
    let visible = false;
    let zIndex = null;
    let display = null;
    let opacity = null;
    let dims = null;
    if (el) {
      const s = getComputedStyle(el);
      visible = s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
      zIndex = s.zIndex;
      display = s.display;
      opacity = s.opacity;
      dims = `${el.offsetWidth}x${el.offsetHeight}`;
    }
    return {
      hasWidget: !!widget,
      hasBadge: !!badge,
      visible,
      zIndex,
      display,
      opacity,
      dims,
      activeSession: !!document.querySelector('.chat-panel .message-list'),
      boardVisible: !!document.querySelector('.command-post'),
    };
  });
  console.log('After clicking session:', JSON.stringify(state2, null, 2));

  await page.screenshot({ path: '/tmp/zindex-test.png', fullPage: true });
  console.log('Screenshot: /tmp/zindex-test.png');

  // Go back to board
  const wentBack = await page.evaluate(() => {
    const boardBtn = [...document.querySelectorAll('a, button, div[role="button"]')].find(
      el => el.textContent.trim() === 'Board' && el.offsetWidth > 0
    );
    if (boardBtn) { boardBtn.click(); return true; }
    return false;
  });
  console.log('Went back to board:', wentBack);

  browser.disconnect();
}

run().catch(err => { console.error('Failed:', err.message); process.exit(1); });
