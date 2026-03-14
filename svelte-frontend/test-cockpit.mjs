import puppeteer from 'puppeteer';

const BASE = 'https://localhost:2633/p/clout-operations/';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--ignore-certificate-errors', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    }
  });

  console.log('1. Navigating to relay...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await wait(2000);

  // Board view should already be showing based on previous test

  // The page already shows the board view based on screenshot
  await page.screenshot({ path: '/tmp/cockpit-1-initial.png', fullPage: true });
  console.log('2. Screenshot 1: initial state');

  // The widget is already open. Find the "+ New strategy agent" button
  const createBtn = await page.$('.create-btn');
  console.log('3. Create button exists:', !!createBtn);

  if (!createBtn) {
    // Try to find it by text
    const btnByText = await page.evaluateHandle(() => {
      return [...document.querySelectorAll('button')].find(b => b.textContent.includes('New strategy'));
    });
    if (btnByText) {
      console.log('Found button by text search');
    }
  }

  // Get current session picker state BEFORE clicking new
  const beforeState = await page.evaluate(() => {
    const items = document.querySelectorAll('.picker-item');
    const allBtns = [...document.querySelectorAll('button')];
    const createBtn = allBtns.find(b => b.textContent.includes('New strategy'));
    return {
      pickerItemCount: items.length,
      pickerTexts: Array.from(items).map(el => el.textContent.trim()),
      createBtnFound: !!createBtn,
      createBtnText: createBtn?.textContent?.trim()
    };
  });
  console.log('4. BEFORE state:', JSON.stringify(beforeState, null, 2));

  // Click "+ New strategy agent"
  console.log('5. Clicking "+ New strategy agent"...');
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('New strategy'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('   Clicked:', clicked);

  // Wait for session creation
  console.log('6. Waiting 3s for session to be created...');
  await wait(3000);
  await page.screenshot({ path: '/tmp/cockpit-2-after-click.png', fullPage: true });
  console.log('   Screenshot 2: after clicking new');

  // Check if we're stuck in "Creating..." or if a session was selected
  const afterState = await page.evaluate(() => {
    const items = document.querySelectorAll('.picker-item');
    const createBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('New strategy') || b.textContent.includes('Creating'));
    const chatMessages = document.querySelector('.cs-messages, .message-list');
    const header = document.querySelector('.cs-header');
    const sessionPicker = document.querySelector('.session-picker');
    return {
      pickerItemCount: items.length,
      pickerTexts: Array.from(items).map(el => el.textContent.trim()),
      createBtnText: createBtn?.textContent?.trim(),
      chatPanelExists: !!chatMessages,
      headerText: header?.textContent?.trim()?.substring(0, 100),
      sessionPickerStillVisible: !!sessionPicker
    };
  });
  console.log('7. AFTER state:', JSON.stringify(afterState, null, 2));

  if (afterState.createBtnText?.includes('Creating') || afterState.sessionPickerStillVisible) {
    console.log('⚠️  Still waiting/stuck! Waiting 5 more seconds...');
    await wait(5000);
    await page.screenshot({ path: '/tmp/cockpit-3-waited-more.png', fullPage: true });

    const finalState = await page.evaluate(() => {
      const createBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('New strategy') || b.textContent.includes('Creating'));
      const sessionPicker = document.querySelector('.session-picker');
      const chatMessages = document.querySelector('.cs-messages, .message-list');
      return {
        createBtnText: createBtn?.textContent?.trim(),
        sessionPickerStillVisible: !!sessionPicker,
        chatPanelExists: !!chatMessages
      };
    });
    console.log('8. FINAL state:', JSON.stringify(finalState, null, 2));

    if (finalState.sessionPickerStillVisible) {
      console.log('❌ BUG: Still stuck on session picker after 8 seconds');
    } else if (finalState.chatPanelExists) {
      console.log('✅ Session was selected and chat panel is showing');
    }
  } else if (afterState.chatPanelExists) {
    console.log('✅ SUCCESS: New session created and chat panel is visible');
  }

  // Final screenshot
  await page.screenshot({ path: '/tmp/cockpit-final.png', fullPage: true });
  console.log('\n--- Test complete. Screenshots in /tmp/cockpit-*.png ---');
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
