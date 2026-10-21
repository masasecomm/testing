// Trending Searches Copier — V2
// CAT (Africa/Harare, UTC+2). New Entries feed (max 20, newest first).

const MAIN_PAGE_URL = chrome.runtime.getURL('main.html');
const NEW_ENTRIES_LIMIT = 10;

const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const mainPageBtn = document.getElementById('mainPageBtn');
const topListEl = document.getElementById('topList');
const allListEl = document.getElementById('allList');
const autoToggle = document.getElementById('autoToggle');
const captureStats = document.getElementById('captureStats');
const startPauseBtn = document.getElementById('startPauseBtn');
const runDurationEl = document.getElementById('runDuration');
const cyclesCountEl = document.getElementById('cyclesCount');
const catTimeEl = document.getElementById('catTime');
const statTotalEl = document.getElementById('statTotal');
const statScansEl = document.getElementById('statScans');
const statUniqueEl = document.getElementById('statUnique');
const statNewEl = document.getElementById('statNew');
const newEntriesListEl = document.getElementById('newEntriesList');
const newPill = document.getElementById('newPill');
const copyNewAllBtn = document.getElementById('copyNewAll');

let durationTimer = null;

// ---------- CAT helpers ----------
function formatCATTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d);
}
function formatCATDateForFile(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('day')}|${get('month')}|${get('year')}`;
}
function formatCATDateTime(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare', hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d).replace(',', '');
}
function tickCATClock() { catTimeEl.textContent = formatCATTime(); }
setInterval(tickCATClock, 1000); tickCATClock();

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active');
  });
});

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function scrapeTrends() {
  const trends = [];
  const selectors = [
    'ul[role="listbox"] li .wM6W7d', 'ul[role="listbox"] li .sbl1',
    'ul[role="listbox"] li .pcTkSc', '.OBMEnb .trsqMc', '.OBMEnb .mKaEGd',
    '.aajZCb .sbl1', '.aajZCb .wM6W7d', '[role="option"] .wM6W7d',
    '[role="option"] .sbl1', '[role="listbox"] [role="option"]',
    '.s71ifd', '.pIhnMd', '.C3mZkd', '.erkvQe li', '.EIaa9b',
  ];
  const EXCLUDED = ['MagqMc', 'ZFiwCf', 'U48fD', 'jRKCUd', 'LGwnxb', 'w2fKdd', 'Bi9oQd', 'sOmPcf', 'TQc1id', 'Zjtggb', 'kC8B4e', 'nCFUpc'].map(c => '.' + c).join(',');
  const isExcluded = (el) => {
    if (!el || el.closest(EXCLUDED)) return true;
    const t = (el.textContent || '').trim().toLowerCase();
    return t === 'see more' || t === 'show more';
  };
  const isValidQuery = (t) => {
    if (!t) return false;
    if (t.length < 2 || t.length > 120) return false;
    if (t.includes('.MagqMc')) return false;
    if (/\.[A-Za-z][A-Za-z0-9_-]{3,}\s*\{/.test(t)) return false;
    if (/[{};]/.test(t) && /[:\-]/.test(t)) return false;
    if (t.includes('var(--')) return false;
    if (t.includes('background-color') || t.includes('webkit-') || t.includes('font-family')) return false;
    if (/^[.#][A-Za-z]/.test(t)) return false;
    if (!/[\p{L}\p{N}]/u.test(t)) return false;
    const lower = t.toLowerCase();
    if (lower.includes('see more')) return false;
    return lower !== 'show more';
  };
  const cleanText = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg, img, style, script, button, [aria-hidden="true"], [aria-label="Delete"], [aria-label="Remove"]').forEach(n => n.remove());
    // Insert a real space at every element boundary so a query and a
    // glued-on descriptor (e.g. "Harvey ElliottEnglish footballer") never
    // end up concatenated with no space between them.
    clone.querySelectorAll('*').forEach(node => node.after(' '));
    let txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    txt = txt.replace(/\s*(Delete|Remove)\s*$/i, '').trim();
    // Catch-all: split any remaining "wordWord" / "ABCWord" glue.
    txt = txt.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
    txt = txt.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');
    txt = txt.replace(/\s+/g, ' ').trim();
    return txt;
  };
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(el => {
      if (isExcluded(el)) return;
      const t = cleanText(el);
      if (isValidQuery(t) && !trends.includes(t)) trends.push(t);
    });
  }
  if (trends.length === 0) {
    document.querySelectorAll('[role="listbox"] [role="option"], .aajZCb li').forEach(el => {
      if (isExcluded(el)) return;
      const t = cleanText(el);
      if (isValidQuery(t) && !trends.includes(t)) trends.push(t);
    });
  }
  return trends;
}

async function getTrends() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url || !tab.url.includes('google.')) {
    statusEl.className = 'status inactive';
    statusEl.textContent = '⚠️ Navigate to Google first';
    return null;
  }
  statusEl.className = 'status active';
  statusEl.textContent = '✅ On Google - ready to capture';
  copyBtn.disabled = false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: scrapeTrends,
    });
    return result.result;
  } catch (e) { console.error(e); return []; }
}

// Save trends + maintain a "newEntries" feed (newest first, max 10, deduped).
function saveTrends(trends) {
  return new Promise(resolve => {
    chrome.storage.local.get({ trendHistory: {}, scanCount: 0, newEntries: [], blacklistKeywords: '' }, data => {
      const blacklist = (data.blacklistKeywords || '')
        .split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
      const isBlocked = q => {
        if (!blacklist.length) return false;
        const l = q.toLowerCase();
        return blacklist.some(k => l.includes(k));
      };
      const filtered = trends.filter(q => !isBlocked(q));
      const history = data.trendHistory;
      const nowIso = new Date().toISOString();
      const scanIdx = (data.scanCount || 0) + 1;
      let feed = data.newEntries || [];
      filtered.forEach(q => {
        const isFirstTime = !history[q];
        if (isFirstTime) {
          history[q] = { count: 0, firstSeen: nowIso, lastSeen: nowIso, recent: [] };
          // Push to front, dedupe, cap at limit
          feed = [{ query: q, addedAt: nowIso, scan: scanIdx }, ...feed.filter(e => e.query !== q)]
            .slice(0, NEW_ENTRIES_LIMIT);
        }
        history[q].count += 1;
        history[q].lastSeen = nowIso;
        history[q].recent = (history[q].recent || []).concat(scanIdx).slice(-15);
      });
      chrome.storage.local.set({ trendHistory: history, scanCount: scanIdx, newEntries: feed, lastCaptureAt: Date.now() }, () => resolve(history));
    });
  });
}

function isCleanQuery(t) {
  if (!t) return false;
  if (t.length < 2 || t.length > 120) return false;
  if (t.includes('.MagqMc')) return false;
  if (/\.[A-Za-z][A-Za-z0-9_-]{3,}\s*\{/.test(t)) return false;
  if (/[{};]/.test(t) && /[:\-]/.test(t)) return false;
  if (t.includes('var(--') || t.includes('background-color') || t.includes('webkit-') || t.includes('font-family')) return false;
  if (/^[.#][A-Za-z]/.test(t)) return false;
  if (!/[\p{L}\p{N}]/u.test(t)) return false;
  const l = t.toLowerCase();
  if (l.includes('see more')) return false;
  return l !== 'show more';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function renderList(el, items, showCount) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data yet</div>'; return; }
  el.innerHTML = items.map((item, i) => {
    const q = escapeHtml(item.query);
    return `<div class="trend-item">
      <span class="trend-num">${i + 1}</span>
      <span class="trend-query">${q}</span>
      ${showCount ? `<span class="trend-count">${item.count}×</span>` : ''}
      <button class="copy-btn" data-q="${q}" title="Copy query">📋</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.q);
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 900);
    });
  });
}

