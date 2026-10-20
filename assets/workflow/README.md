# Editable workflow board assets

The **01 / Workflow** page is an **asymmetric architectural process diagram with an enlarged, standalone Assembly conclusion** titled **Workflow Guide & File Index**, connected by softly curved arrows. Small technical drawings remain editable as standalone vectors. Click a process to expand its original notes and links inline. The existing **02 / Tracker** and its 3D viewer/data remain separate.

## Edit an illustration in Illustrator

1. Open a source SVG in this folder:
   - `spatial.svg`
   - `structural.svg`
   - `gcode.svg`
   - `material.svg`
   - `printing.svg`
   - `rammed.svg`
   - `firing.svg`
   - `assembly.svg`
2. Edit it in Illustrator, Inkscape, or another vector editor.
3. **Export as SVG**, preserving the filename. Each main process now uses a **portrait, near-square 1:1.1 artboard**: `viewBox="0 -42 135 149"`, intrinsic size `135 × 149`. Its original horizontal drawing is centred within this new artboard **without nonuniform scaling or distortion**. If redrawing in Illustrator, use the same near-square portrait size and fill the extra vertical room as desired. The page displays SVGs with `object-fit:contain`.
4. Replace only the SVG in GitHub, then Commit. GitHub Pages will publish the updated drawing. The website will load that file automatically.

**Exception — Assembly:** `assembly.svg` uses a landscape `132 × 67` artboard with `viewBox="1 0 132 67"` because its pavilion diagram spans much more horizontally than vertically. The illustration itself is unchanged; only excess SVG margin is removed. The page renders it at up to **690px on desktop / 345px on mobile**, in its own full-width ending stage.

All eight illustrations are **separate vector files**, not code embedded inside `index.html`.

## Curved arrows — editable SVGs

Two additional SVG files control the visible process links:

- `arrows-desktop.svg`: soft Bézier arrows on the extended desktop board (**viewBox 1200 × 1930**)
- `arrows-mobile.svg`: independent curves for the narrow mobile layout (viewBox 360 × 2010)

Drying has no number, icon, participant field or expandable detail: it is an inline label in `index.html`, positioned using `.wb-drying` in `board.css`. Curved arrows in these two SVG files now connect 3D Printing and Rammed Earth to Drying, then optionally Firing / Glazing or directly Assembly.

Edit either in Illustrator and replace the same file on GitHub. You can move a chapter by changing `--x`, `--y`, `--w` in `board.css`; update the corresponding arrow endpoint to keep the connection aligned. The SVGs use arrowheads but no straight orthogonal connectors.

The four detached support-team artboards now also use **1:1.1 portrait proportions**, `180 × 198` with `viewBox="0 -54 180 198"`. Stage artwork is centred in a taller `170 × 187`-pixel frame on desktop. Since the art geometry remains unchanged, Illustrator layers and stroke proportions stay editable and intact.

Narrow mobile screens (up to 620px) now use a clean vertical sequence without arrows; the separate mobile-arrow SVG is retained for intermediate-width tablet layouts.

The five unused experimental fragment SVGs were removed from the deployed tree during the October 2026 cleanup. They remain recoverable from Git commit history if needed.

## Process credits and compact support studies

The page remains **one Workflow page**. Assembly sits on its own centered final row, with an enlarged landscape illustration (up to 690px desktop / 345px mobile). The solid path from Drying and optional dashed path from Firing / Glazing both lead into Assembly. Eight main clickable processes plus a small **noninteractive Drying marker** are connected by editable SVG Bézier arrows; the numbered indices remain `01`, `02`, `03`, `04`, `05A`, `05B`, `06`, `07`. Both fabrication routes pass through Drying. Firing / Glazing is optional for selected dried components; dried components can also proceed directly to Assembly.

**All names are hidden until a process or team is clicked.** A main process reveals its team credits alongside notes and files. The four support/research teams are quietly collected **beneath the process diagram**, without an extra section heading or connecting arrows; their names, descriptions and links are visible only upon expansion.

### Process roster

