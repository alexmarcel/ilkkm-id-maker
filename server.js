const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const archiver = require('archiver');
const Database = require('better-sqlite3');
const express = require('express');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, '.data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.sqlite');
const EXPORTS_DIR = process.env.EXPORTS_DIR || path.join(DATA_DIR, 'exports');
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(DATA_DIR, 'photos');
const DEFAULT_PROGRAM = 'DIPLOMA KEJURURAWATAN';
const DEFAULT_SESI = 'SESI JANUARI 2026 - DISEMBER 2028';
const EXPORTS_USERNAME = process.env.EXPORTS_USERNAME || 'admin';
const EXPORTS_PASSWORD = process.env.EXPORTS_PASSWORD || 'ilkkm2026';
const MAX_PHOTO_SIZE = 1024 * 1024;
const VALID_IC_PATTERN = /^\d{6}-\d{2}-\d{4}$/;
const VALID_MATRIX_PATTERN = /^[A-Z]{4} \d\/\d{4}\(\d{2}\)-\d{4}$/;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 3,
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
`);

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
    SELECT ic_number, name, matrix_number, front_filename, back_filename
    FROM students
    WHERE program = ? AND sesi = ?
    ORDER BY name COLLATE NOCASE, ic_number
  `).all(program, sesi);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

  db.prepare('DELETE FROM students WHERE ic_number = ?').run(icNumber);

  res.json({
    deleted: true,
    icNumber,
  });
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

app.listen(PORT, () => {
  console.log(`ILKKM ID Card Generator running on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Photos directory: ${PHOTOS_DIR}`);
  console.log(`Exports directory: ${EXPORTS_DIR}`);
  console.log(`Exports username: ${EXPORTS_USERNAME}`);
});
