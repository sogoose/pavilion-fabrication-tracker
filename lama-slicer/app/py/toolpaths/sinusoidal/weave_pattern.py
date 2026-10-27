#!/usr/bin/env python
# r: numpy, shapely, trimesh
"""weave_pattern.py   -   STEP 1 of 3: BASE WEAVE PATTERN (made once, on the first layer)

Takes the section of the Brep at the first layer (outer outline + central triangular
opening + 3 round holes), builds the sinusoidal weave inside it and saves it as
pattern.json.  weave_slice.py then re-uses this fixed pattern on every layer.

RUN IT
  * Python (needs: numpy shapely trimesh rhino3dm):   python weave_pattern.py [file.3dm|.stl]
  * Grasshopper Python component: add input `Brep` (Item); any name from the SETTINGS
    list below can also be added as an input and then overrides the value in this file.
    Outputs: Pattern (curves), Log, PatternJson (text; wire it into weave_slice.py's PatternJson input).

All lengths in the SETTINGS list are MILLIMETRES.
"""

_HOST = dict(globals())        # values a host (Grasshopper inputs) injected before this file ran
for _k in list(_HOST):         # accept the input name in any letter case: brep / BREP / Brep
    if _k.lower() == 'brep' and _k != 'Brep' and _HOST.get(_k) is not None and _HOST.get('Brep') is None:
        _HOST['Brep'] = _HOST[_k]

# =====================================================================
#  SETTINGS  -  change them here (or feed same-named inputs from Grasshopper)
# =====================================================================
# ---- files --------------------------------------------------------
INPUT_FILE   = ''                 # .3dm / .stl / .obj  (command-line argument wins; unused in Grasshopper)
OUTPUT_FILE  = 'pattern.json'     # pattern written here

# ---- model ---------------------------------------------------------
MODEL_UNITS_TO_MM = 10.0          # 1 model unit = ? mm   (cm model -> 10, mm model -> 1)
REFERENCE_Z       = None          # model-unit height of the section used; None = middle of the first layer
AUTO_FLIP         = True          # a model that stands plate-up (3 separate lobes at the bottom, the connected plate at the top) is turned 180 deg about X so the print starts at the plate; False = use the model as it is

# ---- print widths (from your Prusa config) ------------------------
FIRST_LAYER_HEIGHT   = 2.0        # mm   (first_layer_height)
EXTERNAL_PERIMETER_WIDTH = 6.0    # mm   (external_perimeter_extrusion_width)
PERIMETER_WIDTH      = 5.0        # mm   (perimeter_extrusion_width, inner perimeters)
PERIMETERS           = 1          #      (perimeters)  boundary band = external + (n-1) inner
INFILL_WIDTH         = 6.0        # mm   (infill_extrusion_width = bead width of the weave)

# ---- weave shape ----------------------------------------------------
WAVELENGTH           = 20.0       # mm   target wavelength L (raised automatically if beads would collide)
#                                   SIMPLE SINUSOIDAL (square-toothed, many teeth): AUTO_WAVELENGTH = False, WAVELENGTH = 27, ANCHOR = 8, OVERLAP = 8
#                                   (checked on D01: line lengths within ~10 % of D02_Wasp.gcode; a clearance warning in the log is expected)
AUTO_WAVELENGTH      = True       #      raise L until the beads clear each other
ANCHOR = 8.0        # mm   length of every shared peak contact (4 to 8)
OVERLAP = 8.0        # mm   length of every wall-contact plateau
NECK_REACH           = 8.0        # mm   how far neck loops slide along the surrounding beads
SAMPLES_PER_WAVE     = 48         #      resolution of each wavelength (min 24)
# =====================================================================

import math
import bisect

# ---- 2D polyline helpers ----
# Pure-python 2D polyline helpers (IronPython 2.7 / CPython compatible).

EPS = 1e-9


def sub(p, q): return (p[0] - q[0], p[1] - q[1])
def add(p, q): return (p[0] + q[0], p[1] + q[1])
def mul(p, k): return (p[0] * k, p[1] * k)
def dot(p, q): return p[0] * q[0] + p[1] * q[1]
def dist(p, q): return math.hypot(p[0] - q[0], p[1] - q[1])
def lerp(p, q, t): return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def unit(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > EPS else (0.0, 0.0)


def area(poly):
    s = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return s * 0.5


def centroid(poly):
    a = area(poly)
    cx = cy = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    return (cx / (6 * a), cy / (6 * a))


def cumulative(pts, closed=False):
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + dist(pts[i - 1], pts[i]))
    if closed:
        s.append(s[-1] + dist(pts[-1], pts[0]))
    return s


def interp(xs, ys, x):
    """Piecewise-linear lookup; ys are floats or 2D tuples."""
    i = max(0, min(len(xs) - 2, bisect.bisect_right(xs, x) - 1))
    d = xs[i + 1] - xs[i]
    t = (x - xs[i]) / d if d > EPS else 0.0
    a, b = ys[i], ys[i + 1]
    if isinstance(a, tuple):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return a + (b - a) * t


def resample_closed(pts, n):
    """Uniform arc-length resampling of a closed polyline, n points."""
    c = cumulative(pts, True)
    total = c[-1]
    ext = list(pts) + [pts[0]]
    return [interp(c, ext, total * i / n) for i in range(n)]


def point_in_poly(p, poly):
    x, y = p
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def ray_hit(o, d, poly, tmin=1e-7, closed=True):
    """Smallest t>tmin where ray o+t*d (|d|=1) crosses the polyline."""
    best = None
    n = len(poly)
    last = n if closed else n - 1
    ox, oy = o
    dx, dy = d
    for i in range(last):
        a = poly[i]
        b = poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        den = dx * ey - dy * ex
        if abs(den) < 1e-14:
            continue
        wx, wy = a[0] - ox, a[1] - oy
        t = (wx * ey - wy * ex) / den
        u = (wx * dy - wy * dx) / den
        if t > tmin and -1e-9 <= u <= 1 + 1e-9:
            if best is None or t < best:
                best = t
    return best


def seg_intersections(P, Q, closedP=False, closedQ=False):
    """All proper crossings between two polylines: list of (i, j, point)."""
    out = []
    nP = len(P)
    nQ = len(Q)
    lp = nP if closedP else nP - 1
    lq = nQ if closedQ else nQ - 1
    for i in range(lp):
        a = P[i]
        b = P[(i + 1) % nP]
        minx, maxx = min(a[0], b[0]), max(a[0], b[0])
        miny, maxy = min(a[1], b[1]), max(a[1], b[1])
        for j in range(lq):
            c = Q[j]
            d = Q[(j + 1) % nQ]
            if max(c[0], d[0]) < minx or min(c[0], d[0]) > maxx:
                continue
            if max(c[1], d[1]) < miny or min(c[1], d[1]) > maxy:
                continue
            r = (b[0] - a[0], b[1] - a[1])
            s = (d[0] - c[0], d[1] - c[1])
            den = r[0] * s[1] - r[1] * s[0]
            if abs(den) < 1e-14:
                continue
            t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
            u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                out.append((i, j, (a[0] + r[0] * t, a[1] + r[1] * t)))
    return out


def tangents_closed(pts):
    n = len(pts)
    out = []
    for i in range(n):
        out.append(unit(sub(pts[(i + 1) % n], pts[i - 1])))
    return out


def smooth_closed(vals, half):
    """Circular moving average, window 2*half+1."""
    n = len(vals)
    out = []
    for i in range(n):
        s = 0.0
        for k in range(-half, half + 1):
            s += vals[(i + k) % n]
        out.append(s / (2 * half + 1))
    return out

# ---- wave primitive ----
"""Wave primitive: rail -> target oscillation with wall and peak plateaus."""


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, t)))


class Piece(object):
    """Dense polyline plus plateau records [(kind, i0, i1)] (indices into pts)."""
    def __init__(self):
        self.pts = []
        self.plateaus = []


def build_wave(st, rail, target, s0, s1, cycles, w, a, ds):
    """st: station array (monotone), rail/target: point arrays on that station.
    The wave starts and ends with a wall plateau (half plateau at each end),
    has `cycles` full periods; peak plateaus are centred on odd half-periods
    and are the exact points of `target`."""
    P = (s1 - s0) / float(cycles)
    half = P / 2.0
    n = 2 * cycles
    centres = [s0 + k * half for k in range(n + 1)]
    extent = [(w if k % 2 == 0 else a) / 2.0 for k in range(n + 1)]
    if half - extent[0] - extent[1] < 0.12 * half:
        raise ValueError('plateaus too long for wavelength')
    out = Piece()

    def add(s, f):
        r = interp(st, rail, s)
        t = interp(st, target, s)
        out.pts.append(lerp(r, t, f))

    for k in range(n + 1):
        phi = 0.0 if k % 2 == 0 else 1.0
        lo = centres[k] - extent[k] if k > 0 else s0
        hi = centres[k] + extent[k] if k < n else s1
        i0 = len(out.pts) - 1 if k > 0 else 0
        cnt = max(2, int(math.ceil((hi - lo) / ds)))
        for i in range(cnt + 1):
            if k > 0 and i == 0 and out.pts:
                continue  # already added as end of previous transition
            add(lo + (hi - lo) * i / cnt, phi)
        out.plateaus.append(('wall' if k % 2 == 0 else 'peak', i0, len(out.pts) - 1))
        if k < n:
            a0 = hi
            a1 = centres[k + 1] - extent[k + 1]
            cnt = max(4, int(math.ceil((a1 - a0) / ds)))
            nxt = 1.0 if (k + 1) % 2 == 1 else 0.0
            for i in range(1, cnt):
                t = i / float(cnt)
                add(a0 + (a1 - a0) * t, phi + (nxt - phi) * ease(t))
            # next plateau's first point is added at its loop start (i==0 handled)
            # so insert it explicitly
            add(a1, nxt)
    return out


def arc_stations(pts):
    return cumulative(pts)


