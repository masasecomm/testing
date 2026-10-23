const resetDataBtn = document.getElementById('resetDataBtn');
const sheetUrlInput = document.getElementById('sheetUrlInput');
const saveSheetUrlBtn = document.getElementById('saveSheetUrl');
const changeSheetUrlBtn = document.getElementById('changeSheetUrl');
const sheetBox = sheetUrlInput.closest('.sheet-box');
const sheetStatus = document.getElementById('sheetStatus');
const captureToggle = document.getElementById('captureToggle');

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

function formatCentralTime(timestamp) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function updateCaptureButton(isRunning) {
  captureToggle.textContent = isRunning ? 'Pause' : 'Start';
  captureToggle.classList.toggle('running', isRunning);
  captureToggle.setAttribute('aria-pressed', String(isRunning));
}

captureToggle.addEventListener('click', async () => {
  captureToggle.disabled = true;
  try {
    const { autoCapture } = await getLocalData({ autoCapture: false });
    if (autoCapture) {
      await setLocalData({ autoCapture: false, captureTabId: null });
      updateCaptureButton(false);
      return;
    }

    const response = await chrome.runtime.sendMessage({ action: 'startGoogleCapture' });
    if (!response || !response.ok) throw new Error(response?.error || 'Could not open Google.');
    updateCaptureButton(true);
    setSheetStatus('✅ Google tab opened. Scanning will start when it finishes loading.', 'ok');
  } catch (error) {
    setSheetStatus('❌ Could not change scanning state: ' + error.message, 'err');
  } finally {
    captureToggle.disabled = false;
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
      autoCapture: false,
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
    sheetBox.classList.toggle('url-saved', Boolean(url));
    setSheetStatus(url ? '✅ URL saved' : 'URL cleared', 'ok');
  } catch (error) {
    setSheetStatus('❌ Could not save the URL: ' + error.message, 'err');
  }
});

changeSheetUrlBtn.addEventListener('click', () => {
  sheetBox.classList.remove('url-saved');
  sheetUrlInput.focus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.autoCapture) updateCaptureButton(!!changes.autoCapture.newValue);
  if (changes.captureError && changes.captureError.newValue) {
    setSheetStatus('❌ Scanning stopped: ' + changes.captureError.newValue, 'err');
  }
  if (changes.sheetWebhookUrl) {
    const value = changes.sheetWebhookUrl.newValue || '';
    if (document.activeElement !== sheetUrlInput) sheetUrlInput.value = value;
    sheetBox.classList.toggle('url-saved', Boolean(value));
  }
  if (changes.lastSheetSyncError && changes.lastSheetSyncError.newValue) {
    setSheetStatus('❌ Automatic sync failed: ' + changes.lastSheetSyncError.newValue, 'err');
  } else if (changes.lastSheetSyncAt && Number(changes.lastSheetSyncAt.newValue) > 0) {
    setSheetStatus('✅ Google Sheet updated at ' + formatCentralTime(changes.lastSheetSyncAt.newValue) + ' Central Time', 'ok');
  }
});

async function init() {
  try {
    const data = await getLocalData({
      sheetWebhookUrl: '',
      autoCapture: false,
      captureError: '',
      lastSheetSyncAt: 0,
      lastSheetSyncError: '',
    });
    updateCaptureButton(data.autoCapture);
    sheetUrlInput.value = data.sheetWebhookUrl || '';
    sheetBox.classList.toggle('url-saved', Boolean(data.sheetWebhookUrl));
    if (data.lastSheetSyncError) {
      setSheetStatus('❌ Last automatic sync failed: ' + data.lastSheetSyncError, 'err');
    } else if (data.lastSheetSyncAt) {
      setSheetStatus('✅ Last Google Sheet update at ' + formatCentralTime(data.lastSheetSyncAt) + ' Central Time', 'ok');
    }
  } catch (error) {
    setSheetStatus('❌ Could not load settings: ' + error.message, 'err');
  }
}

init();
