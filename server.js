const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const archiver = require('archiver');
const Database = require('better-sqlite3');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const unzipper = require('unzipper');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, '.data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.sqlite');
const EXPORTS_DIR = process.env.EXPORTS_DIR || path.join(DATA_DIR, 'exports');
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(DATA_DIR, 'photos');
const THUMBNAILS_DIR = process.env.THUMBNAILS_DIR || path.join(DATA_DIR, 'thumbnails');
const COHORT_ICONS_DIR = process.env.COHORT_ICONS_DIR || path.join(DATA_DIR, 'cohort-icons');
const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';
const EXPORTS_USERNAME = process.env.EXPORTS_USERNAME || 'admin';
const EXPORTS_PASSWORD = process.env.EXPORTS_PASSWORD || 'ilkkm2026';
const MAX_PHOTO_SIZE = 1024 * 1024;
const MAX_RESTORE_SIZE = 500 * 1024 * 1024;
const VALID_IC_PATTERN = /^\d{6}-\d{2}-\d{4}$/;
const VALID_MATRIX_PATTERN = /^[A-Z]{4} \d\/\d{4}\(\d{2}\)-\d{4}$/;
const VALID_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;
const DEFAULT_COHORT_COLOR = '#0f8ea3';
const TEMPLATE_WIDTH = 1967;
const TEMPLATE_HEIGHT = 3121;
const THUMBNAIL_WIDTH = 720;
const FONT_PATH = path.join(ROOT_DIR, 'assets', 'fonts', 'liberation-sans-bold.ttf');
const FRONT_TEMPLATE_PATH = path.join(ROOT_DIR, 'front.jpg');
const BACK_TEMPLATE_PATH = path.join(ROOT_DIR, 'back.jpg');
const CARD_LAYOUT = {
  front: {
    photo: { x: 622, y: 1097, width: 727, height: 994 },
    name: {
      x: 984,
      centerY: 2348,
      maxWidth: 1360,
      fontSize: 116,
      minFontSize: 58,
      lineHeight: 128,
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

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
fs.mkdirSync(COHORT_ICONS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 3,
  },
});

const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_RESTORE_SIZE,
    files: 1,
  },
});

const cohortIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS cohorts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    program TEXT NOT NULL,
    sesi TEXT NOT NULL,
    icon_filename TEXT,
    accent_color TEXT NOT NULL DEFAULT '#0f8ea3',
    accepting_response_closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(program, sesi)
  );

  CREATE TABLE IF NOT EXISTS students (
    ic_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    matrix_number TEXT NOT NULL,
    program TEXT NOT NULL,
    sesi TEXT NOT NULL,
    photo_filename TEXT NOT NULL,
    front_filename TEXT NOT NULL,
    back_filename TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_students_program_sesi
    ON students (program, sesi);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_code TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    moves INTEGER NOT NULL,
    pairs INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_scores_rank
    ON game_scores (time_ms, moves, created_at);
`);

const studentColumns = db.prepare('PRAGMA table_info(students)').all().map((column) => column.name);
if (!studentColumns.includes('cohort_id')) {
  db.exec('ALTER TABLE students ADD COLUMN cohort_id INTEGER');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_students_cohort_id ON students (cohort_id)');

const cohortColumns = db.prepare('PRAGMA table_info(cohorts)').all().map((column) => column.name);
if (!cohortColumns.includes('icon_filename')) {
  db.exec('ALTER TABLE cohorts ADD COLUMN icon_filename TEXT');
}
if (!cohortColumns.includes('accent_color')) {
  db.exec(`ALTER TABLE cohorts ADD COLUMN accent_color TEXT NOT NULL DEFAULT '${DEFAULT_COHORT_COLOR}'`);
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

function isResponseClosed() {
  return getSetting('accepting_response_closed', 'false') === 'true';
}

function isCohortResponseClosed(cohort) {
  return Boolean(cohort?.accepting_response_closed);
}

function getProgramSesi(query) {
  return {
    program: String(query.program || DEFAULT_PROGRAM).trim(),
    sesi: String(query.sesi || DEFAULT_SESI).trim(),
  };
}

function slugify(value) {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getCohortSlug(program, sesi) {
  return `${slugify(program)}_${slugify(sesi)}`;
}

function normalizeProgramSesi(program, sesi) {
  return {
    program: String(program || DEFAULT_PROGRAM).trim().toUpperCase(),
    sesi: String(sesi || DEFAULT_SESI).trim().toUpperCase(),
  };
}

function normalizeColor(value) {
  const color = String(value || DEFAULT_COHORT_COLOR).trim();
  if (!VALID_COLOR_PATTERN.test(color)) {
    throw new Error('Color must be a hex value like #0f8ea3.');
  }

  return color.toLowerCase();
}

function serializeCohort(cohort, recordCount = null) {
  if (!cohort) {
    return null;
  }

  const result = {
    id: cohort.id,
    slug: cohort.slug,
    program: cohort.program,
    sesi: cohort.sesi,
    iconUrl: cohort.icon_filename
      ? `/api/cohorts/${encodeURIComponent(cohort.slug)}/icon?v=${encodeURIComponent(cohort.updated_at || '')}`
      : null,
    accentColor: cohort.accent_color || DEFAULT_COHORT_COLOR,
    acceptingResponse: Boolean(cohort.accepting_response_closed),
    createdAt: cohort.created_at,
    updatedAt: cohort.updated_at,
  };

  if (recordCount !== null) {
    result.recordCount = recordCount;
  }

  return result;
}

function getCohortBySlug(slug) {
  return db.prepare(`
    SELECT id, slug, program, sesi, icon_filename, accent_color, accepting_response_closed, created_at, updated_at
    FROM cohorts
    WHERE slug = ?
  `).get(String(slug || '').trim());
}

function getCohortByProgramSesi(program, sesi) {
  const normalized = normalizeProgramSesi(program, sesi);
  return db.prepare(`
    SELECT id, slug, program, sesi, icon_filename, accent_color, accepting_response_closed, created_at, updated_at
    FROM cohorts
    WHERE program = ? AND sesi = ?
  `).get(normalized.program, normalized.sesi);
}

function createCohort(program, sesi, options = {}) {
  const normalized = normalizeProgramSesi(program, sesi);
  const slug = getCohortSlug(normalized.program, normalized.sesi);
  const now = new Date().toISOString();
  const acceptingResponseClosed = options.acceptingResponseClosed ? 1 : 0;
  const accentColor = normalizeColor(options.accentColor);

  db.prepare(`
    INSERT INTO cohorts (slug, program, sesi, icon_filename, accent_color, accepting_response_closed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(slug, normalized.program, normalized.sesi, options.iconFilename || null, accentColor, acceptingResponseClosed, now, now);

  return getCohortBySlug(slug);
}

function getOrCreateCohort(program, sesi, options = {}) {
  return getCohortByProgramSesi(program, sesi) || createCohort(program, sesi, options);
}

function getDefaultCohort() {
  return getOrCreateCohort(DEFAULT_PROGRAM, DEFAULT_SESI, {
    acceptingResponseClosed: getSetting('accepting_response_closed', 'false') === 'true',
  });
}

function getCohortFromRequest(req) {
  const slug = String(req.params?.slug || req.query?.cohortSlug || req.body?.cohortSlug || '').trim();
  if (slug) {
    return getCohortBySlug(slug);
  }

  const { program, sesi } = getProgramSesi(req.query || req.body || {});
  return getOrCreateCohort(program, sesi);
}

function migrateCohorts() {
  const defaultCohort = getDefaultCohort();
  const groups = db.prepare(`
    SELECT DISTINCT program, sesi
    FROM students
    WHERE program IS NOT NULL AND sesi IS NOT NULL
  `).all();

  groups.forEach((group) => {
    const cohort = getOrCreateCohort(group.program, group.sesi);
    db.prepare(`
      UPDATE students
      SET cohort_id = ?, program = ?, sesi = ?
      WHERE program = ? AND sesi = ? AND (cohort_id IS NULL OR cohort_id != ?)
    `).run(cohort.id, cohort.program, cohort.sesi, group.program, group.sesi, cohort.id);
  });

  db.prepare(`
    UPDATE students
    SET cohort_id = ?
    WHERE cohort_id IS NULL
  `).run(defaultCohort.id);
}

migrateCohorts();

function stripIcHyphens(icNumber) {
  return String(icNumber).replace(/-/g, '');
}

function getPhotoExtension(mimetype) {
  if (mimetype === 'image/jpeg') {
    return '.jpg';
  }

  if (mimetype === 'image/png') {
    return '.png';
  }

  return null;
}

async function saveCohortIcon(file, slug) {
  if (!file) {
    return null;
  }

  if (!getPhotoExtension(file.mimetype)) {
    throw new Error('Cohort icon must be a JPG or PNG image.');
  }

  const filename = `${slug}_icon.jpg`;
  const iconBuffer = await sharp(file.buffer)
    .resize(360, 360, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88 })
    .toBuffer();

  writeFileEnsured(path.join(COHORT_ICONS_DIR, filename), iconBuffer);
  return filename;
}