def best_counts(R, Lc0, B00, L, nmax=15, mmax=40, kmax=40, emax=None):
    """Choose integer cycle counts and the trim e so that side, corner and
    blue-arc wavelengths are all close to L.  Corner count n is odd so the
    corner tip is a peak (symmetric).  Returns (n, m, k, e, lam_c, lam_s, lam_b)."""
    best = None
    emax = R - 2 * L if emax is None else emax
    emax = max(0.0, emax)
    for n in range(1, nmax + 1, 2):
        for m in range(1, mmax + 1):
            for k in range(1, kmax + 1):
                # f(e) = ((Lc0+e)/n-L)^2 + ((R-e)/m-L)^2 + ((B00+e)/k-L)^2
                num = -((Lc0 / n - L) / n - (R / m - L) / m + (B00 / k - L) / k)
                den = 1.0 / n ** 2 + 1.0 / m ** 2 + 1.0 / k ** 2
                e = max(0.0, min(emax, num / den))
                lc = (Lc0 + e) / n
                ls = (R - e) / m
                lb = (B00 + e) / k
                f = (lc / L - 1) ** 2 + (ls / L - 1) ** 2 + (lb / L - 1) ** 2
                if best is None or f < best[0]:
                    best = (f, n, m, k, e, lc, ls, lb)
    return best[1:]

# ---- algorithm ----
"""Core algorithm (pure python, polylines in cm). See build() at the bottom."""
import os


def right_normals(pts):
    """Right-hand normal of a CCW loop = direction into the material around an opening."""
    T = tangents_closed(pts)
    return [(t[1], -t[0]) for t in T]


def hit_with_seg(o, d, poly):
    """ray hit returning (t, arc position on poly) for a closed polyline."""
    best = None
    n = len(poly)
    c = cumulative(poly, True)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-14:
            continue
        wx, wy = a[0] - o[0], a[1] - o[1]
        t = (wx * ey - wy * ex) / den
        u = (wx * d[1] - wy * d[0]) / den
        if t > 1e-7 and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best[0]):
            best = (t, c[i] + u * (c[i + 1] - c[i]))
    return best


def find_sides(TRI, OUT, L, log):
    n = len(TRI)
    st = cumulative(TRI, True)
    P = st[-1]
    ds = P / n
    nrm = right_normals(TRI)
    T = tangents_closed(TRI)
    ang = [math.atan2(t[1], t[0]) for t in T]
    win = max(2, int(0.5 / ds))
    kappa = []
    for i in range(n):
        d = ang[(i + win) % n] - ang[i - win]
        while d > math.pi: d -= 2 * math.pi
        while d < -math.pi: d += 2 * math.pi
        kappa.append(abs(d) / (2 * win * ds))
    gap = []
    for i in range(n):
        t = ray_hit(TRI[i], nrm[i], OUT)
        gap.append(t if t is not None else 1e9)
    straight = [k for k in range(n) if kappa[k] < 0.03]
    if not straight:
        raise ValueError('triangle opening has no straight sides')
    gs = sorted(gap[k] for k in straight)
    g_med = gs[len(gs) // 2]
    flag = [kappa[k] < 0.03 and abs(gap[k] - g_med) < 0.04 * g_med for k in range(n)]
    # rotate so that index 0 starts a run
    start = None
    for i in range(n):
        if flag[i] and not flag[i - 1]:
            start = i
            break
    if start is None:
        raise ValueError('cannot find the triangle sides')
    rot = lambda a: a[start:] + a[:start]
    TRI = rot(TRI); nrm = rot(nrm); flag = rot(flag); gap = rot(gap)
    runs = []
    i = 0
    while i < n:
        if flag[i]:
            j = i
            while j + 1 < n and flag[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    runs = [r for r in runs if (r[1] - r[0]) * ds > 1.5 * L]
    if len(runs) != 3:
        raise ValueError('expected 3 straight triangle sides, found %d' % len(runs))
    log.append('side runs (cm): ' + ', '.join('%.2f' % ((r[1] - r[0]) * ds) for r in runs))
    return TRI, nrm, gap, g_med, runs


def build_once(OUT, TRI, H, L=2.0, anchor=0.3, overlap=0.3, q=48, log=None, bead=0.0, neck_style='T', neck_reach=None):
    """OUT/TRI/H are the RAIL polylines (already inset by half a bead)."""
    log = [] if log is None else log
    res = {'contacts': [], 'log': log}
    OUT = list(OUT)
    TRI, nrm, gap, g_med, runs = find_sides(TRI, OUT, L, log)
    n = len(TRI)
    st = cumulative(TRI, True)
    P = st[-1]
    dsT = P / n
    origin = centroid(TRI)
    h = g_med / 2.0 - bead / 2.0            # amplitude of each side wave (wall -> kiss line)
    if h < 0.3:
        raise ValueError('The gap between the borders (%.2f cm) is too narrow for an infill width of %.2f cm.'
                         % (g_med, bead))
    for hp in H:                                    # ring between a hole and the outer border
        cc = centroid(hp)
        rr = sum(dist(p_, cc) for p_ in hp) / len(hp)
        ring_gap = min(dist(p_, cc) for p_ in OUT) - rr
        if ring_gap < 0.15:
            raise ValueError('The ring around a hole is too narrow (%.2f cm) for an infill width of %.2f cm; '
                             'reduce InfillWidth or LayerWidth.' % (ring_gap, bead))
    w, a = overlap, anchor
    ds = L / float(q)
    cOUT = cumulative(OUT, True)
    POUT = cOUT[-1]

    # --- junction geometry on OUT and trial lengths -------------------------
    def out_arc(i):  # arc position on OUT of the normal-ray hit from TRI[i]
        r = hit_with_seg(TRI[i], nrm[i], OUT)
        return r[1]
    R = sum((r[1] - r[0]) * dsT for r in runs) / 3.0
    Lc0 = 0.0
    B00 = 0.0
    for c in range(3):
        r1 = runs[c][1]
        r0n = runs[(c + 1) % 3][0] + (n if c == 2 else 0)
        Lc0 += (r0n - r1) * dsT
        s1 = out_arc(r1)
        s2 = out_arc(runs[(c + 1) % 3][0])
        B00 += (s2 - s1) % POUT
    Lc0 /= 3.0
    B00 /= 3.0
    cn, cm, ck, e, lam_c, lam_s, lam_b = best_counts(R, Lc0, B00, L)
    log.append('cycles: corner=%d side=%d blue-arc=%d trim=%.2f cm' % (cn, cm, ck, e))
    log.append('wavelengths cm: corner %.2f side %.2f blue-arc %.2f' % (lam_c, lam_s, lam_b))
    res.update(h=h, g=g_med, cycles=(cn, cm, ck), lam=(lam_c, lam_s, lam_b))
    res['TRI'] = TRI
    res['origin'] = origin
    return assemble(res, dict(TRI=TRI, nrm=nrm, st=st, P=P, n=n, runs=runs, h=h, e=e,
                       OUT=OUT, cOUT=cOUT, POUT=POUT, H=H, origin=origin, L=L,
                       w=w, a=a, ds=ds, dsT=dsT, cn=cn, cm=cm, ck=ck, lam_b=lam_b, bead=bead, neck_style=neck_style, neck_reach=neck_reach))


def arc_pos(poly, cum, p):
    """Arc-length position on a closed polyline of the point nearest to p."""
    best = None
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        l2 = ex * ex + ey * ey
        u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2))
        d = math.hypot(a[0] + ex * u - p[0], a[1] + ey * u - p[1])
        if best is None or d < best[0]:
            best = (d, cum[i] + u * (cum[i + 1] - cum[i]))
    return best[1]


def point_on(poly, cum, s):
    total = cum[-1]
    s = s % total
    ext = list(poly) + [poly[0]]
    return interp(cum, ext, s)


def join_pieces(pieces):
    pts = list(pieces[0])
    for p in pieces[1:]:
        if dist(pts[-1], p[0]) > 1e-6:
            raise ValueError('piece gap %.3g' % dist(pts[-1], p[0]))
        pts.extend(p[1:])
    if dist(pts[-1], pts[0]) > 1e-6:
        raise ValueError('loop does not close: %.3g' % dist(pts[-1], pts[0]))
    return pts[:-1]


def min_radius(P, closed=True, k=3):
    """Tightest turn radius of a polyline (circle through points k apart)."""
    n = len(P)
    best = 1e9
    rng = range(n) if closed else range(k, n - k)
    for i in rng:
        a, b, c = P[(i - k) % n], P[i], P[(i + k) % n]
        ab, bc, ca = dist(a, b), dist(b, c), dist(c, a)
        cr = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        if cr > 1e-12:
            best = min(best, ab * bc * ca / (2.0 * cr))
    return best


def smooth_piece(pc, passes=4):
    """Light Laplacian smoothing of a wave piece; peak plateaus (shared
    contacts) and the two end points stay exactly where they are."""
    pts = pc.pts
    pinned = set([0, len(pts) - 1])
    for kind, i0, i1 in pc.plateaus:
        if kind == 'peak':
            pinned.update(range(max(0, i0 - 1), min(len(pts) - 1, i1 + 1) + 1))
    for _ in range(passes):
        new = list(pts)
        for i in range(1, len(pts) - 1):
            if i in pinned:
                continue
            p, q, r = pts[i - 1], pts[i], pts[i + 1]
            new[i] = ((p[0] + 2 * q[0] + r[0]) / 4.0, (p[1] + 2 * q[1] + r[1]) / 4.0)
        pts = new
    pc.pts = pts


