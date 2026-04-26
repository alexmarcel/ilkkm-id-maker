const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';

const elements = {
  status: document.querySelector('#gridStatus'),
  grid: document.querySelector('#cardGrid'),
  printGrid: document.querySelector('#printGrid'),
};

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    query.set(key, value);
  });
  return query.toString();
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
    frontImage.src = `/api/students/${encodeURIComponent(record.icNumber)}/card/front?v=${Date.now()}`;
    backImage.src = `/api/students/${encodeURIComponent(record.icNumber)}/card/back?v=${Date.now()}`;
    inner.append(frontImage, backImage);
    item.append(inner);
    item.addEventListener('click', () => {
      const isBack = item.classList.toggle('flipped');
      item.dataset.side = isBack ? 'back' : 'front';
    });
    elements.grid.append(item);
  });
}

async function loadGrid() {
  setStatus('Loading cards...');
  renderMessage('Loading cards...');

  try {
    const response = await fetch(`/api/students/records/cohort?${buildQuery({
      program: DEFAULT_PROGRAM,
      sesi: DEFAULT_SESI,
    })}`);

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
  setStatus('Preparing ZIP...', 'ready');
  window.location.href = `/api/exports/cards.zip?${buildQuery({
    program: DEFAULT_PROGRAM,
    sesi: DEFAULT_SESI,
  })}`;

  window.setTimeout(() => {
    setStatus('Download started.', 'ready');
  }, 900);
});

loadGrid();
