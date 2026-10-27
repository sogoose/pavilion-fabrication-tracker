#!/usr/bin/env python
# r: numpy, scipy, shapely, trimesh, rhino3dm
"""weave_slice.py   -   STEP 2 of 3: SLICER (fixed weave infill, variable boundary)

WHAT TO PROVIDE
  INPUT_FILE   the part:  .3dm (Brep, read with rhino3dm) or .stl / .obj      e.g. 'F2.3dm'
  PATTERN_FILE the pattern from step 1 (or Grasshopper input PatternJson)                                         'pattern.json'
WHAT YOU GET
  OUTPUT_FILE  'toolpaths.json'  -> give this file to weave_gcode.py (step 3).
               Every layer: z, height and the ordered paths (external / perimeter / infill / fill),
               in millimetres, in the part's own coordinates (no machine settings in it).

At every layer the real section of the Brep is cut at mid-layer height, the perimeters follow it,
and the FIXED weave centre-lines are clipped to the zone inside the perimeters. Nothing in the
weave changes from layer to layer; only the boundary does. No solid layers are made.

RUN IT
  Python:        python weave_slice.py part.3dm pattern.json toolpaths.json
                 (arguments are optional; otherwise the SETTINGS below are used)
  Rhino 8 / Grasshopper (Script component, Python 3): paste this file. The first line `# r: ...`
                 installs the packages. Add input `Brep` (Item; the part is meshed in Rhino, INPUT_FILE
                 is then ignored) and optionally any SETTINGS name (PATTERN_FILE, LAYER_HEIGHT ...) to
                 override the value here. Wire the pattern component's `PatternJson` output into
                 the input `PatternJson` (then no file is needed; PATTERN_FILE is ignored). Outputs: Paths (polylines at their layer height),
                 PathType, PathLayer (text / layer number per path), Log, ToolpathsJson (text,
                 wire it into weave_gcode.py).
All lengths in the SETTINGS list are MILLIMETRES.
"""

import time as _time
_T0 = _time.time()
_HOST = dict(globals())        # values a host (Grasshopper inputs) injected before this file ran
for _k in list(_HOST):         # accept the input name in any letter case: brep / BREP / Brep
    if _k.lower() == 'brep' and _k != 'Brep' and _HOST.get(_k) is not None and _HOST.get('Brep') is None:
        _HOST['Brep'] = _HOST[_k]

# =====================================================================
#  SETTINGS  -  change them here (or feed same-named inputs from Grasshopper)
# =====================================================================
# ---- files --------------------------------------------------------
INPUT_FILE        = ''                  # .3dm / .stl / .obj of the part
PATTERN_FILE      = 'pattern.json'      # from weave_pattern.py
OUTPUT_FILE       = 'toolpaths.json'    # to weave_gcode.py
PREVIEW_PNG       = ''                  # e.g. 'layers.png' draws a few layers ('' = none)
PREVIEW_LAYERS    = '0,1,10,20,45,-1'   # layer numbers for the preview (-1 = last)

# ---- model ---------------------------------------------------------
MODEL_UNITS_TO_MM = 10.0                # 1 model unit = ? mm (cm model -> 10)
AUTO_FLIP = True                        #     a model that stands plate-up (3 separate lobes at the bottom, the connected plate at the top) is turned 180 deg about X so the print starts at the plate; use the same value in weave_pattern.py

# ---- layers (Prusa: first_layer_height, layer_height) -------------
FIRST_LAYER_HEIGHT = 2.0                # mm
LAYER_HEIGHT       = 3.5                # mm

# ---- widths (Prusa: *_extrusion_width, perimeters) -----------------
FIRST_LAYER_WIDTH        = 7.0          # mm  first_layer_extrusion_width (all paths of layer 1)
EXTERNAL_PERIMETER_WIDTH = 6.0          # mm
PERIMETER_WIDTH          = 5.0          # mm  inner perimeters
PERIMETERS               = 1            #
INFILL_WIDTH             = 6.0          # mm  must equal the bead used in weave_pattern.py
EXTERNAL_PERIMETERS_FIRST = False       #     False: inner perimeters first, outer last (Prusa default)

# ---- seam ---------------------------------------------------------
SEAM            = 'aligned'             # 'aligned' = loops start at the same side / 'nearest' = shortest travel
SEAM_ANGLE      = -90.0                 # deg, which lobe takes the seam of loops that span the whole part (the lobe whose direction from the
SEAM_ARC_OFFSET = 7.0                   # mm  top layers: the seam of each leg-stub piece starts on the stub end, this far from where the line from the part centre through the lobe leaves the piece (counter-clockwise side); 0 = use the end of the concave notch
                                        #      part centre is closest to this angle); loops of one lobe always take the seam at that lobe's tip

SEAM_STACK_TOL  = 0.0                   # mm  0 = off (the seams stay where SEAM_* above put them). >0: closed perimeter loops whose seam drifts from layer to layer get their seam moved to the part of the loop that stays put (within this distance on all layers)
SEAM_TOP_AT_ARC = True                  # top layers (the legs are separate pieces): the wall of each leg starts where its rounded notch facing the triangle ends,
                                        #      on the clockwise side (the same corner on every leg and every layer: the seams stack in a straight line)
SEAM_FIRST_AT_NECK = True               #      first layers (the part is still connected): the outer wall starts at the neck of the SEAM_ANGLE leg
                                        #      (its narrowest cross-section), on the clockwise side of that leg, not at the lobe tip
SEAM_HOLE_AT_NECK = True                #      first layers (the part is still connected through the triangle): the walls of the round holes start on the
                                        #      side that faces the part centre = where the neck loop touches the ring, never on the outer side of the cylinder

# ---- weave clipping -------------------------------------------------
SNAP_DISTANCE   = 4.0                   # mm  where the real boundary moves in, weave parts up to this far outside
                                        #     the allowed zone are slid onto its edge (stay continuous and keep touching
                                        #     the perimeter); parts further out are cut. 0 = only cut.
PLATE_FROM_BOTTOM = True                #     the Brep has a plate that starts above its bottom (only pads under the holes below it): carry the plate down to the bottom, so every layer from the first one has the whole plate (False = slice exactly what the Brep has)
IGNORE_PADS = 10.0                      # %   a separate island of a layer smaller than this % of the layer's largest island (a pad or plug left in a hole, e.g. on top of a leg) is not printed (0 = print everything the Brep has)
OUTLINE_TOLERANCE = 0.02                # mm  layer outlines are simplified by this much (far below a bead; a dense Rhino mesh makes every step slow); 0 = off
MAX_WALL_STEP = 2.0                     # mm  a wall may move at most this far from the wall of the layer below (0 = follow the 3dm exactly).
                                        #     Walls that retreat faster (the cut ends where the arch starts) are held back so each layer sits
                                        #     on the one below; 2.0 means at most 2 mm per layer
NECK_MAX_OVERHANG = 3.0                 # mm  a cut neck may sit at most this far from the layer below (support); beyond it the
NECK_LAYER_STEP = 1                     #     neck loops are printed on every Nth layer only (1 = every layer, 2 = every second layer, 3 = every third ...); the weave lines stay on every layer. Layer 0 always gets them
                                        #     neck is rebuilt from the previous layer's loop
KEEP_NECKS_CLOSED = True                #     a neck loop cut by the boundary stays ONE closed loop = base loop clipped to the allowed
                                        #     zone (straight cut side, softly rounded corners), kept supported by the layer below
INFILL_PERIMETER_OVERLAP = 25.0         # %   the weave lines overlap the perimeter by this much of the infill width (Prusa 'infill/perimeters overlap'): the weave line is moved that much closer to the perimeter, so the two bond (0 = just touching)
INFILL_INFILL_OVERLAP = 25.0            # %   weave lines that touch each other (the connections between the lobes and the legs) overlap by this much of the line width: centres (100 - this) % of the width apart, on every layer incl. the wider first one (0 = use CONTACT_LIKE_FIRST_LAYER below). The petals around the round holes are left as they are
CONTACT_LIKE_FIRST_LAYER = True         # the connections of every layer overlap by the same amount as on the (wider) first layer: touching lines are drawn closer by the width difference (6 mm bead: centres 4.8 mm apart instead of 5.8)
TIGHTEN_CONTACTS = True                 # every layer: weave lines that run side by side a little further apart than a bead are drawn together until they touch (no slits like those the wider first layer hides)
TIGHTEN_BIAS = 0.45                     # mm  the tightening ends about this much closer than asked (smoothing); this is added so the lines end up at the overlap set above
TIGHTEN_RANGE = 8.5                     #     mm centre distance up to which two lines are drawn together
TIGHTEN_PASSES = 3                      #     repeats
CROWN_FILL = True                       # the two layers before the arch opens: the tip of the arch crown cuts narrow slits into the walls (they become round nubs in the walls and the weave); they are filled. False = follow the 3dm
CROWN_MAX_AREA = 50.0                   # mm2  only slits smaller than this are filled
# SIMPLE SINUSOIDAL = ARCH_PULL False (plain weave all the way, no corridor double wall / U-supports); IMPROVED = True.
# For the square-toothed simple look also set AUTO_WAVELENGTH False and WAVELENGTH 27 in weave_pattern.py.
ARCH_PULL = True                        # every layer beneath the arch opening: in each corridor the two weave lines run straight along the two walls (double wall), and under each
                                        #     leg-end wall of the arch one of them makes a narrow U across the corridor (two runs one bead apart = a double-width support);
                                        #     the left line carries the first wall, the right line the second (point symmetric, the same in all three corridors)
ARCH_ENTRY = 14.0                       # mm  the corridor is rebuilt from this far before the first leg-end wall to this far after the second
ARCH_U_OVERLAP = 3.0                    # %   the two rungs of each U overlap by this much of the line width: rung centres (100 - this) % of the width apart (0 = just touching). 50 = 3 mm apart for a 6 mm line: the U is 9 mm wide, still wider than the 6 mm wall it carries
ARCH_U_CLEAR = 16.5                    # mm  clear gap between the two U's of a corridor (edge to edge; 15 - 18 mm asked for). The U's are placed to give this gap
ARCH_U_ANCHOR = 0.5                     # x wall width  the least that must rest on each U: if the gap asked for would leave less of the wall on its U, the U is kept closer to the wall (gap larger)
ARCH_U_FOLLOW = 6.0                     # mm  steep arch (the two leg-end walls of the first layer are closer than ARCH_U_CLEAR, so the U's cannot be moved inward): if the walls of the first two layers of the arch stand at least this far apart (more than a bead), each U gets one rung under each of them (the U follows the walls); 0 = off
ARCH_ROUND = 6.0                        # mm  steep arch: the weave around the corners of the triangular opening is smoothed over about this much line, so it has no sharp tips (0 = off)
NECK_CONTACT = 9.0                      # mm  a gap-filling (neck) loop that leaves a gap of at most this much to the weave next to it over 8 mm or more (typically towards the round hole) is moved against it (0 = off)
ARCH_TRANSITION = 8.0                   # mm  the weave line reaches the wall over this length after it enters the corridor
ARCH_WALL_LAYERS = 3                    #     the leg-end walls of this many layers from the arch opening on are taken as the support line
MIN_OPEN_PATH = 20.0                    # mm  open weave / fill paths shorter than this are not printed (closed loops, and perimeters are always kept; 0 = off)
MIN_PIECE_LENGTH = None                 # mm  drop clipped weave pieces shorter than this (None = one bead width)
ADAPT_CIRCLES = True                    #     True: the weave around each round hole follows the lobe outline of every layer (morphs gradually)
CONTACT_GAP = 8.5                       # mm  two weave lines whose centres are closer than this (but do not touch) are joined: pulled together until they just touch
CONTACT_MARGIN = 0.4                    # mm  distances within this of the touching distance (bead - 0.2) count as touching already
CONTACT_FAR = 40.0                      # mm  only lines that are further than this apart ALONG the curve count as a separate line
CONTACT_LENGTH = 12.0                  # mm  contacts are made head-to-head: the two lines run parallel, touching, over about this length
CONTACT_BLEND = 8.0                     # mm  length of curve over which the correction fades out
WALL_CONTACT_GAP = 3.5                  # mm  a weave line that runs within this distance of a perimeter (not touching it) is pulled onto the perimeter, so every weave line that comes near the perimeter touches it (0 = off)
ADAPT_PULL = 12.0                       # mm  a contact point of the weave is pulled onto the layer outline when it is at most this far from it
ADAPT_NEAR = 4.0                        # mm  weave points this close to the outline (inside a lobe) are also pressed onto it: no small gaps
ADAPT_BLEND = 9.0                       # mm  length of curve over which that pull fades out on both sides of a contact
ADAPT_FADE = 15.0                       # mm  distance outside the lobe over which the morph fades out into the arms
FILL_FIRST_LAYER = False                #     False: no solid fill at all on the first layer (only perimeters + weave)
FILL_MIN_AREA = 100.0                   # mm2  fill islands smaller than this are not filled (the tiny dots left in the middle of a hole on the last layer)
FILL_OUTSIDE_PATTERN = True             #     concentric beads where the layer reaches outside the plate footprint
# =====================================================================

import json
import math
import os
import sys

_NAMES = ['INPUT_FILE', 'PATTERN_FILE', 'OUTPUT_FILE', 'PREVIEW_PNG', 'PREVIEW_LAYERS', 'MODEL_UNITS_TO_MM', 'AUTO_FLIP',
          'FIRST_LAYER_HEIGHT', 'LAYER_HEIGHT', 'FIRST_LAYER_WIDTH', 'EXTERNAL_PERIMETER_WIDTH',
          'PERIMETER_WIDTH', 'PERIMETERS', 'INFILL_WIDTH', 'EXTERNAL_PERIMETERS_FIRST', 'SEAM',
          'SEAM_ANGLE', 'SEAM_ARC_OFFSET', 'SEAM_STACK_TOL', 'CROWN_FILL', 'CROWN_MAX_AREA', 'SEAM_TOP_AT_ARC', 'SEAM_FIRST_AT_NECK', 'SEAM_HOLE_AT_NECK', 'SNAP_DISTANCE', 'KEEP_NECKS_CLOSED', 'ADAPT_CIRCLES', 'CONTACT_GAP', 'CONTACT_MARGIN', 'CONTACT_FAR', 'CONTACT_LENGTH', 'CONTACT_BLEND', 'WALL_CONTACT_GAP', 'ADAPT_PULL', 'ADAPT_NEAR', 'ADAPT_BLEND', 'ADAPT_FADE', 'NECK_MAX_OVERHANG', 'NECK_LAYER_STEP', 'MAX_WALL_STEP', 'OUTLINE_TOLERANCE', 'PLATE_FROM_BOTTOM', 'IGNORE_PADS', 'MIN_PIECE_LENGTH', 'INFILL_PERIMETER_OVERLAP', 'INFILL_INFILL_OVERLAP', 'CONTACT_LIKE_FIRST_LAYER', 'TIGHTEN_CONTACTS', 'TIGHTEN_BIAS', 'TIGHTEN_RANGE', 'TIGHTEN_PASSES', 'ARCH_PULL', 'ARCH_WALL_LAYERS', 'ARCH_ENTRY', 'ARCH_TRANSITION', 'NECK_CONTACT', 'ARCH_U_FOLLOW', 'ARCH_ROUND', 'ARCH_U_OVERLAP', 'ARCH_U_CLEAR', 'ARCH_U_ANCHOR', 'MIN_OPEN_PATH', 'FILL_FIRST_LAYER', 'FILL_MIN_AREA', 'FILL_OUTSIDE_PATTERN']


