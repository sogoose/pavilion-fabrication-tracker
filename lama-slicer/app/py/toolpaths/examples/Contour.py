"""Contour: concentric walls on every layer, for any shape (example and template for custom toolpaths).

HOW A CUSTOM TOOLPATH WORKS (Toolpath panel > Import toolpath...)
  A custom toolpath is one Python file with a function

      generate(mesh, settings) -> list of layers

  mesh      trimesh.Trimesh of ONE object, in plate coordinates (mm), standing on z = 0
            (placed and rotated as on the plate)
  settings  dict: nozzle, layer_height, first_layer_height (mm), from the Print settings panel

  Return a list of layers, bottom to top:
      {'z': top of the layer (mm), 'height': layer height (mm),
       'paths': [{'type': 'external' | 'perimeter' | 'infill' | 'fill',
                  'closed': True / False,
                  'width': bead width (mm),
                  'pts': [[x, y], [x, y], ...]}, ...]}      # in print order

  LAMA Slicer then previews it and writes the WASP / Comau G-code and the PDL with the same
  writer as N2, so speeds, flow and naming all work as for N1 / N2.
  Available in the script: numpy, shapely, trimesh (and the Python standard library).
  NAME, DEFAULTS and ADVANCED below are optional: DEFAULTS can set LAYER_HEIGHT,
  FIRST_LAYER_HEIGHT, INFILL_WIDTH (= nozzle) for this toolpath. ADVANCED lists constants of
  the script that appear in the toolpath's "Advanced settings" panel (key, label, unit, step,
  min, max, int, hint); LAMA Slicer sets them before calling generate().
"""
import math

import numpy as np
import trimesh
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

NAME = 'Contour'
DEFAULTS = {'LAYER_HEIGHT': 3.5, 'FIRST_LAYER_HEIGHT': 2.0, 'INFILL_WIDTH': 6.0}

WALLS = 2              # number of concentric walls

# Advanced settings panel in LAMA Slicer
ADVANCED = [
    {'key': 'WALLS', 'label': 'Walls', 'unit': '', 'step': 1, 'min': 1, 'max': 20, 'int': True,
     'hint': 'Number of concentric walls, outer wall first.'},
]
WALL_OVERLAP = 0.15    # walls overlap by this fraction of the bead width
MIN_AREA = 50.0        # mm2, smaller islands are skipped
SIMPLIFY = 0.05        # mm, outline simplification


def section(mesh, z):
    """section of the mesh at height z -> shapely (Multi)Polygon"""
    seg = trimesh.intersections.mesh_plane(mesh, [0, 0, 1], [0, 0, z])
    if len(seg) == 0:
        return None
    q = lambda p: (round(p[0], 3), round(p[1], 3))
    lines = [LineString([q(s[0][:2]), q(s[1][:2])]) for s in seg]
    lines = [l for l in lines if l.length > 0]
    res = None
    for p in polygonize(unary_union(lines)):
        f = Polygon(p.exterior)
        res = f if res is None else res.symmetric_difference(f)
    return res


def rings(geom):
    """all boundary rings (outer and holes) of a (Multi)Polygon"""
    polys = [geom] if geom.geom_type == 'Polygon' else list(getattr(geom, 'geoms', []))
    out = []
    for p in polys:
        if p.is_empty or p.area < MIN_AREA:
            continue
        out.append(list(p.exterior.coords))
        out += [list(i.coords) for i in p.interiors]
    return out


def start_near(ring, xy):
    """rotate a closed ring so it starts at the point nearest to xy (short travels)"""
    pts = ring[:-1]
    if xy is None or not pts:
        return ring
    k = min(range(len(pts)), key=lambda i: (pts[i][0] - xy[0]) ** 2 + (pts[i][1] - xy[1]) ** 2)
    pts = pts[k:] + pts[:k]
    return pts + [pts[0]]


def generate(mesh, settings):
    w = float(settings['nozzle'])
    h1, h = float(settings['first_layer_height']), float(settings['layer_height'])
    top = float(mesh.bounds[1][2])
    zs, z = [], h1
    while z <= top + 1e-6:
        zs.append(z)
        z += h
    if zs and top - zs[-1] > 0.3 * h:          # last partial layer
        zs.append(top)
    layers, last = [], None
    for i, z in enumerate(zs):
        height = h1 if i == 0 else z - zs[i - 1]
        sec = section(mesh, z - height / 2.0)  # cut at mid-layer
        if sec is None or sec.is_empty:
            continue
        sec = sec.buffer(0)
        paths = []
        step = w * (1 - WALL_OVERLAP)
        for k in range(WALLS):                  # outer wall first, then inwards
            g = sec.buffer(-(w / 2.0 + k * step), join_style=2, mitre_limit=2.0)
            if g.is_empty:
                break
            g = g.simplify(SIMPLIFY)
            for r in rings(g):
                r = start_near(r, last)
                paths.append(dict(type='external' if k == 0 else 'perimeter', closed=True, width=w,
                                  pts=[[round(x, 3), round(y, 3)] for x, y in r]))
                last = r[-1]
        if paths:
            layers.append(dict(z=round(z, 3), height=round(height, 3), paths=paths))
    return layers
