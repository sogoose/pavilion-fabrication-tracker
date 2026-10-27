"""Orthogonal fill: walls + straight infill lines that turn 90 degrees every layer (0 / 90 / 0 / 90 ...).

Custom toolpath for LAMA Slicer (Toolpath panel > Import toolpath...). It works for any shape
and any size, so it is the toolpath to use for small or scaled-down parts that N1 / N2 refuse.

Per layer:
  1. WALLS concentric walls (outer wall first, then inwards)
  2. infill: parallel lines, SPACING apart, clipped to the area inside the walls.
     Even layers run along X, odd layers along Y (or ANGLE / ANGLE + 90 degrees).
     Neighbouring lines are joined into one zig-zag bead where the joining move stays
     inside the part, so the nozzle does not stop and start on every line.
  3. gap fill: places the lines cannot reach (narrow corners, lobes, small islands) and that
     are wider than the gap the line spacing asks for get extra lines, so no blank spaces
     are left at the corners. All limits scale with the bead width (1 mm or 6 mm nozzle).

The contract (generate(mesh, settings) -> layers) is described in Contour.py.
"""
import math
import sys

import trimesh
from shapely import affinity
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.geometry import Point
from shapely.ops import polygonize, substring, unary_union

NAME = 'Orthogonal'
DEFAULTS = {'LAYER_HEIGHT': 3.5, 'FIRST_LAYER_HEIGHT': 2.0, 'INFILL_WIDTH': 6.0}

WALLS = 1              # number of concentric walls (0 = infill only)
WALL_OVERLAP = 0.15    # walls overlap by this fraction of the bead width
INFILL_OVERLAP = 0.15  # infill overlaps the inner wall by this fraction of the bead width
SPACING = 1.0          # line distance as a multiple of the bead width (1.0 = solid, 2.0 = 50 % ...)
ANGLE = 0.0            # deg, direction of the first layer; every next layer turns by 90

# Advanced settings panel in LAMA Slicer (any constant above can be listed here)
ADVANCED = [
    {'key': 'ANGLE', 'label': 'Orientation', 'unit': 'deg', 'step': 15, 'min': -180, 'max': 180,
     'hint': 'Direction of the lines on layer 1; every next layer turns 90 deg.'},
    {'key': 'SPACING', 'kind': 'spacing', 'label': 'Line spacing', 'min': 1.0, 'max': 10.0,
     'hint': 'Distance between the infill lines. Infill density = bead width / line spacing.'},
]
MIN_AREA = 0.5         # x bead width^2: smaller islands are skipped
MIN_LINE = 0.5         # x bead width: shorter infill lines are skipped
GAP_FILL = True        # fill blank spaces wider than the line spacing leaves on purpose
GAP_MIN = 0.25         # x bead width^2: smaller blank spaces are left as they are
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


_W = 6.0               # bead width of the current call (set by generate)


def polygons(geom):
    if geom is None or geom.is_empty:
        return []
    polys = [geom] if geom.geom_type == 'Polygon' else list(getattr(geom, 'geoms', []))
    return [p for p in polys if p.geom_type == 'Polygon' and p.area >= MIN_AREA * _W * _W]


def rings(geom):
    out = []
    for p in polygons(geom):
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


def link_path(a, b, inside, ring_list, step):
    """connecting move a -> b: straight if it stays inside the area, otherwise along the
    area's boundary (around a hole or a curved edge) when that is short; None = travel"""
    straight = LineString([a, b])
    if straight.length < 3 * step and inside.contains(straight):
        return [b]
    for ring in ring_list:
        pa, pb = Point(a), Point(b)
        if ring.distance(pa) > 1e-6 or ring.distance(pb) > 1e-6:
            continue
        L = ring.length
        da, db = ring.project(pa), ring.project(pb)
        fwd = (db - da) % L                        # length going forward along the ring
        if min(fwd, L - fwd) > 3 * step:
            return None
        if fwd <= L - fwd:
            arc = substring(ring, da, da + fwd) if da + fwd <= L else \
                LineString(list(substring(ring, da, L).coords) + list(substring(ring, 0, da + fwd - L).coords)[1:])
        else:
            back = L - fwd
            arc = substring(ring, da - back, da) if da - back >= 0 else \
                LineString(list(substring(ring, da - back + L, L).coords) + list(substring(ring, 0, da).coords)[1:])
            arc = LineString(list(arc.coords)[::-1])
        pts = list(arc.coords)[1:]
        return (pts[:-1] if pts else []) + [b]
    return None


