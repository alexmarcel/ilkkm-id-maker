const TEMPLATE_WIDTH = 1967;
const TEMPLATE_HEIGHT = 3121;
const RENDER_SCALE = 2;
const MAX_PHOTO_SIZE = 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const MATRIX_PATTERN = /^[A-Z]{4} \d\/\d{4}\(\d{2}\)-\d{4}$/;
const PHOTO_JPEG_TYPE = 'image/jpeg';
const PHOTO_JPEG_EXTENSION = '.jpg';
const CARD_FONT_FAMILY = 'IDCardFont';
const CARD_FONT_STACK = `"${CARD_FONT_FAMILY}", sans-serif`;
const PHOTO_COMPRESSION = {
  startQuality: 0.9,
  minQuality: 0.65,
  qualityStep: 0.05,
};
const SAVE_OVERLAY_HIDE_DELAY = 3000;

const LAYOUT = {
  front: {
    photo: { x: 622, y: 1097, width: 727, height: 994 },
    name: {
      x: 984,
      centerY: 2348,
      maxWidth: 1360,
      fontSize: 116,
      minFontSize: 58,
      lineHeight: 128,
      maxLines: 2,
    },
    matrix: {
      x: 984,
      y: 2656,
      maxWidth: 1300,
      fontSize: 108,
      minFontSize: 56,
    },
  },
  back: {
    name: {
      x: 383,
      y: 157,
      maxWidth: 1440,
      fontSize: 72,
      minFontSize: 44,
      lineHeight: 84,
      maxLines: 2,
    },
    matrix: {
      x: 610,
      y: 352,
      maxWidth: 1180,
      fontSize: 72,
      minFontSize: 44,
    },
    ic: {
      x: 925,
      y: 448,
      maxWidth: 850,
      fontSize: 72,
      minFontSize: 44,
    },
    program: {
      x: 520,
      y: 544,
      maxWidth: 1220,
      fontSize: 72,
      minFontSize: 44,
      lineHeight: 78,
    },
    sesi: {
      x: 100,
      y: 735,
      maxWidth: 1500,
      fontSize: 72,
      minFontSize: 44,
    },
  },
};

const state = {
  templates: {
    front: null,
    back: null,
  },
  uploadedPhoto: null,
  uploadedPhotoFile: null,
  activeSide: 'front',
  dirty: {
    front: true,
    back: true,
  },
  renderTimer: null,
  lookupTimer: null,
  lookupController: null,
  saveInProgress: false,
  fontReady: false,
  fontError: false,
  acceptingResponse: false,
  cohort: null,
};

const elements = {
  form: document.querySelector('#cardForm'),
  photoInput: document.querySelector('#photoInput'),
  photoButtonText: document.querySelector('#photoButtonText'),
  photoStatus: document.querySelector('#photoStatus'),
  nameInput: document.querySelector('#nameInput'),
  matrixInput: document.querySelector('#matrixInput'),
  icInput: document.querySelector('#icInput'),
  programInput: document.querySelector('#programInput'),
  sesiInput: document.querySelector('#sesiInput'),
  uploadButton: document.querySelector('.upload-button'),
  saveStudent: document.querySelector('#saveStudent'),
  saveStatus: document.querySelector('#saveStatus'),
  downloadFrontPreview: document.querySelector('#downloadFrontPreview'),
  downloadBackPreview: document.querySelector('#downloadBackPreview'),
  refreshRecords: document.querySelector('#refreshRecords'),
  gridPreviewLink: document.querySelector('#gridPreviewLink'),
  exportsLink: document.querySelector('#exportsLink'),
  cohortRecordsBody: document.querySelector('#cohortRecordsBody'),
  savingOverlay: document.querySelector('#savingOverlay'),
  frontTab: document.querySelector('#frontTab'),
  backTab: document.querySelector('#backTab'),
  frontCanvas: document.querySelector('#frontCanvas'),
  backCanvas: document.querySelector('#backCanvas'),
  previewClosedOverlay: document.querySelector('#previewClosedOverlay'),
};

const frontContext = elements.frontCanvas.getContext('2d');
const backContext = elements.backCanvas.getContext('2d');

