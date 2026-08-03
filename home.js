const elements = {
  status: document.querySelector('#cohortStatus'),
  grid: document.querySelector('#cohortGrid'),
  addCohort: document.querySelector('#addCohort'),
  modal: document.querySelector('#cohortModal'),
  form: document.querySelector('#cohortForm'),
  closeModal: document.querySelector('#closeCohortModal'),
  cancel: document.querySelector('#cancelCohort'),
  program: document.querySelector('#newCohortProgram'),
  sesi: document.querySelector('#newCohortSesi'),
  type: document.querySelector('#newCohortType'),
  supervisorFields: document.querySelector('#staffSupervisorFields'),
  supervisorName: document.querySelector('#newCohortSupervisorName'),
  supervisorTitle: document.querySelector('#newCohortSupervisorTitle'),
  icon: document.querySelector('#newCohortIcon'),
  iconButtonText: document.querySelector('#cohortIconButtonText'),
  removeIcon: document.querySelector('#removeCohortIcon'),
  color: document.querySelector('#newCohortColor'),
  modalStatus: document.querySelector('#cohortModalStatus'),
  saveCohort: document.querySelector('#saveCohort'),
  modalTitle: document.querySelector('#cohortModalTitle'),
  dangerZone: document.querySelector('#cohortDangerZone'),
  deleteSummary: document.querySelector('#cohortDeleteSummary'),
  showDelete: document.querySelector('#showDeleteCohort'),
  deleteConfirmation: document.querySelector('#cohortDeleteConfirmation'),
  deletePhrase: document.querySelector('#cohortDeletePhrase'),
  cancelDelete: document.querySelector('#cancelDeleteCohort'),
  confirmDelete: document.querySelector('#confirmDeleteCohort'),
};

let currentCohorts = [];
let modalMode = 'create';
let editingCohort = null;
let removeIconRequested = false;
let compressedIconFile = null;
let deleteInProgress = false;

const ICON_OUTPUT_SIZE = 720;
const ICON_QUALITY = 0.82;

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.classList.remove('error', 'ready');
  if (type) {
    elements.status.classList.add(type);
  }
}

function setModalStatus(message, type = '') {
  const messageElement = elements.modalStatus.querySelector('span');
  const iconElement = elements.modalStatus.querySelector('i, svg');
  messageElement.textContent = message;
  elements.modalStatus.classList.remove('error', 'ready', 'loading', 'warning');
  if (type) {
    elements.modalStatus.classList.add(type);
  }
  if (iconElement) {
    iconElement.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : type === 'ready' ? 'circle-check' : type === 'warning' ? 'triangle-alert' : 'info');
  }
  refreshIcons();
}

function normalizeCohortText(value) {
  return String(value || '').trim().toUpperCase();
}

function hasProgramSesiChanges() {
  if (modalMode !== 'edit' || !editingCohort) {
    return false;
  }

  return normalizeCohortText(elements.program.value) !== normalizeCohortText(editingCohort.program)
    || normalizeCohortText(elements.sesi.value) !== normalizeCohortText(editingCohort.sesi)
    || elements.type.value !== editingCohort.type
    || normalizeCohortText(elements.supervisorName.value) !== normalizeCohortText(editingCohort.supervisorName)
    || normalizeCohortText(elements.supervisorTitle.value) !== normalizeCohortText(editingCohort.supervisorTitle);
}

function refreshCohortChangeWarning() {
  if (hasProgramSesiChanges()) {
    setModalStatus('Card details changed. Run Regenerate Cards from Exports after saving.', 'warning');
    return;
  }

  setModalStatus(modalMode === 'edit' ? 'Update Program, Sesi, or replace the grid photo.' : 'Use the exports/admin login when prompted.');
}

function refreshCohortTypeFields() {
  const isStaff = elements.type.value === 'staff';
  elements.supervisorFields.hidden = !isStaff;
  elements.supervisorName.required = isStaff;
  elements.supervisorTitle.required = isStaff;
  elements.type.disabled = modalMode === 'edit' && Number(editingCohort?.recordCount || 0) > 0;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the selected photo.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Could not compress the selected photo.'));
      }
    }, 'image/jpeg', quality);
  });
}

