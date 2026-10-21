// Trending Searches V4 - Content Script
(function () {
  let copyButton = null;
  let observer = null;
  

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
    if (!trends.length) return;
    chrome.storage.local.get({ trendHistory: {}, scanCount: 0, newEntries: [], evictedFromFeed: [] }, data => {
      const history = data.trendHistory;
      const now = new Date().toISOString();
      const scanIdx = (data.scanCount || 0) + 1;
      let feed = data.newEntries || [];
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
      });
      // Trim feed and track evicted queries (so we can compute "Dying" later)
      if (feed.length > NEW_ENTRIES_LIMIT) {
        const overflow = feed.slice(NEW_ENTRIES_LIMIT);
        overflow.forEach(e => evicted.add(e.query));
        feed = feed.slice(0, NEW_ENTRIES_LIMIT);
      }
      chrome.storage.local.set({
        trendHistory: history,
        scanCount: scanIdx,
        newEntries: feed,
        evictedFromFeed: Array.from(evicted).slice(-500),
        lastCaptureAt: Date.now(),
      });
    });
  }

  function showNotification(message) {
    const notif = document.createElement('div');
    notif.className = 'gts-notification';
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.classList.add('gts-show'), 10);
    setTimeout(() => {
      notif.classList.remove('gts-show');
      setTimeout(() => notif.remove(), 300);
    }, 2000);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showNotification(`✅ Copied ${text.split('\n').length} trending searches!`);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showNotification(`✅ Copied ${text.split('\n').length} trending searches!`);
    });
  }

  let panelEl = null;
  let panelFrame = null;

  function togglePanel() {
    if (panelEl && panelEl.classList.contains('gts-panel-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.className = 'gts-panel';
      const header = document.createElement('div');
      header.className = 'gts-panel-header';
      header.innerHTML = '<span>📋 Trending Searches V4</span>';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'gts-panel-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', closePanel);
      header.appendChild(closeBtn);
      panelFrame = document.createElement('iframe');
      panelFrame.className = 'gts-panel-frame';
      panelFrame.src = chrome.runtime.getURL('popup.html');
      panelEl.appendChild(header);
      panelEl.appendChild(panelFrame);
      document.body.appendChild(panelEl);
    }
    requestAnimationFrame(() => panelEl.classList.add('gts-panel-open'));
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('gts-panel-open');
  }

  // The floating "Open Trends Panel" button + on-page slide-in panel are
  // disabled — the extension is used via the toolbar popup instead. Capture
  // and auto-capture logic above is untouched and keeps working as normal.
  function createCopyButton() {
    return;
  }

  function showButton() {
    return;
  }

  function hideButton() {
    return;
  }

  // Auto-capture chained sequence: on page load, if enabled, run ONE cycle
  // (focus search bar -> wait for dropdown -> save trends -> reload).
  // The next cycle starts naturally when the page finishes reloading.
  function getSearchInput() {
    return document.querySelector('textarea[name="q"], input[name="q"]');
  }

  function waitForTrends(timeoutMs = 4000) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const trends = getTrendingSearches();
        if (trends.length > 0) return resolve(trends);
        if (Date.now() - start > timeoutMs) return resolve([]);
        setTimeout(check, 150);
      };
      check();
    });
  }

  function formatCATDateTime(d = new Date()) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Harare', hour12: false,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(d).replace(',', '');
  }

  function bucketizeForSync(history, scanCount, newFeed, evictedFromFeed) {
    const NEW_LIMIT = 10;
    const entries = Object.entries(history).map(([query, info]) => ({
      query, count: info.count, recent: info.recent || [],
    }));
    const newQueries = (newFeed || []).slice(0, NEW_LIMIT);
    const newSet = new Set(newQueries.map(e => e.query));
    const evictedSet = new Set(evictedFromFeed || []);
    const recentStart = Math.max(1, (scanCount || 0) - 2);
    const byQuery = new Map(entries.map(e => [e.query, e]));
    const rising = newQueries.map(n => byQuery.get(n.query)).filter(Boolean)
      .filter(e => {
        const rh = (e.recent || []).filter(s => s >= recentStart).length;
        return e.count >= 3 && rh >= 1;
      }).sort((a,b) => b.count - a.count).slice(0, 30);
    const dying = entries.filter(e => {
      if (newSet.has(e.query)) return false;
      if (!evictedSet.has(e.query)) return false;
      const rh = (e.recent || []).filter(s => s >= recentStart).length;
      return rh === 0 && e.count >= 2;
    }).sort((a,b) => b.count - a.count).slice(0, 30);
    const newBucket = newQueries.map(n => byQuery.get(n.query) || { query: n.query, count: 1 });
    return { entries: entries.sort((a,b) => b.count - a.count), newEntries: newBucket, rising, dying };
  }

  async function autoSyncToSheetIfEnabled() {
    return new Promise(resolve => {
      chrome.storage.local.get({
        autoSyncSheet: false, sheetWebhookUrl: '', trendHistory: {},
        scanCount: 0, newEntries: [], evictedFromFeed: [],
        autoSyncMinutes: 5, lastSheetSyncAt: 0,
      }, async data => {
        if (!data.autoSyncSheet || !data.sheetWebhookUrl) return resolve();
        const minutes = Math.max(1, parseInt(data.autoSyncMinutes, 10) || 5);
        const intervalMs = minutes * 60 * 1000;
        if (Date.now() - (data.lastSheetSyncAt || 0) < intervalMs) return resolve();
        const b = bucketizeForSync(data.trendHistory, data.scanCount, data.newEntries, data.evictedFromFeed);
        if (!b.entries.length) return resolve();
        const toRows = arr => arr.map((r, i) => ({ rank: i + 1, query: r.query, count: r.count || 1 }));
        const payload = {
          action: 'bucketSync',
          exportedAtCAT: formatCATDateTime() + ' CAT',
          all: toRows(b.entries),
          newEntries: toRows(b.newEntries),
          rising: toRows(b.rising),
          dying: toRows(b.dying),
        };
        try {
          await fetch(data.sheetWebhookUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
          });
          chrome.storage.local.set({ lastSheetSyncAt: Date.now() });
        } catch (e) { console.warn('[GTS] sheet sync failed', e); }
        resolve();
      });
    });
  }

  async function runOneAutoCycle() {
    try {
      const input = getSearchInput();
      if (input) {
        input.focus();
        input.click();
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        input.dispatchEvent(new Event('click', { bubbles: true }));
      }
      const trends = await waitForTrends(4000);
      if (trends.length > 0) saveTrendsToStorage(trends);

      // Auto-sync to Google Sheet (capped wait so we don't stall the cycle)
      await Promise.race([autoSyncToSheetIfEnabled(), new Promise(r => setTimeout(r, 1500))]);

      // Increment cycle count, then refresh to chain the next cycle
      chrome.storage.local.get({ cycleCount: 0, autoCapture: false }, data => {
        if (!data.autoCapture) return; // user paused mid-cycle
        const next = (data.cycleCount || 0) + 1;
        chrome.storage.local.set({ cycleCount: next }, () => {
          setTimeout(() => window.location.reload(), 700);
        });
      });
    } catch (e) {
      console.error('[GTS] auto-capture error', e);
      chrome.storage.local.get({ autoCapture: false }, d => {
        if (d.autoCapture) setTimeout(() => window.location.reload(), 2000);
      });
    }
  }

  // React to user toggling Start/Pause from the popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoCapture) {
      const nowOn = !!changes.autoCapture.newValue;
      if (nowOn) setTimeout(runOneAutoCycle, 300);
    }
  });

  // On every page load, if auto-capture is ON, kick off exactly one cycle.
  chrome.storage.local.get({ autoCapture: false }, data => {
    if (data.autoCapture) setTimeout(runOneAutoCycle, 1200);
  });

  function isDropdownVisible() {
    const dropdown = document.querySelector('[role="listbox"], .aajZCb, .erkvQe, .OBMEnb, .NJYBqb');
    if (!dropdown || dropdown.children.length === 0) return false;
    const rect = dropdown.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(dropdown);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function refreshButtonVisibility() {
    if (isDropdownVisible() || getTrendingSearches().length > 0) {
      showButton();
    } else {
      hideButton();
    }
  }

  function startObserving() {
    observer = new MutationObserver(() => {
      if (isDropdownVisible()) {
        showButton();
        // Auto-capture runs on its own interval — don't trigger here to avoid reload loops.
      } else {
        // Only hide if no trends are visible at all
        if (getTrendingSearches().length === 0) hideButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Keep button visible while interacting with search area
    document.addEventListener('focusin', (e) => {
      const target = e.target;
      if (target.matches && target.matches('input[name="q"], textarea[name="q"]')) {
        setTimeout(showButton, 300);
      }
    });

    // Re-check periodically as a safety net
    setInterval(refreshButtonVisibility, 800);
  }

  // Prevent the button from stealing focus from the search input
  function preventFocusSteal() {
    if (!copyButton) return;
    copyButton.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keeps focus on search bar so dropdown stays open
    });
  }

  if (window.location.pathname === '/' || window.location.pathname === '/webhp') {
    setTimeout(() => {
      createCopyButton();
      preventFocusSteal();
      if (isDropdownVisible()) showButton();
    }, 1000);
  }

  startObserving();
  createCopyButton();
  preventFocusSteal();
})();