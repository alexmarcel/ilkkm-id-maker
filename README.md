# ILKKM ID Card Generator

A static browser app for generating student ID card images from blank `front.jpg` and `back.jpg` templates.

## Features

- Upload a student portrait photo.
- JPG/PNG photos are center-cropped and compressed in the browser before save.
- Enter student name, matrix number, and IC number.
- IC number is formatted as `######-##-####`.
- Automatically checks saved records when a valid IC number is typed.
- Save student details, photo, and generated front/back JPGs to the server.
- Program is fixed as `DIPLOMA KEJURURAWATAN`.
- Sesi is fixed as `SESI JANUARI 2026 - DISEMBER 2028`.
- Preview front and back card images in the browser.
- Download generated JPG files:
  - `{icnumber}_front.jpg`
  - `{icnumber}_back.jpg`
- IC hyphens are removed from filenames. Example:
  - Input: `860108-49-5026`
  - Output: `860108495026_front.jpg`

## Files

- `index.html` - App markup.
- `styles.css` - Responsive UI styling.
- `app.js` - Canvas rendering, validation, preview, and download logic.
- `front.jpg` - Blank front card template.
- `back.jpg` - Blank back card template.

## How To Use

For the original static-only preview workflow, open `index.html` directly in a browser.

The app runs fully in the browser. It does not upload or store student data on a server.

For SQLite-backed exports, run the Node server:

```bash
npm install
npm start
```

Then open:

- Generator: `http://localhost:3000/`
- Exports: `http://localhost:3000/exports`

The exports page and export APIs are password protected with HTTP Basic Auth.
Default credentials:

- Username: `admin`
- Password: `ilkkm2026`

Change them with `EXPORTS_USERNAME` and `EXPORTS_PASSWORD`.

## Docker

For the VPS Traefik stack, add the `ilkkm-id-maker` service from `docker-compose.yml` to your existing compose file.

It is configured for:

- GitHub build context: `https://github.com/alexmarcel/ilkkm-id-maker.git#main`
- Traefik host: `id.alexmarcel.com`
- Internal app port: `3000`
- Persistent volume mounted at `/data`

Set these environment variables before deploying:

```bash
ID_MAKER_EXPORTS_USERNAME=admin
ID_MAKER_EXPORTS_PASSWORD=your-secure-password
```

If running this repo by itself, build and run with Docker Compose:

```bash
docker compose up --build
```

The app is served on `http://localhost:3000`.

Persistent data is mounted at `./data`:

- `./data/app.sqlite`
- `./data/photos`
- `./data/exports`

## Save Workflow

When `Save` is clicked, the app stores:

- Student details in SQLite, using IC number as the unique ID.
- Uploaded photo in `photos`.
- Generated front/back JPGs in the Program+Sesi export folder.

Existing IC numbers are updated.

Photo uploads must be JPG or PNG. The browser compresses the card portrait photo to JPG before saving, and the backend enforces a final `1MB` limit.

## Template Requirements

The app expects:

- `front.jpg` and `back.jpg` to be in the same folder as `index.html`.
- Both templates to be `1967x3121`.
- Templates to already contain all fixed design elements and labels.
- Variable areas for photo, name, matrix number, IC number, program, and sesi to be blank.

## Notes

- Long names wrap into up to two rows on the front and back.
- Uploaded photos are center-cropped into the front photo area and saved as compressed JPG portraits.
- Preview rendering is optimized for mobile typing performance.
- Download rendering uses higher-quality canvas output for smoother text and images.
- The Exports page downloads saved generated cards from SQLite records and the server export folder.
