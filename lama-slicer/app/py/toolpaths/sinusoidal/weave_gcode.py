#!/usr/bin/env python
"""weave_gcode.py   -   STEP 3 of 3: WASP CLAY G-CODE WRITER

All machine values below come from two files only: your PrusaSlicer config (Wasp - Blocks .ini) and your
sample G-code (F1-Thick.gcode). Layer heights and all extrusion widths are NOT set here: they come from the
slicer (toolpaths), which got them from its own settings.

INPUTS
  ToolpathsJson   text from the slicer's ToolpathsJson output          (Python: TOOLPATHS_FILE = toolpaths.json)
  OUTPUT_FILE     folder to save in, e.g. C:/clay    (or a full path C:/clay/part.gcode)
  FILE_NAME       name of the file, e.g. F1          -> F1.gcode  (optional; any panel text)
OUTPUTS
  GCodeFile       full path of the saved file
  Status          'Saving...' / 'File saved: ...' / 'ERROR: ...'      -> connect to a Panel
  Log             details (layers, path length, filament, warnings)

RUN IT
  Python:  python weave_gcode.py toolpaths.json C:/clay F1
  Rhino 8 / Grasshopper (Script, Python 3, no packages needed): paste this file, add the inputs/outputs above.
  Any SETTINGS name below can be added as an extra input to override it.
All lengths in mm, speeds in mm/s.
"""

_HOST = dict(globals())        # values a host (Grasshopper inputs) injected before this file ran

# =====================================================================
#  SETTINGS   (source in brackets: ini = PrusaSlicer config, gcode = your sample file)
# =====================================================================
# ---- files --------------------------------------------------------
TOOLPATHS_FILE = 'toolpaths.json'      # Python mode only (Grasshopper uses ToolpathsJson)
OUTPUT_FILE    = ''                    # folder or full path ('' = Desktop in Grasshopper, current folder in Python)
FILE_NAME      = ''                    # e.g. F1 -> F1.gcode ('' = keep the name in OUTPUT_FILE, or part_wasp)

# ---- placement on the round delta bed ----------------------------------
BED_CENTER_X   = 0.0                   # [ini bed_shape: circle centred on 0,0]
BED_CENTER_Y   = 0.0
PART_OFFSET_X  = 0.0                   # move the part away from the bed centre
PART_OFFSET_Y  = 0.0
BED_RADIUS     = 200.0                 # [ini bed_shape: radius 200]  warning only
MAX_PRINT_HEIGHT = 200.0               # [ini max_print_height]       warning only
Z_OFFSET       = 0.0                   # [ini z_offset]

# ---- material / extrusion ---------------------------------------------
FILAMENT_DIAMETER    = 7.5             # [ini filament_diameter]
EXTRUSION_MULTIPLIER = 0.9             # [ini extrusion_multiplier]
RELATIVE_E           = False           # [ini use_relative_e_distances = 0; gcode M82 absolute E]
MAX_VOLUMETRIC_SPEED = 0.0             # [ini max_volumetric_speed = 0 -> no limit] mm3/s

# ---- speeds (mm/s) ------------------------------------------------------
FIRST_LAYER_SPEED        = 33.0        # [ini first_layer_speed; gcode F1980]
PERIMETER_SPEED          = 60.0        # [ini perimeter_speed; gcode F3600]
EXTERNAL_PERIMETER_SPEED = 60.0        # [ini external_perimeter_speed; gcode F3600]
INFILL_SPEED             = 60.0        # [ini infill_speed; gcode F3600]  (the weave)
TRAVEL_SPEED             = 100.0       # [ini travel_speed; gcode F6000]
Z_SPEED                  = 90.0        # mm/s  lift / lower speed (ini travel_speed_z was 33; raised on request) -> F5400

# ---- retraction -----------------------------------------------------------
RETRACT_LENGTH         = 2.0           # [ini retract_length was 0.5] raised: clay needs a real back-pull so it does not follow the nozzle
RETRACT_SPEED          = 10.0          # [ini retract_speed; gcode F600]
DERETRACT_SPEED        = 5.0           # [ini deretract_speed; gcode F300]
RETRACT_LIFT_SPEED     = 120.0         # mm/s speed of the retraction lift (the vertical move up before each travel). One speed for the whole lift; lowering uses Z_SPEED
RETRACT_LIFT           = 10.0          # [ini retract_lift; gcode Z+10]

# ---- clean path ends for clay (added: stops clay being lifted with the nozzle) ----
COAST_DISTANCE         = 3.0           # mm   open paths: stop extruding this far before their end (the residual pressure fills it); 0 = off
SEAM_OVERLAP_TAG       = True          #      the closing overlap of an external perimeter is written under ';TYPE:Perimeter' so Prusa's preview ends the External perimeter exactly at the seam: ONE seam marker per loop, not two (the print itself is the same); False = whole loop under External perimeter
WIPE_SIDE_DRIFT        = 3.0           # mm   the wipe of a closed PERIMETER (not the weave loops) drifts this far sideways onto the part side (the right of the travel direction; all loops here are printed with the part on their right) so the nozzle leaves the bead sideways and does not pull it up; 0 = along the bead
LOOP_OVERLAP          = 6.0           # mm   closed loops: the bead goes on this far past its start (the start of a bead is always thin: the clay needs a moment to flow), so the loop is closed completely; 0 = off
WIPE_DISTANCE          = 5.0           # mm   closed loops are extruded all the way round (they close completely), then the nozzle wipes on along the start without extruding; 0 = off
SLOW_LIFT_HEIGHT       = 0.0           # mm   the first part of every lift is slow so the clay breaks off cleanly; 0 = off
SLOW_LIFT_SPEED        = 10.0          # mm/s speed of that first part of the lift (Wasp)
RETRACT_BEFORE_TRAVEL  = 6.0           # [ini retract_before_travel] no retraction for shorter travels
RETRACT_ON_LAYER_CHANGE = False        # [ini retract_layer_change = 0] (a long travel still retracts)

# ---- temperatures --------------------------------------------------------
FIRST_LAYER_TEMPERATURE = 200          # [ini first_layer_temperature; gcode M104/M109 S200]
TEMPERATURE             = 200          # [ini temperature]
BED_TEMPERATURE         = 0            # [ini bed_temperature = 0 -> no bed commands]

# ---- file size ------------------------------------------------------------
GCODE_RESOLUTION = 0.1                 # [ini gcode_resolution] mm, removes points that deviate less than this

# ---- G-code blocks ([ini start_gcode / end_gcode / before_layer_gcode / layer_gcode]) ------
START_GCODE = (
    "G21          ; Use millimetres\n"
    "G90          ; Use absolute XYZ coordinates\n"
    "M82          ; Use absolute extrusion coordinates\n"
    "G28          ; Home the delta printer\n"
    "G92 E0       ; Set the extrusion counter to zero"
)
END_GCODE = (
    "M400         ; Wait for printing movements to finish\n"
    "G91          ; Temporarily use relative XYZ coordinates\n"
    "G1 Z5 F600   ; Lift 5 mm at 10 mm/s\n"
    "G90          ; Restore absolute XYZ coordinates\n"
    "G28          ; Return to the top home position\n"
    "M400         ; Wait until homing finishes"
)
BEFORE_LAYER_GCODE = ""
LAYER_GCODE        = ""

# ---- which files to write -------------------------------------------------
EXPORT_WASP  = True                     # write the WASP file (the one used so far, unchanged)
EXPORT_COMAU = True                     # write the COMAU version too (format copied from your Comau sample G-code)

# ---- COMAU version (everything below comes from your Comau sample F1-Thick_Comau.gcode) ----
COMAU_PRINT_FEED  = 3000                # mm/min  every printing move is 'F3000' in the sample
COMAU_TRAVEL_FEED = 6000                # mm/min  horizontal travel at the lifted height ('G0 ... F6000')
COMAU_LIFT_FEED   = 7200                # mm/min  speed of the retraction lift (120 mm/s), the whole lift at this one speed; lowering uses COMAU_Z_FEED
COMAU_Z_FEED      = 5400                # mm/min  lift / lower moves (90 mm/s; was 4000)
COMAU_SLOW_LIFT_FEED = 600              # mm/min  first SLOW_LIFT_HEIGHT mm of each lift (same slow start as the Wasp file)
COMAU_LIFT        = 10.0                # mm      travel height above the layer (sample: Z2 -> Z12)
COMAU_END_LIFT    = 20.0                # mm      end of the file: lift this far above the last layer (first 1.5 mm slowly, then fast), so the pressure that is left cannot drip onto the part
COMAU_END_EXIT    = True                #         then move out beyond the part before going home (G28 X0 Y0 crosses the part: whatever still drips falls outside it)
COMAU_END_EXIT_MARGIN = 25.0            # mm      how far outside the part outline that exit point is
COMAU_E_PER_MM    = 0.6                 # E per mm of path on the NORMAL layers; the same for every bead width (sample: '0.6 E/mm')
COMAU_G_PER_E = 0.0800                 # g of clay per E unit, assumed = mean of the 14 weighed Comau blocks matched to the reference G-codes (plates excluded)
COMAU_G_PER_E_MIN = 0.0641              # g per E, lowest block  (weight is reported as a range min - max)
COMAU_G_PER_E_MAX = 0.0973              # g per E, highest block
COMAU_HOME        = 'G28 X0 Y0 ; HOME - same footer command as reference file'

