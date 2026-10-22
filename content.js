// Trending Searches V4 - Content Script
(function () {
  if (globalThis.gtsCaptureInitialized) return;
  globalThis.gtsCaptureInitialized = true;

  function getTrendingSearches() {
    const trends = [];
    const selectors = [
      'ul[role="listbox"] li .wM6W7d', 'ul[role="listbox"] li .sbl1',
      'ul[role="listbox"] li .pcTkSc', 'ul[role="listbox"] li .lx3srv',
      '.OBMEnb .trsqMc', '.OBMEnb .mKaEGd',
      '.ynAwRc .fc9yUc', '.ynAwRc .JtKRv',
      '.aajZCb .sbl1', '.aajZCb .wM6W7d', '.aajZCb .pcTkSc',
      '.erkvQe li', '.EIaa9b',
      '.NJYBqb .wM6W7d', '.NJYBqb .sbl1',
      '[role="option"] .wM6W7d', '[role="option"] .sbl1',
      '[role="listbox"] [role="option"]',
      '.s71ifd', '.pIhnMd', '.C3mZkd',
    ];
    // Classes that belong to the "See more" widget — always exclude
    const EXCLUDED_CLASSES = ['MagqMc', 'ZFiwCf', 'U48fD', 'jRKCUd', 'LGwnxb', 'w2fKdd', 'Bi9oQd', 'sOmPcf', 'TQc1id', 'Zjtggb', 'kC8B4e', 'nCFUpc'];
    const EXCLUDED_SELECTOR = EXCLUDED_CLASSES.map(c => '.' + c).join(',');
    const isExcluded = (el) => {
      if (!el) return true;
      if (el.closest(EXCLUDED_SELECTOR)) return true;
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'see more' || t === 'show more') return true;
      if (t.includes('see more')) return true;
      return false;
    };
    // Validate text: real trending queries only — no CSS, no code, no class names
    const isValidQuery = (text) => {
      if (!text) return false;
      const t = text.trim();
      if (t.length < 2 || t.length > 120) return false;
      // Reject anything containing CSS class refs or code-like patterns
      if (t.includes('.MagqMc')) return false;
      if (/\.[A-Za-z][A-Za-z0-9_-]{3,}\s*\{/.test(t)) return false; // .Class {
      if (/[{};]/.test(t) && /[:\-]/.test(t)) return false; // CSS-ish punctuation
      if (t.includes('var(--')) return false;
      if (t.includes('background-color') || t.includes('webkit-') || t.includes('font-family')) return false;
      if (/^[.#][A-Za-z]/.test(t)) return false; // starts with .class or #id
      // Must contain at least one letter or digit (real query content)
      if (!/[\p{L}\p{N}]/u.test(t)) return false;
      const lower = t.toLowerCase();
      // Reject any query containing "see more" (covers "See more", "...See moreDelete", etc.)
      if (lower.includes('see more')) return false;
      if (lower === 'show more') return false;
      return true;
    };
    // Extract clean text (icons/SVGs have no textContent — naturally skipped)
    // Also strip a trailing "Delete" button label that Google appends to recent searches.
    const cleanText = (el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('svg, img, style, script, button, [aria-hidden="true"], [aria-label="Delete"], [aria-label="Remove"]').forEach(n => n.remove());
      // Google sometimes renders a query and a trailing descriptor (e.g. a
      // person's occupation, "English footballer") as separate sibling
      // elements with no literal space between them in the markup. Reading
      // textContent then glues them together — "Harvey ElliottEnglish
      // footballer". Insert a real space at every element boundary so that
      // never happens.
      clone.querySelectorAll('*').forEach(node => node.after(' '));
      let txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      // Remove trailing "Delete" / "Remove" suffix (e.g. "queryDelete")
      txt = txt.replace(/\s*(Delete|Remove)\s*$/i, '').trim();
      // Catch-all: split any remaining "wordWord" / "ABCWord" glue that the
      // structural fix above didn't reach (deeper nesting, etc.).
      txt = txt.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
      txt = txt.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');
      txt = txt.replace(/\s+/g, ' ').trim();
      return txt;
    };
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        if (isExcluded(el)) return;
        const text = cleanText(el);
        if (isValidQuery(text) && !trends.includes(text)) trends.push(text);
      });
    }
    if (trends.length === 0) {
      document.querySelectorAll('[role="listbox"] [role="option"], .aajZCb li, .erkvQe li').forEach(el => {
        if (isExcluded(el)) return;
        const text = cleanText(el);
        if (isValidQuery(text) && !trends.includes(text)) trends.push(text);
      });
    }
    return trends;
  }

  const NEW_ENTRIES_LIMIT = 10;
  function saveTrendsToStorage(trends) {
    if (!trends.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({
        trendHistory: {},
        scanCount: 0,
        newEntries: [],
        evictedFromFeed: [],
        timestampEntries: [],
        lastSheetSyncScanCount: 0,
      }, data => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const history = data.trendHistory;
        const now = new Date().toISOString();
        const scanIdx = (data.scanCount || 0) + 1;
        let feed = data.newEntries || [];
        const lastSyncedScan = data.lastSheetSyncScanCount || 0;
        const timestampEntries = (data.timestampEntries || [])
          .filter(entry => entry.scan > lastSyncedScan);
        const evicted = new Set(data.evictedFromFeed || []);
        trends.forEach(q => {
          const isFirstTime = !history[q];
          if (isFirstTime) {
            history[q] = { count: 0, firstSeen: now, lastSeen: now, recent: [] };
            feed = [{ query: q, addedAt: now, scan: scanIdx }, ...feed.filter(e => e.query !== q)];
          }
          history[q].count += 1;
          history[q].lastSeen = now;
          history[q].recent = (history[q].recent || []).concat(scanIdx).slice(-15);
          timestampEntries.push({ scan: scanIdx, query: q, capturedAt: now });
        });
        if (feed.length > NEW_ENTRIES_LIMIT) {
          const overflow = feed.slice(NEW_ENTRIES_LIMIT);
          overflow.forEach(e => evicted.add(e.query));
          feed = feed.slice(0, NEW_ENTRIES_LIMIT);
        }
        chrome.storage.local.set({
          trendHistory: history,
          scanCount: scanIdx,
          newEntries: feed,
          timestampEntries,
          evictedFromFeed: Array.from(evicted).slice(-500),
          lastCaptureAt: Date.now(),
        }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
    });
  }

  function getSearchInput() {
    return document.querySelector('textarea[name="q"], input[name="q"]');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForTrends(timeoutMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const trends = getTrendingSearches();
      if (trends.length > 0) return trends;
      await delay(150);
    }
    return [];
  }

  let captureEnabled = false;
  let captureLoopRunning = false;

  async function runCaptureLoop() {
    if (captureLoopRunning) return;
    captureLoopRunning = true;
    try {
      while (captureEnabled) {
        const input = getSearchInput();
        if (!input) {
          await delay(2000);
          continue;
        }

        try {
          input.focus();
          input.click();
          const trends = await waitForTrends();
          if (captureEnabled && trends.length > 0) {
            await saveTrendsToStorage(trends);
          }
        } catch (error) {
          console.error('[GTS] capture error', error);
        }

        await delay(1500);
      }
    } finally {
      captureLoopRunning = false;
      if (captureEnabled) runCaptureLoop();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoCapture) return;
    captureEnabled = !!changes.autoCapture.newValue;
    if (captureEnabled) runCaptureLoop();
  });

  chrome.storage.local.get({ autoCapture: false }, data => {
    if (chrome.runtime.lastError) {
      console.error('[GTS] could not read capture state', chrome.runtime.lastError);
      return;
    }
    captureEnabled = data.autoCapture;
    if (captureEnabled) runCaptureLoop();
  });
})();