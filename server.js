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
const COHORT_TEMPLATES_DIR = process.env.COHORT_TEMPLATES_DIR || path.join(DATA_DIR, 'cohort-templates');
const APP_ASSETS_DIR = process.env.APP_ASSETS_DIR || path.join(DATA_DIR, 'app-assets');
const FULL_BACKUP_TEMP_DIR = path.join(DATA_DIR, 'backup-temp');
const MAX_FULL_RESTORE_SIZE = Number(process.env.MAX_FULL_RESTORE_SIZE || 2 * 1024 * 1024 * 1024);
const MAX_FULL_UNCOMPRESSED_SIZE = Number(process.env.MAX_FULL_UNCOMPRESSED_SIZE || 5 * 1024 * 1024 * 1024);
const MAX_FULL_BACKUP_ENTRIES = Number(process.env.MAX_FULL_BACKUP_ENTRIES || 100000);
const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';
const DEFAULT_APP_NAME = 'ILKKM ID CARD';
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
const STAFF_FRONT_TEMPLATE_PATH = path.join(ROOT_DIR, 'assets', 'staff-front.jpg');
const STAFF_BACK_TEMPLATE_PATH = path.join(ROOT_DIR, 'assets', 'staff-back.jpg');
const VALID_COHORT_TYPES = new Set(['student', 'staff']);
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
const STAFF_CARD_LAYOUT = {
  front: {
    staffNumber: { x: 1530, y: 105, maxWidth: 360, fontSize: 92, minFontSize: 48 },
    photo: { x: 653, y: 1020, width: 661, height: 904 },
    name: { x: 984, centerY: 2180, maxWidth: 1520, fontSize: 116, minFontSize: 58, lineHeight: 128, color: '#fff' },
    ic: { x: 984, y: 2660, maxWidth: 1320, fontSize: 94, minFontSize: 48, color: '#000' },
    jobTitle: { x: 984, centerY: 2890, maxWidth: 1520, fontSize: 94, minFontSize: 46, lineHeight: 108, color: '#000' },
  },
  back: {
    supervisorName: { x: 984, centerY: 2700, maxWidth: 1600, fontSize: 82, minFontSize: 42, lineHeight: 94 },
    supervisorTitle: { x: 984, y: 2900, maxWidth: 1500, fontSize: 78, minFontSize: 40 },
  },
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
fs.mkdirSync(COHORT_ICONS_DIR, { recursive: true });
fs.mkdirSync(COHORT_TEMPLATES_DIR, { recursive: true });
fs.mkdirSync(APP_ASSETS_DIR, { recursive: true });
fs.mkdirSync(FULL_BACKUP_TEMP_DIR, { recursive: true });

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

const cohortTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 2,
  },
});

const appSettingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
  },
});

const megaRestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, FULL_BACKUP_TEMP_DIR),
    filename: (req, file, callback) => callback(null, `.upload-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.zip`),
  }),
  limits: { fileSize: MAX_FULL_RESTORE_SIZE, files: 1 },
});

let megaRestoreInProgress = false;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS cohorts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    program TEXT NOT NULL,
    sesi TEXT NOT NULL,
    icon_filename TEXT,
    front_template_filename TEXT,
    back_template_filename TEXT,
    accent_color TEXT NOT NULL DEFAULT '#0f8ea3',
    accepting_response_closed INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'student',
    supervisor_name TEXT,
    supervisor_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(program, sesi, type)
  );

  CREATE TABLE IF NOT EXISTS students (
    ic_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    matrix_number TEXT,
    job_title TEXT,
    staff_number TEXT,
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

if (!studentColumns.includes('job_title')) {
  db.exec('ALTER TABLE students ADD COLUMN job_title TEXT');
}
if (!studentColumns.includes('staff_number')) {
  db.exec('ALTER TABLE students ADD COLUMN staff_number TEXT');
}

const cohortColumns = db.prepare('PRAGMA table_info(cohorts)').all().map((column) => column.name);
if (!cohortColumns.includes('icon_filename')) db.exec('ALTER TABLE cohorts ADD COLUMN icon_filename TEXT');
if (!cohortColumns.includes('accent_color')) db.exec(`ALTER TABLE cohorts ADD COLUMN accent_color TEXT NOT NULL DEFAULT '${DEFAULT_COHORT_COLOR}'`);
if (!cohortColumns.includes('front_template_filename')) db.exec('ALTER TABLE cohorts ADD COLUMN front_template_filename TEXT');
if (!cohortColumns.includes('back_template_filename')) db.exec('ALTER TABLE cohorts ADD COLUMN back_template_filename TEXT');
if (!cohortColumns.includes('type')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    ALTER TABLE cohorts RENAME TO cohorts_legacy;
    CREATE TABLE cohorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      program TEXT NOT NULL,
      sesi TEXT NOT NULL,
      icon_filename TEXT,
      front_template_filename TEXT,
      back_template_filename TEXT,
      accent_color TEXT NOT NULL DEFAULT '#0f8ea3',
      accepting_response_closed INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'student' CHECK(type IN ('student', 'staff')),
      supervisor_name TEXT,
      supervisor_title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(program, sesi, type)
    );
    INSERT INTO cohorts (
      id, slug, program, sesi, icon_filename, front_template_filename,
      back_template_filename, accent_color, accepting_response_closed,
      type, created_at, updated_at
    )
    SELECT id, slug, program, sesi, icon_filename, front_template_filename,
      back_template_filename, accent_color, accepting_response_closed,
      'student', created_at, updated_at
    FROM cohorts_legacy;
    DROP TABLE cohorts_legacy;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}
