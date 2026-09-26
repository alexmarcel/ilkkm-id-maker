const assert = require('node:assert/strict');
const archiver = require('archiver');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

async function createLegacyRawBackup(directory, schemaVersion, includePasswordColumns) {
  const Database = require('better-sqlite3');
  const snapshotPath = path.join(directory, `legacy-${schemaVersion}.sqlite`);
  const archivePath = path.join(directory, `legacy-${schemaVersion}.zip`);
  const db = new Database(snapshotPath);
  const passwordColumns = includePasswordColumns ? ', password_hash TEXT, password_version INTEGER NOT NULL DEFAULT 0' : '';
  db.exec(`
    CREATE TABLE cohorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, program TEXT NOT NULL, sesi TEXT NOT NULL,
      icon_filename TEXT, front_template_filename TEXT, back_template_filename TEXT, accent_color TEXT,
      accepting_response_closed INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'student',
      supervisor_name TEXT, supervisor_title TEXT${passwordColumns}, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE students (
      ic_number TEXT PRIMARY KEY, name TEXT NOT NULL, matrix_number TEXT, program TEXT NOT NULL, sesi TEXT NOT NULL,
      photo_filename TEXT NOT NULL, front_filename TEXT NOT NULL, back_filename TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cohort_id INTEGER, job_title TEXT, staff_number TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE game_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, player_code TEXT NOT NULL, time_ms INTEGER NOT NULL, moves INTEGER NOT NULL, pairs INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  const now = new Date().toISOString();
  if (includePasswordColumns) {
    db.prepare(`INSERT INTO cohorts (id,slug,program,sesi,accent_color,type,password_hash,password_version,created_at,updated_at) VALUES (1,'LEGACY_PASSWORD_COHORT','LEGACY PASSWORD','SESSION','\#0f8ea3','student','scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',4,?,?)`).run(now, now);
  } else {
    db.prepare(`INSERT INTO cohorts (id,slug,program,sesi,accent_color,type,created_at,updated_at) VALUES (1,'LEGACY_PRE_PASSWORD','LEGACY PRE PASSWORD','SESSION','\#0f8ea3','student',?,?)`).run(now, now);
  }
  db.close();
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify({ app: 'ilkkm-id-card-generator', type: 'full-raw-backup', version: 1, schemaVersion }), { name: 'manifest.json' });
    archive.file(snapshotPath, { name: 'app.sqlite' });
    archive.finalize();
  });
  return archivePath;
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/cohorts`);
      if (response.ok) return;
    } catch (error) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for test server.');
}