# ---- constant flow on every layer (Wasp and Comau) ---------------------------
FLOW_SCALE_BY_HEIGHT   = True           # a layer THICKER than the normal layer (the thick last layer) gets its E per mm scaled by
                                        # layer height / normal layer height, so its beads are filled as much as on the other layers
                                        # (Comau: 0.6 E/mm x 4.5/3.5 on a 4.5 mm layer; normal layers keep exactly 0.6)
FLOW_SCALE_THIN_LAYERS = False          # True: thinner layers (the 2 mm first layer) are scaled down as well (False: they keep the normal flow)

# ---- weight limit (checked for the Wasp and the Comau file) ----------------------
MAX_WEIGHT_KG   = 7.4                   # kg  the Status says if a file is heavier and which INFILL_WIDTH to try next (0 = no check)

# ---- viewer ---------------------------------------------------------------
FILAMENT_DENSITY = 2.56                 # g/cm3   WASP wet density, assumed = mean of the weighed blocks (14 blocks matched to the reference G-codes A04 B02 C02 D02 E02 F01 G01; plates excluded)
WET_DENSITY_WASP_MIN = 2.39             # g/cm3   WASP wet density, lowest block  (weight is reported as a range min - max)
WET_DENSITY_WASP_MAX = 2.75             # g/cm3   WASP wet density, highest block
TIME_CORRECTION  = 1.29                 # print time = distance/feed-rate x this factor (acceleration, corners). Calibrated on your sample
                                        # G-code: Prusa estimated 1h 15m 44s, plain distance/speed gives 58.8 min -> 1.29
PRUSA_HEADER  = True                   # first line '; generated by PrusaSlicer ...' so the Prusa viewer reads ;WIDTH / ;HEIGHT
CONFIG_FOOTER = True                   # PrusaSlicer REQUIRES the ini block at the end of a file that says it was made by
                                       # PrusaSlicer (your sample file has it too, so the printer treats the file the same).
                                       # False = no header and no block: no Prusa error, but the viewer then guesses the widths.
# =====================================================================

import json
import math
import os
import re
import sys

_NAMES = ['EXPORT_WASP', 'EXPORT_COMAU', 'COMAU_PRINT_FEED', 'COMAU_TRAVEL_FEED', 'COMAU_Z_FEED', 'COMAU_SLOW_LIFT_FEED', 'COAST_DISTANCE', 'WIPE_DISTANCE', 'LOOP_OVERLAP', 'SEAM_OVERLAP_TAG', 'WIPE_SIDE_DRIFT', 'SLOW_LIFT_HEIGHT', 'SLOW_LIFT_SPEED', 'COMAU_LIFT',
          'COMAU_END_LIFT', 'COMAU_END_EXIT', 'COMAU_END_EXIT_MARGIN', 'COMAU_E_PER_MM', 'COMAU_G_PER_E', 'COMAU_G_PER_E_MIN', 'COMAU_G_PER_E_MAX', 'WET_DENSITY_WASP_MIN', 'WET_DENSITY_WASP_MAX', 'FLOW_SCALE_BY_HEIGHT', 'FLOW_SCALE_THIN_LAYERS', 'MAX_WEIGHT_KG', 'COMAU_HOME', 'TOOLPATHS_FILE', 'OUTPUT_FILE', 'FILE_NAME', 'BED_CENTER_X', 'BED_CENTER_Y', 'PART_OFFSET_X', 'PART_OFFSET_Y',
          'BED_RADIUS', 'MAX_PRINT_HEIGHT', 'Z_OFFSET', 'FILAMENT_DIAMETER', 'FILAMENT_DENSITY', 'TIME_CORRECTION', 'EXTRUSION_MULTIPLIER', 'RELATIVE_E',
          'MAX_VOLUMETRIC_SPEED', 'FIRST_LAYER_SPEED', 'PERIMETER_SPEED', 'EXTERNAL_PERIMETER_SPEED', 'INFILL_SPEED',
          'TRAVEL_SPEED', 'Z_SPEED', 'RETRACT_LENGTH', 'RETRACT_SPEED', 'DERETRACT_SPEED', 'RETRACT_LIFT', 'RETRACT_LIFT_SPEED', 'COMAU_LIFT_FEED',
          'RETRACT_BEFORE_TRAVEL', 'RETRACT_ON_LAYER_CHANGE', 'FIRST_LAYER_TEMPERATURE', 'TEMPERATURE',
          'BED_TEMPERATURE', 'GCODE_RESOLUTION', 'START_GCODE', 'END_GCODE', 'BEFORE_LAYER_GCODE', 'LAYER_GCODE',
          'PRUSA_HEADER', 'CONFIG_FOOTER']

TYPE_NAME = {'external': 'External perimeter', 'perimeter': 'Perimeter', 'infill': 'Internal infill',
             'fill': 'Solid infill'}


def get_settings(argv):
    g = globals()
    S = {}
    for n in _NAMES:
        v = _HOST.get(n)
        S[n] = g[n] if v is None else v
    if len(argv) > 0:
        S['TOOLPATHS_FILE'] = argv[0]
    if len(argv) > 1:
        S['OUTPUT_FILE'] = argv[1]
    if len(argv) > 2:
        S['FILE_NAME'] = argv[2]
    return S


