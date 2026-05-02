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
