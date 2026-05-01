const elements = {
  program: document.querySelector('#exportProgram'),
  sesi: document.querySelector('#exportSesi'),
  acceptingResponseToggle: document.querySelector('#acceptingResponseToggle'),
  count: document.querySelector('#exportCount'),
  recordsTableBody: document.querySelector('#recordsTableBody'),
  downloadZip: document.querySelector('#downloadZip'),
  backupDataset: document.querySelector('#backupDataset'),
  regenerateCards: document.querySelector('#regenerateCards'),
  restoreDataset: document.querySelector('#restoreDataset'),
  restoreDatasetInput: document.querySelector('#restoreDatasetInput'),
  cardModal: document.querySelector('#cardModal'),
  cardModalTitle: document.querySelector('#cardModalTitle'),
  cardModalImage: document.querySelector('#cardModalImage'),
  closeCardModal: document.querySelector('#closeCardModal'),
  datasetModal: document.querySelector('#datasetModal'),
  datasetModalTitle: document.querySelector('#datasetModalTitle'),
  datasetSummary: document.querySelector('#datasetSummary'),
  datasetWarning: document.querySelector('#datasetWarning'),
  datasetProgress: document.querySelector('#datasetProgress'),
  datasetProgressLabel: document.querySelector('#datasetProgressLabel'),
  datasetProgressCount: document.querySelector('#datasetProgressCount'),
  datasetProgressTrack: document.querySelector('.dataset-progress-track'),
  datasetProgressBar: document.querySelector('#datasetProgressBar'),
  closeDatasetModal: document.querySelector('#closeDatasetModal'),
  cancelDatasetAction: document.querySelector('#cancelDatasetAction'),
  confirmDatasetAction: document.querySelector('#confirmDatasetAction'),
  generatorLink: document.querySelector('#exportsGeneratorLink'),
};

let countTimer = null;
let currentCount = 0;
let datasetAction = null;
let restoreFile = null;
let regenerateIcNumber = null;
let currentRecords = [];
let datasetBusy = false;
let currentCohort = null;