function assertValidJpeg(file, label) {
  if (!file || file.mimetype !== 'image/jpeg') {
    throw new Error(`${label} must be a JPG image.`);
  }
}

function writeFileEnsured(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function getThumbnailFilename(icNumber, side) {
  return `${stripIcHyphens(icNumber)}_${side}.jpg`;
}

function removeStudentThumbnails(icNumber) {
  removeFileIfExists(resolveInside(THUMBNAILS_DIR, getThumbnailFilename(icNumber, 'front')));
  removeFileIfExists(resolveInside(THUMBNAILS_DIR, getThumbnailFilename(icNumber, 'back')));
}

async function getCardThumbnailPath(student, side) {
  const cardPath = getExportCardPath(student, side);
  if (!cardPath || !fs.existsSync(cardPath)) {
    return null;
  }

  const thumbnailFilename = getThumbnailFilename(student.ic_number, side);
  const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailFilename);

  if (!fs.existsSync(thumbnailPath)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    await sharp(cardPath)
      .resize({ width: THUMBNAIL_WIDTH })
      .jpeg({ quality: 86 })
      .toFile(thumbnailPath);
  }

  return thumbnailPath;
}

function getStudent(icNumber) {
  return db.prepare(`
    SELECT ic_number, cohort_id, name, matrix_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
    FROM students
    WHERE ic_number = ?
  `).get(icNumber);
}