test('cohort password gates personal APIs and password changes revoke sessions', async (t) => {
  try {
    const Database = require('better-sqlite3');
    new Database(':memory:').close();
  } catch (error) {
    t.skip(`HTTP integration test requires a better-sqlite3 build for this Node version: ${error.code || error.message}`);
    return;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilkkm-password-test-'));
  const port = 33000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, EXPORTS_USERNAME: 'test-admin', EXPORTS_PASSWORD: 'test-admin-password' },
    stdio: 'ignore',
  });
  t.after(() => {
    child.kill();
  });
  await waitForServer(baseUrl, child);

  for (const blockedPath of [
    '/.data/app.sqlite',
    '/.data/app.sqlite-wal',
    '/.data/repair-backups/legacy.sqlite',
    '/server.js',
    '/package.json',
    '/docker-compose.yml',
  ]) {
    assert.equal((await fetch(`${baseUrl}${blockedPath}`)).status, 404, blockedPath);
  }
  assert.equal((await fetch(`${baseUrl}/game`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/game/cards`)).status, 401);
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-powered-by'), null);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${baseUrl}/vendor/lucide.min.js`)).status, 200);

  const create = new FormData();
  create.set('program', 'PASSWORD TEST');
  create.set('sesi', 'SESSION 2026');
  create.set('type', 'student');
  create.set('accentColor', '#0f8ea3');
  create.set('password', 'first-test-password');
  create.set('passwordConfirmation', 'first-test-password');
  const adminAuthorization = `Basic ${Buffer.from('test-admin:test-admin-password').toString('base64')}`;
  const created = await fetch(`${baseUrl}/api/exports/cohorts`, { method: 'POST', headers: { Authorization: adminAuthorization }, body: create });
  assert.equal(created.status, 201);
  const { cohort } = await created.json();
  assert.equal(cohort.passwordConfigured, true);

  const anonymous = await fetch(`${baseUrl}/api/students/records/cohort?cohortSlug=${encodeURIComponent(cohort.slug)}`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('cache-control'), /no-store/);

  const wrong = await fetch(`${baseUrl}/api/cohorts/${encodeURIComponent(cohort.slug)}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ password: 'incorrect-password' }),
  });
  assert.equal(wrong.status, 401);

  const login = await fetch(`${baseUrl}/api/cohorts/${encodeURIComponent(cohort.slug)}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ password: 'first-test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const records = await fetch(`${baseUrl}/api/students/records/cohort?cohortSlug=${encodeURIComponent(cohort.slug)}`, { headers: { Cookie: cookie } });
  assert.equal(records.status, 200);
  assert.match(records.headers.get('cache-control'), /private, no-store/);

  const update = new FormData();
  update.set('program', cohort.program);
  update.set('sesi', cohort.sesi);
  update.set('type', cohort.type);
  update.set('accentColor', cohort.accentColor);
  update.set('password', 'second-test-password');
  update.set('passwordConfirmation', 'second-test-password');
  const changed = await fetch(`${baseUrl}/api/exports/cohorts/${encodeURIComponent(cohort.slug)}`, { method: 'PATCH', headers: { Authorization: adminAuthorization }, body: update });
  assert.equal(changed.status, 200);
  const expired = await fetch(`${baseUrl}/api/cohorts/${encodeURIComponent(cohort.slug)}/session`, { headers: { Cookie: cookie } });
  assert.deepEqual(await expired.json(), { authenticated: false, passwordConfigured: true });

  for (const fixture of [
    { schemaVersion: 1, includePasswordColumns: false, slug: 'LEGACY_PRE_PASSWORD' },
    { schemaVersion: 2, includePasswordColumns: true, slug: 'LEGACY_PASSWORD_COHORT' },
  ]) {
    const archivePath = await createLegacyRawBackup(dataDir, fixture.schemaVersion, fixture.includePasswordColumns);
    const restore = new FormData();
    restore.set('backup', new File([fs.readFileSync(archivePath)], path.basename(archivePath), { type: 'application/zip' }));
    const restored = await fetch(`${baseUrl}/api/admin/restore`, { method: 'POST', headers: { Authorization: adminAuthorization }, body: restore });
    assert.equal(restored.status, 200, await restored.text());
    const cohorts = await (await fetch(`${baseUrl}/api/cohorts`)).json();
    const legacy = cohorts.cohorts.find((item) => item.slug === fixture.slug);
    assert.ok(legacy, fixture.slug);
    assert.equal(legacy.passwordConfigured, false);
  }

  const secureCohort = (await (await fetch(`${baseUrl}/api/cohorts`)).json()).cohorts.find((item) => item.slug === 'LEGACY_PASSWORD_COHORT');
  const secureUpdate = new FormData();
  secureUpdate.set('program', secureCohort.program);
  secureUpdate.set('sesi', secureCohort.sesi);
  secureUpdate.set('type', secureCohort.type);
  secureUpdate.set('accentColor', secureCohort.accentColor);
  secureUpdate.set('password', 'post-security-password');
  secureUpdate.set('passwordConfirmation', 'post-security-password');
  const secureChanged = await fetch(`${baseUrl}/api/exports/cohorts/${secureCohort.slug}`, { method: 'PATCH', headers: { Authorization: adminAuthorization }, body: secureUpdate });
  assert.equal(secureChanged.status, 200);
  const secureSlug = (await secureChanged.json()).cohort.slug;
  const secureLogin = await fetch(`${baseUrl}/api/cohorts/${secureSlug}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ password: 'post-security-password' }),
  });
  assert.equal(secureLogin.status, 200, await secureLogin.clone().text());
  const secureCookie = secureLogin.headers.get('set-cookie').split(';', 1)[0];
  const secureBackup = await fetch(`${baseUrl}/api/admin/backup.zip`, { headers: { Authorization: adminAuthorization } });
  assert.equal(secureBackup.status, 200);
  const secureRestore = new FormData();
  secureRestore.set('backup', new File([await secureBackup.arrayBuffer()], 'secure-backup.zip', { type: 'application/zip' }));
  assert.equal((await fetch(`${baseUrl}/api/admin/restore`, { method: 'POST', headers: { Authorization: adminAuthorization }, body: secureRestore })).status, 200);
  const secureRestored = (await (await fetch(`${baseUrl}/api/cohorts`)).json()).cohorts.find((item) => item.slug === secureSlug);
  assert.equal(secureRestored.passwordConfigured, true);
  const oldSecureSession = await fetch(`${baseUrl}/api/cohorts/${secureSlug}/session`, { headers: { Cookie: secureCookie } });
  assert.equal((await oldSecureSession.json()).authenticated, false);
});

test('backup code accepts legacy schema and does not restore active sessions', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /\[1, 2, BACKUP_SCHEMA_VERSION\]\.includes\(Number\(manifest\.schemaVersion\)\)/);
  assert.match(server, /preserveSecurePasswords \? row\.password_hash \|\| null : null/);
  assert.match(server, /secureBackup: Number\(manifest\.schemaVersion\) === BACKUP_SCHEMA_VERSION/);
  assert.match(server, /DELETE FROM cohort_sessions/);
  assert.match(server, /sanitizedSnapshot\.prepare\('DELETE FROM cohort_sessions'\)/);
  assert.doesNotMatch(server, /database\/cohort-sessions\.json/);
});

test('administrator credentials are mandatory and former defaults are rejected', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /FORMER_ADMIN_USERNAMES/);
  assert.match(server, /FORMER_ADMIN_PASSWORDS/);
  assert.doesNotMatch(server, /process\.env\.EXPORTS_USERNAME \|\| 'admin'/);
  assert.doesNotMatch(server, /express\.static\(ROOT_DIR/);
});