def f(v):
    """number without trailing zeros (G-code style)"""
    s = ('%.5f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def simplify(pts, tol, closed):
    """Douglas-Peucker; a closed loop is split at its farthest point so it stays closed."""
    n = len(pts)
    if n < 4 or tol <= 0:
        return pts

    def dp(a, b, keep):
        stack = [(a, b)]
        while stack:
            i, j = stack.pop()
            if j <= i + 1:
                continue
            (x1, y1), (x2, y2) = pts[i], pts[j]
            dx, dy = x2 - x1, y2 - y1
            L = math.hypot(dx, dy)
            best, k = -1.0, -1
            for m in range(i + 1, j):
                px, py = pts[m]
                d = math.hypot(px - x1, py - y1) if L < 1e-12 else abs(dx * (y1 - py) - dy * (x1 - px)) / L
                if d > best:
                    best, k = d, m
            if best > tol:
                keep[k] = True
                stack.append((i, k))
                stack.append((k, j))
    keep = [False] * n
    keep[0] = keep[-1] = True
    if closed and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-6:
        far = max(range(n), key=lambda m: (pts[m][0] - pts[0][0]) ** 2 + (pts[m][1] - pts[0][1]) ** 2)
        keep[far] = True
        dp(0, far, keep)
        dp(far, n - 1, keep)
    else:
        dp(0, n - 1, keep)
    return [p for p, k in zip(pts, keep) if k]


def base_height(layers):
    """the normal layer height = the most common one (the first and the thick last layer differ from it)"""
    cnt = {}
    for L in layers:
        k = round(L['height'], 3)
        cnt[k] = cnt.get(k, 0) + 1
    return max(cnt.items(), key=lambda t: (t[1], t[0]))[0] if cnt else 0.0


def flow_scaled(S, h, hb):
    """True when this layer's flow is scaled by h / hb (thicker layers; thinner ones only with FLOW_SCALE_THIN_LAYERS)"""
    if not S['FLOW_SCALE_BY_HEIGHT'] or hb <= 0:
        return False
    return h > hb * 1.001 or (S['FLOW_SCALE_THIN_LAYERS'] and h < hb * 0.999)


class Writer(object):
    def __init__(self, S, shift):
        self.S = S
        self.shift = shift
        self.lines = []
        self.x = self.y = None
        self.z = 0.0
        self.first_move = True                   # the first travel comes down from the home height after G28
        self.e = 0.0
        self.retracted = False
        self.fd2 = math.pi / 4.0 * S['FILAMENT_DIAMETER'] ** 2
        self.filament = 0.0
        self.path_len = 0.0
        self.feed = None
        self.bad_points = 0
        self.base_h = 0.0
        self.by_kind = {}

    def emit(self, s):
        self.lines.append(s)

    def gx(self, p):
        return p[0] + self.shift[0]

    def gy(self, p):
        return p[1] + self.shift[1]

    def e_per_mm(self, w, h):
        hb = self.base_h
        scaled = flow_scaled(self.S, h, hb)
        hh = hb if scaled else h
        area = hh * (w - hh * (1 - math.pi / 4.0))
        if scaled:
            area *= h / hb                           # same bead cross-section per mm of height as on the normal layers
        return area * self.S['EXTRUSION_MULTIPLIER'] / self.fd2, area

    def retract(self):
        S = self.S
        if self.retracted or S['RETRACT_LENGTH'] <= 0:
            return
        if S['RELATIVE_E']:
            self.emit('G1 E-%s F%s' % (f(S['RETRACT_LENGTH']), f(S['RETRACT_SPEED'] * 60)))
        else:
            self.emit('G1 E%s F%s' % (f(self.e - S['RETRACT_LENGTH']), f(S['RETRACT_SPEED'] * 60)))
            self.emit('G92 E0')
            self.e = 0.0
        self.retracted = True

    def unretract(self):
        S = self.S
        if not self.retracted:
            return
        if S['RELATIVE_E']:
            self.emit('G1 E%s F%s' % (f(S['RETRACT_LENGTH']), f(S['DERETRACT_SPEED'] * 60)))
        else:
            self.e += S['RETRACT_LENGTH']
            self.emit('G1 E%s F%s' % (f(self.e), f(S['DERETRACT_SPEED'] * 60)))
        self.retracted = False

    def travel(self, p, z, force_retract=False):
        S = self.S
        x, y = self.gx(p), self.gy(p)
        zf = S['Z_SPEED'] * 60
        tf = S['TRAVEL_SPEED'] * 60
        d = 1e9 if self.x is None else math.hypot(x - self.x, y - self.y)
        if force_retract or d > S['RETRACT_BEFORE_TRAVEL']:
            self.retract()
            if S['RETRACT_LIFT'] > 0:
                sl = S['SLOW_LIFT_HEIGHT']
                if 0 < sl < S['RETRACT_LIFT'] and not self.first_move:        # not on the very first move: after G28 the nozzle is at its home height and has to come down fast
                    self.emit('G1 Z%s F%s' % (f(self.z + sl), f(S['SLOW_LIFT_SPEED'] * 60)))
                self.emit('G1 Z%s F%s' % (f(z + S['RETRACT_LIFT']), f(S['RETRACT_LIFT_SPEED'] * 60)))
            self.emit('G1 X%s Y%s F%s' % (f(x), f(y), f(tf)))
            if S['RETRACT_LIFT'] > 0 or abs(z - self.z) > 1e-9:
                self.emit('G1 Z%s F%s' % (f(z), f(zf)))
        else:
            if abs(z - self.z) > 1e-9:
                self.emit('G1 Z%s F%s' % (f(z), f(zf)))
            self.emit('G1 X%s Y%s F%s' % (f(x), f(y), f(tf)))
        self.x, self.y, self.z = x, y, z
        self.feed = None
        self.first_move = False

    def extrude(self, pts, w, h, speed, closed=False, kind=''):
        S = self.S
        self.unretract()
        epm, area = self.e_per_mm(w, h)
        v = speed
        if S['MAX_VOLUMETRIC_SPEED'] > 0:
            v = min(v, S['MAX_VOLUMETRIC_SPEED'] / area)
        F = v * 60
        # coasting: the last COAST_DISTANCE mm of the path are travelled without extrusion
        seq = [(self.gx(p), self.gy(p)) for p in pts[1:]]
        tot, px, py = 0.0, self.x, self.y
        for x, y in seq:
            tot += math.hypot(x - px, y - py)
            px, py = x, y
        coast = 0.0 if closed else (min(S['COAST_DISTANCE'], 0.4 * tot) if S['COAST_DISTANCE'] > 0 else 0.0)
        cut = tot - coast
        pieces, cum, px, py = [], 0.0, self.x, self.y
        for x, y in seq:
            d = math.hypot(x - px, y - py)
            if d >= 1e-4:
                if cum + d <= cut + 1e-9:
                    pieces.append((x, y, True))
                elif cum >= cut:
                    pieces.append((x, y, False))
                else:
                    t = (cut - cum) / d
                    pieces.append((px + (x - px) * t, py + (y - py) * t, True))
                    pieces.append((x, y, False))
                cum += d
            px, py = x, y
        n_main_ = len(pieces)
        if closed and (S['WIPE_DISTANCE'] > 0 or S['LOOP_OVERLAP'] > 0):
            # loop is complete: the bead goes on past the start by LOOP_OVERLAP (closes the thin start), then the nozzle wipes along the start (no extrusion)
            ov_, tot_ = S['LOOP_OVERLAP'], S['LOOP_OVERLAP'] + S['WIPE_DISTANCE']
            drift_ = S['WIPE_SIDE_DRIFT'] if kind in ('external', 'perimeter') else 0.0      # only the perimeters drift sideways (the part is on their right); a weave loop would drag through the wall next to it
            wl, px, py = 0.0, seq[-1][0], seq[-1][1]
            for x, y in seq:
                dd = math.hypot(x - px, y - py)
                if dd < 1e-4:
                    continue
                if wl < ov_ - 1e-9 and wl + dd > ov_:                   # split where the overlap ends
                    t = (ov_ - wl) / dd
                    pieces.append((px + (x - px) * t, py + (y - py) * t, True))
                    px, py, dd, wl = px + (x - px) * t, py + (y - py) * t, dd * (1 - t), ov_
                ux, uy = (x - px) / dd, (y - py) / dd
                rx, ry = uy, -ux                                         # right of the travel direction
                if wl + dd > tot_:
                    t = (tot_ - wl) / dd
                    ex, ey = px + (x - px) * t, py + (y - py) * t
                    if wl + dd * t >= ov_ - 1e-9 and drift_ > 0 and S['WIPE_DISTANCE'] > 0:
                        ex, ey = ex + rx * drift_, ey + ry * drift_
                    pieces.append((ex, ey, wl < ov_ - 1e-9))
                    break
                qx, qy = x, y
                if wl + dd > ov_ - 1e-9 and drift_ > 0 and S['WIPE_DISTANCE'] > 0:
                    fr = min(1.0, (wl + dd - ov_) / S['WIPE_DISTANCE'])
                    qx, qy = x + rx * drift_ * fr, y + ry * drift_ * fr
                pieces.append((qx, qy, wl < ov_ - 1e-9))
                wl += dd
                px, py = x, y
        for pi_, (x, y, ext) in enumerate(pieces):
            if pi_ == n_main_ and ext and kind == 'external' and S['SEAM_OVERLAP_TAG']:      # the closing overlap: own ;TYPE (only the preview colour / seam marker changes)
                self.emit(';TYPE:%s' % TYPE_NAME['perimeter'])
                self.emit(';WIDTH:%s' % f(w))
                self.retag = True
            d = math.hypot(x - self.x, y - self.y)
            if d < 1e-4:
                continue
            if not ext:
                fs = ' F%s' % f(F) if self.feed != F else ''
                self.feed = F
                self.emit('G1 X%s Y%s%s' % (f(x), f(y), fs))
                self.x, self.y = x, y
                continue
            de = d * epm
            if S['RELATIVE_E']:
                es = de
            else:
                self.e += de
                es = self.e
            fs = ''
            if self.feed != F:
                fs = ' F%s' % f(F)
                self.feed = F
            self.emit('G1 X%s Y%s E%s%s' % (f(x), f(y), f(es), fs))
            self.x, self.y = x, y
            self.filament += de
            self.by_kind[kind] = self.by_kind.get(kind, 0.0) + de
            self.path_len += d
            if math.hypot(x - S['BED_CENTER_X'], y - S['BED_CENTER_Y']) > S['BED_RADIUS']:
                self.bad_points += 1


def has(block, pattern):
    return re.search(pattern, block) is not None


def run(S, tp):
    log = []
    if tp.get('units') != 'mm':
        raise ValueError('toolpaths must be in mm.')
    cx, cy = tp['part_center']
    shift = (S['BED_CENTER_X'] + S['PART_OFFSET_X'] - cx, S['BED_CENTER_Y'] + S['PART_OFFSET_Y'] - cy)
    W = Writer(S, shift)
    layers = tp['layers']
    W.base_h = base_height(layers)
    top = layers[-1]['z'] + S['Z_OFFSET']
    if S['MAX_PRINT_HEIGHT'] and top > S['MAX_PRINT_HEIGHT']:
        log.append('WARNING: part height %.1f mm exceeds MAX_PRINT_HEIGHT %.1f mm.' % (top, S['MAX_PRINT_HEIGHT']))
    if S['PRUSA_HEADER'] and S['CONFIG_FOOTER']:      # the header is only written together with the config block
        import datetime
        W.emit('; generated by PrusaSlicer 2.9.6 on %s UTC' % datetime.datetime.utcnow().strftime('%Y-%m-%d at %H:%M:%S'))
    if S['FIRST_LAYER_TEMPERATURE'] > 0:
        W.emit('M104 S%d ; set temperature' % S['FIRST_LAYER_TEMPERATURE'])
    if S['BED_TEMPERATURE'] > 0:
        W.emit('M140 S%d ; set bed temperature' % S['BED_TEMPERATURE'])
    start = S['START_GCODE']
    W.emit(start)
    if S['BED_TEMPERATURE'] > 0:
        W.emit('M190 S%d ; wait for bed temperature' % S['BED_TEMPERATURE'])
    if S['FIRST_LAYER_TEMPERATURE'] > 0:
        W.emit('M109 S%d ; set temperature and wait for it to be reached' % S['FIRST_LAYER_TEMPERATURE'])
    # mode lines are only added when the start G-code does not already contain them (no redundant lines)
    if not has(start, r'(?m)^\s*G21\b'):
        W.emit('G21 ; set units to millimeters')
    if not has(start, r'(?m)^\s*G90\b'):
        W.emit('G90 ; use absolute coordinates')
    if not has(start, r'(?m)^\s*M8[23]\b'):
        W.emit('M83 ; relative E' if S['RELATIVE_E'] else 'M82 ; absolute E')
    if not has(start, r'(?m)^\s*G92\s+E0\b'):
        W.emit('G92 E0')
    W.e = 0.0
    W.emit('M107')
    for L in layers:
        li = L['index']
        z = L['z'] + S['Z_OFFSET']
        h = L['height']
        W.emit(';LAYER_CHANGE')
        W.emit(';Z:%s' % f(z))
        W.emit(';HEIGHT:%s' % f(h))
        if S['BEFORE_LAYER_GCODE']:
            W.emit(S['BEFORE_LAYER_GCODE'])
        if S['LAYER_GCODE']:
            W.emit(S['LAYER_GCODE'])
        if li == 1 and S['TEMPERATURE'] != S['FIRST_LAYER_TEMPERATURE'] and S['TEMPERATURE'] > 0:
            W.emit('M104 S%d ; set temperature' % S['TEMPERATURE'])
        first = True
        last_key = None
        for p in L['paths']:
            pts = [tuple(q) for q in p['pts']]
            if len(pts) < 2:
                continue
            pts = simplify(pts, S['GCODE_RESOLUTION'], p.get('closed', False))
            kind = p['type']
            w = p['width']
            if li == 0:
                sp = S['FIRST_LAYER_SPEED']
            elif kind == 'external':
                sp = S['EXTERNAL_PERIMETER_SPEED']
            elif kind == 'perimeter':
                sp = S['PERIMETER_SPEED']
            else:
                sp = S['INFILL_SPEED']
            W.travel(pts[0], z, force_retract=(first and S['RETRACT_ON_LAYER_CHANGE']))
            first = False
            key = (kind, w)
            if key != last_key:
                W.emit(';TYPE:%s' % TYPE_NAME.get(kind, kind))
                W.emit(';WIDTH:%s' % f(w))
                last_key = key
            W.extrude(pts, w, h, sp, bool(p.get('closed', False)), kind)
            if getattr(W, 'retag', False):
                last_key = None
                W.retag = False
    W.retract()
    W.emit('M107')
    W.emit(S['END_GCODE'])                      # the very last command of the file
    cm3 = W.filament * W.fd2 / 1000.0
    secs = estimate_seconds(W.lines) * S['TIME_CORRECTION']
    if S['CONFIG_FOOTER']:
        cm3 = W.filament * W.fd2 / 1000.0
        W.emit('; objects_info = {"objects":[]}')
        W.emit('; filament used [mm] = %.2f' % W.filament)
        W.emit('; filament used [cm3] = %.2f' % cm3)
        W.emit('; filament used [g] = %.2f' % (cm3 * S['FILAMENT_DENSITY']))
        W.emit('; total filament used [g] = %.2f' % (cm3 * S['FILAMENT_DENSITY']))
        W.emit('; estimated printing time (normal mode) = %s' % fmt_time(secs))
        W.emit('')
        W.emit('; prusaslicer_config = begin')
        for k, v in config_footer(S, tp):
            W.emit('; %s = %s' % (k, v))
        W.emit('; prusaslicer_config = end')
    if W.bad_points:
        log.append('WARNING: %d points are outside the bed circle (radius %.0f mm). Move the part with PART_OFFSET_X/Y.' % (W.bad_points, S['BED_RADIUS']))
    log.append('weight: %.2f kg (%.0f cm3 x %.2f g/cm3)   estimated print time: %s' % (cm3 * S['FILAMENT_DENSITY'] / 1000.0, cm3, S['FILAMENT_DENSITY'], fmt_time(secs)))
    log.append('layers: %d, extruded path %.2f m, E total %.1f mm (%.0f cm3), %d lines' % (
        len(layers), W.path_len / 1000.0, W.filament, W.filament * W.fd2 / 1000.0, len(W.lines)))
    k_all = cm3 * S['FILAMENT_DENSITY'] / 1000.0
    k_inf = W.by_kind.get('infill', 0.0) * W.fd2 / 1000.0 * S['FILAMENT_DENSITY'] / 1000.0
    stats = dict(kg=k_all, kg_infill=k_inf, kg_other=k_all - k_inf)
    hs = {}
    for L in layers:
        k_ = (round(L['height'], 3), flow_scaled(S, L['height'], W.base_h))
        hs[k_] = hs.get(k_, 0) + 1
    log.append('flow: normal layer %.2f mm; ' % W.base_h + ', '.join('%d layer(s) of %.2f mm%s' % (n_, h_, ' (E scaled by height)' if sc_ else '') for (h_, sc_), n_ in sorted(hs.items())))
    return '\n'.join(W.lines) + '\n', log, stats


def config_footer(S, tp):
    """(key, value) pairs: the ini text at the bottom, updated with the settings of this script and the slicer."""
    cfg = []
    for line in PRUSA_CONFIG.splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            cfg.append([k.strip(), v.strip()])
    over = {'filament_diameter': S['FILAMENT_DIAMETER'], 'filament_density': S['FILAMENT_DENSITY'], 'extrusion_multiplier': S['EXTRUSION_MULTIPLIER'],
            'first_layer_temperature': S['FIRST_LAYER_TEMPERATURE'], 'temperature': S['TEMPERATURE'],
            'bed_temperature': S['BED_TEMPERATURE'], 'retract_length': S['RETRACT_LENGTH'],
            'retract_speed': S['RETRACT_SPEED'], 'deretract_speed': S['DERETRACT_SPEED'],
            'retract_lift': S['RETRACT_LIFT'], 'retract_before_travel': S['RETRACT_BEFORE_TRAVEL'],
            'travel_speed': S['TRAVEL_SPEED'], 'travel_speed_z': S['Z_SPEED'],
            'first_layer_speed': S['FIRST_LAYER_SPEED'], 'perimeter_speed': S['PERIMETER_SPEED'],
            'external_perimeter_speed': S['EXTERNAL_PERIMETER_SPEED'], 'infill_speed': S['INFILL_SPEED'],
            'max_print_height': S['MAX_PRINT_HEIGHT'], 'z_offset': S['Z_OFFSET'],
            'use_relative_e_distances': 1 if S['RELATIVE_E'] else 0,
            'start_gcode': S['START_GCODE'].replace('\n', '\\n'), 'end_gcode': S['END_GCODE'].replace('\n', '\\n')}
    ts = tp.get('settings', {})
    for src, dst in (('LAYER_HEIGHT', 'layer_height'), ('FIRST_LAYER_HEIGHT', 'first_layer_height'),
                     ('EXTERNAL_PERIMETER_WIDTH', 'external_perimeter_extrusion_width'),
                     ('PERIMETER_WIDTH', 'perimeter_extrusion_width'), ('INFILL_WIDTH', 'infill_extrusion_width'),
                     ('FIRST_LAYER_WIDTH', 'first_layer_extrusion_width'), ('PERIMETERS', 'perimeters')):
        if src in ts:
            over[dst] = ts[src]
    out = []
    for k, v in cfg:
        if k in over:
            x = over[k]
            v = ('%g' % x) if isinstance(x, (int, float)) and not isinstance(x, bool) else str(x)
        out.append((k, v))
    return out


def split_names(S):
    """FILE_NAME may be one name, a list, or a Panel with several lines / comma separated names
    -> (wasp_name, comau_name). A name containing 'comau' / 'wasp' goes to that file, otherwise the first is WASP, the second COMAU;
    a single name gets _Wasp / _Comau added."""
    v = S['FILE_NAME']
    if isinstance(v, (list, tuple)):
        raw = [str(x) for x in v]
    else:
        raw = [str(v or '')]
    names = []
    for r in raw:
        for part in re.split(r'[\r\n,;]+', r):
            part = part.strip().strip('"').strip("'").strip()
            if part.lower().endswith('.gcode'):
                part = part[:-6]
            if part:
                names.append(part)
    wasp = comau = None
    rest = []
    for n in names:
        if 'comau' in n.lower() and comau is None:
            comau = n
        elif 'wasp' in n.lower() and wasp is None:
            wasp = n
        else:
            rest.append(n)
    for n in rest:
        if wasp is None:
            wasp = n
        elif comau is None:
            comau = n
    if len(names) == 1:
        base = names[0]
        if 'comau' in base.lower() or 'wasp' in base.lower():
            wasp, comau = (wasp or base + '_Wasp'), (comau or base + '_Comau')
        else:
            wasp, comau = base + '_Wasp', base + '_Comau'
    return wasp or 'part_Wasp', comau or 'part_Comau'


def target_path(S, gh, name=None):
    """OUTPUT_FILE (folder or full path) + file name -> full path ending in .gcode (folders are created)."""
    out = str(S['OUTPUT_FILE'] or '').strip().strip('"').strip("'").strip()
    name = str(name if name is not None else (S['FILE_NAME'] if not isinstance(S['FILE_NAME'], (list, tuple)) else '')).strip().strip('"').strip("'").strip()
    name = re.sub(r'[\\/:*?"<>|]', '_', name)
    if name.lower().endswith('.gcode'):
        name = name[:-6]
    default_dir = not out
    if default_dir:
        out = os.path.join(os.path.expanduser('~'), 'Desktop') if gh else os.getcwd()
    ext = os.path.splitext(out)[1]
    is_dir = default_dir or os.path.isdir(out) or out.endswith(('/', '\\')) or (not ext and name != '')
    if is_dir:
        folder, base = out, name or 'part_wasp'
    else:
        folder, base = os.path.dirname(out), name or os.path.splitext(os.path.basename(out))[0]
    if not folder:
        folder = os.getcwd()
    if not os.path.isdir(folder):
        os.makedirs(folder)
    return os.path.abspath(os.path.join(folder, base + '.gcode'))


def save(S, text, gh, name=None):
    path = target_path(S, gh, name)
    try:
        fh = open(path, 'w', newline='\n')      # Unix line endings: PrusaSlicer compares the closing tag exactly,
    except TypeError:                           # a Windows '\r\n' would hide it ("closing tag not found")
        fh = open(path, 'wb')
    with fh:
        fh.write(text)
    return path, os.path.getsize(path) / 1e6


import re


def estimate_seconds(lines):
    x=y=z=e=0.0; f=1000.0; t=0.0; first_t=None; absE=True; zs=set()
    for l in lines:
        l=l.split(';',1)[0].strip()
        if l.startswith('M83'): absE=False
        if l.startswith('M82'): absE=True
        if l.startswith('G92'):
            m=re.search(r'E(-?[\d.]+)',l)
            if m: e=float(m.group(1))
            continue
        if not (l.startswith('G1 ') or l.startswith('G0 ')): continue
        d={a[0]:float(a[1:]) for a in l.split()[1:] if re.match(r'[XYZEF]-?[\d.]+$',a)}
        if 'F' in d: f=d['F']
        nx=d.get('X',x); ny=d.get('Y',y); nz=d.get('Z',z)
        dist=((nx-x)**2+(ny-y)**2+(nz-z)**2)**.5
        if 'E' in d:
            de=abs(d['E']-e) if absE else abs(d['E']); e=d['E'] if absE else e
        else: de=0
        if dist==0: dist=de
        if f>0: t+=dist/(f/60.0)
        x,y,z=nx,ny,nz
    return t


def fmt_time(t):
    t = int(round(t)); h, r = divmod(t, 3600); m, sec = divmod(r, 60)
    return ('%dh ' % h if h else '') + '%dm %ds' % (m, sec)


def run_comau(S, tp):
    """COMAU G-code, laid out like the Comau sample: G0 travel / G1 print with X Y Z E F on every line,
    E restarts at 0 for each path, lift to Z+10 between paths, uniform E per mm."""
    layers = tp['layers']
    cx, cy = tp['part_center']
    sx = S['BED_CENTER_X'] + S['PART_OFFSET_X'] - cx
    sy = S['BED_CENTER_Y'] + S['PART_OFFSET_Y'] - cy
    out = []
    em = out.append
    fmt = lambda v: '%.3f' % (0.0 if abs(v) < 5e-4 else v)
    lift, epm = S['COMAU_LIFT'], S['COMAU_E_PER_MM']
    em('; COMAU G-code made from the weave toolpaths (format of the Comau sample file)')
    em('; XYZ toolpath and layer heights preserved; F%s printing; %s E/mm' % (f(S['COMAU_PRINT_FEED']), f(epm)))
    em('; Uniform extrusion overrides feature-specific bead width requests')
    em('; Priming delay must be implemented in converter/PDL')
    em('G28 ; MOVE TO ORIGIN (HOME)')
    em('G21 ; UNITS: MM')
    em('G90 ; ABSOLUTE COORD')
    em('M82 ; ABSOLUTE EXTRUDE')
    em('G92 E0 F0')
    em(';TYPE:Custom')
    prev = None
    etotal = 0.0
    plen = 0.0
    e_inf = 0.0
    base_h = base_height(layers)
    pcx, pcy = S['BED_CENTER_X'] + S['PART_OFFSET_X'], S['BED_CENTER_Y'] + S['PART_OFFSET_Y']
    rmax = 0.0
    for L in layers:
        z = L['z'] + S['Z_OFFSET']
        epm = S['COMAU_E_PER_MM'] * (L['height'] / base_h if flow_scaled(S, L['height'], base_h) else 1.0)   # constant flow: E per mm follows the layer height
        if abs(epm - S['COMAU_E_PER_MM']) > 1e-9:
            em('; flow of this layer: %s E/mm (normal layers %s, layer height %s / %s)' % (f(epm), f(S['COMAU_E_PER_MM']), f(L['height']), f(base_h)))
        em(';LAYER_CHANGE')
        em(';Z:%s' % f(z))
        em(';HEIGHT:%s' % f(L['height']))
        new_layer = True
        last_type = None
        for p in L['paths']:
            pts = [tuple(q) for q in p['pts']]
            if len(pts) < 2:
                continue
            pts = simplify(pts, S['GCODE_RESOLUTION'], p.get('closed', False))
            X = [(q[0] + sx, q[1] + sy) for q in pts]
            if prev is None:
                em('G0 X0.000 Y0.000 Z%s E0.00000 F%s' % (fmt(z + lift), f(S['COMAU_Z_FEED'])))
            else:
                em('G92 E0 F0 ; END OF PRINTING PATH')
                sl = S['SLOW_LIFT_HEIGHT']
                if 0 < sl < lift and not new_layer:
                    em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(prev[0]), fmt(prev[1]), fmt(prev[2] + sl), f(S['COMAU_SLOW_LIFT_FEED'])))
                if new_layer:
                    em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(prev[0]), fmt(prev[1]), fmt(z), f(S['COMAU_Z_FEED'])))
                em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(prev[0]), fmt(prev[1]), fmt(z + lift), f(S['COMAU_LIFT_FEED'])))
            new_layer = False
            em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(X[0][0]), fmt(X[0][1]), fmt(z + lift), f(S['COMAU_TRAVEL_FEED'])))
            em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(X[0][0]), fmt(X[0][1]), fmt(z), f(S['COMAU_Z_FEED'])))
            tname = 'External perimeter' if p['type'] in ('external', 'perimeter') else 'Internal infill'
            if tname != last_type:
                em(';TYPE:%s' % tname)
                last_type = tname
            e = 0.0
            cx_, cy_ = X[0]
            tot = sum(math.hypot(X[i + 1][0] - X[i][0], X[i + 1][1] - X[i][1]) for i in range(len(X) - 1))
            closed_ = bool(p.get('closed', False))
            cut = tot - (0.0 if closed_ else (min(S['COAST_DISTANCE'], 0.4 * tot) if S['COAST_DISTANCE'] > 0 else 0.0))
            cum = 0.0
            for q in X[1:]:
                d = math.hypot(q[0] - cx_, q[1] - cy_)
                if d < 1e-4:
                    continue
                if cum + d <= cut + 1e-9:
                    e += d * epm
                elif cum < cut:                      # split: extrude up to the cut, coast the rest
                    t = (cut - cum) / d
                    mx, my = cx_ + (q[0] - cx_) * t, cy_ + (q[1] - cy_) * t
                    e += (cut - cum) * epm
                    plen += cut - cum
                    em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(mx), fmt(my), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                    cum = cut
                    d = math.hypot(q[0] - mx, q[1] - my)
                    em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(q[0]), fmt(q[1]), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                    cum = cum + d
                    cx_, cy_ = q
                    continue
                cum += d
                plen += d
                em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(q[0]), fmt(q[1]), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                cx_, cy_ = q
            if closed_ and (S['WIPE_DISTANCE'] > 0 or S['LOOP_OVERLAP'] > 0):        # the bead goes on past the start (closes the thin start), then wipes along it without extruding
                ov_, tot_ = S['LOOP_OVERLAP'], S['LOOP_OVERLAP'] + S['WIPE_DISTANCE']
                wl = 0.0
                for q in X[1:]:
                    dd = math.hypot(q[0] - cx_, q[1] - cy_)
                    if dd < 1e-4:
                        continue
                    if wl < ov_ - 1e-9 and wl + dd > ov_:
                        t = (ov_ - wl) / dd
                        mx, my = cx_ + (q[0] - cx_) * t, cy_ + (q[1] - cy_) * t
                        e += (ov_ - wl) * epm
                        plen += ov_ - wl
                        em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(mx), fmt(my), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                        cx_, cy_, dd, wl = mx, my, dd * (1 - t), ov_
                    ux, uy = (q[0] - cx_) / dd, (q[1] - cy_) / dd
                    rx, ry = uy, -ux                                     # right of the travel direction
                    dr_ = S['WIPE_SIDE_DRIFT'] if (S['WIPE_DISTANCE'] > 0 and p['type'] in ('external', 'perimeter')) else 0.0
                    if wl + dd > tot_:
                        t = (tot_ - wl) / dd
                        cx_, cy_ = cx_ + (q[0] - cx_) * t, cy_ + (q[1] - cy_) * t
                        if wl < ov_ - 1e-9:
                            e += (tot_ - wl) * epm
                            plen += tot_ - wl
                        else:
                            cx_, cy_ = cx_ + rx * dr_, cy_ + ry * dr_
                        em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(cx_), fmt(cy_), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                        break
                    qx, qy = q[0], q[1]
                    if wl < ov_ - 1e-9:
                        e += dd * epm
                        plen += dd
                    elif dr_ > 0:
                        fr = min(1.0, (wl + dd - ov_) / S['WIPE_DISTANCE'])
                        qx, qy = qx + rx * dr_ * fr, qy + ry * dr_ * fr
                    em('G1 X%s Y%s Z%s E%.5f F%s' % (fmt(qx), fmt(qy), fmt(z), e, f(S['COMAU_PRINT_FEED'])))
                    wl += dd
                    cx_, cy_ = q
            etotal += e
            if p['type'] == 'infill':
                e_inf += e
            rmax = max(rmax, max(math.hypot(q[0] - pcx, q[1] - pcy) for q in X))
            prev = (cx_, cy_, z)
    em(';TYPE:Custom')
    em('G92 E0 F0 ; END OF PRINTING PATH')
    if prev:
        # clean end: the clay that is still under pressure must not drip onto the part
        zt_ = prev[2] + S['COMAU_END_LIFT']
        sl = S['SLOW_LIFT_HEIGHT']
        if 0 < sl < S['COMAU_END_LIFT']:
            em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(prev[0]), fmt(prev[1]), fmt(prev[2] + sl), f(S['COMAU_SLOW_LIFT_FEED'])))
        em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(prev[0]), fmt(prev[1]), fmt(zt_), f(S['COMAU_Z_FEED'])))
        if S['COMAU_END_EXIT']:
            dx, dy = prev[0] - pcx, prev[1] - pcy
            dl = math.hypot(dx, dy)
            ux, uy = (dx / dl, dy / dl) if dl > 1e-6 else (1.0, 0.0)
            rx = min(rmax + S['COMAU_END_EXIT_MARGIN'], max(S['BED_RADIUS'], rmax + 8.0))      # outside the part, not beyond the bed circle
            em('G0 X%s Y%s Z%s E0.00000 F%s' % (fmt(pcx + ux * rx), fmt(pcy + uy * rx), fmt(zt_), f(S['COMAU_TRAVEL_FEED'])))
    em(S['COMAU_HOME'])
    em('; END OF FOOTER')
    info = 'COMAU: %d lines, path %.2f m, E total %.0f, weight %.2f kg' % (len(out), plen / 1000.0, etotal, etotal * S['COMAU_G_PER_E'] / 1000.0)
    k_all = etotal * S['COMAU_G_PER_E'] / 1000.0
    k_inf = e_inf * S['COMAU_G_PER_E'] / 1000.0
    return '\n'.join(out) + '\n', info, dict(kg=k_all, kg_infill=k_inf, kg_other=k_all - k_inf)


