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

Edit either in Illustrator and replace the same file on GitHub. You can move a chapter by changing `--x`, `--y`, `--w` in `board.css`; update the corresponding arrow endpoint to keep the connection aligned. The SVGs use arrowheads but no straight orthogonal connectors.

The older experimental study assets (`contour-fragment.svg`, `deposition-fragment.svg`, `soil-fragment.svg`, `mould-fragment.svg`, `diagram-guides.svg`) are archived in this folder but no longer shown on the page. They can be reused if desired.

## Work-package names and detached SVG islands

There is **one Workflow canvas**, not a second Work Packages chapter.

- The eight arrow-connected production/process stages include participant credits directly in each clickable `<summary>`.
- Four smaller, disconnected study/support nodes are scattered **inside the same `wb-board`**. They have no arrows and no separate section heading. Each can be opened to read the team's remit and related links.
- Detached, Illustrator-editable placeholder SVGs: `computational.svg`, `construction.svg`, `environment.svg`, `hrc.svg`. Swap any of these files without changing the page code.
- To reposition these four islands: modify `--wp-x`, `--wp-y`, `--wp-w` in `board.css` (desktop and mobile media queries). The process node positions use `--x`, `--y`, `--w`.
- Only arrow-connected fabrication steps are included in `arrows-desktop.svg` and `arrows-mobile.svg`. Side islands must remain unconnected.

### Participant roster

- Spatial Design — Yassmina
- Structural Check — Rojin, Ruben, Wenxiao
- G-code Generation — Rojin, Niels
- Material Development — Linda, Evgenia, Tamara
- Materials Masters — Linda, Joyce, Yishan
- 3D Printing — rotating student teams of 2–3, guided by WASP Masters Linda, Niels, Joyce, Yishan and COMAU Masters Maria, Elisavet
- Rammed Earth — rotating student teams of 2–3, guided by Evgenia and Tamara
- Firing — Hongyuan, Yishan
- Assembly — all students

### Independent teams (no arrows)

- Computational Workflow / Integration — Sohyun
- Construction Management — Niels, Donna
- Environmental Monitoring — Sonya, Gergana
- HRC for Assembly — Suzanne, Parjanya, Matthias, Jin

Standalone Printing/Robotic Setups and unassigned Computer Vision / Machine Learning teams are intentionally **not shown as islands**. Equipment experts are credited within 3D Printing instead.

To edit names, descriptions, or links, modify the Workflow HTML in `index.html`. No database schema or Tracker record migration is needed. The original production data, module attachments, and status tracking stay inside the Tracker.

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

