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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'GTS_GET_TRENDS') return false;
    sendResponse({ trends: getTrendingSearches() });
    return false;
  });

  const NEW_ENTRIES_LIMIT = 10;
  function saveTrendsToStorage(trends) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ trendHistory: {}, scanCount: 0, newEntries: [], evictedFromFeed: [] }, data => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
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
        }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
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

  let autoCycleRunning = false;

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getAutoCaptureEnabled() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ autoCapture: false }, data => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data.autoCapture);
      });
    });
  }

  function incrementCycleCount() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ cycleCount: 0 }, data => {
        chrome.storage.local.set({ cycleCount: (data.cycleCount || 0) + 1 }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
    });
  }

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

  async function dismissSuggestions(input) {
    const outsideTarget = document.body;
    if (!outsideTarget) return;

    ['mousedown', 'mouseup', 'click'].forEach(type => {
      outsideTarget.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    });
    if (input && document.activeElement === input) input.blur();

    const start = Date.now();
    while (isDropdownVisible() && Date.now() - start < 1000) {
      await delay(100);
    }
  }

  async function runOneAutoCycle() {
    if (autoCycleRunning) return;
    autoCycleRunning = true;
    try {
      while (await getAutoCaptureEnabled()) {
        try {
          const input = getSearchInput();
          if (input) {
            input.focus();
            input.click();
            input.dispatchEvent(new Event('focus', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
          }

          const trends = await waitForTrends(4000);
          if (trends.length > 0) {
            await saveTrendsToStorage(trends);
            await incrementCycleCount();
            await dismissSuggestions(input);
            await delay(5000);
          } else {
            await delay(2000);
          }
        } catch (e) {
          console.error('[GTS] auto-capture scan failed', e);
          await delay(2000);
        }
      }
    } catch (e) {
      console.error('[GTS] auto-capture error', e);
    } finally {
      autoCycleRunning = false;
    }
  }

  // React to user toggling Start/Pause from the popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoCapture) {
      const nowOn = !!changes.autoCapture.newValue;
      if (nowOn) setTimeout(runOneAutoCycle, 300);
    }
  });

  // If auto-capture is already on when this page loads, start the scan loop.
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