import puppeteer from 'puppeteer';

const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  // Connect to existing Chrome debug port
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  console.log(`\n=== YOUR CHROME: ${pages.length} tabs open ===\n`);

  // Find the relay tab
  let relayPage = null;
  for (const p of pages) {
    const url = p.url();
    const title = await p.title();
    console.log(`  Tab: "${title}" → ${url}`);
    if (url.includes('2633') || url.includes('claude-relay') || url.includes('clout-operations')) {
      relayPage = p;
    }
  }

  if (!relayPage) {
    console.log('\n❌ No relay tab found. Looking for any localhost tab...');
    relayPage = pages.find(p => p.url().includes('localhost'));
  }

  if (!relayPage) {
    console.log('❌ No relay tab found at all.');
    browser.disconnect();
    return;
  }

  console.log(`\n=== INSPECTING: ${relayPage.url()} ===\n`);

  // Screenshot current state
  await relayPage.screenshot({ path: '/tmp/live-chrome.png', fullPage: true });
  console.log('Screenshot saved: /tmp/live-chrome.png');

  // Get full DOM state
  const state = await relayPage.evaluate(() => {
    const result = {};

    // General page info
    result.url = location.href;
    result.title = document.title;

    // Board state
    result.boardVisible = !!document.querySelector('.command-post');
    result.sessionsListVisible = !!document.querySelector('.session-rail, .session-list');

    // Cockpit widget
    const widget = document.querySelector('.cockpit-widget');
    const badge = document.querySelector('.cockpit-badge');
    result.widget = {
      visible: !!widget,
      badgeVisible: !!badge,
      badgeText: badge?.textContent?.trim()?.substring(0, 50)
    };

    if (widget) {
      const header = widget.querySelector('.cs-header');
      const tabs = widget.querySelectorAll('.cs-tab');
      const activeTab = widget.querySelector('.cs-tab.active');
      const picker = widget.querySelector('.session-picker');
      const messages = widget.querySelector('.cs-messages, .message-list');
      const input = widget.querySelector('.input-area, input, textarea');

      result.widget.headerText = header?.textContent?.trim()?.substring(0, 100);
      result.widget.tabs = Array.from(tabs).map(t => ({
        text: t.textContent.trim(),
        active: t.classList.contains('active')
      }));
      result.widget.activeTab = activeTab?.textContent?.trim();
      result.widget.pickerVisible = !!picker;
      result.widget.chatVisible = !!messages;
      result.widget.inputVisible = !!input;
      result.widget.dimensions = widget.getBoundingClientRect();
    }

    // Session picker details
    const pickerItems = document.querySelectorAll('.picker-item');
    if (pickerItems.length) {
      result.pickerSessions = Array.from(pickerItems).map(el => ({
        text: el.textContent.trim(),
        processing: el.classList.contains('processing')
      }));
    }

    // Chat messages in widget
    const chatMsgs = document.querySelectorAll('.cs-messages .message, .message-list .message-row');
    if (chatMsgs.length) {
      result.chatMessages = Array.from(chatMsgs).slice(-5).map(el => ({
        text: el.textContent.trim().substring(0, 200),
        classes: el.className
      }));
    }

    // Strategy tab content
    const stratTab = document.querySelector('.strategy-content, .strat-section');
    if (stratTab) {
      result.strategyContent = stratTab.textContent.trim().substring(0, 300);
    }

    // Board areas
    const areas = document.querySelectorAll('.area-zone, .area-card');
    if (areas.length) {
      result.boardAreas = Array.from(areas).map(a => {
        const name = a.querySelector('.area-name, .az-name, h3')?.textContent?.trim();
        const sessions = a.querySelectorAll('.session-bubble, .sb');
        return {
          name,
          sessionCount: sessions.length
        };
      });
    }

    // Activity stream
    const activity = document.querySelector('.activity-stream');
    result.activityStream = !!activity;

    // Console errors (if captured)
    result.jsErrors = window.__errors || [];

    // WebSocket state
    result.wsConnected = document.querySelector('.ws-status, .connected')?.textContent?.trim();

    // Check for any loading/error states
    result.loadingVisible = !!document.querySelector('.cp-loading, .loading, .spinner');
    result.errorVisible = !!document.querySelector('.error-msg, .error');

    return result;
  });

  console.log('\n=== LIVE STATE DUMP ===');
  console.log(JSON.stringify(state, null, 2));

  // Also check WS connection and stores
  const storeState = await relayPage.evaluate(() => {
    // Try to peek at Svelte stores if accessible
    const result = {};
    try {
      // Check if there's anything in localStorage for cockpit
      result.cockpitSession = localStorage.getItem('cockpit-strategy-session');
      result.cockpitMinimized = localStorage.getItem('cockpit-minimized');
      result.cockpitPos = localStorage.getItem('cockpit-widget-pos');
      result.activeSession = localStorage.getItem('claude-relay-active-session');
    } catch (e) {
      result.localStorageError = e.message;
    }
    return result;
  });

  console.log('\n=== LOCALSTORAGE STATE ===');
  console.log(JSON.stringify(storeState, null, 2));

  // Check for WebSocket connections
  const wsInfo = await relayPage.evaluate(() => {
    // Can't directly access WS objects, but check performance entries
    const wsEntries = performance.getEntriesByType('resource')
      .filter(e => e.name.includes('ws') || e.initiatorType === 'websocket')
      .slice(-3);
    return wsEntries.map(e => ({ name: e.name, duration: e.duration }));
  });
  console.log('\n=== WS CONNECTIONS ===');
  console.log(JSON.stringify(wsInfo, null, 2));

  // Check network/console for errors
  console.log('\n=== RECOMMENDATIONS ===');
  if (state.widget?.pickerVisible) {
    console.log('→ Widget is showing session picker - no session selected yet');
    console.log('  Pick one or click "+ New strategy agent"');
  }
  if (state.widget?.chatVisible) {
    console.log('→ Chat panel is active and connected');
  }
  if (state.loadingVisible) {
    console.log('⚠️  Something is still loading');
  }
  if (state.errorVisible) {
    console.log('❌ Error visible on page');
  }
  if (!state.widget?.visible && !state.widget?.badgeVisible) {
    console.log('→ Widget and badge both hidden - might be on wrong view or isFocused=true');
  }

  browser.disconnect();
  console.log('\n--- Done (browser still running) ---');
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