def get_settings(argv):
    g = globals()
    S = {}
    for n in _NAMES:
        v = _HOST.get(n)                   # Grasshopper input of the same name wins when it is connected
        S[n] = g[n] if v is None else v
    if len(argv) > 0:
        S['INPUT_FILE'] = argv[0]
    if len(argv) > 1:
        S['PATTERN_FILE'] = argv[1]
    if len(argv) > 2:
        S['OUTPUT_FILE'] = argv[2]
    return S


try:
    import Rhino
    import Rhino.Geometry as rg
    HAVE_RHINO = True
except ImportError:
    HAVE_RHINO = False

import numpy as np
import trimesh
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import unary_union, polygonize, linemerge


# ---------------------------------------------------------------- mesh / section
def load_mesh(path, scale):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.3dm':
        import rhino3dm as r
        f = r.File3dm.Read(path)
        V, F = [], []
        zb0, zb1 = None, None
        for o in f.Objects:
            g = o.Geometry
            if not isinstance(g, r.Brep):
                continue
            bb_ = g.GetBoundingBox()
            zb0 = bb_.Min.Z if zb0 is None else min(zb0, bb_.Min.Z)
            zb1 = bb_.Max.Z if zb1 is None else max(zb1, bb_.Max.Z)
            for i in range(len(g.Faces)):
                me = g.Faces[i].GetMesh(r.MeshType.Render) or g.Faces[i].GetMesh(r.MeshType.Any)
                if me is None:
                    continue
                base = len(V)
                for k in range(len(me.Vertices)):
                    v = me.Vertices[k]
                    V.append((v.X, v.Y, v.Z))
                for k in range(len(me.Faces)):
                    q = me.Faces[k]
                    F.append((base + q[0], base + q[1], base + q[2]))
                    if q[2] != q[3]:
                        F.append((base + q[0], base + q[2], base + q[3]))
        if not F:
            raise ValueError('No Brep found in the 3dm file.')
        tm = trimesh.Trimesh(vertices=V, faces=F, process=False)
    else:
        tm = trimesh.load(path, force='mesh')
    tm.merge_vertices()
    tm.vertices = tm.vertices * scale          # -> mm
    if ext == '.3dm' and zb0 is not None:
        tm._brep_z = (zb0 * scale, zb1 * scale)
    return tm


def auto_flip(tm, S, unit=1.0):
    """AUTO_FLIP: the part is printed plate first.  A model that stands the other way up (3 separate lobes at the bottom,
    the connected plate at the top) is turned 180 degrees about the X axis (x, -y, -z; same z range)."""
    if not S.get('AUTO_FLIP'):
        return tm
    import trimesh
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union, polygonize
    def islands(z):
        seg = trimesh.intersections.mesh_plane(tm, [0, 0, 1], [0, 0, z])
        if len(seg) == 0:
            return 0
        tol = 1e-2
        q = lambda p: (round(p[0] / tol) * tol, round(p[1] / tol) * tol)
        lines = [LineString([q(s[0][:2]), q(s[1][:2])]) for s in seg]
        lines = [l for l in lines if l.length > 0]
        res = None
        for p in polygonize(unary_union(lines)):
            f = Polygon(p.exterior)
            res = f if res is None else res.symmetric_difference(f)
        if res is None or res.is_empty:
            return 0
        polys = list(res.geoms) if res.geom_type == 'MultiPolygon' else [res]
        big = max(p.area for p in polys)
        return len([p for p in polys if p.area >= 0.01 * big])
    z0, z1 = tm.bounds[0][2], tm.bounds[1][2]
    try:
        nb, nt = islands(z0 + 0.5 / unit), islands(z1 - 0.5 / unit)
    except Exception:
        return tm
    if nb >= 2 and nt == 1:
        v = tm.vertices.copy()
        v[:, 1] = -v[:, 1]
        v[:, 2] = z0 + z1 - v[:, 2]
        tm.vertices = v
        tm._flipped = True
    return tm


def to_brep(g):
    if isinstance(g, (list, tuple)):
        parts = [to_brep(x) for x in g if x is not None]
        if len(parts) == 1:
            return parts[0]
        j = rg.Brep.JoinBreps(parts, 0.001)
        if not j or len(j) != 1:
            raise ValueError('Give ONE Brep (or Breps that join into one).')
        return j[0]
    if isinstance(g, rg.Brep):
        return g
    if hasattr(g, 'ToBrep'):
        return g.ToBrep()
    import rhinoscriptsyntax as rs
    b = rs.coercebrep(g)
    if b is None:
        raise ValueError('Cannot read the Brep input (%s).' % type(g).__name__)
    return b


def mesh_from_brep(brep, scale):
    brep = to_brep(brep)
    ms = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.QualityRenderMesh)
    if not ms:
        raise ValueError('Could not mesh the Brep.')
    m = rg.Mesh()
    for x in ms:
        m.Append(x)
    bb = brep.GetBoundingBox(True)
    zb = (bb.Min.Z * scale, bb.Max.Z * scale)
    mb = m.GetBoundingBox(True)
    if (bb.Max.Z - mb.Max.Z) * scale > 1.0 or (mb.Min.Z - bb.Min.Z) * scale > 1.0:      # faces missing from the mesh (e.g. the top): mesh every face on its own
        for i_ in range(brep.Faces.Count):
            try:
                fm = rg.Mesh.CreateFromBrep(brep.Faces[i_].DuplicateFace(False), rg.MeshingParameters.QualityRenderMesh)
            except Exception:
                fm = None
            for x in (fm or []):
                m.Append(x)
    m.Faces.ConvertQuadsToTriangles()
    V = [(m.Vertices[i].X, m.Vertices[i].Y, m.Vertices[i].Z) for i in range(m.Vertices.Count)]
    F = [(m.Faces[i].A, m.Faces[i].B, m.Faces[i].C) for i in range(m.Faces.Count)]
    tm = trimesh.Trimesh(vertices=V, faces=F, process=False)
    tm.merge_vertices()
    tm.vertices = tm.vertices * scale
    tm._brep_z = zb
    return tm


def section(tm, z, tol=1e-2, simplify=0.0):
    """even-odd section polygon(s) at z (robust for meshes that are not watertight)."""
    seg = trimesh.intersections.mesh_plane(tm, [0, 0, 1], [0, 0, z])
    if len(seg) == 0:
        return None
    import shapely
    xy = np.rint(np.asarray(seg, dtype=float)[:, :, :2] / tol) * tol          # snap to the tolerance grid
    xy = xy[np.hypot(xy[:, 1, 0] - xy[:, 0, 0], xy[:, 1, 1] - xy[:, 0, 1]) > 0]
    lines = list(shapely.linestrings(xy)) if len(xy) else []
    res = None
    for p in polygonize(unary_union(lines)):
        f = Polygon(p.exterior)
        res = f if res is None else res.symmetric_difference(f)
    if res is None or res.is_empty:
        return None
    res = res.buffer(0)
    if simplify > 0:
        res = res.simplify(simplify, preserve_topology=True)
    return res


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == 'LineString':
        return [g]
    out = []
    for p in getattr(g, 'geoms', []):
        out.extend(lines_of(p))
    return out


def rings_of(g):
    out = []
    for p in polys_of(g):
        out.append(list(p.exterior.coords))
        for i in p.interiors:
            out.append(list(i.coords))
    return out


def concentric(poly, spacing, first):
    out = []
    d = first
    while True:
        g = poly.buffer(-d, 32)
        if g.is_empty:
            break
        out.extend(rings_of(g))
        d += spacing
    return out


# ---------------------------------------------------------------- fast distances
_TREES = {}


def _seg_tree(g):
    """(segments, KD-tree over the segment midpoints) of a (multi)line geometry, cut into pieces of at most 1 mm; cached per geometry object."""
    import shapely
    from scipy.spatial import cKDTree
    k = id(g)
    if k not in _TREES or _TREES[k][0] is not g:
        if len(_TREES) > 48:
            _TREES.clear()
        segs = []
        for p in shapely.get_parts(g):
            p = shapely.segmentize(p, 1.0)
            c = shapely.get_coordinates(p)
            if len(c) >= 2:
                segs.append(np.stack([c[:-1], c[1:]], axis=1))
        if segs:
            sg = np.concatenate(segs)
            tree = (sg, cKDTree((sg[:, 0] + sg[:, 1]) / 2.0))
        else:
            tree = None
        _TREES[k] = (g, tree)
    return _TREES[k][1]


def line_dist(g, xy):
    """distance from every point of xy (n x 2) to the line geometry g (same values as shapely.distance, but indexed)."""
    import shapely
    xy = np.asarray(xy, dtype=float)[:, :2]
    tree = _seg_tree(g)
    if tree is None or len(xy) == 0:
        return shapely.distance(g, shapely.points(xy))
    sg, kd = tree
    kk = min(8, len(sg))
    _, ci = kd.query(xy, k=kk)
    ci = ci.reshape(len(xy), kk)
    A, B = sg[ci, 0], sg[ci, 1]
    d = B - A
    L2 = (d ** 2).sum(2)
    u = np.clip(((xy[:, None, :] - A) * d).sum(2) / np.maximum(L2, 1e-18), 0.0, 1.0)
    q = A + u[..., None] * d
    r = xy[:, None, :] - q
    return np.sqrt((r ** 2).sum(2)).min(axis=1)


def snap_clip(pts, closed, zone, snap, min_piece):
    """Keep the weave continuous where the real boundary moves: a point outside the zone by up to
    `snap` mm is slid onto the zone edge (so the bead keeps touching the perimeter); a point further
    out is cut away. Returns [(points, closed)]."""
    import shapely
    arr = np.array(pts, dtype=float)
    zb_ = zone.boundary
    d = np.where(shapely.contains_xy(zone, arr[:, 0], arr[:, 1]), 0.0, line_dist(zb_, arr))
    inside = d <= 1e-9
    keep = d <= snap
    bd = zb_
    out = arr.copy()
    mv = np.where(keep & ~inside)[0]
    if len(mv):                                                    # slide those points onto the nearest point of the zone edge
        out[mv] = shapely.get_coordinates(shapely.get_point(shapely.shortest_line(bd, shapely.points(arr[mv])), 0))
    n = len(out)
    if keep.all():
        L = [tuple(p) for p in out]
        return [(L + [L[0]], True)] if closed else [(L, False)]
    # split into runs of kept points
    runs, cur = [], []
    start = 0
    if closed:
        # begin right after a cut point so no run wraps around
        start = int(np.where(~keep)[0][0]) + 1
    idx = [(start + k) % n for k in range(n)] if closed else list(range(n))
    for i in idx:
        if keep[i]:
            cur.append(tuple(out[i]))
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    res = []
    for r in runs:
        if len(r) < 2:
            continue
        ln = sum(math.hypot(r[k + 1][0] - r[k][0], r[k + 1][1] - r[k][1]) for k in range(len(r) - 1))
        if ln >= min_piece:
            res.append((r, False))
    return res


def clip_neck(base_poly, region, bead):
    """Neck loop cut by the boundary: the base loop is intersected with `region` (the allowed zone minus
    the space taken by the other beads), so it keeps its shape and only the corners that meet the
    perimeter are chamfered (rounded, radius ~0.3 bead). Returns closed point lists."""
    z2 = region
    if base_poly is None or base_poly.is_empty or z2.is_empty:
        return []
    r = 0.3 * bead
    g = base_poly.intersection(z2)
    g = g.buffer(-r, 16).buffer(r, 16).buffer(r, 16).buffer(-r, 16)   # round new corners (radius ~0.3 bead)
    out = []
    for pp in polys_of(g):
        if pp.area < bead * bead:
            continue
        pp = pp.simplify(0.03)
        out.append([tuple(c) for c in pp.exterior.coords])
    return out


def max_gap(loop, prev_loops):
    """largest distance from the loop's points to the previous layer's loops (support check)."""
    if not prev_loops:
        return 0.0
    import shapely
    pl = unary_union([LineString(p) for p in prev_loops])
    pts = shapely.points(np.array(loop, dtype=float))
    return float(shapely.distance(pl, pts).max())


def _neck_pick(arr, pc, ux, uy, L):
    """narrowest cross-section of the leg between the lobe and the arm; returns (segment index, point) on the clockwise side"""
    vx, vy = uy, -ux                                       # clockwise side of the leg axis
    s_ = (arr[:, 0] - pc[0]) * ux + (arr[:, 1] - pc[1]) * uy
    t_ = (arr[:, 0] - pc[0]) * vx + (arr[:, 1] - pc[1]) * vy
    s2, t2 = np.roll(s_, -1), np.roll(t_, -1)
    ss = np.arange(L - 80.0, L - 4.0, 1.0)
    W = np.full(len(ss), np.nan)
    hit = [None] * len(ss)
    for k, sv in enumerate(ss):
        c = ((s_ - sv) * (s2 - sv) <= 0) & (s_ != s2)
        if not c.any():
            continue
        j = np.nonzero(c)[0]
        tt = t_[j] + (sv - s_[j]) / (s2[j] - s_[j]) * (t2[j] - t_[j])
        if not ((tt > 0).any() and (tt <= 0).any()):
            continue
        ip = int(np.argmin(np.where(tt > 0, tt, np.inf)))
        W[k] = tt[ip] - tt[tt <= 0].max()
        hit[k] = (int(j[ip]), float(tt[ip]))
    ok = np.isfinite(W)
    if ok.sum() < 5:
        return None
    Ws = np.where(ok, W, np.nan)
    sm = np.array([np.nanmean(Ws[max(0, i - 3):i + 4]) for i in range(len(ss))])
    k = int(np.nanargmin(np.where(ok, sm, np.inf)))
    if hit[k] is None:
        return None
    j, tp = hit[k]
    return j, (pc[0] + ss[k] * ux + tp * vx, pc[1] + ss[k] * uy + tp * vy)