async function compressCohortIcon(file) {
  const image = await loadImageFromFile(file);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, Math.floor((image.naturalWidth - sourceSize) / 2));
  const sourceY = Math.max(0, Math.floor((image.naturalHeight - sourceSize) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = ICON_OUTPUT_SIZE;
  canvas.height = ICON_OUTPUT_SIZE;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Could not compress the selected photo.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas, ICON_QUALITY);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'cohort-photo';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

function renderMessage(message) {
  const empty = document.createElement('p');
  empty.className = 'grid-empty';
  empty.textContent = message;
  elements.grid.append(empty);
}

function createMatchGameCard() {
  const settings = window.appSettings || {};
  const card = document.createElement('div');
  const link = document.createElement('a');
  const footer = document.createElement('span');
  const icon = document.createElement('span');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  const action = document.createElement('span');

  card.className = 'cohort-card-wrap match-game-card-wrap';
  card.dataset.matchGameLink = '';
  card.hidden = !settings.matchGameEnabled;
  link.className = 'cohort-card match-game-card';
  link.href = '/game';
  link.style.setProperty('--match-card-background', `url("${settings.matchCardBackgroundUrl || '/match_game.jpg'}")`);
  footer.className = 'match-game-card-footer';
  icon.className = 'match-game-card-icon';
  icon.innerHTML = '<i data-lucide="gamepad-2" aria-hidden="true"></i>';
  copy.className = 'match-game-card-copy';
  title.textContent = 'Memory Game';
  action.className = 'match-game-card-action';
  action.textContent = 'Play Now';
  copy.append(title);
  footer.append(icon, copy, action);
  link.append(footer);
  card.append(link);
  return card;
}

function renderCohorts(cohorts) {
  currentCohorts = cohorts;
  elements.grid.innerHTML = '';
  const fallbackIcon = window.appSettings?.appIconUrl || '/icon.jpg';
  const gameCard = createMatchGameCard();
  elements.grid.append(gameCard);

  if (cohorts.length === 0) {
    renderMessage('No cohorts yet.');
    refreshIcons();
    return;
  }

  cohorts.forEach((cohort) => {
    const card = document.createElement('div');
    const link = document.createElement('a');
    const editLink = document.createElement('a');
    const media = document.createElement('span');
    const footer = document.createElement('span');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const sesi = document.createElement('span');
    const meta = document.createElement('span');
    const status = document.createElement('span');
    const typeBadge = document.createElement('span');

    card.className = 'cohort-card-wrap';
    link.className = 'cohort-card';
    link.href = `/cohorts/${encodeURIComponent(cohort.slug)}`;
    link.style.setProperty('--cohort-card-color', cohort.accentColor || '#0f8ea3');
    link.style.setProperty('--cohort-card-soft-color', `${cohort.accentColor || '#0f8ea3'}2e`);
    media.className = 'cohort-card-media';
    media.style.setProperty('--cohort-card-image', `url("${cohort.iconUrl || fallbackIcon}")`);
    footer.className = 'cohort-card-footer';
    copy.className = 'cohort-card-copy';
    editLink.className = 'cohort-edit-button';
    editLink.href = `/admin/cohorts/${encodeURIComponent(cohort.slug)}/edit`;
    editLink.setAttribute('aria-label', `Edit cohort ${cohort.program}`);
    editLink.innerHTML = '<i data-lucide="settings" aria-hidden="true"></i>';
    title.textContent = cohort.program;
    sesi.textContent = cohort.sesi;
    meta.textContent = `${cohort.recordCount || 0} saved record${Number(cohort.recordCount || 0) === 1 ? '' : 's'}`;
    meta.className = 'cohort-card-meta';
    typeBadge.className = 'cohort-type-badge';
    typeBadge.textContent = cohort.type === 'staff' ? 'Staff' : 'Students';
    status.className = cohort.acceptingResponse ? 'cohort-status closed' : 'cohort-status open';
    status.textContent = cohort.acceptingResponse ? 'Closed' : 'Open';
    copy.append(title, sesi, typeBadge, meta);
    footer.append(copy);
    link.append(media, footer);
    card.append(link, status, editLink);
    elements.grid.append(card);
  });

  refreshIcons();
}

async function loadCohorts() {
  setStatus('Loading cohorts...');
  elements.grid.innerHTML = '';
  renderMessage('Loading cohorts...');

  try {
    const response = await fetch('/api/cohorts');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Could not load cohorts.');
    }

    renderCohorts(result.cohorts || []);
    setStatus(`${(result.cohorts || []).length} cohort${(result.cohorts || []).length === 1 ? '' : 's'} ready.`, 'ready');
  } catch (error) {
    elements.grid.innerHTML = '';
    renderMessage('Could not load cohorts.');
    setStatus(error.message || 'Could not load cohorts.', 'error');
  }
}

