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

## Owner-only online editing — setup required

The Workflow page now includes an **Editor login** action. After a verified owner signs in, each expandable process/team has an **EDIT** button (double-click also opens the editor). The form edits titles, team credits, descriptions and external file links, then saves the data to Supabase for everyone to read. Changes never edit the SVG illustrations, arrows, or Rhino Tracker data.

**Important: the front-end is deployed, but the secure database migration and owner grant must be completed before editing will work.** Until then, the original hard-coded Workflow text remains publicly readable.

1. In Supabase Dashboard for project `xjhwzhqiixbombbudlpl`, open **SQL Editor** and run `supabase/migrations/20261019_workflow_owner_editing.sql`. It creates `pavilion_workflow_editors` and `pavilion_workflow_content` with RLS: public reads, owner-only writes.
2. In Supabase **Authentication → URL Configuration**, add `https://sogoose.github.io/pavilion-fabrication-tracker/` (and optionally `https://sogoose.github.io/pavilion-fabrication-tracker/**`) to the redirect allowlist. Ensure email OTP / magic link is enabled.
3. Visit the website, click **Editor login**, enter the owner's email, and follow the sign-in link. The first sign-in creates the Supabase Auth user but **does not grant edit access**.
4. In SQL Editor, run this statement **after the first sign-in**, substituting the owner's actual email:

```sql
insert into public.pavilion_workflow_editors (user_id)
select id from auth.users where lower(email) = lower('YOUR-EMAIL@EXAMPLE.COM')
on conflict (user_id) do nothing;
```

5. Refresh the website while signed in. **EDITOR ACCESS** and **EDIT** buttons should appear. Everyone else sees **READ ONLY** or the ordinary public page. Test with a non-owner account: writing must be rejected by RLS.

**Security:** Do not put a service-role key, editor password, or owner email into `config.js` or public GitHub files. The browser only contains a publishable key. Editor authorization is based on the authenticated Supabase user ID in the server-side membership table, never on a client-side email comparison. A shared link alone does not grant editing access. Existing Tracker edit policies are separate and unchanged by this migration.

**Editor controls:** Once approved and signed in, use **Edit page** beside the main Workflow heading to change the title, introduction, construction-management link, Fabrication/Drying labels, and footer. Open a process or a detached team and click **EDIT** (or double-click the drawing) to change its title, description, participant credits, existing/new file links, and drawing caption where available. Saving writes the Workflow-only record to Supabase; other visitors see the change on refresh. No GitHub commit is required for these text changes, and editing does not grant Tracker privileges or remove its existing anonymous collaboration.

**Editing format:** participant rows use `ROLE | Person · Person`; file rows use `LABEL | https://example.com/...` or `LABEL | #tracker`. Only HTTPS and the internal Tracker shortcut are accepted. A saved section overrides the original markup for all visitors; empty file lists are supported.

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

