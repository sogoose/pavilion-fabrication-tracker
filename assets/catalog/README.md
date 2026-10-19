# Fabrication Catalogue — PDF export

The Tracker now exports module records as a downloadable **A4 landscape PDF**.

## How to use

- In **02 / Tracker**, click **Catalogue PDF ↗** in the top bar.
- Choose **Full catalogue** (all modules, with a summary cover) or **Selected module** if a block is selected in the Rhino model.
- Choose a main visual: **Auto / Photo → G-code → 3D** (recommended), **Photograph first**, **G-code first**, or **Isolated Rhino 3D first**.
- Click **Download PDF ↗** and wait for the progress indicator. The browser downloads a PDF; it does not upload a new document to Supabase.
- In the module side panel, click **↗ Module PDF Sheet** to export that particular module.

## Printed layout

Each module receives a CAD-style technical sheet. It contains:
- A large visual: uploaded module photograph, 2D XY G-code preview, or isolated 3D Rhino geometry.
- Object ID, module number, level, sequence, assigned students, method, machine, material, weight and infill.
- Structural, production, drying and assembly statuses.
- Print settings: speed, manual adjustment, pressure, first-layer height, layer height, duration.
- Firing/glazing data: route, status, kiln, batch, peak temperature, firing date and shrinkage measurements.
- Notes, material recipe, G-code filename, updated-by, timestamp and Rhino identifier.
- If longer notes or references overflow the drawing sheet, additional detail pages preserve the complete values.

The full catalogue has a simple cover with counts and module-ID index. All module pages are sorted by **Object ID** (natural order, case-sensitive). Missing values are displayed with an em dash.

## Data and media rules

- Source data is fetched fresh from **Supabase** when shared mode is available. Local current-model records provide fallback.
- One image is chosen per module in this default order: latest uploaded **photo** → attached **G-code** → isolated **Rhino 3D**. Alternative preferences can reorder that fallback.
- G-code renders the XY projection of **linear G0/G1 moves** (limited to the first 5 MB and 65k segments per preview). It is a documentation view, **not** a certified machine-path simulation; arcs, multi-axis robot instructions and Z layering are not fully visualized.
- Photos are downloaded from the Tracker's existing Supabase storage bucket. The original uploaded files remain unchanged.
- The isolated Rhino figure is rendered using a separate canvas and shares existing mesh geometry without altering module records, the model, or the 3D Tracker viewport.
- All PDF sheets are drawn into high-resolution browser canvas before being inserted into the PDF so non-Latin names and notes can remain visible even when jsPDF's basic fonts do not support them. As a trade-off the PDF text is not selectable.

## Architecture and maintenance

- **assets/catalog/catalog.js** — user-facing configuration dialog, shared data retrieval, visual fallback, G-code parsing, CAD-style PDF drawing, direct download.
- **assets/catalog/catalog.css** — dialog and button styling.
- **index.html** — imports the exporter module and adds the toolbar/side-panel download buttons.
- A browser-loaded **jsPDF** library builds the final PDF from page canvases. If jsPDF fails to load, the dialog displays an error instead of changing tracker data.

This feature is **read-only**. It never mutates module data or changes the Tracker's collaborative edit permissions. For 100+ modules, PDF generation and 3D rendering can take time and consume browser memory; the progress indicator updates throughout. For particularly large exports, use selected-module mode or retry in a desktop browser.

## Edit the layout

Module sheets and the cover are authored in `drawSheet()`, `drawAppendixPages()` and `drawCover()` in `catalog.js`. The A4 target size is 297 × 210 mm. Layout is drawn at 1490 × 1050 logical units, then embedded as JPEG pages at a 1700 × 1202 canvas resolution.
