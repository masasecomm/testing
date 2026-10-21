// Trending Searches V4 - Background service worker
//
// Capture runs repeatedly in content.js on an existing Google tab without
// reloading or opening pages. Protect existing Google tabs from being discarded.

const GOOGLE_URL_PATTERNS = [
  '*://www.google.com/*', '*://www.google.co.uk/*', '*://www.google.co.za/*',
  '*://www.google.co.in/*', '*://www.google.com.au/*', '*://www.google.com.br/*',
  '*://www.google.ca/*', '*://www.google.de/*', '*://www.google.fr/*',
];

// Ask Chrome not to auto-discard this tab to reclaim memory while we're
// relying on it staying alive in the background.
async function protectFromDiscard(tabId) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) { /* ignore */ }
}

// When capturing gets turned on (from the dashboard or the popup), protect
// whichever Google tab exists right away rather than waiting a minute.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.autoCapture || !changes.autoCapture.newValue) return;
  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  if (tabs.length) await Promise.all(tabs.map(t => protectFromDiscard(t.id)));
});
