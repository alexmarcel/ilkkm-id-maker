# ILKKM ID Card Generator

Browser-based student ID card generator with a Node/SQLite backend for managing cohorts, saving records, photos, generated card images, and cohort exports.

## Features

- Public cohort home page lists available cohorts in a grid.
- Global Match Card mini game with timer and ranking.
- Admin-protected Add/Edit Cohort flow creates cohorts from Program + Sesi and updates the grid photo and card gradient color.
- Cohorts can be typed as Students or Staff. Staff cohorts store default supervisor details and generate staff cards with job title and optional staff number.
- Each cohort has its own generator, grid preview, exports page, response setting, ZIP export, backup, restore, and regeneration tools.
- Generate front/back student ID JPGs from `front.jpg` and `back.jpg`.
- IC number lookup using format `######-##-####`.
- Matrix number enforcement using format `ABCD 1/1111(11)-1111`.
- IC lookup auto-populates saved name, matrix number, and photo.
- If no IC record exists, the form clears photo, name, and matrix fields.
- Photo upload accepts JPG/PNG, center-crops to the card portrait ratio, compresses to JPG in the browser, and saves under `1MB`.
- Generated card text uses bundled Liberation Sans Bold so front/back JPGs keep the same font across devices.
- Saved Records table on the main page shows cohort records with saved status.
- Grid Preview shows the current cohort in a responsive card grid with front/back flip preview.
- Grid thumbnails are generated at `720px` wide and cached for faster loading.
- Protected Exports page lists records, previews front/back cards in modals, deletes rows, controls response status, and downloads all cards as a ZIP.
- Each cohort can use custom front/back card background images from its Exports settings.
- When responses are closed, the generator disables the form and shows a centered overlay on the card preview.

## Running Locally

```bash
npm install
npm start
```

Open:

- Cohorts: `http://localhost:3000/`
- Match Game: `http://localhost:3000/game`
- Generator: `http://localhost:3000/cohorts/{cohort_slug}`
- Grid Preview: `http://localhost:3000/cohorts/{cohort_slug}/grid`
- Exports: `http://localhost:3000/cohorts/{cohort_slug}/exports`
- Admin settings and full backup/restore: `http://localhost:3000/admin/app-settings`

The Add Cohort flow, Exports page, and export APIs use HTTP Basic Auth. Set credentials through the deployment environment before starting the application; do not commit real values:

```bash
EXPORTS_USERNAME=<admin-username>
EXPORTS_PASSWORD=<strong-unique-password>
```

## Save Workflow

The home page creates or opens a cohort first. When a valid IC number is typed in a cohort generator, the app checks SQLite for an existing student in that cohort.

When `Save` is clicked, the backend stores:

- Student details in SQLite, using IC number as the global unique ID and the selected cohort as the record group.
- Compressed portrait photo in `/data/photos`.
- Generated front/back JPGs in `/data/exports/{PROGRAM_SESI_SLUG}`.

Existing IC numbers are updated. Saved filenames remove IC hyphens:

- `{icnumber}_photo.jpg`
- `{icnumber}_front.jpg`
- `{icnumber}_back.jpg`

## Cohorts

The app stores cohorts in SQLite with a generated slug based on Program + Sesi. On startup, a default cohort is created automatically from the application defaults.

Existing records are migrated into matching cohorts by Program/Sesi. The old `/grid` and `/exports` routes redirect to the default cohort routes.

Cohorts have one of two types:

- **Students** use name, IC number, matrix number, program, and sesi.
- **Staff** use name, IC number, job title, optional staff number, and cohort-level supervisor name/title.

Program + Sesi + Type identifies a cohort, so student and staff cohorts may share the same Program/Sesi. Existing cohorts are treated as student cohorts. A cohort type can only be changed while it has no saved records.

Staff cards use `assets/staff-front.jpg` and `assets/staff-back.jpg` by default. The front shows the photo and name in the blue panel, with IC number and job title in black in the lower white panel. The optional staff number appears at the top. The back shows the staff cohort's default supervisor name and title. Custom cohort templates continue to override the defaults.

Use the pencil button on a cohort card to edit its Program, Sesi, grid photo, or card gradient color. Cohort photos are compressed before upload. When Program/Sesi changes, saved student rows are updated, but existing card JPGs are not regenerated automatically. The edit modal shows an amber reminder to run `Regenerate Cards` from the cohort Exports page so back-card text stays consistent. Its danger zone can permanently delete the cohort and all associated records and managed files after typing `DELETE` exactly.

## Match Card Game

The global Match Card game uses saved front-card thumbnails from all cohorts. Players start from `/game`, match pairs against a timer, then enter a name up to 8 characters for the global ranking table. Rankings are sorted by fastest time, then fewer moves.

Gameplay:

- Up to 9 random students are selected per round.
- Each selected student appears twice using the same front-card thumbnail.
- Face-down cards show a circled question mark.
- The header stays visible during play and the main button changes from `Start Game` to `Reset`.

## Exports

Each cohort Exports page supports:

- Record table with number, name, matrix number, and IC number.
- Front-card modal preview via the `file-input` icon.
- Back-card modal preview via the `file-output` icon.
- Row delete via the trash icon.
- ZIP download of all generated cards for the selected Program/Sesi.
- Cohort dataset backup and restore with confirmation summaries.
- Cohort and per-row card regeneration from saved records/photos.
- Accepting response setting to open or close the main generator form.
- Card background settings to upload, preview, or remove custom front/back templates for that cohort.

