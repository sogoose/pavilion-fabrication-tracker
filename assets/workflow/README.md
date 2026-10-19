# Editable workflow drawings

These eight standalone SVG files are used by the **01 / Workflow** process map in `index.html`.

To edit: open any `.svg` file in Adobe Illustrator or a vector editor, make your drawing, export/save as **SVG** (not PNG), and replace that same file in this directory. Keep the same filename and ideally the `135 × 65` viewBox proportions so the layout stays consistent. GitHub Pages publishes the updated artwork after the commit deploys. The site references these files via `<img src="./assets/workflow/name.svg">`, so changing an icon never requires editing `index.html`.

Files: `spatial.svg`, `structural.svg`, `gcode.svg`, `material.svg`, `printing.svg`, `rammed.svg`, `firing.svg`, `assembly.svg`.

Artwork uses transparent backgrounds and dark-grey vector strokes. External SVGs are intentionally referenced by file path; changing SVG stroke colors is done inside the SVG itself.
