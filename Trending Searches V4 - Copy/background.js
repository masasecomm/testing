// Trending Searches V4 - Background service worker
//
// The actual scanning happens in content.js on a Google tab, chained via
// "capture -> reload -> capture" while autoCapture is on. That chain can
// die (tab discarded to free memory, tab closed, a crash, the extension
// context getting invalidated mid-cycle, etc). This watchdog periodically
// checks that the loop is still alive while autoCapture is on, and heals
// it — reopening or reloading a Google tab — so capturing effectively runs
// forever instead of silently stopping.

const GOOGLE_URL_PATTERNS = [
  '*://www.google.com/*', '*://www.google.co.uk/*', '*://www.google.co.za/*',
  '*://www.google.co.in/*', '*://www.google.com.au/*', '*://www.google.com.br/*',
  '*://www.google.ca/*', '*://www.google.de/*', '*://www.google.fr/*',
];

const STALE_MS = 3 * 60 * 1000; // no capture in 3 min while "running" = assume the loop died
const ALARM_NAME = 'gts-watchdog';

function armWatchdog() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(armWatchdog);
chrome.runtime.onStartup.addListener(armWatchdog);
armWatchdog();

// Ask Chrome not to auto-discard this tab to reclaim memory while we're
// relying on it staying alive in the background.
async function protectFromDiscard(tabId) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) { /* ignore */ }
}

async function openFreshGoogleTab() {
  try {
    const tab = await chrome.tabs.create({ url: 'https://www.google.com/', active: false });
    await protectFromDiscard(tab.id);
  } catch (e) { /* ignore — e.g. no window to attach to yet */ }
}

async function checkAndHeal() {
  const data = await chrome.storage.local.get({ autoCapture: false, lastCaptureAt: 0 });
  if (!data.autoCapture) return;

  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  if (!tabs.length) {
    await openFreshGoogleTab();
    return;
  }

  await Promise.all(tabs.map(t => protectFromDiscard(t.id)));

  const stale = !data.lastCaptureAt || (Date.now() - data.lastCaptureAt > STALE_MS);
  if (stale) {
    // A tab exists but nothing has been captured in a while — the chain
    // most likely died. Reload it to kick the cycle back into life.
    try { await chrome.tabs.reload(tabs[0].id); } catch (e) { /* ignore */ }
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) checkAndHeal();
});

// React immediately if the Google tab we depend on gets closed, instead of
// waiting for the next once-a-minute alarm tick.
chrome.tabs.onRemoved.addListener(async () => {
  const data = await chrome.storage.local.get({ autoCapture: false });
  if (!data.autoCapture) return;
  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  if (!tabs.length) await openFreshGoogleTab();
});

// When capturing gets turned on (from the dashboard or the popup), protect
// whichever Google tab exists right away rather than waiting a minute.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.autoCapture || !changes.autoCapture.newValue) return;
  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  if (tabs.length) await Promise.all(tabs.map(t => protectFromDiscard(t.id)));
});
