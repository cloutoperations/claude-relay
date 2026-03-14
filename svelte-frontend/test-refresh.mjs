import puppeteer from 'puppeteer';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const relayPage = pages.find(p => p.url().includes('clout-operations'));
  if (!relayPage) { console.log('No relay tab'); browser.disconnect(); return; }

  console.log('Connected to:', relayPage.url());

  // Force hard refresh (bypass cache)
  console.log('Hard refreshing...');
  await relayPage.reload({ waitUntil: 'networkidle2' });
  console.log('Page reloaded');

  // Wait for board to load
  await wait(3000);

  // Click Board tab if needed
  const clickedBoard = await relayPage.evaluate(() => {
    const boardBtn = [...document.querySelectorAll('a, button, div')].find(
      el => el.textContent.trim() === 'Board' && el.offsetWidth > 0
    );
    if (boardBtn) { boardBtn.click(); return true; }
    return false;
  });
  console.log('Clicked Board:', clickedBoard);

  await wait(2000);

  // Check cockpit state
  const state = await relayPage.evaluate(() => {
    return {
      cockpitWidget: !!document.querySelector('.cockpit-widget'),
      cockpitBadge: !!document.querySelector('.cockpit-badge'),
      focusedView: !!document.querySelector('.focused-view'),
      commandPost: !!document.querySelector('.command-post'),
      cpOverview: !!document.querySelector('.cp-overview'),
      floatingWidgets: [...document.querySelectorAll('*')].filter(el => {
        const s = getComputedStyle(el);
        return (s.position === 'fixed' || s.position === 'absolute') && el.offsetWidth > 100 && el.offsetHeight > 100;
      }).map(el => ({ class: el.className?.substring?.(0, 60), dims: `${el.offsetWidth}x${el.offsetHeight}` })),
      // Check if strategy data loaded
      hasStrategyGate: document.body.innerHTML.includes('$500/day') || document.body.innerHTML.includes('chatter operational'),
      allText: document.body.innerText.substring(0, 500)
    };
  });

  console.log('\n=== STATE AFTER REFRESH ===');
  console.log(JSON.stringify(state, null, 2));

  await relayPage.screenshot({ path: '/tmp/live-after-refresh.png', fullPage: true });
  console.log('\nScreenshot: /tmp/live-after-refresh.png');

  browser.disconnect();
}

run().catch(err => { console.error('Failed:', err.message); process.exit(1); });
