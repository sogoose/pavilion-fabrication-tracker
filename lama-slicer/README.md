# LAMA Slicer — independent web workspace

URL: https://sogoose.github.io/pavilion-fabrication-tracker/lama-slicer/

This directory is deliberately independent from the Pavilion Fabrication Tracker homepage. Nothing in this directory is imported by the tracker.

## Original toolpaths, not an approximation

The source application, machine models, original N1/N2 scripts, G-code writers and Comau PDL converter are read from the user's unchanged `LAMA_Slicer.zip` bundle. The installer stores those files in browser Cache Storage and serves them via a service worker under `/lama-slicer/app/`. The original JS application's `/api/...` requests are routed to `bridge.js` and `py-worker.js`. The worker runs Pyodide Python/WebAssembly with numpy, shapely, scipy and trimesh, calling the original `lama_server.api_slice` / `lama_server.api_export` through an in-process adapter (no server, subprocess or Python installed on the visitor's computer). Machine output is downloaded through a cache-backed URL under this path.

## Initial use

1. Open the separate LAMA Slicer URL.
2. Import the original `LAMA_Slicer.zip` from the user's computer once.
3. Launch LAMA Slicer. The first Python initialization needs an internet connection; it downloads Pyodide and scientific Python packages.
4. Select a compatible N1/N2 mesh, slice and export G-code/PDL. Click the Download link in the export panel; browsers cannot write directly to local arbitrary folders.
5. For new LAMA versions, use **Replace ZIP** on the install page.

The original N1/N2 scripts are specifically written for the project's compatible module geometry; they intentionally reject other shapes. Imported G-code is still supported for preview and machine export. This integration does not validate robot kinematics or machine safety. Always verify outputs before physical fabrication.

## Enable automatic setup for the whole team

**Optional one-time deployment:** place the **original, unchanged ZIP** in this GitHub repository at `lama-slicer/LAMA_Slicer.zip`. The installer checks for that file and automatically stores it in each visitor's browser on first visit. This makes manual ZIP selection unnecessary for teammates. Do not extract the ZIP into the tracker root and do not import its large 3D models from the main tracker.

The ZIP is intentionally not committed by the initial text-only GitHub deployment; until you add it, each visitor must select the ZIP once. Local Cache Storage can be cleared by the browser, in which case re-import is required.

## Browser requirements

Recent Chrome, Edge or Firefox; JavaScript, Service Workers, WebAssembly, network access to Pyodide and JSZip CDNs; sufficient memory for models and the Python runtime. Processing stays on the client's machine. 