def infill_lines(area, angle, step):
    """parallel lines at `angle` (deg), `step` apart, clipped to `area`; zig-zag ordered chains"""
    c = area.centroid
    rot = affinity.rotate(area, -angle, origin=c)          # work with horizontal lines
    x0, y0, x1, y1 = rot.bounds
    rows = []
    n = int(math.floor((y1 - y0) / step))
    off = (y1 - y0 - n * step) / 2.0                         # centre the lines in the part
    for k in range(n + 1):
        y = y0 + off + k * step
        cut = rot.intersection(LineString([(x0 - 1, y), (x1 + 1, y)]))
        segs = [cut] if cut.geom_type == 'LineString' else [g for g in getattr(cut, 'geoms', [])
                                                           if g.geom_type == 'LineString']
        segs = sorted([s for s in segs if s.length >= MIN_LINE * _W], key=lambda s: s.bounds[0])
        if segs:
            rows.append([sorted(s.coords) for s in segs])     # each segment left -> right
    # build chains: take the first free segment, then keep stepping to the next row,
    # alternating direction, as long as the connecting move stays inside the area
    inside = rot.buffer(1e-3)
    ring_list = [LineString(rot.exterior.coords)] + [LineString(i.coords) for i in rot.interiors]
    used = [[False] * len(r) for r in rows]
    chains = []
    for r0 in range(len(rows)):
        for s0 in range(len(rows[r0])):
            if used[r0][s0]:
                continue
            used[r0][s0] = True
            chain = list(rows[r0][s0])
            flip = False
            r = r0
            while r + 1 < len(rows):
                end = chain[-1]
                best = None
                for j, seg in enumerate(rows[r + 1]):
                    if used[r + 1][j]:
                        continue
                    a = seg[-1] if not flip else seg[0]               # next row runs the other way
                    link = link_path(end, a, inside, ring_list, step)
                    if link is not None:
                        ln = LineString([end] + link).length
                        if best is None or ln < best[0]:
                            best = (ln, j, link)
                if best is None:
                    break
                j = best[1]
                used[r + 1][j] = True
                seg = rows[r + 1][j]
                chain += best[2][:-1]                                 # the connecting move
                chain += list(reversed(seg)) if not flip else list(seg)
                flip = not flip
                r += 1
            chains.append(chain)
    # back to plate coordinates
    out = []
    for ch in chains:
        ls = affinity.rotate(LineString(ch), angle, origin=c)
        out.append(list(ls.coords))
    return out


def lines_of(g):
    """all LineStrings in a shapely result"""
    if g.is_empty:
        return []
    if g.geom_type == 'LineString':
        return [g]
    return [x for x in getattr(g, 'geoms', []) for x in lines_of(x)]


def centre_line(region, w):
    """one bead through a narrow region: along the long axis of its smallest enclosing rectangle"""
    rect = region.minimum_rotated_rectangle
    if rect.geom_type != 'Polygon':
        return []
    c = list(rect.exterior.coords)[:4]
    e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    ax = e0 if math.hypot(*e0) >= math.hypot(*e1) else e1
    L = math.hypot(*ax)
    if L < 1e-9:
        return []
    ux, uy = ax[0] / L, ax[1] / L
    p = region.representative_point()
    line = LineString([(p.x - ux * 2 * L, p.y - uy * 2 * L), (p.x + ux * 2 * L, p.y + uy * 2 * L)])
    return [list(l.coords) for l in lines_of(region.intersection(line)) if l.length >= MIN_LINE * w]


def along_wall(region, area, w):
    """a bead that follows the wall (the edge of the infill area) through a thin, curved gap"""
    edge = unary_union([LineString(area.exterior.coords)] + [LineString(i.coords) for i in area.interiors]) \
        if area.geom_type == 'Polygon' else unary_union([LineString(r.coords) for p in area.geoms
                                                            for r in [p.exterior, *p.interiors]])
    return [list(l.coords) for l in lines_of(edge.intersection(region.buffer(1e-3)))
            if l.length >= MIN_LINE * w]


def bead_area(pts, w):
    """area of one bead = union of its segments, each buffered on its own: the same shape as
    LineString(pts).buffer(w / 2) without noding one long self-crossing zig-zag (Pyodide's GEOS can fail on that)"""
    segs = [LineString(pts[i:i + 2]).buffer(w / 2.0) for i in range(len(pts) - 1) if tuple(pts[i]) != tuple(pts[i + 1])]
    return unary_union(segs) if segs else Polygon()