function loadHistory() {
  chrome.storage.local.get({ trendHistory: {}, scanCount: 0, cycleCount: 0, newEntries: [] }, data => {
    const cleaned = {};
    let removed = 0;
    Object.entries(data.trendHistory).forEach(([query, info]) => {
      if (isCleanQuery(query)) cleaned[query] = info;
      else removed++;
    });
    if (removed > 0) chrome.storage.local.set({ trendHistory: cleaned });

    const entries = Object.entries(cleaned).map(([query, info]) => ({
      query, count: info.count,
      firstSeen: info.firstSeen, lastSeen: info.lastSeen,
      recent: info.recent || [],
    }));

    const totalCaptures = entries.reduce((s, e) => s + e.count, 0);
    statTotalEl.textContent = totalCaptures;
    statScansEl.textContent = data.scanCount || 0;
    statUniqueEl.textContent = entries.length;
    const feed = (data.newEntries || []).filter(e => isCleanQuery(e.query)).slice(0, NEW_ENTRIES_LIMIT);
    statNewEl.textContent = feed.length;

    const top20 = [...entries].sort((a, b) => b.count - a.count).slice(0, 20);
    renderList(topListEl, top20, true);
    const all = [...entries].sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    renderList(allListEl, all, true);

    newPill.textContent = feed.length;
    renderList(newEntriesListEl, feed, false);
  });
}