if (cohortColumns.includes('type') && !cohortColumns.includes('supervisor_name')) {
  db.exec('ALTER TABLE cohorts ADD COLUMN supervisor_name TEXT');
}
if (cohortColumns.includes('type') && !cohortColumns.includes('supervisor_title')) {
  db.exec('ALTER TABLE cohorts ADD COLUMN supervisor_title TEXT');
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

function getAppSettings() {
  const iconUpdatedAt = getSetting('app_icon_updated_at', '');
  const matchCardBackgroundUpdatedAt = getSetting('match_card_background_updated_at', '');
  return {
    appName: getSetting('app_name', DEFAULT_APP_NAME),
    appIconUrl: iconUpdatedAt ? `/api/app/icon?v=${encodeURIComponent(iconUpdatedAt)}` : '/icon.jpg',
    matchCardBackgroundUrl: matchCardBackgroundUpdatedAt
      ? `/api/app/match-card-background?v=${encodeURIComponent(matchCardBackgroundUpdatedAt)}`
      : '/match_game.jpg',
    matchGameEnabled: getSetting('match_game_enabled', 'true') === 'true',
  };
}

function normalizeAppName(value) {
  const appName = String(value || '').trim();
  if (!appName) {
    throw new Error('App name is required.');
  }

  if (appName.length > 60) {
    throw new Error('App name must be 60 characters or fewer.');
  }

  return appName;
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

function normalizeCohortType(value) {
  const type = String(value || 'student').trim().toLowerCase();
  if (!VALID_COHORT_TYPES.has(type)) throw new Error('Type must be student or staff.');
  return type;
}

function getCohortSlug(program, sesi, type = 'student') {
  const base = `${slugify(program)}_${slugify(sesi)}`;
  return normalizeCohortType(type) === 'staff' ? `${base}_STAFF` : base;
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

  const frontTemplatePath = cohort.front_template_filename ? resolveInside(COHORT_TEMPLATES_DIR, cohort.front_template_filename) : null;
  const backTemplatePath = cohort.back_template_filename ? resolveInside(COHORT_TEMPLATES_DIR, cohort.back_template_filename) : null;
  const hasFrontTemplate = Boolean(frontTemplatePath && fs.existsSync(frontTemplatePath));
  const hasBackTemplate = Boolean(backTemplatePath && fs.existsSync(backTemplatePath));
  const result = {
    id: cohort.id,
    slug: cohort.slug,
    program: cohort.program,
    sesi: cohort.sesi,
    type: cohort.type || 'student',
    supervisorName: cohort.supervisor_name || '',
    supervisorTitle: cohort.supervisor_title || '',
    iconUrl: cohort.icon_filename
      ? `/api/cohorts/${encodeURIComponent(cohort.slug)}/icon?v=${encodeURIComponent(cohort.updated_at || '')}`
      : null,
    frontTemplateUrl: hasFrontTemplate
      ? `/api/cohorts/${encodeURIComponent(cohort.slug)}/templates/front?v=${encodeURIComponent(cohort.updated_at || '')}`
      : null,
    backTemplateUrl: hasBackTemplate
      ? `/api/cohorts/${encodeURIComponent(cohort.slug)}/templates/back?v=${encodeURIComponent(cohort.updated_at || '')}`
      : null,
    frontTemplateFilename: hasFrontTemplate ? cohort.front_template_filename : null,
    backTemplateFilename: hasBackTemplate ? cohort.back_template_filename : null,
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
    SELECT id, slug, program, sesi, type, supervisor_name, supervisor_title, icon_filename, front_template_filename, back_template_filename, accent_color, accepting_response_closed, created_at, updated_at
    FROM cohorts
    WHERE slug = ?
  `).get(String(slug || '').trim());
}

function getCohortById(id) {
  return db.prepare(`
    SELECT id, slug, program, sesi, type, supervisor_name, supervisor_title, icon_filename, front_template_filename, back_template_filename, accent_color, accepting_response_closed, created_at, updated_at
    FROM cohorts
    WHERE id = ?
  `).get(Number(id || 0));
}

function getCohortByProgramSesi(program, sesi, type = 'student') {
  const normalized = normalizeProgramSesi(program, sesi);
  return db.prepare(`
    SELECT id, slug, program, sesi, type, supervisor_name, supervisor_title, icon_filename, front_template_filename, back_template_filename, accent_color, accepting_response_closed, created_at, updated_at
    FROM cohorts
    WHERE program = ? AND sesi = ? AND type = ?
  `).get(normalized.program, normalized.sesi, normalizeCohortType(type));
}

function createCohort(program, sesi, options = {}) {
  const normalized = normalizeProgramSesi(program, sesi);
  const type = normalizeCohortType(options.type);
  const slug = getCohortSlug(normalized.program, normalized.sesi, type);
  const now = new Date().toISOString();
  const acceptingResponseClosed = options.acceptingResponseClosed ? 1 : 0;
  const accentColor = normalizeColor(options.accentColor);

  db.prepare(`
    INSERT INTO cohorts (slug, program, sesi, type, supervisor_name, supervisor_title, icon_filename, accent_color, accepting_response_closed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(slug, normalized.program, normalized.sesi, type, options.supervisorName || null, options.supervisorTitle || null, options.iconFilename || null, accentColor, acceptingResponseClosed, now, now);

  return getCohortBySlug(slug);
}

function getOrCreateCohort(program, sesi, options = {}) {
  const type = options.type || 'student';
  return getCohortByProgramSesi(program, sesi, type) || createCohort(program, sesi, options);
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

async function saveAppIcon(file) {
  if (!file) {
    return false;
  }

  if (!getPhotoExtension(file.mimetype)) {
    throw new Error('App icon must be a JPG or PNG image.');
  }

  const iconBuffer = await sharp(file.buffer)
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  writeFileEnsured(path.join(APP_ASSETS_DIR, 'app-icon.jpg'), iconBuffer);
  setSetting('app_icon_updated_at', new Date().toISOString());
  return true;
}

async function saveMatchCardBackground(file) {
  if (!file) {
    return false;
  }

  if (!getPhotoExtension(file.mimetype)) {
    throw new Error('Match card background must be a JPG or PNG image.');
  }

  const backgroundBuffer = await sharp(file.buffer)
    .resize(1280, 720, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  writeFileEnsured(path.join(APP_ASSETS_DIR, 'match-card-background.jpg'), backgroundBuffer);
  setSetting('match_card_background_updated_at', new Date().toISOString());
  return true;
}

async function saveCohortTemplate(file, slug, side) {
  if (!file) {
    return null;
  }

  if (!['front', 'back'].includes(side)) {
    throw new Error('Template side must be front or back.');
  }

  if (!getPhotoExtension(file.mimetype)) {
    throw new Error(`${side === 'front' ? 'Front' : 'Back'} background must be a JPG or PNG image.`);
  }

  const filename = `${slug}_${side}_template.jpg`;
  const templateBuffer = await normalizeTemplateBuffer(file.buffer, side === 'front' ? 'Front' : 'Back');

  writeFileEnsured(path.join(COHORT_TEMPLATES_DIR, filename), templateBuffer);
  return filename;
}

async function normalizeTemplateBuffer(buffer, label) {
  try {
    return await sharp(buffer)
      .resize(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch (error) {
    throw new Error(`${label} background is not a valid image.`);
  }
}

function getCohortTemplatePath(cohort, side) {
  const filename = side === 'front' ? cohort?.front_template_filename : cohort?.back_template_filename;
  const customPath = filename ? resolveInside(COHORT_TEMPLATES_DIR, filename) : null;

  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  if ((cohort?.type || 'student') === 'staff') {
    return side === 'front' ? STAFF_FRONT_TEMPLATE_PATH : STAFF_BACK_TEMPLATE_PATH;
  }
  return side === 'front' ? FRONT_TEMPLATE_PATH : BACK_TEMPLATE_PATH;
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
    SELECT ic_number, cohort_id, name, matrix_number, job_title, staff_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
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
    SELECT ic_number, cohort_id, name, matrix_number, job_title, staff_number, program, sesi, photo_filename, front_filename, back_filename, created_at, updated_at
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
    cohortType: cohort.type || 'student',
    supervisorName: cohort.supervisor_name || '',
    supervisorTitle: cohort.supervisor_title || '',
    cohortSlug,
    counts,
  };
}

function getBackupManifest(cohort) {
  const { program, sesi } = cohort;
  const summary = getDatasetSummaryForCohort(cohort);
  return {
    app: 'ilkkm-id-card-generator',
    type: 'cohort-dataset',
    version: 2,
    exportedAt: new Date().toISOString(),
    program,
    sesi,
    cohortType: cohort.type || 'student',
    supervisorName: cohort.supervisor_name || '',
    supervisorTitle: cohort.supervisor_title || '',
    cohortSlug: summary.cohortSlug,
    templates: {
      front: cohort.front_template_filename ? path.basename(cohort.front_template_filename) : null,
      back: cohort.back_template_filename ? path.basename(cohort.back_template_filename) : null,
    },
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

function textElement(text, x, y, fontSize, anchor = 'start', color = '') {
  return `<text x="${x}" y="${y}" font-size="${fontSize}" text-anchor="${anchor}"${color ? ` style="fill:${color}"` : ''}>${escapeSvg(text)}</text>`;
}

function fittedTextElement(text, config, anchor = 'start') {
  const size = fitTextSize(text, config.maxWidth, config.fontSize, config.minFontSize);
  return textElement(text, config.x, config.y, size, anchor, config.color);
}

function centeredWrappedNameElements(text, config) {
  const wrapped = wrapIntoTwoLines(text, config.maxWidth, config.fontSize, config.minFontSize);
  const lineHeight = Math.min(config.lineHeight, Math.round(wrapped.size * 1.12));
  const firstY = wrapped.lines.length === 1
    ? config.centerY
    : config.centerY - lineHeight / 2;

  return wrapped.lines
    .map((line, index) => textElement(line, config.x, firstY + index * lineHeight, wrapped.size, 'middle', config.color))
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
    jobTitle: String(student.job_title || '').trim().toUpperCase(),
    staffNumber: String(student.staff_number || '').trim().toUpperCase(),
    program: String(student.program || DEFAULT_PROGRAM).trim().toUpperCase(),
    sesi: String(student.sesi || DEFAULT_SESI).trim().toUpperCase(),
  };
}

async function renderStudentCards(student) {
  const data = getStudentRenderData(student);
  const icSlug = stripIcHyphens(data.ic);
  const renderCohort = getCohortById(student.cohort_id) || getCohortByProgramSesi(data.program, data.sesi);
  const cohortSlug = renderCohort?.slug || getCohortSlug(data.program, data.sesi);
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const photoPath = resolveInside(PHOTOS_DIR, student.photo_filename);

  if (!photoPath || !fs.existsSync(photoPath)) {
    throw new Error('Saved photo not found.');
  }

  const isStaff = renderCohort?.type === 'staff';
  const layout = isStaff ? STAFF_CARD_LAYOUT : CARD_LAYOUT;
  const photoBox = layout.front.photo;
  const photoBuffer = await sharp(photoPath)
    .resize(photoBox.width, photoBox.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const frontTextSvg = isStaff ? buildTextSvg([
    data.staffNumber ? fittedTextElement(`No. ${data.staffNumber}`, layout.front.staffNumber, 'middle') : '',
    centeredWrappedNameElements(data.name, layout.front.name),
    fittedTextElement(data.ic, layout.front.ic, 'middle'),
    centeredWrappedNameElements(data.jobTitle, layout.front.jobTitle),
  ]) : buildTextSvg([
    centeredWrappedNameElements(data.name, layout.front.name),
    fittedTextElement(data.matrix, layout.front.matrix, 'middle'),
  ]);

  const backTextSvg = isStaff ? buildTextSvg([
    centeredWrappedNameElements(renderCohort.supervisor_name, layout.back.supervisorName),
    fittedTextElement(renderCohort.supervisor_title, layout.back.supervisorTitle, 'middle'),
  ]) : buildTextSvg([
    leftWrappedNameElements(data.name, layout.back.name),
    fittedTextElement(data.matrix, layout.back.matrix),
    fittedTextElement(data.ic, layout.back.ic),
    leftWrappedNameElements(data.program, layout.back.program),
    fittedTextElement(data.sesi, layout.back.sesi),
  ]);

  const frontFilename = `${icSlug}_front.jpg`;
  const backFilename = `${icSlug}_back.jpg`;
  const frontPath = path.join(cohortExportDir, frontFilename);
  const backPath = path.join(cohortExportDir, backFilename);

  fs.mkdirSync(cohortExportDir, { recursive: true });

  await sharp(getCohortTemplatePath(renderCohort, 'front'))
    .resize(TEMPLATE_WIDTH, TEMPLATE_HEIGHT)
    .composite([
      { input: photoBuffer, left: photoBox.x, top: photoBox.y },
      { input: frontTextSvg, left: 0, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toFile(frontPath);

  await sharp(getCohortTemplatePath(renderCohort, 'back'))
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
  const cohort = getCohortById(student.cohort_id);
  const cohortSlug = cohort?.slug || getCohortSlug(student.program, student.sesi);
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

function validateStudentBackupRows(rows, program, sesi, cohortType = 'student') {
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

    if (cohortType === 'student' && !VALID_MATRIX_PATTERN.test(matrixNumber)) {
      throw new Error(`Backup contains invalid matrix number for ${icNumber}.`);
    }
    if (cohortType === 'staff' && !String(student.job_title || '').trim()) {
      throw new Error(`Backup contains a blank job title for ${icNumber}.`);
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

async function parseDatasetBackup(file, cohort) {
  const { program, sesi } = cohort;
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

  if (![1, 2].includes(Number(manifest.version))) {
    throw new Error('Backup version is not supported.');
  }

  if (
    normalizeCohortValue(manifest.program) !== selectedProgram
    || normalizeCohortValue(manifest.sesi) !== selectedSesi
  ) {
    throw new Error('Backup Program/Sesi does not match the selected filters.');
  }

  const manifestType = Number(manifest.version) === 1 ? 'student' : normalizeCohortType(manifest.cohortType);
  if (manifestType !== cohort.type) {
    throw new Error('Backup cohort type does not match the selected cohort.');
  }
  if (manifest.cohortSlug !== cohort.slug || path.basename(manifest.cohortSlug) !== manifest.cohortSlug) {
    throw new Error('Backup cohort folder does not match the selected filters.');
  }

  validateStudentBackupRows(students, program, sesi, cohort.type);

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
    templates: 0,
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

  const templates = {
    front: manifest.templates?.front ? assertSafeBackupFilename(manifest.templates.front, 'Front background') : null,
    back: manifest.templates?.back ? assertSafeBackupFilename(manifest.templates.back, 'Back background') : null,
  };

  if (templates.front && !fileEntries.has(`templates/${templates.front}`)) {
    missing.templates += 1;
  }

  if (templates.back && !fileEntries.has(`templates/${templates.back}`)) {
    missing.templates += 1;
  }

  if (missing.templates) {
    throw new Error('Backup is missing one or more custom background files.');
  }

  return {
    manifest,
    students,
    templates,
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
        templates: Number(Boolean(templates.front)) + Number(Boolean(templates.back)),
      },
    },
  };
}

async function restoreCohortBackup(parsed, cohort) {
  const currentStudents = getStudentsByCohort(cohort);
  const cohortSlug = cohort.slug;
  const cohortExportDir = path.join(EXPORTS_DIR, cohortSlug);
  const stagingDir = path.join(DATA_DIR, `.restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const stagedPhotosDir = path.join(stagingDir, 'photos');
  const stagedCardsDir = path.join(stagingDir, 'exports', cohortSlug);
  const stagedTemplatesDir = path.join(stagingDir, 'templates');

  const restoreTransaction = db.transaction((students) => {
    db.prepare('DELETE FROM students WHERE cohort_id = ?').run(cohort.id);
    if (cohort.type === 'staff') {
      const supervisorName = String(parsed.manifest.supervisorName || cohort.supervisor_name || '').trim().toUpperCase();
      const supervisorTitle = String(parsed.manifest.supervisorTitle || cohort.supervisor_title || '').trim().toUpperCase();
      if (!supervisorName || !supervisorTitle) throw new Error('Staff backup is missing supervisor details.');
      db.prepare('UPDATE cohorts SET supervisor_name = ?, supervisor_title = ?, updated_at = ? WHERE id = ?')
        .run(supervisorName, supervisorTitle, new Date().toISOString(), cohort.id);
    }

    const insert = db.prepare(`
      INSERT INTO students (
        ic_number, cohort_id, name, matrix_number, job_title, staff_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    students.forEach((student) => {
      insert.run(
        student.ic_number,
        cohort.id,
        String(student.name).trim().toUpperCase(),
        String(student.matrix_number || '').trim().toUpperCase(),
        student.job_title ? String(student.job_title).trim().toUpperCase() : null,
        student.staff_number ? String(student.staff_number).trim().toUpperCase() : null,
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
    const frontTemplateFilename = parsed.templates?.front || null;
    const backTemplateFilename = parsed.templates?.back || null;

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

    if (frontTemplateFilename) {
      const frontTemplateBuffer = await normalizeTemplateBuffer(
        await parsed.fileEntries.get(`templates/${frontTemplateFilename}`).buffer(),
        'Front',
      );
      writeFileEnsured(path.join(stagedTemplatesDir, frontTemplateFilename), frontTemplateBuffer);
    }

    if (backTemplateFilename) {
      const backTemplateBuffer = await normalizeTemplateBuffer(
        await parsed.fileEntries.get(`templates/${backTemplateFilename}`).buffer(),
        'Back',
      );
      writeFileEnsured(path.join(stagedTemplatesDir, backTemplateFilename), backTemplateBuffer);
    }

    restoreTransaction(parsed.students);

    if (cohort.front_template_filename && cohort.front_template_filename !== frontTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, cohort.front_template_filename));
    }

    if (cohort.back_template_filename && cohort.back_template_filename !== backTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, cohort.back_template_filename));
    }

    db.prepare(`
      UPDATE cohorts
      SET front_template_filename = ?, back_template_filename = ?, updated_at = ?
      WHERE id = ?
    `).run(frontTemplateFilename, backTemplateFilename, new Date().toISOString(), cohort.id);

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

    fs.mkdirSync(COHORT_TEMPLATES_DIR, { recursive: true });
    if (frontTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, frontTemplateFilename));
      fs.renameSync(path.join(stagedTemplatesDir, frontTemplateFilename), path.join(COHORT_TEMPLATES_DIR, frontTemplateFilename));
    }

    if (backTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, backTemplateFilename));
      fs.renameSync(path.join(stagedTemplatesDir, backTemplateFilename), path.join(COHORT_TEMPLATES_DIR, backTemplateFilename));
    }
  } catch (error) {
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const MEGA_MANAGED_DIRS = {
  photos: PHOTOS_DIR,
  exports: EXPORTS_DIR,
  'cohort-icons': COHORT_ICONS_DIR,
  'cohort-templates': COHORT_TEMPLATES_DIR,
  'app-assets': APP_ASSETS_DIR,
};

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function listFilesRecursive(baseDir, relativeDir = '') {
  if (!fs.existsSync(baseDir)) return [];
  const current = path.join(baseDir, relativeDir);
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) return listFilesRecursive(baseDir, relativePath);
    if (!entry.isFile()) return [];
    return [{ path: relativePath, filePath: path.join(baseDir, relativePath) }];
  });
}

function getMegaDatabaseData() {
  return {
    cohorts: db.prepare('SELECT * FROM cohorts ORDER BY id').all(),
    students: db.prepare('SELECT * FROM students ORDER BY ic_number').all(),
    settings: db.prepare('SELECT * FROM settings ORDER BY key').all(),
    gameScores: db.prepare('SELECT * FROM game_scores ORDER BY id').all(),
  };
}

function buildMegaSnapshot() {
  const database = getMegaDatabaseData();
  const entries = [];
  const databaseEntries = {
    'database/cohorts.json': Buffer.from(JSON.stringify(database.cohorts, null, 2)),
    'database/students.json': Buffer.from(JSON.stringify(database.students, null, 2)),
    'database/settings.json': Buffer.from(JSON.stringify(database.settings, null, 2)),
    'database/game-scores.json': Buffer.from(JSON.stringify(database.gameScores, null, 2)),
  };
  Object.entries(databaseEntries).forEach(([entryPath, buffer]) => {
    entries.push({ path: entryPath, size: buffer.length, sha256: sha256Buffer(buffer), buffer });
  });
  Object.entries(MEGA_MANAGED_DIRS).forEach(([prefix, directory]) => {
    listFilesRecursive(directory).forEach((file) => {
      const stat = fs.statSync(file.filePath);
      entries.push({ path: `${prefix}/${file.path}`, size: stat.size, sha256: sha256File(file.filePath), filePath: file.filePath });
    });
  });
  const fileCounts = Object.fromEntries(Object.keys(MEGA_MANAGED_DIRS).map((key) => [key, entries.filter((entry) => entry.path.startsWith(`${key}/`)).length]));
  const manifest = {
    app: 'ilkkm-id-card-generator',
    type: 'mega-backup',
    version: 1,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      cohorts: database.cohorts.length,
      studentCohorts: database.cohorts.filter((row) => row.type === 'student').length,
      staffCohorts: database.cohorts.filter((row) => row.type === 'staff').length,
      records: database.students.length,
      settings: database.settings.length,
      gameScores: database.gameScores.length,
      ...fileCounts,
    },
    files: entries.map(({ path: entryPath, size, sha256 }) => ({ path: entryPath, size, sha256 })),
  };
  return { manifest, entries };
}

function writeMegaArchive(destination, snapshot = buildMegaSnapshot()) {
  return new Promise((resolve, reject) => {
    const output = typeof destination === 'string' ? fs.createWriteStream(destination) : destination;
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(snapshot));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify(snapshot.manifest, null, 2), { name: 'manifest.json' });
    snapshot.entries.forEach((entry) => {
      if (entry.buffer) archive.append(entry.buffer, { name: entry.path });
      else archive.file(entry.filePath, { name: entry.path });
    });
    archive.finalize();
  });
}

function validateMegaDatabase(database, manifest) {
  const { cohorts, students, settings, gameScores } = database;
  if (![cohorts, students, settings, gameScores].every(Array.isArray)) throw new Error('Backup database datasets are invalid.');
  const cohortIds = new Set();
  const slugs = new Set();
  const cohortKeys = new Set();
  cohorts.forEach((cohort) => {
    const type = normalizeCohortType(cohort.type);
    const slug = String(cohort.slug || '').trim();
    const key = `${normalizeCohortValue(cohort.program)}\u0000${normalizeCohortValue(cohort.sesi)}\u0000${type}`;
    if (!Number.isInteger(Number(cohort.id)) || cohortIds.has(Number(cohort.id))) throw new Error('Backup contains duplicate or invalid cohort IDs.');
    if (!slug || path.basename(slug) !== slug || slugs.has(slug)) throw new Error('Backup contains duplicate or invalid cohort slugs.');
    if (cohortKeys.has(key)) throw new Error('Backup contains duplicate Program/Sesi/Type cohorts.');
    if (type === 'staff' && (!String(cohort.supervisor_name || '').trim() || !String(cohort.supervisor_title || '').trim())) throw new Error(`Staff cohort ${slug} is missing supervisor details.`);
    cohortIds.add(Number(cohort.id)); slugs.add(slug); cohortKeys.add(key);
  });
  const seenIc = new Set();
  students.forEach((student) => {
    const ic = String(student.ic_number || '').trim();
    const cohort = cohorts.find((row) => Number(row.id) === Number(student.cohort_id));
    if (!VALID_IC_PATTERN.test(ic) || seenIc.has(ic)) throw new Error(`Backup contains duplicate or invalid IC number: ${ic || 'blank'}.`);
    if (!cohort) throw new Error(`Record ${ic} references a missing cohort.`);
    if (!String(student.name || '').trim()) throw new Error(`Record ${ic} has a blank name.`);
    if (cohort.type === 'student' && !VALID_MATRIX_PATTERN.test(String(student.matrix_number || '').trim().toUpperCase())) throw new Error(`Record ${ic} has an invalid matrix number.`);
    if (cohort.type === 'staff' && !String(student.job_title || '').trim()) throw new Error(`Record ${ic} has a blank job title.`);
    seenIc.add(ic);
  });
  if (new Set(settings.map((row) => row.key)).size !== settings.length) throw new Error('Backup contains duplicate setting keys.');
  if (manifest.counts.cohorts !== cohorts.length || manifest.counts.records !== students.length || manifest.counts.settings !== settings.length || manifest.counts.gameScores !== gameScores.length) throw new Error('Backup database counts do not match the manifest.');
}

async function parseMegaBackup(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Mega backup ZIP is required.');
  const directory = await unzipper.Open.file(filePath);
  if (directory.files.length > MAX_FULL_BACKUP_ENTRIES) throw new Error('Mega backup contains too many entries.');
  const entries = new Map();
  let uncompressedSize = 0;
  directory.files.forEach((entry) => {
    const entryPath = String(entry.path || '').replace(/\\/g, '/');
    if (!isSafeZipPath(entryPath) || entries.has(entryPath)) throw new Error(`Mega backup contains an unsafe or duplicate path: ${entryPath}.`);
    uncompressedSize += Number(entry.uncompressedSize || 0);
    if (uncompressedSize > MAX_FULL_UNCOMPRESSED_SIZE) throw new Error('Mega backup expands beyond the allowed size.');
    if (entry.type === 'File') entries.set(entryPath, entry);
  });
  const requiredJson = ['manifest.json', 'database/cohorts.json', 'database/students.json', 'database/settings.json', 'database/game-scores.json'];
  requiredJson.forEach((entryPath) => { if (!entries.has(entryPath)) throw new Error(`Mega backup is missing ${entryPath}.`); });
  const manifest = await readZipJson(entries.get('manifest.json'), 'manifest.json');
  if (manifest.app !== 'ilkkm-id-card-generator' || manifest.type !== 'mega-backup' || Number(manifest.version) !== 1) throw new Error('Mega backup format or version is not supported.');
  if (!Array.isArray(manifest.files)) throw new Error('Mega backup file manifest is invalid.');
  const declared = new Map();
  manifest.files.forEach((file) => {
    if (!isSafeZipPath(file.path) || declared.has(file.path)) throw new Error(`Manifest contains an unsafe or duplicate path: ${file.path}.`);
    declared.set(file.path, file);
  });
  const database = {
    cohorts: await readZipJson(entries.get('database/cohorts.json'), 'cohorts.json'),
    students: await readZipJson(entries.get('database/students.json'), 'students.json'),
    settings: await readZipJson(entries.get('database/settings.json'), 'settings.json'),
    gameScores: await readZipJson(entries.get('database/game-scores.json'), 'game-scores.json'),
  };
  validateMegaDatabase(database, manifest);
  for (const [entryPath, file] of declared) {
    const entry = entries.get(entryPath);
    if (!entry) throw new Error(`Mega backup is missing ${entryPath}.`);
    const buffer = await entry.buffer();
    if (buffer.length !== Number(file.size) || sha256Buffer(buffer) !== file.sha256) throw new Error(`Integrity check failed for ${entryPath}.`);
  }
  for (const entryPath of entries.keys()) {
    if (entryPath !== 'manifest.json' && !declared.has(entryPath)) throw new Error(`Mega backup contains undeclared file ${entryPath}.`);
  }
  const requiredFiles = new Set();
  database.students.forEach((student) => {
    const cohort = database.cohorts.find((row) => Number(row.id) === Number(student.cohort_id));
    requiredFiles.add(`photos/${path.basename(student.photo_filename)}`);
    requiredFiles.add(`exports/${cohort.slug}/${path.basename(student.front_filename)}`);
    requiredFiles.add(`exports/${cohort.slug}/${path.basename(student.back_filename)}`);
  });
  database.cohorts.forEach((cohort) => {
    if (cohort.icon_filename) requiredFiles.add(`cohort-icons/${path.basename(cohort.icon_filename)}`);
    if (cohort.front_template_filename) requiredFiles.add(`cohort-templates/${path.basename(cohort.front_template_filename)}`);
    if (cohort.back_template_filename) requiredFiles.add(`cohort-templates/${path.basename(cohort.back_template_filename)}`);
  });
  requiredFiles.forEach((entryPath) => { if (!declared.has(entryPath)) throw new Error(`Mega backup is missing required file ${entryPath}.`); });
  return {
    manifest, database, directory, declared,
    summary: { ...manifest.counts, archiveSize: fs.statSync(filePath).size, uncompressedSize, warnings: [] },
  };
}

function replaceMegaDatabase(database) {
  const operation = db.transaction(() => {
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM cohorts').run();
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM game_scores').run();
    const cohortInsert = db.prepare(`INSERT INTO cohorts (
      id, slug, program, sesi, icon_filename, front_template_filename, back_template_filename,
      accent_color, accepting_response_closed, type, supervisor_name, supervisor_title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    database.cohorts.forEach((row) => cohortInsert.run(row.id, row.slug, row.program, row.sesi, row.icon_filename || null, row.front_template_filename || null, row.back_template_filename || null, row.accent_color || DEFAULT_COHORT_COLOR, Number(row.accepting_response_closed || 0), row.type || 'student', row.supervisor_name || null, row.supervisor_title || null, row.created_at, row.updated_at));
    const studentInsert = db.prepare(`INSERT INTO students (
      ic_number, name, matrix_number, program, sesi, photo_filename, front_filename, back_filename,
      created_at, updated_at, cohort_id, job_title, staff_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    database.students.forEach((row) => studentInsert.run(row.ic_number, row.name, row.matrix_number || '', row.program, row.sesi, row.photo_filename, row.front_filename, row.back_filename, row.created_at, row.updated_at, row.cohort_id, row.job_title || null, row.staff_number || null));
    const settingInsert = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    database.settings.forEach((row) => settingInsert.run(row.key, row.value, row.updated_at));
    const scoreInsert = db.prepare('INSERT INTO game_scores (id, player_code, time_ms, moves, pairs, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    database.gameScores.forEach((row) => scoreInsert.run(row.id, row.player_code, row.time_ms, row.moves, row.pairs, row.created_at));
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('cohorts', 'game_scores')").run();
    const maxCohortId = Math.max(0, ...database.cohorts.map((row) => Number(row.id || 0)));
    const maxScoreId = Math.max(0, ...database.gameScores.map((row) => Number(row.id || 0)));
    if (maxCohortId) db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('cohorts', ?)").run(maxCohortId);
    if (maxScoreId) db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('game_scores', ?)").run(maxScoreId);
  });
  operation();
}

async function extractMegaManagedFiles(parsed, stagingDir) {
  for (const [entryPath] of parsed.declared) {
    const prefix = entryPath.split('/')[0];
    if (!Object.prototype.hasOwnProperty.call(MEGA_MANAGED_DIRS, prefix)) continue;
    const entry = parsed.directory.files.find((item) => String(item.path || '').replace(/\\/g, '/') === entryPath);
    const outputPath = path.join(stagingDir, ...entryPath.split('/'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, await entry.buffer());
  }
  Object.keys(MEGA_MANAGED_DIRS).forEach((prefix) => fs.mkdirSync(path.join(stagingDir, prefix), { recursive: true }));
}

function restoreInterruptedMegaOperation() {
  if (!fs.existsSync(MEGA_JOURNAL_PATH)) return;
  const journal = JSON.parse(fs.readFileSync(MEGA_JOURNAL_PATH, 'utf8'));
  const recoveryDir = String(journal.recoveryDir || '');
  const databasePath = path.join(recoveryDir, 'database-before.json');
  if (!recoveryDir || !fs.existsSync(databasePath)) throw new Error('Mega restore recovery journal is incomplete.');
  replaceMegaDatabase(JSON.parse(fs.readFileSync(databasePath, 'utf8')));
  Object.entries(MEGA_MANAGED_DIRS).forEach(([prefix, target]) => {
    const oldPath = path.join(recoveryDir, prefix);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, target);
    else fs.mkdirSync(target, { recursive: true });
  });
  fs.rmSync(THUMBNAILS_DIR, { recursive: true, force: true });
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  fs.rmSync(recoveryDir, { recursive: true, force: true });
  fs.rmSync(MEGA_JOURNAL_PATH, { force: true });
}

async function performMegaRestore(parsed) {
  const token = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const stagingDir = path.join(DATA_DIR, `.mega-staging-${token}`);
  const recoveryDir = path.join(DATA_DIR, `.mega-recovery-${token}`);
  const databaseBefore = getMegaDatabaseData();
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(recoveryDir, { recursive: true });
  try {
    await extractMegaManagedFiles(parsed, stagingDir);
    fs.writeFileSync(path.join(recoveryDir, 'database-before.json'), JSON.stringify(databaseBefore));
    fs.writeFileSync(MEGA_JOURNAL_PATH, JSON.stringify({ version: 1, recoveryDir, startedAt: new Date().toISOString() }));
    Object.entries(MEGA_MANAGED_DIRS).forEach(([prefix, target]) => {
      if (fs.existsSync(target)) fs.renameSync(target, path.join(recoveryDir, prefix));
      fs.renameSync(path.join(stagingDir, prefix), target);
    });
    replaceMegaDatabase(parsed.database);
    fs.rmSync(THUMBNAILS_DIR, { recursive: true, force: true });
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    fs.rmSync(recoveryDir, { recursive: true, force: true });
    fs.rmSync(MEGA_JOURNAL_PATH, { force: true });
  } catch (error) {
    if (fs.existsSync(MEGA_JOURNAL_PATH)) restoreInterruptedMegaOperation();
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const RAW_BACKUP_DIRS = {
  photos: PHOTOS_DIR,
  exports: EXPORTS_DIR,
  thumbnails: THUMBNAILS_DIR,
  'cohort-icons': COHORT_ICONS_DIR,
  'cohort-templates': COHORT_TEMPLATES_DIR,
  'app-assets': APP_ASSETS_DIR,
};

async function writeRawBackupArchive(destination) {
  const token = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const snapshotDir = path.join(FULL_BACKUP_TEMP_DIR, `.snapshot-${token}`);
  const snapshotDbPath = path.join(snapshotDir, 'app.sqlite');
  fs.mkdirSync(snapshotDir, { recursive: true });
  await db.backup(snapshotDbPath);
  const manifest = {
    app: 'ilkkm-id-card-generator',
    type: 'full-raw-backup',
    version: 1,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const output = typeof destination === 'string' ? fs.createWriteStream(destination) : destination;
    const archive = archiver('zip', { zlib: { level: 9 } });
    const cleanup = () => fs.rmSync(snapshotDir, { recursive: true, force: true });
    output.on('close', () => { cleanup(); resolve(); });
    output.on('error', (error) => { cleanup(); reject(error); });
    archive.on('error', (error) => { cleanup(); reject(error); });
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.file(snapshotDbPath, { name: 'app.sqlite' });
    Object.entries(RAW_BACKUP_DIRS).forEach(([entryName, directory]) => {
      if (fs.existsSync(directory)) archive.directory(directory, entryName);
    });
    archive.finalize();
  });
}

async function extractRawBackup(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Backup ZIP is required.');
  const token = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const stagingDir = path.join(DATA_DIR, `.full-restore-${token}`);
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    const directory = await unzipper.Open.file(filePath);
    if (directory.files.length > MAX_FULL_BACKUP_ENTRIES) throw new Error('Backup contains too many entries.');
    const seen = new Set();
    let totalSize = 0;
    for (const entry of directory.files) {
      const entryPath = String(entry.path || '').replace(/\\/g, '/');
      if (!isSafeZipPath(entryPath) || seen.has(entryPath)) throw new Error(`Backup contains an unsafe or duplicate path: ${entryPath}.`);
      seen.add(entryPath);
      totalSize += Number(entry.uncompressedSize || 0);
      if (totalSize > MAX_FULL_UNCOMPRESSED_SIZE) throw new Error('Backup expands beyond the allowed size.');
      const topLevel = entryPath.split('/')[0];
      if (!['manifest.json', 'app.sqlite', ...Object.keys(RAW_BACKUP_DIRS)].includes(topLevel)) throw new Error(`Backup contains an unrecognized path: ${entryPath}.`);
      if (entry.type !== 'File') continue;
      const outputPath = path.join(stagingDir, ...entryPath.split('/'));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, await entry.buffer());
    }
    const manifestPath = path.join(stagingDir, 'manifest.json');
    const snapshotDbPath = path.join(stagingDir, 'app.sqlite');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(snapshotDbPath)) throw new Error('Backup must contain manifest.json and app.sqlite.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.app !== 'ilkkm-id-card-generator' || manifest.type !== 'full-raw-backup' || Number(manifest.version) !== 1 || Number(manifest.schemaVersion) !== 1) throw new Error('Backup format or schema version is not supported.');
    const snapshotDb = new Database(snapshotDbPath, { readonly: true, fileMustExist: true });
    try {
      const tables = new Set(snapshotDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      ['cohorts', 'students', 'settings', 'game_scores'].forEach((table) => { if (!tables.has(table)) throw new Error(`Backup database is missing ${table}.`); });
      return {
        stagingDir,
        database: {
          cohorts: snapshotDb.prepare('SELECT * FROM cohorts ORDER BY id').all(),
          students: snapshotDb.prepare('SELECT * FROM students ORDER BY ic_number').all(),
          settings: snapshotDb.prepare('SELECT * FROM settings ORDER BY key').all(),
          gameScores: snapshotDb.prepare('SELECT * FROM game_scores ORDER BY id').all(),
        },
      };
    } finally {
      snapshotDb.close();
    }
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function performRawRestore(parsed) {
  const rollbackDir = path.join(DATA_DIR, `.full-rollback-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`);
  const databaseBefore = getMegaDatabaseData();
  fs.mkdirSync(rollbackDir, { recursive: true });
  const swappedEntries = [];
  try {
    Object.entries(RAW_BACKUP_DIRS).forEach(([entryName, target]) => {
      const staged = path.join(parsed.stagingDir, entryName);
      fs.mkdirSync(staged, { recursive: true });
      swappedEntries.push(entryName);
      if (fs.existsSync(target)) fs.renameSync(target, path.join(rollbackDir, entryName));
      fs.renameSync(staged, target);
    });
    replaceMegaDatabase(parsed.database);
  } catch (error) {
    try { replaceMegaDatabase(databaseBefore); } catch (databaseError) { error.databaseRollbackError = databaseError; }
    if (swappedEntries.length) {
      Object.entries(RAW_BACKUP_DIRS).filter(([entryName]) => swappedEntries.includes(entryName)).forEach(([entryName, target]) => {
        const previous = path.join(rollbackDir, entryName);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (fs.existsSync(previous)) fs.renameSync(previous, target);
        else fs.mkdirSync(target, { recursive: true });
      });
    }
    throw error;
  } finally {
    fs.rmSync(rollbackDir, { recursive: true, force: true });
    fs.rmSync(parsed.stagingDir, { recursive: true, force: true });
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
    jobTitle: student.job_title || '',
    staffNumber: student.staff_number || '',
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

function streamCardsZip(req, res) {
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
}

app.get('/api/exports/cards.zip', streamCardsZip);

app.use(['/exports', '/exports.html', '/api/exports'], requireExportsPassword);
app.use(/^\/cohorts\/[^/]+\/exports\/?$/, requireExportsPassword);
app.use('/admin/cohorts/new', requireExportsPassword);
app.use(/^\/admin\/cohorts\/[^/]+\/edit\/?$/, requireExportsPassword);
app.use('/admin/app-settings', requireExportsPassword);
app.use('/admin.html', requireExportsPassword);
app.use('/api/admin', requireExportsPassword);

app.use((req, res, next) => {
  if (megaRestoreInProgress && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/api/admin/restore') {
    res.status(503).json({ error: 'The application is temporarily in maintenance mode for a full restore.' });
    return;
  }
  next();
});

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

app.get('/admin/app-settings', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin.html'));
});

app.get('/grid', (req, res) => {
  res.redirect(`/cohorts/${encodeURIComponent(getDefaultCohort().slug)}/grid`);
});

app.get('/exports', (req, res) => {
  res.redirect(`/cohorts/${encodeURIComponent(getDefaultCohort().slug)}/exports`);
});

app.get('/game', (req, res) => {
  if (!getAppSettings().matchGameEnabled) {
    res.status(404).send('Match game is disabled.');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'game.html'));
});

app.use(express.static(ROOT_DIR, {
  extensions: ['html'],
  index: 'index.html',
}));

app.get('/api/app-settings', (req, res) => {
  res.json(getAppSettings());
});

app.get('/api/app/icon', (req, res) => {
  const iconPath = path.join(APP_ASSETS_DIR, 'app-icon.jpg');
  if (!fs.existsSync(iconPath)) {
    res.sendFile(path.join(ROOT_DIR, 'icon.jpg'));
    return;
  }

  res.sendFile(iconPath);
});

app.get('/api/app/match-card-background', (req, res) => {
  const backgroundPath = path.join(APP_ASSETS_DIR, 'match-card-background.jpg');
  if (!fs.existsSync(backgroundPath)) {
    res.sendFile(path.join(ROOT_DIR, 'match_game.jpg'));
    return;
  }

  res.sendFile(backgroundPath);
});

app.post('/api/admin/app-settings', appSettingsUpload.fields([
  { name: 'icon', maxCount: 1 },
  { name: 'matchCardBackground', maxCount: 1 },
]), async (req, res) => {
  try {
    setSetting('app_name', normalizeAppName(req.body.appName));
    setSetting('match_game_enabled', req.body.matchGameEnabled === 'true' ? 'true' : 'false');
    await saveAppIcon(req.files?.icon?.[0]);
    await saveMatchCardBackground(req.files?.matchCardBackground?.[0]);
    res.json(getAppSettings());
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not save app settings.' });
  }
});

app.get('/api/admin/backup.zip', async (req, res) => {
  if (megaRestoreInProgress) {
    res.status(503).json({ error: 'A backup or restore is already in progress.' });
    return;
  }
  megaRestoreInProgress = true;
  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ILKKM_FULL_BACKUP_${new Date().toISOString().slice(0, 10)}.zip"`);
    await writeRawBackupArchive(res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Could not create backup.' });
    else res.destroy(error);
  } finally {
    megaRestoreInProgress = false;
  }
});

app.post('/api/admin/restore', megaRestoreUpload.single('backup'), async (req, res) => {
  if (megaRestoreInProgress) {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    res.status(409).json({ error: 'A backup or restore is already in progress.' });
    return;
  }
  megaRestoreInProgress = true;
  try {
    const parsed = await extractRawBackup(req.file?.path);
    performRawRestore(parsed);
    res.json({ restored: true, appSettings: getAppSettings() });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not restore backup.' });
  } finally {
    megaRestoreInProgress = false;
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
  }
});

app.get('/api/cohorts', (req, res) => {
  const cohorts = db.prepare(`
    SELECT
      cohorts.id,
      cohorts.slug,
      cohorts.program,
      cohorts.sesi,
      cohorts.type,
      cohorts.supervisor_name,
      cohorts.supervisor_title,
      cohorts.icon_filename,
      cohorts.front_template_filename,
      cohorts.back_template_filename,
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

app.get('/api/cohorts/:slug/templates/:side', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  const side = String(req.params.side || '').trim().toLowerCase();
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!['front', 'back'].includes(side)) {
    res.status(400).json({ error: 'Template side must be front or back.' });
    return;
  }

  const filename = side === 'front' ? cohort.front_template_filename : cohort.back_template_filename;
  const templatePath = filename ? resolveInside(COHORT_TEMPLATES_DIR, filename) : null;
  if (!templatePath || !fs.existsSync(templatePath)) {
    res.status(404).json({ error: 'Custom template not found.' });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(templatePath);
});

app.use('/api/game', (req, res, next) => {
  if (!getAppSettings().matchGameEnabled) {
    res.status(404).json({ error: 'Match game is disabled.' });
    return;
  }

  next();
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
    const type = normalizeCohortType(req.body?.type);
    const supervisorName = String(req.body?.supervisorName || '').trim().toUpperCase();
    const supervisorTitle = String(req.body?.supervisorTitle || '').trim().toUpperCase();
    if (!normalized.program || !normalized.sesi) {
      res.status(400).json({ error: 'Program and sesi are required.' });
      return;
    }

    if (type === 'staff' && (!supervisorName || !supervisorTitle)) {
      res.status(400).json({ error: 'Supervisor name and title are required for staff cohorts.' });
      return;
    }
    const existing = getCohortByProgramSesi(normalized.program, normalized.sesi, type);
    if (existing) {
      res.status(409).json({ error: 'Cohort already exists.', cohort: serializeCohort(existing) });
      return;
    }

    const slug = getCohortSlug(normalized.program, normalized.sesi, type);
    const iconFilename = await saveCohortIcon(req.file, slug);
    const accentColor = normalizeColor(req.body?.accentColor);
    const cohort = createCohort(normalized.program, normalized.sesi, { type, supervisorName, supervisorTitle, iconFilename, accentColor });
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
    const type = normalizeCohortType(req.body?.type || cohort.type);
    const supervisorName = String(req.body?.supervisorName || '').trim().toUpperCase();
    const supervisorTitle = String(req.body?.supervisorTitle || '').trim().toUpperCase();
    if (!normalized.program || !normalized.sesi) {
      res.status(400).json({ error: 'Program and sesi are required.' });
      return;
    }

    const recordCount = Number(db.prepare('SELECT COUNT(*) AS count FROM students WHERE cohort_id = ?').get(cohort.id).count || 0);
    if (type !== cohort.type && recordCount > 0) {
      res.status(409).json({ error: 'Cohort type cannot be changed after records have been saved.' });
      return;
    }
    if (type === 'staff' && (!supervisorName || !supervisorTitle)) {
      res.status(400).json({ error: 'Supervisor name and title are required for staff cohorts.' });
      return;
    }
    const matching = getCohortByProgramSesi(normalized.program, normalized.sesi, type);
    if (matching && Number(matching.id) !== Number(cohort.id)) {
      res.status(409).json({ error: 'Another cohort already uses this Program/Sesi.', cohort: serializeCohort(matching) });
      return;
    }

    const newSlug = getCohortSlug(normalized.program, normalized.sesi, type);
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
        SET slug = ?, program = ?, sesi = ?, type = ?, supervisor_name = ?, supervisor_title = ?, icon_filename = ?, accent_color = ?, updated_at = ?
        WHERE id = ?
      `).run(newSlug, normalized.program, normalized.sesi, type, type === 'staff' ? supervisorName : null, type === 'staff' ? supervisorTitle : null, iconFilename || null, accentColor, now, cohort.id);

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
        SET slug = ?, program = ?, sesi = ?, type = ?, supervisor_name = ?, supervisor_title = ?, icon_filename = ?, accent_color = ?, updated_at = ?
        WHERE id = ?
      `).run(oldSlug, cohort.program, cohort.sesi, cohort.type, cohort.supervisor_name || null, cohort.supervisor_title || null, cohort.icon_filename || null, cohort.accent_color || DEFAULT_COHORT_COLOR, new Date().toISOString(), cohort.id);
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
    const needsRegeneration = normalized.program !== cohort.program || normalized.sesi !== cohort.sesi
      || type !== cohort.type || supervisorName !== (cohort.supervisor_name || '')
      || supervisorTitle !== (cohort.supervisor_title || '');
    if (needsRegeneration) students.forEach((student) => removeStudentThumbnails(student.ic_number));
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

app.delete('/api/exports/cohorts/:slug', express.json(), (req, res) => {
  if (req.body?.confirmation !== 'DELETE') {
    res.status(400).json({ error: 'Type DELETE exactly to confirm cohort deletion.' });
    return;
  }

  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const students = getStudentsByCohort(cohort);
  const quarantineDir = path.join(DATA_DIR, `.delete-cohort-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const targets = new Set();
  const addTarget = (filePath) => { if (filePath) targets.add(filePath); };

  addTarget(resolveInside(EXPORTS_DIR, cohort.slug));
  addTarget(resolveInside(COHORT_ICONS_DIR, cohort.icon_filename));
  addTarget(resolveInside(COHORT_TEMPLATES_DIR, cohort.front_template_filename));
  addTarget(resolveInside(COHORT_TEMPLATES_DIR, cohort.back_template_filename));
  students.forEach((student) => {
    addTarget(resolveInside(PHOTOS_DIR, student.photo_filename));
    addTarget(resolveInside(THUMBNAILS_DIR, getThumbnailFilename(student.ic_number, 'front')));
    addTarget(resolveInside(THUMBNAILS_DIR, getThumbnailFilename(student.ic_number, 'back')));
  });

  const staged = [];
  try {
    fs.mkdirSync(quarantineDir, { recursive: true });
    [...targets].forEach((target, index) => {
      if (!fs.existsSync(target)) return;
      const stagedPath = path.join(quarantineDir, `${index}-${path.basename(target)}`);
      fs.renameSync(target, stagedPath);
      staged.push({ target, stagedPath });
    });

    db.transaction(() => {
      db.prepare('DELETE FROM students WHERE cohort_id = ?').run(cohort.id);
      const result = db.prepare('DELETE FROM cohorts WHERE id = ?').run(cohort.id);
      if (result.changes !== 1) throw new Error('Cohort changed before it could be deleted.');
    })();
  } catch (error) {
    let rollbackError = null;
    [...staged].reverse().forEach(({ target, stagedPath }) => {
      if (!fs.existsSync(stagedPath)) return;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(stagedPath, target);
      } catch (restoreError) {
        rollbackError ||= restoreError;
      }
    });
    if (!rollbackError) fs.rmSync(quarantineDir, { recursive: true, force: true });
    res.status(500).json({
      error: rollbackError
        ? 'Could not delete cohort and one or more files could not be restored. Check the server data directory.'
        : error.message || 'Could not delete cohort.',
    });
    return;
  }

  try {
    fs.rmSync(quarantineDir, { recursive: true, force: true });
  } catch (error) {
    // The cohort is already deleted; stale quarantine data can be removed safely later.
  }

  res.json({ deleted: true, slug: cohort.slug, recordCount: students.length });
});

app.post('/api/exports/cohorts/:slug/templates', cohortTemplateUpload.fields([
  { name: 'frontTemplate', maxCount: 1 },
  { name: 'backTemplate', maxCount: 1 },
]), async (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  const frontFile = req.files?.frontTemplate?.[0] || null;
  const backFile = req.files?.backTemplate?.[0] || null;

  if (!frontFile && !backFile) {
    res.status(400).json({ error: 'Choose a front or back background image.' });
    return;
  }

  try {
    const frontTemplateFilename = frontFile
      ? await saveCohortTemplate(frontFile, cohort.slug, 'front')
      : cohort.front_template_filename;
    const backTemplateFilename = backFile
      ? await saveCohortTemplate(backFile, cohort.slug, 'back')
      : cohort.back_template_filename;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE cohorts
      SET front_template_filename = ?, back_template_filename = ?, updated_at = ?
      WHERE id = ?
    `).run(frontTemplateFilename || null, backTemplateFilename || null, now, cohort.id);

    if (frontFile && cohort.front_template_filename && cohort.front_template_filename !== frontTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, cohort.front_template_filename));
    }

    if (backFile && cohort.back_template_filename && cohort.back_template_filename !== backTemplateFilename) {
      removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, cohort.back_template_filename));
    }

    const updated = getCohortBySlug(cohort.slug);
    res.json({
      cohort: serializeCohort(updated),
      needsRegeneration: true,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update card backgrounds.' });
  }
});

app.delete('/api/exports/cohorts/:slug/templates/:side', (req, res) => {
  const cohort = getCohortBySlug(req.params.slug);
  const side = String(req.params.side || '').trim().toLowerCase();
  if (!cohort) {
    sendCohortNotFound(res);
    return;
  }

  if (!['front', 'back'].includes(side)) {
    res.status(400).json({ error: 'Template side must be front or back.' });
    return;
  }

  const oldFilename = side === 'front' ? cohort.front_template_filename : cohort.back_template_filename;
  const column = side === 'front' ? 'front_template_filename' : 'back_template_filename';
  db.prepare(`
    UPDATE cohorts
    SET ${column} = NULL, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), cohort.id);

  if (oldFilename) {
    removeFileIfExists(resolveInside(COHORT_TEMPLATES_DIR, oldFilename));
  }

  res.json({
    cohort: serializeCohort(getCohortBySlug(cohort.slug)),
    needsRegeneration: true,
  });
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
    cohortType: cohort.type || 'student',
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
    const parsed = await parseDatasetBackup(req.file, cohort);
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
    const parsed = await parseDatasetBackup(req.file, cohort);
    await restoreCohortBackup(parsed, cohort);
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

  const cohortSlug = cohort.slug;
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
    jobTitle: student.job_title || '',
    staffNumber: student.staff_number || '',
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

  if (String(req.query?.download || '').toLowerCase() === '1') {
    res.download(photoPath, path.basename(student.photo_filename));
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
    const jobTitle = String(req.body.jobTitle || '').trim().toUpperCase();
    const staffNumber = String(req.body.staffNumber || '').trim().toUpperCase();
    const program = cohort.program;
    const sesi = cohort.sesi;

    if (!VALID_IC_PATTERN.test(icNumber)) {
      res.status(400).json({ error: 'Invalid IC number format.' });
      return;
    }

    const isStaff = cohort.type === 'staff';
    if (!name || !program || !sesi || (isStaff ? !jobTitle : !matrixNumber)) {
      res.status(400).json({ error: isStaff ? 'Name and job title are required.' : 'Name and matrix number are required.' });
      return;
    }

    if (!isStaff && !VALID_MATRIX_PATTERN.test(matrixNumber)) {
      res.status(400).json({ error: 'Matrix number must use format ABCD 1/1111(11)-1234.' });
      return;
    }
    if (staffNumber.length > 40) {
      res.status(400).json({ error: 'Staff number must be 40 characters or fewer.' });
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
        ic_number, cohort_id, name, matrix_number, job_title, staff_number, program, sesi,
        photo_filename, front_filename, back_filename,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ic_number) DO UPDATE SET
        cohort_id = excluded.cohort_id,
        name = excluded.name,
        matrix_number = excluded.matrix_number,
        job_title = excluded.job_title,
        staff_number = excluded.staff_number,
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
      isStaff ? '' : matrixNumber,
      isStaff ? jobTitle : null,
      isStaff ? staffNumber || null : null,
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

  const manifest = getBackupManifest(cohort);
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

  if (manifest.templates?.front) {
    const frontTemplatePath = resolveInside(COHORT_TEMPLATES_DIR, manifest.templates.front);
    if (frontTemplatePath && fs.existsSync(frontTemplatePath)) {
      archive.file(frontTemplatePath, { name: `templates/${path.basename(manifest.templates.front)}` });
    }
  }

  if (manifest.templates?.back) {
    const backTemplatePath = resolveInside(COHORT_TEMPLATES_DIR, manifest.templates.back);
    if (backTemplatePath && fs.existsSync(backTemplatePath)) {
      archive.file(backTemplatePath, { name: `templates/${path.basename(manifest.templates.back)}` });
    }
  }

  archive.finalize();
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? req.path === '/api/admin/restore'
        ? `Backup must be ${Math.round(MAX_FULL_RESTORE_SIZE / 1024 / 1024)}MB or smaller.`
        : 'Uploaded file exceeds the allowed size.'
      : error.message;
    res.status(400).json({ error: message });
    return;
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`ILKKM ID Card Generator running on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Photos directory: ${PHOTOS_DIR}`);
  console.log(`Exports directory: ${EXPORTS_DIR}`);
  console.log(`Exports username: ${EXPORTS_USERNAME}`);
});