def gap_fill(area, paths, w, step, angle):
    """extra infill lines where the beads leave a blank space wider than the spacing asks for"""
    if sys.platform == 'emscripten':                     # browser version: GEOS there cannot recover from a failed noding
        beads = [bead_area(p['pts'], w) for p in paths if len(p['pts']) > 1]
    else:
        beads = [LineString(p['pts']).buffer(w / 2.0) for p in paths if len(p['pts']) > 1]
    covered = unary_union(beads) if beads else Polygon()
    allow = max(0.0, step - w) / 2.0 + 0.1 * w          # the planned gap between lines is not a hole
    target = area.buffer(w / 2.0)                         # what the infill beads should cover
    blank = target.difference(covered.buffer(allow))
    out = []
    for piece in polygons(blank.buffer(0)) if not blank.is_empty else []:
        if piece.area < GAP_MIN * w * w or piece.buffer(-0.1 * w).is_empty:
            continue
        region = piece.buffer(allow).intersection(area)  # where a bead centre may go
        if region.is_empty:
            continue
        region = region.buffer(0)
        parts = [region] if region.geom_type == 'Polygon' else [g for g in getattr(region, 'geoms', []) if g.geom_type == 'Polygon']
        for reg in parts:                                  # every piece, also the small ones
            if reg.area < 0.05 * w * w:
                continue
            new = infill_lines(reg, angle, step) if reg.area > step * w else []
            if not new and reg.buffer(-0.35 * w).is_empty:   # thin gap: follow the wall if it touches it
                new = along_wall(reg, area, w)
            out += new or centre_line(reg, w)
    return out


def generate(mesh, settings):
    global _W
    w = float(settings['nozzle'])
    _W = w
    h1, h = float(settings['first_layer_height']), float(settings['layer_height'])
    top = float(mesh.bounds[1][2])
    zs, z = [], h1
    while z <= top + 1e-6:
        zs.append(z)
        z += h
    if zs and top - zs[-1] > 0.3 * h:          # last partial layer
        zs.append(top)
    layers, last = [], None
    step_wall = w * (1 - WALL_OVERLAP)
    for i, z in enumerate(zs):
        height = h1 if i == 0 else z - zs[i - 1]
        sec = section(mesh, z - height / 2.0)  # cut at mid-layer
        if sec is None or sec.is_empty:
            continue
        sec = sec.buffer(0)
        paths = []
        for k in range(WALLS):                  # outer wall first, then inwards
            g = sec.buffer(-(w / 2.0 + k * step_wall), join_style=2, mitre_limit=2.0)
            if g.is_empty:
                break
            for r in rings(g.simplify(SIMPLIFY)):
                r = start_near(r, last)
                paths.append(dict(type='external' if k == 0 else 'perimeter', closed=True, width=w,
                                  pts=[[round(x, 3), round(y, 3)] for x, y in r]))
                last = r[-1]
        # infill area: inside the walls (line centres half a bead in from the inner wall)
        if WALLS:
            inset = (WALLS - 1) * step_wall + w / 2.0 + w * (1 - INFILL_OVERLAP)
        else:
            inset = w / 2.0
        area = sec.buffer(-inset, join_style=2, mitre_limit=2.0)
        angle = ANGLE + (90.0 if i % 2 else 0.0)
        for poly in polygons(area) if not area.is_empty else []:
            for ch in infill_lines(poly, angle, w * SPACING):
                if last is not None:                # print the chain from its nearer end
                    d0 = (ch[0][0] - last[0]) ** 2 + (ch[0][1] - last[1]) ** 2
                    d1 = (ch[-1][0] - last[0]) ** 2 + (ch[-1][1] - last[1]) ** 2
                    if d1 < d0:
                        ch = ch[::-1]
                paths.append(dict(type='infill', closed=False, width=w,
                                  pts=[[round(x, 3), round(y, 3)] for x, y in ch]))
                last = ch[-1]
        for _ in range(2 if GAP_FILL and not area.is_empty else 0):   # 2nd pass: what the 1st left
            extra = gap_fill(area, paths, w, w * SPACING, angle)
            if not extra:
                break
            for ch in extra:
                if last is not None and (ch[-1][0] - last[0]) ** 2 + (ch[-1][1] - last[1]) ** 2 < \
                        (ch[0][0] - last[0]) ** 2 + (ch[0][1] - last[1]) ** 2:
                    ch = ch[::-1]
                paths.append(dict(type='infill', closed=False, width=w,
                                  pts=[[round(x, 3), round(y, 3)] for x, y in ch]))
                last = ch[-1]
        if paths:
            layers.append(dict(z=round(z, 3), height=round(height, 3), paths=paths))
    return layers
