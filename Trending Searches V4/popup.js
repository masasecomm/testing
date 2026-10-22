const resetDataBtn = document.getElementById('resetDataBtn');
const sheetUrlInput = document.getElementById('sheetUrlInput');
const saveSheetUrlBtn = document.getElementById('saveSheetUrl');
const sheetStatus = document.getElementById('sheetStatus');
const helpToggle = document.getElementById('helpToggle');
const helpBody = document.getElementById('helpBody');
const copyScriptBtn = document.getElementById('copyScriptBtn');
const scriptCode = document.getElementById('scriptCode');

function setSheetStatus(message, kind = '') {
  sheetStatus.className = 'sheet-status ' + kind;
  sheetStatus.textContent = message;
}

function getLocalData(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, data => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(data);
    });
  });
}

function setLocalData(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function formatCATTime(timestamp) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

helpToggle.addEventListener('click', () => {
  const open = helpBody.classList.toggle('open');
  helpToggle.textContent = (open ? '▾' : '▸') + ' How to set up the Google Sheet';
});

copyScriptBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(scriptCode.textContent);
    copyScriptBtn.textContent = '✓ Copied';
    setTimeout(() => { copyScriptBtn.textContent = '📋 Copy script'; }, 1200);
  } catch (error) {
    setSheetStatus('❌ Could not copy the setup script: ' + error.message, 'err');
  }
});

resetDataBtn.addEventListener('click', async () => {
  if (!confirm('Reset all captured data locally and clear the query tabs in the connected Google Sheet? This cannot be undone.')) return;
  resetDataBtn.disabled = true;
  setSheetStatus('⏳ Resetting captured data...');

  try {
    const { sheetWebhookUrl } = await getLocalData({ sheetWebhookUrl: '' });
    if (sheetWebhookUrl) {
      await fetch(sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'reset' }),
      });
    }

    await setLocalData({
      trendHistory: {},
      scanCount: 0,
      cycleCount: 0,
      newEntries: [],
      timestampEntries: [],
      evictedFromFeed: [],
      runStartedAt: null,
      captureElapsedSeconds: 0,
      lastCaptureAt: 0,
      lastSheetSyncAt: 0,
      lastSheetSyncScanCount: 0,
      lastSheetSyncError: '',
    });
    setSheetStatus(
      sheetWebhookUrl
        ? '✅ Local data reset and Google Sheet reset request sent.'
        : '✅ Local data reset. Add a Sheet URL to reset the Google Sheet too.',
      sheetWebhookUrl ? 'ok' : 'err',
    );
  } catch (error) {
    setSheetStatus('❌ Reset failed: ' + error.message, 'err');
  } finally {
    resetDataBtn.disabled = false;
  }
});

saveSheetUrlBtn.addEventListener('click', async () => {
  const url = (sheetUrlInput.value || '').trim();
  if (url && !/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) {
    setSheetStatus('⚠️ URL must end in /exec from script.google.com', 'err');
    return;
  }
  try {
    await setLocalData({ sheetWebhookUrl: url });
    setSheetStatus(url ? '✅ URL saved' : 'URL cleared', 'ok');
  } catch (error) {
    setSheetStatus('❌ Could not save the URL: ' + error.message, 'err');
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sheetWebhookUrl) {
    const value = changes.sheetWebhookUrl.newValue || '';
    if (document.activeElement !== sheetUrlInput) sheetUrlInput.value = value;
  }
  if (changes.lastSheetSyncError && changes.lastSheetSyncError.newValue) {
    setSheetStatus('❌ Automatic sync failed: ' + changes.lastSheetSyncError.newValue, 'err');
  } else if (changes.lastSheetSyncAt && Number(changes.lastSheetSyncAt.newValue) > 0) {
    setSheetStatus('✅ Google Sheet updated at ' + formatCATTime(changes.lastSheetSyncAt.newValue), 'ok');
  }
});

async function init() {
  try {
    const data = await getLocalData({
      sheetWebhookUrl: '',
      lastSheetSyncAt: 0,
      lastSheetSyncError: '',
    });
    sheetUrlInput.value = data.sheetWebhookUrl || '';
    if (data.lastSheetSyncError) {
      setSheetStatus('❌ Last automatic sync failed: ' + data.lastSheetSyncError, 'err');
    } else if (data.lastSheetSyncAt) {
      setSheetStatus('✅ Last Google Sheet update at ' + formatCATTime(data.lastSheetSyncAt), 'ok');
    }
  } catch (error) {
    setSheetStatus('❌ Could not load settings: ' + error.message, 'err');
  }
}

init();
