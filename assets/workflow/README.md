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

- `arrows-desktop.svg`: soft Bézier arrows on the compact desktop board (viewBox 1100 × 1130)
- `arrows-mobile.svg`: independent curves for the narrow mobile layout (viewBox 360 × 1370)

Edit either in Illustrator and replace the same file on GitHub. You can move a chapter by changing `--x`, `--y`, `--w` in `board.css`; update the corresponding arrow endpoint to keep the connection aligned. The SVGs use arrowheads but no straight orthogonal connectors.

The older experimental study assets (`contour-fragment.svg`, `deposition-fragment.svg`, `soil-fragment.svg`, `mould-fragment.svg`, `diagram-guides.svg`) are archived in this folder but no longer shown on the page. They can be reused if desired.

## Team credits and parallel work packages

**There are two distinct layers on the Workflow page.**

1. The **main fabrication path** retains the editable curved arrow SVGs and the eight process illustrations. Each expandable process has a small `WORK PACKAGE` or `FABRICATION CREW` footnote directly in its `<summary>` in `index.html`.
2. The **Parallel Work Packages** section sits *outside* the arrow-connected workflow. These separate islands are independent research and support work packages, with team lists and optional file links. Their HTML lives immediately below `<div class="wb-board">` in `index.html` and their layout in `board.css`.

Current published team credits, from the supplied roster:
- Spatial: Yassmina
- Structural: Rojin, Ruben, Wenxiao
- G-code: team unconfirmed
- Materials: Linda, Evgenia, Tamara
- 3D printing / rammed-earth fabrication: rotating student teams of 2–3 (not the robotic support work-package team)
- Firing: Hongyuan, Yishan
- On-site assembly: team unconfirmed

Separate work packages:
- Computational Workflow: Sohyun
- Construction Management: Niels, Donna
- Printing/Robotic Setups: Maria, Elisavet
- HRC Assembly: Suzanne, Parjanya, Matthias, Jin
- Environmental Monitoring: Sonya, Gergana
- Computer Vision and Machine Learning: proposed in the studio brief, but **not listed with confirmed members** in the provided work-package roster. Do not represent them as assigned until confirmed.

To modify a member list, edit only the visible text in `index.html`; no JS/data migration is required. Existing links to the shared material/shift workbook and Tracker are preserved. The team overlays are separate from the production database.

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