def _arc_pick(arr, pc, jj):
    """vertex where the concave notch (the fillet that faces the triangle) ends on the clockwise side; jj = segment where the inward ray crosses"""
    n = len(arr)
    a = arr - np.roll(arr, 1, axis=0)
    b = np.roll(arr, -1, axis=0) - arr
    na, nb = np.hypot(a[:, 0], a[:, 1]), np.hypot(b[:, 0], b[:, 1])
    sn = (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / np.maximum(na * nb, 1e-12)
    area = 0.5 * float(np.sum(arr[:, 0] * np.roll(arr[:, 1], -1) - np.roll(arr[:, 0], -1) * arr[:, 1]))
    conc = sn * (1.0 if area > 0 else -1.0) < -0.017       # turning against the loop direction by more than 1 degree
    if not conc.any() or conc.all():
        return None
    i0 = None
    for off in range(0, 8):
        for cand in ((jj + 1 + off) % n, (jj - off) % n):
            if conc[cand]:
                i0 = cand
                break
        if i0 is not None:
            break
    if i0 is None:
        return None
    d = arr[(i0 + 1) % n] - arr[i0]
    r = arr[i0] - np.asarray(pc)
    step = 1 if (d[0] * r[1] - d[1] * r[0]) >= 0 else -1  # towards the clockwise side about the part centre
    last, i, flat = i0, i0, 0.0
    for _ in range(n):
        j = (i + step) % n
        seg = nb[i] if step == 1 else na[i]
        if conc[j]:
            last, flat = j, 0.0
        else:
            flat += seg
            if flat > 3.0:
                break
        i = j
    return last


def _tip_seam(body, S, inward=False):
    """start the loop where the ray from the part centre through its lobe centre leaves it (the lobe tip).
    The ray is the same on every layer, so the seams of all layers stack in one straight vertical line.
    Returns the rotated body, or None when the loop is not crossed by that ray."""
    hc, pc = S.get('_SEAM_HOLES'), S.get('_SEAM_C')
    if not hc or pc is None or len(body) < 4:
        return None
    arr = np.asarray(body, dtype=float)
    n = len(arr)
    cx, cy = arr[:, 0].sum() / n, arr[:, 1].sum() / n
    avg = sum(math.hypot(h[0] - pc[0], h[1] - pc[1]) for h in hc) / len(hc)
    nxt = np.roll(arr, -1, axis=0)

    def inside_pt(h):                                     # even-odd test, vectorised
        c = ((arr[:, 1] > h[1]) != (nxt[:, 1] > h[1]))
        t = (h[1] - arr[:, 1]) / np.where(nxt[:, 1] == arr[:, 1], 1.0, nxt[:, 1] - arr[:, 1])
        return int(np.count_nonzero(c & (h[0] < arr[:, 0] + t * (nxt[:, 0] - arr[:, 0])))) % 2 == 1
    n_inside = sum(1 for h in hc if inside_pt(h))
    if math.hypot(cx - pc[0], cy - pc[1]) < 0.5 * avg or n_inside > 1:
        a = math.radians(S['SEAM_ANGLE'])
        tgt = max(hc, key=lambda h: (h[0] - pc[0]) * math.cos(a) + (h[1] - pc[1]) * math.sin(a)
                  - 1e-6 * math.hypot(h[0] - pc[0], h[1] - pc[1]))
    else:
        tgt = min(hc, key=lambda h: math.hypot(h[0] - cx, h[1] - cy))
    ux, uy = tgt[0] - pc[0], tgt[1] - pc[1]
    L = math.hypot(ux, uy)
    if L < 1e-9:
        return None
    ux, uy = ux / L, uy / L
    if inward == 'neck':
        pk = _neck_pick(arr, pc, ux, uy, L)
        if pk is not None:
            jj, p0 = pk
            return [(float(p0[0]), float(p0[1]))] + body[jj + 1:] + body[:jj + 1]
        inward = False
    s1 = ux * (arr[:, 1] - pc[1]) - uy * (arr[:, 0] - pc[0])
    s2 = np.roll(s1, -1)
    ok = (s1 != s2) & (s1 * s2 <= 0)
    if not ok.any():
        return None
    j = np.nonzero(ok)[0]
    t = s1[j] / (s1[j] - s2[j])
    px = arr[j, 0] + (nxt[j, 0] - arr[j, 0]) * t
    py = arr[j, 1] + (nxt[j, 1] - arr[j, 1]) * t
    al = (px - pc[0]) * ux + (py - pc[1]) * uy
    al = np.where(al > 0, al, -np.inf)
    if inward:                                            # the crossing on the part-centre side of the lobe centre (closest to it)
        al_in = np.where(al < L, al, -np.inf)
        if np.isfinite(al_in).any():
            al = al_in
    k = int(al.argmax())
    if not np.isfinite(al[k]):
        return None
    jj = int(j[k])
    if inward == 'arc':
        off = S['SEAM_ARC_OFFSET']
        if off > 0:                                        # start the seam on the stub end: where the inward ray leaves the loop, moved on by `off` mm to the counter-clockwise side of the lobe
            vx, vy = uy, -ux                                # inward axis turned 90 degrees counter-clockwise
            tg = nxt[jj] - arr[jj]
            fwd = (tg[0] * vx + tg[1] * vy) >= 0
            segl = np.hypot(nxt[:, 0] - arr[:, 0], nxt[:, 1] - arr[:, 1])
            rem = float(off)
            cx_, cy_ = float(px[k]), float(py[k])
            i_ = jj
            if fwd:
                while True:
                    ex, ey = nxt[i_]
                    dd = math.hypot(ex - cx_, ey - cy_)
                    if dd >= rem:
                        t_ = rem / dd if dd > 0 else 0.0
                        cx_, cy_ = cx_ + (ex - cx_) * t_, cy_ + (ey - cy_) * t_
                        break
                    rem -= dd
                    cx_, cy_ = float(ex), float(ey)
                    i_ = (i_ + 1) % n
                return [(cx_, cy_)] + body[(i_ + 1) % n:] + body[:(i_ + 1) % n]
            else:
                while True:
                    ex, ey = arr[i_]
                    dd = math.hypot(ex - cx_, ey - cy_)
                    if dd >= rem:
                        t_ = rem / dd if dd > 0 else 0.0
                        cx_, cy_ = cx_ + (ex - cx_) * t_, cy_ + (ey - cy_) * t_
                        break
                    rem -= dd
                    cx_, cy_ = float(ex), float(ey)
                    i_ = (i_ - 1) % n
                return [(cx_, cy_)] + body[i_ + 1:] + body[:i_ + 1]
        va = _arc_pick(arr, pc, jj)
        if va is not None:
            return body[va:] + body[:va]
    return [(float(px[k]), float(py[k]))] + body[jj + 1:] + body[:jj + 1]


def seam_rotate(ring, S, inward=False):
    body = ring[:-1] if ring[0] == ring[-1] else list(ring)
    if S['SEAM'] == 'aligned':
        tb = _tip_seam(body, S, inward)
        if tb is not None:
            return tb + [tb[0]]
        a = math.radians(S['SEAM_ANGLE'])
        ux, uy = math.cos(a), math.sin(a)
        arr = np.asarray(body, dtype=float)
        proj = (arr[:, 0] - arr[:, 0].sum() / len(body)) * ux + (arr[:, 1] - arr[:, 1].sum() / len(body)) * uy
        k = int(proj.argmax())
        body = body[k:] + body[:k]
    return body + [body[0]]


def order(pieces, start, S, inward=False):
    """pieces: (pts, closed, kind). Greedy nearest-first; open pieces may be reversed."""
    rem = list(pieces)
    if S['SEAM'] == 'aligned':                       # the seam of every loop is found once, not on every pass
        rem = [(seam_rotate(p_, S, inward), c_, k_) if c_ else (p_, c_, k_) for p_, c_, k_ in rem]
    out = []
    cur = start
    while rem:
        best = None
        for i, (pts, closed, kind) in enumerate(rem):
            if closed and S['SEAM'] == 'aligned':
                p0 = pts[0]
                cand = (math.hypot(p0[0] - cur[0], p0[1] - cur[1]), i, 0, False)
            elif closed:
                k = min(range(len(pts)), key=lambda j: (pts[j][0] - cur[0]) ** 2 + (pts[j][1] - cur[1]) ** 2)
                cand = (math.hypot(pts[k][0] - cur[0], pts[k][1] - cur[1]), i, k, False)
            else:
                d0 = math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1])
                d1 = math.hypot(pts[-1][0] - cur[0], pts[-1][1] - cur[1])
                cand = (d0, i, 0, False) if d0 <= d1 else (d1, i, 0, True)
            if best is None or cand[0] < best[0]:
                best = cand
        d, i, k, rev = best
        pts, closed, kind = rem.pop(i)
        if closed:
            if S['SEAM'] == 'aligned':
                pass                                  # already rotated above
            else:
                body = pts[:-1] if pts[0] == pts[-1] else pts
                body = body[k:] + body[:k]
                pts = body + [body[0]]
        elif rev:
            pts = pts[::-1]
        out.append((pts, closed, kind))
        cur = pts[-1]
    return out, cur


# ---------------------------------------------------------------- main
def _ring_reach(zone, c, r_in, r_cap, angles):
    """distance from c to the zone edge along each angle, starting at the hole ring r_in (capped at r_cap)."""
    import shapely
    out = []
    us = [(math.cos(a), math.sin(a)) for a in angles]
    segs = shapely.linestrings([[(c[0] + r_in * u[0], c[1] + r_in * u[1]), (c[0] + r_cap * u[0], c[1] + r_cap * u[1])] for u in us])
    zc_ = shapely.clip_by_rect(zone, c[0] - r_cap - 2.0, c[1] - r_cap - 2.0, c[0] + r_cap + 2.0, c[1] + r_cap + 2.0)      # only the part of the zone around the hole matters
    its = shapely.intersection(zc_, segs)
    for a, u, it in zip(angles, us, its):
        if it.is_empty:
            out.append(r_in)
            continue
        geoms = list(it.geoms) if hasattr(it, 'geoms') else [it]
        ro = r_in
        for g in geoms:
            if g.geom_type != 'LineString' or g.is_empty:
                continue
            d0 = math.hypot(g.coords[0][0] - c[0], g.coords[0][1] - c[1])
            d1 = math.hypot(g.coords[-1][0] - c[0], g.coords[-1][1] - c[1])
            lo, hi = min(d0, d1), max(d0, d1)
            if lo <= r_in + 0.05:
                ro = max(ro, hi)
        out.append(ro)
    return out


def _smooth_circ(v, k=3):
    n = len(v)
    return [sum(v[(i + j) % n] for j in range(-k, k + 1)) / (2.0 * k + 1) for i in range(n)]


def lobe_setup(ref_zone, holes, r_in_extra):
    """per round hole: centre, r_in, r_cap and the reference reach profile."""
    N = 120
    angles = [2 * math.pi * i / N for i in range(N)]
    lobes = []
    for h in holes:
        poly = Polygon(h)
        c = (poly.centroid.x, poly.centroid.y)
        rh = math.sqrt(poly.area / math.pi)
        r_in = rh + r_in_extra
        far = ref_zone.bounds
        big = 4.0 * max(far[2] - far[0], far[3] - far[1])
        prof = _ring_reach(ref_zone, c, r_in, big, angles)
        r_cap = 1.05 * sorted(prof)[len(prof) // 2]
        prof = _smooth_circ([min(x, r_cap) for x in prof], 3)
        lobes.append(dict(c=c, r_in=r_in, r_cap=r_cap, ref=prof, angles=angles))
    return lobes


def contact_flags(pts, lobes, ref_zone0, tol=0.4):
    """indices of the weave points that touch the reference outline (the contact plateaus) inside a lobe region."""
    from shapely.geometry import Point
    b = ref_zone0.boundary
    idx = []
    for i, (x, y) in enumerate(pts):
        near = False
        for lb in lobes:
            if math.hypot(x - lb['c'][0], y - lb['c'][1]) <= lb['r_cap'] + 1.0:
                near = True
                break
        if near and Point(x, y).distance(b) <= tol:
            idx.append(i)
    return idx


def pull_contacts(orig, warped, flags, zone, pull, blend, near=0.0, lobes=()):
    orig_flags = list(flags)
    """move every contact point onto the outline of this layer (nearest point), fade the move out along the curve,
    so each peak/plateau touches the perimeter again after the morph."""
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    n = len(warped)
    if (not flags and near <= 0) or zone.is_empty:
        return warped
    zb = zone.boundary
    flags = set(flags)
    if near > 0:                                    # also every point that already almost touches the outline inside a lobe
        cand_ = []
        for i, (x, y) in enumerate(warped):
            if i in flags:
                continue
            for lb in lobes:
                if math.hypot(x - lb['c'][0], y - lb['c'][1]) <= lb['r_cap'] + 1.0:
                    cand_.append(i)
                    break
        if cand_:
            dd_ = line_dist(zb, np.asarray([warped[i] for i in cand_], dtype=float))
            flags.update(i for i, d_ in zip(cand_, dd_) if d_ <= near)
    disp = {}
    ref_flags = set(orig_flags)
    import shapely
    fl_ = sorted(flags)
    if fl_:
        pa_ = np.asarray([warped[i] for i in fl_], dtype=float)
        qa_ = shapely.get_coordinates(shapely.get_point(shapely.shortest_line(zb, shapely.points(pa_)), 0))
    for ii_, i in enumerate(fl_):
        p = Point(warped[i])
        q = Point(qa_[ii_][0], qa_[ii_][1])
        d = math.hypot(q.x - p.x, q.y - p.y)
        if i not in ref_flags and any(math.hypot(q.x - lb['c'][0], q.y - lb['c'][1]) <= lb['r_in'] + 1.0 for lb in lobes):
            continue          # an 'almost touching' point is never flattened onto the hole wall (that would make a second ring)
        if d <= pull:
            disp[i] = (q.x - p.x, q.y - p.y)
    if not disp:
        return warped
    seg = [math.hypot(warped[(i + 1) % n][0] - warped[i][0], warped[(i + 1) % n][1] - warped[i][1]) for i in range(n)]
    INF = 1e18
    back = [INF] * n          # arc distance to the nearest contact behind
    src_b = [None] * n
    fwd = [INF] * n
    src_f = [None] * n
    for rep in range(2):
        for i in range(n):
            if i in disp:
                back[i], src_b[i] = 0.0, i
            else:
                pj = (i - 1) % n
                if back[pj] < INF:
                    back[i], src_b[i] = back[pj] + seg[pj], src_b[pj]
        for i in range(n - 1, -1, -1):
            if i in disp:
                fwd[i], src_f[i] = 0.0, i
            else:
                nj = (i + 1) % n
                if fwd[nj] < INF:
                    fwd[i], src_f[i] = fwd[nj] + seg[i], src_f[nj]
    out = []
    for i in range(n):
        if i in disp:
            d = disp[i]
        else:
            db, df = back[i], fwd[i]
            if min(db, df) >= blend:
                out.append(warped[i])
                continue
            if db <= df:
                w, d0 = 1.0 - db / blend, disp[src_b[i]]
            else:
                w, d0 = 1.0 - df / blend, disp[src_f[i]]
            d = (d0[0] * w, d0[1] * w)
        out.append((warped[i][0] + d[0], warped[i][1] + d[1]))
    return out


def spread_open(pts, closed, disp, blend):
    """add the displacements in disp {index: (dx, dy)} and fade them out along the curve (open or closed)."""
    n = len(pts)
    seg = [math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]) for i in range(n)]
    INF = 1e18
    back, src_b, fwd, src_f = [INF] * n, [None] * n, [INF] * n, [None] * n
    for rep in range(2 if closed else 1):
        for i in range(n):
            if i in disp:
                back[i], src_b[i] = 0.0, i
            elif closed or i > 0:
                pj = (i - 1) % n
                if back[pj] < INF:
                    back[i], src_b[i] = back[pj] + seg[pj], src_b[pj]
        for i in range(n - 1, -1, -1):
            if i in disp:
                fwd[i], src_f[i] = 0.0, i
            elif closed or i < n - 1:
                nj = (i + 1) % n
                if fwd[nj] < INF:
                    fwd[i], src_f[i] = fwd[nj] + seg[i], src_f[nj]
    out = []
    for i in range(n):
        if i in disp:
            d = disp[i]
        else:
            db, df = back[i], fwd[i]
            if min(db, df) >= blend:
                out.append(pts[i])
                continue
            if db <= df:
                w, d0 = 1.0 - db / blend, disp[src_b[i]]
            else:
                w, d0 = 1.0 - df / blend, disp[src_f[i]]
            d = (d0[0] * w, d0[1] * w)
        out.append((pts[i][0] + d[0], pts[i][1] + d[1]))
    return out


