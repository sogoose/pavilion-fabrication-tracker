# Pavilion Fabrication Catalogue — current-model-only PDF

The Tracker exports an **A4 landscape catalogue** with exactly **one PDF sheet per Rhino module**, plus an optional **two-part front matter**: first a labelled, colour-coded Rhino model showing Production Status, then a large Module Register. The authoritative list of modules is the geometry loaded from the currently published `model.3dm`, NOT every historical row in Supabase.

## Current model and historical records

The published Rhino file was inventoried via GitHub Actions. At the cleanup on 19 October 2026:
- `model.3dm` contains **88 mesh modules** (and 4 curve objects).
- The active Supabase Tracker contained 163 entries. **75 outdated module rows** whose Rhino GUIDs were missing from the actual 3DM were backed up and then retired.
- **88 live entries** remain in `public.pavilion_parts`.
- The 75 former rows are recoverable in the private `public.pavilion_retired_parts_backup` table with the source model hash; this backup is not exposed to public/anonymous visitors.
- All 6 site photos and all 18 G-code attachments belong to active modules and were preserved.
- Historical event logs are retained for auditing.

The authoritative inventory is `assets/catalog/model-inventory.json`. GitHub Actions automatically rebuilds it when `model.3dm` changes, using `scripts/build_model_inventory.py`.

**PDF safety:** `assets/catalog/catalog.js` filters freshly downloaded Supabase rows by exact Rhino GUIDs from `state.parts` (the loaded 3D mesh objects) **before** generating any sheet. A stale cloud or browser-cache entry cannot produce a PDF page. If the model fails to load, the export displays an error rather than incorrectly returning all old records or performing any cleanup. PDF export is entirely read-only.

**Tracker cache:** once a valid Rhino model loads, local records from older model versions whose GUIDs are not in the current geometry are removed from that browser cache. A failed model load never purges local records.

## PDF page layout

### Front matter — full-catalogue downloads only

**Page 1 / Production Status Map:** the currently loaded Rhino geometry is rendered as one **orthographic axonometric**, with each module coloured using the same **Production Status palette and user-edited legend colours as the Tracker**. Modules are displaced radially by about **5.5% of the pavilion diagonal** in a PDF-only exploded view: the original Rhino geometry and production data remain unchanged. Small module names appear near their updated, exploded positions with **thin white text halos**, no boxes, no colour pins and no leader lines. A collision-avoidance pass seeks nearby available label positions so their printed names do not overlap. The **Production Status / Key Map** displays the colour, status and total for Not Started, Queued, Printing, Printed and Failed. Total modules, 3D Printing and Rammed Earth counts sit beside the drawing.

**Page 2 / Module Register:** the module names are no longer crowded into tiny lines on the cover. Instead they appear on a dedicated, readable A4 register: ID, colour swatch, Production Status and abbreviated manufacturing method. Records sort with uppercase IDs first. The register supports 88 entries per page; very large models use further register pages.

These two preliminary pages can be disabled using the checkbox in the PDF download dialog; individual-module PDFs never include them.

### Module sheets — one landscape A4 per block

- **Main left / site photograph:** a tall **101 × 137 mm** frame featuring the newest uploaded fabrication photograph. The original image aspect ratio is preserved. If no photo has been uploaded, the shaded Rhino module capture fills this frame as a fallback.
- **Upper right / G-code:** the unchanged **53 × 73 mm 3D axonometric** of G1 machining/printing moves, with continuous paths preserved. The drawing stays native PDF vector linework.
- **Lower right / Rhino 3D:** the smaller frame displays the shaded Rhino module capture when a fabrication photograph occupies the main frame. If there is no photograph, this frame says `NO UPLOADED PHOTO` instead. Other uploaded photos remain in storage.

The table on the right retains identity, method/machine, material, infill, production status, Fabrication Date, Drying/Assembly, printing parameters, Firing Date/Temperature/Duration and Kiln. In **06 / ADDITIONAL**, the report now includes compression force and G-code filename **but omits Updated By and Last Updated**.

Below the media, **MATERIAL COMPOSITION / RECIPE** uses the existing Tracker **Material Details → Composition / quantity** field, not Fabrication Note. Module Documentation and Rhino GUID are excluded. Every module still fits onto exactly one page.

Raster content is restricted to shaded 3D renders and actual photographs. Vector headers, table borders, English/Latin text, status swatches, module tags and G-code toolpaths remain sharp when zoomed. Unsupported non-Latin text may be rasterised at the individual field level.

## Download instructions

1. In **02 / Tracker**, wait for the bundled Rhino model to finish loading.
2. Choose **Catalogue PDF ↗** to export all currently modelled modules (with optional **Production Status Map + Module Register** front matter); you can also select **Uppercase IDs only**.
3. For one selected module, use **↗ Module PDF Sheet** in the side panel.
4. The files download directly to the visitor's browser; no PDF is uploaded to Supabase.

Uppercase ID records sort first (A01, B01, ... followed by a01, ...). IDs themselves are not renamed.

## Source files

- `assets/catalog/catalog.js` — catalogue dialog, current-model-only record gathering, site photo selection, single-module 3D capture, PDF download.
- `assets/catalog/vector-sheet.js` — one-page CAD-style vector PDF layout, 3D G-code parser/projection and high-resolution photo inserts.
- `assets/catalog/catalog.css` — dialog controls.
- `assets/catalog/model-inventory.json` — trusted current source geometry manifest, generated by CI.
- `scripts/build_model_inventory.py` and `.github/workflows/model-inventory.yml` — automatic Rhino manifest updates.
- `supabase/migrations/20261019_retired_model_parts_backup.sql` — private archive table used to preserve deleted records.
- `index.html` — PDF controls and Tracker’s current-model cache filtering.

## Known limits

The 3D toolpath parser supports linear G0/G1 with XYZ, relative/absolute coordinates and metric/inch changes. It is not robot-controller simulation or G2/G3 arc support. Very long paths are downsampled. A multi-module export can still take time because each model is rendered individually. If a Rhino file is deliberately replaced, catalogue pages always follow the *newly loaded* geometry; retire additional legacy database rows only after validating the new model inventory and making a new backup.
