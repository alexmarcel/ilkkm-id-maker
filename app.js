const TEMPLATE_WIDTH = 1967;
const TEMPLATE_HEIGHT = 3121;
const RENDER_SCALE = 2;
const PROGRAM = 'DIPLOMA KEJURURAWATAN';
const SESI = 'SESI JANUARI 2026 - DISEMBER 2028';

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
  activeSide: 'front',
  dirty: {
    front: true,
    back: true,
  },
  renderTimer: null,
};

const elements = {
  form: document.querySelector('#cardForm'),
  photoInput: document.querySelector('#photoInput'),
  photoButtonText: document.querySelector('#photoButtonText'),
  nameInput: document.querySelector('#nameInput'),
  matrixInput: document.querySelector('#matrixInput'),
  icInput: document.querySelector('#icInput'),
  uploadButton: document.querySelector('.upload-button'),
  downloadFrontPreview: document.querySelector('#downloadFrontPreview'),
  downloadBackPreview: document.querySelector('#downloadBackPreview'),
  frontTab: document.querySelector('#frontTab'),
  backTab: document.querySelector('#backTab'),
  frontCanvas: document.querySelector('#frontCanvas'),
  backCanvas: document.querySelector('#backCanvas'),
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

function getFormData() {
  return {
    name: elements.nameInput.value.trim().toUpperCase(),
    matrix: elements.matrixInput.value.trim().toUpperCase(),
    ic: elements.icInput.value.trim().toUpperCase(),
    program: PROGRAM,
    sesi: SESI,
  };
}

function isValidIc(value) {
  return /^\d{6}-\d{2}-\d{4}$/.test(value);
}

function isReady() {
  const data = getFormData();
  return Boolean(state.uploadedPhoto && data.name && data.matrix && isValidIc(data.ic));
}

function updateStatus() {
  const data = getFormData();
  const ready = isReady();
  elements.downloadFrontPreview.disabled = !ready;
  elements.downloadBackPreview.disabled = !ready;

  if (data.ic && !isValidIc(data.ic)) {
    elements.icInput.setCustomValidity('Use IC format 860108-49-5026.');
  } else {
    elements.icInput.setCustomValidity('');
  }
}

function prepareText(context, fontSize) {
  context.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
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

  drawLeftSingleLine(context, data.program, LAYOUT.back.program);
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

function downloadRenderedSide(side) {
  const canvas = document.createElement('canvas');
  canvas.width = TEMPLATE_WIDTH;
  canvas.height = TEMPLATE_HEIGHT;

  const context = canvas.getContext('2d');
  const drawScene = side === 'front' ? drawFrontScene : drawBackScene;
  renderSupersampled(context, drawScene);

  canvas.toBlob((blob) => downloadBlob(blob, getFilename(side)), 'image/jpeg', 0.95);
}

function getFilename(suffix) {
  const ic = getFormData().ic.replace(/-/g, '');
  return `${ic}_${suffix}.jpg`;
}

async function handlePhotoChange() {
  const file = elements.photoInput.files[0];

  if (!file) {
    state.uploadedPhoto = null;
    elements.photoButtonText.textContent = 'Upload Photo';
    markDirty();
    renderNow();
    return;
  }

  elements.photoButtonText.textContent = file.name;
  const objectUrl = URL.createObjectURL(file);
  try {
    state.uploadedPhoto = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
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

async function init() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  try {
    const [frontTemplate, backTemplate] = await Promise.all([
      loadImage('front.jpg'),
      loadImage('back.jpg'),
    ]);

    state.templates.front = frontTemplate;
    state.templates.back = backTemplate;
  } catch (error) {
    elements.photoButtonText.textContent = 'Template load failed';
  }

  renderNow();
}

elements.photoInput.addEventListener('change', handlePhotoChange);
elements.uploadButton.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.photoInput.click();
  }
});
elements.nameInput.addEventListener('input', scheduleRender);
elements.matrixInput.addEventListener('input', scheduleRender);
elements.icInput.addEventListener('input', (event) => {
  formatIcInput(event);
  scheduleRender();
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

init();
