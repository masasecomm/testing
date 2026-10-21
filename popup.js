// Trending Searches Copier — V2
// CAT (Africa/Harare, UTC+2).
const NEW_ENTRIES_LIMIT = 10;
const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const resetDataBtn = document.getElementById('resetDataBtn');
const autoToggle = document.getElementById('autoToggle');
const captureStats = document.getElementById('captureStats');
const startPauseBtn = document.getElementById('startPauseBtn');
const runDurationEl = document.getElementById('runDuration');
const cyclesCountEl = document.getElementById('cyclesCount');
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
  return new Promise((resolve, reject) => {
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
      chrome.storage.local.set({
        trendHistory: history,
        scanCount: scanIdx,
        newEntries: feed,
        lastCaptureAt: Date.now(),
      }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(history);
      });
    });
  });
}

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
  if (changes.sheetWebhookUrl) {
    const v = changes.sheetWebhookUrl.newValue || '';
    if (document.activeElement !== sheetUrlInput) sheetUrlInput.value = v;
  }
  if (changes.lastSheetSyncError && changes.lastSheetSyncError.newValue) {
    setSheetStatus('❌ Automatic sync failed: ' + changes.lastSheetSyncError.newValue, 'err');
  } else if (changes.lastSheetSyncAt && Number(changes.lastSheetSyncAt.newValue) > 0) {
    setSheetStatus('✅ Google Sheet updated at ' + formatCATTime(new Date(changes.lastSheetSyncAt.newValue)), 'ok');
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
  try {
    await saveTrends(trends);
    try {
      await navigator.clipboard.writeText(trends.join('\n'));
      statusEl.textContent = `✅ Copied, saved, and syncing ${trends.length} searches to Google Sheets.`;
    } catch (error) {
      statusEl.textContent = `✅ Saved ${trends.length} searches and syncing to Google Sheets; clipboard copy failed: ${error.message}`;
    }
  } catch (error) {
    statusEl.className = 'status inactive';
    statusEl.textContent = '❌ Could not save the scan: ' + error.message;
  }
});

exportBtn.addEventListener('click', exportToExcel);

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

resetDataBtn.addEventListener('click', async () => {
  if (!confirm('Reset all captured data locally and clear the query tabs in the connected Google Sheet? This cannot be undone.')) return;
  resetDataBtn.disabled = true;
  setSheetStatus('⏳ Resetting captured data...');

  try {
    const data = await new Promise((resolve, reject) => {
      chrome.storage.local.get({ sheetWebhookUrl: '' }, result => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ autoCapture: false }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    autoToggle.checked = false;
    updateStartPauseBtn(false);

    if (data.sheetWebhookUrl) {
      await fetch(data.sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'reset' }),
      });
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({
        trendHistory: {},
        scanCount: 0,
        cycleCount: 0,
        newEntries: [],
        evictedFromFeed: [],
        runStartedAt: null,
        captureElapsedSeconds: 0,
        lastCaptureAt: 0,
        lastSheetSyncAt: 0,
        lastSheetSyncScanCount: 0,
        lastSheetSyncError: '',
      }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    cyclesCountEl.textContent = '0';
    runDurationEl.textContent = '00:00:00';
    setSheetStatus(
      data.sheetWebhookUrl
        ? '✅ Local data reset and Google Sheet reset request sent.'
        : '✅ Local data reset. Add a Sheet URL to reset the Google Sheet too.',
      data.sheetWebhookUrl ? 'ok' : 'err',
    );
  } catch (error) {
    setSheetStatus('❌ Reset failed: ' + error.message, 'err');
  } finally {
    resetDataBtn.disabled = false;
  }
});

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
        chrome.storage.local.set({
          lastSheetSyncAt: Date.now(),
          lastSheetSyncScanCount: data.scanCount || 0,
          lastSheetSyncError: '',
        });
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
  chrome.storage.local.get({
    autoCapture: false,
    sheetWebhookUrl: '',
    lastSheetSyncAt: 0,
    lastSheetSyncError: '',
  }, data => {
    autoToggle.checked = data.autoCapture;
    updateStartPauseBtn(data.autoCapture);
    sheetUrlInput.value = data.sheetWebhookUrl || '';
    if (data.lastSheetSyncError) {
      setSheetStatus('❌ Last automatic sync failed: ' + data.lastSheetSyncError, 'err');
    } else if (data.lastSheetSyncAt) {
      setSheetStatus('✅ Last Google Sheet update at ' + formatCATTime(new Date(data.lastSheetSyncAt)), 'ok');
    }
  });
  getTrends();
  startDurationTimer();
}
init();
