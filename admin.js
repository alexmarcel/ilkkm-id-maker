const elements = {
  form: document.querySelector('#appSettingsForm'),
  appName: document.querySelector('#appNameInput'),
  icon: document.querySelector('#appIconInput'),
  iconButtonText: document.querySelector('#appIconButtonText'),
  iconPreview: document.querySelector('#appIconPreview'),
  matchCardBackground: document.querySelector('#matchCardBackgroundInput'),
  matchCardBackgroundButtonText: document.querySelector('#matchCardBackgroundButtonText'),
  matchCardBackgroundPreview: document.querySelector('#matchCardBackgroundPreview'),
  matchGameEnabled: document.querySelector('#matchGameEnabled'),
  status: document.querySelector('#appSettingsStatus'),
  save: document.querySelector('#saveAppSettings'),
  fullRestoreInput: document.querySelector('#fullRestoreInput'),
  fullRestoreFileName: document.querySelector('#fullRestoreFileName'),
  fullRestoreFileMeta: document.querySelector('#fullRestoreFileMeta'),
  fullRestoreDropzone: document.querySelector('#fullRestoreDropzone'),
  downloadFullBackup: document.querySelector('#downloadFullBackup'),
  restoreFull: document.querySelector('#restoreFullBackup'),
  fullBackupStatus: document.querySelector('#fullBackupStatus'),
};

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(message, type = '') {
  const text = elements.status.querySelector('span');
  const icon = elements.status.querySelector('i, svg');
  text.textContent = message;
  elements.status.classList.remove('error', 'ready', 'loading');
  if (type) {
    elements.status.classList.add(type);
  }
  icon?.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : type === 'ready' ? 'circle-check' : 'info');
  refreshIcons();
}

function setFullBackupStatus(message, type = '') {
  const text = elements.fullBackupStatus.querySelector('span');
  const icon = elements.fullBackupStatus.querySelector('i, svg');
  text.textContent = message;
  elements.fullBackupStatus.classList.remove('error', 'ready', 'loading');
  if (type) elements.fullBackupStatus.classList.add(type);
  icon?.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : type === 'ready' ? 'circle-check' : 'info');
  refreshIcons();
}