SCRIPT_VERSION = 'weave_gcode v9 (Wasp + Comau)'


def verify(path):
    """Re-open the saved file and repeat PrusaSlicer's own checks. -> (ok, message)"""
    with open(path, 'rb') as fh:
        data = fh.read()
    first = data.split(b'\n', 1)[0]
    if not first.startswith(b'; generated by PrusaSlicer '):
        return False, 'first line is not the PrusaSlicer header'
    lines = data.split(b'\n')
    while lines and lines[-1] == b'':
        lines.pop()
    if not lines or lines[-1].rstrip(b'\r') != b'; prusaslicer_config = end':
        return False, 'last line is %r, not the closing tag' % (lines[-1][:40] if lines else b'')
    n = 0
    for l in reversed(lines[:-1]):
        l = l.rstrip(b'\r')
        if l == b'; prusaslicer_config = begin':
            return (n >= 80), 'PrusaSlicer check OK: header + %d config keys + closing tag' % n
        if b'=' in l and l.startswith(b';'):
            n += 1
    return False, 'opening tag not found'


def load_toolpaths(S):
    tj = _HOST.get('ToolpathsJson')
    if tj:
        return json.loads(tj)
    return json.load(open(S['TOOLPATHS_FILE']))


# weave length at other INFILL_WIDTH values, relative to 6.0 mm (measured on F2 with weave_pattern.py + weave_slice.py: the weave changes
# only slowly with the bead width because the wavelength is raised automatically)
_LEN_CURVE = [(4.5, 1.050), (5.0, 1.027), (5.5, 1.026), (6.0, 1.000), (6.5, 0.987), (7.0, 0.960),
              (7.5, 0.931), (8.0, 0.853), (8.5, 0.864), (9.0, 0.797)]