function setHighQualitySmoothing(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

function renderSupersampled(targetContext, drawScene) {
  const buffer = document.createElement('canvas');
  buffer.width = TEMPLATE_WIDTH * RENDER_SCALE;
  buffer.height = TEMPLATE_HEIGHT * RENDER_SCALE;

  const bufferContext = buffer.getContext('2d');
  setHighQualitySmoothing(bufferContext);
  bufferContext.scale(RENDER_SCALE, RENDER_SCALE);
  drawScene(bufferContext);

  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  setHighQualitySmoothing(targetContext);
  targetContext.clearRect(0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  targetContext.drawImage(buffer, 0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

function getCanvasBlob(canvas, type = PHOTO_JPEG_TYPE, quality = 0.9) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function loadBlobImage(blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getCroppedSourceRect(image, targetRatio) {
  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }

  return { sx, sy, sw, sh };
}

async function compressUploadedPhoto(file) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const sourceImage = await loadImage(objectUrl);
    const photoBox = LAYOUT.front.photo;
    const canvas = document.createElement('canvas');
    canvas.width = photoBox.width;
    canvas.height = photoBox.height;

    const context = canvas.getContext('2d');
    setHighQualitySmoothing(context);

    const crop = getCroppedSourceRect(sourceImage, photoBox.width / photoBox.height);
    context.drawImage(
      sourceImage,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    for (
      let quality = PHOTO_COMPRESSION.startQuality;
      quality >= PHOTO_COMPRESSION.minQuality;
      quality -= PHOTO_COMPRESSION.qualityStep
    ) {
      const blob = await getCanvasBlob(canvas, PHOTO_JPEG_TYPE, quality);
      if (blob && blob.size <= MAX_PHOTO_SIZE) {
        return {
          blob,
          image: await loadBlobImage(blob),
        };
      }
    }

    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getFormData() {
  return {
    name: elements.nameInput.value.trim().toUpperCase(),
    matrix: elements.matrixInput.value.trim().toUpperCase(),
    ic: elements.icInput.value.trim().toUpperCase(),
    program: (elements.programInput?.value || state.cohort?.program || '').trim().toUpperCase(),
    sesi: (elements.sesiInput?.value || state.cohort?.sesi || '').trim().toUpperCase(),
  };
}

function isValidIc(value) {
  return /^\d{6}-\d{2}-\d{4}$/.test(value);
}

function isValidMatrix(value) {
  return MATRIX_PATTERN.test(value);
}

function isReady() {
  const data = getFormData();
  return Boolean(
    !state.acceptingResponse
    && state.fontReady
    && state.uploadedPhoto
    && data.name
    && isValidMatrix(data.matrix)
    && isValidIc(data.ic)
  );
}

function hasIcValue() {
  return Boolean(elements.icInput.value.trim());
}

function updateFieldAvailability() {
  if (state.acceptingResponse) {
    elements.icInput.disabled = true;
    elements.photoInput.disabled = true;
    elements.nameInput.disabled = true;
    elements.matrixInput.disabled = true;
    elements.uploadButton.classList.add('disabled');
    elements.uploadButton.setAttribute('aria-disabled', 'true');
    elements.uploadButton.tabIndex = -1;
    return;
  }

  const enabled = isValidIc(getFormData().ic);

  elements.icInput.disabled = false;
  elements.photoInput.disabled = !enabled;
  elements.nameInput.disabled = !enabled;
  elements.matrixInput.disabled = !enabled;
  elements.uploadButton.classList.toggle('disabled', !enabled);
  elements.uploadButton.setAttribute('aria-disabled', String(!enabled));
  elements.uploadButton.tabIndex = enabled ? 0 : -1;
}

function updateClosedOverlay() {
  elements.previewClosedOverlay.hidden = !state.acceptingResponse;
}

function clearStudentFields() {
  state.uploadedPhoto = null;
  state.uploadedPhotoFile = null;
  elements.photoInput.value = '';
  elements.nameInput.value = '';
  elements.matrixInput.value = '';
  elements.photoButtonText.textContent = 'Upload Photo';
  setPhotoStatus('');
  markDirty();
  renderNow();
}

function updateStatus() {
  const data = getFormData();
  updateFieldAvailability();
  updateClosedOverlay();
  const ready = isReady();
  elements.downloadFrontPreview.disabled = !ready;
  elements.downloadBackPreview.disabled = !ready;
  elements.saveStudent.disabled = !ready || state.saveInProgress;

  if (state.acceptingResponse) {
    elements.icInput.setCustomValidity('');
    elements.matrixInput.setCustomValidity('');
    setSaveStatus('Responses closed. Please contact admin.');
    return;
  }

  if (data.ic && !isValidIc(data.ic)) {
    elements.icInput.setCustomValidity('Use IC format 860108-49-5026.');
  } else {
    elements.icInput.setCustomValidity('');
  }

  if (data.matrix && !isValidMatrix(data.matrix)) {
    elements.matrixInput.setCustomValidity('Use matrix format ABCD 1/1111(11)-1111.');
  } else {
    elements.matrixInput.setCustomValidity('');
  }

  if (state.fontError) {
    setSaveStatus('Card font failed to load. Save and download are disabled.', 'error');
  }
}

function setSaveButtonLoading(isLoading) {
  const iconElement = elements.saveStudent.querySelector('i, svg');
  const labelElement = elements.saveStudent.querySelector('span');

  labelElement.textContent = isLoading ? 'Saving...' : 'Save';
  elements.saveStudent.classList.toggle('loading', isLoading);

  if (iconElement) {
    iconElement.setAttribute('data-lucide', isLoading ? 'loader-circle' : 'save');
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setSavingOverlay(isVisible) {
  elements.savingOverlay.hidden = !isVisible;
  document.body.classList.toggle('modal-open', isVisible);
}

function setSaveStatus(message, type = '') {
  const messageElement = elements.saveStatus.querySelector('span');
  const iconElement = elements.saveStatus.querySelector('i, svg');
  messageElement.textContent = message;
  elements.saveStatus.classList.remove('error', 'ready', 'loading');

  if (type) {
    elements.saveStatus.classList.add(type);
  }

  setStatusIcon(iconElement, type);
}

function setPhotoStatus(message, type = '') {
  const messageElement = elements.photoStatus.querySelector('span');
  const iconElement = elements.photoStatus.querySelector('i, svg');
  messageElement.textContent = message;
  elements.photoStatus.classList.remove('error', 'ready');
  elements.photoStatus.classList.toggle('has-message', Boolean(message));

  if (type) {
    elements.photoStatus.classList.add(type);
  }

  setStatusIcon(iconElement, type);
}

async function loadCardFont() {
  if (!document.fonts || typeof document.fonts.load !== 'function') {
    state.fontReady = true;
    return;
  }

  setSaveStatus('Loading card font...', 'loading');

  try {
    await document.fonts.load(`700 72px "${CARD_FONT_FAMILY}"`);
    await document.fonts.ready;

    const isLoaded = document.fonts.check(`700 72px "${CARD_FONT_FAMILY}"`);
    if (!isLoaded) {
      throw new Error('Card font did not load.');
    }

    state.fontReady = true;
    state.fontError = false;
    setSaveStatus('Enter a valid IC number to check saved data.');
  } catch (error) {
    state.fontReady = false;
    state.fontError = true;
    setSaveStatus('Card font failed to load. Save and download are disabled.', 'error');
  }

  updateStatus();
}

function setStatusIcon(iconElement, type = '') {
  if (!iconElement) {
    return;
  }

  const iconName = type === 'ready'
    ? 'circle-check'
    : type === 'error'
      ? 'circle-alert'
      : type === 'loading'
        ? 'loader-circle'
        : 'info';

  iconElement.setAttribute('data-lucide', iconName);

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function prepareText(context, fontSize) {
  context.font = `700 ${fontSize}px ${CARD_FONT_STACK}`;
  context.fillStyle = '#000';
  context.textBaseline = 'alphabetic';
}

function fitSingleLine(context, text, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  prepareText(context, size);

  while (context.measureText(text).width > maxWidth && size > minFontSize) {
    size -= 2;
    prepareText(context, size);
  }

  while (context.measureText(text).width > maxWidth && size > 18) {
    size -= 2;
    prepareText(context, size);
  }

  return size;
}

function wrapWords(context, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (!current || context.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
}

function wrapIntoTwoLines(context, text, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  let lines = [text];

  while (size >= minFontSize) {
    prepareText(context, size);
    lines = wrapWords(context, text, maxWidth);

    if (lines.length <= 2 && lines.every((line) => context.measureText(line).width <= maxWidth)) {
      return { lines, size };
    }

    size -= 2;
  }

  while (size > 18) {
    prepareText(context, size);
    lines = wrapWords(context, text, maxWidth);

    if (lines.length <= 2 && lines.every((line) => context.measureText(line).width <= maxWidth)) {
      return { lines, size };
    }

    size -= 2;
  }

  prepareText(context, 18);
  lines = wrapWords(context, text, maxWidth);

  if (lines.length > 2) {
    const first = lines[0];
    const second = lines.slice(1).join(' ');
    return { lines: [first, second], size: 18 };
  }

  return { lines, size: 18 };
}

function drawCenteredSingleLine(context, text, config) {
  const size = fitSingleLine(context, text, config.maxWidth, config.fontSize, config.minFontSize);
  prepareText(context, size);
  context.textAlign = 'center';
  context.fillText(text, config.x, config.y);
}

function drawLeftSingleLine(context, text, config) {
  const size = fitSingleLine(context, text, config.maxWidth, config.fontSize, config.minFontSize);
  prepareText(context, size);
  context.textAlign = 'left';
  context.fillText(text, config.x, config.y);
}

function drawCenteredWrappedName(context, text, config) {
  const wrapped = wrapIntoTwoLines(context, text, config.maxWidth, config.fontSize, config.minFontSize);
  const lineHeight = Math.min(config.lineHeight, Math.round(wrapped.size * 1.12));
  const firstY = wrapped.lines.length === 1
    ? config.centerY
    : config.centerY - lineHeight / 2;

  prepareText(context, wrapped.size);
  context.textAlign = 'center';

  wrapped.lines.forEach((line, index) => {
    context.fillText(line, config.x, firstY + index * lineHeight);
  });
}

function drawLeftWrappedName(context, text, config) {
  const wrapped = wrapIntoTwoLines(context, text, config.maxWidth, config.fontSize, config.minFontSize);

  prepareText(context, wrapped.size);
  context.textAlign = 'left';

  wrapped.lines.forEach((line, index) => {
    context.fillText(line, config.x, config.y + index * config.lineHeight);
  });
}

function drawCroppedImage(context, image, box) {
  const sourceRatio = image.width / image.height;
  const targetRatio = box.width / box.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }

  context.drawImage(image, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
}

function drawFrontScene(context) {
  const data = getFormData();

  context.clearRect(0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  setHighQualitySmoothing(context);

  if (state.templates.front) {
    context.drawImage(state.templates.front, 0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  }

  if (state.uploadedPhoto) {
    drawCroppedImage(context, state.uploadedPhoto, LAYOUT.front.photo);
  }

  if (data.name) {
    drawCenteredWrappedName(context, data.name, LAYOUT.front.name);
  }

  if (data.matrix) {
    drawCenteredSingleLine(context, data.matrix, LAYOUT.front.matrix);
  }
}

function drawBackScene(context) {
  const data = getFormData();

  context.clearRect(0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  setHighQualitySmoothing(context);

  if (state.templates.back) {
    context.drawImage(state.templates.back, 0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  }

  if (data.name) {
    drawLeftWrappedName(context, data.name, LAYOUT.back.name);
  }

  if (data.matrix) {
    drawLeftSingleLine(context, data.matrix, LAYOUT.back.matrix);
  }

  if (data.ic) {
    drawLeftSingleLine(context, data.ic, LAYOUT.back.ic);
  }

  drawLeftWrappedName(context, data.program, LAYOUT.back.program);
  drawLeftSingleLine(context, data.sesi, LAYOUT.back.sesi);
}

function renderFront() {
  drawFrontScene(frontContext);
  state.dirty.front = false;
}

function renderBack() {
  drawBackScene(backContext);
  state.dirty.back = false;
}

function markDirty() {
  state.dirty.front = true;
  state.dirty.back = true;
}

function renderActivePreview() {
  if (!state.fontReady) {
    return;
  }

  if (state.activeSide === 'front') {
    renderFront();
  } else {
    renderBack();
  }
}

function renderNow() {
  window.clearTimeout(state.renderTimer);
  renderActivePreview();
  updateStatus();
}

function scheduleRender() {
  markDirty();
  updateStatus();
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderActivePreview, 180);
}

function setActivePreview(side) {
  const isFront = side === 'front';
  state.activeSide = side;

  elements.frontCanvas.classList.toggle('active', isFront);
  elements.backCanvas.classList.toggle('active', !isFront);
  elements.downloadFrontPreview.classList.toggle('active', isFront);
  elements.downloadBackPreview.classList.toggle('active', !isFront);
  elements.frontTab.classList.toggle('active', isFront);
  elements.backTab.classList.toggle('active', !isFront);
  elements.frontTab.setAttribute('aria-selected', String(isFront));
  elements.backTab.setAttribute('aria-selected', String(!isFront));

  if (state.dirty[side]) {
    renderNow();
  }
}

function downloadBlob(blob, filename) {
  if (!blob) {
    return;
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getRenderedBlob(side) {
  const canvas = document.createElement('canvas');
  canvas.width = TEMPLATE_WIDTH;
  canvas.height = TEMPLATE_HEIGHT;

  const context = canvas.getContext('2d');
  const drawScene = side === 'front' ? drawFrontScene : drawBackScene;
  renderSupersampled(context, drawScene);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
  });
}

async function downloadRenderedSide(side) {
  if (!state.fontReady) {
    setSaveStatus('Card font failed to load. Save and download are disabled.', 'error');
    return;
  }

  const blob = await getRenderedBlob(side);
  downloadBlob(blob, getFilename(side));
}

function getFilename(suffix) {
  const ic = getFormData().ic.replace(/-/g, '');
  return `${ic}_${suffix}.jpg`;
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    query.set(key, value);
  });
  return query.toString();
}

function getCohortSlugFromPath() {
  const match = window.location.pathname.match(/^\/cohorts\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function getCohortQuery() {
  return buildQuery({ cohortSlug: state.cohort?.slug || getCohortSlugFromPath() });
}

function getTemplateUrl(side) {
  const customUrl = side === 'front' ? state.cohort?.frontTemplateUrl : state.cohort?.backTemplateUrl;
  return customUrl || `/${side}.jpg`;
}

async function loadCohort() {
  const slug = getCohortSlugFromPath();
  if (!slug) {
    window.location.href = '/';
    return;
  }

  const response = await fetch(`/api/cohorts/${encodeURIComponent(slug)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Cohort not found.');
  }

  state.cohort = result;
  elements.programInput.value = result.program;
  elements.sesiInput.value = result.sesi;
  elements.gridPreviewLink.href = `/cohorts/${encodeURIComponent(result.slug)}/grid`;
  elements.exportsLink.href = `/cohorts/${encodeURIComponent(result.slug)}/exports`;
  state.acceptingResponse = Boolean(result.acceptingResponse);
}

function renderRecordsMessage(message) {
  elements.cohortRecordsBody.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.textContent = message;
  row.append(cell);
  elements.cohortRecordsBody.append(row);
}

function renderCohortRecords(records) {
  elements.cohortRecordsBody.innerHTML = '';

  if (records.length === 0) {
    renderRecordsMessage('No saved records yet.');
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('tr');
    const numberCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const matrixCell = document.createElement('td');
    const checkCell = document.createElement('td');
    const check = document.createElement('span');

    numberCell.textContent = record.number;
    nameCell.textContent = record.name;
    matrixCell.textContent = record.matrixNumber;
    check.className = 'record-check';
    check.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
    checkCell.append(check);
    row.append(numberCell, nameCell, matrixCell, checkCell);
    elements.cohortRecordsBody.append(row);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function refreshCohortRecords() {
  renderRecordsMessage('Loading records...');

  try {
    const response = await fetch(`/api/students/records/cohort?${getCohortQuery()}`);

    if (!response.ok) {
      throw new Error('Records request failed');
    }

    const result = await response.json();
    renderCohortRecords(result.records || []);
  } catch (error) {
    renderRecordsMessage('Could not load records.');
  }
}

async function handlePhotoChange() {
  const file = elements.photoInput.files[0];

  if (!file) {
    state.uploadedPhoto = null;
    state.uploadedPhotoFile = null;
    elements.photoButtonText.textContent = 'Upload Photo';
    setPhotoStatus('');
    markDirty();
    renderNow();
    return;
  }

  if (!hasIcValue()) {
    elements.photoInput.value = '';
    setPhotoStatus('Enter IC number before uploading a photo.', 'error');
    return;
  }

  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    elements.photoInput.value = '';
    state.uploadedPhoto = null;
    state.uploadedPhotoFile = null;
    elements.photoButtonText.textContent = 'Upload Photo';
    setPhotoStatus('Photo must be a JPG or PNG image.', 'error');
    markDirty();
    renderNow();
    return;
  }

  elements.photoButtonText.textContent = file.name;
  setPhotoStatus('Compressing photo...');

  try {
    const compressed = await compressUploadedPhoto(file);
    if (!compressed) {
      throw new Error('Photo is too large to compress under 1MB.');
    }

    const filename = `${getFormData().ic.replace(/-/g, '')}_photo${PHOTO_JPEG_EXTENSION}`;
    state.uploadedPhoto = compressed.image;
    state.uploadedPhotoFile = new File([compressed.blob], filename, { type: PHOTO_JPEG_TYPE });
    elements.photoButtonText.textContent = filename;
    setPhotoStatus('Photo compressed and ready.', 'ready');
  } catch (error) {
    elements.photoInput.value = '';
    state.uploadedPhoto = null;
    state.uploadedPhotoFile = null;
    elements.photoButtonText.textContent = 'Upload Photo';
    setPhotoStatus(error.message || 'Photo compression failed.', 'error');
  }

  markDirty();
  renderNow();
}

function formatIcInput(event) {
  const digits = event.target.value.replace(/\D/g, '').slice(0, 12);
  const parts = [
    digits.slice(0, 6),
    digits.slice(6, 8),
    digits.slice(8, 12),
  ].filter(Boolean);

  event.target.value = parts.join('-');
}

function formatMatrixInput(event) {
  const raw = event.target.value.toUpperCase();
  const letters = raw.replace(/[^A-Z]/g, '').slice(0, 4);
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  let value = letters;

  if (letters.length === 4 && digits.length > 0) {
    value += ` ${digits.slice(0, 1)}`;
  }

  if (digits.length > 1) {
    value += `/${digits.slice(1, 5)}`;
  }

  if (digits.length > 5) {
    value += `(${digits.slice(5, 7)}`;
  }

  if (digits.length > 7) {
    value += `)-${digits.slice(7, 11)}`;
  } else if (digits.length > 5 && raw.includes(')')) {
    value += ')';
  }

  event.target.value = value;
}

async function lookupStudentByIc() {
  const ic = getFormData().ic;

  if (state.lookupController) {
    state.lookupController.abort();
  }

  if (!isValidIc(ic)) {
    setSaveStatus('Enter a valid IC number to check saved data.');
    return;
  }

  state.lookupController = new AbortController();
  setSaveStatus('Checking saved data...', 'loading');

  try {
    const response = await fetch(`/api/students/${encodeURIComponent(ic)}?${getCohortQuery()}`, {
      signal: state.lookupController.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 404) {
      clearStudentFields();
      setSaveStatus('No saved record found. Fill details and save.');
      return;
    }

    if (response.status === 409) {
      clearStudentFields();
      setSaveStatus(result.error || 'This IC number is already saved in another cohort.', 'error');
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || 'Lookup failed');
    }

    const student = result;
    elements.nameInput.value = student.name || '';
    elements.matrixInput.value = student.matrixNumber || '';
    state.uploadedPhoto = null;
    state.uploadedPhotoFile = null;
    elements.photoInput.value = '';
    elements.photoButtonText.textContent = 'Upload Photo';
    setPhotoStatus('');

    if (student.photoUrl) {
      const cacheBust = `v=${encodeURIComponent(student.updatedAt || Date.now())}`;
      try {
        state.uploadedPhoto = await loadImage(`${student.photoUrl}?${cacheBust}`);
        state.uploadedPhotoFile = null;
        elements.photoButtonText.textContent = `${student.icNumber.replace(/-/g, '')}_photo`;
        setPhotoStatus('Saved photo loaded.', 'ready');
      } catch (error) {
        state.uploadedPhoto = null;
        setPhotoStatus('');
      }
    }

    setSaveStatus('Saved record loaded.', 'ready');
    markDirty();
    renderNow();
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    setSaveStatus('Could not check saved data.', 'error');
  }
}

function scheduleStudentLookup() {
  window.clearTimeout(state.lookupTimer);
  updateStatus();

  if (!hasIcValue()) {
    state.uploadedPhoto = null;
    state.uploadedPhotoFile = null;
    elements.photoInput.value = '';
    elements.nameInput.value = '';
    elements.matrixInput.value = '';
    elements.photoButtonText.textContent = 'Upload Photo';
    setPhotoStatus('');
    setSaveStatus('Enter a valid IC number to check saved data.');
    markDirty();
    renderNow();
    return;
  }

  state.lookupTimer = window.setTimeout(lookupStudentByIc, 450);
}

async function saveStudent() {
  if (!isReady() || state.saveInProgress) {
    if (state.acceptingResponse) {
      setSaveStatus('Responses closed. Please contact admin.');
    }

    if (state.fontError) {
      setSaveStatus('Card font failed to load. Save and download are disabled.', 'error');
    }

    return;
  }

  state.saveInProgress = true;
  setSaveButtonLoading(true);
  setSavingOverlay(true);
  updateStatus();
  setSaveStatus('Saving student data...', 'loading');

  try {
    const data = getFormData();
    const [frontBlob, backBlob] = await Promise.all([
      getRenderedBlob('front'),
      getRenderedBlob('back'),
    ]);

    const payload = new FormData();
    payload.set('icNumber', data.ic);
    payload.set('name', data.name);
    payload.set('matrixNumber', data.matrix);
    payload.set('program', data.program);
    payload.set('sesi', data.sesi);
    payload.set('cohortSlug', state.cohort.slug);

    if (state.uploadedPhotoFile) {
      payload.set('photo', state.uploadedPhotoFile, state.uploadedPhotoFile.name);
    }

    payload.set('front', frontBlob, getFilename('front'));
    payload.set('back', backBlob, getFilename('back'));

    const response = await fetch('/api/students', {
      method: 'POST',
      body: payload,
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Could not save student.');
    }

    state.uploadedPhotoFile = null;
    setSaveStatus(`Saved`, 'ready');
    refreshCohortRecords();
  } catch (error) {
    setSaveStatus(error.message || 'Could not save student.', 'error');
  } finally {
    state.saveInProgress = false;
    setSaveButtonLoading(false);
    updateStatus();
    window.setTimeout(() => setSavingOverlay(false), SAVE_OVERLAY_HIDE_DELAY);
  }
}

async function loadAcceptingResponseSetting() {
  try {
    const response = await fetch(`/api/settings/accepting-response?${getCohortQuery()}`);
    if (!response.ok) {
      throw new Error('Setting request failed.');
    }

    const result = await response.json();
    state.acceptingResponse = Boolean(result.acceptingResponse);
  } catch (error) {
    state.acceptingResponse = false;
  }
}

async function init() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  try {
    await loadCohort();
  } catch (error) {
    setSaveStatus(error.message || 'Cohort not found.', 'error');
    return;
  }

  await loadCardFont();
  await loadAcceptingResponseSetting();

  try {
    const [frontTemplate, backTemplate] = await Promise.all([
      loadImage(getTemplateUrl('front')),
      loadImage(getTemplateUrl('back')),
    ]);

    state.templates.front = frontTemplate;
    state.templates.back = backTemplate;
  } catch (error) {
    elements.photoButtonText.textContent = 'Template load failed';
  }

  renderNow();
  refreshCohortRecords();
}

elements.photoInput.addEventListener('change', handlePhotoChange);
elements.uploadButton.addEventListener('keydown', (event) => {
  if (elements.photoInput.disabled) {
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.photoInput.click();
  }
});
elements.nameInput.addEventListener('input', scheduleRender);
elements.matrixInput.addEventListener('input', (event) => {
  formatMatrixInput(event);
  scheduleRender();
});
elements.icInput.addEventListener('input', (event) => {
  formatIcInput(event);
  scheduleRender();
  scheduleStudentLookup();
});
elements.frontTab.addEventListener('click', () => setActivePreview('front'));
elements.backTab.addEventListener('click', () => setActivePreview('back'));
elements.downloadFrontPreview.addEventListener('click', () => {
  if (isReady()) {
    downloadRenderedSide('front');
  }
});
elements.downloadBackPreview.addEventListener('click', () => {
  if (isReady()) {
    downloadRenderedSide('back');
  }
});
elements.saveStudent.addEventListener('click', saveStudent);
elements.refreshRecords.addEventListener('click', refreshCohortRecords);

init();
