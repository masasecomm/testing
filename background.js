// Trending Searches V4 - Background service worker
const NEW_ENTRIES_LIMIT = 10;
let sheetSyncRunning = false;
let sheetSyncRequested = false;

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
    timestampEntries: (data.timestampEntries || [])
      .filter(entry => entry.scan > (data.lastSheetSyncScanCount || 0)),
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
        timestampEntries: [],
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
      const current = await chrome.storage.local.get({ timestampEntries: [] });
      await chrome.storage.local.set({
        timestampEntries: (current.timestampEntries || [])
          .filter(entry => entry.scan > data.scanCount),
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

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.sheetWebhookUrl && changes.sheetWebhookUrl.newValue) {
    await chrome.storage.local.set({ lastSheetSyncScanCount: 0 });
    syncCapturedDataToSheet();
  } else if (changes.scanCount) {
    syncCapturedDataToSheet();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const data = await chrome.storage.local.get({
    autoCapture: false,
    captureTabId: null,
  });
  if (!data.autoCapture || data.captureTabId !== tabId) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (error) {
    console.warn('[GTS] Could not restart capture after page load', error);
    await chrome.storage.local.set({
      autoCapture: false,
      captureTabId: null,
      captureError: 'Chromium blocked reinjection after this tab navigated. Press Start again on a regular webpage.',
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'startGoogleCapture') return false;

  (async () => {
    const tab = await chrome.tabs.create({
      url: 'https://www.google.com/',
      active: true,
    });
    if (typeof tab.id !== 'number') throw new Error('Chromium did not return the new tab ID.');

    await chrome.storage.local.set({
      autoCapture: true,
      captureTabId: tab.id,
      captureError: '',
    });

    const currentTab = await chrome.tabs.get(tab.id);
    if (currentTab.status === 'complete') {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    }
    return { ok: true };
  })().then(sendResponse).catch(error => {
    console.error('[GTS] Could not start Google capture', error);
    chrome.storage.local.set({
      autoCapture: false,
      captureTabId: null,
      captureError: error.message,
    });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const data = await chrome.storage.local.get({ captureTabId: null });
  if (data.captureTabId !== tabId) return;
  await chrome.storage.local.set({
    autoCapture: false,
    captureTabId: null,
  });
});
