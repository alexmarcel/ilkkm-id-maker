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
  icon: document.querySelector('#newCohortIcon'),
  iconButtonText: document.querySelector('#cohortIconButtonText'),
  removeIcon: document.querySelector('#removeCohortIcon'),
  color: document.querySelector('#newCohortColor'),
  modalStatus: document.querySelector('#cohortModalStatus'),
  saveCohort: document.querySelector('#saveCohort'),
  modalTitle: document.querySelector('#cohortModalTitle'),
};

let currentCohorts = [];
let modalMode = 'create';
let editingCohort = null;
let removeIconRequested = false;

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
  elements.modalStatus.classList.remove('error', 'ready', 'loading');
  if (type) {
    elements.modalStatus.classList.add(type);
  }
  if (iconElement) {
    iconElement.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : type === 'ready' ? 'circle-check' : 'info');
  }
  refreshIcons();
}

function renderMessage(message) {
  elements.grid.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'grid-empty';
  empty.textContent = message;
  elements.grid.append(empty);
}

function renderCohorts(cohorts) {
  currentCohorts = cohorts;
  elements.grid.innerHTML = '';

  if (cohorts.length === 0) {
    renderMessage('No cohorts yet.');
    return;
  }

  cohorts.forEach((cohort) => {
    const card = document.createElement('div');
    const link = document.createElement('a');
    const editLink = document.createElement('a');
    const title = document.createElement('strong');
    const sesi = document.createElement('span');
    const meta = document.createElement('span');
    const status = document.createElement('span');

    card.className = 'cohort-card-wrap';
    link.className = 'cohort-card';
    link.href = `/cohorts/${encodeURIComponent(cohort.slug)}`;
    link.style.setProperty('--cohort-card-image', `url("${cohort.iconUrl || '/icon.jpg'}")`);
    link.style.setProperty('--cohort-card-color', cohort.accentColor || '#0f8ea3');
    link.style.setProperty('--cohort-card-soft-color', `${cohort.accentColor || '#0f8ea3'}2e`);
    editLink.className = 'cohort-edit-button';
    editLink.href = `/admin/cohorts/${encodeURIComponent(cohort.slug)}/edit`;
    editLink.setAttribute('aria-label', `Edit cohort ${cohort.program}`);
    editLink.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';
    title.textContent = cohort.program;
    sesi.textContent = cohort.sesi;
    meta.textContent = `${cohort.recordCount || 0} saved record${Number(cohort.recordCount || 0) === 1 ? '' : 's'}`;
    status.className = cohort.acceptingResponse ? 'cohort-status closed' : 'cohort-status open';
    status.textContent = cohort.acceptingResponse ? 'Closed' : 'Open';
    link.append(title, sesi, meta, status);
    card.append(link, editLink);
    elements.grid.append(card);
  });

  refreshIcons();
}

async function loadCohorts() {
  setStatus('Loading cohorts...');
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
    renderMessage('Could not load cohorts.');
    setStatus(error.message || 'Could not load cohorts.', 'error');
  }
}

function openModal(mode = 'create', cohort = null) {
  modalMode = mode;
  editingCohort = cohort;
  elements.form.reset();
  removeIconRequested = false;
  elements.modalTitle.textContent = mode === 'edit' ? 'EDIT COHORT' : 'ADD COHORT';
  elements.program.value = cohort?.program || '';
  elements.sesi.value = cohort?.sesi || '';
  elements.color.value = cohort?.accentColor || '#0f8ea3';
  elements.iconButtonText.textContent = mode === 'edit' ? 'Replace Photo' : 'Add Photo';
  elements.removeIcon.hidden = !(mode === 'edit' && cohort?.iconUrl);
  elements.removeIcon.disabled = false;
  elements.saveCohort.querySelector('span').textContent = mode === 'edit' ? 'Save Changes' : 'Create Cohort';
  setModalStatus(mode === 'edit' ? 'Update Program, Sesi, or replace the grid photo.' : 'Use the exports/admin login when prompted.');
  elements.modal.hidden = false;
  document.body.classList.add('modal-open');
  elements.program.focus();
}

function closeModal() {
  elements.modal.hidden = true;
  document.body.classList.remove('modal-open');
  if (window.location.pathname === '/admin/cohorts/new') {
    window.history.replaceState({}, '', '/');
  } else if (window.location.pathname.startsWith('/admin/cohorts/')) {
    window.history.replaceState({}, '', '/');
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
  const icon = elements.icon.files?.[0] || null;
  const accentColor = elements.color.value || '#0f8ea3';
  if (!program || !sesi) {
    setModalStatus('Program and sesi are required.', 'error');
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
elements.icon.addEventListener('change', () => {
  const file = elements.icon.files?.[0] || null;
  elements.iconButtonText.textContent = file ? file.name : 'Add Photo';
  if (file) {
    removeIconRequested = false;
    elements.removeIcon.classList.remove('active');
  }
});
elements.removeIcon.addEventListener('click', () => {
  removeIconRequested = true;
  elements.icon.value = '';
  elements.iconButtonText.textContent = 'Replace Photo';
  elements.removeIcon.classList.add('active');
  setModalStatus('Photo will be removed when you save changes.', 'ready');
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