def _len_factor(w):
    xs = [a for a, b in _LEN_CURVE]
    if w <= xs[0]:
        return _LEN_CURVE[0][1]
    if w >= xs[-1]:
        return _LEN_CURVE[-1][1]
    for (a, fa), (b, fb) in zip(_LEN_CURVE, _LEN_CURVE[1:]):
        if a <= w <= b:
            return fa + (fb - fa) * (w - a) / (b - a)


def weight_report(S, tp, machine, stats, h_base):
    """Status lines: weight against MAX_WEIGHT_KG and, when it is exceeded, the next INFILL_WIDTH to try."""
    lim = S['MAX_WEIGHT_KG']
    kg, k_inf, k_oth = stats['kg'], stats['kg_infill'], stats['kg_other']
    if not lim or lim <= 0:
        return ['Weight: %.2f kg (no limit set)' % kg]
    w_now = None
    try:
        w_now = float(tp['settings']['INFILL_WIDTH'])
    except Exception:
        pass
    if w_now is None:
        ws = {}
        for L in tp['layers'][1:]:
            for p in L['paths']:
                if p['type'] == 'infill':
                    ws[p['width']] = ws.get(p['width'], 0) + 1
        w_now = max(ws.items(), key=lambda t: t[1])[0] if ws else 6.0
    if kg <= lim:
        return ['Weight: %.2f kg, limit %.2f kg: OK (%.2f kg below the limit)' % (kg, lim, lim - kg)]
    hb = h_base if h_base > 0 else 3.5

    def mat(w):                                  # clay per mm of weave bead: Comau = constant E per mm, Wasp follows the bead cross-section
        return 1.0 if machine == 'COMAU' else hb * (w - hb * (1 - math.pi / 4.0))

    def est(w):
        return k_oth + k_inf * _len_factor(w) / _len_factor(w_now) * mat(w) / mat(w_now)
    cands = [c / 2.0 for c in range(9, 19) if abs(c / 2.0 - w_now) > 1e-6]
    ok = [c for c in cands if est(c) <= lim * 0.99]
    out = ['Weight: %.2f kg is %.2f kg OVER the limit %.2f kg' % (kg, kg - lim, lim),
           '  walls / perimeters / fill: %.2f kg,  weave (INFILL_WIDTH %.1f mm): %.2f kg' % (k_oth, w_now, k_inf)]
    if ok:
        best = min(ok, key=lambda c: (abs(c - w_now), c))
        out.append('  Next INFILL_WIDTH to try: %.1f mm (now %.1f) -> about %.2f kg' % (best, w_now, est(best)))
        out.append('  Set it in weave_pattern.py AND weave_slice.py, rebuild the pattern, slice again, export again.')
        out.append('  Estimate from F2 test runs (+-0.15 kg): the weave gets shorter only slowly as the bead widens%s.' % (
            '; a wider bead also puts more clay per mm on the Wasp' if machine != 'COMAU' else ''))
    else:
        out.append('  No INFILL_WIDTH between 4.5 and 9.0 mm brings it under the limit (the walls alone are %.2f kg).' % k_oth)
        out.append('  Other levers that keep the contact lengths: PERIMETER widths, MAX_WALL_STEP, or a lower part height.')
    return out