def arch_corridors(sec, layers, zmin, wext, S):
    """the leg-end walls of the arch: the walls the first layers of the opening add (they cross a corridor between two lobes). Each corridor is
    described by its two facing leg-end walls: direction u along the walls, normal n, the n-positions of the two walls and the span along u."""
    import numpy as np
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    open_at = None
    for li_, (zb_, zt_) in enumerate(layers):
        P_ = sec(zmin + (zb_ + zt_) / 2.0)
        if P_ is None or P_.is_empty:
            continue
        tri_ = False
        for pp_ in polys_of(P_):
            for i_ in pp_.interiors:
                pa_ = Polygon(i_)
                if i_.length > 0 and 4 * math.pi * pa_.area / (i_.length ** 2) < 0.9:
                    tri_ = True
        if li_ > 0 and not tri_:
            open_at = li_
            break
    if open_at is None:
        return None, []
    import numpy as np
    Pq = sec(zmin + (layers[open_at - 1][0] + layers[open_at - 1][1]) / 2.0)
    body = Pq.buffer(-wext, 16) if Pq is not None else Polygon()
    nlegs = len(S.get('_SEAM_HOLES') or []) or 3
    win = list(range(open_at, min(len(layers), open_at + int(S['ARCH_WALL_LAYERS']))))
    wl_lines = {}
    for l_ in win:
        Pc = sec(zmin + (layers[l_][0] + layers[l_][1]) / 2.0)
        Pp = sec(zmin + (layers[l_ - 1][0] + layers[l_ - 1][1]) / 2.0)
        if Pc is None or Pp is None or Pc.is_empty or Pp.is_empty:
            continue
        new_ = Pc.buffer(-wext / 2.0, 16).boundary.difference(Pp.buffer(-wext / 2.0 + 0.0, 16).boundary.buffer(wext + 1.0, 8))
        wl_lines[l_] = [ln for ln in lines_of(new_) if ln.length >= 8.0]
    corr = []
    # 1) the walls of the layers of the window together (the arch opens at once: the walls are the same on all of them)
    lines = [ln for l_ in win for ln in wl_lines.get(l_, [])]
    if lines:
        corr = _arch_pairs(lines, unary_union(lines), 9.0, body)
    # 2) the arch opens gradually (the walls move from layer to layer, the first ones can be only ~14 mm apart): layer by layer from the first one, smaller grouping distance,
    #    the first layers that make pairs give the support line
    if not (0 < len(corr) <= nlegs):
        corr = []
        lines = []
        for l_ in win:
            lines += wl_lines.get(l_, [])
            if not lines:
                continue
            uni = unary_union(lines)
            for gbuf in (9.0, 6.0, 4.0):
                corr = _arch_pairs(lines, uni, gbuf, body)
                if corr:
                    break
            if corr:
                break
    ctr_ = np.array(body.centroid.coords[0]) if not body.is_empty else None
    for cr in corr:
        cr['ctr'] = ctr_
    for cr in corr:                                          # n-positions of the leg-end walls of the first two layers of the arch (left, right) = what the S-sides must stand under
        cr['wl'] = []
        tm_ = 0.5 * (cr['t0'] + cr['t1'])
        for l_ in (open_at, open_at + 1):
            if l_ >= len(layers):
                continue
            Pc = sec(zmin + (layers[l_][0] + layers[l_][1]) / 2.0)
            if Pc is None or Pc.is_empty:
                continue
            sv_ = []
            for ln in lines_of(Pc.buffer(-wext / 2.0, 16).boundary):
                for k_ in range(int(ln.length / 1.0) + 1):
                    c_ = np.array(ln.interpolate(min(k_ * 1.0, ln.length)).coords[0])
                    tt_, ss_ = float((c_ - cr['o']) @ cr['u']), float((c_ - cr['o']) @ cr['n'])
                    if abs(tt_ - tm_) <= 6.0 and abs(ss_) <= 45.0:
                        sv_.append(ss_)
            Lv_ = [v for v in sv_ if v < 0]
            Rv_ = [v for v in sv_ if v >= 0]
            if len(Lv_) >= 2 and len(Rv_) >= 2:
                cr['wl'].append((float(np.median(Lv_)), float(np.median(Rv_))))
    return open_at, corr


def _arch_pairs(lines, uni, gbuf, body):
    import numpy as np
    from shapely.geometry import LineString, Point
    comps = []
    for g_ in polys_of(uni.buffer(gbuf, 8)):
        pts_ = [c_ for ln in lines if ln.intersects(g_) for c_ in ln.coords]
        if len(pts_) < 2:
            continue
        A = np.array(pts_, float)
        c0 = A.mean(axis=0)
        w_, v_ = np.linalg.eigh(np.cov((A - c0).T))
        u = v_[:, 1]
        if u[0] < 0 or (abs(u[0]) < 1e-9 and u[1] < 0):
            u = -u
        ext = np.ptp((A - c0) @ u)
        if ext < 12.0 or w_[1] < 4 * max(w_[0], 1e-9):               # a straight stretch only
            continue
        comps.append((c0, u, ext))
    corr = []
    used = set()
    for i, (c1, u1, e1) in enumerate(comps):
        if i in used:
            continue
        best = None
        for j, (c2, u2, e2) in enumerate(comps):
            if j == i or j in used:
                continue
            if abs(u1 @ u2) < math.cos(math.radians(20.0)):
                continue
            d_ = float(np.linalg.norm(c2 - c1))
            if 8.0 < d_ < 150.0 and (best is None or d_ < best[0]):
                best = (d_, j)
        if best is None:
            continue
        used.update((i, best[1]))
        c2, u2, e2 = comps[best[1]]
        u = u1 + (u2 if u1 @ u2 > 0 else -u2)
        u = u / np.linalg.norm(u)
        n = np.array([-u[1], u[0]])
        o = (c1 + c2) / 2.0
        s1, s2 = float((c1 - o) @ n), float((c2 - o) @ n)
        tt = []
        for c_ in (c1, c2):                                          # the corridor across the walls: the stretch of the chord through the wall that lies inside the part
            ch_ = LineString([tuple(c_ - 300.0 * u), tuple(c_ + 300.0 * u)]).intersection(body)
            for sg in lines_of(ch_):
                if sg.distance(Point(tuple(c_))) < 1.0:
                    tt += [float((np.array(q) - o) @ u) for q in sg.coords]
        if not tt:
            continue
        corr.append(dict(o=o, u=u, n=n, s=sorted((s1, s2)), t0=min(tt), t1=max(tt)))
    return corr


def flatten_walls(pieces, corr, S, ring_cls):
    """the perimeters along a corridor wall are one straight line: the small bumps of the 3dm outline (0.2 to 1.5 mm) are ironed out."""
    import numpy as np
    import shapely
    for k_, pc in enumerate(pieces):
        A0 = np.asarray(pc[0], float)[:, :2]
        closed = bool(pc[1])
        near = False
        for cr in corr:
            R = max(abs(cr['t0']), abs(cr['t1'])) + 14.0
            if (np.hypot(*(A0 - cr['o']).T) <= R + 30.0).any():
                near = True
        if not near:
            continue
        ls = shapely.segmentize(LineString(A0), 1.5)
        B = np.asarray(ls.coords, float)
        ch = False
        for cr in corr:
            o, u, n = cr['o'], cr['u'], cr['n']
            Nn = (B - o) @ n
            Tt = (B - o) @ u
            nl = max(abs(cr['s'][0]), abs(cr['s'][1])) + S['ARCH_ENTRY']
            for sg in (1.0, -1.0):
                sel = (sg * Tt >= 10.0) & (sg * Tt <= max(abs(cr['t0']), abs(cr['t1'])) + 10.0) & (np.abs(Nn) <= nl)
                if sel.sum() < 6 or np.ptp(Nn[sel]) < 10.0:
                    continue
                cf = np.polyfit(Nn[sel], Tt[sel], 1)
                dv = np.polyval(cf, Nn) - Tt
                mx = np.abs(dv[sel]).max()
                if mx > 1.5 or mx < 0.2:
                    continue
                wgt = np.clip((nl - np.abs(Nn)) / 6.0, 0.0, 1.0)
                B[sel] += (dv * wgt)[sel, None] * u
                ch = True
        if ch:
            Bl = [tuple(p_) for p_ in B]
            if closed and Bl[0] != Bl[-1] and tuple(A0[0]) == tuple(A0[-1]):
                Bl[-1] = Bl[0]
            if id(pc[0]) in ring_cls:
                ring_cls[id(Bl)] = ring_cls.pop(id(pc[0]))
            pieces[k_] = (Bl,) + tuple(pc[1:])


def round_weave(weave, tri_pts, corr, zone, S):
    """steep arch: the weave around the corners of the triangular opening (between two corridors) has no sharp tips: every sharp bend of a weave line there is rounded
    (smoothed over about ARCH_ROUND mm of line); points on the walls and inside the corridors stay where they are."""
    import numpy as np
    import shapely
    R = S['ARCH_ROUND']
    T = np.asarray(tri_pts, float)[:, :2]
    c = T.mean(axis=0)
    ang = np.arctan2(T[:, 1] - c[1], T[:, 0] - c[0])
    rr = np.hypot(*(T - c).T)
    verts = []
    for k in range(3):
        a0 = np.deg2rad(-180 + 120 * k)
        sel = np.abs(((ang - a0 + np.pi) % (2 * np.pi)) - np.pi) < np.deg2rad(60)
        if sel.any():
            verts.append(T[sel][np.argmax(rr[sel])])
    if not verts:
        return
    zb = zone.boundary
    sg = 0.6 * R
    for part in ('blue', 'green', 'neck'):
        for q_, (pts, closed, kind) in enumerate(weave[part]):
            A = np.asarray(pts, float)[:, :2].copy()
            if len(A) < 12:
                continue
            dseg = np.hypot(*np.diff(A, axis=0).T)
            cl = np.concatenate([[0.0], np.cumsum(dseg)])
            near = np.zeros(len(A), bool)
            for v in verts:
                near |= np.hypot(*(A - v).T) <= 60.0
            for cr in corr:
                Nn = (A - cr['o']) @ cr['n']
                Tt = (A - cr['o']) @ cr['u']
                near &= ~((np.abs(Nn) <= max(abs(cr['s'][0]), abs(cr['s'][1])) + S['ARCH_ENTRY'] + 2.0) & (Tt >= cr['t0'] - 6.0) & (Tt <= cr['t1'] + 6.0))
            if not near.any():
                continue
            fixed = shapely.distance(shapely.points(A), zb) <= 0.6
            # sharp bends: direction change over +-sg of line
            Ac = A.copy()
            flag = np.zeros(len(A), bool)
            for k in np.nonzero(near)[0]:
                i0 = int(np.searchsorted(cl, cl[k] - sg))
                i1 = min(len(A) - 1, int(np.searchsorted(cl, cl[k] + sg)))
                if i0 < 0 or i1 <= k or i0 >= k:
                    continue
                v1 = A[k] - A[i0]
                v2 = A[i1] - A[k]
                n1, n2 = np.hypot(*v1), np.hypot(*v2)
                if n1 < 1e-6 or n2 < 1e-6:
                    continue
                cosang = float(v1 @ v2) / (n1 * n2)
                if cosang < np.cos(np.deg2rad(40.0)):
                    flag[max(0, k - 1):k + 2] = True
            if not flag.any():
                continue
            # spread the flag along the line so the rounding fades in and out
            for k in np.nonzero(flag)[0]:
                lo = int(np.searchsorted(cl, cl[k] - 2.0 * sg))
                hi = int(np.searchsorted(cl, cl[k] + 2.0 * sg))
                w = np.exp(-0.5 * ((cl[lo:hi + 1] - cl[k]) / sg) ** 2)
                pass
            reg = np.zeros(len(A), bool)
            for k in np.nonzero(flag)[0]:
                lo = int(np.searchsorted(cl, cl[k] - 2.0 * sg))
                hi = int(np.searchsorted(cl, cl[k] + 2.0 * sg))
                reg[lo:hi + 1] = True
            reg &= near & ~fixed
            reg[0] = reg[-1] = False
            for k in np.nonzero(reg)[0]:
                w = np.exp(-0.5 * ((cl - cl[k]) / sg) ** 2)
                w[np.abs(cl - cl[k]) > 3.0 * sg] = 0.0
                Ac[k] = (A * w[:, None]).sum(axis=0) / w.sum()
            if closed and np.allclose(A[0], A[-1]):
                Ac[-1] = Ac[0]
            pz = np.asarray(pts, float)
            if pz.shape[1] > 2:
                Ac = np.hstack([Ac, pz[:, 2:]])
            weave[part][q_] = ([tuple(p_) for p_ in Ac], closed, kind)


def neck_contact(weave, bead, S, tdist, rings=()):
    """the gap-filling (neck) loops touch the surrounding weave all the way round: where a loop leaves a gap of NECK_CONTACT mm or less to the weave
    next to it (e.g. towards the round hole with its petals) over a stretch of 8 mm or more, that part of the loop is moved against the weave."""
    import numpy as np
    import shapely
    from scipy.spatial import cKDTree
    gmax = S['NECK_CONTACT']
    necks = [(k_, np.asarray(p_, float)[:, :2]) for k_, (p_, c_, kd_) in enumerate(weave['neck']) if c_ and len(p_) > 20]
    if not necks:
        return
    oth = []
    for part in ('blue', 'green'):
        for p_, c_, kd_ in weave[part]:
            A = np.asarray(p_, float)[:, :2]
            if len(A) > 1:
                oth.append(shapely.get_coordinates(shapely.segmentize(shapely.linestrings(A), 0.7)))
    for r_ in rings:                                          # the walls around the round holes are partners too
        A = np.asarray(r_, float)[:, :2]
        if len(A) > 2:
            oth.append(shapely.get_coordinates(shapely.segmentize(shapely.linestrings(A), 0.7)))
    if not oth:
        return
    for _ in range(2):
        for k_, P in necks:
            allo = [o_ for o_ in oth]
            for k2_, P2 in necks:
                if k2_ != k_:
                    allo.append(shapely.get_coordinates(shapely.segmentize(shapely.linestrings(P2), 0.7)))
            tree = cKDTree(np.vstack(allo))
            Q = np.vstack(allo)
            D, I = tree.query(P)
            cl = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
            n = len(P) - 1
            touch = D < tdist + 0.4
            if touch.all() or not touch.any():
                continue
            # circular runs without contact
            k0 = int(np.nonzero(touch[:n])[0][0])
            order = [(k0 + i) % n for i in range(n)]
            runs, cur = [], []
            for i in order:
                if touch[i]:
                    if cur:
                        runs.append(cur)
                    cur = []
                else:
                    cur.append(i)
            if cur:
                runs.append(cur)
            Pn = P.copy()
            disp = np.zeros((n, 2))
            for run in runs:
                arc = sum(np.hypot(*(P[(i + 1) % n] - P[i])) for i in run)
                if arc < 6.0:
                    continue
                for i in run:
                    if D[i] - tdist <= gmax:
                        disp[i] = (Q[I[i]] - P[i]) / D[i] * (D[i] - tdist)
            if not disp.any():
                continue
            sm = np.zeros_like(disp)
            seg = np.hypot(*np.diff(P, axis=0).T)
            cl0 = cl[:n]
            for i in range(n):
                dd = np.abs(cl0 - cl0[i])
                dd = np.minimum(dd, cl[-1] - dd)
                w = np.exp(-0.5 * (dd / 2.0) ** 2)
                w[dd > 6.0] = 0.0
                sm[i] = (disp * w[:, None]).sum(axis=0) / w.sum()
            Pn[:n] = P[:n] + np.where(np.abs(disp).sum(axis=1)[:, None] > 0, 1.0, 0.6) * sm
            Pn[n] = Pn[0]
            P[:] = Pn
    for k_, P in necks:
        old = weave['neck'][k_]
        weave['neck'][k_] = ([tuple(p_) for p_ in P], old[1], old[2])


