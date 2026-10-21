// Main dashboard V3 — query click modal with Copy/Publish, multi-sheet sync.
const $ = id => document.getElementById(id);
const NEW_ENTRIES_LIMIT = 10;

// ---------- CAT clock ----------
function formatCATTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d) + ' CAT';
}
function formatCATDateForFile(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('day')}|${get('month')}|${get('year')}`;
}
function formatCATDateTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare', hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d).replace(',', '');
}
setInterval(() => { $('catTime').textContent = formatCATTime(); }, 1000);
$('catTime').textContent = formatCATTime();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function escXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- Dark mode ----------
const themeToggleBtn = $('themeToggleBtn');
function applyTheme(dark) {
  document.body.classList.toggle('dark-mode', dark);
  themeToggleBtn.textContent = dark ? '☀️ Light' : '🌙 Dark';
}
chrome.storage.local.get({ dashboardTheme: 'light' }, data => applyTheme(data.dashboardTheme === 'dark'));
themeToggleBtn.addEventListener('click', () => {
  const dark = !document.body.classList.contains('dark-mode');
  applyTheme(dark);
  chrome.storage.local.set({ dashboardTheme: dark ? 'dark' : 'light' });
});

// ---------- Last capture badge ----------
const lastCaptureBadge = $('lastCaptureBadge');
const STALE_CAPTURE_MS = 30 * 60 * 1000; // warn if no capture in 30 minutes
function formatAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function updateCaptureBadge() {
  chrome.storage.local.get({ lastCaptureAt: 0 }, data => {
    if (!data.lastCaptureAt) {
      lastCaptureBadge.textContent = '⏳ No captures yet';
      lastCaptureBadge.classList.remove('stale');
      return;
    }
    const age = Date.now() - data.lastCaptureAt;
    const stale = age > STALE_CAPTURE_MS;
    lastCaptureBadge.textContent = `${stale ? '⚠️' : '✅'} Last capture: ${formatAgo(age)}`;
    lastCaptureBadge.classList.toggle('stale', stale);
  });
}
setInterval(updateCaptureBadge, 5000);
updateCaptureBadge();

// ---------- Start/Pause capturing ----------
const startPauseBtnMain = $('startPauseBtnMain');
const captureStatusMain = $('captureStatusMain');

function updateStartPauseBtnMain(running) {
  startPauseBtnMain.textContent = running ? '⏸ Pause Capturing' : '▶ Start Capturing';
  startPauseBtnMain.classList.toggle('btn-success', !running);
  startPauseBtnMain.classList.toggle('btn-danger', running);
  captureStatusMain.textContent = running
    ? '🔄 Auto-capture RUNNING — captures in an already-open Google tab.'
    : '⏸ Auto-capture paused';
  captureStatusMain.classList.toggle('running', running);
}

function setAutoCaptureMain(enabled) {
  const updates = { autoCapture: enabled };
  chrome.storage.local.get({ runStartedAt: null }, data => {
    if (enabled && !data.runStartedAt) {
      updates.runStartedAt = Date.now();
      updates.cycleCount = 0;
      updates.captureElapsedSeconds = 0;
    }
    chrome.storage.local.set(updates, () => {
      updateStartPauseBtnMain(enabled);
    });
  });
}

startPauseBtnMain.addEventListener('click', () => {
  chrome.storage.local.get({ autoCapture: false }, data => setAutoCaptureMain(!data.autoCapture));
});

chrome.storage.local.get({ autoCapture: false }, data => updateStartPauseBtnMain(!!data.autoCapture));
chrome.storage.onChanged.addListener(changes => {
  if (changes.autoCapture) updateStartPauseBtnMain(!!changes.autoCapture.newValue);
});

// ---------- Capture session timer ----------
// Counts only the time this dashboard tab actively ticked — if the tab gets
// frozen (backgrounded long enough for Chrome's Page Lifecycle freeze), the
// interval below simply stops firing, and nothing is added to the total
// until it resumes. No wall-clock catch-up on resume, by design.
const captureTimerEl = $('captureTimerMain');
let captureTickInterval = null;
let captureLocalSeconds = 0;

function formatHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

function updateCaptureTimerDisplay() {
  captureTimerEl.textContent = `⏱ ${formatHMS(captureLocalSeconds)}`;
}

function startCaptureTicking() {
  if (captureTickInterval) return;
  captureTickInterval = setInterval(() => {
    captureLocalSeconds += 1;
    updateCaptureTimerDisplay();
    chrome.storage.local.set({ captureElapsedSeconds: captureLocalSeconds });
  }, 1000);
}

function stopCaptureTicking() {
  if (captureTickInterval) {
    clearInterval(captureTickInterval);
    captureTickInterval = null;
  }
}

function syncCaptureTimerFromStorage() {
  chrome.storage.local.get({ captureElapsedSeconds: 0, autoCapture: false }, data => {
    captureLocalSeconds = data.captureElapsedSeconds || 0;
    updateCaptureTimerDisplay();
    if (data.autoCapture) startCaptureTicking();
    else stopCaptureTicking();
  });
}
syncCaptureTimerFromStorage();

// Page Lifecycle API — fires when Chrome actually freezes/resumes this tab.
document.addEventListener('freeze', stopCaptureTicking);
document.addEventListener('resume', syncCaptureTimerFromStorage);

chrome.storage.onChanged.addListener(changes => {
  if (changes.autoCapture) {
    if (changes.autoCapture.newValue) syncCaptureTimerFromStorage();
    else stopCaptureTicking();
  }
  // Another tab (e.g. the popup) reset the counter for a fresh session.
  if (changes.captureElapsedSeconds && !captureTickInterval) {
    captureLocalSeconds = changes.captureElapsedSeconds.newValue || 0;
    updateCaptureTimerDisplay();
  }
});





// ---------- Blacklist (in-memory cache, kept in sync with storage) ----------
let blacklistCache = [];
function isBlacklisted(query) {
  if (!query || !blacklistCache.length) return false;
  const lower = String(query).toLowerCase();
  return blacklistCache.some(k => lower.includes(k));
}
function filterBlacklistObjs(arr, getQ = x => x.query) {
  if (!blacklistCache.length) return arr;
  return arr.filter(item => !isBlacklisted(getQ(item)));
}

// ---------- Bucket logic ----------
function bucketize(entries, scanCount, newFeed, evictedFromFeed) {
  const newQueries = newFeed.slice(0, NEW_ENTRIES_LIMIT);
  const newSet = new Set(newQueries.map(e => e.query));
  const evictedSet = new Set(evictedFromFeed || []);
  const recentStart = Math.max(1, scanCount - 2);

  const byQuery = new Map(entries.map(e => [e.query, e]));

  const rising = newQueries
    .map(n => byQuery.get(n.query))
    .filter(Boolean)
    .filter(e => {
      const recentHits = (e.recent || []).filter(s => s >= recentStart).length;
      return e.count >= 3 && recentHits >= 1;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const dying = entries.filter(e => {
    if (newSet.has(e.query)) return false;
    if (!evictedSet.has(e.query)) return false;
    const recentHits = (e.recent || []).filter(s => s >= recentStart).length;
    return recentHits === 0 && e.count >= 2;
  }).sort((a, b) => b.count - a.count).slice(0, 30);

  return { newEntries: newQueries.map(n => byQuery.get(n.query) || { query: n.query, count: 1, recent: [] }), rising, dying };
}

function rowHtml(item, i, deltaLabel, deltaClass) {
  const delta = deltaLabel ? `<span class="delta ${deltaClass}">${deltaLabel}</span>` : '';
  const q = escapeHtml(item.query);
  return `<div class="row" data-q="${q}">
    <span class="num">${i + 1}</span>
    <span class="q">${q}</span>
    ${delta}
    <span class="count">${item.count || 1}×</span>
    <button class="copy-btn" data-q="${q}" title="Copy query">📋</button>
  </div>`;
}
function attachRowHandlers(el) {
  el.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.q);
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 900);
    });
  });
  el.querySelectorAll('.row').forEach(row => {
    row.addEventListener('click', () => openQueryModal(row.dataset.q));
  });
}
function renderList(el, items, deltaLabel, deltaClass) {
  if (!items.length) { el.innerHTML = '<div class="empty">No queries in this category yet</div>'; return; }
  el.innerHTML = items.map((it, i) => rowHtml(it, i, deltaLabel, deltaClass)).join('');
  attachRowHandlers(el);
}

let allEntries = [];
let currentScanCount = 0;
let currentBuckets = { newEntries: [], rising: [], dying: [] };
let publishedList = [];

function render() {
  chrome.storage.local.get({ trendHistory: {}, scanCount: 0, cycleCount: 0, newEntries: [], evictedFromFeed: [], publishedQueries: [], blacklistKeywords: '' }, data => {
    blacklistCache = parseKeywords(data.blacklistKeywords);
    currentScanCount = data.scanCount || 0;
    publishedList = filterBlacklistObjs(data.publishedQueries || []);
    const entries = Object.entries(data.trendHistory)
      .filter(([query]) => !isBlacklisted(query))
      .map(([query, info]) => ({
        query,
        count: info.count,
        recent: info.recent || [],
      }));
    allEntries = entries;

    const totalCaptures = entries.reduce((s, e) => s + e.count, 0);
    $('sTotal').textContent = totalCaptures;
    $('sScans').textContent = data.scanCount || 0;
    $('sUnique').textContent = entries.length;
    $('sNew').textContent = filterBlacklistObjs(data.newEntries || []).length;

    const cleanNew = filterBlacklistObjs(data.newEntries || []);
    const cleanEvicted = (data.evictedFromFeed || []).filter(q => !isBlacklisted(q));
    const buckets = bucketize(entries, currentScanCount, cleanNew, cleanEvicted);
    currentBuckets = buckets;
    $('newCount').textContent = buckets.newEntries.length;
    $('risingCount').textContent = buckets.rising.length;
    $('dyingCount').textContent = buckets.dying.length;

    renderList($('newList'), buckets.newEntries, '🆕 NEW', 'delta-up');
    renderList($('risingList'), buckets.rising, '↑ RISING', 'delta-up');
    renderList($('dyingList'), buckets.dying, '↓ DYING', 'delta-down');

    // Published list
    $('publishedCount').textContent = publishedList.length;
    const pubEl = $('publishedList');
    if (!publishedList.length) {
      pubEl.innerHTML = '<div class="empty">No published queries yet — click any query and press Publish.</div>';
    } else {
      pubEl.innerHTML = publishedList.map((p, i) => {
        const q = escapeHtml(p.query);
        return `<div class="row" data-q="${q}">
          <span class="num">${i + 1}</span>
          <span class="q">${q}</span>
          <span class="count">${formatCATDateTime(new Date(p.publishedAt))}</span>
          <button class="copy-btn" data-q="${q}" title="Copy query">📋</button>
        </div>`;
      }).join('');
      attachRowHandlers(pubEl);
    }

    renderTable($('searchInput').value);
  });
}

let tableSortField = 'count';
let tableSortDir = 'desc';

function trendRank(e, recentStart) {
  const recentHits = (e.recent || []).filter(s => s >= recentStart).length;
  const olderHits = (e.recent || []).filter(s => s < recentStart).length;
  if (recentHits > olderHits && recentHits >= 1) return 2; // up
  if (recentHits === 0 && olderHits >= 1) return 0; // down
  return 1; // flat
}

function renderTable(filter = '') {
  const f = filter.trim().toLowerCase();
  const recentStart = Math.max(1, currentScanCount - 4);
  let filtered = (f ? allEntries.filter(e => e.query.toLowerCase().includes(f)) : allEntries).slice();

  const dir = tableSortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let va, vb;
    if (tableSortField === 'query') { va = a.query.toLowerCase(); vb = b.query.toLowerCase(); }
    else if (tableSortField === 'recent') { va = (a.recent || []).filter(s => s >= recentStart).length; vb = (b.recent || []).filter(s => s >= recentStart).length; }
    else if (tableSortField === 'trend') { va = trendRank(a, recentStart); vb = trendRank(b, recentStart); }
    else { va = a.count; vb = b.count; } // 'count' or default
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  document.querySelectorAll('#dataTable th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === tableSortField) {
      arrow.textContent = tableSortDir === 'asc' ? '▲' : '▼';
      arrow.classList.add('active');
    } else {
      arrow.textContent = '';
      arrow.classList.remove('active');
    }
  });

  if (!filtered.length) {
    $('tableBody').innerHTML = '<tr><td colspan="6" class="empty">No data</td></tr>';
    return;
  }
  $('tableBody').innerHTML = filtered.map((e, i) => {
    const recentHits = (e.recent || []).filter(s => s >= recentStart).length;
    const olderHits = (e.recent || []).filter(s => s < recentStart).length;
    let trend = '—';
    if (recentHits > olderHits && recentHits >= 1) trend = '<span class="delta delta-up">↑</span>';
    else if (recentHits === 0 && olderHits >= 1) trend = '<span class="delta delta-down">↓</span>';
    const q = escapeHtml(e.query);
    return `<tr data-q="${q}" class="clickable-row">
      <td>${i + 1}</td>
      <td>${q}</td>
      <td>${e.count}</td>
      <td>${recentHits} / ${(e.recent || []).length}</td>
      <td>${trend}</td>
      <td><button class="copy-btn" data-q="${q}" title="Copy query">📋</button></td>
    </tr>`;
  }).join('');
  $('tableBody').querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.q);
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 900);
    });
  });
  $('tableBody').querySelectorAll('tr.clickable-row').forEach(tr => {
    tr.addEventListener('click', () => openQueryModal(tr.dataset.q));
  });
}

document.querySelectorAll('#dataTable th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (field === 'rank') { tableSortField = 'count'; tableSortDir = 'desc'; }
    else if (tableSortField === field) { tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc'; }
    else { tableSortField = field; tableSortDir = field === 'query' ? 'asc' : 'desc'; }
    renderTable($('searchInput').value);
  });
});

// ---------- CSV export (respects current search + sort) ----------
function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
$('csvExportBtn').addEventListener('click', () => {
  const f = $('searchInput').value.trim().toLowerCase();
  const recentStart = Math.max(1, currentScanCount - 4);
  let rows = (f ? allEntries.filter(e => e.query.toLowerCase().includes(f)) : allEntries).slice();
  const dir = tableSortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va, vb;
    if (tableSortField === 'query') { va = a.query.toLowerCase(); vb = b.query.toLowerCase(); }
    else if (tableSortField === 'recent') { va = (a.recent || []).filter(s => s >= recentStart).length; vb = (b.recent || []).filter(s => s >= recentStart).length; }
    else if (tableSortField === 'trend') { va = trendRank(a, recentStart); vb = trendRank(b, recentStart); }
    else { va = a.count; vb = b.count; }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  if (!rows.length) { alert('No data to export.'); return; }
  const header = ['#', 'Query', 'Times Seen', 'Recent Hits', 'Recent Total', 'Trend'];
  const lines = [header.join(',')];
  rows.forEach((e, i) => {
    const recentHits = (e.recent || []).filter(s => s >= recentStart).length;
    const total = (e.recent || []).length;
    const olderHits = (e.recent || []).filter(s => s < recentStart).length;
    let trend = 'flat';
    if (recentHits > olderHits && recentHits >= 1) trend = 'up';
    else if (recentHits === 0 && olderHits >= 1) trend = 'down';
    lines.push([i + 1, csvEscape(e.query), e.count, recentHits, total, trend].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trending Queries ${formatCATDateForFile()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});


$('searchInput').addEventListener('input', e => renderTable(e.target.value));

// ---------- Copy-all bucket buttons ----------
document.querySelectorAll('.copy-all-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.copy;
    let list = [];
    if (which === 'new') list = currentBuckets.newEntries.map(e => e.query);
    else if (which === 'rising') list = currentBuckets.rising.map(e => e.query);
    else if (which === 'dying') list = currentBuckets.dying.map(e => e.query);
    else if (which === 'all') list = allEntries.slice().sort((a, b) => b.count - a.count).map(e => e.query);
    else if (which === 'published') list = publishedList.map(p => p.query);
    if (!list.length) return;
    navigator.clipboard.writeText(list.join('\n'));
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
});

// ---------- Query modal (stats + Copy + Publish) ----------
const modal = $('queryModal');
const modalQuery = $('modalQuery');
const modalStats = $('modalStats');
const modalCopyBtn = $('modalCopyBtn');
const modalPublishBtn = $('modalPublishBtn');
const modalClose = $('modalClose');
const modalBackdrop = $('modalBackdrop');
let activeQuery = null;

// ---------- Query trend line chart (cumulative "times seen" over scans) ----------
function renderQueryChart(container, info, scanCount) {
  const recent = (info.recent || []).slice().sort((a, b) => a - b);
  if (!recent.length) {
    container.innerHTML = '<div class="empty" style="padding:16px 0;">Not enough data yet for a graph.</div>';
    return;
  }
  const points = recent.map((scanIdx, i) => ({ x: scanIdx, y: i + 1 }));
  // Extend the line flat up to "now" so it reads as a timeline, not just hit points.
  const lastY = points[points.length - 1].y;
  if (points[points.length - 1].x < scanCount) {
    points.push({ x: scanCount, y: lastY });
  }
  const w = 380, h = 140, padL = 30, padR = 12, padT = 14, padB = 22;
  const minX = points[0].x;
  const maxX = Math.max(points[points.length - 1].x, minX + 1);
  const maxY = Math.max(lastY, 1);
  const sx = x => padL + ((x - minX) / (maxX - minX)) * (w - padL - padR);
  const sy = y => (h - padB) - (y / maxY) * (h - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  const dots = points.map(p => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" class="chart-dot" />`).join('');
  const isDark = document.body.classList.contains('dark-mode');
  const strokeColor = isDark ? '#6fa8ff' : '#1e2a47';
  const gridColor = isDark ? '#2a3247' : '#e7eaf1';
  const textColor = isDark ? '#6b7385' : '#8a92a0';
  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" class="query-chart-svg">
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="${gridColor}" stroke-width="1" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="${gridColor}" stroke-width="1" />
      <path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="2" />
      ${dots}
      <text x="${padL}" y="${h - 6}" font-size="9" fill="${textColor}">scan ${minX}</text>
      <text x="${w - padR}" y="${h - 6}" font-size="9" fill="${textColor}" text-anchor="end">scan ${maxX}</text>
      <text x="${padL - 6}" y="${padT + 4}" font-size="9" fill="${textColor}" text-anchor="end">${maxY}</text>
      <text x="${padL - 6}" y="${h - padB}" font-size="9" fill="${textColor}" text-anchor="end">0</text>
    </svg>
    <div class="chart-caption">Cumulative times seen, from its first capture (scan ${minX}) to now (scan ${maxX}).</div>
  `;
}

function openQueryModal(query) {
  activeQuery = query;
  modalQuery.textContent = query;
  chrome.storage.local.get({ trendHistory: {}, newEntries: [], evictedFromFeed: [], scanCount: 0, publishedQueries: [] }, data => {
    const info = data.trendHistory[query] || { count: 0, firstSeen: null, lastSeen: null, recent: [] };
    const recentStart = Math.max(1, (data.scanCount || 0) - 2);
    const recentHits = (info.recent || []).filter(s => s >= recentStart).length;
    const fmt = iso => iso ? formatCATDateTime(new Date(iso)) + ' CAT' : '—';
    const alreadyPublished = (data.publishedQueries || []).some(p => p.query === query);
    modalPublishBtn.disabled = alreadyPublished;
    modalPublishBtn.textContent = alreadyPublished ? '✓ Already Published' : '📤 Publish';
    modalStats.innerHTML = `
      <div class="stat-row"><span>Times seen</span><strong>${info.count}×</strong></div>
      <div class="stat-row"><span>Recent (last 3 cycles)</span><strong>${recentHits} hit(s)</strong></div>
      <div class="stat-row"><span>First seen</span><strong>${fmt(info.firstSeen)}</strong></div>
      <div class="stat-row"><span>Last seen</span><strong>${fmt(info.lastSeen)}</strong></div>
    `;
    renderQueryChart($('modalChart'), info, data.scanCount || 0);
  });
  modal.classList.add('open');
}
function closeModal() { modal.classList.remove('open'); activeQuery = null; }
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

modalCopyBtn.addEventListener('click', () => {
  if (!activeQuery) return;
  navigator.clipboard.writeText(activeQuery);
  modalCopyBtn.textContent = '✓ Copied';
  setTimeout(() => { modalCopyBtn.textContent = '📋 Copy'; }, 1200);
});

modalPublishBtn.addEventListener('click', () => {
  if (!activeQuery) return;
  const query = activeQuery;
  modalPublishBtn.disabled = true;
  modalPublishBtn.textContent = '⏳ Publishing...';
  chrome.storage.local.get({ publishedQueries: [], sheetWebhookUrl: '', trendHistory: {} }, async data => {
    if ((data.publishedQueries || []).some(p => p.query === query)) {
      modalPublishBtn.textContent = '✓ Already Published';
      return;
    }
    const entry = { query, publishedAt: new Date().toISOString() };
    const updated = [entry, ...(data.publishedQueries || [])];
    chrome.storage.local.set({ publishedQueries: updated }, async () => {
      // Push to Google Sheet "Published" tab if URL configured
      if (data.sheetWebhookUrl) {
        try {
          await fetch(data.sheetWebhookUrl, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'publish', query, publishedAtCAT: formatCATDateTime() + ' CAT' }),
          });
        } catch (e) { console.warn('publish sync failed', e); }
      }
      modalPublishBtn.textContent = '✓ Published';
      render();
    });
  });
});

// ---------- Excel export (multi-sheet) ----------
$('exportBtn').addEventListener('click', () => {
  chrome.storage.local.get({ trendHistory: {}, newEntries: [], evictedFromFeed: [], scanCount: 0, publishedQueries: [], blacklistKeywords: '' }, data => {
    blacklistCache = parseKeywords(data.blacklistKeywords);
    const entries = Object.entries(data.trendHistory)
      .filter(([query]) => !isBlacklisted(query))
      .map(([query, info]) => ({ query, count: info.count, recent: info.recent || [] }));
    if (!entries.length) { alert('No data to export yet.'); return; }
    entries.sort((a, b) => b.count - a.count);

    const cleanNew = filterBlacklistObjs(data.newEntries || []);
    const cleanEvicted = (data.evictedFromFeed || []).filter(q => !isBlacklisted(q));
    const buckets = bucketize(entries, data.scanCount || 0, cleanNew, cleanEvicted);

    const headerQuery = '<Row>'
      + '<Cell><Data ss:Type="String">Rank</Data></Cell>'
      + '<Cell><Data ss:Type="String">Search Query</Data></Cell>'
      + '<Cell><Data ss:Type="String">Times Seen</Data></Cell>'
      + '</Row>';
    const buildQueryRows = arr => arr.map((e, i) =>
      `<Row><Cell><Data ss:Type="Number">${i + 1}</Data></Cell>`
      + `<Cell><Data ss:Type="String">${escXml(e.query)}</Data></Cell>`
      + `<Cell><Data ss:Type="Number">${e.count || 1}</Data></Cell></Row>`
    ).join('');

    const headerPub = '<Row><Cell><Data ss:Type="String">Published Query</Data></Cell></Row>';
    const buildPubRows = arr => arr.map(p =>
      `<Row><Cell><Data ss:Type="String">${escXml(p.query)}</Data></Cell></Row>`
    ).join('');

    const exportedAt = formatCATDateTime() + ' CAT';
    const metaRow = `<Row><Cell><Data ss:Type="String">Exported (CAT)</Data></Cell><Cell><Data ss:Type="String">${escXml(exportedAt)}</Data></Cell></Row>`;
    const cols3 = `<Column ss:Width="40"/><Column ss:Width="320"/><Column ss:Width="80"/>`;
    const cols1 = `<Column ss:Width="320"/>`;

    const sheet = (name, cols, body) =>
      `<Worksheet ss:Name="${name}"><Table>${cols}${body}</Table></Worksheet>`;

    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>`
      + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
      + sheet('All Captured Queries', cols3, metaRow + headerQuery + buildQueryRows(entries))
      + sheet('New Entries', cols3, headerQuery + buildQueryRows(buckets.newEntries))
      + sheet('Rising Queries', cols3, headerQuery + buildQueryRows(buckets.rising))
      + sheet('Dying Queries', cols3, headerQuery + buildQueryRows(buckets.dying))
      + sheet('Published Queries', cols1, headerPub + buildPubRows(filterBlacklistObjs(data.publishedQueries || [])))
      + `</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Trending Queries ${formatCATDateForFile()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

// ---------- Data pruning (keep storage from growing forever) ----------
async function purgeStaleEntries(days) {
  return new Promise(resolve => {
    chrome.storage.local.get({
      trendHistory: {}, newEntries: [], evictedFromFeed: [], publishedQueries: [],
    }, data => {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const publishedSet = new Set((data.publishedQueries || []).map(p => p.query));
      let removed = 0;
      const newHistory = {};
      Object.entries(data.trendHistory).forEach(([q, info]) => {
        const lastSeenMs = info.lastSeen ? new Date(info.lastSeen).getTime() : 0;
        // Never remove published queries, even if stale — they're a permanent record.
        if (!publishedSet.has(q) && lastSeenMs && lastSeenMs < cutoff) {
          removed++;
          return;
        }
        newHistory[q] = info;
      });
      if (!removed) { resolve(0); return; }
      const newFeed = (data.newEntries || []).filter(e => newHistory[e.query]);
      const newEvicted = (data.evictedFromFeed || []).filter(q => newHistory[q]);
      chrome.storage.local.set({
        trendHistory: newHistory,
        newEntries: newFeed,
        evictedFromFeed: newEvicted,
      }, () => resolve(removed));
    });
  });
}

const purgeMsg = $('purgeMsg');
$('purgeBtn').addEventListener('click', async () => {
  const input = prompt('Purge captured queries not seen in the last N days (published queries are always kept).\n\nEnter N:', '90');
  if (input === null) return;
  const days = parseInt(input, 10);
  if (!Number.isFinite(days) || days < 1) { alert('Enter a whole number of days (1 or more).'); return; }
  const removed = await purgeStaleEntries(days);
  purgeMsg.style.color = removed ? '#0e6b46' : '#5b6472';
  purgeMsg.textContent = removed
    ? `✅ Purged ${removed} quer${removed === 1 ? 'y' : 'ies'} not seen in ${days}+ days.`
    : `No queries older than ${days} days found.`;
  setTimeout(() => { purgeMsg.textContent = ''; }, 6000);
  render();
});

// Silent background trim so storage doesn't grow unbounded — runs once per dashboard load.
setTimeout(() => { purgeStaleEntries(180); }, 3000);

// ---------- Reset all data (double-confirm) ----------
$('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset ALL data? This clears every captured query, scan count, cycle count, run timer, New Entries feed and Published list.')) return;
  if (!confirm('Are you ABSOLUTELY sure? This action cannot be undone.')) return;
  chrome.storage.local.set({
    trendHistory: {}, scanCount: 0, cycleCount: 0, runStartedAt: null,
    autoCapture: false, newEntries: [], evictedFromFeed: [], publishedQueries: [],
    captureElapsedSeconds: 0,
  }, () => render());
});


// ---------- Google Sheet sync ----------
const sheetMsg = $('sheetMsg');
function setSheetMsg(text, color = '#6b7280') {
  sheetMsg.style.color = color;
  sheetMsg.textContent = text;
}

$('syncSheetBtn').addEventListener('click', () => {
  syncSheetToGoogle();
});

let sheetSyncInProgress = false;
async function syncSheetToGoogle() {
  if (sheetSyncInProgress) return;
  sheetSyncInProgress = true;
  try {
    const data = await new Promise(resolve => chrome.storage.local.get({
      sheetWebhookUrl: '', trendHistory: {}, newEntries: [], evictedFromFeed: [],
      scanCount: 0, blacklistKeywords: '',
    }, resolve));
    if (!data.sheetWebhookUrl) {
      setSheetMsg('⚠️ Add a Google Apps Script Web App URL in the extension popup to enable auto-sync.', '#b45309');
      return;
    }
    blacklistCache = parseKeywords(data.blacklistKeywords);
    const entries = Object.entries(data.trendHistory)
      .filter(([query]) => !isBlacklisted(query))
      .map(([query, info]) => ({ query, count: info.count, recent: info.recent || [] }));
    entries.sort((a, b) => b.count - a.count);
    const cleanNew = filterBlacklistObjs(data.newEntries || []);
    const cleanEvicted = (data.evictedFromFeed || []).filter(q => !isBlacklisted(q));
    const buckets = bucketize(entries, data.scanCount || 0, cleanNew, cleanEvicted);
    const toRows = arr => arr.map((r, i) => ({ rank: i + 1, query: r.query, count: r.count || 1 }));
    const payload = {
      action: 'bucketSync',
      exportedAtCAT: formatCATDateTime() + ' CAT',
      all: toRows(entries),
      newEntries: toRows(buckets.newEntries),
      rising: toRows(buckets.rising),
      dying: toRows(buckets.dying),
    };
    setSheetMsg('⏳ Syncing all sheets to Google Sheet...');
    await fetch(data.sheetWebhookUrl, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    chrome.storage.local.set({ lastSheetSyncAt: Date.now() });
    setSheetMsg('✅ Synced ' + entries.length + ' queries across 4 sheets at ' + formatCATTime(), '#065f46');
  } catch (err) {
    setSheetMsg('❌ Sync failed: ' + err.message, '#991b1b');
  } finally {
    sheetSyncInProgress = false;
  }
}

syncSheetToGoogle();
setInterval(syncSheetToGoogle, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncSheetToGoogle();
});

// ---------- Reset Google Sheet (clears ALL tabs including Published) ----------
$('resetSheetBtn').addEventListener('click', () => {
  if (!confirm('Reset the entire Google Sheet? This clears ALL tabs (including Published Queries), but existing local data will be synced back within 5 seconds while this dashboard stays open. This cannot be undone.')) return;
  chrome.storage.local.get({ sheetWebhookUrl: '' }, async data => {
    if (!data.sheetWebhookUrl) { setSheetMsg('⚠️ Save your Web App URL in the popup first.', '#b45309'); return; }
    setSheetMsg('⏳ Resetting Google Sheet...');
    try {
      await fetch(data.sheetWebhookUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'reset', resetAtCAT: formatCATDateTime() + ' CAT' }),
      });
      setSheetMsg('✅ Google Sheet reset request sent at ' + formatCATTime(), '#065f46');
    } catch (err) {
      setSheetMsg('❌ Reset failed: ' + err.message, '#991b1b');
    }
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.trendHistory || changes.scanCount || changes.cycleCount || changes.newEntries || changes.evictedFromFeed || changes.publishedQueries) render();
});

render();
setInterval(render, 2000);

function parseKeywords(text) {
  return (text || '')
    .split('\n')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}
// Note: the Blacklist management card has been removed from the dashboard.
// isBlacklisted()/blacklistCache (defined near the top of this file) are
// still used by render(), export, and sync to keep filtering
// any already-blacklisted queries out of results, but blacklistKeywords can
// no longer be edited from the UI.
