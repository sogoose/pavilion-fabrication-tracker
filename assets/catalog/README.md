# Fabrication Catalogue — high-resolution vector PDF

The Tracker exports **A4 landscape CAD-style PDFs** with exactly **one page per module**. A summary cover page is optional in full-catalogue mode. No overflow/appendix pages are produced.

## How to export

In **02 / Tracker**, use **Catalogue PDF ↗** to download every module or select a module and use **↗ Module PDF Sheet** for a single A4 sheet. The main visual defaults to photo → shaded 3D model → 3D G-code; the dialog can prioritize a different main view. The *two smaller axonometric panels* are always included on every module sheet:
- **3D / Rhino axonometric:** linework reconstructed from Rhino render meshes and drawn as vector lines when geometry exists. If edges cannot be reconstructed but 3D raster preview exists, that preview is used.
- **G-code / 3D axonometric:** projected G0/G1 toolpath with X, Y and Z coordinates, drawn as vector PDF lines, not an XY top view. Travel lines are lighter.

The larger photo area remains in the top-left. When the module has no photograph it shows the isolated shaded Rhino model or G-code axonometric as a fallback. Missing source files show a clear placeholder rather than losing the module page.

## One-page CAD table

The table uses smaller vector type and includes module ID, module number, level, sequence, assignee, material, weight, manufacturing method, machine, infill, density, **Fabrication Date**, statuses, motor speed, manual adjustment, air pressure, first-layer height, layer height, duration, compression force, **Firing performed (yes/no), Firing Date and Peak Temperature**, G-code filename, and updated-by metadata.

The **MATERIAL COMPOSITION / RECIPE** panel displays the Tracker's existing **Material Details → Composition / quantity** field (`material_details`), *not* the free-form fabrication note. Long recipes are fitted into the fixed allotted space; extreme text length may require smaller lettering or visual truncation to honor the one-page limit. Fabrication notes, separate "Module Documentation" text, and Rhino GUID are deliberately excluded from the PDF.

## Vector quality

PDF headers, CAD table text (Latin text), lines, borders, Rhino outline segments, G-code projections and cover index are **native PDF vectors**. They remain sharp when zooming. Uploaded photographs and shaded Rhino previews are intentionally embedded as high-quality JPEGs; those source images cannot become vectors. Non-Latin field values (such as Korean text) are rasterized **individually at elevated resolution** when the standard built-in PDF font lacks the glyphs, so they remain readable while the table and the rest of the page retain vector properties.

## Sorting

Both PDF catalogue and Excel export place **uppercase-leading IDs first**, in natural alphanumeric order. Example: `A01`, `A02`, `B01`, `a01`, `b01`. IDs remain unchanged in the database.

## Website / database

The Tracker has a shared **Fabrication Date** field of type `date` (`pavilion_parts.fabrication_date`), separate from Firing Date; blank dates are sent as SQL `NULL`. Firing inputs now show only **Firing performed?** (`Firing_Status`: Not fired/Fired), **Firing date**, and **Peak temperature (°C)**. The previous Unfired / To Be Fired / Rammed route selection remains. Older columns (kiln, batch, program, shrinkage etc.) are preserved in Supabase for historical integrity, but hidden from the simplified form and catalogue.

The PDF data source is the current shared Supabase records, with the local Rhino model as the source of the isolated geometry. No data is modified by PDF export. Existing shared editing, photo uploads, G-code storage and Excel tools remain intact.

## Code

- `assets/catalog/catalog.js` — UI dialog, shared data/attachment loading and PDF assembly.
- `assets/catalog/vector-sheet.js` — **native vector PDF** sheet/cover, G-code 3D motion parser and Rhino edge projection.
- `assets/catalog/catalog.css` — PDF-export interface.
- `index.html` — Tracker input fields and download entrypoints.
- `supabase/migrations/20261019_fabrication_date.sql` — schema addition.
- Library: jsPDF UMD (client-side).

## Technical limitations

G-code projection understands linear **G0/G1**, relative/absolute positioning and changes to XYZ, but does not implement G2/G3 arcs, extruder semantics or robot-specific kinematics. Preview is documentation, not CNC validation. The parser processes the first 8 MB of uploaded G-code. Dense meshes/path files are reduced to a reasonable count of segments to keep very large catalogues printable. The PDF generation indicator can take several minutes for all 163 modules; selecting a single module is a faster way to verify layout.
