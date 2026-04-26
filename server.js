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
const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';
const EXPORTS_USERNAME = process.env.EXPORTS_USERNAME || 'admin';
const EXPORTS_PASSWORD = process.env.EXPORTS_PASSWORD || 'ilkkm2026';
const MAX_PHOTO_SIZE = 1024 * 1024;
const MAX_RESTORE_SIZE = 500 * 1024 * 1024;
const VALID_IC_PATTERN = /^\d{6}-\d{2}-\d{4}$/;
const VALID_MATRIX_PATTERN = /^[A-Z]{4} \d\/\d{4}\(\d{2}\)-\d{4}$/;
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

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
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
`);

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
    SELECT ic_number, name, matrix_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
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
  return db.prepare(`
    SELECT ic_number, name, matrix_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
    FROM students
    WHERE program = ? AND sesi = ?
    ORDER BY name COLLATE NOCASE, ic_number
  `).all(program, sesi);
}

function normalizeCohortValue(value) {
  return String(value || '').trim().toUpperCase();
}

function getDatasetSummary(program, sesi) {
  const students = getStudents(program, sesi);
  const cohortSlug = getCohortSlug(program, sesi);
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
  const summary = getDatasetSummary(program, sesi);
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
    fittedTextElement(data.program, CARD_LAYOUT.back.program),
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
  const currentStudents = getStudents(program, sesi);
  const cohortSlug = getCohortSlug(program, sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const stagingDir = path.join(DATA_DIR, `.restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const stagedPhotosDir = path.join(stagingDir, 'photos');
  const stagedCardsDir = path.join(stagingDir, 'exports', cohortSlug);

  const restoreTransaction = db.transaction((students) => {
    db.prepare('DELETE FROM students WHERE program = ? AND sesi = ?').run(program, sesi);

    const insert = db.prepare(`
      INSERT INTO students (
        ic_number, name, matrix_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    students.forEach((student) => {
      insert.run(
        student.ic_number,
        String(student.name).trim().toUpperCase(),
        String(student.matrix_number).trim().toUpperCase(),
        program,
        sesi,
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

app.use(['/exports', '/exports.html', '/api/exports'], requireExportsPassword);

app.use(express.static(ROOT_DIR, {
  extensions: ['html'],
  index: 'index.html',
}));

app.get('/exports', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'exports.html'));
});

app.get('/api/settings/accepting-response', (req, res) => {
  res.json({
    acceptingResponse: isResponseClosed(),
  });
});

app.post('/api/exports/settings/accepting-response', express.json(), (req, res) => {
  const acceptingResponse = Boolean(req.body?.acceptingResponse);
  setSetting('accepting_response_closed', acceptingResponse ? 'true' : 'false');

  res.json({
    acceptingResponse,
  });
});

app.get('/api/exports/count', (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM students
    WHERE program = ? AND sesi = ?
  `).get(program, sesi);

  res.json({
    count: row.count,
    program,
    sesi,
  });
});

app.get('/api/exports/records', (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);
  const students = getStudents(program, sesi);

  res.json({
    records: students.map((student, index) => ({
      number: index + 1,
      name: student.name,
      matrixNumber: student.matrix_number,
      icNumber: student.ic_number,
    })),
    count: students.length,
    program,
    sesi,
  });
});

app.get('/api/exports/dataset-summary', (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);
  res.json(getDatasetSummary(program, sesi));
});

app.post('/api/exports/regenerate', async (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);
  const students = getStudents(program, sesi);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program,
      sesi,
    });
    return;
  }

  const result = await regenerateStudents(students);
  res.json({
    ...result,
    program,
    sesi,
  });
});

app.post('/api/exports/records/:icNumber/regenerate', async (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  const result = await regenerateStudents([student]);
  res.json(result);
});

app.post('/api/exports/dataset-restore-summary', restoreUpload.single('backup'), async (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);

  try {
    const parsed = await parseDatasetBackup(req.file, program, sesi);
    res.json(parsed.summary);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not read backup.' });
  }
});

app.post('/api/exports/dataset-restore', restoreUpload.single('backup'), async (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);

  try {
    const parsed = await parseDatasetBackup(req.file, program, sesi);
    await restoreCohortBackup(parsed, program, sesi);
    res.json({
      restored: true,
      ...getDatasetSummary(program, sesi),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not restore backup.' });
  }
});

app.delete('/api/exports/records/:icNumber', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
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

  const cardPath = getExportCardPath(student, side);
  if (!cardPath || !fs.existsSync(cardPath)) {
    res.status(404).json({ error: 'Card image not found.' });
    return;
  }

  res.sendFile(cardPath);
});

app.get('/api/students/:icNumber', (req, res) => {
  const icNumber = String(req.params.icNumber || '').trim();

  if (!VALID_IC_PATTERN.test(icNumber)) {
    res.status(400).json({ error: 'Invalid IC number format.' });
    return;
  }

  const student = getStudent(icNumber);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
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
  const { program, sesi } = getProgramSesi(req.query);
  const students = getStudents(program, sesi);

  res.json({
    records: students.map((student, index) => ({
      number: index + 1,
      name: student.name,
      matrixNumber: student.matrix_number,
      icNumber: student.ic_number,
    })),
    count: students.length,
    program,
    sesi,
  });
});

app.post('/api/students', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
]), (req, res) => {
  try {
    if (isResponseClosed()) {
      res.status(403).json({ error: 'Form is not accepting responses. Please contact admin.' });
      return;
    }

    const icNumber = String(req.body.icNumber || '').trim();
    const name = String(req.body.name || '').trim().toUpperCase();
    const matrixNumber = String(req.body.matrixNumber || '').trim().toUpperCase();
    const program = String(req.body.program || DEFAULT_PROGRAM).trim().toUpperCase();
    const sesi = String(req.body.sesi || DEFAULT_SESI).trim().toUpperCase();

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
    const cohortSlug = getCohortSlug(program, sesi);
    const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
    const frontFilename = `${icSlug}_front.jpg`;
    const backFilename = `${icSlug}_back.jpg`;

    writeFileEnsured(path.join(cohortExportDir, frontFilename), front.buffer);
    writeFileEnsured(path.join(cohortExportDir, backFilename), back.buffer);
    removeStudentThumbnails(icNumber);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO students (
        ic_number, name, matrix_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ic_number) DO UPDATE SET
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
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save student.' });
  }
});

app.get('/api/exports/cards.zip', (req, res) => {
  const { program, sesi } = getProgramSesi(req.query);
  const students = getStudents(program, sesi);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program,
      sesi,
    });
    return;
  }

  const cohortSlug = getCohortSlug(program, sesi);
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
  const { program, sesi } = getProgramSesi(req.query);
  const students = getStudents(program, sesi);

  if (students.length === 0) {
    res.status(404).json({
      error: 'No matching records found.',
      program,
      sesi,
    });
    return;
  }

  const manifest = getBackupManifest(program, sesi);
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
