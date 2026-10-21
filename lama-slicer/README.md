# LAMA Slicer — Original N1/N2 robot workspace

Address: https://sogoose.github.io/pavilion-fabrication-tracker/lama-slicer/

The **unchanged original user-provided** `LAMA_Slicer.zip` is committed at `lama-slicer/LAMA_Slicer.zip` in this repository (sha1 Git blob `ec4f6cf4391d49bb19d992f4c2f9c0bbea6b5402`). Visitors **do not** upload or download a ZIP manually.

## What opens
- The *original* `web/index.html`, `web/css/style.css` and `web/js/app.js` interface, plus its original bundled Three.js controls/loaders.
- WASP 40100 `web/models/wasp.json`, UR5 `web/models/ur5_station.json`, Comau NJ60-2.2 `web/models/comau_nj60.json`, unchanged. The full robot scene, placement, animation and printing preview code are used.
- Unchanged N1 and N2 `weave_pattern.py`, `weave_slice.py`, `weave_gcode.py` plus the original `gcode2pdl_arduino.py` converter and `settings.json`.

## Hosting architecture
1. Loading `/lama-slicer/` downloads the committed original ZIP and unpacks its web files and Python scripts into the **browser Cache Storage** under `/lama-slicer/app/`. This happens automatically without asking the visitor for a file. Later visits reuse the cache until version invalidation or browser storage clearing.
2. `sw.js` serves only resources within the `/lama-slicer/` scope and never affects the Tracker's root route. The robot models are loaded by the original interface on demand.
3. The sole JS interface change is a small bridge replacing the original local HTTP `api()` fetch with `window.lamaApi()`, and replacing local output links with browser download links.
4. `py-worker.js` loads Pyodide, Numpy, Shapely, Scipy, NetworkX and the original Trimesh Python library. Its Emscripten filesystem contains the original scripts. Original `lama_server.api_slice` and `lama_server.api_export` use the original `lama_engine.job_slice` and `lama_engine.job_export` implementations.
5. Browser output files are downloaded, rather than written into a user's Windows output folder. No persistent slicing Python server is needed.

## Validation and limitations
- Verified exact ZIP was committed in GitHub; verified all three model JSONs exist (WASP 3 meshes, UR5 station 5, Comau 23).
- Verified browser module entry rewrite parses as JavaScript.
- Verified the **original** `gcode2pdl_arduino.py` locally transforms sample G-code into a PDL file.
- **Not verified:** full live GitHub Pages end-to-end slicing in a real user browser after Pyodide load. This is a work-in-progress deployment; robot output must not be used unverified.
- N1/N2 are tailored to their original geometry families and may refuse other solids; original algorithm restrictions still apply.

## Updating source
To upgrade LAMA, replace `lama-slicer/LAMA_Slicer.zip` with the new original archive, bump the cache version in `index.html`, `sw.js`, `bridge.js` and run functionality tests. Do not substitute the original algorithms with a generic contour/zigzag slicer.

## Project credits and copyright

© 2026–27 **Maria Dumitrache · Rojin Aghaei · Niels Dobroschelski · TU Delft Creative Robotics 26–27 Students.** All rights reserved.

The standalone entry page and the original application's loading splash follow the Pavilion Fabrication Tracker's light, neutral visual style. The original toolpath algorithms, 3D machine models, and exporters are unchanged by this design update.