function openModal(mode = 'create', cohort = null) {
  modalMode = mode;
  editingCohort = cohort;
  elements.form.reset();
  removeIconRequested = false;
  compressedIconFile = null;
  elements.modalTitle.textContent = mode === 'edit' ? 'EDIT COHORT' : 'ADD COHORT';
  elements.program.value = cohort?.program || '';
  elements.sesi.value = cohort?.sesi || '';
  elements.type.value = cohort?.type || 'student';
  elements.supervisorName.value = cohort?.supervisorName || '';
  elements.supervisorTitle.value = cohort?.supervisorTitle || '';
  elements.color.value = cohort?.accentColor || '#0f8ea3';
  elements.iconButtonText.textContent = mode === 'edit' ? 'Replace Photo' : 'Add Photo';
  elements.removeIcon.hidden = !(mode === 'edit' && cohort?.iconUrl);
  elements.removeIcon.disabled = false;
  elements.saveCohort.querySelector('span').textContent = mode === 'edit' ? 'Save Changes' : 'Create Cohort';
  elements.dangerZone.hidden = mode !== 'edit';
  elements.deleteConfirmation.hidden = true;
  elements.showDelete.hidden = false;
  elements.deletePhrase.value = '';
  elements.confirmDelete.disabled = true;
  elements.deleteSummary.textContent = mode === 'edit'
    ? `${cohort.program} · ${cohort.type === 'staff' ? 'Staff' : 'Students'} · ${Number(cohort.recordCount || 0)} saved record${Number(cohort.recordCount || 0) === 1 ? '' : 's'}`
    : '';
  setModalStatus(mode === 'edit' ? 'Update Program, Sesi, or replace the grid photo.' : 'Use the exports/admin login when prompted.');
  elements.modal.hidden = false;
  refreshCohortTypeFields();
  document.body.classList.add('modal-open');
  elements.program.focus();
}

function closeModal() {
  if (deleteInProgress) return;
  elements.modal.hidden = true;
  document.body.classList.remove('modal-open');
  if (window.location.pathname === '/admin/cohorts/new') {
    window.history.replaceState({}, '', '/');
  } else if (window.location.pathname.startsWith('/admin/cohorts/')) {
    window.history.replaceState({}, '', '/');
  }
}

function setDeleting(isDeleting) {
  deleteInProgress = isDeleting;
  [...elements.form.elements].forEach((control) => { control.disabled = isDeleting; });
  elements.closeModal.disabled = isDeleting;
  elements.confirmDelete.classList.toggle('loading', isDeleting);
  elements.confirmDelete.querySelector('i, svg')?.setAttribute('data-lucide', isDeleting ? 'loader-circle' : 'trash-2');
  elements.confirmDelete.querySelector('span').textContent = isDeleting ? 'Deleting Cohort...' : 'Delete Permanently';
  if (!isDeleting) {
    elements.cancel.disabled = false;
    elements.saveCohort.disabled = false;
    elements.showDelete.disabled = false;
    elements.cancelDelete.disabled = false;
    elements.deletePhrase.disabled = false;
    elements.confirmDelete.disabled = elements.deletePhrase.value !== 'DELETE';
    refreshCohortTypeFields();
  }
  refreshIcons();
}

