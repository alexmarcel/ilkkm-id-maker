# ILKKM ID Card Generator

A static browser app for generating student ID card images from blank `front.jpg` and `back.jpg` templates.

## Features

- Upload a student portrait photo.
- Enter student name, matrix number, and IC number.
- IC number is formatted as `######-##-####`.
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

Open `index.html` directly in a browser.

The app runs fully in the browser. It does not upload or store student data on a server.

## Template Requirements

The app expects:

- `front.jpg` and `back.jpg` to be in the same folder as `index.html`.
- Both templates to be `1967x3121`.
- Templates to already contain all fixed design elements and labels.
- Variable areas for photo, name, matrix number, IC number, program, and sesi to be blank.

## Notes

- Long names wrap into up to two rows on the front and back.
- Uploaded photos are center-cropped into the front photo area.
- Preview rendering is optimized for mobile typing performance.
- Download rendering uses higher-quality canvas output for smoother text and images.