copyNewAllBtn.addEventListener('click', () => {
  chrome.storage.local.get({ newEntries: [] }, data => {
    const text = (data.newEntries || []).slice(0, NEW_ENTRIES_LIMIT).map(e => e.query).join('\n');
    if (!text) return;
    navigator.clipboard.writeText(text);
    copyNewAllBtn.textContent = 'Copied ✓';
    setTimeout(() => { copyNewAllBtn.textContent = 'Copy all'; }, 1200);
  });
});

// ---------- Run duration ----------
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
function refreshRunDisplay() {
  chrome.storage.local.get({ autoCapture: false, runStartedAt: null, cycleCount: 0 }, data => {
    cyclesCountEl.textContent = data.cycleCount || 0;
    if (data.autoCapture && data.runStartedAt) {
      runDurationEl.textContent = formatDuration(Date.now() - data.runStartedAt);
    } else if (data.runStartedAt) {
      runDurationEl.textContent = formatDuration(Date.now() - data.runStartedAt) + ' (paused)';
    } else {
      runDurationEl.textContent = '00:00:00';
    }
  });
}
function startDurationTimer() {
  if (durationTimer) clearInterval(durationTimer);
  durationTimer = setInterval(refreshRunDisplay, 1000);
  refreshRunDisplay();
}
function updateStartPauseBtn(running) {
  if (running) {
    startPauseBtn.textContent = '⏸ Pause';
    startPauseBtn.className = 'start-pause-btn running';
    captureStats.innerHTML = '🔄 Auto-capture <strong>RUNNING</strong> — click → capture → refresh, chained.';
  } else {
    startPauseBtn.textContent = '▶ Start';
    startPauseBtn.className = 'start-pause-btn paused';
    captureStats.innerHTML = '⏸ Auto-capture <strong>PAUSED</strong>.';
  }
}
function setAutoCapture(enabled) {
  const updates = { autoCapture: enabled };
  chrome.storage.local.get({ runStartedAt: null }, data => {
    if (enabled && !data.runStartedAt) {
      updates.runStartedAt = Date.now();
      updates.cycleCount = 0;
      updates.captureElapsedSeconds = 0;
    }
    chrome.storage.local.set(updates, () => {
      autoToggle.checked = enabled;
      updateStartPauseBtn(enabled);
      refreshRunDisplay();
    });
  });
}
autoToggle.addEventListener('change', () => setAutoCapture(autoToggle.checked));
startPauseBtn.addEventListener('click', () => setAutoCapture(!autoToggle.checked));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.cycleCount || changes.autoCapture || changes.runStartedAt) {
    refreshRunDisplay();
    if (changes.autoCapture) {
      autoToggle.checked = !!changes.autoCapture.newValue;
      updateStartPauseBtn(!!changes.autoCapture.newValue);
    }
  }
  if (changes.trendHistory || changes.scanCount || changes.newEntries) loadHistory();
  if (changes.autoSyncMinutes) {
    const n = changes.autoSyncMinutes.newValue;
    if (Number.isFinite(n) && document.activeElement !== autoSyncMinutesInput) {
      autoSyncMinutesInput.value = n;
    }
  }
  if (changes.autoSyncSheet) {
    autoSyncToggle.checked = !!changes.autoSyncSheet.newValue;
  }
  if (changes.sheetWebhookUrl) {
    const v = changes.sheetWebhookUrl.newValue || '';
    if (document.activeElement !== sheetUrlInput) sheetUrlInput.value = v;
  }
});