def gcode_lengths(text):
    """extrusion length and travel length of a written G-code (mm): a move that raises E is extrusion (XY length), every other G0 / G1 move is travel
    (XY length; vertical lift / lower moves are added up separately)."""
    x = y = z = e = 0.0
    ext = txy = tz = 0.0
    for l in text.splitlines():
        l = l.split(';', 1)[0].strip()
        if l.startswith('G92'):
            m = re.search(r'E(-?[\d.]+)', l)
            if m:
                e = float(m.group(1))
            continue
        if not (l.startswith('G1 ') or l.startswith('G0 ')):
            continue
        d = {a[0]: float(a[1:]) for a in l.split()[1:] if re.match(r'[XYZE]-?[\d.]+$', a)}
        nx, ny, nz = d.get('X', x), d.get('Y', y), d.get('Z', z)
        ne = d.get('E', e)
        dxy = math.hypot(nx - x, ny - y)
        if ne > e + 1e-9:
            ext += dxy
        else:
            txy += dxy
            tz += abs(nz - z)
        x, y, z, e = nx, ny, nz, ne
    return ext, txy, tz


def results_report(S, tp, machine, text, stats):
    """RESULTS of one machine: path lengths, time, wet weight range, and the slicer results (areas, infill shares, double wall)."""
    ext, txy, tz = gcode_lengths(text)
    raw = estimate_seconds(text.splitlines())
    if machine == 'COMAU':
        lo, hi, mean, unit = S['COMAU_G_PER_E_MIN'], S['COMAU_G_PER_E_MAX'], S['COMAU_G_PER_E'], 'g per E'
    else:
        lo, hi, mean, unit = S['WET_DENSITY_WASP_MIN'], S['WET_DENSITY_WASP_MAX'], S['FILAMENT_DENSITY'], 'g/cm3'
    kg = stats['kg']
    k_lo, k_hi = (kg * lo / mean, kg * hi / mean) if mean > 0 else (kg, kg)
    out = ['RESULTS ' + machine,
           '  Extrusion path: %.2f m   Travel path: %.2f m (XY) + %.2f m (lift / lower)' % (ext / 1000.0, txy / 1000.0, tz / 1000.0),
           '  Print time: %s (distance / feed) to %s (x %.2f time correction); upper bound: not specified' % (fmt_time(raw), fmt_time(raw * S['TIME_CORRECTION']), S['TIME_CORRECTION']),
           '  Wet weight: %.2f - %.2f kg   (wet %s used: %g - %g)' % (k_lo, k_hi, 'density' if machine != 'COMAU' else 'mass per E unit', lo, hi)]
    if machine == 'COMAU':
        out[-1] = out[-1].replace('(wet mass per E unit used', '(mass per E unit used')
    r = tp.get('results')
    if r:
        out.append('  Net bottom surface: %.1f cm2   Net top surface: %.1f cm2' % (r['net_bottom_area_mm2'] / 100.0, r['net_top_area_mm2'] / 100.0))
        out.append('  Infill in cylinders: %.1f %%   Infill in walls: %.1f %%' % (r['infill_in_cylinders_pct'], r['infill_in_walls_pct']))
        out.append('  Double-wall length: %.2f m printed over all layers, %.0f mm in plan' % (r['double_wall_printed_mm'] / 1000.0, r['double_wall_plan_mm']))
    else:
        out.append('  (areas, infill shares and double wall: slice again with the current weave_slice.py)')
    return out


