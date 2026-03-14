import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const relayPage = pages.find(p => p.url().includes('clout-operations'));
  if (!relayPage) { console.log('No relay tab'); browser.disconnect(); return; }

  console.log('Connected to:', relayPage.url());

  // Run diagnostics in the page context
  const diag = await relayPage.evaluate(() => {
    const result = {};

    // Check if CockpitStrip component is rendered at all
    result.cockpitWidget = !!document.querySelector('.cockpit-widget');
    result.cockpitBadge = !!document.querySelector('.cockpit-badge');
    result.sessionPicker = !!document.querySelector('.session-picker');
    result.focusedView = !!document.querySelector('.focused-view');

    // Check board state
    result.commandPost = !!document.querySelector('.command-post');
    result.cpOverview = !!document.querySelector('.cp-overview');
    result.cpZoomed = !!document.querySelector('.cp-zoomed');

    // The chat popup in bottom right
    result.chatPopup = !!document.querySelector('.chat-popup, .popup-container');
    result.popupChat = document.querySelector('.chat-popup, .popup-container')?.textContent?.substring(0, 200);

    // Check all elements at bottom-right of screen (where the chat appears)
    const bottomRight = document.elementsFromPoint(window.innerWidth - 100, window.innerHeight - 100);
    result.bottomRightElements = bottomRight.slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className?.substring?.(0, 80),
      id: el.id
    }));

    // Check for the strategy area in board
    const areas = document.querySelectorAll('.area-zone, .az');
    result.areaNames = Array.from(areas).map(a => {
      const name = a.querySelector('.az-name')?.textContent?.trim();
      return name;
    });

    // Check localStorage
    result.localStorage = {
      cockpitSession: localStorage.getItem('cockpit-strategy-session'),
      cockpitMinimized: localStorage.getItem('cockpit-minimized'),
      cockpitPos: localStorage.getItem('cockpit-widget-pos'),
      cockpitSize: localStorage.getItem('cockpit-widget-size'),
    };

    // Check if there's a focused area
    const compactStrip = document.querySelector('.compact-strip');
    result.compactStrip = !!compactStrip;

    // Check for any strategy-related text
    result.strategyInPage = document.body.innerHTML.includes('strategyData') ||
                            document.body.innerHTML.includes('cockpit-badge') ||
                            document.body.innerHTML.includes('cockpit-widget');

    // Check what view mode we're in
    result.boardViewActive = !!document.querySelector('[class*="board"]');

    // Check ALL floating/absolute/fixed positioned elements
    const allEls = document.querySelectorAll('*');
    const floating = [];
    for (const el of allEls) {
      const style = getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          el.offsetWidth > 50 && el.offsetHeight > 50 &&
          !el.matches('html, body, head')) {
        floating.push({
          tag: el.tagName,
          class: el.className?.substring?.(0, 60),
          pos: style.position,
          dims: `${el.offsetWidth}x${el.offsetHeight}`,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity
        });
      }
    }
    result.floatingElements = floating;

    return result;
  });

  console.log('\n=== DIAGNOSTICS ===');
  console.log(JSON.stringify(diag, null, 2));

  // Also check console errors
  const consoleErrors = [];
  relayPage.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Trigger a reload of the cockpit data by executing in page
  const forceCheck = await relayPage.evaluate(async () => {
    // Try fetching the strategy endpoint directly
    try {
      const res = await fetch('/p/clout-operations/api/board/strategy');
      const ok = res.ok;
      const data = ok ? await res.json() : null;
      return { fetchOk: ok, hasGate: !!data?.gate, gate: data?.gate };
    } catch (e) {
      return { fetchError: e.message };
    }
  });
  console.log('\n=== STRATEGY FETCH FROM BROWSER ===');
  console.log(JSON.stringify(forceCheck, null, 2));

  browser.disconnect();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
