const elements = {
  status: document.querySelector('#gridStatus'),
  grid: document.querySelector('#cardGrid'),
  printGrid: document.querySelector('#printGrid'),
  generatorLink: document.querySelector('#gridGeneratorLink'),
  printModal: document.querySelector('#printModal'),
  printSummary: document.querySelector('#printSummary'),
  closePrintModal: document.querySelector('#closePrintModal'),
  cancelPrintDownload: document.querySelector('#cancelPrintDownload'),
  confirmPrintDownload: document.querySelector('#confirmPrintDownload'),
};

let currentRecords = [];
let currentCohort = null;

function getCohortSlugFromPath() {
  const match = window.location.pathname.match(/^\/cohorts\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    query.set(key, value);
  });
  return query.toString();
}

function getCohortQuery() {
  return buildQuery({ cohortSlug: currentCohort?.slug || getCohortSlugFromPath() });
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.classList.remove('error', 'ready');

  if (type) {
    elements.status.classList.add(type);
  }
}

function renderMessage(message) {
  elements.grid.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'grid-empty';
  empty.textContent = message;
  elements.grid.append(empty);
}

function renderCards(records) {
  currentRecords = records;
  elements.grid.innerHTML = '';

  if (records.length === 0) {
    renderMessage('No saved records yet.');
    return;
  }

  records.forEach((record) => {
    const item = document.createElement('button');
    const inner = document.createElement('span');
    const frontImage = document.createElement('img');
    const backImage = document.createElement('img');

    item.className = 'grid-card';
    item.type = 'button';
    item.setAttribute('aria-label', `Flip card for ${record.name}`);
    item.dataset.side = 'front';
    inner.className = 'grid-card-inner';
    frontImage.className = 'grid-card-face grid-card-front';
    backImage.className = 'grid-card-face grid-card-back';
    frontImage.loading = 'lazy';
    backImage.loading = 'lazy';
    frontImage.alt = `Front card for ${record.name}`;
    backImage.alt = `Back card for ${record.name}`;
    frontImage.src = `/api/students/${encodeURIComponent(record.icNumber)}/card/front/thumbnail?${getCohortQuery()}`;
    backImage.dataset.src = `/api/students/${encodeURIComponent(record.icNumber)}/card/back/thumbnail?${getCohortQuery()}`;
    inner.append(frontImage, backImage);
    item.append(inner);
    item.addEventListener('click', () => {
      if (!backImage.src) {
        backImage.src = backImage.dataset.src;
      }

      const isBack = item.classList.toggle('flipped');
      item.dataset.side = isBack ? 'back' : 'front';
    });
    elements.grid.append(item);
  });
}

function addSummaryRow(label, value) {
  const row = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('span');
  row.className = 'summary-row';
  labelElement.textContent = label;
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  elements.printSummary.append(row);
}

function openPrintModal() {
  const totalFiles = currentRecords.length * 2;
  elements.printSummary.innerHTML = '';
  addSummaryRow('Program', currentCohort.program);
  addSummaryRow('Sesi', currentCohort.sesi);
  addSummaryRow('Students', currentRecords.length);
  addSummaryRow('Front JPGs', currentRecords.length);
  addSummaryRow('Back JPGs', currentRecords.length);
  addSummaryRow('Total JPG files', totalFiles);
  elements.confirmPrintDownload.disabled = currentRecords.length === 0;
  elements.printModal.hidden = false;
  document.body.classList.add('modal-open');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function closePrintModal() {
  elements.printModal.hidden = true;
  document.body.classList.remove('modal-open');
}

async function loadGrid() {
  setStatus('Loading cards...');
  renderMessage('Loading cards...');

  try {
    const slug = getCohortSlugFromPath();
    const cohortResponse = await fetch(`/api/cohorts/${encodeURIComponent(slug)}`);
    const cohort = await cohortResponse.json().catch(() => ({}));
    if (!cohortResponse.ok) {
      throw new Error(cohort.error || 'Cohort not found.');
    }
    currentCohort = cohort;
    elements.generatorLink.href = `/cohorts/${encodeURIComponent(cohort.slug)}`;

    const response = await fetch(`/api/students/records/cohort?${getCohortQuery()}`);

    if (!response.ok) {
      throw new Error('Records request failed.');
    }

    const result = await response.json();
    const records = result.records || [];
    renderCards(records);
    setStatus(`${records.length} card${records.length === 1 ? '' : 's'} ready.`, 'ready');
  } catch (error) {
    setStatus('Could not load cards.', 'error');
    renderMessage('Could not load cards.');
  }
}

if (window.lucide) {
  window.lucide.createIcons();
}

elements.printGrid.addEventListener('click', () => {
  openPrintModal();
});

elements.confirmPrintDownload.addEventListener('click', () => {
  setStatus('Preparing ZIP...', 'ready');
  window.location.href = `/api/exports/cards.zip?${getCohortQuery()}`;

  window.setTimeout(() => {
    setStatus('Download started.', 'ready');
    closePrintModal();
  }, 900);
});
elements.closePrintModal.addEventListener('click', closePrintModal);
elements.cancelPrintDownload.addEventListener('click', closePrintModal);
elements.printModal.addEventListener('click', (event) => {
  if (event.target === elements.printModal) {
    closePrintModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.printModal.hidden) {
    closePrintModal();
  }
});

loadGrid();