function showDeleteConfirmation() {
  elements.deleteConfirmation.hidden = false;
  elements.showDelete.hidden = true;
  elements.deletePhrase.value = '';
  elements.confirmDelete.disabled = true;
  setModalStatus('Deletion cannot be undone. Type DELETE exactly to continue.', 'warning');
  elements.deletePhrase.focus();
}

function hideDeleteConfirmation() {
  elements.deleteConfirmation.hidden = true;
  elements.showDelete.hidden = false;
  elements.deletePhrase.value = '';
  elements.confirmDelete.disabled = true;
  refreshCohortChangeWarning();
}

async function deleteCohort() {
  if (modalMode !== 'edit' || !editingCohort || elements.deletePhrase.value !== 'DELETE') return;
  setDeleting(true);
  setModalStatus('Deleting cohort and all associated data...', 'loading');
  try {
    const response = await fetch(`/api/exports/cohorts/${encodeURIComponent(editingCohort.slug)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not delete cohort.');
    const deletedProgram = editingCohort.program;
    setDeleting(false);
    closeModal();
    await loadCohorts();
    setStatus(`${deletedProgram} was deleted with ${Number(result.recordCount || 0)} saved record${Number(result.recordCount || 0) === 1 ? '' : 's'}.`, 'ready');
  } catch (error) {
    setDeleting(false);
    setModalStatus(error.message || 'Could not delete cohort.', 'error');
  }
}

function setSaving(isSaving) {
  elements.saveCohort.disabled = isSaving;
  elements.cancel.disabled = isSaving;
  elements.closeModal.disabled = isSaving;
  elements.saveCohort.classList.toggle('loading', isSaving);
  elements.saveCohort.querySelector('i, svg')?.setAttribute('data-lucide', isSaving ? 'loader-circle' : 'check');
  elements.saveCohort.querySelector('span').textContent = isSaving
    ? modalMode === 'edit' ? 'Saving...' : 'Creating...'
    : modalMode === 'edit' ? 'Save Changes' : 'Create Cohort';
  refreshIcons();
}

async function saveCohort(event) {
  event.preventDefault();

  const program = elements.program.value.trim();
  const sesi = elements.sesi.value.trim();
  const icon = compressedIconFile || elements.icon.files?.[0] || null;
  const accentColor = elements.color.value || '#0f8ea3';
  const type = elements.type.value;
  const supervisorName = elements.supervisorName.value.trim();
  const supervisorTitle = elements.supervisorTitle.value.trim();
  if (!program || !sesi) {
    setModalStatus('Program and sesi are required.', 'error');
    return;
  }
  if (type === 'staff' && (!supervisorName || !supervisorTitle)) {
    setModalStatus('Supervisor name and title are required for staff cohorts.', 'error');
    return;
  }

  if (icon && !['image/jpeg', 'image/png'].includes(icon.type)) {
    setModalStatus('Photo must be a JPG or PNG image.', 'error');
    return;
  }

  setSaving(true);
  setModalStatus(modalMode === 'edit' ? 'Saving cohort...' : 'Creating cohort...');

  try {
    const payload = new FormData();
    payload.set('program', program);
    payload.set('sesi', sesi);
    payload.set('type', type);
    payload.set('supervisorName', supervisorName);
    payload.set('supervisorTitle', supervisorTitle);
    payload.set('accentColor', accentColor);
    if (modalMode === 'edit' && removeIconRequested) {
      payload.set('removeIcon', 'true');
    } else if (icon) {
      payload.set('icon', icon, icon.name);
    }

    const endpoint = modalMode === 'edit'
      ? `/api/exports/cohorts/${encodeURIComponent(editingCohort.slug)}`
      : '/api/exports/cohorts';
    const response = await fetch(endpoint, {
      method: modalMode === 'edit' ? 'PATCH' : 'POST',
      body: payload,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Could not create cohort.');
    }

    closeModal();
    await loadCohorts();
    window.location.href = modalMode === 'edit'
      ? '/'
      : `/cohorts/${encodeURIComponent(result.cohort.slug)}`;
  } catch (error) {
    setModalStatus(error.message || (modalMode === 'edit' ? 'Could not update cohort.' : 'Could not create cohort.'), 'error');
  } finally {
    setSaving(false);
  }
}

refreshIcons();
elements.addCohort.addEventListener('click', () => {
  if (window.location.pathname === '/admin/cohorts/new') {
    openModal();
    return;
  }

  window.location.href = '/admin/cohorts/new';
});
elements.closeModal.addEventListener('click', closeModal);
elements.cancel.addEventListener('click', closeModal);
elements.form.addEventListener('submit', saveCohort);
elements.showDelete.addEventListener('click', showDeleteConfirmation);
elements.cancelDelete.addEventListener('click', hideDeleteConfirmation);
elements.deletePhrase.addEventListener('input', () => {
  elements.confirmDelete.disabled = elements.deletePhrase.value !== 'DELETE';
});
elements.deletePhrase.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!elements.confirmDelete.disabled) deleteCohort();
});
elements.confirmDelete.addEventListener('click', deleteCohort);
elements.program.addEventListener('input', refreshCohortChangeWarning);
elements.sesi.addEventListener('input', refreshCohortChangeWarning);
elements.type.addEventListener('change', () => {
  refreshCohortTypeFields();
  refreshCohortChangeWarning();
});
elements.supervisorName.addEventListener('input', refreshCohortChangeWarning);
elements.supervisorTitle.addEventListener('input', refreshCohortChangeWarning);
elements.icon.addEventListener('change', async () => {
  const file = elements.icon.files?.[0] || null;
  compressedIconFile = null;
  elements.iconButtonText.textContent = file ? file.name : modalMode === 'edit' ? 'Replace Photo' : 'Add Photo';
  if (file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      elements.icon.value = '';
      elements.iconButtonText.textContent = modalMode === 'edit' ? 'Replace Photo' : 'Add Photo';
      setModalStatus('Photo must be a JPG or PNG image.', 'error');
      return;
    }

    removeIconRequested = false;
    elements.removeIcon.classList.remove('active');
    setModalStatus('Compressing photo...');
    try {
      compressedIconFile = await compressCohortIcon(file);
      elements.iconButtonText.textContent = compressedIconFile.name;
      refreshCohortChangeWarning();
    } catch (error) {
      elements.icon.value = '';
      elements.iconButtonText.textContent = modalMode === 'edit' ? 'Replace Photo' : 'Add Photo';
      setModalStatus(error.message || 'Could not compress photo.', 'error');
    }
  } else {
    refreshCohortChangeWarning();
  }
});
elements.removeIcon.addEventListener('click', () => {
  removeIconRequested = true;
  elements.icon.value = '';
  compressedIconFile = null;
  elements.iconButtonText.textContent = 'Replace Photo';
  elements.removeIcon.classList.add('active');
  if (hasProgramSesiChanges()) {
    refreshCohortChangeWarning();
  } else {
    setModalStatus('Photo will be removed when you save changes.', 'ready');
  }
});
document.querySelector('label[for="newCohortIcon"]').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.icon.click();
  }
});
elements.modal.addEventListener('click', (event) => {
  if (event.target === elements.modal) {
    closeModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.modal.hidden) {
    closeModal();
  }
});

function getEditSlugFromPath() {
  const match = window.location.pathname.match(/^\/admin\/cohorts\/([^/]+)\/edit\/?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

loadCohorts().then(() => {
  if (window.location.pathname === '/admin/cohorts/new') {
    openModal();
    return;
  }

  const editSlug = getEditSlugFromPath();
  if (editSlug) {
    const cohort = currentCohorts.find((item) => item.slug === editSlug);
    if (cohort) {
      openModal('edit', cohort);
    } else {
      setStatus('Cohort not found.', 'error');
    }
  }
});

window.addEventListener('app-settings:ready', () => {
  if (currentCohorts.length) {
    renderCohorts(currentCohorts);
  }
});