def assemble(res, c):
    TRI, nrm, st, P, n = c['TRI'], c['nrm'], c['st'], c['P'], c['n']
    runs, h, e, OUT, cOUT, POUT = c['runs'], c['h'], c['e'], c['OUT'], c['cOUT'], c['POUT']
    H, origin, L, w, a, ds, dsT = c['H'], c['origin'], c['L'], c['w'], c['a'], c['ds'], c['dsT']
    cn, cm, ck = c['cn'], c['cm'], c['ck']
    bead = c['bead']
    log = res['log']
    TRIx = TRI + TRI + TRI[:1]
    nrmx = nrm + nrm + nrm[:1]
    stx = [st[i] for i in range(n)] + [st[i] + P for i in range(n)] + [2 * P]

    def S_start(k): return stx[runs[k][0]] + e / 2.0
    def S_end(k): return stx[runs[k][1]] - e / 2.0

    # ---- sides: green + blue share the S contacts --------------------------
    g_side, b_side, contacts = [], [], []
    for k in range(3):
        i0, i1 = runs[k][0] - 3, runs[k][1] + 3
        idx = list(range(max(0, i0), min(n - 1, i1) + 1))
        sx = [stx[i] for i in idx]
        rail = [TRIx[i] for i in idx]
        hit = []
        gt = []
        bt = []
        for i in idx:
            t = ray_hit(TRI[i], nrm[i], OUT)
            hit.append(add(TRI[i], mul(nrm[i], t)))
            gt.append(add(TRI[i], mul(nrm[i], h)))            # green peak line
            bt.append(add(TRI[i], mul(nrm[i], t - h)))        # blue peak line (one bead further)
        gw = build_wave(sx, rail, gt, S_start(k), S_end(k), cm, w, a, ds)
        bw = build_wave(sx, hit, bt, S_start(k), S_end(k), cm, w, a, ds)
        g_side.append(gw)
        b_side.append(bw)
        for pc_ in (gw, bw):
            for kind, i0_, i1_ in pc_.plateaus:
                if kind == 'peak':
                    contacts.append(pc_.pts[i0_:i1_ + 1])
    # ---- green corners ------------------------------------------------------
    g_corner = []
    for k in range(3):
        s0 = S_end(k)
        s1 = S_start((k + 1) % 3) + (P if k == 2 else 0.0)
        lo = max(0, int(s0 / dsT) - 3)
        hi = min(len(stx) - 1, int(s1 / dsT) + 4)
        sx = stx[lo:hi + 1]
        rail = TRIx[lo:hi + 1]
        tgt = [add(p, mul(nv, h)) for p, nv in zip(rail, nrmx[lo:hi + 1])]
        g_corner.append(build_wave(sx, rail, tgt, s0, s1, cn, w, a, ds))
    for pc in g_side + g_corner + b_side:
        smooth_piece(pc)
    green = join_pieces([pc.pts for pair in zip(g_side, g_corner) for pc in pair])
    # ---- blue arcs along the outer border -----------------------------------
    sp = ds * 2.0
    b_arc = []
    for k in range(3):
        j0 = b_side[k].pts[-1]
        j1 = b_side[(k + 1) % 3].pts[0]
        p0 = arc_pos(OUT, cOUT, j0)
        p1 = arc_pos(OUT, cOUT, j1)
        length = (p1 - p0) % POUT
        cnt = max(8, int(math.ceil(length / sp)))
        OUTx = list(OUT) + [OUT[0]]
        rail = [interp(cOUT, OUTx, (p0 + length * i / float(cnt)) % POUT) for i in range(cnt + 1)]
        rail[0], rail[-1] = j0, j1
        # inward normals and the free distance to the other borders
        # normals from a smoothed copy of the border so scallops on the outline
        # do not make neighbouring oscillation directions cross
        wn = max(1, int(0.6 * L / (length / cnt)))
        srail = []
        for i in range(cnt + 1):
            lo = max(0, i - wn)
            hi = min(cnt, i + wn)
            m = min(i - lo, hi - i)
            lo, hi = i - m, i + m
            sx = sum(rail[t][0] for t in range(lo, hi + 1)) / (hi - lo + 1)
            sy = sum(rail[t][1] for t in range(lo, hi + 1)) / (hi - lo + 1)
            srail.append((sx, sy))
        nin = []
        for i in range(cnt + 1):
            tg = unit(sub(srail[min(cnt, i + 1)], srail[max(0, i - 1)]))
            nin.append((-tg[1], tg[0]))
        # free distance: ring walls (touch them when close) and the green's peak
        # envelope S (never cross it)
        Senv = [add(p, mul(nv, h)) for p, nv in zip(TRI, nrm)]
        dring, dS = [], []
        for i in range(cnt + 1):
            best = 1e9
            for poly in H:
                t = ray_hit(rail[i], nin[i], poly)
                if t is not None and t < best:
                    best = t
            dring.append(best)
            t = ray_hit(rail[i], nin[i], Senv)
            dS.append(t if t is not None else 1e9)
        raw = [d if d <= 1.5 * h else h for d in dring]
        win = max(1, int(0.4 * L / (length / cnt)))
        sm = []
        for i in range(cnt + 1):
            lo = max(0, i - win)
            hi = min(cnt, i + win)
            sm.append(sum(raw[lo:hi + 1]) / (hi - lo + 1))
        def avg(vals, w_):
            out_ = []
            for i in range(len(vals)):
                lo = max(0, i - w_)
                hi = min(len(vals) - 1, i + w_)
                m_ = min(i - lo, hi - i)          # symmetric window, no end bias
                out_.append(sum(vals[i - m_:i + m_ + 1]) / (2 * m_ + 1))
            return out_
        # smooth every limit so the peak plateaus follow a clean curve
        dring_s = avg(avg(dring, win), win)
        sm = avg(sm, win)
        # keep one bead width away from the green peak envelope (kiss, never overlap)
        amp = [min(s_, dr, max(0.0, min(d_, 3 * h + bead) - bead)) for s_, dr, d_ in zip(sm, dring_s, dS)]
        # inside the lobe aim radially at the hole ring (exact, noise-free circle);
        # blend back to boundary-normal targets towards the necks
        cents_ = [centroid(p_) for p_ in H]
        mid_ = rail[cnt // 2]
        jh = min(range(len(H)), key=lambda t_: dist(mid_, cents_[t_]))
        Cc = cents_[jh]
        Rr = sum(dist(p_, Cc) for p_ in H[jh]) / len(H[jh])
        ox, oy = unit(sub(Cc, origin))
        tgt = []
        for i in range(cnt + 1):
            p = rail[i]
            d_ = sub(p, Cc)
            rd = math.hypot(d_[0], d_[1])
            psi = abs(math.atan2(ox * d_[1] - oy * d_[0], ox * d_[0] + oy * d_[1]))
            t_ = max(0.0, min(1.0, (psi - math.radians(85)) / math.radians(35)))
            wgt = 1.0 - t_ * t_ * (3 - 2 * t_)                  # 1 in the lobe, 0 at the necks
            rt = max(Rr, rd - 1.5 * h)
            radial = (Cc[0] + d_[0] / rd * rt, Cc[1] + d_[1] / rd * rt)
            nrm_t = add(p, mul(nin[i], amp[i]))
            tp = lerp(nrm_t, radial, wgt)
            dt = dist(tp, Cc)
            if dt < Rr and dt > 1e-9:                      # never dip inside the ring
                tp = (Cc[0] + (tp[0] - Cc[0]) * Rr / dt, Cc[1] + (tp[1] - Cc[1]) * Rr / dt)
            tgt.append(tp)
        sx = cumulative(rail)
        b_arc.append(build_wave(sx, rail, tgt, 0.0, sx[-1], ck, w, a, ds))
    for pc in b_arc:
        smooth_piece(pc)
    blue = join_pieces([pc.pts for pair in zip(b_side, b_arc) for pc in pair])
    res['green'], res['blue'] = green, blue
    res['envelope'] = [add(p, mul(nv, h)) for p, nv in zip(TRI, nrm)]
    # first/last corner peaks lie on the same envelope S as the blue arc's end
    # peaks: record them as (overlapping) contacts
    for gc in g_corner:
        pk = [(i0_, i1_) for kind, i0_, i1_ in gc.plateaus if kind == 'peak']
        for i0_, i1_ in (pk[0], pk[-1]):
            contacts.append(gc.pts[i0_:i1_ + 1])
    res['contacts'] = contacts
    res['neck_closed'] = str(c.get('neck_style', 'T')).upper() in ('T', 'TRAPEZOID') and c['bead'] > 0
    res['necks'] = make_necks(res, c, g_corner, b_arc, green, blue)
    res['min_radius'] = min([min_radius(green), min_radius(blue)] +
                            [min_radius(nk, res['neck_closed']) for nk in res['necks']])
    log.append('tightest turn radius: %.2f cm' % res['min_radius'])
    return res


class Repeller(object):
    """Nearest-point queries against a set of polylines (uniform grid)."""
    def __init__(self, polys, closed_flags, cs):
        self.cs = cs
        self.cells = {}
        for poly, closed in zip(polys, closed_flags):
            n = len(poly)
            for i in range(n if closed else n - 1):
                a_, b_ = poly[i], poly[(i + 1) % n]
                x0 = int(math.floor(min(a_[0], b_[0]) / cs)) - 1
                x1 = int(math.floor(max(a_[0], b_[0]) / cs)) + 1
                y0 = int(math.floor(min(a_[1], b_[1]) / cs)) - 1
                y1 = int(math.floor(max(a_[1], b_[1]) / cs)) + 1
                for gx in range(x0, x1 + 1):
                    for gy in range(y0, y1 + 1):
                        self.cells.setdefault((gx, gy), []).append((a_, b_))

    def nearest(self, p):
        key = (int(math.floor(p[0] / self.cs)), int(math.floor(p[1] / self.cs)))
        best = None
        for a_, b_ in self.cells.get(key, ()):
            ex, ey = b_[0] - a_[0], b_[1] - a_[1]
            l2 = ex * ex + ey * ey
            u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((p[0] - a_[0]) * ex + (p[1] - a_[1]) * ey) / l2))
            q = (a_[0] + ex * u, a_[1] + ey * u)
            d = math.hypot(q[0] - p[0], q[1] - p[1])
            if best is None or d < best[0]:
                best = (d, q)
        return best


def relax_path(path, obstacles, W, iters=60):
    """Push an open polyline away from the obstacle curves until every point is
    at least W from them (beads kiss instead of overlapping), keeping it smooth."""
    rep = Repeller(obstacles, [True] * len(obstacles), max(W, 0.3))
    pts = list(path)
    for it in range(iters):
        moved = 0.0
        for i in range(len(pts)):
            r_ = rep.nearest(pts[i])
            if r_ is None or r_[0] >= W or r_[0] < 1e-9:
                continue
            d, q = r_
            ux, uy = (pts[i][0] - q[0]) / d, (pts[i][1] - q[1]) / d
            k = (W - d) * 0.7
            pts[i] = (pts[i][0] + ux * k, pts[i][1] + uy * k)
            moved = max(moved, k)
        if moved < 1e-4:
            break
        new = list(pts)
        for i in range(1, len(pts) - 1):
            new[i] = ((pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4.0,
                      (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4.0)
        pts = new
    return pts


def _nearest_on_closed(poly, p):
    best = None
    n = len(poly)
    for i in range(n):
        a_, b_ = poly[i], poly[(i + 1) % n]
        ex, ey = b_[0] - a_[0], b_[1] - a_[1]
        l2 = ex * ex + ey * ey
        u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((p[0] - a_[0]) * ex + (p[1] - a_[1]) * ey) / l2))
        q = (a_[0] + ex * u, a_[1] + ey * u)
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        if best is None or d < best[0]:
            best = (d, q)
    return best