function resolveInside(baseDir, storedFilename) {
  const safeName = path.basename(String(storedFilename || ''));
  if (!safeName) {
    return null;
  }

  const resolved = path.resolve(baseDir, safeName);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(`${normalizedBase}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function getStudents(program, sesi) {
  const cohort = getOrCreateCohort(program, sesi);
  return getStudentsByCohort(cohort);
}

function getStudentsByCohort(cohort) {
  return db.prepare(`
    SELECT ic_number, cohort_id, name, matrix_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
    FROM students
    WHERE cohort_id = ?
    ORDER BY name COLLATE NOCASE, ic_number
  `).all(cohort.id);
}

function studentBelongsToCohort(student, cohort) {
  return Boolean(student && cohort && Number(student.cohort_id) === Number(cohort.id));
}

function normalizeCohortValue(value) {
  return String(value || '').trim().toUpperCase();
}

function getDatasetSummary(program, sesi) {
  return getDatasetSummaryForCohort(getOrCreateCohort(program, sesi));
}

function getDatasetSummaryForCohort(cohort) {
  const students = getStudentsByCohort(cohort);
  const { program, sesi, slug: cohortSlug } = cohort;
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const counts = {
    records: students.length,
    photos: 0,
    frontCards: 0,
    backCards: 0,
    missingPhotos: 0,
    missingFrontCards: 0,
    missingBackCards: 0,
  };

  students.forEach((student) => {
    const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);
    const frontPath = resolveInside(cohortExportDir, student.front_filename);
    const backPath = resolveInside(cohortExportDir, student.back_filename);

    if (photoPath && fs.existsSync(photoPath)) {
      counts.photos += 1;
    } else {
      counts.missingPhotos += 1;
    }

    if (frontPath && fs.existsSync(frontPath)) {
      counts.frontCards += 1;
    } else {
      counts.missingFrontCards += 1;
    }

    if (backPath && fs.existsSync(backPath)) {
      counts.backCards += 1;
    } else {
      counts.missingBackCards += 1;
    }
  });

  return {
    program,
    sesi,
    cohortSlug,
    counts,
  };
}

function getBackupManifest(program, sesi) {
  const cohort = getOrCreateCohort(program, sesi);
  const summary = getDatasetSummaryForCohort(cohort);
  return {
    app: 'ilkkm-id-card-generator',
    type: 'cohort-dataset',
    version: 1,
    exportedAt: new Date().toISOString(),
    program,
    sesi,
    cohortSlug: summary.cohortSlug,
    counts: summary.counts,
  };
}

function estimateTextWidth(text, fontSize) {
  return String(text || '').split('').reduce((width, character) => {
    if (character === ' ') {
      return width + fontSize * 0.3;
    }

    if (/[IL1]/.test(character)) {
      return width + fontSize * 0.34;
    }

    if (/[MW]/.test(character)) {
      return width + fontSize * 0.86;
    }

    return width + fontSize * 0.62;
  }, 0);
}

function fitTextSize(text, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  while (estimateTextWidth(text, size) > maxWidth && size > minFontSize) {
    size -= 2;
  }

  while (estimateTextWidth(text, size) > maxWidth && size > 18) {
    size -= 2;
  }

  return size;
}

function wrapWordsForWidth(text, maxWidth, fontSize) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (!current || estimateTextWidth(next, fontSize) <= maxWidth) {
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

function wrapIntoTwoLines(text, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  let lines = [text];

  while (size >= minFontSize) {
    lines = wrapWordsForWidth(text, maxWidth, size);
    if (lines.length <= 2 && lines.every((line) => estimateTextWidth(line, size) <= maxWidth)) {
      return { lines, size };
    }
    size -= 2;
  }

  while (size > 18) {
    lines = wrapWordsForWidth(text, maxWidth, size);
    if (lines.length <= 2 && lines.every((line) => estimateTextWidth(line, size) <= maxWidth)) {
      return { lines, size };
    }
    size -= 2;
  }

  lines = wrapWordsForWidth(text, maxWidth, 18);
  if (lines.length > 2) {
    return { lines: [lines[0], lines.slice(1).join(' ')], size: 18 };
  }

  return { lines, size: 18 };
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textElement(text, x, y, fontSize, anchor = 'start') {
  return `<text x="${x}" y="${y}" font-size="${fontSize}" text-anchor="${anchor}">${escapeSvg(text)}</text>`;
}

function fittedTextElement(text, config, anchor = 'start') {
  const size = fitTextSize(text, config.maxWidth, config.fontSize, config.minFontSize);
  return textElement(text, config.x, config.y, size, anchor);
}

function centeredWrappedNameElements(text, config) {
  const wrapped = wrapIntoTwoLines(text, config.maxWidth, config.fontSize, config.minFontSize);
  const lineHeight = Math.min(config.lineHeight, Math.round(wrapped.size * 1.12));
  const firstY = wrapped.lines.length === 1
    ? config.centerY
    : config.centerY - lineHeight / 2;

  return wrapped.lines
    .map((line, index) => textElement(line, config.x, firstY + index * lineHeight, wrapped.size, 'middle'))
    .join('');
}

function leftWrappedNameElements(text, config) {
  const wrapped = wrapIntoTwoLines(text, config.maxWidth, config.fontSize, config.minFontSize);
  return wrapped.lines
    .map((line, index) => textElement(line, config.x, config.y + index * config.lineHeight, wrapped.size))
    .join('');
}

function buildTextSvg(elements) {
  const fontData = fs.readFileSync(FONT_PATH).toString('base64');
  return Buffer.from(`
    <svg width="${TEMPLATE_WIDTH}" height="${TEMPLATE_HEIGHT}" viewBox="0 0 ${TEMPLATE_WIDTH} ${TEMPLATE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: IDCardFont;
            src: url(data:font/truetype;charset=utf-8;base64,${fontData}) format('truetype');
            font-weight: 700;
          }
          text {
            font-family: IDCardFont, Arial, sans-serif;
            font-weight: 700;
            fill: #000;
            dominant-baseline: alphabetic;
          }
        </style>
      </defs>
      ${elements.join('')}
    </svg>
  `);
}

function getStudentRenderData(student) {
  return {
    ic: String(student.ic_number || '').trim().toUpperCase(),
    name: String(student.name || '').trim().toUpperCase(),
    matrix: String(student.matrix_number || '').trim().toUpperCase(),
    program: String(student.program || DEFAULT_PROGRAM).trim().toUpperCase(),
    sesi: String(student.sesi || DEFAULT_SESI).trim().toUpperCase(),
  };
}

async function renderStudentCards(student) {
  const data = getStudentRenderData(student);
  const icSlug = stripIcHyphens(data.ic);
  const cohortSlug = getCohortSlug(data.program, data.sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);

  if (!photoPath || !fs.existsSync(photoPath)) {
    throw new Error('Saved photo not found.');
  }

  const photoBox = CARD_LAYOUT.front.photo;
  const photoBuffer = await sharp(photoPath)
    .resize(photoBox.width, photoBox.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const frontTextSvg = buildTextSvg([
    centeredWrappedNameElements(data.name, CARD_LAYOUT.front.name),
    fittedTextElement(data.matrix, CARD_LAYOUT.front.matrix, 'middle'),
  ]);

  const backTextSvg = buildTextSvg([
    leftWrappedNameElements(data.name, CARD_LAYOUT.back.name),
    fittedTextElement(data.matrix, CARD_LAYOUT.back.matrix),
    fittedTextElement(data.ic, CARD_LAYOUT.back.ic),
    leftWrappedNameElements(data.program, CARD_LAYOUT.back.program),
    fittedTextElement(data.sesi, CARD_LAYOUT.back.sesi),
  ]);

  const frontFilename = `${icSlug}_front.jpg`;
  const backFilename = `${icSlug}_back.jpg`;
  const frontPath = path.join(cohortExportDir, frontFilename);
  const backPath = path.join(cohortExportDir, backFilename);

  fs.mkdirSync(cohortExportDir, { recursive: true });

  await sharp(FRONT_TEMPLATE_PATH)
    .resize(TEMPLATE_WIDTH, TEMPLATE_HEIGHT)
    .composite([
      { input: photoBuffer, left: photoBox.x, top: photoBox.y },
      { input: frontTextSvg, left: 0, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toFile(frontPath);

  await sharp(BACK_TEMPLATE_PATH)
    .resize(TEMPLATE_WIDTH, TEMPLATE_HEIGHT)
    .composite([{ input: backTextSvg, left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .toFile(backPath);

  removeStudentThumbnails(data.ic);

  db.prepare(`
    UPDATE students
    SET front_filename = ?, back_filename = ?, updated_at = ?
    WHERE ic_number = ?
  `).run(frontFilename, backFilename, new Date().toISOString(), data.ic);

  return {
    icNumber: data.ic,
    frontFilename,
    backFilename,
  };
}

async function regenerateStudents(students) {
  const regenerated = [];
  const skipped = [];

  for (const student of students) {
    try {
      regenerated.push(await renderStudentCards(student));
    } catch (error) {
      skipped.push({
        icNumber: student.ic_number,
        name: student.name,
        error: error.message || 'Could not regenerate cards.',
      });
    }
  }

  return {
    requested: students.length,
    regenerated: regenerated.length,
    skipped: skipped.length,
    records: regenerated,
    skippedRecords: skipped,
  };
}

function getExportCardPath(student, side) {
  const cohortSlug = getCohortSlug(student.program, student.sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const filename = side === 'front' ? student.front_filename : student.back_filename;
  return resolveInside(cohortExportDir, filename);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isSafeZipPath(entryPath) {
  const normalized = String(entryPath || '').replace(/\\/g, '/');
  return Boolean(
    normalized
    && !normalized.startsWith('/')
    && !normalized.includes('../')
    && normalized !== '..'
    && !path.isAbsolute(normalized)
  );
}

function assertSafeBackupFilename(filename, label) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName || safeName !== filename) {
    throw new Error(`${label} has an invalid filename.`);
  }

  return safeName;
}

function validateStudentBackupRows(rows, program, sesi) {
  if (!Array.isArray(rows)) {
    throw new Error('students.json must contain an array.');
  }

  const selectedProgram = normalizeCohortValue(program);
  const selectedSesi = normalizeCohortValue(sesi);
  const seenIc = new Set();

  rows.forEach((student) => {
    if (!student || typeof student !== 'object') {
      throw new Error('Backup contains an invalid student row.');
    }

    const icNumber = String(student.ic_number || '').trim();
    const matrixNumber = String(student.matrix_number || '').trim().toUpperCase();
    const rowProgram = normalizeCohortValue(student.program);
    const rowSesi = normalizeCohortValue(student.sesi);

    if (!VALID_IC_PATTERN.test(icNumber)) {
      throw new Error(`Backup contains invalid IC number: ${icNumber || 'blank'}.`);
    }

    if (seenIc.has(icNumber)) {
      throw new Error(`Backup contains duplicate IC number: ${icNumber}.`);
    }

    if (!String(student.name || '').trim()) {
      throw new Error(`Backup contains a blank name for ${icNumber}.`);
    }

    if (!VALID_MATRIX_PATTERN.test(matrixNumber)) {
      throw new Error(`Backup contains invalid matrix number for ${icNumber}.`);
    }

    if (rowProgram !== selectedProgram || rowSesi !== selectedSesi) {
      throw new Error(`Student ${icNumber} does not match the selected Program/Sesi.`);
    }

    assertSafeBackupFilename(student.photo_filename, 'Photo');
    assertSafeBackupFilename(student.front_filename, 'Front card');
    assertSafeBackupFilename(student.back_filename, 'Back card');
    seenIc.add(icNumber);
  });
}

async function readZipJson(entry, label) {
  try {
    return JSON.parse((await entry.buffer()).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function parseDatasetBackup(file, program, sesi) {
  if (!file || !/\.zip$/i.test(file.originalname || '')) {
    throw new Error('Restore file must be a ZIP backup.');
  }

  const directory = await unzipper.Open.buffer(file.buffer);
  const fileEntries = new Map();

  directory.files.forEach((entry) => {
    const entryPath = String(entry.path || '').replace(/\\/g, '/');
    if (!isSafeZipPath(entryPath)) {
      throw new Error(`Backup contains an unsafe path: ${entry.path}.`);
    }

    if (entry.type === 'File') {
      fileEntries.set(entryPath, entry);
    }
  });

  const manifestEntry = fileEntries.get('manifest.json');
  const studentsEntry = fileEntries.get('students.json');

  if (!manifestEntry) {
    throw new Error('Backup is missing manifest.json.');
  }

  if (!studentsEntry) {
    throw new Error('Backup is missing students.json.');
  }

  const manifest = await readZipJson(manifestEntry, 'manifest.json');
  const students = await readZipJson(studentsEntry, 'students.json');
  const selectedProgram = normalizeCohortValue(program);
  const selectedSesi = normalizeCohortValue(sesi);

  if (manifest.app !== 'ilkkm-id-card-generator' || manifest.type !== 'cohort-dataset') {
    throw new Error('Backup manifest is not for this app.');
  }

  if (Number(manifest.version) !== 1) {
    throw new Error('Backup version is not supported.');
  }

  if (
    normalizeCohortValue(manifest.program) !== selectedProgram
    || normalizeCohortValue(manifest.sesi) !== selectedSesi
  ) {
    throw new Error('Backup Program/Sesi does not match the selected filters.');
  }

  if (manifest.cohortSlug !== getCohortSlug(program, sesi) || path.basename(manifest.cohortSlug) !== manifest.cohortSlug) {
    throw new Error('Backup cohort folder does not match the selected filters.');
  }

  validateStudentBackupRows(students, program, sesi);

  const externalIcConflict = students.find((student) => {
    const existing = getStudent(student.ic_number);
    return existing
      && (
        normalizeCohortValue(existing.program) !== selectedProgram
        || normalizeCohortValue(existing.sesi) !== selectedSesi
      );
  });

  if (externalIcConflict) {
    throw new Error(`IC number ${externalIcConflict.ic_number} already exists in another Program/Sesi.`);
  }

  const missing = {
    photos: 0,
    frontCards: 0,
    backCards: 0,
  };

  students.forEach((student) => {
    const photoFilename = assertSafeBackupFilename(student.photo_filename, 'Photo');
    const frontFilename = assertSafeBackupFilename(student.front_filename, 'Front card');
    const backFilename = assertSafeBackupFilename(student.back_filename, 'Back card');

    if (!fileEntries.has(`photos/${photoFilename}`)) {
      missing.photos += 1;
    }

    if (!fileEntries.has(`exports/${manifest.cohortSlug}/${frontFilename}`)) {
      missing.frontCards += 1;
    }

    if (!fileEntries.has(`exports/${manifest.cohortSlug}/${backFilename}`)) {
      missing.backCards += 1;
    }
  });

  if (missing.photos || missing.frontCards || missing.backCards) {
    throw new Error('Backup is missing one or more required photo/card files.');
  }

  return {
    manifest,
    students,
    fileEntries,
    summary: {
      program: manifest.program,
      sesi: manifest.sesi,
      selectedProgram: program,
      selectedSesi: sesi,
      cohortSlug: manifest.cohortSlug,
      counts: {
        records: students.length,
        photos: students.length,
        frontCards: students.length,
        backCards: students.length,
        missingPhotos: missing.photos,
        missingFrontCards: missing.frontCards,
        missingBackCards: missing.backCards,
      },
    },
  };
}

async function restoreCohortBackup(parsed, program, sesi) {
  const cohort = getOrCreateCohort(program, sesi);
  const currentStudents = getStudentsByCohort(cohort);
  const cohortSlug = cohort.slug;
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const stagingDir = path.join(DATA_DIR, `.restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const stagedPhotosDir = path.join(stagingDir, 'photos');
  const stagedCardsDir = path.join(stagingDir, 'exports', cohortSlug);

  const restoreTransaction = db.transaction((students) => {
    db.prepare('DELETE FROM students WHERE cohort_id = ?').run(cohort.id);

    const insert = db.prepare(`
      INSERT INTO students (
        ic_number, cohort_id, name, matrix_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    students.forEach((student) => {
      insert.run(
        student.ic_number,
        cohort.id,
        String(student.name).trim().toUpperCase(),
        String(student.matrix_number).trim().toUpperCase(),
        cohort.program,
        cohort.sesi,
        path.basename(student.photo_filename),
        path.basename(student.front_filename),
        path.basename(student.back_filename),
        student.created_at || new Date().toISOString(),
        student.updated_at || new Date().toISOString(),
      );
    });
  });

  try {
    for (const student of parsed.students) {
      const photoFilename = path.basename(student.photo_filename);
      const frontFilename = path.basename(student.front_filename);
      const backFilename = path.basename(student.back_filename);
      const photoBuffer = await parsed.fileEntries.get(`photos/${photoFilename}`).buffer();
      const frontBuffer = await parsed.fileEntries.get(`exports/${parsed.manifest.cohortSlug}/${frontFilename}`).buffer();
      const backBuffer = await parsed.fileEntries.get(`exports/${parsed.manifest.cohortSlug}/${backFilename}`).buffer();

      writeFileEnsured(path.join(stagedPhotosDir, photoFilename), photoBuffer);
      writeFileEnsured(path.join(stagedCardsDir, frontFilename), frontBuffer);
      writeFileEnsured(path.join(stagedCardsDir, backFilename), backBuffer);
    }

    restoreTransaction(parsed.students);

    currentStudents.forEach((student) => {
      removeFileIfExists(resolveInside(PHOTOS_DIR, student.photo_filename));
      removeFileIfExists(resolveInside(cohortExportDir, student.front_filename));
      removeFileIfExists(resolveInside(cohortExportDir, student.back_filename));
      removeStudentThumbnails(student.ic_number);
    });

    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    fs.mkdirSync(cohortExportDir, { recursive: true });

    parsed.students.forEach((student) => {
      const photoFilename = path.basename(student.photo_filename);
      const frontFilename = path.basename(student.front_filename);
      const backFilename = path.basename(student.back_filename);

      fs.renameSync(path.join(stagedPhotosDir, photoFilename), path.join(PHOTOS_DIR, photoFilename));
      fs.renameSync(path.join(stagedCardsDir, frontFilename), path.join(cohortExportDir, frontFilename));
      fs.renameSync(path.join(stagedCardsDir, backFilename), path.join(cohortExportDir, backFilename));
    });
  } catch (error) {
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function requireExportsPassword(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, encoded] = authorization.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (
      separatorIndex > -1
      && safeCompare(username, EXPORTS_USERNAME)
      && safeCompare(password, EXPORTS_PASSWORD)
    ) {
      next();
      return;
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="ILKKM Exports", charset="UTF-8"');
  res.status(401).send('Exports password required.');
}

function serializeStudentRecords(students) {
  return students.map((student, index) => ({
    number: index + 1,
    name: student.name,
    matrixNumber: student.matrix_number,
    icNumber: student.ic_number,
  }));
}

function sendCohortNotFound(res) {
  res.status(404).json({ error: 'Cohort not found.' });
}

function formatGameScore(row, index = 0) {
  return {
    rank: index + 1,
    playerCode: row.player_code,
    timeMs: row.time_ms,
    moves: row.moves,
    pairs: row.pairs,
    createdAt: row.created_at,
  };
}

app.use(['/exports', '/exports.html', '/api/exports'], requireExportsPassword);
app.use(/^\/cohorts\/[^/]+\/exports\/?$/, requireExportsPassword);
app.use('/admin/cohorts/new', requireExportsPassword);
app.use(/^\/admin\/cohorts\/[^/]+\/edit\/?$/, requireExportsPassword);

app.get('/cohorts/:slug', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    res.status(404).send('Cohort not found.');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'generator.html'));
});

app.get('/cohorts/:slug/grid', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    res.status(404).send('Cohort not found.');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'grid.html'));
});

app.get('/cohorts/:slug/exports', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    res.status(404).send('Cohort not found.');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'exports.html'));
});

app.get('/admin/cohorts/new', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.get('/admin/cohorts/:slug/edit', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    res.status(404).send('Cohort not found.');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.get('/grid', (req, res) => {
  res.redirect(`/cohorts/${encodeURIComponent(getDefaultCohort().slug)}/grid`);
});

app.get('/exports', (req, res) => {
  res.redirect(`/cohorts/${encodeURIComponent(getDefaultCohort().slug)}/exports`);
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'game.html'));
});

app.use(express.static(ROOT_DIR, {
  extensions: ['html'],
  index: 'index.html',
}));

app.get('/api/cohorts', (req, res) => {
  const cohorts = db.prepare(`
    SELECT
      cohorts.id,
      cohorts.slug,
      cohorts.program,
      cohorts.sesi,
      cohorts.icon_filename,
      cohorts.accent_color,
      cohorts.accepting_response_closed,
      cohorts.created_at,
      cohorts.updated_at,
      COUNT(students.ic_number) AS record_count
    FROM cohorts
    LEFT JOIN students ON students.cohort_id = cohorts.id
    GROUP BY cohorts.id
    ORDER BY cohorts.created_at ASC, cohorts.program COLLATE NOCASE, cohorts.sesi COLLATE NOCASE
  `).all();

  res.json({
    cohorts: cohorts.map((cohort) => serializeCohort(cohort, Number(cohort.record_count || 0))),
  });
});

app.get('/api/cohorts/:slug', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const row = db.prepare('SELECT COUNT(*) AS count FROM students WHERE cohort_id = ?').get(cohort.id);
  res.json(serializeCohort(cohort, Number(row.count || 0)));
});

app.get('/api/cohorts/:slug/icon', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const iconPath = resolveInside(COHORT_ICONS_DIR, cohort.icon_filename);
  if (!iconPath || !fs.existsSync(iconPath)) {
    res.status(404).json({ error: 'Cohort icon not found.' });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(iconPath);
});

app.get('/api/game/cards', (req, res) => {
  const students = db.prepare(`
    SELECT students.ic_number, students.name, students.front_filename, cohorts.slug AS cohort_slug
    FROM students
    INNER JOIN cohorts ON cohorts.id = students.cohort_id
    ORDER BY students.updated_at DESC, students.name COLLATE NOCASE
  `).all();

  const cards = students
    .filter((student) => {
      const cohortExportDir = path.join(EXPORTS_DIR, student.cohort_slug);
      const frontPath = resolveInside(cohortExportDir, student.front_filename);
      return frontPath && fs.existsSync(frontPath);
    })
    .map((student) => {
      const cohortSlug = student.cohort_slug;
      const query = `cohortSlug=${encodeURIComponent(cohortSlug)}`;
      return {
        name: student.name,
        icNumber: student.ic_number,
        cohortSlug,
        frontThumbnailUrl: `/api/students/${encodeURIComponent(student.ic_number)}/card/front/thumbnail?${query}`,
      };
    });

  res.json({
    cards,
    count: cards.length,
  });
});

app.get('/api/game/scores', (req, res) => {
  const rows = db.prepare(`
    SELECT player_code, time_ms, moves, pairs, created_at
    FROM game_scores
    ORDER BY time_ms ASC, moves ASC, created_at ASC
    LIMIT 10
  `).all();

  res.json({
    scores: rows.map(formatGameScore),
  });
});

app.post('/api/game/scores', express.json(), (req, res) => {
  const playerCode = String(req.body?.playerCode || '').trim().toUpperCase().slice(0, 8);
  const timeMs = Number(req.body?.timeMs || 0);
  const moves = Number(req.body?.moves || 0);
  const pairs = Number(req.body?.pairs || 0);

  if (!playerCode) {
    res.status(400).json({ error: 'Player code is required.' });
    return;
  }

  if (!Number.isInteger(timeMs) || timeMs <= 0 || timeMs > 60 * 60 * 1000) {
    res.status(400).json({ error: 'Invalid completion time.' });
    return;
  }

  if (!Number.isInteger(moves) || moves <= 0 || moves > 1000) {
    res.status(400).json({ error: 'Invalid move count.' });
    return;
  }

  if (!Number.isInteger(pairs) || pairs < 2 || pairs > 9) {
    res.status(400).json({ error: 'Invalid pair count.' });
    return;
  }

  db.prepare(`
    INSERT INTO game_scores (player_code, time_ms, moves, pairs, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(playerCode, timeMs, moves, pairs, new Date().toISOString());

  const rows = db.prepare(`
    SELECT player_code, time_ms, moves, pairs, created_at
    FROM game_scores
    ORDER BY time_ms ASC, moves ASC, created_at ASC
    LIMIT 10
  `).all();

  res.status(201).json({
    saved: true,
    scores: rows.map(formatGameScore),
  });
});

app.post('/api/exports/cohorts', cohortIconUpload.single('icon'), async (req, res) => {
  try {
    const normalized = normalizeProgramSesi(req.body?.program, req.body?.sesi);
    if (!normalized.program || !normalized.sesi) {
      res.status(400).json({ error: 'Program and sesi are required.' });
      return;
    }

    const existing = getCohortByProgramSesi(normalized.program, normalized.sesi);
    if (existing) {
      res.status(409).json({ error: 'Cohort already exists.', cohort: serializeCohort(existing) });
      return;
    }

    const slug = getCohortSlug(normalized.program, normalized.sesi);
    const iconFilename = await saveCohortIcon(req.file, slug);
    const accentColor = normalizeColor(req.body?.accentColor);
    const cohort = createCohort(normalized.program, normalized.sesi, { iconFilename, accentColor });
    res.status(201).json({ cohort: serializeCohort(cohort, 0) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create cohort.' });
  }
});

app.patch('/api/exports/cohorts/:slug', cohortIconUpload.single('icon'), async (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  try {
    const normalized = normalizeProgramSesi(req.body?.program, req.body?.sesi);
    if (!normalized.program || !normalized.sesi) {
      res.status(400).json({ error: 'Program and sesi are required.' });
      return;
    }

    const matching = getCohortByProgramSesi(normalized.program, normalized.sesi);
    if (matching && Number(matching.id) !== Number(cohort.id)) {
      res.status(409).json({ error: 'Another cohort already uses this Program/Sesi.', cohort: serializeCohort(matching) });
      return;
    }

    const newSlug = getCohortSlug(normalized.program, normalized.sesi);
    const oldSlug = cohort.slug;
    const slugChanged = oldSlug !== newSlug;
    const oldExportDir = path.join(EXPORTS_DIR, oldSlug);
    const newExportDir = path.join(EXPORTS_DIR, newSlug);

    if (slugChanged && fs.existsSync(oldExportDir) && fs.existsSync(newExportDir)) {
      res.status(409).json({ error: 'The target export folder already exists.' });
      return;
    }

    const removeIcon = String(req.body?.removeIcon || '').toLowerCase() === 'true';
    const iconFilename = removeIcon
      ? null
      : req.file
      ? await saveCohortIcon(req.file, newSlug)
      : cohort.icon_filename;
    const accentColor = normalizeColor(req.body?.accentColor || cohort.accent_color);
    const now = new Date().toISOString();

    const updateTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE cohorts
        SET slug = ?, program = ?, sesi = ?, icon_filename = ?, accent_color = ?, updated_at = ?
        WHERE id = ?
      `).run(newSlug, normalized.program, normalized.sesi, iconFilename || null, accentColor, now, cohort.id);

      db.prepare(`
        UPDATE students
        SET program = ?, sesi = ?, updated_at = ?
        WHERE cohort_id = ?
      `).run(normalized.program, normalized.sesi, now, cohort.id);
    });

    updateTransaction();

    try {
      if (slugChanged && fs.existsSync(oldExportDir)) {
        fs.renameSync(oldExportDir, newExportDir);
      }
    } catch (error) {
      db.prepare(`
        UPDATE cohorts
        SET slug = ?, program = ?, sesi = ?, icon_filename = ?, accent_color = ?, updated_at = ?
        WHERE id = ?
      `).run(oldSlug, cohort.program, cohort.sesi, cohort.icon_filename || null, cohort.accent_color || DEFAULT_COHORT_COLOR, new Date().toISOString(), cohort.id);
      db.prepare(`
        UPDATE students
        SET program = ?, sesi = ?, updated_at = ?
        WHERE cohort_id = ?
      `).run(cohort.program, cohort.sesi, new Date().toISOString(), cohort.id);
      throw error;
    }

    if ((removeIcon || req.file) && cohort.icon_filename && cohort.icon_filename !== iconFilename) {
      removeFileIfExists(resolveInside(COHORT_ICONS_DIR, cohort.icon_filename));
    }

    const updated = getCohortBySlug(newSlug);
    const students = getStudentsByCohort(updated);
    const needsRegeneration = normalized.program !== cohort.program || normalized.sesi !== cohort.sesi;
    res.json({
      cohort: serializeCohort(updated, students.length),
      oldSlug,
      slugChanged,
      needsRegeneration,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update cohort.' });
  }
});

app.get('/api/settings/accepting-response', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  res.json({
    acceptingResponse: isCohortResponseClosed(cohort),
    cohort: serializeCohort(cohort),
  });
});

app.post('/api/exports/settings/accepting-response', express.json(), (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const acceptingResponse = Boolean(req.body?.acceptingResponse);
  db.prepare(`
    UPDATE cohorts
    SET accepting_response_closed = ?, updated_at = ?
    WHERE id = ?
  `).run(acceptingResponse ? 1 : 0, new Date().toISOString(), cohort.id);

  res.json({
    acceptingResponse,
    cohort: serializeCohort(getCohortBySlug(cohort.slug)),
  });
});

app.post('/api/exports/cohorts/:slug/settings/accepting-response', express.json(), (req, res) => {
  req.query.cohortSlug = req.params.slug;
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const acceptingResponse = Boolean(req.body?.acceptingResponse);
  db.prepare(`
    UPDATE cohorts
    SET accepting_response_closed = ?, updated_at = ?
    WHERE id = ?
  `).run(acceptingResponse ? 1 : 0, new Date().toISOString(), cohort.id);

  res.json({
    acceptingResponse,
    cohort: serializeCohort(getCohortBySlug(cohort.slug)),
  });
});

app.get('/api/exports/count', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const row = db.prepare('SELECT COUNT(*) AS count FROM students WHERE cohort_id = ?').get(cohort.id);

  res.json({
    count: row.count,
    program: cohort.program,
    sesi: cohort.sesi,
    cohortSlug: cohort.slug,
  });
});

app.get('/api/exports/records', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);

  res.json({
    records: serializeStudentRecords(students),
    count: students.length,
    program: cohort.program,
    sesi: cohort.sesi,
    cohortSlug: cohort.slug,
  });
});

app.get('/api/exports/dataset-summary', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  res.json(getDatasetSummaryForCohort(cohort));
});

app.post('/api/exports/regenerate', async (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program: cohort.program,
      sesi: cohort.sesi,
      cohortSlug: cohort.slug,
    });
    return;
  }

  const result = await regenerateStudents(students);
  res.json({
    ...result,
    program: cohort.program,
    sesi: cohort.sesi,
    cohortSlug: cohort.slug,
  });
});

app.post('/api/exports/records/:icNumber/regenerate', async (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(404).json({ error: 'Student not found in this cohort.' });
    return;
  }

  const result = await regenerateStudents([student]);
  res.json(result);
});

app.post('/api/exports/dataset-restore-summary', restoreUpload.single('backup'), async (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  try {
    const parsed = await parseDatasetBackup(req.file, cohort.program, cohort.sesi);
    res.json(parsed.summary);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not read backup.' });
  }
});

app.post('/api/exports/dataset-restore', restoreUpload.single('backup'), async (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  try {
    const parsed = await parseDatasetBackup(req.file, cohort.program, cohort.sesi);
    await restoreCohortBackup(parsed, cohort.program, cohort.sesi);
    res.json({
      restored: true,
      ...getDatasetSummaryForCohort(cohort),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not restore backup.' });
  }
});

app.delete('/api/exports/records/:icNumber', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(404).json({ error: 'Student not found in this cohort.' });
    return;
  }

  const cohortSlug = getCohortSlug(student.program, student.sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);
  const frontPath = resolveInside(cohortExportDir, student.front_filename);
  const backPath = resolveInside(cohortExportDir, student.back_filename);

  removeFileIfExists(photoPath);
  removeFileIfExists(frontPath);
  removeFileIfExists(backPath);
  removeStudentThumbnails(icNumber);

  db.prepare('DELETE FROM students WHERE ic_number = ?').run(icNumber);

  res.json({
    deleted: true,
    icNumber,
  });
});

app.get('/api/exports/records/:icNumber/:side', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const side = String(req.params.side || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  if (side !== 'front' && side !== 'back') {
    res.status(400).json({ error: 'Side must be front or back.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(404).json({ error: 'Student not found in this cohort.' });
    return;
  }

  const cardPath = getExportCardPath(student, side);
  if (!cardPath || !fs.existsSync(cardPath)) {
    res.status(404).json({ error: 'Card image not found.' });
    return;
  }

  res.sendFile(cardPath);
});

app.get('/api/students/:icNumber', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(409).json({
      error: 'This IC number is already saved in another cohort.',
      existingProgram: student.program,
      existingSesi: student.sesi,
    });
    return;
  }

  res.json({
    icNumber: student.ic_number,
    name: student.name,
    matrixNumber: student.matrix_number,
    program: student.program,
    sesi: student.sesi,
    photoUrl: `/api/students/${encodeURIComponent(student.ic_number)}/photo`,
    frontFilename: student.front_filename,
    backFilename: student.back_filename,
    createdAt: student.created_at,
    updatedAt: student.updated_at,
  });
});

app.get('/api/students/:icNumber/photo', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const student = getStudent(icNumber);

  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);
  if (!photoPath || !fs.existsSync(photoPath)) {
    res.status(404).json({ error: 'Photo not found.' });
    return;
  }

  res.sendFile(photoPath);
});

app.get('/api/students/:icNumber/card/:side', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const side = String(req.params.side || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  if (side !== 'front' && side !== 'back') {
    res.status(400).json({ error: 'Side must be front or back.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(404).json({ error: 'Student not found in this cohort.' });
    return;
  }

  const cardPath = getExportCardPath(student, side);
  if (!cardPath || !fs.existsSync(cardPath)) {
    res.status(404).json({ error: 'Card image not found.' });
    return;
  }

  res.sendFile(cardPath);
});

app.get('/api/students/:icNumber/card/:side/thumbnail', async (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();
  const side = String(req.params.side || '').trim();
  const cohort = getCohortFromRequest(req);

  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  if (side !== 'front' && side !== 'back') {
    res.status(400).json({ error: 'Side must be front or back.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  if (!studentBelongsToCohort(student, cohort)) {
    res.status(404).json({ error: 'Student not found in this cohort.' });
    return;
  }

  try {
    const thumbnailPath = await getCardThumbnailPath(student, side);
    if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
      res.status(404).json({ error: 'Card image not found.' });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbnailPath);
  } catch (error) {
    res.status(500).json({ error: 'Could not create thumbnail.' });
  }
});

app.get('/api/students/records/cohort', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);

  res.json({
    records: serializeStudentRecords(students),
    count: students.length,
    program: cohort.program,
    sesi: cohort.sesi,
    cohortSlug: cohort.slug,
  });
});

app.post('/api/students', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
]), (req, res) => {
  try {
    const cohort = getCohortFromRequest(req);
    if (!cohort) {
      res.status(404).json({ error: 'Cohort not found.' });
      return;
    }

    if (isCohortResponseClosed(cohort)) {
      res.status(403).json({ error: 'Responses closed. Please contact admin.' });
      return;
    }

    const icNumber = String(req.body.icNumber || '').trim();
    const name = String(req.body.name || '').trim().toUpperCase();
    const matrixNumber = String(req.body.matrixNumber || '').trim().toUpperCase();
    const program = cohort.program;
    const sesi = cohort.sesi;

    if (!VALID_IC_PATTERN.test(icNumber)) {
      res.status(400).json({ error: 'Invalid IC number format.' });
      return;
    }

    if (!name || !matrixNumber || !program || !sesi) {
      res.status(400).json({ error: 'Name, matrix number, program, and sesi are required.' });
      return;
    }

    if (!VALID_MATRIX_PATTERN.test(matrixNumber)) {
      res.status(400).json({ error: 'Matrix number must use format ABCD 1/1111(11)-1234.' });
      return;
    }

    const existing = getStudent(icNumber);
    if (existing && !studentBelongsToCohort(existing, cohort)) {
      res.status(409).json({ error: 'This IC number is already saved in another cohort.' });
      return;
    }

    const photo = req.files?.photo?.[0] || null;
    const front = req.files?.front?.[0] || null;
    const back = req.files?.back?.[0] || null;

    assertValidJpeg(front, 'Front card');
    assertValidJpeg(back, 'Back card');

    let photoFilename = existing?.photo_filename || '';
    if (photo) {
      const photoExtension = getPhotoExtension(photo.mimetype);
      if (!photoExtension) {
        res.status(400).json({ error: 'Photo must be a JPG or PNG image.' });
        return;
      }

      if (photo.size > MAX_PHOTO_SIZE) {
        res.status(400).json({ error: 'Photo must be 1MB or smaller.' });
        return;
      }

      photoFilename = `${stripIcHyphens(icNumber)}_photo${photoExtension}`;
      writeFileEnsured(path.join(PHOTOS_DIR, photoFilename), photo.buffer);
    }

    if (!photoFilename) {
      res.status(400).json({ error: 'Photo is required for new student records.' });
      return;
    }

    const icSlug = stripIcHyphens(icNumber);
    const cohortSlug = cohort.slug;
    const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
    const frontFilename = `${icSlug}_front.jpg`;
    const backFilename = `${icSlug}_back.jpg`;

    writeFileEnsured(path.join(cohortExportDir, frontFilename), front.buffer);
    writeFileEnsured(path.join(cohortExportDir, backFilename), back.buffer);
    removeStudentThumbnails(icNumber);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO students (
        ic_number, cohort_id, name, matrix_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ic_number) DO UPDATE SET
        cohort_id = excluded.cohort_id,
        name = excluded.name,
        matrix_number = excluded.matrix_number,
        program = excluded.program,
        sesi = excluded.sesi,
        photo_filename = excluded.photo_filename,
        front_filename = excluded.front_filename,
        back_filename = excluded.back_filename,
        updated_at = excluded.updated_at
    `).run(
      icNumber,
      cohort.id,
      name,
      matrixNumber,
      program,
      sesi,
      photoFilename,
      frontFilename,
      backFilename,
      existing?.created_at || now,
      now,
    );

    res.json({
      saved: true,
      icNumber,
      photoFilename,
      frontFilename,
      backFilename,
      exportFolder: cohortSlug,
      cohortSlug,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save student.' });
  }
});

app.get('/api/exports/cards.zip', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program: cohort.program,
      sesi: cohort.sesi,
      cohortSlug: cohort.slug,
    });
    return;
  }

  const cohortSlug = cohort.slug;
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  let skippedFiles = 0;
  const entries = [];

  students.forEach((student) => {
    const icSlug = stripIcHyphens(student.ic_number);
    [
      { filename: student.front_filename, fallback: `${icSlug}_front.jpg` },
      { filename: student.back_filename, fallback: `${icSlug}_back.jpg` },
    ].forEach((file) => {
      const filePath = resolveInside(cohortExportDir, file.filename || file.fallback);
      if (!filePath || !fs.existsSync(filePath)) {
        skippedFiles += 1;
        return;
      }

      entries.push({
        filePath,
        zipPath: `${icSlug}/${path.basename(file.filename || file.fallback)}`,
      });
    });
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${cohortSlug}_cards.zip"`);
  res.setHeader('X-Skipped-Files', String(skippedFiles));
  res.setHeader('X-Record-Count', String(students.length));

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not create export ZIP.' });
    } else {
      res.destroy(error);
    }
  });

  archive.pipe(res);
  entries.forEach((entry) => {
    archive.file(entry.filePath, { name: entry.zipPath });
  });
  archive.finalize();
});

app.get('/api/exports/dataset-backup.zip', (req, res) => {
  const cohort = getCohortFromRequest(req);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program: cohort.program,
      sesi: cohort.sesi,
      cohortSlug: cohort.slug,
    });
    return;
  }

  const manifest = getBackupManifest(cohort.program, cohort.sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, manifest.cohortSlug);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${manifest.cohortSlug}_dataset.zip"`);
  res.setHeader('X-Record-Count', String(students.length));

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not create dataset backup.' });
    } else {
      res.destroy(error);
    }
  });

  archive.pipe(res);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(students, null, 2), { name: 'students.json' });

  students.forEach((student) => {
    const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);
    const frontPath = resolveInside(cohortExportDir, student.front_filename);
    const backPath = resolveInside(cohortExportDir, student.back_filename);

    if (photoPath && fs.existsSync(photoPath)) {
      archive.file(photoPath, { name: `photos/${path.basename(student.photo_filename)}` });
    }

    if (frontPath && fs.existsSync(frontPath)) {
      archive.file(frontPath, { name: `exports/${manifest.cohortSlug}/${path.basename(student.front_filename)}` });
    }

    if (backPath && fs.existsSync(backPath)) {
      archive.file(backPath, { name: `exports/${manifest.cohortSlug}/${path.basename(student.back_filename)}` });
    }
  });

  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`ILKKM ID Card Generator running on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Photos directory: ${PHOTOS_DIR}`);
  console.log(`Exports directory: ${EXPORTS_DIR}`);
  console.log(`Exports username: ${EXPORTS_USERNAME}`);
});