- Spatial Design — Yassmina
- Structural Check — Rojin, Ruben, Wenxiao
- G-code Generation — Rojin, Niels
- Material Team — Linda, Evgenia, Tamara
- 3D Printing — rotating student teams of 2–3, guided by WASP Masters Linda, Niels, Joyce, Yishan and COMAU Masters Maria, Elisavet
- Rammed Earth — rotating student teams of 2–3, guided by Evgenia and Tamara
- Firing / Glazing — Hongyuan, Yishan
- Assembly — all students

### Detached support teams

- Computational Workflow — Sohyun (`computational.svg`)
- Construction Management — Niels, Donna (`construction.svg`)
- Environmental Monitoring — Sonya, Gergana (`environment.svg`)
- HRC for Assembly — Suzanne, Parjanya, Matthias, Jin (`hrc.svg`)

SVGs are editable separately in Illustrator; these four are placeholders intended for replacement. To adjust their grouped layout, edit `.wp-cluster` in `board.css`. To edit credits, descriptions or links, edit the Workflow HTML in `index.html`. The existing 3D Tracker database and its records are unaffected.

## Shared Workflow editing (no login)

The Workflow page is collaboratively editable like **02 / Tracker**. Every visitor can expand a process/team and click **EDIT** (or double-click a drawing) to edit its title, team credits, description, caption, and file links. **Edit page** at the bottom of Workflow edits the overall heading, guide text, management link, and other page labels. Edits are saved to the shared Supabase table `pavilion_workflow_content`; everyone sees the updated text on refresh.

This requires no password, login email, or edit token. The original static Workflow content remains the fallback if an individual section has never been edited. Drawings and curved-arrow SVG files are still separately editable in GitHub/Illustrator.

Database permissions: anonymous users can **read, insert, and update** the 13 defined Workflow sections using scoped RLS policies; they cannot delete them or access private authentication tables. The migration is `supabase/migrations/20261019_workflow_open_collaboration.sql`. The Workflow editor code is `assets/workflow/editor.js`.

**02 / Tracker retains its separate anonymous edit permissions.** Blank Firing Dates are converted to SQL `NULL` before an individual save or batch save, avoiding PostgreSQL's invalid-date error.

**Important:** This is a publicly accessible website. Anyone who has the site address can now change Workflow text and file links, not only trusted classmates. Avoid putting confidential documents or untrusted links there; you can revert content through database/GitHub backups.

**Editing format:** credits use `ROLE | Person · Person` per line; file links use `LABEL | https://example.com/...` or `LABEL | #tracker`.

## Edit the layout or wording

The page uses Google Fonts **Syne SemiBold** for the main title, chapter names and Fabrication phase label, **Inter** for descriptions, and **IBM Plex Mono** for indices and technical captions. Fallbacks are included if external fonts do not load.


- `board.css`: column sizes, white space, visual hierarchy, yellow Fabrication highlight and responsive mobile arrangement.
- `index.html`: Workflow captions, HTML blocks, existing SharePoint links.
- `board.js`: lightweight links to Tracker; process details use native HTML `<details>` to expand within the board.

## Adding real process photos later

The current page intentionally does **not** upload or publish photos from the private conversation. You can add authorized photographs under `assets/workflow/photos/` and reference them from a new `<img>` in a Workflow illustration block. Keep a small file size and use descriptive alt text for meaningful photographs.

## Loading and asset optimization

When the site opens directly in **01 / Workflow**, the 14+ MB `model.3dm` download is postponed until someone selects **02 / Tracker**. Rendering the 3D scene also pauses while the Workflow page or browser tab is hidden. The original Rhino file and all module records are preserved. Main-process Illustrator SVGs have only their export metadata/whitespace removed; the G-code preview was quantized to 0.1 SVG unit (less than a display pixel) to reduce transfer size.

## Project principles

- Workflow is documentation: Spatial Design → Structural Check / G-code / Material → **3D Printing + Rammed Earth** → selective Firing → upcoming Assembly.
- Construction Management guidance is separate from the physical fabrication process.
- G-code Attachments, Firing fields and module records stay inside the existing Tracker.
- Default site opening: Tracker.

