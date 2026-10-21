// Trending Searches Copier — V2
// New Entries feed (max 10, newest first).

const NEW_ENTRIES_LIMIT = 10;

const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const topListEl = document.getElementById('topList');
const allListEl = document.getElementById('allList');
const autoToggle = document.getElementById('autoToggle');
const captureStats = document.getElementById('captureStats');
const startPauseBtn = document.getElementById('startPauseBtn');
const runDurationEl = document.getElementById('runDuration');
const cyclesCountEl = document.getElementById('cyclesCount');
const localTimeEl = document.getElementById('localTime');
const statTotalEl = document.getElementById('statTotal');
const statScansEl = document.getElementById('statScans');
const statUniqueEl = document.getElementById('statUnique');
const statNewEl = document.getElementById('statNew');
const newEntriesListEl = document.getElementById('newEntriesList');
const newPill = document.getElementById('newPill');
const copyNewAllBtn = document.getElementById('copyNewAll');

let durationTimer = null;

// ---------- Local time helpers ----------
function formatLocalTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d);
}
function formatLocalDateForFile(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('day')}|${get('month')}|${get('year')}`;
}
function formatLocalDateTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d).replace(',', '');
}
function tickLocalClock() { localTimeEl.textContent = formatLocalTime(); }
setInterval(tickLocalClock, 1000); tickLocalClock();

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active');
  });
});

const GOOGLE_URL_PATTERNS = [
  '*://www.google.com/*', '*://www.google.co.uk/*', '*://www.google.co.za/*',
  '*://www.google.co.in/*', '*://www.google.com.au/*', '*://www.google.com.br/*',
  '*://www.google.ca/*', '*://www.google.de/*', '*://www.google.fr/*',
];

async function getTrends() {
  const tabs = await chrome.tabs.query({ url: GOOGLE_URL_PATTERNS });
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(candidate => candidate.id === activeTab?.id) || tabs[0];
  if (!tab) {
    statusEl.className = 'status inactive';
    statusEl.textContent = '⚠️ Keep a Google tab open; you can use any tab.';
    return null;
  }
  statusEl.className = 'status active';
  statusEl.textContent = '✅ Google tab found — the active tab can be anything.';
  copyBtn.disabled = false;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type: 'GTS_GET_TRENDS' }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[GTS] Could not read suggestions from Google tab', chrome.runtime.lastError.message);
        statusEl.className = 'status inactive';
        statusEl.textContent = '⚠️ Refresh the open Google tab to enable scanning.';
        resolve([]);
        return;
      }
      resolve(response?.trends || []);
    });
  });
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
    captureStats.innerHTML = '🔄 Auto-capture <strong>RUNNING</strong> — uses an open Google tab in the background.';
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
    const exportedAt = formatLocalDateTime() + ' Local';
    const metaRow = `<Row><Cell><Data ss:Type="String">Exported (Local Time)</Data></Cell><Cell><Data ss:Type="String">${escXml(exportedAt)}</Data></Cell></Row>`;
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
    a.download = `Trending Queries ${formatLocalDateForFile()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = `✅ Exported "${a.download}"`;
  });
}

copyBtn.addEventListener('click', async () => {
  const trends = await getTrends();
  if (!trends || trends.length === 0) {
    statusEl.className = 'status inactive';
    statusEl.textContent = '⚠️ No suggestions found. Open Google in any tab and show suggestions.';
    return;
  }
  await saveTrends(trends);
  await navigator.clipboard.writeText(trends.join('\n'));
  statusEl.textContent = `✅ Copied & saved ${trends.length} searches!`;
  loadHistory();
});

exportBtn.addEventListener('click', exportToExcel);

document.getElementById('resetDataBtn').addEventListener('click', () => {
  if (!confirm('Reset all captured data in this Chrome profile? This clears local query history, scan and cycle counts, and published-query history. It does not directly clear Google Sheets. This cannot be undone.')) return;
  chrome.storage.local.set({
    trendHistory: {},
    scanCount: 0,
    cycleCount: 0,
    runStartedAt: null,
    autoCapture: false,
    newEntries: [],
    evictedFromFeed: [],
    publishedQueries: [],
    captureElapsedSeconds: 0,
    lastCaptureAt: 0,
    lastSheetSyncScanCount: 0,
  }, () => {
    if (chrome.runtime.lastError) {
      statusEl.className = 'status inactive';
      statusEl.textContent = '❌ Reset failed: ' + chrome.runtime.lastError.message;
      return;
    }
    loadHistory();
    updateStartPauseBtn(false);
    refreshRunDisplay();
    statusEl.className = 'status active';
    statusEl.textContent = '✅ Captured data reset';
  });
});

// Close popup button
const popupCloseBtn = document.getElementById('popupCloseBtn');
if (popupCloseBtn) popupCloseBtn.addEventListener('click', () => window.close());

// ---------- Google Sheet sync ----------
const sheetUrlInput = document.getElementById('sheetUrlInput');
const saveSheetUrlBtn = document.getElementById('saveSheetUrl');
const syncSheetNowBtn = document.getElementById('syncSheetNow');
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
    exportedAtLocalTime: formatLocalDateTime() + ' Local',
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
        chrome.storage.local.set({
          lastSheetSyncAt: Date.now(),
          lastSheetSyncScanCount: data.scanCount || 0,
        });
        setSheetStatus('✅ Synced ' + payload.all.length + ' queries at ' + formatLocalTime(), 'ok');
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
  chrome.storage.local.get({ autoCapture: false, sheetWebhookUrl: '' }, data => {
    autoToggle.checked = data.autoCapture;
    updateStartPauseBtn(data.autoCapture);
    sheetUrlInput.value = data.sheetWebhookUrl || '';
  });
  getTrends();
  loadHistory();
  startDurationTimer();
}
init();