function setFullRestoreBusy(busy, label = '') {
  elements.fullRestoreInput.disabled = busy;
  elements.restoreFull.disabled = busy || !elements.fullRestoreInput.files?.[0];
  elements.restoreFull.classList.toggle('loading', busy);
  elements.restoreFull.querySelector('i, svg')?.setAttribute('data-lucide', busy ? 'loader-circle' : 'database-zap');
  elements.restoreFull.querySelector('span').textContent = busy ? 'Restoring Everything...' : 'Restore Everything';
  elements.fullRestoreDropzone.setAttribute('aria-disabled', busy ? 'true' : 'false');
  if (label) setFullBackupStatus(label, 'loading');
  refreshIcons();
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function showRestoreFile(file) {
  const isZip = file && (file.name.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed'].includes(file.type));
  if (file && !isZip) {
    elements.fullRestoreInput.value = '';
    elements.fullRestoreFileName.textContent = 'Choose a backup ZIP';
    elements.fullRestoreFileMeta.textContent = 'Drag and drop here, or click to browse';
    elements.fullRestoreDropzone.classList.remove('has-file');
    elements.restoreFull.disabled = true;
    setFullBackupStatus('Please choose a ZIP backup created by this application.', 'error');
    return;
  }
  elements.fullRestoreFileName.textContent = file ? file.name : 'Choose a backup ZIP';
  elements.fullRestoreFileMeta.textContent = file ? `${formatFileSize(file.size)} · Ready to restore` : 'Drag and drop here, or click to browse';
  elements.fullRestoreDropzone.classList.toggle('has-file', Boolean(file));
  elements.restoreFull.disabled = !file;
  setFullBackupStatus(file ? 'Backup selected. Restore Everything will immediately replace the current data.' : 'Ready. Creating a backup does not interrupt the application.');
}

async function restoreFullBackup() {
  const file = elements.fullRestoreInput.files?.[0] || null;
  if (!file) return;
  setFullRestoreBusy(true, 'Uploading backup and restoring everything...');
  try {
    const payload = new FormData();
    payload.set('backup', file, file.name);
    const response = await fetch('/api/admin/restore', { method: 'POST', body: payload });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not restore backup.');
    setFullBackupStatus('Restore completed. Redirecting to cohorts...', 'ready');
    window.setTimeout(() => { window.location.href = '/'; }, 1200);
  } catch (error) {
    setFullBackupStatus(error.message || 'Could not restore backup.', 'error');
    setFullRestoreBusy(false);
  }
}

function setSaving(isSaving) {
  elements.save.disabled = isSaving;
  elements.icon.disabled = isSaving;
  elements.matchCardBackground.disabled = isSaving;
  elements.appName.disabled = isSaving;
  elements.matchGameEnabled.disabled = isSaving;
  elements.save.classList.toggle('loading', isSaving);
  elements.save.querySelector('i, svg')?.setAttribute('data-lucide', isSaving ? 'loader-circle' : 'save');
  elements.save.querySelector('span').textContent = isSaving ? 'Saving...' : 'Save Settings';
  refreshIcons();
}

function applyFormSettings(settings) {
  elements.appName.value = settings.appName || 'ILKKM ID CARD';
  elements.matchGameEnabled.checked = Boolean(settings.matchGameEnabled);
  elements.iconPreview.src = settings.appIconUrl || '/icon.jpg';
  elements.matchCardBackgroundPreview.src = settings.matchCardBackgroundUrl || '/match_game.jpg';
  document.querySelectorAll('img.brand-icon, img.app-icon-image').forEach((image) => {
    image.src = elements.iconPreview.src;
  });
}

async function loadSettings() {
  try {
    const settings = window.appSettings || await window.appSettingsReady;
    applyFormSettings(settings);
    setStatus('Settings loaded.', 'ready');
  } catch (error) {
    setStatus('Could not load app settings.', 'error');
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const appName = elements.appName.value.trim();
  if (!appName) {
    setStatus('App name is required.', 'error');
    return;
  }

  const icon = elements.icon.files?.[0] || null;
  if (icon && !['image/jpeg', 'image/png'].includes(icon.type)) {
    setStatus('App icon must be a JPG or PNG image.', 'error');
    return;
  }
  const matchCardBackground = elements.matchCardBackground.files?.[0] || null;
  if (matchCardBackground && !['image/jpeg', 'image/png'].includes(matchCardBackground.type)) {
    setStatus('Match card background must be a JPG or PNG image.', 'error');
    return;
  }

  setSaving(true);
  setStatus('Saving app settings...', 'loading');

  try {
    const payload = new FormData();
    payload.set('appName', appName);
    payload.set('matchGameEnabled', elements.matchGameEnabled.checked ? 'true' : 'false');
    if (icon) {
      payload.set('icon', icon, icon.name);
    }
    if (matchCardBackground) {
      payload.set('matchCardBackground', matchCardBackground, matchCardBackground.name);
    }

    const response = await fetch('/api/admin/app-settings', {
      method: 'POST',
      body: payload,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Could not save app settings.');
    }

    elements.icon.value = '';
    elements.iconButtonText.textContent = 'Replace App Icon';
    elements.matchCardBackground.value = '';
    elements.matchCardBackgroundButtonText.textContent = 'Replace Background';
    applyFormSettings(result);
    if (typeof window.dispatchEvent === 'function') {
      window.appSettings = result;
      window.dispatchEvent(new CustomEvent('app-settings:ready', { detail: result }));
    }
    setStatus('App settings saved.', 'ready');
  } catch (error) {
    setStatus(error.message || 'Could not save app settings.', 'error');
  } finally {
    setSaving(false);
  }
}

refreshIcons();
loadSettings();
elements.form.addEventListener('submit', saveSettings);
elements.icon.addEventListener('change', () => {
  const file = elements.icon.files?.[0] || null;
  elements.iconButtonText.textContent = file ? file.name : 'Replace App Icon';
  if (!file) {
    return;
  }

  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    elements.icon.value = '';
    elements.iconButtonText.textContent = 'Replace App Icon';
    setStatus('App icon must be a JPG or PNG image.', 'error');
    return;
  }

  elements.iconPreview.src = URL.createObjectURL(file);
  setStatus('Icon will be compressed to JPEG when saved.');
});

elements.matchCardBackground.addEventListener('change', () => {
  const file = elements.matchCardBackground.files?.[0] || null;
  elements.matchCardBackgroundButtonText.textContent = file ? file.name : 'Replace Background';
  if (!file) {
    return;
  }

  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    elements.matchCardBackground.value = '';
    elements.matchCardBackgroundButtonText.textContent = 'Replace Background';
    setStatus('Match card background must be a JPG or PNG image.', 'error');
    return;
  }

  elements.matchCardBackgroundPreview.src = URL.createObjectURL(file);
  setStatus('Match card background will be compressed to JPEG when saved.');
});

document.querySelector('label[for="appIconInput"]').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.icon.click();
  }
});

document.querySelector('label[for="matchCardBackgroundInput"]').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.matchCardBackground.click();
  }
});

elements.fullRestoreInput.addEventListener('change', () => showRestoreFile(elements.fullRestoreInput.files?.[0] || null));
elements.restoreFull.addEventListener('click', restoreFullBackup);
elements.downloadFullBackup.addEventListener('click', () => {
  setFullBackupStatus('Creating your complete backup. The download will begin shortly.', 'loading');
  window.setTimeout(() => setFullBackupStatus('Backup download started.', 'ready'), 1200);
});
elements.fullRestoreDropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.fullRestoreInput.click();
  }
});
['dragenter', 'dragover'].forEach((eventName) => elements.fullRestoreDropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  if (!elements.fullRestoreInput.disabled) elements.fullRestoreDropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => elements.fullRestoreDropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  elements.fullRestoreDropzone.classList.remove('dragging');
}));
elements.fullRestoreDropzone.addEventListener('drop', (event) => {
  if (elements.fullRestoreInput.disabled) return;
  const file = event.dataTransfer?.files?.[0] || null;
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  elements.fullRestoreInput.files = transfer.files;
  showRestoreFile(file);
});
