const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const generator = fs.readFileSync(path.join(root, 'generator.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'home.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const generatorMarkup = fs.readFileSync(path.join(root, 'generator.html'), 'utf8');

test('staff cohort schema and validation are present', () => {
  assert.match(server, /UNIQUE\(program, sesi, type\)/);
  assert.match(server, /supervisor_name TEXT/);
  assert.match(server, /job_title TEXT/);
  assert.match(server, /Cohort type cannot be changed after records have been saved/);
});

test('staff generator fields and templates are present', () => {
  assert.match(generator, /id="jobTitleInput"/);
  assert.match(generator, /id="staffNumberInput"/);
  assert.ok(fs.existsSync(path.join(root, 'assets', 'staff-front.jpg')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'staff-back.jpg')));
});

test('card file lookup uses the persisted cohort slug', () => {
  assert.match(server, /const cohort = getCohortById\(student\.cohort_id\);\s+const cohortSlug = cohort\?\.slug/);
});

test('full raw backup APIs are protected', () => {
  assert.match(server, /app\.use\('\/api\/admin', requireExportsPassword\)/);
  assert.match(server, /app\.get\('\/api\/admin\/backup\.zip'/);
  assert.match(server, /app\.post\('\/api\/admin\/restore'/);
  assert.match(server, /db\.backup\(snapshotDbPath\)/);
  assert.match(server, /type: 'full-raw-backup'/);
});

test('cohort deletion requires typed confirmation and cleans associated data', () => {
  assert.match(server, /app\.delete\('\/api\/exports\/cohorts\/:slug', express\.json\(\)/);
  assert.match(server, /req\.body\?\.confirmation !== 'DELETE'/);
  assert.match(server, /DELETE FROM students WHERE cohort_id = \?/);
  assert.match(server, /DELETE FROM cohorts WHERE id = \?/);
  assert.match(server, /\.delete-cohort-/);
  assert.match(index, /id="cohortDangerZone"/);
  assert.match(index, /id="cohortDeletePhrase"/);
  assert.match(home, /elements\.deletePhrase\.value !== 'DELETE'/);
});

test('grid preview pages use existing Basic Auth without protecting public data APIs', () => {
  assert.match(server, /app\.use\(\/\^\\\/cohorts\\\/\[\^\/\]\+\\\/grid/);
  assert.match(server, /app\.use\(\['\/grid', '\/grid\.html'\], requireExportsPassword\)/);
  assert.match(server, /app\.get\('\/api\/students\/records\/cohort'/);
  assert.match(server, /app\.get\('\/api\/students\/:icNumber\/card\/:side\/thumbnail'/);
  assert.match(server, /app\.get\('\/api\/exports\/cards\.zip', requireExportsPassword, streamCardsZip\)/);
  assert.match(generatorMarkup, /Grid Preview · Protected/);
});
