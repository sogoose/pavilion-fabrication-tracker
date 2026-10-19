# Editable workflow board assets

The **01 / Workflow** page is now an editorial architectural presentation board with differently scaled technical illustrations, material samples, and expandable annotations. The existing **02 / Tracker** and its 3D viewer/data remain separate.

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

## Edit the layout or wording

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