// ---------- Excel export ----------
function exportToExcel() {
  chrome.storage.local.get({ trendHistory: {} }, data => {
    const entries = Object.entries(data.trendHistory).map(([query, info]) => ({
      query, count: info.count,
    }));
    if (!entries.length) {
      statusEl.className = 'status inactive';
      statusEl.textContent = '⚠️ No data to export';
      return;
    }
    entries.sort((a, b) => b.count - a.count);
    const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const headerRow = '<Row>'
      + '<Cell><Data ss:Type="String">Rank</Data></Cell>'
      + '<Cell><Data ss:Type="String">Search Query</Data></Cell>'
      + '<Cell><Data ss:Type="String">Times Seen</Data></Cell>'
      + '</Row>';
    const buildRows = arr => arr.map((e, i) =>
      `<Row><Cell><Data ss:Type="Number">${i+1}</Data></Cell>`
      + `<Cell><Data ss:Type="String">${escXml(e.query)}</Data></Cell>`
      + `<Cell><Data ss:Type="Number">${e.count}</Data></Cell></Row>`
    ).join('');
    const allRows = headerRow + buildRows(entries);
    const topRows = headerRow + buildRows(entries.slice(0, 20));
    const exportedAt = formatCATDateTime(new Date()) + ' CAT';
    const metaRow = `<Row><Cell><Data ss:Type="String">Exported (CAT)</Data></Cell><Cell><Data ss:Type="String">${escXml(exportedAt)}</Data></Cell></Row>`;
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>`
      + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
      + `<Worksheet ss:Name="All Trends"><Table>`
      + `<Column ss:Width="40"/><Column ss:Width="280"/><Column ss:Width="80"/>`
      + `${metaRow}${allRows}</Table></Worksheet>`
      + `<Worksheet ss:Name="Top 20"><Table>`
      + `<Column ss:Width="40"/><Column ss:Width="280"/><Column ss:Width="80"/>`
      + `${topRows}</Table></Worksheet>`
      + `</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Trending Queries ${formatCATDateForFile(new Date())}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = `✅ Exported "${a.download}"`;
  });
}

copyBtn.addEventListener('click', async () => {
  const trends = await getTrends();
  if (!trends || trends.length === 0) {
    statusEl.className = 'status inactive';
    statusEl.textContent = '⚠️ No trends found. Click the search bar first!';
    return;
  }
  await saveTrends(trends);
  await navigator.clipboard.writeText(trends.join('\n'));
  statusEl.textContent = `✅ Copied & saved ${trends.length} searches!`;
  loadHistory();
});

exportBtn.addEventListener('click', exportToExcel);
mainPageBtn.addEventListener('click', () => chrome.tabs.create({ url: MAIN_PAGE_URL }));

// Close popup button
const popupCloseBtn = document.getElementById('popupCloseBtn');
if (popupCloseBtn) popupCloseBtn.addEventListener('click', () => window.close());

// ---------- Google Sheet sync ----------
const sheetUrlInput = document.getElementById('sheetUrlInput');
const saveSheetUrlBtn = document.getElementById('saveSheetUrl');
const syncSheetNowBtn = document.getElementById('syncSheetNow');
const autoSyncToggle = document.getElementById('autoSyncToggle');
const sheetStatus = document.getElementById('sheetStatus');
const helpToggle = document.getElementById('helpToggle');
const helpBody = document.getElementById('helpBody');
const copyScriptBtn = document.getElementById('copyScriptBtn');
const scriptCode = document.getElementById('scriptCode');

