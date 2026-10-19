# Editable workflow board assets

The **01 / Workflow** page is a **compact, asymmetric architectural process diagram** titled **Workflow Guide & File Index**, connected by softly curved arrows. Small technical drawings remain editable as standalone vectors. Click a process to expand its original notes and links inline. The existing **02 / Tracker** and its 3D viewer/data remain separate.

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
3. **Export as SVG**, preserving the filename. The current viewBox is `0 0 135 65`. You can replace the drawing entirely; maintaining this aspect ratio is helpful but not mandatory (the page uses `object-fit:contain`).
4. Replace only the SVG in GitHub, then Commit. GitHub Pages will publish the updated drawing. The website will load that file automatically.

All eight illustrations are **separate vector files**, not code embedded inside `index.html`.

## Curved arrows — editable SVGs

Two additional SVG files control the visible process links:

- `arrows-desktop.svg`: soft Bézier arrows on the compact desktop board (viewBox 1100 × 1450)
- `arrows-mobile.svg`: independent curves for the narrow mobile layout (viewBox 360 × 1640)

Drying has no number, icon, participant field or expandable detail: it is an inline label in `index.html`, positioned using `.wb-drying` in `board.css`. Curved arrows in these two SVG files now connect 3D Printing and Rammed Earth to Drying, then optionally Firing / Glazing or directly Assembly.

Edit either in Illustrator and replace the same file on GitHub. You can move a chapter by changing `--x`, `--y`, `--w` in `board.css`; update the corresponding arrow endpoint to keep the connection aligned. The SVGs use arrowheads but no straight orthogonal connectors.

The older experimental study assets (`contour-fragment.svg`, `deposition-fragment.svg`, `soil-fragment.svg`, `mould-fragment.svg`, `diagram-guides.svg`) are archived in this folder but no longer shown on the page. They can be reused if desired.

## Process credits and compact support studies

The page remains **one Workflow page**. Eight main clickable processes plus a small **noninteractive Drying marker** are connected by editable SVG Bézier arrows; the numbered indices remain `01`, `02`, `03`, `04`, `05A`, `05B`, `06`, `07`. Both fabrication routes pass through Drying. Firing / Glazing is optional for selected dried components; dried components can also proceed directly to Assembly.

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

## Project principles

- Workflow is documentation: Spatial Design → Structural Check / G-code / Material → **3D Printing + Rammed Earth** → selective Firing → upcoming Assembly.
- Construction Management guidance is separate from the physical fabrication process.
- G-code Attachments, Firing fields and module records stay inside the existing Tracker.
- Default site opening: Tracker.