def arch_ladder(weave, zone, bead, corr, S, dbg=None):
    """every corridor beneath the arch, the same on every layer: the two weave lines of the corridor run straight along the two walls (double wall: the perimeter
    plus the weave) and under each leg-end wall one of them makes a narrow U across the corridor (two runs one bead apart = a double-width support for the first
    layer of the arch). The first wall is carried by the U of the left line, the second by the U of the right line (point symmetric)."""
    import numpy as np
    from shapely.geometry import Polygon
    E = S['ARCH_ENTRY']
    TR = S['ARCH_TRANSITION']
    nmod = 0
    for cr in corr:
        o, u, n = cr['o'], cr['u'], cr['n']
        wl0 = cr.get('wl') or []
        if cr.get('ctr') is not None and len(wl0) == 2 and (cr['s'][1] - cr['s'][0]) < S['ARCH_U_CLEAR'] and float(np.dot(o - cr['ctr'], u)) < 0:
            # steep arch: every corridor looks outward from the part centre (u points away from it), so the three corridors are built the same way round (the same line makes the same U)
            cr['u'], cr['n'] = -u, -n
            cr['s'] = sorted((-cr['s'][0], -cr['s'][1]))
            cr['t0'], cr['t1'] = -cr['t1'], -cr['t0']
            cr['wl'] = [(-r_, -l_) for l_, r_ in wl0]
            o, u, n = cr['o'], cr['u'], cr['n']
        sa, sb = cr['s']
        hsL = hsR = None                                          # steep arch: explicit rung positions under the walls of the first two layers
        wl2 = cr.get('wl') or []
        if len(wl2) == 2:
            l1, r1 = wl2[0]
            l2, r2 = wl2[1]
            if (sb - sa) < S['ARCH_U_CLEAR'] and min(abs(l1 - l2), abs(r1 - r2)) >= S['ARCH_U_FOLLOW'] and max(abs(l1 - l2), abs(r1 - r2)) <= 30.0 and max(l1, l2) < min(r1, r2):
                hsL, hsR = sorted([l1, l2]), sorted([r1, r2])
        s_lo, s_hi = sa - E, sb + E
        TRu = TR
        cr['_steep'] = bool(hsL)
        if hsL:                                                   # the outer rungs lie inside the rebuilt stretch: the weave line reaches the wall over a shorter length
            TRu = max(2.0, min(TR, hsL[0] - s_lo - 1.5, s_hi - hsR[1] - 1.5))
        strip = Polygon([tuple(o + s_lo * n - 500 * u), tuple(o + s_lo * n + 500 * u), tuple(o + s_hi * n + 500 * u), tuple(o + s_hi * n - 500 * u)])
        cstrip = Polygon([tuple(o + s_lo * n + (cr['t0'] - 4.0) * u), tuple(o + s_lo * n + (cr['t1'] + 4.0) * u), tuple(o + s_hi * n + (cr['t1'] + 4.0) * u), tuple(o + s_hi * n + (cr['t0'] - 4.0) * u)])
        wl_ = [ln for ln in lines_of(linemerge(lines_of(zone.boundary.intersection(cstrip)))) if ln.length > 0.7 * (s_hi - s_lo)]
        if len(wl_) != 2:
            if dbg is not None:
                dbg.append('walls %d' % len(wl_))
            continue
        walls = []
        for ln in wl_:
            A = np.array(ln.coords, float)
            ss = (A - o) @ n
            tt = (A - o) @ u
            if ss[0] > ss[-1]:
                A, ss = A[::-1], ss[::-1]
            walls.append((float(tt.mean()), A, ss))
        walls.sort(key=lambda w_: w_[0])
        fits_ = []
        for k_, w_ in enumerate(walls):                          # the wall run is one straight line: small bumps of the zone edge (up to 2.5 mm) are ironed out
            A_ = w_[1]
            ss_ = w_[2]
            tt_ = (A_ - o) @ u
            if len(A_) >= 2 and np.ptp(ss_) > 1.0:
                cf_ = np.polyfit(ss_, tt_, 1)
                dm_ = np.abs(np.polyval(cf_, ss_) - tt_).max()
                if (hsL or dm_ >= 0.3) and dm_ <= 2.5:
                    sg_ = np.linspace(ss_[0], ss_[-1], max(2, int(np.ptp(ss_) / 2.0) + 1))
                    B_ = o + sg_[:, None] * n + np.polyval(cf_, sg_)[:, None] * u
                    walls[k_] = (w_[0], B_, sg_)
                    fits_.append(cf_)
        WL, WR = walls

        def wp(w_, sv):
            return np.array([np.interp(sv, w_[2], w_[1][:, 0]), np.interp(sv, w_[2], w_[1][:, 1])])

        def wrun(w_, s0, s1):
            A, ss = w_[1], w_[2]
            idx = np.nonzero((ss > min(s0, s1) + 1e-6) & (ss < max(s0, s1) - 1e-6))[0]
            if s1 < s0:
                idx = idx[::-1]
            return [wp(w_, s0)] + [A[i] for i in idx] + [wp(w_, s1)]

        def rung(w_from, w_to, sv):                              # from one wall toward the other, stopping one bead short of it
            p0, p1 = wp(w_from, sv), wp(w_to, sv)
            d = p1 - p0
            d = d / np.linalg.norm(d)
            return p0, p1 - d * bead

        def ustrand(w_from, w_to, s0, s1, sh, hs=None):          # wall run with the U at sh (or its rungs at hs), running from s0 to s1 (s0 < s1)
            ug = bead * (1.0 - S['ARCH_U_OVERLAP'] / 100.0)         # distance between the two rungs
            if hs is None:
                hs = [sh - ug / 2.0, sh + ug / 2.0]
            P = wrun(w_from, s0, hs[0])
            a0, a1 = rung(w_from, w_to, hs[0])
            b0, b1 = rung(w_from, w_to, hs[1])
            W2 = wrun(w_from, hs[1], s1)
            cr.setdefault('_dw', []).extend([np.array(P), np.array(W2)])      # double-wall tag: the two straight runs of this line along the wall (the rungs of the U are not counted)
            P += [a1, b1, b0] + W2[0:]
            return P

        def straight(w_, s0, s1):
            return wrun(w_, s0, s1)

        # the weave lines: cut at the strip, inside parts collected
        items = []                                               # (part, closed, kind, pieces)
        for part in ('blue', 'green', 'neck'):
            for pts, closed, kind in weave[part]:
                A = np.asarray(pts, float)[:, :2]
                if len(A) < 2:
                    items.append([part, closed, kind, [('out', A)]])
                    continue
                ss = (A - o) @ n
                tq = (A - o) @ u
                ins = (ss > s_lo) & (ss < s_hi) & (tq > cr['t0'] - 4.0) & (tq < cr['t1'] + 4.0)
                if not ins.any():
                    items.append([part, closed, kind, [('out', A)]])
                    continue
                if closed:
                    if ins.all():
                        items.append([part, closed, kind, [('out', A)]])
                        continue
                    k0 = int(np.nonzero(~ins)[0][0])
                    A = np.vstack([A[k0:], A[:k0], A[k0:k0 + 1]])
                    ss = (A - o) @ n
                    tq = (A - o) @ u
                    ins = (ss > s_lo) & (ss < s_hi) & (tq > cr['t0'] - 4.0) & (tq < cr['t1'] + 4.0)
                pieces = []
                i = 0
                m = len(A)
                while i < m:
                    j = i
                    if ins[i]:
                        while j + 1 < m and ins[j + 1]:
                            j += 1
                        pieces.append(('in', A[i:j + 1], ss[i - 1] if i > 0 else None, ss[j + 1] if j + 1 < m else None))
                    else:
                        while j + 1 < m and not ins[j + 1]:
                            j += 1
                        pieces.append(('out', A[i:j + 1]))
                    i = j + 1
                items.append([part, closed, kind, pieces])
        crossing = []
        for it in items:
            for k, pc in enumerate(it[3]):
                if pc[0] == 'in' and pc[2] is not None and pc[3] is not None and ((pc[2] <= s_lo and pc[3] >= s_hi) or (pc[2] >= s_hi and pc[3] <= s_lo)):
                    crossing.append((it, k))
        if dbg is not None:
            dbg.append('in-runs %d crossing %d' % (sum(1 for it in items for pc in it[3] if pc[0] == 'in'), len(crossing)))
        if len(crossing) != 2:
            continue
        # which crossing is the left one (low t at the A end)
        def tA(c):
            pc = c[0][3][c[1]]
            P = pc[1]
            return float(((P[0] if pc[2] <= s_lo else P[-1]) - o) @ u)
        crossing.sort(key=tA)
        uw = bead * (1.0 - S['ARCH_U_OVERLAP'] / 100.0) + bead                      # outer width of one U (rung centres one gap apart + one line)
        ushift = ((sb - sa) - S['ARCH_U_CLEAR']) / 2.0 - uw / 2.0                    # U centre moved inward from the wall centre line to leave the clear gap
        ushift = min(ushift, uw / 2.0 + bead / 2.0 - S['ARCH_U_ANCHOR'] * bead)       # not so far in that less than ARCH_U_ANCHOR of the wall rests on the U
        ushift = max(ushift, 0.0)
        newp = {0: None, 1: None}
        for q, (it, k) in enumerate(crossing):
            pc = it[3][k]
            P = pc[1]
            fwd = pc[2] <= s_lo                                   # runs from the A side to the B side
            if q == 0:                                            # left line: U under the first wall
                Pn = ustrand(WL, WR, s_lo + TRu, s_hi - TRu, sa + ushift, hsL)
            else:                                                 # right line: U under the second wall
                Pn = ustrand(WR, WL, s_lo + TRu, s_hi - TRu, sb - ushift, hsR)
            Pn = [np.array(p_) for p_ in Pn]
            # join to the original ends: the line comes in from where the polyline crossed the strip
            if not fwd:
                Pn = Pn[::-1]
            it[3][k] = ('in', np.array(Pn), pc[2], pc[3])
        # dips (an in-run that leaves by the side it came from) stay as they are
        for it in items:
            A = np.vstack([pc[1] for pc in it[3]])
            if it[1] and len(A) > 2 and np.allclose(A[0], A[-1]):
                A = A[:-1]
            it.append(A)
        for it in (items if hsL else []):                         # steep arch: weave points that run along a wall (within 1.2 mm) lie exactly on it: the small humps of the weave next to the wall are flattened
            A = it[4]
            if len(A) < 2:
                continue
            Nn = (A - o) @ n
            Tt = (A - o) @ u
            for cf_ in fits_:
                dv_ = np.polyval(cf_, Nn) - Tt
                mk_ = (np.abs(dv_) <= 1.2) & (np.abs(dv_) > 1e-6) & (Nn > s_lo - 14.0) & (Nn < s_hi + 14.0)
                if mk_.any():
                    wg_ = np.clip(np.minimum(Nn - (s_lo - 14.0), (s_hi + 14.0) - Nn) / 6.0, 0.0, 1.0)
                    A[mk_] += (dv_ * wg_)[mk_, None] * u
            # the tops of the weave arcs that rest on the wall: tiny dents (under 1.5 mm) are ironed out with a short running average
            Nn = (A - o) @ n
            Tt = (A - o) @ u
            dv_ = np.min([np.abs(np.polyval(cf_, Nn) - Tt) for cf_ in fits_], axis=0) if fits_ else np.full(len(A), 99.0)
            zs_ = (dv_ <= 3.0) & (Nn > s_lo - 14.0) & (Nn < s_hi + 14.0)
            if len(A) >= 15 and zs_.any():
                Ac = A.copy()
                for k_ in range(7, len(A) - 7):
                    if zs_[k_ - 7:k_ + 8].all():
                        Ac[k_] = A[k_ - 7:k_ + 8].mean(axis=0)
                A[:] = Ac
        # write back
        for part in ('blue', 'green', 'neck'):
            weave[part] = []
        for part, closed, kind, pieces, A in items:
            weave[part].append(([tuple(p) for p in A], closed, kind))
        nmod += 1
    return nmod


def wall_contact(weave, zone, bead, S):
    """pull every weave point that runs within WALL_CONTACT_GAP of the perimeter (zone edge) but does not touch it
    onto the perimeter, fading the correction out along the line (CONTACT_BLEND)."""
    import shapely
    gap = S['WALL_CONTACT_GAP']
    if gap <= 0 or zone.is_empty:
        return
    zb_ = zone.boundary
    for part in ('blue', 'green', 'neck'):
        res = []
        for pts, closed, kind in weave[part]:
            arr = np.array(pts, dtype=float)
            n = len(arr)
            if n < 3:
                res.append((pts, closed, kind))
                continue
            d = line_dist(zb_, arr)
            near = (d > 0.15) & (d <= gap)
            if not near.any():
                res.append((pts, closed, kind))
                continue
            idx = np.where(near)[0]
            tgt = shapely.get_coordinates(shapely.get_point(shapely.shortest_line(zb_, shapely.points(arr[idx])), 0))
            dv = np.zeros((n, 2))
            dv[idx] = tgt - arr[idx]
            if n > 5:                                       # smooth the correction so a line between two walls does not zigzag
                k = 2
                pad = np.concatenate([dv[-k:], dv, dv[:k]]) if closed else np.concatenate([np.repeat(dv[:1], k, 0), dv, np.repeat(dv[-1:], k, 0)])
                sm = np.stack([np.convolve(pad[:, c_], np.ones(2 * k + 1) / (2 * k + 1), mode='valid') for c_ in (0, 1)], axis=1)
                dv = np.where(near[:, None], sm, dv)
            disp = {int(i): (float(dv[i, 0]), float(dv[i, 1])) for i in idx}
            res.append((spread_open([tuple(q) for q in arr], closed, disp, S['CONTACT_BLEND']), closed, kind))
        weave[part] = res


