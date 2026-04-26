# ILKKM ID Card Generator

Browser-based student ID card generator with a Node/SQLite backend for saving records, photos, generated card images, and cohort exports.

<img width="3780" height="1512" alt="snapshot" src="https://github.com/user-attachments/assets/38e5cc9f-5066-4e90-b464-fe01acbcf808" />


## Features

- Generate front/back student ID JPGs from `front.jpg` and `back.jpg`.
- IC number lookup using format `######-##-####`.
- Matrix number enforcement using format `ABCD 1/1111(11)-1111`.
- IC lookup auto-populates saved name, matrix number, and photo.
- If no IC record exists, the form clears photo, name, and matrix fields.
- Photo upload accepts JPG/PNG, center-crops to the card portrait ratio, compresses to JPG in the browser, and saves under `1MB`.
- Generated card text uses bundled Liberation Sans Bold so front/back JPGs keep the same font across devices.
- Saved Records table on the main page shows cohort records with saved status.
- Protected Exports page lists records, previews front/back cards in modals, deletes rows, and downloads all cards as a ZIP.

## Running Locally

```bash
npm install
npm start
```

Open:

- Generator: `http://localhost:3000/`
- Exports: `http://localhost:3000/exports`

The Exports page and export APIs use HTTP Basic Auth.

Default credentials:

- Username: `admin`
- Password: your default password

Change them with:

```bash
EXPORTS_USERNAME=admin
EXPORTS_PASSWORD=your-secure-password
```

## Save Workflow

When a valid IC number is typed, the app checks SQLite for an existing student.

When `Save` is clicked, the backend stores:

- Student details in SQLite, using IC number as the unique ID.
- Compressed portrait photo in `/data/photos`.
- Generated front/back JPGs in `/data/exports/{PROGRAM_SESI_SLUG}`.

Existing IC numbers are updated. Saved filenames remove IC hyphens:

- `{icnumber}_photo.jpg`
- `{icnumber}_front.jpg`
- `{icnumber}_back.jpg`

## Exports

The Exports page supports:

- Record table with number, name, matrix number, and IC number.
- Front-card modal preview via the `file-input` icon.
- Back-card modal preview via the `file-output` icon.
- Row delete via the trash icon.
- ZIP download of all generated cards for the selected Program/Sesi.
- Cohort dataset backup and restore with confirmation summaries.
- Cohort and per-row card regeneration from saved records/photos.

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

Restore validates the uploaded ZIP before changing data. It rejects wrong Program/Sesi backups, invalid student rows, unsafe ZIP paths, missing files, and IC numbers that already belong to another Program/Sesi. Confirmed restore replaces only the selected cohort; other cohorts are left unchanged.

## Regenerating Cards

The Exports page can regenerate generated front/back JPGs from saved SQLite records, saved cropped photos, `front.jpg`, `back.jpg`, and the bundled Liberation Sans Bold font.

Use:

- `Regenerate Cards` to overwrite all front/back JPGs for the selected Program/Sesi.
- The row refresh icon to regenerate one student.

If a saved photo is missing, that record is skipped and reported instead of stopping the whole cohort job.

## Docker / Traefik

`docker-compose.yml` is prepared for your Traefik VPS stack.

It builds from:

```text
https://github.com/alexmarcel/ilkkm-id-maker.git#main
```

Default Traefik host:

```text
id.YOURHOST.com
```

Add the service from `docker-compose.yml` into your existing Traefik compose file and add this volume:

```yaml
volumes:
  ilkkm_id_maker_data:
```

Set exports credentials in your VPS `.env`:

```bash
ID_MAKER_EXPORTS_USERNAME=admin
ID_MAKER_EXPORTS_PASSWORD=your-secure-password
```

Persistent app data is mounted at `/data` inside the container.

## Important Files

- `server.js` - Express server, SQLite schema, save/export/delete APIs.
- `index.html` / `app.js` - Main generator UI and canvas rendering.
- `exports.html` / `exports.js` - Protected exports UI.
- `styles.css` - Shared responsive UI styles.
- `front.jpg` / `back.jpg` - Blank card templates.
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