function getCohortSlugFromPath() {
  const match = window.location.pathname.match(/^\/cohorts\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function loadCohort() {
  const slug = getCohortSlugFromPath();
  const response = await fetch(`/api/cohorts/${encodeURIComponent(slug)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Cohort not found.');
  }

  currentCohort = result;
  elements.program.value = result.program;
  elements.sesi.value = result.sesi;
  elements.program.disabled = true;
  elements.sesi.disabled = true;
  elements.generatorLink.href = `/cohorts/${encodeURIComponent(result.slug)}`;
}

function getFilters() {
  return {
    cohortSlug: currentCohort?.slug || getCohortSlugFromPath(),
    program: elements.program.value.trim(),
    sesi: elements.sesi.value.trim(),
  };
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  params.set('cohortSlug', filters.cohortSlug);
  return params.toString();
}

function setLoading(message) {
  elements.count.classList.remove('error', 'ready');
  elements.count.textContent = message;
  elements.downloadZip.disabled = true;
  elements.backupDataset.disabled = true;
  elements.regenerateCards.disabled = true;
  renderTableMessage('Loading records...');
}

function setCount(count) {
  currentCount = count;
  elements.count.classList.remove('error', 'ready');

  if (count === 0) {
    elements.count.textContent = 'No matching records.';
    elements.downloadZip.disabled = true;
    elements.backupDataset.disabled = true;
    elements.regenerateCards.disabled = true;
    renderTableMessage('No matching records.');
    return;
  }

  elements.count.textContent = `${count} matching record${count === 1 ? '' : 's'} ready.`;
  elements.count.classList.add('ready');
  elements.downloadZip.disabled = false;
  elements.backupDataset.disabled = false;
  elements.regenerateCards.disabled = false;
}

function renderTableMessage(message) {
  elements.recordsTableBody.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.textContent = message;
  row.append(cell);
  elements.recordsTableBody.append(row);
}

function renderRecords(records) {
  currentRecords = records;
  elements.recordsTableBody.innerHTML = '';

  if (records.length === 0) {
    renderTableMessage('No matching records.');
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('tr');
    const numberCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const matrixCell = document.createElement('td');
    const icCell = document.createElement('td');
    const actionCell = document.createElement('td');
    const frontButton = document.createElement('button');
    const backButton = document.createElement('button');
    const photoButton = document.createElement('button');
    const regenerateButton = document.createElement('button');
    const deleteButton = document.createElement('button');

    numberCell.textContent = record.number;
    nameCell.textContent = record.name;
    matrixCell.textContent = record.matrixNumber;
    icCell.textContent = record.icNumber;
    actionCell.className = 'record-actions';

    frontButton.className = 'row-icon-button';
    frontButton.type = 'button';
    frontButton.dataset.icNumber = record.icNumber;
    frontButton.dataset.name = record.name;
    frontButton.dataset.side = 'front';
    frontButton.setAttribute('aria-label', `Preview front card for ${record.name}`);
    frontButton.innerHTML = '<i data-lucide="file-input" aria-hidden="true"></i>';

    backButton.className = 'row-icon-button';
    backButton.type = 'button';
    backButton.dataset.icNumber = record.icNumber;
    backButton.dataset.name = record.name;
    backButton.dataset.side = 'back';
    backButton.setAttribute('aria-label', `Preview back card for ${record.name}`);
    backButton.innerHTML = '<i data-lucide="file-output" aria-hidden="true"></i>';

    photoButton.className = 'row-icon-button';
    photoButton.type = 'button';
    photoButton.dataset.action = 'download-photo';
    photoButton.dataset.icNumber = record.icNumber;
    photoButton.dataset.name = record.name;
    photoButton.setAttribute('aria-label', `Download uploaded photo for ${record.name}`);
    photoButton.innerHTML = '<i data-lucide="image-down" aria-hidden="true"></i>';

    regenerateButton.className = 'row-icon-button';
    regenerateButton.type = 'button';
    regenerateButton.dataset.action = 'regenerate';
    regenerateButton.dataset.icNumber = record.icNumber;
    regenerateButton.dataset.name = record.name;
    regenerateButton.dataset.matrixNumber = record.matrixNumber;
    regenerateButton.setAttribute('aria-label', `Regenerate cards for ${record.name}`);
    regenerateButton.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>';

    deleteButton.className = 'row-delete-button';
    deleteButton.type = 'button';
    deleteButton.dataset.icNumber = record.icNumber;
    deleteButton.dataset.name = record.name;
    deleteButton.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
    actionCell.append(frontButton, backButton, photoButton, regenerateButton, deleteButton);

    row.append(numberCell, nameCell, matrixCell, icCell, actionCell);
    elements.recordsTableBody.append(row);
  });

  refreshIcons();
}

function setError(message) {
  currentCount = 0;
  currentRecords = [];
  elements.count.textContent = message;
  elements.count.classList.remove('ready');
  elements.count.classList.add('error');
  elements.downloadZip.disabled = true;
  elements.backupDataset.disabled = true;
  elements.regenerateCards.disabled = true;
  renderTableMessage('Could not load records.');
}

function setStatus(message, type = '') {
  elements.count.textContent = message;
  elements.count.classList.remove('error', 'ready');

  if (type) {
    elements.count.classList.add(type);
  }
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function refreshCount() {
  const filters = getFilters();
  setLoading('Loading records...');

  try {
    const response = await fetch(`/api/exports/records?${buildQuery(filters)}`);
    if (!response.ok) {
      throw new Error('Records request failed');
    }

    const data = await response.json();
    setCount(Number(data.count || 0));
    renderRecords(data.records || []);
  } catch (error) {
    setError('Could not load matching records.');
  }
}

async function loadAcceptingResponseSetting() {
  try {
    const response = await fetch(`/api/settings/accepting-response?${buildQuery(getFilters())}`);
    if (!response.ok) {
      throw new Error('Setting request failed.');
    }

    const result = await response.json();
    elements.acceptingResponseToggle.checked = Boolean(result.acceptingResponse);
  } catch (error) {
    setStatus('Could not load response setting.', 'error');
  }
}

async function updateAcceptingResponseSetting() {
  const acceptingResponse = elements.acceptingResponseToggle.checked;
  elements.acceptingResponseToggle.disabled = true;
  setStatus('Saving response setting...');

  try {
    const response = await fetch(`/api/exports/cohorts/${encodeURIComponent(currentCohort.slug)}/settings/accepting-response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ acceptingResponse }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Could not save response setting.');
    }

    elements.acceptingResponseToggle.checked = Boolean(result.acceptingResponse);
    setStatus('Response setting saved.', 'ready');
  } catch (error) {
    elements.acceptingResponseToggle.checked = !acceptingResponse;
    setStatus(error.message || 'Could not save response setting.', 'error');
  } finally {
    elements.acceptingResponseToggle.disabled = false;
  }
}

