const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';

const elements = {
  program: document.querySelector('#exportProgram'),
  sesi: document.querySelector('#exportSesi'),
  count: document.querySelector('#exportCount'),
  recordsTableBody: document.querySelector('#recordsTableBody'),
  downloadZip: document.querySelector('#downloadZip'),
  cardModal: document.querySelector('#cardModal'),
  cardModalTitle: document.querySelector('#cardModalTitle'),
  cardModalImage: document.querySelector('#cardModalImage'),
  closeCardModal: document.querySelector('#closeCardModal'),
};

let countTimer = null;
let currentCount = 0;

function getFilters() {
  return {
    program: elements.program.value.trim() || DEFAULT_PROGRAM,
    sesi: elements.sesi.value.trim() || DEFAULT_SESI,
  };
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  params.set('program', filters.program);
  params.set('sesi', filters.sesi);
  return params.toString();
}

function setLoading(message) {
  elements.count.classList.remove('error', 'ready');
  elements.count.textContent = message;
  elements.downloadZip.disabled = true;
  renderTableMessage('Loading records...');
}

function setCount(count) {
  currentCount = count;
  elements.count.classList.remove('error', 'ready');

  if (count === 0) {
    elements.count.textContent = 'No matching records.';
    elements.downloadZip.disabled = true;
    renderTableMessage('No matching records.');
    return;
  }

  elements.count.textContent = `${count} matching record${count === 1 ? '' : 's'} ready.`;
  elements.count.classList.add('ready');
  elements.downloadZip.disabled = false;
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

    deleteButton.className = 'row-delete-button';
    deleteButton.type = 'button';
    deleteButton.dataset.icNumber = record.icNumber;
    deleteButton.dataset.name = record.name;
    deleteButton.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
    actionCell.append(frontButton, backButton, deleteButton);

    row.append(numberCell, nameCell, matrixCell, icCell, actionCell);
    elements.recordsTableBody.append(row);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setError(message) {
  currentCount = 0;
  elements.count.textContent = message;
  elements.count.classList.remove('ready');
  elements.count.classList.add('error');
  elements.downloadZip.disabled = true;
  renderTableMessage('Could not load records.');
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
  elements.count.classList.remove('error', 'ready');
  elements.count.textContent = 'Preparing ZIP...';

  window.location.href = `/api/exports/cards.zip?${buildQuery(filters)}`;

  window.setTimeout(() => {
    elements.count.textContent = 'Download started.';
    elements.count.classList.add('ready');
    elements.downloadZip.disabled = currentCount === 0;
  }, 900);
}

function openCardModal(button) {
  const icNumber = button.dataset.icNumber;
  const side = button.dataset.side;
  const name = button.dataset.name;

  elements.cardModalTitle.textContent = `${side === 'front' ? 'Front' : 'Back'} Card - ${name}`;
  elements.cardModalImage.alt = `${side === 'front' ? 'Front' : 'Back'} card for ${name}`;
  elements.cardModalImage.src = `/api/exports/records/${encodeURIComponent(icNumber)}/${side}?v=${Date.now()}`;
  elements.cardModal.hidden = false;
  document.body.classList.add('modal-open');

  if (window.lucide) {
    window.lucide.createIcons();
  }
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

  if (window.lucide) {
    window.lucide.createIcons();
  }

  try {
    const response = await fetch(`/api/exports/records/${encodeURIComponent(icNumber)}`, {
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

if (window.lucide) {
  window.lucide.createIcons();
}

elements.program.addEventListener('input', scheduleCountRefresh);
elements.sesi.addEventListener('input', scheduleCountRefresh);
elements.downloadZip.addEventListener('click', downloadZip);
elements.recordsTableBody.addEventListener('click', (event) => {
  const previewButton = event.target.closest('.row-icon-button');
  if (previewButton) {
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
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.cardModal.hidden) {
    closeCardModal();
  }
});

refreshCount();