def regularize(weave, zone, bead, S, tdist=None):
    """join weave lines that nearly touch (gap) and separate those that overlap, so every contact is exactly 'touching'."""
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    items = []
    for part in ('blue', 'green', 'neck'):
        for k, (pts, closed, kind) in enumerate(weave[part]):
            if len(pts) >= 3:
                items.append([part, k, [tuple(q) for q in pts], bool(closed)])
    if not items:
        return
    P, cid, sarc, clen, closed_of = [], [], [], [], []
    for ci, it in enumerate(items):
        pts = it[2]
        s_ = 0.0
        arcs = [0.0]
        for a, b in zip(pts, pts[1:]):
            s_ += math.hypot(b[0] - a[0], b[1] - a[1])
            arcs.append(s_)
        for q, a in zip(pts, arcs):
            P.append(q)
            cid.append(ci)
            sarc.append(a)
        clen.append(s_)
    P = np.array(P)
    cid = np.array(cid)
    sarc = np.array(sarc)
    N = len(P)
    tdist = bead - 0.2 if tdist is None else tdist
    R = S['CONTACT_GAP']
    dmin = np.full(N, 1e9)
    jn = np.full(N, -1)
    closed_arr = np.array([it[3] for it in items])
    clen_arr = np.array(clen)
    try:                                                   # only partners within the contact gap can matter
        import shapely
        pp_ = shapely.points(P)
        pr_ = shapely.STRtree(pp_).query(pp_, predicate='dwithin', distance=R + 1e-6)
        u_, v_ = pr_[0], pr_[1]
        same_ = cid[u_] == cid[v_]
        ds_ = np.abs(sarc[u_] - sarc[v_])
        ds_ = np.where(same_ & closed_arr[cid[u_]], np.minimum(ds_, clen_arr[cid[u_]] - ds_), ds_)
        ok_ = ~(same_ & (ds_ < S['CONTACT_FAR']))
        u_, v_ = u_[ok_], v_[ok_]
        if len(u_):
            D_ = np.hypot(P[u_, 0] - P[v_, 0], P[u_, 1] - P[v_, 1])
            o_ = np.lexsort((v_, D_, u_))                  # per point: nearest partner, ties -> lowest index
            us_ = u_[o_]
            first_ = np.ones(len(us_), dtype=bool)
            first_[1:] = us_[1:] != us_[:-1]
            sel_ = o_[first_]
            dmin[u_[sel_]] = D_[sel_]
            jn[u_[sel_]] = v_[sel_]
    except Exception:
        for g in range(N):
            cand = np.arange(N)
            same = cid[cand] == cid[g]
            ds = np.abs(sarc[g] - sarc[cand])
            if closed_arr[cid[g]]:
                ds = np.where(same, np.minimum(ds, clen_arr[cid[g]] - ds), ds)
            ok = ~(same & (ds < S['CONTACT_FAR']))
            if not ok.any():
                continue
            cand = cand[ok]
            D = np.hypot(P[g, 0] - P[cand, 0], P[g, 1] - P[cand, 1])
            m_ = int(D.argmin())
            if D[m_] <= R + 1e-6:
                dmin[g] = D[m_]
                jn[g] = cand[m_]
    import shapely
    zb = zone.boundary
    base = 0
    disp_by_curve = {}
    fixed_arr = line_dist(zb, P) <= 0.6

    def is_fixed(idx):
        return bool(fixed_arr[idx])
    half = S['CONTACT_LENGTH'] / 2.0
    cidx = {c_: np.where(cid == c_)[0] for c_ in range(len(items))}
    for ci, it in enumerate(items):
        pts, closed = it[2], it[3]
        n = len(pts)
        idx0 = int(cidx[ci][0])
        arcs = sarc[idx0:idx0 + n]
        disp = {}
        events = []
        for k in range(n):
            g = idx0 + k
            d = dmin[g]
            if d > R or d < 1e-6:
                continue
            lo = [dmin[idx0 + ((k + o) % n if closed else min(max(k + o, 0), n - 1))] for o in range(-5, 6) if o != 0]
            if any(v < d - 1e-9 for v in lo):
                continue                                # only the closest point of each approach
            events.append((d, k))
        for d, k in sorted(events):
            g = idx0 + k
            j = int(jn[g])
            cj = int(cid[j])
            jdx = cidx[cj]
            sj = sarc[j]
            # the neighbouring partner points that take part in the head-to-head stretch
            # a line next to one that already lies on the perimeter only gets a short contact, otherwise it would run
            # alongside the perimeter and look like a second wall
            hh = 2.0 if (is_fixed(g) or is_fixed(j)) else half
            win = jdx[np.abs(sarc[jdx] - sj) <= hh + 3.0]
            if len(win) == 0:
                continue
            dA_ = np.abs(arcs - arcs[k])
            if closed:
                dA_ = np.minimum(dA_, clen[ci] - dA_)
            for kk in np.nonzero(dA_ <= hh)[0].tolist():
                if kk in disp:
                    continue
                gg = idx0 + kk
                Dk = np.hypot(P[win, 0] - P[gg, 0], P[win, 1] - P[gg, 1])
                m_ = int(Dk.argmin())
                dn = float(Dk[m_])
                if dn < 1e-9 or dn > R * 1.5:
                    continue
                q = win[m_]
                fp, fq = is_fixed(gg), is_fixed(int(q))
                share = 0.0 if fp else (1.0 if fq else 0.5)
                if share == 0.0:
                    continue
                m = dn - tdist
                if abs(m) < 0.15:
                    continue
                m = max(-3.5, min(3.5, m))
                ux, uy = P[q][0] - P[gg][0], P[q][1] - P[gg][1]
                ln = math.hypot(ux, uy)
                disp[kk] = (ux / ln * m * share, uy / ln * m * share)
        if disp:
            disp_by_curve[ci] = disp
    n_fix = 0
    for ci, disp in disp_by_curve.items():
        part, k, pts, closed = items[ci]
        new = spread_open(pts, closed, disp, S['CONTACT_BLEND'])
        fixed = []
        na = np.asarray(new, dtype=float)
        ok = shapely.contains_xy(zone, na[:, 0], na[:, 1]) | (line_dist(zb, na) < 0.05)
        for q, good in zip(new, ok):
            if good:
                fixed.append(q)
            else:
                nb = nearest_points(zb, Point(q))[0]
                fixed.append((nb.x, nb.y))
        if closed and len(weave[part][k][0]) > 1 and tuple(weave[part][k][0][0]) == tuple(weave[part][k][0][-1]):
            fixed[-1] = fixed[0]
        weave[part][k] = (fixed, weave[part][k][1], weave[part][k][2])
        n_fix += len(disp)
    return n_fix


def tighten(weave, zone, bead, S, tdist=None, skip=None):
    """close the small slits: two weave lines that run side by side with their centres a little further apart than a bead (the first layer, printed wider, hides
    such a slit; the normal layers do not) are drawn together until they touch, in every layer. Lines on the perimeter stay, the partner moves."""
    import shapely
    from scipy.spatial import cKDTree
    items = []
    for part in ('blue', 'green', 'neck'):
        for k, (pts, closed, kind) in enumerate(weave[part]):
            if len(pts) >= 3:
                items.append([part, k, np.asarray(pts, float)[:, :2], bool(closed)])
    if not items:
        return 0
    tdist = bead - 0.2 if tdist is None else tdist
    R2 = S['TIGHTEN_RANGE']
    zb = zone.boundary
    moved = 0
    fixed = None
    for _ in range(int(S['TIGHTEN_PASSES'])):
        P = np.vstack([it[2] for it in items])
        cid = np.concatenate([np.full(len(it[2]), ci) for ci, it in enumerate(items)])
        sarc, clen, off = [], [], []
        o_ = 0
        for it in items:
            A = it[2]
            a_ = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(A, axis=0).T))])
            sarc.append(a_)
            clen.append(a_[-1] + (np.hypot(*(A[0] - A[-1])) if it[3] else 0.0))
            off.append(o_)
            o_ += len(A)
        sarc = np.concatenate(sarc)
        clen = np.array(clen)
        closed_arr = np.array([it[3] for it in items])
        if fixed is None:
            fixed = line_dist(zb, P) <= 0.6                  # the points on the perimeter keep their place (the same points in every pass)
        pr = cKDTree(P).query_pairs(R2, output_type='ndarray')
        if skip is not None and len(pr):
            insk = shapely.contains_xy(skip, P[:, 0], P[:, 1])      # the round lobes keep the pattern as it is (the petals must not be pushed over each other)
            pr = pr[~(insk[pr[:, 0]] | insk[pr[:, 1]])]
        if len(pr) == 0:
            break
        i_, j_ = pr[:, 0], pr[:, 1]
        same = cid[i_] == cid[j_]
        ds = np.abs(sarc[i_] - sarc[j_])
        ds = np.where(same & closed_arr[cid[i_]], np.minimum(ds, clen[cid[i_]] - ds), ds)
        ok = ~(same & (ds < S['CONTACT_FAR']))
        i_, j_ = i_[ok], j_[ok]
        D = np.hypot(*(P[i_] - P[j_]).T)
        ok = (D > tdist + 0.1)
        i_, j_, D = i_[ok], j_[ok], D[ok]
        if len(i_) == 0:
            break
        # each point: its nearest partner
        a = np.concatenate([i_, j_])
        b = np.concatenate([j_, i_])
        d = np.concatenate([D, D])
        o = np.lexsort((d, a))
        a, b, d = a[o], b[o], d[o]
        first = np.ones(len(a), bool)
        first[1:] = a[1:] != a[:-1]
        a, b, d = a[first], b[first], d[first]
        share = np.where(fixed[a], 0.0, np.where(fixed[b], 1.0, 0.5))
        vec = (P[b] - P[a]) / d[:, None] * ((d - tdist) * share)[:, None]
        disp = np.zeros_like(P)
        disp[a] = vec
        # smooth along every line (about 3 mm each way) so no kink appears
        sm = np.zeros_like(disp)
        for ci, it in enumerate(items):
            n = len(it[2])
            sl = slice(off[ci], off[ci] + n)
            Dm = disp[sl]
            ar = sarc[sl]
            if it[3]:
                ar3 = np.concatenate([ar - clen[ci], ar, ar + clen[ci]])
                D3 = np.vstack([Dm, Dm, Dm])
            else:
                ar3, D3 = ar, Dm
            cs = np.vstack([np.zeros((1, 2)), np.cumsum(D3, axis=0)])
            lo = np.searchsorted(ar3, ar - 3.0, side='left')
            hi = np.searchsorted(ar3, ar + 3.0, side='right')
            sm[sl] = (cs[hi] - cs[lo]) / np.maximum(hi - lo, 1)[:, None]
        if skip is not None:
            sm[insk] = 0.0
        moved += int((np.hypot(*sm.T) > 0.05).sum())
        Pn = P + sm
        inside = shapely.contains_xy(zone, Pn[:, 0], Pn[:, 1]) | (line_dist(zb, Pn) < 0.05)
        Pn = np.where(inside[:, None], Pn, P)
        for ci, it in enumerate(items):
            n = len(it[2])
            new = Pn[off[ci]:off[ci] + n].copy()
            if it[3] and np.allclose(it[2][0], it[2][-1]):
                new[-1] = new[0]
            it[2] = new
    for part, k, A, closed in items:
        weave[part][k] = ([tuple(q) for q in A], weave[part][k][1], weave[part][k][2])
    return moved


def warp_curve(pts, lobes, zone, fade):
    """radial morph of the points near each round hole so the ring between the hole and the layer outline keeps its proportions."""
    for lb in lobes:
        c, r_in, r_cap, ang = lb['c'], lb['r_in'], lb['r_cap'], lb['angles']
        lay = _smooth_circ(_ring_reach(zone, c, r_in, r_cap, ang), 3)
        N = len(ang)
        sc = [max(0.0, min(1.0, (lay[i] - r_in) / max(1e-6, lb['ref'][i] - r_in))) for i in range(N)]
        if min(sc) > 0.995:
            continue
        new = []
        for x, y in pts:
            dx, dy = x - c[0], y - c[1]
            r = math.hypot(dx, dy)
            if r <= r_in or r >= r_cap + fade or r < 1e-9:
                new.append((x, y))
                continue
            th = math.atan2(dy, dx) % (2 * math.pi)
            f = th / (2 * math.pi) * N
            i0 = int(f) % N
            w = f - int(f)
            s_ = sc[i0] * (1 - w) + sc[(i0 + 1) % N] * w
            if r <= r_cap:
                r2 = r_in + (r - r_in) * s_
            else:
                d_cap = (r_in + (r_cap - r_in) * s_) - r_cap          # shift at r_cap (<= 0), fading out
                r2 = r + d_cap * (1.0 - (r - r_cap) / fade)
            k = r2 / r
            new.append((c[0] + dx * k, c[1] + dy * k))
        pts = new
    return pts


_TIMES = {}


def _timed(name):
    import time as _t
    fn = globals()[name]

    def w(*a, **k):
        t0 = _t.perf_counter()
        try:
            return fn(*a, **k)
        finally:
            _TIMES[name] = _TIMES.get(name, 0.0) + _t.perf_counter() - t0
    w.__name__ = name
    globals()[name] = w


for _n in ('mesh_from_brep', 'load_mesh', 'section', 'regularize', 'wall_contact', 'tighten', 'warp_curve', 'pull_contacts', 'arch_ladder', 'snap_clip', 'arch_corridors', 'order'):
    if _n in globals():
        _timed(_n)


def stack_seams(layers_out, tol, notes):
    """closed perimeter loops are followed from layer to layer. Where the seam of such a chain drifts (the wall it sat on moves away), every loop of the
    chain starts at the point of the loop that stays within tol of ALL layers of the chain (nearest to the seam of its first layer): the seams stack."""
    import shapely
    from shapely.geometry import LineString, Polygon
    chains = []
    last = []                                                   # (chain, centroid, area) of the previous layer
    for L in layers_out:
        cur_ = []
        for pi_, p in enumerate(L['paths']):
            if not (p['closed'] and p['type'] in ('external', 'perimeter')) or len(p['pts']) < 5:
                continue
            pg = Polygon(p['pts'])
            if pg.is_empty or pg.area < 1.0:
                continue
            c = pg.centroid
            best = None
            for ch_, cc_, ca_, ct_ in last:
                if ct_ != p['type']:
                    continue
                d_ = math.hypot(c.x - cc_[0], c.y - cc_[1])
                if d_ < 25.0 and 0.6 < pg.area / ca_ < 1.6 and (best is None or d_ < best[0]):
                    best = (d_, ch_)
            ch = best[1] if best else []
            if not best:
                chains.append(ch)
            ch.append((L['index'], pi_))
            cur_.append((ch, (c.x, c.y), pg.area, p['type']))
        last = cur_
    by_idx = {L['index']: L for L in layers_out}
    moved = 0
    for ch in chains:
        if len(ch) < 3:
            continue
        rings = [np.asarray(by_idx[li_]['paths'][pi_]['pts'], float) for li_, pi_ in ch]
        seams = np.array([r[0] for r in rings])
        if np.max(np.hypot(seams[:, 0] - seams[0, 0], seams[:, 1] - seams[0, 1])) <= tol:
            continue                                            # already stacked
        lines = [LineString(r) for r in rings]
        base = lines[0]
        n_ = max(8, int(base.length / 1.0))
        cand = shapely.line_interpolate_point(base, np.linspace(0, base.length, n_, endpoint=False))
        dmax = np.zeros(n_)
        for ln_ in lines:
            dmax = np.maximum(dmax, shapely.distance(cand, ln_))
        ok = np.nonzero(dmax <= tol)[0]
        if len(ok) == 0:
            continue                                            # nothing of this loop stays put
        cxy = shapely.get_coordinates(cand)
        dd = np.hypot(cxy[ok, 0] - seams[0, 0], cxy[ok, 1] - seams[0, 1])
        a = cxy[ok[int(dd.argmin())]]
        ap = shapely.points(a[0], a[1])
        for (li_, pi_), r, ln_ in zip(ch, rings, lines):
            body = [tuple(q) for q in r[:-1]] if np.allclose(r[0], r[-1]) else [tuple(q) for q in r]
            t = ln_.project(ap)
            q = ln_.interpolate(t)
            acc, k = 0.0, 0
            for k in range(len(body)):
                seg = math.hypot(body[(k + 1) % len(body)][0] - body[k][0], body[(k + 1) % len(body)][1] - body[k][1])
                if acc + seg >= t - 1e-9:
                    break
                acc += seg
            new = [(q.x, q.y)] + body[k + 1:] + body[:k + 1]
            new = [p_ for i_, p_ in enumerate(new) if i_ == 0 or math.hypot(p_[0] - new[i_ - 1][0], p_[1] - new[i_ - 1][1]) > 1e-4]
            by_idx[li_]['paths'][pi_]['pts'] = [[round(x_, 3), round(y_, 3)] for x_, y_ in new + [new[0]]]
        moved += 1
    if moved:
        notes.append('Seams: %d perimeter loop(s) whose seam drifted from layer to layer now start on the part of the wall that stays put (stacked).' % moved)