function scheduleCountRefresh() {
  window.clearTimeout(countTimer);
  countTimer = window.setTimeout(refreshCount, 300);
}

function downloadZip() {
  if (currentCount === 0) {
    return;
  }

  const filters = getFilters();
  elements.downloadZip.disabled = true;
  setStatus('Preparing ZIP...');

  window.location.href = `/api/exports/cards.zip?${buildQuery(filters)}`;

  window.setTimeout(() => {
    setStatus('Download started.', 'ready');
    elements.downloadZip.disabled = currentCount === 0;
  }, 900);
}

async function fetchDatasetSummary() {
  const filters = getFilters();
  const response = await fetch(`/api/exports/dataset-summary?${buildQuery(filters)}`);
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || 'Could not load dataset summary.');
  }

  return result;
}

function addSummaryRow(label, value) {
  const row = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('span');
  row.className = 'summary-row';
  labelElement.textContent = label;
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  elements.datasetSummary.append(row);
}

function getMissingWarning(counts) {
  const missing = [
    counts.missingPhotos ? `${counts.missingPhotos} photo${counts.missingPhotos === 1 ? '' : 's'}` : '',
    counts.missingFrontCards ? `${counts.missingFrontCards} front JPG${counts.missingFrontCards === 1 ? '' : 's'}` : '',
    counts.missingBackCards ? `${counts.missingBackCards} back JPG${counts.missingBackCards === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return missing.length ? `Warning: missing ${missing.join(', ')}.` : '';
}

function openDatasetModal(action, summary, file = null) {
  const isRestore = action === 'restore';
  const isRegenerate = action === 'regenerate' || action === 'regenerate-row';
  const counts = summary.counts || {};
  datasetAction = action;
  restoreFile = file;
  regenerateIcNumber = summary.icNumber || null;
  elements.datasetModalTitle.textContent = isRestore
    ? 'RESTORE DATASET'
    : isRegenerate
      ? 'REGENERATE CARDS'
      : 'BACKUP DATASET';
  elements.datasetSummary.innerHTML = '';

  if (isRestore) {
    addSummaryRow('Backup Program', summary.program);
    addSummaryRow('Backup Sesi', summary.sesi);
    addSummaryRow('Selected Program', summary.selectedProgram || getFilters().program);
    addSummaryRow('Selected Sesi', summary.selectedSesi || getFilters().sesi);
    addSummaryRow('File', file?.name || 'Selected backup');
  } else if (isRegenerate) {
    addSummaryRow('Program', summary.program);
    addSummaryRow('Sesi', summary.sesi);

    if (summary.name) {
      addSummaryRow('Name', summary.name);
      addSummaryRow('IC Number', summary.icNumber);
    }
  } else {
    addSummaryRow('Program', summary.program);
    addSummaryRow('Sesi', summary.sesi);
  }

  addSummaryRow(
    isRestore ? 'Records To Restore' : isRegenerate ? 'Records Affected' : 'Records',
    counts.records || 0,
  );

  if (!isRegenerate) {
    addSummaryRow('Photos', counts.photos || 0);
  }

  addSummaryRow(isRegenerate ? 'Front JPGs To Overwrite' : 'Front JPGs', counts.frontCards || 0);
  addSummaryRow(isRegenerate ? 'Back JPGs To Overwrite' : 'Back JPGs', counts.backCards || 0);

  const missingWarning = getMissingWarning(counts);
  const restoreWarning = isRestore
    ? 'This will replace the selected cohort only. Other cohorts will not be changed.'
    : '';
  const regenerateWarning = isRegenerate
    ? 'Existing generated front/back JPGs will be overwritten.'
    : '';
  elements.datasetWarning.textContent = [missingWarning, restoreWarning, regenerateWarning].filter(Boolean).join(' ');
  elements.datasetWarning.hidden = !elements.datasetWarning.textContent;
  resetDatasetProgress();

  setDatasetConfirmLoading(false);
  elements.confirmDatasetAction.querySelector('span').textContent = isRestore
    ? 'Restore Dataset'
    : isRegenerate
      ? 'Regenerate Cards'
      : 'Backup Dataset';
  elements.confirmDatasetAction.hidden = false;
  elements.cancelDatasetAction.textContent = 'Cancel';
  elements.datasetModal.hidden = false;
  document.body.classList.add('modal-open');
  refreshIcons();
}

function closeDatasetModal() {
  if (datasetBusy) {
    return;
  }

  elements.datasetModal.hidden = true;
  datasetAction = null;
  restoreFile = null;
  regenerateIcNumber = null;
  elements.restoreDatasetInput.value = '';
  document.body.classList.remove('modal-open');
}

function resetDatasetProgress() {
  updateDatasetProgress(0, 0, '');
  elements.datasetProgress.hidden = true;
}

function updateDatasetProgress(done, total, label = '') {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  elements.datasetProgress.hidden = false;
  elements.datasetProgressLabel.textContent = label || 'Regenerating cards...';
  elements.datasetProgressCount.textContent = `${done} / ${total}`;
  elements.datasetProgressBar.style.width = `${percent}%`;
  elements.datasetProgressTrack.setAttribute('aria-valuenow', String(percent));
}

function showRegenerationSummary(total, regenerated, skippedRecords) {
  elements.datasetModalTitle.textContent = 'REGENERATION COMPLETE';
  elements.datasetSummary.innerHTML = '';
  addSummaryRow('Records Processed', total);
  addSummaryRow('Regenerated', regenerated.length);
  addSummaryRow('Skipped', skippedRecords.length);
  addSummaryRow('Front JPGs Updated', regenerated.length);
  addSummaryRow('Back JPGs Updated', regenerated.length);

  if (skippedRecords.length > 0) {
    elements.datasetWarning.textContent = skippedRecords
      .map((record) => `${record.icNumber}: ${record.error || 'Skipped'}`)
      .join(' ');
  } else {
    elements.datasetWarning.textContent = 'All selected cards were regenerated successfully.';
  }

  elements.datasetWarning.hidden = false;
  updateDatasetProgress(total, total, 'Regeneration complete.');
  elements.cancelDatasetAction.disabled = false;
  elements.closeDatasetModal.disabled = false;
  elements.cancelDatasetAction.textContent = 'Close';
  elements.confirmDatasetAction.hidden = true;
  refreshIcons();
}

function setDatasetConfirmLoading(isLoading) {
  datasetBusy = isLoading;
  elements.confirmDatasetAction.disabled = isLoading;
  elements.cancelDatasetAction.disabled = isLoading;
  elements.closeDatasetModal.disabled = isLoading;
  elements.confirmDatasetAction.classList.toggle('loading', isLoading);
  elements.confirmDatasetAction.querySelector('i, svg')?.setAttribute('data-lucide', isLoading ? 'loader-circle' : 'check');
  refreshIcons();
}

async function showBackupModal() {
  if (currentCount === 0) {
    return;
  }

  setStatus('Loading backup summary...');
  elements.backupDataset.disabled = true;

  try {
    const summary = await fetchDatasetSummary();
    openDatasetModal('backup', summary);
    setStatus(`${currentCount} matching record${currentCount === 1 ? '' : 's'} ready.`, 'ready');
  } catch (error) {
    setStatus(error.message || 'Could not load backup summary.', 'error');
  } finally {
    elements.backupDataset.disabled = currentCount === 0;
  }
}

async function showRegenerateModal() {
  if (currentCount === 0) {
    return;
  }

  setStatus('Loading regeneration summary...');
  elements.regenerateCards.disabled = true;

  try {
    const summary = await fetchDatasetSummary();
    openDatasetModal('regenerate', {
      ...summary,
      counts: {
        records: summary.counts.records || 0,
        frontCards: summary.counts.records || 0,
        backCards: summary.counts.records || 0,
        missingPhotos: summary.counts.missingPhotos || 0,
        missingFrontCards: 0,
        missingBackCards: 0,
      },
    });
    setStatus(`${currentCount} matching record${currentCount === 1 ? '' : 's'} ready.`, 'ready');
  } catch (error) {
    setStatus(error.message || 'Could not load regeneration summary.', 'error');
  } finally {
    elements.regenerateCards.disabled = currentCount === 0;
  }
}

function showRowRegenerateModal(button) {
  const filters = getFilters();
  openDatasetModal('regenerate-row', {
    program: filters.program,
    sesi: filters.sesi,
    name: button.dataset.name,
    icNumber: button.dataset.icNumber,
    counts: {
      records: 1,
      frontCards: 1,
      backCards: 1,
      missingPhotos: 0,
      missingFrontCards: 0,
      missingBackCards: 0,
    },
  });
}

function chooseRestoreFile() {
  elements.restoreDatasetInput.value = '';
  elements.restoreDatasetInput.click();
}

async function showRestoreModal() {
  const file = elements.restoreDatasetInput.files?.[0];
  if (!file) {
    return;
  }

  const filters = getFilters();
  const payload = new FormData();
  payload.set('backup', file, file.name);
  setStatus('Reading backup summary...');
  elements.restoreDataset.disabled = true;

  try {
    const response = await fetch(`/api/exports/dataset-restore-summary?${buildQuery(filters)}`, {
      method: 'POST',
      body: payload,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Could not read backup.');
    }

    openDatasetModal('restore', result, file);
    setStatus('Backup summary ready.', 'ready');
  } catch (error) {
    elements.restoreDatasetInput.value = '';
    setStatus(error.message || 'Could not read backup.', 'error');
  } finally {
    elements.restoreDataset.disabled = false;
  }
}

async function confirmBackup() {
  const filters = getFilters();
  setDatasetConfirmLoading(true);
  setStatus('Preparing backup...');
  window.location.href = `/api/exports/dataset-backup.zip?${buildQuery(filters)}`;

  window.setTimeout(() => {
    setDatasetConfirmLoading(false);
    closeDatasetModal();
    setStatus('Backup started.', 'ready');
  }, 900);
}

async function confirmRestore() {
  if (!restoreFile) {
    closeDatasetModal();
    return;
  }

  const filters = getFilters();
  const payload = new FormData();
  payload.set('backup', restoreFile, restoreFile.name);
  setDatasetConfirmLoading(true);
  setStatus('Restoring dataset...');

  try {
    const response = await fetch(`/api/exports/dataset-restore?${buildQuery(filters)}`, {
      method: 'POST',
      body: payload,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Restore failed.');
    }

    setDatasetConfirmLoading(false);
    closeDatasetModal();
    setStatus('Restore complete.', 'ready');
    await refreshCount();
  } catch (error) {
    setDatasetConfirmLoading(false);
    setStatus(error.message || 'Restore failed.', 'error');
  }
}

async function confirmRegenerate() {
  const filters = getFilters();
  const isRow = datasetAction === 'regenerate-row';
  const records = isRow
    ? [{ icNumber: regenerateIcNumber }]
    : currentRecords.map((record) => ({ icNumber: record.icNumber, name: record.name }));
  const regenerated = [];
  const skippedRecords = [];

  setDatasetConfirmLoading(true);
  setStatus('Regenerating cards...');
  updateDatasetProgress(0, records.length, 'Starting regeneration...');

  try {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      updateDatasetProgress(index, records.length, record.name ? `Regenerating ${record.name}...` : 'Regenerating card...');
      const response = await fetch(`/api/exports/records/${encodeURIComponent(record.icNumber)}/regenerate?${buildQuery(filters)}`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        skippedRecords.push({
          icNumber: record.icNumber,
          error: result.error || 'Regeneration failed.',
        });
      } else if (Number(result.skipped || 0) > 0) {
        skippedRecords.push(...(result.skippedRecords || []));
      } else {
        regenerated.push(...(result.records || []));
      }

      updateDatasetProgress(index + 1, records.length, record.name ? `Finished ${record.name}` : 'Card regenerated.');
    }

    const skipped = skippedRecords.length;
    setDatasetConfirmLoading(false);
    showRegenerationSummary(records.length, regenerated, skippedRecords);
    setStatus(
      skipped
        ? `Regeneration complete with ${skipped} skipped record${skipped === 1 ? '' : 's'}.`
        : 'Regeneration complete.',
      skipped ? 'error' : 'ready',
    );
    await refreshCount();
  } catch (error) {
    setDatasetConfirmLoading(false);
    setStatus(error.message || 'Regeneration failed.', 'error');
  }
}

function confirmDatasetAction() {
  if (datasetBusy) {
    return;
  }

  if (datasetAction === 'backup') {
    confirmBackup();
  } else if (datasetAction === 'restore') {
    confirmRestore();
  } else if (datasetAction === 'regenerate' || datasetAction === 'regenerate-row') {
    confirmRegenerate();
  }
}

function openCardModal(button) {
  const icNumber = button.dataset.icNumber;
  const side = button.dataset.side;
  const name = button.dataset.name;

  elements.cardModalTitle.textContent = `${side === 'front' ? 'Front' : 'Back'} Card - ${name}`;
  elements.cardModalImage.alt = `${side === 'front' ? 'Front' : 'Back'} card for ${name}`;
  elements.cardModalImage.src = `/api/exports/records/${encodeURIComponent(icNumber)}/${side}?${buildQuery(getFilters())}&v=${Date.now()}`;
  elements.cardModal.hidden = false;
  document.body.classList.add('modal-open');
  refreshIcons();
}

function downloadPhoto(button) {
  const icNumber = button.dataset.icNumber;
  if (!icNumber) {
    return;
  }

  window.location.href = `/api/students/${encodeURIComponent(icNumber)}/photo?download=1`;
}

function closeCardModal() {
  elements.cardModal.hidden = true;
  elements.cardModalImage.removeAttribute('src');
  document.body.classList.remove('modal-open');
}

async function deleteRecord(button) {
  const icNumber = button.dataset.icNumber;
  const name = button.dataset.name;

  if (!icNumber || !window.confirm(`Delete ${name} (${icNumber})?`)) {
    return;
  }

  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle" aria-hidden="true"></i><span>Deleting...</span>';
  button.classList.add('loading');
  refreshIcons();

  try {
    const response = await fetch(`/api/exports/records/${encodeURIComponent(icNumber)}?${buildQuery(getFilters())}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Delete failed');
    }

    await refreshCount();
  } catch (error) {
    setError(error.message || 'Could not delete record.');
  }
}

