// Trending Searches V4 - Background service worker
//
// Capture runs repeatedly in content.js on an existing Google tab without
// reloading or opening pages. Protect existing Google tabs from being discarded.

const GOOGLE_URL_PATTERNS = [
  '*://www.google.com/*', '*://www.google.co.uk/*', '*://www.google.co.za/*',
  '*://www.google.co.in/*', '*://www.google.com.au/*', '*://www.google.com.br/*',
  '*://www.google.ca/*', '*://www.google.de/*', '*://www.google.fr/*',
];

const NEW_ENTRIES_LIMIT = 10;

// Ask Chrome not to auto-discard this tab to reclaim memory while we're
// relying on it staying alive in the background.
async function protectFromDiscard(tabId) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) { /* ignore */ }
}

function formatLocalDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date).replace(',', '');
}

async function syncCapturedDataToSheet() {
  const data = await chrome.storage.local.get({
    sheetWebhookUrl: '',
    trendHistory: {},
    scanCount: 0,
    newEntries: [],
    evictedFromFeed: [],
    blacklistKeywords: '',
  });
  if (!data.sheetWebhookUrl) return;

  const blacklist = (data.blacklistKeywords || '')
    .split('\n').map(word => word.trim().toLowerCase()).filter(Boolean);
  const isBlacklisted = query => blacklist.some(word => query.toLowerCase().includes(word));
  const entries = Object.entries(data.trendHistory)
    .filter(([query]) => !isBlacklisted(query))
    .map(([query, info]) => ({ query, count: info.count, recent: info.recent || [] }));
  if (!entries.length) return;

  const newQueries = (data.newEntries || [])
    .filter(entry => !isBlacklisted(entry.query))
    .slice(0, NEW_ENTRIES_LIMIT);
  const newSet = new Set(newQueries.map(entry => entry.query));
  const evictedSet = new Set((data.evictedFromFeed || []).filter(query => !isBlacklisted(query)));
  const recentStart = Math.max(1, (data.scanCount || 0) - 2);
  const byQuery = new Map(entries.map(entry => [entry.query, entry]));
  const rising = newQueries.map(entry => byQuery.get(entry.query)).filter(Boolean)
    .filter(entry => {
      const recentHits = (entry.recent || []).filter(scan => scan >= recentStart).length;
      return entry.count >= 3 && recentHits >= 1;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const dying = entries.filter(entry => {
    if (newSet.has(entry.query) || !evictedSet.has(entry.query)) return false;
    const recentHits = (entry.recent || []).filter(scan => scan >= recentStart).length;
    return recentHits === 0 && entry.count >= 2;
  }).sort((a, b) => b.count - a.count).slice(0, 30);
  const toRows = rows => rows.map((row, index) => ({
    rank: index + 1,
    query: row.query,
    count: row.count || 1,
  }));
  const payload = {
    action: 'bucketSync',
    exportedAtLocalTime: formatLocalDateTime() + ' Local',
    all: toRows(entries.sort((a, b) => b.count - a.count)),
    newEntries: toRows(newQueries.map(entry => byQuery.get(entry.query) || { query: entry.query, count: 1 })),
    rising: toRows(rising),
    dying: toRows(dying),
  };

  try {
    await fetch(data.sheetWebhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    await chrome.storage.local.set({ lastSheetSyncAt: Date.now() });
  } catch (error) {
    console.warn('[GTS] Google Sheets sync after capture failed', error);
  }
}

// When capturing gets turned on (from the dashboard or the popup), protect
// whichever Google tab exists right away rather than waiting a minute.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.autoCapture && changes.autoCapture.newValue) {
    const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
    if (tabs.length) await Promise.all(tabs.map(t => protectFromDiscard(t.id)));
  }
  if (changes.scanCount
      && Number(changes.scanCount.newValue || 0) > Number(changes.scanCount.oldValue || 0)) {
    try {
      await syncCapturedDataToSheet();
    } catch (error) {
      console.warn('[GTS] Could not prepare Google Sheets sync after capture', error);
    }
  }
});