def clean_crown(Pc, max_area, r=1.5):
    """the tip of the arch crown reaches a slice height first as a narrow slit cut into a wall (from the hole side and from the outside); the wall offsets turn each slit into a round nub
    in the walls and the weave. Closing the outline fills slits narrower than 2r; only the filled pieces between 1.5 mm2 and max_area are kept."""
    added = Pc.buffer(r, 8).buffer(-r, 8).difference(Pc)
    fix, n = Pc, 0
    for g in polys_of(added):
        if 1.5 <= g.area <= max_area:
            fix = fix.union(g.buffer(0.01, 4))
            n += 1
    return (fix.buffer(0), n) if n else (Pc, 0)


def run(S):
    pj = _HOST.get('PatternJson')
    pat = json.loads(pj) if pj else json.load(open(S['PATTERN_FILE']))
    scale = S['MODEL_UNITS_TO_MM']
    notes = []
    if abs(pat['model_units_to_mm'] - scale) > 1e-9:
        notes.append('MODEL_UNITS_TO_MM (%g) differs from the pattern file (%g). Using the pattern file value for the pattern.'
                     % (scale, pat['model_units_to_mm']))
    ps = pat['model_units_to_mm']
    hl = pat['reference']['holes'][1:]
    if len(hl) >= 2:                                   # seam anchors: lobe centres and the part centre
        hcs = [(sum(p[0] for p in h_) / len(h_) * ps, sum(p[1] for p in h_) / len(h_) * ps) for h_ in hl]
        S['_SEAM_HOLES'] = hcs
        S['_SEAM_C'] = (sum(c_[0] for c_ in hcs) / len(hcs), sum(c_[1] for c_ in hcs) / len(hcs))
    bead = S['INFILL_WIDTH']
    if abs(bead - pat['bead_mm']) > 0.05:
        notes.append('INFILL_WIDTH %.2f differs from the pattern bead %.2f mm; rebuild the pattern.' % (bead, pat['bead_mm']))
    n = max(1, int(S['PERIMETERS']))
    band = S['EXTERNAL_PERIMETER_WIDTH'] + (n - 1) * S['PERIMETER_WIDTH']
    if abs(band - pat['boundary_band_mm']) > 0.1:
        notes.append('Perimeter band %.2f mm differs from the pattern band %.2f mm; rebuild the pattern.' % (band, pat['boundary_band_mm']))

    tm = mesh_from_brep(_HOST['Brep'], scale) if (HAVE_RHINO and _HOST.get('Brep') is not None) else load_mesh(S['INPUT_FILE'], scale)
    tm = auto_flip(tm, S)
    if getattr(tm, '_flipped', False):
        notes.append('AUTO_FLIP: the model stood plate-up; it was turned 180 deg about X so the print starts at the plate.')
    _t_run0 = _time.perf_counter()
    notes.append('Mesh: %d vertices, %d triangles (loaded in %.1f s).' % (len(tm.vertices), len(tm.faces), _TIMES.get('mesh_from_brep', 0.0) + _TIMES.get('load_mesh', 0.0)))
    zmin, zmax = tm.bounds[0][2], tm.bounds[1][2]
    height = zmax - zmin
    bz_ = getattr(tm, '_brep_z', None)
    if bz_ is not None:
        notes.append('Height: Brep %.2f mm, mesh %.2f mm (z %.2f to %.2f).' % (bz_[1] - bz_[0], height, zmin, zmax))
        if (bz_[1] - bz_[0]) - height > 1.0:
            notes.append('WARNING: the mesh is %.2f mm high but the Brep is %.2f mm: part of the Brep (its top or bottom faces) did not mesh, so the part is sliced too low. Check the Brep (Rhino: Check / ShowEdges) or join it again.' % (height, bz_[1] - bz_[0]))
    # layers
    fl, lh = S['FIRST_LAYER_HEIGHT'], S['LAYER_HEIGHT']
    tops = [fl]
    while tops[-1] < height - 1e-6:
        tops.append(min(tops[-1] + lh, height))
    if len(tops) > 2 and tops[-1] - tops[-2] < 0.5 * lh:
        tops.pop(-2)                               # merge a thin last layer into the one below
        notes.append('Last layer thickened to %.2f mm (remainder was thin).' % (tops[-1] - tops[-2]))
    layers = list(zip([0.0] + tops[:-1], tops))

    curves = []
    for c in pat['curves']:
        pts = [(p[0] * ps, p[1] * ps) for p in c['pts']]
        curves.append((c['name'], pts, bool(c['closed'])))
    ref = Polygon([(p[0] * ps, p[1] * ps) for p in pat['reference']['outer']],
                  [[(p[0] * ps, p[1] * ps) for p in h] for h in pat['reference']['holes']])
    ref_zone = ref.buffer(0.2)
    lobes = []
    blue_flags = None
    if S['ADAPT_CIRCLES']:
        z0 = ref.buffer(-(band + bead / 2.0), 64)
        lobes = lobe_setup(z0, [[(p[0] * ps, p[1] * ps) for p in h] for h in pat['reference']['holes'][1:]], band + bead / 2.0)
        for nm_, cl_, c_ in curves:
            if nm_ == 'blue':
                blue_flags = contact_flags(cl_, lobes, z0)
    _lobe_skip = unary_union([Point(lb['c']).buffer(lb['r_cap'], 32) for lb in lobes]) if lobes else None     # the round lobes: the weave around the holes is not tightened
    min_piece = S['MIN_PIECE_LENGTH'] if S['MIN_PIECE_LENGTH'] is not None else bead

    bb = tm.bounds
    out_layers = []
    _sec_cache = {}

    pad_notes = set()
    z_plate = None                                       # where the full plate starts when the Brep has only pads under the holes below it
    if S['PLATE_FROM_BOTTOM']:
        for k_ in range(0, 400):
            zc_ = zmin + 0.05 + 0.1 * k_
            Pc_ = section(tm, zc_, simplify=S['OUTLINE_TOLERANCE'])
            if Pc_ is not None and len(getattr(Pc_, 'geoms', [Pc_])) == 1 and len(Pc_.interiors) >= 4:
                if k_ > 2:
                    z_plate = zc_
                break
        if z_plate is not None:
            notes.append('The plate of the Brep starts at z %.2f mm; below it there are only the pads under the holes. Every layer below it is sliced like the plate (the plate is carried down to z %.2f mm).' % (z_plate - zmin, zmin))

    def _sec(zz):
        if z_plate is not None and zz < z_plate:
            zz = z_plate
        if zz not in _sec_cache:
            P_ = section(tm, zz, simplify=S['OUTLINE_TOLERANCE'])
            if P_ is not None and S['IGNORE_PADS'] > 0 and hasattr(P_, 'geoms') and len(P_.geoms) > 1:      # small separate islands (pads / plugs left over in the holes) are not printed
                big_ = max(g_.area for g_ in P_.geoms)
                keep_ = [g_ for g_ in P_.geoms if g_.area >= S['IGNORE_PADS'] / 100.0 * big_]
                if len(keep_) < len(P_.geoms):
                    pad_notes.add('z %.1f mm: %d small island(s) ignored' % (zz, len(P_.geoms) - len(keep_)))
                    P_ = unary_union(keep_)
            _sec_cache[zz] = P_
        return _sec_cache[zz]
    # layer outlines; with MAX_WALL_STEP the walls that retreat quickly are held back to a gentle slope
    _eff = {}
    if S['MAX_WALL_STEP'] > 0:
        stp = S['MAX_WALL_STEP']
        pe = None
        for li_, (zb_, zt_) in enumerate(layers):
            P_ = _sec(zmin + (zb_ + zt_) / 2.0)
            if P_ is not None and pe is not None:
                keep_ = pe.buffer(-stp, 16).intersection(P_.buffer(0.75 * stp, 16))
                if not keep_.is_empty:
                    P_ = P_.union(keep_).buffer(0)
            _eff[li_] = P_
            pe = P_ if P_ is not None else pe
        _sec = lambda zz, _m={zmin + (zb_ + zt_) / 2.0: i_ for i_, (zb_, zt_) in enumerate(layers)}: _eff[_m[zz]]
    open_at, arch_corr = (arch_corridors(_sec, layers, zmin, S['EXTERNAL_PERIMETER_WIDTH'], S) if S['ARCH_PULL'] else (None, []))
    if arch_corr:
        notes.append('Arch opens at layer %d: %d corridor(s) rebuilt (wall runs + U under each leg-end wall) on layers 0 to %d.' % (open_at, len(arch_corr), open_at - 1))
    if arch_corr and S['CROWN_FILL']:                         # the tip of the arch crown cuts narrow slits into the walls of the last layers before the opening: fill them
        for _lc in range(max(0, open_at - 2), open_at):
            _kc = zmin + (layers[_lc][0] + layers[_lc][1]) / 2.0
            _Pc = _sec(_kc)
            if _Pc is None or _Pc.is_empty:
                continue
            _fx, _nf = clean_crown(_Pc, S['CROWN_MAX_AREA'])
            if _nf:
                if _eff:
                    _eff[_lc] = _fx
                else:
                    _sec_cache[_kc] = _fx
                notes.append('Layer %d: %d narrow slit(s) of the arch crown tip filled (CROWN_FILL).' % (_lc, _nf))
    prev_neck = {}
    cur = ((bb[0][0] + bb[1][0]) / 2.0, (bb[0][1] + bb[1][1]) / 2.0)
    for li, (zb, zt) in enumerate(layers):
        h = zt - zb
        P = _sec(zmin + (zb + zt) / 2.0)
        paths = []
        if P is None:
            out_layers.append(dict(index=li, z=zt, height=h, paths=[]))
            continue
        wext = S['FIRST_LAYER_WIDTH'] if li == 0 else S['EXTERNAL_PERIMETER_WIDTH']
        wper = S['FIRST_LAYER_WIDTH'] if li == 0 else S['PERIMETER_WIDTH']
        winf = S['FIRST_LAYER_WIDTH'] if li == 0 else bead
        # the first layer is printed wider (FIRST_LAYER_WIDTH), so its touching lines overlap by FIRST_LAYER_WIDTH - (bead - 0.2); the other layers get the same overlap
        if S['INFILL_INFILL_OVERLAP'] > 0:
            tdist_li = (S['FIRST_LAYER_WIDTH'] if li == 0 else bead) * (1.0 - S['INFILL_INFILL_OVERLAP'] / 100.0)
        else:
            tdist_li = (bead - 0.2) if (li == 0 or not S['CONTACT_LIKE_FIRST_LAYER']) else bead - (S['FIRST_LAYER_WIDTH'] - (bead - 0.2))
        lband = wext + (n - 1) * wper
        pieces = []
        ring_cls = {}
        for k in range(n):
            d = wext / 2.0 if k == 0 else wext + (k - 0.5) * wper
            g = P.buffer(-d, 32)
            for pp_ in polys_of(g):
                rr = [(list(pp_.exterior.coords), 'outer')]
                for i_ in pp_.interiors:
                    pa = Polygon(i_)
                    circ_ = 4 * math.pi * pa.area / (i_.length ** 2) if i_.length > 0 else 1.0
                    rr.append((list(i_.coords), 'circle' if circ_ >= 0.9 else 'tri'))
                for r, cls_ in rr:
                    ring_cls[id(r)] = cls_
                    pieces.append((r, True, 'external' if k == 0 else 'perimeter'))
        # one wall per boundary: a loop that lies within 1.5 beads of a loop already kept is a duplicate and is dropped
        kept = []
        for pc in pieces:
            if pc[2] == 'external':
                ls_ = LineString(pc[0])
                dup = False
                for kp in kept:
                    if ring_cls.get(id(kp[0])) == ring_cls.get(id(pc[0])) and ls_.hausdorff_distance(LineString(kp[0])) < 1.5 * wext:
                        dup = True
                        break
                if dup:
                    notes.append('Layer %d: dropped a duplicate perimeter loop.' % li)
                    continue
            kept.append(pc)
        pieces = kept
        if li < 2:
            cnt = {}
            for pc in pieces:
                cnt[ring_cls.get(id(pc[0]))] = cnt.get(ring_cls.get(id(pc[0])), 0) + 1
            notes.append('Layer %d perimeter loops: triangle %d, round holes %d, outer %d (PERIMETERS=%d).' % (li, cnt.get('tri', 0), cnt.get('circle', 0), cnt.get('outer', 0), n))
        if not S['EXTERNAL_PERIMETERS_FIRST']:
            pieces.sort(key=lambda t: 0 if t[2] == 'perimeter' else 1)
        else:
            pieces.sort(key=lambda t: 0 if t[2] == 'external' else 1)
        gband = S['EXTERNAL_PERIMETER_WIDTH'] + (n - 1) * S['PERIMETER_WIDTH']   # weave geometry identical on every layer
        inner = P.buffer(-gband, 32)
        weave = {'blue': [], 'green': [], 'neck': []}
        cur_neck = {}
        fill = []
        if not inner.is_empty:
            zone = P.buffer(-(gband + bead / 2.0 - S['INFILL_PERIMETER_OVERLAP'] / 100.0 * bead), 64)
            nz = None
            if not zone.is_empty:
                for name, cl, closed0 in curves:
                    if lobes and name == 'blue':
                        cl0 = cl
                        cl = warp_curve(cl, lobes, zone, S['ADAPT_FADE'])
                        cl = pull_contacts(cl0, cl, blue_flags, zone, S['ADAPT_PULL'], S['ADAPT_BLEND'], S['ADAPT_NEAR'], lobes)
                    part = 'neck' if name.startswith('neck') else name
                    if part == 'neck' and S['NECK_LAYER_STEP'] > 1 and li % int(S['NECK_LAYER_STEP']) != 0:
                        continue                              # this layer carries no neck loops
                    res = snap_clip(cl, closed0, zone, S['SNAP_DISTANCE'], min_piece)
                    if part == 'neck' and S['KEEP_NECKS_CLOSED']:
                        if len(res) == 1 and res[0][1]:
                            pass                                  # not cut: the base loop, unchanged
                        else:
                            if nz is None:
                                oth = [LineString(p_[0]) for k_ in ('blue', 'green') for p_ in weave[k_] if len(p_[0]) > 1]
                                nz = zone.difference(unary_union(oth).buffer(bead - 0.2)) if oth else zone
                            loops = clip_neck(Polygon(cl).buffer(0), nz, bead)
                            pv = prev_neck.get(name)
                            if pv and loops and max(max_gap(lp, pv) for lp in loops) > S['NECK_MAX_OVERHANG']:
                                # too far from the layer below: build it from the previous layer's loop instead
                                alt = []
                                for lp in pv:
                                    alt.extend(clip_neck(Polygon(lp).buffer(0), nz, bead))
                                if alt:
                                    loops = alt
                            if loops:
                                gap = max(max_gap(lp, pv) for lp in loops) if pv else 0.0
                                if gap > S['NECK_MAX_OVERHANG'] + 0.5:
                                    notes.append('Layer %d %s: neck overhangs the layer below by %.1f mm.' % (li, name, gap))
                            res = [(lp, True) for lp in loops]
                        cur_neck[name] = [p for p, c_ in res if c_]
                    for pts, closed in res:
                        weave[part].append((pts, closed, 'infill_' + part))
            wall_contact(weave, zone, bead, S)
            if S['CONTACT_GAP'] > 0 and not zone.is_empty:
                regularize(weave, zone, bead, S)
                wall_contact(weave, zone, bead, S)
            if S['TIGHTEN_CONTACTS'] and not zone.is_empty:
                tighten(weave, zone, bead, S, tdist_li + S['TIGHTEN_BIAS'], _lobe_skip)
            if S['NECK_CONTACT'] > 0 and weave['neck'] and not zone.is_empty:
                neck_contact(weave, bead, S, tdist_li + S['TIGHTEN_BIAS'], [pc_[0] for pc_ in pieces if ring_cls.get(id(pc_[0])) == 'circle'])
            if arch_corr and li < open_at and not zone.is_empty:
                for cr_dw in arch_corr:
                    cr_dw['_dw'] = []
                arch_ladder(weave, zone, bead, arch_corr, S)
                if S['ARCH_ROUND'] > 0 and any(c_.get('_steep') for c_ in arch_corr):
                    tri_ = [pc_[0] for pc_ in pieces if ring_cls.get(id(pc_[0])) == 'tri']
                    if tri_:
                        round_weave(weave, tri_[0], arch_corr, zone, S)
                        if S['TIGHTEN_CONTACTS']:
                            tighten(weave, zone, bead, S, tdist_li + S['TIGHTEN_BIAS'], _lobe_skip)
            if S['FILL_OUTSIDE_PATTERN'] and (li > 0 or S['FILL_FIRST_LAYER']):
                extra = inner.difference(ref_zone).buffer(-bead * 0.45).buffer(bead * 0.45)
                for pp in polys_of(extra):
                    if pp.area > max(bead * bead, S['FILL_MIN_AREA']):
                        for r in concentric(pp, winf, winf / 2.0):
                            fill.append((r, True, 'fill'))
        if S['MIN_OPEN_PATH'] > 0:                           # short open paths are not printed
            nsh_ = 0
            for part_ in ('blue', 'green', 'neck'):
                kp_ = []
                for p_ in weave[part_]:
                    if p_[1] or (len(p_[0]) > 1 and LineString(p_[0]).length >= S['MIN_OPEN_PATH']):
                        kp_.append(p_)
                    else:
                        nsh_ += 1
                weave[part_] = kp_
            fk_ = [f_ for f_ in fill if f_[1] or (len(f_[0]) > 1 and LineString(f_[0]).length >= S['MIN_OPEN_PATH'])]
            nsh_ += len(fill) - len(fk_)
            fill[:] = fk_
            if nsh_:
                notes.append('Layer %d: %d open paths shorter than %.0f mm dropped.' % (li, nsh_, S['MIN_OPEN_PATH']))
        if arch_corr and li < open_at:
            flatten_walls(pieces, arch_corr, S, ring_cls)
        # print order: perimeters, outer weave, triangle weave, neck loops, then fill
        seq = []
        per = [p for p in pieces]
        # perimeters keep their inner->outer order; only the start points are ordered
        # perimeter order: triangle opening, then the round holes, then the outer outline
        connected = 'tri' in ring_cls.values()          # the triangle opening is still enclosed: first layers; else the legs are separate (top layers)
        for cls_name in ('tri', 'circle', 'outer'):
            for grp_kinds in ((('perimeter',), ('external',)) if not S['EXTERNAL_PERIMETERS_FIRST'] else (('external',), ('perimeter',))):
                grp = [p for p in per if p[2] in grp_kinds and ring_cls.get(id(p[0])) == cls_name]
                inw = False
                if cls_name == 'outer' and not connected and S['SEAM_TOP_AT_ARC']:
                    inw = 'arc'
                elif cls_name == 'outer' and connected and S['SEAM_FIRST_AT_NECK']:
                    inw = 'neck'
                elif cls_name == 'circle' and connected and S['SEAM_HOLE_AT_NECK']:
                    inw = True
                o, cur = order(grp, cur, S, inw)
                seq.extend(o)
        # weave order: the triangle (green) weave, then the large outer (blue) weave, then the neck loops
        for part in ('green', 'blue', 'neck'):
            o, cur = order(weave[part], cur, S)
            seq.extend(o)
        o, cur = order(fill, cur, S)
        seq.extend(o)
        for pts, closed, kind in seq:
            w = S['FIRST_LAYER_WIDTH'] if li == 0 else (wext if kind == 'external' else wper if kind == 'perimeter' else winf)
            part = kind[7:] if kind.startswith('infill_') else ''
            paths.append(dict(type='infill' if part else kind, part=part, closed=bool(closed), width=w,
                              pts=np.round(np.asarray(pts, dtype=float)[:, :2], 3).tolist()))
        dw_runs = []                                  # double-wall tag: centre lines of the weave runs that lie along a corridor wall (paired with the perimeter), measured on this layer
        for cr_dw in (arch_corr or []):
            for seg_ in cr_dw.get('_dw', []):
                if len(seg_) >= 2:
                    dw_runs.append(np.round(np.asarray(seg_, dtype=float)[:, :2], 3).tolist())
            cr_dw['_dw'] = []
        dw_len = sum(sum(math.hypot(q_[k_ + 1][0] - q_[k_][0], q_[k_ + 1][1] - q_[k_][1]) for k_ in range(len(q_) - 1)) for q_ in dw_runs)
        out_layers.append(dict(index=li, z=round(zt, 4), height=round(h, 4), paths=paths, double_wall=dw_runs, double_wall_mm=round(dw_len, 2)))
        prev_neck = cur_neck
    if pad_notes:
        zs_ = sorted(float(x_.split()[1]) for x_ in pad_notes)
        notes.append('Small islands (pads / plugs, under %.0f %% of the largest island of the layer) were not printed on %d slice heights, z %.1f to %.1f mm.' % (S['IGNORE_PADS'], len(zs_), zs_[0], zs_[-1]))
    _dw_tot = sum(L_.get('double_wall_mm', 0.0) for L_ in out_layers)
    _dw_lay = [L_.get('double_wall_mm', 0.0) for L_ in out_layers if L_.get('double_wall_mm', 0.0) > 0]
    if _dw_lay:
        notes.append('Double wall (weave lines along the corridor walls): %.2f m printed over %d layers (%.0f mm per layer on layer 1, plan length counted once).' % (_dw_tot / 1000.0, len(_dw_lay), _dw_lay[0]))
    notes.append('Time: slicing %.1f s (%s).' % (_time.perf_counter() - _t_run0, ', '.join('%s %.1f s' % (k_, v_) for k_, v_ in sorted(_TIMES.items(), key=lambda kv_: -kv_[1]) if v_ >= 0.05)))
    out = dict(version=1, units='mm', part_center=[(bb[0][0] + bb[1][0]) / 2.0, (bb[0][1] + bb[1][1]) / 2.0],
               part_height=height, settings={k: S[k] for k in _NAMES if k not in ('INPUT_FILE',)},
               notes=notes, layers=out_layers)
    if S['SEAM_STACK_TOL'] > 0:
        stack_seams(out_layers, S['SEAM_STACK_TOL'], notes)
    for Lr in out['layers']:                 # remove repeated points (Rhino rejects zero-length segments as invalid curves)
        keep = []
        for pth in Lr['paths']:
            q = [pth['pts'][0]]
            for pt in pth['pts'][1:]:
                if abs(pt[0] - q[-1][0]) > 1e-6 or abs(pt[1] - q[-1][1]) > 1e-6:
                    q.append(pt)
            if len(q) < 2 or (pth['closed'] and len(q) < 4):
                continue
            pth['pts'] = q
            keep.append(pth)
        Lr['paths'] = keep
    out['results'] = compute_results(out['layers'], out['part_center'], out['notes'])
    return out