refreshIcons();

elements.program.addEventListener('input', scheduleCountRefresh);
elements.sesi.addEventListener('input', scheduleCountRefresh);
elements.acceptingResponseToggle.addEventListener('change', updateAcceptingResponseSetting);
elements.downloadZip.addEventListener('click', downloadZip);
elements.backupDataset.addEventListener('click', showBackupModal);
elements.regenerateCards.addEventListener('click', showRegenerateModal);
elements.restoreDataset.addEventListener('click', chooseRestoreFile);
elements.restoreDatasetInput.addEventListener('change', showRestoreModal);
elements.confirmDatasetAction.addEventListener('click', confirmDatasetAction);
elements.closeDatasetModal.addEventListener('click', closeDatasetModal);
elements.cancelDatasetAction.addEventListener('click', closeDatasetModal);
elements.recordsTableBody.addEventListener('click', (event) => {
  const previewButton = event.target.closest('.row-icon-button');
  if (previewButton) {
    if (previewButton.dataset.action === 'download-photo') {
      downloadPhoto(previewButton);
      return;
    }

    if (!previewButton.dataset.side) {
      showRowRegenerateModal(previewButton);
      return;
    }

    openCardModal(previewButton);
    return;
  }

  const button = event.target.closest('.row-delete-button');
  if (button) {
    deleteRecord(button);
  }
});
elements.closeCardModal.addEventListener('click', closeCardModal);
elements.cardModal.addEventListener('click', (event) => {
  if (event.target === elements.cardModal) {
    closeCardModal();
  }
});
elements.datasetModal.addEventListener('click', (event) => {
  if (event.target === elements.datasetModal) {
    closeDatasetModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!elements.cardModal.hidden) {
      closeCardModal();
    } else if (!elements.datasetModal.hidden) {
      closeDatasetModal();
    }
  }
});

async function init() {
  try {
    await loadCohort();
    await loadAcceptingResponseSetting();
    await refreshCount();
  } catch (error) {
    setError(error.message || 'Could not load cohort.');
  }
}

init();