def hook_end(path, blue, W, back=0.9, ds=0.1):
    """Extend the LAST point of an open path with a smooth hook until a bead
    drawn on it kisses the blue bead (centres exactly W apart)."""
    E = path[-1]
    d, q = _nearest_on_closed(blue, E)
    if d <= W + 0.01 or d > W + 2.5:
        return path
    dv = unit(sub(q, E))
    T = (q[0] - dv[0] * W, q[1] - dv[1] * W)
    acc, idx = 0.0, len(path) - 1
    while idx > 1 and acc < min(back, 0.6 * dist(T, E) + 0.5):
        acc += dist(path[idx], path[idx - 1])
        idx -= 1
    Q = path[idx]
    tq = unit(sub(path[min(idx + 1, len(path) - 1)], path[max(idx - 1, 0)]))
    m = dist(Q, T)
    cnt = max(6, int(math.ceil(m / ds)))
    pts = []
    for i in range(1, cnt + 1):
        t = i / float(cnt)
        h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
        h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
        pts.append((h00 * Q[0] + h10 * m * tq[0] + h01 * T[0] + h11 * m * dv[0],
                    h00 * Q[1] + h10 * m * tq[1] + h01 * T[1] + h11 * m * dv[1]))
    return path[:idx + 1] + pts


def slide_hook(path, blue, W, reach, lead=0.8, back=0.7, ds=0.1):
    """Carry the LAST end of an open path along the blue bead: the end runs parallel to
    the blue wave, exactly one bead width from its centre-line (kissing it), for
    `reach` cm, moving away from the other end of the path."""
    E, O = path[-1], path[0]
    n = len(blue)
    cum = cumulative(blue, True)
    total = cum[-1]
    d0, q0 = _nearest_on_closed(blue, E)
    if d0 > W + 3.0:
        return path
    # arc position of q0 and which side of blue the end is on
    best = None
    for i in range(n):
        a_, b_ = blue[i], blue[(i + 1) % n]
        ex, ey = b_[0] - a_[0], b_[1] - a_[1]
        l2 = ex * ex + ey * ey
        u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((q0[0] - a_[0]) * ex + (q0[1] - a_[1]) * ey) / l2))
        dd = math.hypot(a_[0] + ex * u - q0[0], a_[1] + ey * u - q0[1])
        if best is None or dd < best[0]:
            best = (dd, cum[i] + u * (cum[i + 1] - cum[i]), (ex, ey))
    s0 = best[1]
    tg0 = unit(best[2])
    side = 1.0 if (E[0] - q0[0]) * tg0[1] - (E[1] - q0[1]) * tg0[0] >= 0 else -1.0   # +1: right of the travel direction

    def at(s):
        s = s % total
        i = max(0, min(n - 1, bisect.bisect_right(cum, s) - 1))
        a_, b_ = blue[i], blue[(i + 1) % n]
        seg = cum[i + 1] - cum[i]
        u = 0.0 if seg < 1e-12 else (s - cum[i]) / seg
        p = (a_[0] + (b_[0] - a_[0]) * u, a_[1] + (b_[1] - a_[1]) * u)
        # smoothed tangent over +-0.25 cm
        pa = (blue[0][0], blue[0][1])
        p1 = interp(cum, blue + [blue[0]], (s + 0.25) % total)
        p0 = interp(cum, blue + [blue[0]], (s - 0.25) % total)
        tg = unit(sub(p1, p0))
        nrm = (tg[1] * side, -tg[0] * side)
        return (p[0] + nrm[0] * W, p[1] + nrm[1] * W), tg

    # direction along blue: away from the other end of the path
    best_dir = None
    for sg in (1.0, -1.0):
        pe = at(s0 + sg * reach)[0]
        dd = dist(pe, O)
        if best_dir is None or dd > best_dir[0]:
            best_dir = (dd, sg)
    sg = best_dir[1]
    lead_ = min(lead, reach)
    T, tT = at(s0 + sg * lead_)
    tT = (tT[0] * sg, tT[1] * sg)
    acc, idx = 0.0, len(path) - 1
    while idx > 1 and acc < back:
        acc += dist(path[idx], path[idx - 1])
        idx -= 1
    Q = path[idx]
    tq = unit(sub(path[min(idx + 1, len(path) - 1)], path[max(idx - 1, 0)]))
    m = dist(Q, T)
    cnt = max(6, int(math.ceil(m / ds)))
    pts = []
    for i in range(1, cnt + 1):
        t = i / float(cnt)
        h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
        h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
        pts.append((h00 * Q[0] + h10 * m * tq[0] + h01 * T[0] + h11 * m * tT[0],
                    h00 * Q[1] + h10 * m * tq[1] + h01 * T[1] + h11 * m * tT[1]))
    k = lead_ + ds
    while k <= reach + 1e-9:
        pts.append(at(s0 + sg * k)[0])
        k += ds
    return path[:idx + 1] + pts


def end_gap(path, blue, span=1.0):
    """Smallest distance between the last `span` cm of a path and the blue curve."""
    acc, best = 0.0, None
    for k in range(len(path) - 1, -1, -1):
        d = _nearest_on_closed(blue, path[k])
        if best is None or d[0] < best[0]:
            best = (d[0], k, d[1])
        if k > 0:
            acc += dist(path[k], path[k - 1])
        if acc > span:
            break
    return best


def fix_end_contact(path, blue, W, overlap=0.005, span=1.0, iters=12):
    """Guarantee that the LAST end of a path touches the blue bead: the centre
    distance there is set to W - overlap (a 0.05 mm squeeze, so the two beads
    genuinely meet instead of stopping a hair apart).  The shift is spread
    smoothly along the path."""
    target = W - overlap
    P = list(path)
    for _ in range(iters):
        g = end_gap(P, blue, span)
        d, k, q = g
        if d > W + 3.0 or abs(d - target) <= 0.003:
            break
        shift = d - target                      # >0: gap, <0: too close
        p = P[k]
        dd = dist(p, q)
        if dd < 1e-9:
            break
        ux, uy = (q[0] - p[0]) / dd, (q[1] - p[1]) / dd
        # arclength of every point from k
        cum = [0.0]
        for i in range(1, len(P)):
            cum.append(cum[-1] + dist(P[i - 1], P[i]))
        reach = 0.9
        for i in range(len(P)):
            da = abs(cum[i] - cum[k])
            if da < reach:
                w = 0.5 * (1.0 + math.cos(math.pi * da / reach))
                P[i] = (P[i][0] + ux * shift * w, P[i][1] + uy * shift * w)
    return P


def _nearest_segs(segs, p):
    best = None
    for a_, b_ in segs:
        ex, ey = b_[0] - a_[0], b_[1] - a_[1]
        l2 = ex * ex + ey * ey
        u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((p[0] - a_[0]) * ex + (p[1] - a_[1]) * ey) / l2))
        q = (a_[0] + ex * u, a_[1] + ey * u)
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        if best is None or d < best[0]:
            best = (d, q)
    return best if best is not None else (1e9, p)


def fix_run_contacts(path, curve, W, overlap=0.005, maxgap=1.0, reach=0.9, passes=6, closed=False, segs=None):
    """Every place where the path comes within W+maxgap of `curve` but does not
    quite touch it is pulled onto it (centre distance W - overlap), with a smooth
    cosine taper of half-width `reach` along the path."""
    target = W - overlap
    P = list(path)
    for _ in range(passes):
        n = len(P)
        dd = []
        for p in P:
            dd.append(_nearest_segs(segs, p) if segs is not None else _nearest_on_closed(curve, p))
        cum = [0.0]
        for i in range(1, n):
            cum.append(cum[-1] + dist(P[i - 1], P[i]))
        moves = []
        k = 0
        while k < n:
            if dd[k][0] < W + maxgap:
                k0 = k
                while k < n and dd[k][0] < W + maxgap:
                    k += 1
                kk = min(range(k0, k), key=lambda m: dd[m][0])
                d, q = dd[kk]
                if abs(d - target) > 0.003 and d > W - 0.2:
                    moves.append((kk, d, q))
            else:
                k += 1
        if not moves:
            break
        for kk, d, q in moves:
            p = P[kk]
            L_ = dist(p, q)
            if L_ < 1e-9:
                continue
            ux, uy = (q[0] - p[0]) / L_, (q[1] - p[1]) / L_
            shift = d - target
            tot = cum[-1] + (dist(P[-1], P[0]) if closed else 0.0)
            for i in range(n):
                da = abs(cum[i] - cum[kk])
                if closed:
                    da = min(da, tot - da)
                if da < reach:
                    w = 0.5 * (1.0 + math.cos(math.pi * da / reach))
                    P[i] = (P[i][0] + ux * shift * w, P[i][1] + uy * shift * w)
    return P


def _segs_near(poly, c0, R, closed=True):
    n = len(poly)
    out = []
    last = n if closed else n - 1
    for i in range(last):
        a_, b_ = poly[i], poly[(i + 1) % n]
        if dist(a_, c0) < R or dist(b_, c0) < R:
            out.append((a_, b_))
    return out


def _offset_segs_toward(poly, c0, R, W):
    """Segments of `poly` (a bead centre-line) pushed W towards the point c0."""
    n = len(poly)
    pts = []
    for i in range(n):
        p = poly[i]
        if dist(p, c0) > R:
            pts.append(None)
            continue
        tg = unit(sub(poly[(i + 1) % n], poly[i - 1]))
        nr = (-tg[1], tg[0])
        if dot(nr, sub(c0, p)) < 0:
            nr = (-nr[0], -nr[1])
        pts.append((p[0] + nr[0] * W, p[1] + nr[1] * W))
    segs = []
    for i in range(n):
        a_, b_ = pts[i], pts[(i + 1) % n]
        if a_ is not None and b_ is not None:
            segs.append((a_, b_))
    return segs


def _ray_segs(o, d, segs):
    best = None
    for a_, b_ in segs:
        ex, ey = b_[0] - a_[0], b_[1] - a_[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-14:
            continue
        wx, wy = a_[0] - o[0], a_[1] - o[1]
        t = (wx * ey - wy * ex) / den
        u = (wx * d[1] - wy * d[0]) / den
        if t > 1e-7 and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best):
            best = t
    return best