def compute_results(layers, part_center, notes):
    """results of the slicer for the software (written to toolpaths.json 'results'; nothing in the toolpaths changes):
    net bottom / top surface area (union of the bead footprints of the first / last layer, cavities excluded),
    share of the infill length inside the cylinders (round lobes: circle of radius R around each round-hole centre, R = median distance from the hole
    centre to the outer outline of that lobe) and in the walls (all other infill), and the double-wall length (tag written by arch_ladder)."""
    pc = np.array(part_center, float)

    def bead_area(L):
        g = [LineString(p['pts']).buffer(p['width'] / 2.0, cap_style=2, join_style=1) for p in L['paths'] if len(p['pts']) > 1]
        return unary_union(g).area if g else 0.0
    res = dict(net_bottom_area_mm2=round(bead_area(layers[0]), 1), net_top_area_mm2=round(bead_area(layers[-1]), 1))
    tot = cyl = 0.0
    for L in layers:
        holes, outl = [], []
        for p in L['paths']:
            if p['type'] in ('external', 'perimeter') and p['closed'] and len(p['pts']) >= 4:
                pg = Polygon(p['pts'])
                if pg.area > 1.0 and 4.0 * math.pi * pg.area / (pg.length ** 2) > 0.9 and pg.area < 2000.0:
                    holes.append(np.array(pg.centroid.coords[0]))
                    continue
            if p['type'] == 'external':
                outl.append(np.array(p['pts'], float))
        discs = []
        if holes and outl:
            O = np.vstack(outl)
            for c in holes:
                u = c - pc
                nu = np.linalg.norm(u)
                if nu < 1e-6:
                    continue
                df = np.linalg.norm(O - c, axis=1)[((O - c) @ (u / nu)) > 0]
                if len(df):
                    discs.append(Point(float(c[0]), float(c[1])).buffer(float(np.median(df[df > 0.8 * df.max()]))))
        disc = unary_union(discs) if discs else None
        for p in L['paths']:
            if p['type'] != 'infill' or len(p['pts']) < 2:
                continue
            ls = LineString(p['pts'])
            tot += ls.length
            if disc is not None:
                cyl += ls.intersection(disc).length
    res['infill_length_mm'] = round(tot, 1)
    res['infill_in_cylinders_mm'] = round(cyl, 1)
    res['infill_in_walls_mm'] = round(tot - cyl, 1)
    res['infill_in_cylinders_pct'] = round(100.0 * cyl / tot, 1) if tot > 0 else 0.0
    res['infill_in_walls_pct'] = round(100.0 * (tot - cyl) / tot, 1) if tot > 0 else 0.0
    dw = [L.get('double_wall_mm', 0.0) for L in layers]
    res['double_wall_printed_mm'] = round(sum(dw), 1)
    res['double_wall_plan_mm'] = round(max(dw), 1) if dw else 0.0
    notes.append('Results: net bottom %.1f cm2, net top %.1f cm2, infill in cylinders %.1f %%, in walls %.1f %%, double wall %.2f m printed (%.0f mm in plan).' % (
        res['net_bottom_area_mm2'] / 100.0, res['net_top_area_mm2'] / 100.0, res['infill_in_cylinders_pct'], res['infill_in_walls_pct'], res['double_wall_printed_mm'] / 1000.0, res['double_wall_plan_mm']))
    return res


def preview(out, S):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    n = len(out['layers'])
    ids = [int(v) for v in str(S['PREVIEW_LAYERS']).split(',') if v.strip()]
    ids = [(i % n) for i in ids]
    fig, axs = plt.subplots(1, len(ids), figsize=(5 * len(ids), 5.4))
    axs = np.atleast_1d(axs)
    col = {'external': '#c0392b', 'perimeter': '#e67e22', 'infill': '#0072bd', 'fill': '#27ae60'}
    for ax, i in zip(axs, ids):
        L = out['layers'][i]
        for p in L['paths']:
            x, y = zip(*p['pts'])
            ax.plot(x, y, color=col[p['type']], lw=1.4)
        ax.set_title('layer %d  z=%.1f mm' % (i, L['z']), fontsize=9)
        ax.set_aspect('equal')
        ax.axis('off')
    fig.savefig(S['PREVIEW_PNG'], dpi=90, bbox_inches='tight')


def main(argv=None):
    S = get_settings(sys.argv[1:] if argv is None else argv)
    if not S['INPUT_FILE']:
        raise SystemExit('Set INPUT_FILE in the settings or run: python weave_slice.py part.3dm pattern.json toolpaths.json')
    out = run(S)
    S['OUTPUT_FILE'] = clean_path(S['OUTPUT_FILE'], 'toolpaths.json')
    open(S['OUTPUT_FILE'], 'w').write(json.dumps(out, separators=(',', ':')))
    npaths = sum(len(l['paths']) for l in out['layers'])
    print('layers: %d, paths: %d, height %.1f mm' % (len(out['layers']), npaths, out['part_height']))
    for nt in out['notes']:
        print('NOTE:', nt)
    print('wrote', S['OUTPUT_FILE'])
    if S['PREVIEW_PNG']:
        preview(out, S)
        print('wrote', S['PREVIEW_PNG'])



def clean_path(p, default_name):
    """strip quotes/spaces; a folder (or a name without extension) gets default_name; make the folder."""
    import os
    p = str(p).strip().strip('"').strip("'").strip()
    if not p:
        p = default_name
    if os.path.isdir(p) or p.endswith(('/', '\\')) or not os.path.splitext(p)[1]:
        p = os.path.join(p, default_name)
    d = os.path.dirname(p)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    return p


def gh_main():
    S = get_settings([])
    out = run(S)
    if _HOST.get('OUTPUT_FILE'):      # in Grasshopper the JSON file is only written when you give OUTPUT_FILE
        S['OUTPUT_FILE'] = clean_path(S['OUTPUT_FILE'], 'toolpaths.json')
        open(S['OUTPUT_FILE'], 'w').write(json.dumps(out, separators=(',', ':')))
    inv = 1.0 / S['MODEL_UNITS_TO_MM']
    paths, types, layers = [], [], []
    for L in out['layers']:
        for p in L['paths']:
            pts = [rg.Point3d(x * inv, y * inv, L['z'] * inv) for x, y in p['pts']]
            if p['closed'] and (abs(p['pts'][0][0] - p['pts'][-1][0]) > 1e-6 or abs(p['pts'][0][1] - p['pts'][-1][1]) > 1e-6):
                pts.append(pts[0])
            crv = rg.PolylineCurve(pts)
            if not crv.IsValid:
                continue                    # never output an invalid curve
            paths.append(crv)
            types.append(p['type'])
            layers.append(L['index'])
    log = ['layers: %d, paths: %d' % (len(out['layers']), len(paths))] + list(out['notes']) + (['wrote ' + str(S['OUTPUT_FILE'])] if _HOST.get('OUTPUT_FILE') else ['no JSON file written (wire PatternJson / ToolpathsJson instead)'])
    return paths, types, layers, log, json.dumps(out, separators=(',', ':'))


if HAVE_RHINO:
    try:
        if _HOST.get('Brep') is None:
            raise ValueError('The Brep input is empty. Add an input named exactly Brep (Item access) and connect the part to it. '
                             'Inputs seen: ' + ', '.join(sorted(k for k in _HOST if not k.startswith('_') and k[:1].isalpha() and k not in ('Rhino', 'rg'))[:12]))
        Paths, PathType, PathLayer, Log, ToolpathsJson = gh_main()
    except Exception:                      # never leave Log empty: an error text appears there instead of a silent null
        import traceback
        Paths, PathType, PathLayer, ToolpathsJson = [], [], [], ''
        Log = ['ERROR - the slicer stopped:'] + traceback.format_exc().splitlines()
elif __name__ == '__main__':
    main()