helpToggle.addEventListener('click', () => {
  const open = helpBody.classList.toggle('open');
  helpToggle.textContent = (open ? '▾' : '▸') + ' How to set up the Google Sheet';
});
copyScriptBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(scriptCode.textContent);
  copyScriptBtn.textContent = '✓ Copied';
  setTimeout(() => { copyScriptBtn.textContent = '📋 Copy script'; }, 1200);
});

function setSheetStatus(msg, kind = '') {
  sheetStatus.className = 'sheet-status ' + kind;
  sheetStatus.textContent = msg;
}

saveSheetUrlBtn.addEventListener('click', () => {
  const url = (sheetUrlInput.value || '').trim();
  if (url && !/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) {
    setSheetStatus('⚠️ URL must end in /exec from script.google.com', 'err');
    return;
  }
  chrome.storage.local.set({ sheetWebhookUrl: url }, () => {
    setSheetStatus(url ? '✅ URL saved' : 'URL cleared', 'ok');
  });
});

const autoSyncMinutesInput = document.getElementById('autoSyncMinutes');

autoSyncToggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoSyncSheet: autoSyncToggle.checked });
});

function persistMinutes() {
  let n = parseInt(autoSyncMinutesInput.value, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 1440) n = 1440;
  autoSyncMinutesInput.value = n;
  chrome.storage.local.set({ autoSyncMinutes: n });
}
autoSyncMinutesInput.addEventListener('change', persistMinutes);
autoSyncMinutesInput.addEventListener('blur', persistMinutes);

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

function buildSheetPayload(history, scanCount, newFeed, evictedFromFeed) {
  const b = bucketizeForSync(history, scanCount, newFeed, evictedFromFeed);
  const toRows = arr => arr.map((r, i) => ({ rank: i + 1, query: r.query, count: r.count || 1 }));
  return {
    action: 'bucketSync',
    exportedAtCAT: formatCATDateTime(new Date()) + ' CAT',
    all: toRows(b.entries),
    newEntries: toRows(b.newEntries),
    rising: toRows(b.rising),
    dying: toRows(b.dying),
  };
}

async function syncToSheet() {
  return new Promise(resolve => {
    chrome.storage.local.get({ sheetWebhookUrl: '', trendHistory: {}, scanCount: 0, newEntries: [], evictedFromFeed: [] }, async data => {
      if (!data.sheetWebhookUrl) {
        setSheetStatus('⚠️ Save your Web App URL first', 'err');
        return resolve(false);
      }
      const payload = buildSheetPayload(data.trendHistory, data.scanCount, data.newEntries, data.evictedFromFeed);
      if (!payload.all.length) {
        setSheetStatus('⚠️ No data to sync', 'err');
        return resolve(false);
      }
      setSheetStatus('⏳ Syncing ' + payload.all.length + ' rows across 4 sheets...');
      try {
        await fetch(data.sheetWebhookUrl, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        chrome.storage.local.set({ lastSheetSyncAt: Date.now() });
        setSheetStatus('✅ Synced ' + payload.all.length + ' queries at ' + formatCATTime(), 'ok');
        resolve(true);
      } catch (err) {
        setSheetStatus('❌ Sync failed: ' + err.message, 'err');
        resolve(false);
      }
    });
  });
}

syncSheetNowBtn.addEventListener('click', syncToSheet);

function init() {
  chrome.storage.local.get({ autoCapture: false, sheetWebhookUrl: '', autoSyncSheet: false, autoSyncMinutes: 5 }, data => {
    autoToggle.checked = data.autoCapture;
    updateStartPauseBtn(data.autoCapture);
    sheetUrlInput.value = data.sheetWebhookUrl || '';
    autoSyncToggle.checked = !!data.autoSyncSheet;
    autoSyncMinutesInput.value = data.autoSyncMinutes || 5;
  });
  getTrends();
  loadHistory();
  startDurationTimer();
}
init();