def export_all(S, tp, gh):
    """writes the WASP and / or COMAU file -> (paths, status lines, log lines)"""
    wname, cname = split_names(S)
    paths, status, log = [], [], [SCRIPT_VERSION]
    ok_all = True
    if S['EXPORT_WASP']:
        text, wlog, wst = run(S, tp)
        path, mb = save(S, text, gh, wname)
        ok, msg = verify(path)
        ok_all = ok_all and ok
        paths.append(path)
        log.extend(wlog)
        log.append('WASP: ' + msg)
        info = [l for l in wlog if l.startswith('weight')]
        wt, tm = '', ''
        if info:
            m = re.match(r'weight: (.*?) \(.*?estimated print time: (.*)$', info[0].replace('   ', ' '))
            if m:
                wt, tm = m.group(1), m.group(2)
        status += ['', 'WASP', 'File: ' + os.path.basename(path), 'Folder: ' + os.path.dirname(path),
                   'Size: %.1f MB' % mb, 'Layers: %d' % len(tp['layers']), 'Weight: ' + wt, 'Print time: ' + tm,
                   'Check: ' + msg.replace('PrusaSlicer check ', '')]
        status += weight_report(S, tp, 'WASP', wst, base_height(tp['layers']))
        status += results_report(S, tp, 'WASP', text, wst)
    if S['EXPORT_COMAU']:
        text, info, cst = run_comau(S, tp)
        path, mb = save(S, text, gh, cname)
        paths.append(path)
        log.append(info)
        status += ['', 'COMAU', 'File: ' + os.path.basename(path), 'Folder: ' + os.path.dirname(path),
                   'Size: %.1f MB' % mb, 'Layers: %d' % len(tp['layers']), 'Lines: %s' % info.split(',')[0].split()[1]]
        status += weight_report(S, tp, 'COMAU', cst, base_height(tp['layers']))
        status += results_report(S, tp, 'COMAU', text, cst)
    if not paths:
        status = ['Nothing to do: EXPORT_WASP and EXPORT_COMAU are both False']
    return paths, status, log, ok_all


def main(argv=None):
    S = get_settings(sys.argv[1:] if argv is None else argv)
    print('Saving...')
    tp = load_toolpaths(S)
    paths, status, log, ok = export_all(S, tp, False)
    for l in log + status:
        print(l)


def _banner(text):
    """Show the state on the component itself (works while the solution is still running)."""
    try:
        ghenv.Component.Message = text
        import Grasshopper
        Grasshopper.Instances.RedrawCanvas()
    except Exception:
        pass


def gh_main():
    """-> GCodeFile (list of paths), Status (list of lines), Log. Errors are reported in Status instead of a red balloon.
    Optional boolean input 'Run': False = do nothing (Status: Idle), True = generate and save."""
    S = get_settings([])
    run_flag = _HOST.get('Run')
    if run_flag is not None and not run_flag:
        _banner('Idle')
        return None, ['Idle', 'Set Run = True to generate the files'], []
    if not _HOST.get('ToolpathsJson') and not os.path.exists(S['TOOLPATHS_FILE']):
        _banner('Waiting')
        return None, ['Waiting', 'Connect the ToolpathsJson output of the slicer'], []
    _banner('Processing...')
    try:
        tp = load_toolpaths(S)
        paths, status, log, ok = export_all(S, tp, True)
    except Exception as ex:
        _banner('ERROR')
        return None, ['ERROR', str(ex)], ['ERROR: %s' % ex]
    _banner('Saved' if ok else 'Check file')
    return paths, ['Files saved' if ok else 'Saved, but CHECK the WASP file'] + status, log



