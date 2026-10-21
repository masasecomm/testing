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
const NEW_ENTRIES_LIMIT = 10;
let sheetSyncRunning = false;
let sheetSyncRequested = false;

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
  syncCapturedDataToSheet();
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

function formatCATDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date).replace(',', '');
}

function buildSheetPayload(data) {
  const entries = Object.entries(data.trendHistory)
    .map(([query, info]) => ({ query, count: info.count, recent: info.recent || [] }));
  const newQueries = (data.newEntries || []).slice(0, NEW_ENTRIES_LIMIT);
  const newSet = new Set(newQueries.map(entry => entry.query));
  const evictedSet = new Set(data.evictedFromFeed || []);
  const recentStart = Math.max(1, (data.scanCount || 0) - 2);
  const byQuery = new Map(entries.map(entry => [entry.query, entry]));
  const rising = newQueries.map(entry => byQuery.get(entry.query)).filter(Boolean)
    .filter(entry => {
      const recentHits = entry.recent.filter(scan => scan >= recentStart).length;
      return entry.count >= 3 && recentHits >= 1;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const dying = entries.filter(entry => {
    if (newSet.has(entry.query) || !evictedSet.has(entry.query)) return false;
    const recentHits = entry.recent.filter(scan => scan >= recentStart).length;
    return recentHits === 0 && entry.count >= 2;
  }).sort((a, b) => b.count - a.count).slice(0, 30);
  const toRows = rows => rows.map((row, index) => ({
    rank: index + 1,
    query: row.query,
    count: row.count || 1,
  }));

  return {
    action: 'bucketSync',
    exportedAtCAT: formatCATDateTime() + ' CAT',
    all: toRows(entries.sort((a, b) => b.count - a.count)),
    newEntries: toRows(newQueries.map(entry =>
      byQuery.get(entry.query) || { query: entry.query, count: 1 })),
    rising: toRows(rising),
    dying: toRows(dying),
  };
}

async function syncCapturedDataToSheet() {
  sheetSyncRequested = true;
  if (sheetSyncRunning) return;
  sheetSyncRunning = true;
  try {
    while (sheetSyncRequested) {
      sheetSyncRequested = false;
      const data = await chrome.storage.local.get({
        sheetWebhookUrl: '',
        trendHistory: {},
        scanCount: 0,
        newEntries: [],
        evictedFromFeed: [],
        lastSheetSyncScanCount: 0,
      });
      if (!data.sheetWebhookUrl || !data.scanCount
          || data.scanCount <= data.lastSheetSyncScanCount) continue;

      const payload = buildSheetPayload(data);
      if (!payload.all.length) continue;
      await fetch(data.sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      await chrome.storage.local.set({
        lastSheetSyncAt: Date.now(),
        lastSheetSyncScanCount: data.scanCount,
        lastSheetSyncError: '',
      });
    }
  } catch (error) {
    console.warn('[GTS] Google Sheets sync failed', error);
    await chrome.storage.local.set({ lastSheetSyncError: error.message });
  } finally {
    sheetSyncRunning = false;
    if (sheetSyncRequested) syncCapturedDataToSheet();
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

// When capturing gets turned on from the popup, protect
// whichever Google tab exists right away rather than waiting a minute.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.sheetWebhookUrl && changes.sheetWebhookUrl.newValue) {
    await chrome.storage.local.set({ lastSheetSyncScanCount: 0 });
    syncCapturedDataToSheet();
  } else if (changes.scanCount) {
    syncCapturedDataToSheet();
  }
  if (!changes.autoCapture || !changes.autoCapture.newValue) return;
  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  if (tabs.length) await Promise.all(tabs.map(t => protectFromDiscard(t.id)));
});
