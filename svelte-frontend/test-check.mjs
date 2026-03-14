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
  const logs = [];
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    if (msg.type() === 'error') console.log(text);
  });

  console.log('Loading app...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await wait(2000);

  // Get full state dump
  const state = await page.evaluate(() => {
    const widget = document.querySelector('.cockpit-widget');
    const badge = document.querySelector('.cockpit-badge');
    const picker = document.querySelector('.session-picker');
    const chatPanel = document.querySelector('.cs-messages, .message-list');
    const inputArea = document.querySelector('.input-area, .cs-input');
    const tabs = document.querySelectorAll('.cs-tab');
    const header = document.querySelector('.cs-header');
    const createBtn = [...(document.querySelectorAll('button') || [])].find(b => b.textContent.includes('strategy'));
    const pickerItems = document.querySelectorAll('.picker-item');
    const errorEls = document.querySelectorAll('.error, .err');

    return {
      widgetVisible: !!widget,
      badgeVisible: !!badge,
      pickerVisible: !!picker,
      chatPanelVisible: !!chatPanel,
      inputAreaVisible: !!inputArea,
      tabCount: tabs.length,
      tabTexts: Array.from(tabs).map(t => t.textContent.trim()),
      headerText: header?.textContent?.trim()?.substring(0, 120),
      createBtnText: createBtn?.textContent?.trim(),
      pickerItemCount: pickerItems.length,
      pickerTexts: Array.from(pickerItems).map(el => el.textContent.trim()),
      errors: Array.from(errorEls).map(e => e.textContent.trim()),
      bodyText: document.body.innerText.substring(0, 500)
    };
  });

  console.log('\n=== CURRENT UI STATE ===');
  console.log(JSON.stringify(state, null, 2));

  await page.screenshot({ path: '/tmp/cockpit-check.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/cockpit-check.png');

  // Check console for relevant errors
  const relevantLogs = logs.filter(l => l.includes('error') || l.includes('Error') || l.includes('strategy') || l.includes('session'));
  if (relevantLogs.length) {
    console.log('\n=== RELEVANT CONSOLE LOGS ===');
    relevantLogs.forEach(l => console.log(l));
  }

  await browser.close();
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