PRUSA_CONFIG = """
# your exported PrusaSlicer config (only written into the G-code footer for the viewer)
arc_fitting = disabled
autoemit_temperature_commands = 1
automatic_extrusion_widths = 0
automatic_infill_combination = 0
automatic_infill_combination_max_layer_height = 100%
avoid_crossing_curled_overhangs = 1
avoid_crossing_perimeters = 0
avoid_crossing_perimeters_max_detour = 0
bed_custom_model = 
bed_custom_texture = 
bed_shape = 199.239x17.4311,196.962x34.7296,193.185x51.7638,187.939x68.404,181.262x84.5237,173.205x100,163.83x114.715,153.209x128.558,141.421x141.421,128.558x153.209,114.715x163.83,100x173.205,84.5237x181.262,68.404x187.939,51.7638x193.185,34.7296x196.962,17.4311x199.239,1.22465e-14x200,-17.4311x199.239,-34.7296x196.962,-51.7638x193.185,-68.404x187.939,-84.5237x181.262,-100x173.205,-114.715x163.83,-128.558x153.209,-141.421x141.421,-153.209x128.558,-163.83x114.715,-173.205x100,-181.262x84.5237,-187.939x68.404,-193.185x51.7638,-196.962x34.7296,-199.239x17.4311,-200x2.44929e-14,-199.239x-17.4311,-196.962x-34.7296,-193.185x-51.7638,-187.939x-68.404,-181.262x-84.5237,-173.205x-100,-163.83x-114.715,-153.209x-128.558,-141.421x-141.421,-128.558x-153.209,-114.715x-163.83,-100x-173.205,-84.5237x-181.262,-68.404x-187.939,-51.7638x-193.185,-34.7296x-196.962,-17.4311x-199.239,-3.67394e-14x-200,17.4311x-199.239,34.7296x-196.962,51.7638x-193.185,68.404x-187.939,84.5237x-181.262,100x-173.205,114.715x-163.83,128.558x-153.209,141.421x-141.421,153.209x-128.558,163.83x-114.715,173.205x-100,181.262x-84.5237,187.939x-68.404,193.185x-51.7638,196.962x-34.7296,199.239x-17.4311,200x-4.89859e-14
bed_temperature = 0
bed_temperature_extruder = 0
before_layer_gcode = 
between_objects_gcode = 
binary_gcode = 0
bottom_fill_pattern = monotonic
bottom_solid_layers = 0
bottom_solid_min_thickness = 0
bridge_acceleration = 0
bridge_angle = 0
bridge_fan_speed = 100
bridge_flow_ratio = 1
bridge_speed = 60
brim_separation = 0
brim_type = outer_only
brim_width = 0
chamber_minimal_temperature = 0
chamber_temperature = 0
color_change_gcode = M600
colorprint_heights = 
complete_objects = 0
cooling = 1
cooling_perimeter_transition_distance = 0
cooling_slowdown_logic = uniform_cooling
cooling_tube_length = 5
cooling_tube_retraction = 91.5
custom_parameters_filament = ""
custom_parameters_print = 
custom_parameters_printer = 
default_acceleration = 0
default_filament_profile = 
default_print_profile = 
deretract_speed = 5
disable_fan_first_layers = 3
dont_support_bridges = 1
draft_shield = disabled
duplicate_distance = 6
elefant_foot_compensation = 0
enable_dynamic_fan_speeds = 0
enable_dynamic_overhang_speeds = 0
end_filament_gcode = ""
end_gcode = M400         ; Wait for printing movements to finish\nG91          ; Temporarily use relative XYZ coordinates\nG1 Z5 F600   ; Lift 5 mm at 10 mm/s\nG90          ; Restore absolute XYZ coordinates\nG28          ; Return to the top home position\nM400         ; Wait until homing finishes
ensure_vertical_shell_thickness = disabled
external_perimeter_acceleration = 0
external_perimeter_extrusion_width = 7
external_perimeter_speed = 60
external_perimeters_first = 0
extra_loading_move = -2
extra_perimeters = 0
extra_perimeters_on_overhangs = 0
extruder_clearance_height = 20
extruder_clearance_radius = 20
extruder_colour = ""
extruder_offset = 0x0
extrusion_axis = E
extrusion_multiplier = 0.9
extrusion_width = 6
fan_always_on = 0
fan_below_layer_time = 60
filament_abrasive = 0
filament_colour = #29B2B2
filament_cooling_final_speed = 3.4
filament_cooling_initial_speed = 2.2
filament_cooling_moves = 4
filament_cost = 0
filament_density = 2.34
filament_deretract_speed = nil
filament_diameter = 7.5
filament_flush_speed = 0
filament_flush_volume = 0
filament_infill_max_crossing_speed = 0
filament_infill_max_speed = 0
filament_load_time = 0
filament_loading_speed = 28
filament_loading_speed_start = 3
filament_max_volumetric_speed = 0
filament_minimal_purge_on_wipe_tower = 15
filament_multitool_ramming = 0
filament_multitool_ramming_flow = 10
filament_multitool_ramming_volume = 10
filament_notes = ""
filament_purge_multiplier = 100%
filament_ramming_parameters = "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6"
filament_retract_before_travel = nil
filament_retract_before_wipe = nil
filament_retract_layer_change = nil
filament_retract_length = nil
filament_retract_length_toolchange = nil
filament_retract_lift = nil
filament_retract_lift_above = nil
filament_retract_lift_below = nil
filament_retract_restart_extra = nil
filament_retract_restart_extra_toolchange = nil
filament_retract_speed = nil
filament_seam_gap_distance = nil
filament_settings_id = Wasp-Blocks
filament_shrinkage_compensation_xy = 0%
filament_shrinkage_compensation_z = 0%
filament_soluble = 0
filament_spool_weight = 0
filament_stamping_distance = 0
filament_stamping_loading_speed = 20
filament_toolchange_delay = 0
filament_travel_lift_before_obstacle = nil
filament_travel_max_lift = nil
filament_travel_ramping_lift = nil
filament_travel_slope = nil
filament_type = PLA
filament_unload_time = 0
filament_unloading_speed = 90
filament_unloading_speed_start = 100
filament_vendor = (Unknown)
filament_wipe = nil
fill_angle = 0
fill_density = 40%
fill_pattern = honeycomb
first_layer_acceleration = 0
first_layer_acceleration_over_raft = 0
first_layer_bed_temperature = 0
first_layer_extrusion_width = 7
first_layer_height = 2
first_layer_infill_speed = 0
first_layer_speed = 33
first_layer_speed_over_raft = 30
first_layer_temperature = 200
full_fan_speed_layer = 0
fuzzy_skin = none
fuzzy_skin_point_dist = 0.8
fuzzy_skin_thickness = 0.3
gap_fill_enabled = 1
gap_fill_speed = 60
gcode_comments = 0
gcode_flavor = marlin
gcode_label_objects = disabled
gcode_resolution = 0.1
gcode_substitutions = 
high_current_on_filament_swap = 0
host_type = prusalink
idle_temperature = nil
infill_acceleration = 0
infill_anchor = 5
infill_anchor_max = 500
infill_every_layers = 1
infill_extruder = 1
infill_extrusion_width = 6
infill_first = 0
infill_overlap = 25%
infill_speed = 60
interface_shells = 0
interlocking_beam = 0
interlocking_beam_layer_count = 2
interlocking_beam_width = 0.8
interlocking_boundary_avoidance = 2
interlocking_depth = 2
interlocking_orientation = 22.5
ironing = 0
ironing_flowrate = 15%
ironing_spacing = 0.1
ironing_speed = 15
ironing_type = top
layer_gcode = 
layer_height = 3.5
machine_limits_usage = time_estimate_only
machine_max_acceleration_e = 10000,5000
machine_max_acceleration_extruding = 1500,1250
machine_max_acceleration_retracting = 1500,1250
machine_max_acceleration_travel = 1500,1250
machine_max_acceleration_x = 9000,1000
machine_max_acceleration_y = 9000,1000
machine_max_acceleration_z = 500,200
machine_max_feedrate_e = 120,120
machine_max_feedrate_x = 500,200
machine_max_feedrate_y = 500,200
machine_max_feedrate_z = 12,12
machine_max_jerk_e = 2.5,2.5
machine_max_jerk_x = 10,10
machine_max_jerk_y = 10,10
machine_max_jerk_z = 0.2,0.4
machine_max_junction_deviation = 0,0
machine_min_extruding_rate = 0,0
machine_min_travel_rate = 0,0
max_fan_speed = 100
max_layer_height = 3.5
max_print_height = 200
max_print_speed = 80
max_volumetric_extrusion_rate_slope_negative = 0
max_volumetric_extrusion_rate_slope_positive = 0
max_volumetric_speed = 0
min_bead_width = 85%
min_fan_speed = 35
min_feature_size = 25%
min_layer_height = 2
min_print_speed = 10
min_skirt_length = 0
mmu_segmented_region_interlocking_depth = 0
mmu_segmented_region_max_width = 0
multimaterial_purging = 140
notes = This setting is set for Wasp 40100 LDM as the printer, for Nozzle size of 6.
nozzle_diameter = 6
nozzle_high_flow = 0
only_one_perimeter_first_layer = 0
only_retract_when_crossing_perimeters = 0
ooze_prevention = 0
output_filename_format = [input_filename_base].gcode
over_bridge_speed = 60
overhang_fan_speed_0 = 0
overhang_fan_speed_1 = 0
overhang_fan_speed_2 = 0
overhang_fan_speed_3 = 0
overhang_speed_0 = 15
overhang_speed_1 = 15
overhang_speed_2 = 20
overhang_speed_3 = 25
overhangs = 1
parking_pos_retraction = 92
pause_print_gcode = M601
perimeter_acceleration = 0
perimeter_extruder = 1
perimeter_extrusion_width = 5
perimeter_generator = classic
perimeter_speed = 60
perimeters = 1
physical_printer_settings_id = 
post_process = 
prefer_clockwise_movements = 0
print_settings_id = Wasp-Blocks
printer_model = 
printer_notes = 
printer_settings_id = Wasp - Blocks
printer_technology = FFF
printer_variant = 
printer_vendor = 
raft_contact_distance = 0.1
raft_expansion = 1.5
raft_first_layer_density = 90%
raft_first_layer_expansion = 3
raft_layers = 0
remaining_times = 0
resolution = 0
retract_before_travel = 6
retract_before_wipe = 0%
retract_layer_change = 0
retract_length = 0.5
retract_length_toolchange = 10
retract_lift = 10
retract_lift_above = 0
retract_lift_below = 0
retract_restart_extra = 0
retract_restart_extra_toolchange = 0
retract_speed = 10
scarf_seam_entire_loop = 0
scarf_seam_length = 30
scarf_seam_max_segment_length = 1
scarf_seam_on_inner_perimeters = 0
scarf_seam_only_on_smooth = 1
scarf_seam_placement = nowhere
scarf_seam_start_height = 50%
seam_gap_distance = 0
seam_position = aligned
silent_mode = 0
single_extruder_multi_material = 0
single_extruder_multi_material_priming = 1
skirt_distance = 6
skirt_height = 1
skirts = 0
slice_closing_radius = 0.049
slicing_mode = regular
slowdown_below_layer_time = 5
small_perimeter_speed = 60
solid_infill_acceleration = 0
solid_infill_below_area = 70
solid_infill_every_layers = 0
solid_infill_extruder = 1
solid_infill_extrusion_width = 0
solid_infill_speed = 20
spiral_vase = 0
staggered_inner_seams = 1
standby_temperature_delta = -5
start_filament_gcode = ""
start_gcode = G21          ; Use millimetres\nG90          ; Use absolute XYZ coordinates\nM82          ; Use absolute extrusion coordinates\nG28          ; Home the delta printer\nG92 E0       ; Set the extrusion counter to zero
support_material = 0
support_material_angle = 0
support_material_auto = 1
support_material_bottom_contact_distance = 0
support_material_bottom_interface_layers = -1
support_material_buildplate_only = 0
support_material_closing_radius = 2
support_material_contact_distance = 0.2
support_material_enforce_layers = 0
support_material_extruder = 1
support_material_extrusion_width = 0
support_material_interface_contact_loops = 0
support_material_interface_extruder = 1
support_material_interface_layers = 3
support_material_interface_pattern = rectilinear
support_material_interface_spacing = 0
support_material_interface_speed = 100%
support_material_pattern = rectilinear
support_material_spacing = 2.5
support_material_speed = 60
support_material_style = grid
support_material_synchronize_layers = 0
support_material_threshold = 0
support_material_with_sheath = 1
support_material_xy_spacing = 50%
support_tree_angle = 40
support_tree_angle_slow = 25
support_tree_branch_diameter = 2
support_tree_branch_diameter_angle = 5
support_tree_branch_diameter_double_wall = 3
support_tree_branch_distance = 1
support_tree_tip_diameter = 0.8
support_tree_top_rate = 15%
temperature = 200
template_custom_gcode = 
thick_bridges = 1
thin_walls = 0
thumbnails = 
thumbnails_format = PNG
toolchange_gcode = 
toolchange_ordering = optimized
top_fill_pattern = monotonic
top_infill_extrusion_width = 0
top_one_perimeter_type = none
top_solid_infill_acceleration = 0
top_solid_infill_speed = 15
top_solid_layers = 0
top_solid_min_thickness = 0
travel_acceleration = 0
travel_lift_before_obstacle = 0
travel_max_lift = 0
travel_ramping_lift = 0
travel_short_distance_acceleration = 0
travel_slope = 0
travel_speed = 100
travel_speed_z = 33
use_firmware_retraction = 0
use_relative_e_distances = 0
use_volumetric_e = 0
variable_layer_height = 1
wall_distribution_count = 1
wall_transition_angle = 10
wall_transition_filter_deviation = 25%
wall_transition_length = 100%
wipe = 0
wipe_into_infill = 0
wipe_into_objects = 0
wipe_tower = 0
wipe_tower_acceleration = 0
wipe_tower_bridging = 10
wipe_tower_brim_width = 2
wipe_tower_cone_angle = 0
wipe_tower_extra_flow = 100%
wipe_tower_extra_spacing = 100%
wipe_tower_extruder = 0
wipe_tower_no_sparse_layers = 0
wipe_tower_width = 60
wiping_volumes_matrix = 0
wiping_volumes_use_custom_matrix = 0
xy_size_compensation = 0
z_offset = 0
"""


try:
    import Rhino      # running inside Rhino / Grasshopper
    HAVE_RHINO = True
except ImportError:
    HAVE_RHINO = False

if HAVE_RHINO:
    GCodeFile, Status, Log = gh_main()
elif __name__ == '__main__':
    main()