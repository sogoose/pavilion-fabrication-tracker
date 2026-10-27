# LAMA Slicer 1.6 — browser version

Address: https://sogoose.github.io/pavilion-fabrication-tracker/lama-slicer/ (the QR code / edu.nl/8p47a opens `app/` directly)

LAMA Slicer 1.6 runs completely in the visitor's browser: the original interface, the robot scene (WASP 40100, UR5,
Comau NJ60-2.2), both configurations (standard: Contour, Orthogonal; **Earthen**: Simple and Improved sinusoidal),
G-code, Comau PDL and the results. No installation, no server.

## Files
- `app/` — the LAMA Slicer interface (`web/` of the desktop source) with `js/app.js` connected to the browser engine.
  Plain files: the QR address works on any device without a first visit to the landing page.
- `app/py/` — the Python side, unchanged: `lama_server.py`, `lama_engine.py`, `configurations/`, `toolpaths/`
  (the weave scripts of the Earthen configuration, Contour, Orthogonal), `converters/` (gcode2pdl), the trimesh wheel,
  `manifest.json`. **Open code** in the Earthen configuration links here.
- `app/py/geos_patch.py` — browser-only: shapely overlays with a 1e-6 mm grid. Pyodide's GEOS 3.12 throws an uncatchable
  TopologyException on some module sections (Improved sinusoidal on A00 stopped the engine); with it the toolpaths are the
  desktop ones (A00: same extruded length, layers within 0.1 mm).
- `py-worker.js` — runs that Python in Pyodide 0.29.3 (numpy, scipy, shapely from the Pyodide CDN) in a Web Worker.
- `bridge.js` — replaces the desktop app's local server: projects in IndexedDB, settings in localStorage, exports downloaded.
- `sw.js` — serves the export files of the session (`download?path=…`) and removes the caches of the old zip installer.
- `index.html` — landing page; opens `app/`. `loading-theme.css` — splash style. `legacy/` — older page.

## Updating
Build from the desktop source (`LAMA_Slicer` folder): `python tools/build_web.py <this folder>`, then commit `app/`,
`bridge.js`, `py-worker.js`, `sw.js`. The desktop setup (`LAMA_Slicer_Setup_<version>.exe`) and the two manuals come from
the same source.

## Limits
- First visit downloads the Python runtime (~30 MB); later visits use the browser cache. Slicing takes about twice as long
  as the desktop app (A00: Improved sinusoidal ~30 s, Orthogonal ~50 s).
- Projects stay in the browser they were made in. Imported toolpath scripts last for the session.
- Validate machine outputs before fabrication.

## Project credits and copyright

© 2026–27 **Maria Dumitrache · Rojin Aghaei · Niels Dobroschelski · TU Delft Creative Robotics 26–27 Students.** All rights reserved.

The standalone entry page and the original application's loading splash follow the Pavilion Fabrication Tracker's light, neutral visual style. The original toolpath algorithms, 3D machine models, and exporters are unchanged by this design update.

## Rhino-style 3D viewport navigation

- **Left click:** select the part or use its move/rotate gizmo. Left-drag no longer orbits the scene.
- **Right-button drag:** orbit in isometric / machine / plate views.
- **Right-button drag in Top or Front:** pan the view.
- **Shift + right-button drag:** orbit (also in Top / Front).
- **Ctrl + right-button drag:** zoom / dolly.
- **Middle-button drag:** pan.
- **Mouse wheel:** zoom toward the cursor.

This is a patch applied to `web/js/app.js` by `tools/build_web.py`. The robot models, slicing algorithms, G-code and PDL exporter are not changed.
