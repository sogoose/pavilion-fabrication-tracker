# Pavilion Fabrication Tracker

Shared fabrication / construction tracker for the pavilion project.

## Current build
**V4 · Team Edition**

Features:
- Interactive Rhino 3DM viewer
- Clickable fabrication blocks with selection outline and object label
- Structural status + compression force
- Infill pattern + infill density
- 3D Printing / Rammed Earth distinction
- Machines: WASP, UR5, COMAU, HAND
- Team editing via Supabase
- Updated by / updated at tracking
- Realtime shared updates
- Excel export / import
- Local-mode fallback when Supabase is not configured

## One-time Supabase setup

1. Create or open a Supabase project.
2. Open **SQL Editor** and run `supabase_schema.sql`.
3. Copy the project's **Project URL** and **publishable/anon key**.
4. Put those two values in `config.js`.
5. Never put a `service_role` key in browser code.

The current collaboration mode is link-based: teammates do not need Supabase accounts. Anyone who can open the site can edit the tracker, so do not publish the URL broadly until Auth/RLS is tightened.

## 3D model

The web app looks for `./model.3dm` by default.

The current 3DM file is ~27 MB, so it is not included in this first automated repository setup. Two options:

- Upload `model.3dm` to the repository root manually, or
- Upload it to Supabase Storage / another public static URL and set `modelUrl` in `config.js`.

Until then, every teammate can use **Load 3DM** in the browser and select the same pavilion model locally.

## Local run

On Windows, run:

```
run.bat
```

or from this folder:

```
python -m http.server 8092 --bind 127.0.0.1
```

Then open:

`http://127.0.0.1:8092/index.html?v=4`

## GitHub Pages

A Pages deployment workflow is included. In GitHub, open:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

After that, pushes to `main` deploy automatically.