ZIP structure:

```text
{ic_without_hyphens}/
  {ic_without_hyphens}_front.jpg
  {ic_without_hyphens}_back.jpg
```

## Cohort Dataset Backup / Restore

The Exports page can back up and restore only the selected Program/Sesi cohort.

Backup downloads a ZIP containing:

- `manifest.json`
- `students.json`
- matching files in `photos/`
- matching files in `exports/{cohort_slug}/`
- custom files in `templates/` when the cohort uses custom card backgrounds

Restore validates the uploaded ZIP before changing data. It rejects wrong Program/Sesi backups, invalid student rows, unsafe ZIP paths, missing files, and IC numbers that already belong to another Program/Sesi. Confirmed restore replaces only the selected cohort; other cohorts are left unchanged.

## Full Backup / Restore

The protected App Settings page at `/admin/app-settings` provides a normal full backup and restore workflow. `Backup Everything` downloads one ZIP containing a consistent `app.sqlite` snapshot plus all photos, generated cards, thumbnails, cohort icons/templates, and custom app images.

Choose that ZIP and click `Restore Everything` to replace the database and every managed data folder. The server checks the backup format, safe paths, supported schema, and required SQLite tables, stages the contents, then restores them while temporarily blocking writes. No persistent rollback copy is retained.

Full backup/restore endpoints are protected by the same HTTP Basic Auth as Exports:

```text
GET  /api/admin/backup.zip
POST /api/admin/restore
```

Optional restore limits can be configured with `MAX_FULL_RESTORE_SIZE`, `MAX_FULL_UNCOMPRESSED_SIZE`, and `MAX_FULL_BACKUP_ENTRIES`.

## Regenerating Cards

The Exports page can regenerate generated front/back JPGs from saved SQLite records, saved cropped photos, the cohort's custom backgrounds or default `front.jpg` / `back.jpg`, and the bundled Liberation Sans Bold font.

Use:

- `Regenerate Cards` to overwrite all front/back JPGs for the selected Program/Sesi.
- The row refresh icon to regenerate one student.

If a saved photo is missing, that record is skipped and reported instead of stopping the whole cohort job.

Changing a cohort card background does not regenerate existing saved cards automatically. Run `Regenerate Cards` after uploading or removing a custom background.

## Grid Preview

The Grid Preview page displays saved cards for the current Program/Sesi in a visual grid.

- Desktop uses 5 columns.
- Mobile uses 3 columns.
- Cards initially load only front thumbnails.
- Back thumbnails load on first card flip.
- Clicking a card flips between front and back.
- `Download All for Printing` opens a confirmation modal, then downloads the same full-size ZIP structure used by Exports.

Thumbnails are served from:

```text
/api/students/{icNumber}/card/{front|back}/thumbnail
```

Generated thumbnails are cached in `/data/thumbnails`. They are invalidated when a student is saved, cards are regenerated, a record is deleted, or a cohort restore replaces files. Full-size JPGs remain the source of truth for printing and ZIP exports.

## Accepting Responses

Each cohort Exports page has an `Accepting response` switch for that cohort generator.

When responses are closed:

- IC number, photo upload, name, matrix number, and save are disabled.
- The status label tells users the form is not accepting responses.
- The card preview shows a centered overlay with a lock icon and admin contact message.
- The backend rejects save requests as a final safety gate.

## Docker / Traefik

Build and run the included Compose service from a local checkout. Configure the router hostname for your own deployment and retain the persistent volume:

```yaml
volumes:
  ilkkm_id_maker_data:
```

Set credentials in an untracked deployment `.env` or secret manager:

```bash
ID_MAKER_EXPORTS_USERNAME=<admin-username>
ID_MAKER_EXPORTS_PASSWORD=<strong-unique-password>
```

Persistent app data is mounted at `/data` inside the container.

## Important Files

- `server.js` - Express server, SQLite schema, save/export/delete APIs.
- `index.html` / `home.js` - Public cohort grid and Add Cohort entrypoint.
- `game.html` / `game.js` - Global Match Card game and ranking UI.
- `generator.html` / `app.js` - Cohort generator UI and canvas rendering.
- `exports.html` / `exports.js` - Protected exports UI.
- `grid.html` / `grid.js` - Cohort grid preview UI.
- `styles.css` - Shared responsive UI styles.
- `front.jpg` / `back.jpg` - Blank card templates.
- `assets/staff-front.jpg` / `assets/staff-back.jpg` - Default staff card templates.
- `icon.jpg` - Header icon.
- `Dockerfile` / `docker-compose.yml` - Container deployment.

## Template Requirements

- `front.jpg` and `back.jpg` must be available beside the app files.
- Both templates should be `1967x3121`.
- Fixed labels/design should already be baked into the templates.
- Variable areas for photo, name, matrix number, IC number, program, and sesi should be blank.

## Card Font

Generated card text uses the local font at:

```text
assets/fonts/liberation-sans-bold.ttf
```

The app waits for this font before rendering, saving, or downloading cards. If the font fails to load, save and download are disabled to avoid inconsistent browser fallback fonts.

Cards saved before this font change are already-rendered JPGs. Re-save those records to regenerate front/back images with the bundled font.