def make_trap_necks(res, c, g_corner, green, blue):
    """Each neck pocket gets one closed rounded-trapezoid loop whose sides run along
    the surrounding blue beads (touching them along their whole length), whose
    base lies on the hole ring (touching the border offset) and whose top touches the
    triangle wave: large contact AREAS instead of point contacts."""
    H, origin, bead = c['H'], c['origin'], c['bead']
    log = res['log']
    cents = [centroid(p) for p in H]
    necks = []
    for k in range(3):
        gc = g_corner[k]
        tip = gc.pts[len(gc.pts) // 2]
        ta = math.atan2(tip[1] - origin[1], tip[0] - origin[0])

        def da(cc):
            d = math.atan2(cc[1] - origin[1], cc[0] - origin[0]) - ta
            return abs(math.atan2(math.sin(d), math.cos(d)))
        j = min(range(3), key=lambda i: da(cents[i]))
        u_hat = unit(sub(cents[j], origin))
        A = add(origin, mul(u_hat, ray_hit(origin, u_hat, green)))
        B = add(origin, mul(u_hat, ray_hit(origin, u_hat, H[j])))
        uB = dist(A, B)
        c0 = add(A, mul(u_hat, uB * 0.5))
        R = max(uB * 1.4, 3.0) + 0.6
        Rr_ = sum(dist(p_, cents[j]) for p_ in H[j]) / len(H[j])
        def thin(sg_):
            return [(sg_[i][0], sg_[min(i + 1, len(sg_) - 1)][1]) for i in range(0, len(sg_), 2)]
        sb = _segs_near(blue, c0, R)
        sg = _segs_near(green, c0, R)
        sr = _segs_near(H[j], c0, R)
        segs = (_offset_segs_toward(blue, c0, R, bead) + _offset_segs_toward(green, c0, R, bead) + sr)
        nth = 360
        r0 = []
        for m in range(nth):
            th = 2 * math.pi * m / nth
            d_ = (math.cos(th), math.sin(th))
            t = _ray_segs(c0, d_, segs)
            r0.append(t)
        if any(t is None for t in r0):
            # rays that escape (should not happen): fill from neighbours
            good = [t for t in r0 if t is not None]
            if len(good) < nth * 0.9:
                raise ValueError('Neck pocket could not be traced; try another InfillWidth or L.')
            for m in range(nth):
                if r0[m] is None:
                    r0[m] = min(good)
        # round the corners: smooth the radial profile but never let it leave the free
        # region (min with the traced outline), so the loop keeps touching the beads
        win = 3
        cur = list(r0)
        want = 0.5 * bead / 1.0 * 1.0 + 0.0          # target turn radius: about one bead half-width + margin
        want = max(0.27, 0.45 * bead)
        for rnd in range(40):
            for _ in range(60):
                avg = []
                for m in range(nth):
                    sacc = 0.0
                    for o in range(-win, win + 1):
                        sacc += cur[(m + o) % nth]
                    avg.append(sacc / (2 * win + 1))
                cur = [min(r0[m], avg[m]) for m in range(nth)]
            chk = [(c0[0] + math.cos(2 * math.pi * m / nth) * cur[m],
                    c0[1] + math.sin(2 * math.pi * m / nth) * cur[m]) for m in range(0, nth, 2)]
            if min_radius(chk, True, k=2) >= want:
                break
        pts = []
        for m in range(nth):
            th = 2 * math.pi * m / nth
            pts.append((c0[0] + math.cos(th) * cur[m], c0[1] + math.sin(th) * cur[m]))
        loop = resample_closed(pts, max(80, int(cumulative(pts, True)[-1] / 0.08)))
        necks.append(loop)
        res['contacts'].append(loop)
    log.append('Neck waves: closed trapezoid loops (contact along the blue beads, ring and triangle wave).')
    return necks


def make_necks(res, c, g_corner, b_arc, green, blue):
    """One zig-zag wave per neck pocket.  It runs ACROSS the pocket (between the
    two blue shoulders); on the triangle side its extremes are the green corner's
    own peak plateaus (shared geometry), on the hole side they sit on the ring /
    lobe curves (exact hit points)."""
    H, origin, L, ds, lam_b, a = c['H'], c['origin'], c['L'], c['ds'], c['lam_b'], c['a']
    bead = c['bead']
    style = str(c.get('neck_style', 'V')).upper()
    if style in ('T', 'TRAPEZOID') and bead > 0:
        return make_trap_necks(res, c, g_corner, green, blue)
    log = res['log']
    cents = [centroid(p) for p in H]
    necks = []
    for k in range(3):
        gc = g_corner[k]
        tip = gc.pts[len(gc.pts) // 2]
        ta = math.atan2(tip[1] - origin[1], tip[0] - origin[0])
        def da(cc):
            d = math.atan2(cc[1] - origin[1], cc[0] - origin[0]) - ta
            return abs(math.atan2(math.sin(d), math.cos(d)))
        j = min(range(3), key=lambda i: da(cents[i]))
        u_hat = unit(sub(cents[j], origin))       # tip -> hole
        v_hat = (-u_hat[1], u_hat[0])
        A = add(origin, mul(u_hat, ray_hit(origin, u_hat, green)))
        B = add(origin, mul(u_hat, ray_hit(origin, u_hat, H[j])))
        uB = dot(sub(B, A), u_hat)
        u_mid = uB * 0.5

        def uv(p):
            d = sub(p, A)
            return (dot(d, v_hat), dot(d, u_hat))      # (along pocket, toward hole)
        def xy(p):
            return (A[0] + v_hat[0] * p[0] + u_hat[0] * p[1],
                    A[1] + v_hat[1] * p[0] + u_hat[1] * p[1])
        def hit(v, direction, polys):
            o = xy((v, u_mid))
            best = None
            for poly in polys:
                t = ray_hit(o, direction, poly)
                if t is not None and (best is None or t < best):
                    best = t
            return best

        def hit_kiss(v, direction, kinds, u0=None):
            """Hit the nearest of the given curves; return the neck point that
            touches it: ring rails -> on the rail; green/blue -> one bead away
            on the free side (beads kiss)."""
            o = xy((v, u_mid if u0 is None else u0))
            best = None
            for kind, poly in kinds:
                r_ = hit_with_seg(o, direction, poly)
                if r_ is not None and (best is None or r_[0] < best[0]):
                    best = (r_[0], kind, poly, r_[1])
            t, kind, poly, apos = best
            q_ = add(o, mul(direction, t))
            if kind == 'ring' or bead <= 0:
                return uv(q_)
            cum_ = cumulative(poly, True)
            i_ = max(0, min(len(poly) - 1, bisect.bisect_right(cum_, apos) - 1))
            tg = unit(sub(poly[(i_ + 1) % len(poly)], poly[i_]))
            nrm_ = (tg[1], -tg[0]) if kind == 'green' else (-tg[1], tg[0])   # free side
            return uv(add(q_, mul(nrm_, bead)))

        if style == 'S':
            # one snake wave along the pocket axis: starts on the green tip, touches the
            # blue shoulder on alternate sides, ends on the hole ring
            if os.environ.get('DBG'):
                print('pocket uB=%.2f lat_hi=%.2f lat_lo=%.2f L=%.2f a=%.2f' % (
                    uB, ray_hit(xy((0.0, u_mid)), v_hat, blue) or -1, ray_hit(xy((0.0, u_mid)), (-v_hat[0], -v_hat[1]), blue) or -1, L, a))
            m = max(2, int(round(uB / (0.55 * L))))
            spacing = uB / float(m + 1)
            seq = []
            seq.append([hit_kiss(vq, (-u_hat[0], -u_hat[1]), [('green', green)])
                        for vq in [-a / 2.0 + a * q_ / 4.0 for q_ in range(5)]])
            for kx in range(1, m + 1):
                sgn = -1.0 if kx % 2 == 1 else 1.0
                dvec = (v_hat[0] * sgn, v_hat[1] * sgn)
                pl = []
                for q_ in range(5):
                    uq = kx * spacing - a / 2.0 + a * q_ / 4.0
                    t_ = hit(0.0, dvec, [blue]) if False else None
                    o_ = xy((0.0, uq))
                    t_ = ray_hit(o_, dvec, blue)
                    if t_ is None:
                        t_ = 1.0
                    pl.append((sgn * max(0.0, t_ - bead * 1.1), uq))
                seq.append(pl)
            seq.append([hit_kiss(vq, u_hat, [('ring', H[j]), ('blue', blue)])
                        for vq in [-a / 2.0 + a * q_ / 4.0 for q_ in range(5)]])
        else:
            # green-side extremes: the corner's peak plateaus, ordered by v
            G = []
            for kind, i0, i1 in gc.plateaus:
                if kind == 'peak':
                    raw_ = gc.pts[i0:i1 + 1]
                    if bead > 0:
                        sh_ = []
                        for ii, p_ in enumerate(raw_):
                            t0_, t1_ = raw_[max(0, ii - 1)], raw_[min(len(raw_) - 1, ii + 1)]
                            tg_ = unit(sub(t1_, t0_))
                            sh_.append(add(p_, mul((tg_[1], -tg_[0]), bead)))     # outward of green
                        raw_ = sh_
                    pp = [uv(p) for p in raw_]
                    if pp[-1][0] < pp[0][0]:
                        pp.reverse()
                    G.append(pp)
            G.sort(key=lambda pl: pl[len(pl) // 2][0])
            # blue shoulders limit the pocket
            t_hi = hit(0.0, v_hat, [blue])
            t_lo = hit(0.0, (-v_hat[0], -v_hat[1]), [blue])
            E_lo = (-t_lo, u_mid)
            E_hi = (t_hi, u_mid)
            W = E_hi[0] - E_lo[0]
            vc = 0.5 * (E_hi[0] + E_lo[0])
            half = W / 2.0
            K = 1 if half / (0.62 * lam_b) < 3.2 else 3
            step = half * (0.55 if K == 1 else 0.8) / K
            if style in ('W', 'ANCHORED'):
                step = (half - bead * 1.15) / 2.0    # nodes: shoulder, ring, green, ring, shoulder
            seq = []
            for i in range(-K, K + 1):
                v = vc + i * step
                pl = []
                if i % 2 == 0:                       # triangle side: touch the green
                    near = [p_ for p_ in G if abs(p_[len(p_) // 2][0] - v) < 0.3 * step]
                    if near:
                        seq.append(near[0])
                        continue
                    for q_ in range(5):
                        vq = v - a / 2.0 + a * q_ / 4.0
                        pl.append(hit_kiss(vq, (-u_hat[0], -u_hat[1]), [('green', green)]))
                else:                                # hole side: ring / lobe curves
                    for q_ in range(5):
                        vq = v - a / 2.0 + a * q_ / 4.0
                        pl.append(hit_kiss(vq, u_hat, [('ring', H[j]), ('blue', blue)]))
                seq.append(pl)
        if style in ('W', 'ANCHORED') and bead > 0:
            # both ends are carried out to the blue shoulders of the pocket so the
            # neck wave is held by the surrounding beads on both sides
            seq.insert(0, [(E_lo[0] + bead * 1.15, u_mid)])
            seq.append([(E_hi[0] - bead * 1.15, u_mid)])
        path = [xy(p) for p in seq[0]]
        for prev, nxt in zip(seq[:-1], seq[1:]):
            v0, u0 = prev[-1]
            v1, u1 = nxt[0]
            cnt = max(6, int(math.ceil(abs(v1 - v0) / ds)))
            for i in range(1, cnt):
                t = i / float(cnt)
                path.append(xy((v0 + (v1 - v0) * t, u0 + (u1 - u0) * ease(t))))
            path.extend(xy(p) for p in nxt)
        if bead > 0:
            path = relax_path(path, [blue, green], bead)
            Rr_ = sum(dist(p_, cents[j]) for p_ in H[j]) / len(H[j])      # stay outside the ring rail
            path = [p_ if dist(p_, cents[j]) >= Rr_ else
                    (cents[j][0] + (p_[0] - cents[j][0]) * Rr_ / dist(p_, cents[j]),
                     cents[j][1] + (p_[1] - cents[j][1]) * Rr_ / dist(p_, cents[j])) for p_ in path]
            if style == 'V0':
                # original pattern (used only to fix the wavelength): ends kiss the blue bead
                path = hook_end(path, blue, bead)
                path = list(reversed(hook_end(list(reversed(path)), blue, bead)))
                necks.append(path)
                res['contacts'].extend([[xy(p) for p in pl] for pl in seq])
                continue
            # both free ends slide along the blue bead (kissing it) for `reach` cm
            reach = c.get('neck_reach')
            reach = 0.8 if reach is None else reach
            if reach > 0:
                path = slide_hook(path, blue, bead, reach)
                path = list(reversed(slide_hook(list(reversed(path)), blue, bead, reach)))
                path = relax_path(path, [blue, green], bead, iters=20)
                path = [p_ if dist(p_, cents[j]) >= Rr_ else
                        (cents[j][0] + (p_[0] - cents[j][0]) * Rr_ / dist(p_, cents[j]),
                         cents[j][1] + (p_[1] - cents[j][1]) * Rr_ / dist(p_, cents[j])) for p_ in path]
            # hard guarantee: the neck touches the triangle wave wherever it nearly does
            path = fix_run_contacts(path, green, bead)
            # hard guarantee: both neck ends really touch the blue bead
            path = fix_end_contact(path, blue, bead)
            path = list(reversed(fix_end_contact(list(reversed(path)), blue, bead)))
            for tag, pe in (('start', list(reversed(path))), ('end', path)):
                gp = end_gap(pe, blue)
                if gp[0] > bead + 0.01:
                    log.append('WARNING: neck %d %s does not reach the blue bead (gap %.2f cm).' % (k + 1, tag, gp[0] - bead))
                else:
                    res.setdefault('neck_touch', []).append(1)
        necks.append(path)
        res['contacts'].extend([[xy(p) for p in pl] for pl in seq])
    if bead > 0:
        log.append('Neck ends touching the blue bead: %d of %d.' % (len(res.get('neck_touch', [])), 2 * len(necks)))
    return necks


# =====================================================================
#  Clearance check (beads must neither overlap each other nor the borders)
# =====================================================================
def _seg_dist(p, a, b):
    ex, ey = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ey * ey
    u = 0.0 if l2 < 1e-18 else max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2))
    return math.hypot(a[0] + ex * u - p[0], a[1] + ey * u - p[1])


def verify(curves, closed, bounds, W, tol=0.02):
    """Returns dict with counts of: other (bead overlaps a different curve),
    own (bead overlaps a non-adjacent part of itself), wall (bead crosses a
    boundary offset) and the smallest centre-line distances found."""
    cs = max(W, 0.3)
    cells = {}
    items = []
    for ci, P in enumerate(curves):
        cum = cumulative(P, closed[ci])
        total = cum[-1]
        for i, p in enumerate(P):
            items.append((p[0], p[1], ci, cum[i], total, closed[ci]))
    for idx, it in enumerate(items):
        cells.setdefault((int(math.floor(it[0] / cs)), int(math.floor(it[1] / cs))), []).append(idx)
    other = own = 0
    dmin_other = dmin_own = 1e9
    lim = W - tol
    for idx, it in enumerate(items):
        cx, cy = int(math.floor(it[0] / cs)), int(math.floor(it[1] / cs))
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for j in cells.get((gx, gy), ()):
                    if j <= idx:
                        continue
                    jt = items[j]
                    d = math.hypot(it[0] - jt[0], it[1] - jt[1])
                    if d >= W:
                        continue
                    if it[2] == jt[2]:
                        da = abs(it[3] - jt[3])
                        if it[5]:
                            da = min(da, it[4] - da)
                        if da < 1.8 * W:
                            continue
                        dmin_own = min(dmin_own, d)
                        if d < lim:
                            own += 1
                    else:
                        dmin_other = min(dmin_other, d)
                        if d < lim:
                            other += 1
    # distance of every curve point to the boundary offsets
    segs = {}
    for bi, B in enumerate(bounds):
        for i in range(len(B)):
            a_, b_ = B[i], B[(i + 1) % len(B)]
            for gx in range(int(math.floor(min(a_[0], b_[0]) / cs)) - 1, int(math.floor(max(a_[0], b_[0]) / cs)) + 2):
                for gy in range(int(math.floor(min(a_[1], b_[1]) / cs)) - 1, int(math.floor(max(a_[1], b_[1]) / cs)) + 2):
                    segs.setdefault((gx, gy), []).append((a_, b_))
    wall = 0
    dmin_wall = 1e9
    for it in items:
        key = (int(math.floor(it[0] / cs)), int(math.floor(it[1] / cs)))
        d = 1e9
        for a_, b_ in segs.get(key, ()):
            d = min(d, _seg_dist((it[0], it[1]), a_, b_))
        if d < W / 2.0:
            dmin_wall = min(dmin_wall, d)
            if d < W / 2.0 - tol:
                wall += 1
    return {'other': other, 'own': own, 'wall': wall,
            'dmin_other': dmin_other, 'dmin_own': dmin_own, 'dmin_wall': dmin_wall}


def build(OUT, TRI, H, L=2.0, anchor=0.3, overlap=0.3, q=48, log=None, bead=0.0,
          bounds=None, auto=True, neck_style='T', neck_reach=None):
    """Build the pattern. With bead>0 the result is checked for bead overlaps and,
    if auto is on, the wavelength L is raised in steps until the beads are clear."""
    log = [] if log is None else log
    L_req = L
    if (str(neck_style).upper() in ('T', 'TRAPEZOID') and bead > 0 and bounds is not None and auto):
        # the blue and triangle waves keep the wavelength the plain pattern needs;
        # the trapezoid necks are then fitted into the pockets at that wavelength
        pre = build(OUT, TRI, H, L=L, anchor=anchor, overlap=overlap, q=q, log=[], bead=bead,
                    bounds=bounds, auto=True, neck_style='V0', neck_reach=neck_reach)
        L = pre['L_used']
    L0 = L
    best = None
    pinned = (str(neck_style).upper() in ('T', 'TRAPEZOID') and bead > 0 and bounds is not None and auto)
    factors = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.65, 1.8, 2.0] if (auto and bead > 0 and not pinned) else [1.0]
    last_err = None
    for f in factors:
        L = L0 * f
        sub_log = []
        try:
            res = build_once(OUT, TRI, H, L=L, anchor=anchor, overlap=overlap, q=q, log=sub_log, bead=bead, neck_style=neck_style, neck_reach=neck_reach)
        except ValueError as ex:
            last_err = ex
            continue
        res['L_used'] = L
        res['log'] = log + sub_log
        if bead <= 0 or bounds is None:
            return res
        tight = res['min_radius'] < 0.75 * bead / 2.0
        v = verify([res['blue'], res['green']] + res['necks'], [True, True] + [res['neck_closed']] * 3, bounds, bead)
        v['radius'] = res['min_radius']
        bad = v['other'] + v['own'] + v['wall'] + (1 if tight else 0)
        res['verify'] = v
        res['bad'] = bad
        if best is None or bad < best['bad']:
            best = res
        if bad == 0:
            break
    if best is None:
        raise last_err
    res = best
    L = res['L_used']
    v = res['verify']
    if L > L_req * 1.001:
        res['log'].append('L raised from %.2f to %.2f cm so the %.2f cm beads stay clear of each other.' % (L_req, L, bead))
    if res['bad']:
        res['log'].append('WARNING: bead clearance not fully met (overlap other/own/border: %d/%d/%d, '
                          'tightest radius %.2f cm). Raise L or lower InfillWidth.' %
                          (v['other'], v['own'], v['wall'], res['min_radius']))
    else:
        res['log'].append('Clearance OK: closest different beads %.2f cm centre-to-centre (>= %.2f), '
                          'closest approach to a border offset %.2f cm (>= %.2f).' %
                          (min(v['dmin_other'], 9.99), bead, min(v['dmin_wall'], 9.99), bead / 2.0))
    return res


# =====================================================================
#  Bead outlines (the band swept by a bead of width 2r around a centre-line)
# =====================================================================
def _resample_open(pts, step):
    c = cumulative(pts)
    n = max(2, int(math.ceil(c[-1] / step)))
    return [interp(c, pts, c[-1] * i / n) for i in range(n + 1)]


def _remove_loops(poly, window=80):
    """Cut the small self-crossing loops (swallow-tails) that a plain offset makes
    on the inside of turns tighter than the offset distance. Closed polygon."""
    pts = list(poly)
    for _ in range(200):
        n = len(pts)
        if n < 8:
            break
        sign = 1.0 if area(pts) >= 0 else -1.0
        found = None
        for i in range(n):
            a_, b_ = pts[i], pts[(i + 1) % n]
            for k in range(2, window):
                j = (i + k) % n
                if j == i or (j + 1) % n == i:
                    continue
                c_, d_ = pts[j], pts[(j + 1) % n]
                r_ = (b_[0] - a_[0], b_[1] - a_[1])
                s_ = (d_[0] - c_[0], d_[1] - c_[1])
                den = r_[0] * s_[1] - r_[1] * s_[0]
                if abs(den) < 1e-14:
                    continue
                t = ((c_[0] - a_[0]) * s_[1] - (c_[1] - a_[1]) * s_[0]) / den
                u = ((c_[0] - a_[0]) * r_[1] - (c_[1] - a_[1]) * r_[0]) / den
                if 0 < t < 1 and 0 < u < 1:
                    X = (a_[0] + r_[0] * t, a_[1] + r_[1] * t)
                    loop = [X] + [pts[(i + 1 + m) % n] for m in range(k)] + [X]
                    found = (i, k, X, loop)
                    break
            if found:
                break
        if not found:
            break
        i, k, X, loop = found
        # the loop is spurious when it runs against the main direction
        if area(loop[:-1]) * sign < 0 or len(loop) < n / 2:
            keep = [pts[(i + 1 + k + m) % n] for m in range(n - k - 1)]
            pts = [X] + keep
        else:
            pts = [X] + [pts[(i + 1 + m) % n] for m in range(k)]
    return pts


def bead_outline(pts, closed, r, step=0.08):
    """Boundary loop(s) of the band of half-width r around a centre-line.
    closed -> [outer loop, inner loop];  open -> [capsule loop]."""
    if closed:
        P = resample_closed(pts, max(24, int(math.ceil(cumulative(pts, True)[-1] / step))))
        n = len(P)
        T = tangents_closed(P)
        Nr = [(t[1], -t[0]) for t in T]                     # right-hand normals
        L_ = [(P[i][0] - Nr[i][0] * r, P[i][1] - Nr[i][1] * r) for i in range(n)]
        R_ = [(P[i][0] + Nr[i][0] * r, P[i][1] + Nr[i][1] * r) for i in range(n)]
        loops = [_remove_loops(L_), _remove_loops(R_)]
        loops.sort(key=lambda q: abs(area(q)), reverse=True)
        return loops
    P = _resample_open(pts, step)
    n = len(P)
    T = [unit(sub(P[min(i + 1, n - 1)], P[max(i - 1, 0)])) for i in range(n)]
    Nr = [(t[1], -t[0]) for t in T]
    left = [(P[i][0] - Nr[i][0] * r, P[i][1] - Nr[i][1] * r) for i in range(n)]
    right = [(P[i][0] + Nr[i][0] * r, P[i][1] + Nr[i][1] * r) for i in range(n)]
    cap_n = 14

    def cap(c, t, flip):
        a0 = math.atan2(t[1], t[0])
        out = []
        for m in range(1, cap_n):
            ang = a0 - math.pi / 2.0 + math.pi * m / cap_n
            out.append((c[0] + r * math.cos(ang), c[1] + r * math.sin(ang)))
        return out
    # right side forward, cap round the end, left side backward, cap round the start
    poly = right + cap(P[-1], T[-1], 1.0) + list(reversed(left)) + cap(P[0], (-T[0][0], -T[0][1]), 1.0)
    return [_remove_loops(poly)]


# =====================================================================
#  Settings (Grasshopper inputs override the values above)
# =====================================================================
import json
import os
import sys

try:
    import Rhino
    import Rhino.Geometry as rg
    import Rhino.Geometry.Intersect as ri
    HAVE_RHINO = True
except ImportError:
    HAVE_RHINO = False

_SETTING_NAMES = ['INPUT_FILE', 'OUTPUT_FILE', 'MODEL_UNITS_TO_MM', 'REFERENCE_Z', 'AUTO_FLIP',
                  'FIRST_LAYER_HEIGHT', 'EXTERNAL_PERIMETER_WIDTH', 'PERIMETER_WIDTH', 'PERIMETERS',
                  'INFILL_WIDTH', 'WAVELENGTH', 'AUTO_WAVELENGTH', 'ANCHOR', 'OVERLAP', 'NECK_REACH',
                  'SAMPLES_PER_WAVE']


def get_settings():
    s = {}
    g = globals()
    for n in _SETTING_NAMES:
        s[n] = g[n]
    # Grasshopper inputs share the name; None / missing keeps the value written above
    s['_gh'] = {}
    return s


def gh_override(s, gh):
    for n in _SETTING_NAMES:
        v = _HOST.get(n)
        if v is not None:
            s[n] = v
    return s


# =====================================================================
#  Core: boundary sets -> pattern (model units are converted to cm inside)
# =====================================================================
def generate(outer, tri, circles, rails_fn, S, log):
    """outer, tri, circles: boundary loops in cm. rails_fn(i, d) -> loop offset by d (cm).
    Returns (res, W, bead)."""
    mm = 0.1                                  # 1 mm in cm
    bead = S['INFILL_WIDTH'] * mm
    n = max(1, int(S['PERIMETERS']))
    W = (S['EXTERNAL_PERIMETER_WIDTH'] + (n - 1) * S['PERIMETER_WIDTH']) * mm
    offs = [rails_fn(i, W) for i in range(5)]
    rails = [rails_fn(i, W + bead / 2.0) for i in range(5)]
    res = build(rails[0], rails[1], rails[2:], L=S['WAVELENGTH'] * mm, anchor=S['ANCHOR'] * mm,
                overlap=S['OVERLAP'] * mm, q=max(24, int(S['SAMPLES_PER_WAVE'])), log=log, bead=bead,
                bounds=offs, auto=bool(S['AUTO_WAVELENGTH']), neck_reach=S['NECK_REACH'] * mm, neck_style='T')
    return res, W, bead


def classify(loops):
    """loops: 5 shapely polygons (outline + 4 openings) -> outer, tri, circles."""
    loops = sorted(loops, key=lambda p: p.area, reverse=True)
    outer, holes = loops[0], loops[1:]
    circ = lambda p: 4 * math.pi * p.area / (p.length ** 2)
    holes = sorted(holes, key=circ, reverse=True)
    if circ(holes[2]) < 0.9 or circ(holes[3]) > circ(holes[2]) - 0.05:
        raise ValueError('Expected 3 circular holes and 1 non-circular (triangular) opening; circularity found: %s' %
                         ', '.join('%.3f' % circ(h) for h in holes))
    return outer, holes[3], holes[:3]


# ---------------------------------------------------------------------
#  Python mode: mesh section with trimesh + offsets with shapely
# ---------------------------------------------------------------------
def load_mesh(path):
    import trimesh
    ext = os.path.splitext(path)[1].lower()
    if ext == '.3dm':
        import rhino3dm as r
        f = r.File3dm.Read(path)
        try:
            print('3dm unit system:', f.Settings.ModelUnitSystem)
        except Exception:
            pass
        V, F = [], []
        for o in f.Objects:
            g = o.Geometry
            if not isinstance(g, r.Brep):
                continue
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
    return tm


def section_polygon(tm, z):
    import trimesh
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union, polygonize
    seg = trimesh.intersections.mesh_plane(tm, [0, 0, 1], [0, 0, z])
    if len(seg) == 0:
        raise ValueError('No section at z=%g (mesh z range %g..%g).' % (z, tm.bounds[0][2], tm.bounds[1][2]))
    tol = 1e-3
    q = lambda p: (round(p[0] / tol) * tol, round(p[1] / tol) * tol)
    lines = [LineString([q(s[0][:2]), q(s[1][:2])]) for s in seg]
    lines = [l for l in lines if l.length > 0]
    res = None
    for p in polygonize(unary_union(lines)):
        f = Polygon(p.exterior)
        res = f if res is None else res.symmetric_difference(f)
    polys = list(res.geoms) if res.geom_type == 'MultiPolygon' else [res]
    return max(polys, key=lambda p: p.area)


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


def run_python(path, S):
    return run_mesh(load_mesh(path), S)


def run_mesh(tm, S):
    from shapely.geometry import Polygon
    u = S['MODEL_UNITS_TO_MM']
    tm = auto_flip(tm, S, u)
    z = S['REFERENCE_Z']
    if z is None:
        z = tm.bounds[0][2] + 0.5 * S['FIRST_LAYER_HEIGHT'] / u
    sec = section_polygon(tm, z)
    if S['REFERENCE_Z'] is None and len(sec.interiors) != 4:      # the part starts above the middle of the first layer (a raised plate, only pads below it): go up until the plate with its 4 openings appears
        z0_ = tm.bounds[0][2]
        for k_ in range(0, 400):
            z_try = z0_ + (S['FIRST_LAYER_HEIGHT'] - 0.05 + 0.1 * k_) / u
            sec_try = section_polygon(tm, z_try)
            if len(sec_try.interiors) == 4:
                z, sec = z_try, sec_try
                break
    f = u / 10.0                                          # model -> cm
    sc = lambda poly: Polygon([(x * f, y * f) for x, y in poly.coords])
    loops = [sc(sec.exterior)] + [sc(r) for r in sec.interiors]
    if len(loops) != 5:
        raise ValueError('Reference section needs 1 outline + 4 openings, found %d openings (z=%g).' % (len(loops) - 1, z))
    outer, tri, circles = classify(loops)
    sets = [outer, tri] + circles

    def largest(g):
        return max(g.geoms, key=lambda p: p.area) if g.geom_type == 'MultiPolygon' else g

    def ring(g):
        pts = [tuple(p) for p in list(g.exterior.coords)[:-1]]
        if area(pts) < 0:
            pts.reverse()
        return resample_closed(pts, max(24, int(g.exterior.length / 0.1)))

    def rails_fn(i, d):
        p = sets[i]
        return ring(largest(p.buffer(-d, 64)) if i == 0 else largest(p.buffer(d, 128)))
    log = []
    res, W, bead = generate(outer, tri, circles, rails_fn, S, log)
    ref = dict(outer=ring(outer), holes=[ring(h) for h in [tri] + circles])
    return res, W, bead, ref, z, f


# ---------------------------------------------------------------------
#  Grasshopper mode: Brep section with Rhino + Rhino offsets
# ---------------------------------------------------------------------
def to_brep(g):
    """Brep / Extrusion / Surface / Guid (referenced Rhino object) / list -> one Brep."""
    if isinstance(g, (list, tuple)):
        parts = [to_brep(x) for x in g if x is not None]
        if len(parts) == 1:
            return parts[0]
        j = rg.Brep.JoinBreps(parts, 0.001)
        if not j or len(j) != 1:
            raise ValueError('Give ONE closed Brep (or Breps that join into one).')
        return j[0]
    if isinstance(g, rg.Brep):
        return g
    if hasattr(g, 'ToBrep'):
        return g.ToBrep()
    import rhinoscriptsyntax as rs
    b = rs.coercebrep(g)
    if b is None:
        raise ValueError('Cannot read the Brep input (%s). Use a Brep parameter or a referenced Brep.' % type(g).__name__)
    return b


def run_gh(brep, S):
    brep = to_brep(brep)
    tol = 0.001
    u = S['MODEL_UNITS_TO_MM']
    bb = brep.GetBoundingBox(True)
    z = S['REFERENCE_Z']
    if z is None:
        z = bb.Min.Z + 0.5 * S['FIRST_LAYER_HEIGHT'] / u
    def _cut(zv):
        pl_ = rg.Plane(rg.Point3d(0, 0, zv), rg.Vector3d.ZAxis)
        ok_, cv_, pt_ = ri.Intersection.BrepPlane(brep, pl_, tol)
        if not ok_ or not cv_:
            return []
        return [c_ for c_ in rg.Curve.JoinCurves(cv_, tol * 4) if c_.IsClosed]
    curves = _cut(z)
    if S['REFERENCE_Z'] is None and len(curves) != 5:             # the part starts above the middle of the first layer (a raised plate, only pads below it): go up until the plate with its 4 openings appears
        for k_ in range(0, 400):
            z_try = bb.Min.Z + (S['FIRST_LAYER_HEIGHT'] - 0.05 + 0.1 * k_) / u
            c_try = _cut(z_try)
            if len(c_try) == 5:
                z, curves = z_try, c_try
                break
    if not curves:
        raise ValueError('No section of the Brep at z=%g.' % z)
    if len(curves) != 5:
        raise ValueError('Reference section has %d closed loops, expected 5.' % len(curves))
    f = u / 10.0
    pl = rg.Plane(rg.Point3d(0, 0, z), rg.Vector3d.ZAxis)
    scale_to_cm = rg.Transform.Scale(rg.Point3d(0, 0, z), f)

    def A(c):
        m = rg.AreaMassProperties.Compute(c)
        a_ = m.Area
        m.Dispose()
        return a_
    curves.sort(key=A, reverse=True)
    circ = lambda c: 4 * math.pi * A(c) / (c.GetLength() ** 2)
    rest = sorted(curves[1:], key=circ, reverse=True)
    circles, tri = rest[:3], rest[3]
    if circ(circles[2]) < 0.97 or circ(tri) > 0.95:
        raise ValueError('Expected 3 circular holes and 1 non-circular (triangular) opening.')
    sets = [curves[0], tri] + circles
    step = 0.1 / f                                         # 1 mm in model units
    cache = {}

    def rails_fn(i, d):
        sign = d if i == 0 else -d
        c = _offset(sets[i], sign / f, pl, tol)            # d in cm -> model units
        return _sample(c, step, 1.0 / f, tol)              # points in cm
    log = []
    res, W, bead = generate(None, None, None, rails_fn, S, log)
    ref = dict(outer=_sample(sets[0], step, 1.0 / f, tol), holes=[_sample(c, step, 1.0 / f, tol) for c in [tri] + circles])
    return res, W, bead, ref, z, f, pl, f


def _mesh_of_brep(brep):
    import trimesh
    brep = to_brep(brep)
    ms = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.QualityRenderMesh)
    if not ms:
        raise ValueError('Could not mesh the Brep.')
    m = rg.Mesh()
    for x in ms:
        m.Append(x)
    m.Faces.ConvertQuadsToTriangles()
    V = [(m.Vertices[i].X, m.Vertices[i].Y, m.Vertices[i].Z) for i in range(m.Vertices.Count)]
    F = [(m.Faces[i].A, m.Faces[i].B, m.Faces[i].C) for i in range(m.Faces.Count)]
    tm = trimesh.Trimesh(vertices=V, faces=F, process=False)
    tm.merge_vertices()
    return tm


def run_gh_mesh(brep, S):
    """Same route as Python mode (mesh section + shapely offsets), the mesh coming from the Rhino Brep."""
    import trimesh
    brep = to_brep(brep)
    ms = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.QualityRenderMesh)
    if not ms:
        raise ValueError('Could not mesh the Brep.')
    m = rg.Mesh()
    for x in ms:
        m.Append(x)
    m.Faces.ConvertQuadsToTriangles()
    V = [(m.Vertices[i].X, m.Vertices[i].Y, m.Vertices[i].Z) for i in range(m.Vertices.Count)]
    F = [(m.Faces[i].A, m.Faces[i].B, m.Faces[i].C) for i in range(m.Faces.Count)]
    tm = trimesh.Trimesh(vertices=V, faces=F, process=False)
    tm.merge_vertices()
    return run_mesh(tm, S)


def _area_c(c):
    m = rg.AreaMassProperties.Compute(c)
    r_ = m.Area
    m.Dispose()
    return r_


def _offset(c, d, plane, tol):
    """d>0 shrinks the outside outline, d<0 grows an opening (chosen by area)."""
    original = _area_c(c)
    choices = []
    for sign in (-1, 1):
        result = c.Offset(plane, sign * abs(d), tol, rg.CurveOffsetCornerStyle.Round)
        if not result:
            continue
        for cand in result:
            if not cand.IsClosed:
                continue
            ar = _area_c(cand)
            if d > 0:
                ok = ar < original - tol * tol and c.Contains(cand.PointAtStart, plane, tol) != rg.PointContainment.Outside
            else:
                ok = ar > original + tol * tol and cand.Contains(c.PointAtStart, plane, tol) != rg.PointContainment.Outside
            if ok:
                choices.append((abs(ar - original), cand))
    if not choices:
        raise ValueError('Cannot offset a border into the material; reduce the boundary band.')
    if len(choices) > 1:
        raise ValueError('Boundary offset splits into multiple loops.')
    return choices[0][1]


def _sample(c, step, scale, tol):
    """closed curve -> CCW point list in cm (scale = model unit -> cm is 1/scale_arg...)"""
    n = max(48, int(math.ceil(c.GetLength() / step)))
    ts = c.DivideByCount(n, True)
    pts = [c.PointAt(t) for t in ts]
    if pts[0].DistanceTo(pts[-1]) < tol * 4:
        pts = pts[:-1]
    out = [(p.X / scale, p.Y / scale) for p in pts]
    if area(out) < 0:
        out.reverse()
    return out


# ---------------------------------------------------------------------
#  Save + preview
# ---------------------------------------------------------------------
def save(res, W, bead, ref, z, f, S, log):
    """pattern.json is written in MODEL units (cm-values / f)."""
    inv = 1.0 / f
    mp = lambda pts: [[round(p[0] * inv, 4), round(p[1] * inv, 4)] for p in pts]
    curves = [dict(name='blue', closed=True, pts=mp(res['blue'])), dict(name='green', closed=True, pts=mp(res['green']))]
    for i, nk in enumerate(res['necks']):
        curves.append(dict(name='neck%d' % i, closed=bool(res['neck_closed']), pts=mp(nk)))
    out = dict(version=2, model_units_to_mm=S['MODEL_UNITS_TO_MM'], z_ref=z,
               boundary_band_mm=W * 10.0, bead_mm=bead * 10.0, wavelength_mm=res['L_used'] * 10.0,
               curves=curves, reference=dict(outer=mp(ref['outer']), holes=[mp(h) for h in ref['holes']]),
               settings={k: S[k] for k in _SETTING_NAMES if k not in ('INPUT_FILE',)}, log=res['log'])
    return out


def main(argv=None):
    S = get_settings()
    argv = sys.argv[1:] if argv is None else argv
    if argv:
        S['INPUT_FILE'] = argv[0]
    if not S['INPUT_FILE']:
        raise SystemExit('Set INPUT_FILE in the settings or pass the file: python weave_pattern.py part.3dm')
    res, W, bead, ref, z, f = run_python(S['INPUT_FILE'], S)
    out = save(res, W, bead, ref, z, f, S, res['log'])
    for l in res['log']:
        print(l)
    S['OUTPUT_FILE'] = clean_path(S['OUTPUT_FILE'], 'pattern.json')
    json.dump(out, open(S['OUTPUT_FILE'], 'w'))
    print('reference z = %g, band %.1f mm, bead %.1f mm, wavelength %.1f mm' % (z, out['boundary_band_mm'], out['bead_mm'], out['wavelength_mm']))
    print('wrote', S['OUTPUT_FILE'])



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
    S = gh_override(get_settings(), globals())
    brep = _HOST.get('Brep')
    if brep is None:
        raise ValueError('Add a Brep input (Item access).')
    notes = []
    try:
        if S.get('AUTO_FLIP'):
            _tm = _mesh_of_brep(brep)
            _z0 = _tm.bounds[0][2]
            if getattr(auto_flip(_tm, S, S['MODEL_UNITS_TO_MM']), '_flipped', False):
                raise ValueError('the part stands plate-up and was turned over (AUTO_FLIP)')
        res, W, bead, ref, z, f, pl, f2 = run_gh(brep, S)
        out = save(res, W, bead, ref, z, f, S, res['log'])
        if not out.get('curves'):
            raise ValueError('the Rhino route returned no curves')
    except Exception as ex:          # another Brep with the same base: retry through the mesh route
        notes.append('Rhino section route failed (%s); used the mesh route instead.' % ex)
        try:
            res, W, bead, ref, z, f = run_gh_mesh(brep, S)
        except ImportError:
            raise ValueError('Rhino route failed (%s) and the mesh route needs the packages: add the line  # r: numpy, shapely, trimesh  at the top of the script.' % ex)
        out = save(res, W, bead, ref, z, f, S, res['log'])
    res['log'][:0] = notes
    if _HOST.get('OUTPUT_FILE'):      # in Grasshopper the JSON file is only written when you give OUTPUT_FILE
        try:
            S['OUTPUT_FILE'] = clean_path(S['OUTPUT_FILE'], 'pattern.json')
            json.dump(out, open(S['OUTPUT_FILE'], 'w'))
        except Exception as ex:
            res['log'].append('Could not write %s (%s); use the PatternJson output.' % (S['OUTPUT_FILE'], ex))
    inv = 1.0 / f
    pat = []
    for c in out['curves']:
        pts = [rg.Point3d(p[0], p[1], z) for p in c['pts']]
        if c['closed']:
            pts.append(pts[0])
        pat.append(rg.PolylineCurve(pts))
    return pat, res['log'] + (['wrote ' + str(S['OUTPUT_FILE'])] if _HOST.get('OUTPUT_FILE') else ['no JSON file written (use the PatternJson output)']), json.dumps(out)


if HAVE_RHINO:
    if _HOST.get('Brep') is None:
        raise ValueError('The Brep input is empty. Add an input named exactly Brep (Item access) and connect the part to it.')
    Pattern, Log, PatternJson = gh_main()
elif __name__ == '__main__':
    main()