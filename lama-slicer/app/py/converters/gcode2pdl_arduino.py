#!/usr/bin/env python3
"""
gcode2pdl_arduino.py - batch-translate 3-axis G-code (Termite, Simplify3D, compas_slicer, ...)
into Comau PDL2 programs that drive the clay extruder through the Arduino on COM1,
in the same format as Spiral0925Ext / SoilLines0925Ext / Module0925Ext.

HOW TO USE
  Double-click convert.bat (or run: python gcode2pdl_arduino.py)
      -> pick one or more .gcode files -> pick the output folder
      -> a small window opens for each file with its print settings -> Convert
  Drag .gcode files or a folder onto convert.bat         -> same, without the file picker
  python gcode2pdl_arduino.py <files/folders> --out DIR --no-gui
                                                         -> pure batch with settings.json values
  --copy-to DIR  also copies every finished .pdl to DIR (USB stick, network share, ...)

RULES BUILT IN (from the work on the Spiral/Soil/Module programs)
  * Name: file name with everything except letters/digits removed, plus "Ext"
    (Module0925_lh4.gcode -> Module0925lh4Ext.pdl). The same name is used in PROGRAM,
    ROUTINE R_<name>, EXPORTED FROM, the call in the main block and both END lines.
  * Arduino extruder over COM1 (PDLmotordriverTest.ino, 115200 baud):
      header  DV_CNTRL / OPEN FILE / '0;' / 'G1.0;' / 'S<flow x factor>;'
      each printed path:  MOVE LINEAR to path start, $SPD_OPT, $LIN_SPD, WRITE '1;',
                          MOVEFLY ... ADVANCE through the path, MOVE LINEAR to the last point, WRITE '0;'
      footer  '0;' / CLOSE FILE
  * Same start pose and motion settings as the RoboDK-based programs; $TOOL and $UFRAME are
    set in the pop-up (defaults 606.5, 0, 210, 0, 90, 0 and 1400, 600, -12, 0, 0, 0).
  * Placement: first printed layer moved to Z 12 in $UFRAME; XY kept, or centred on the frame
    origin when the part does not sit on the origin (placement "auto").
  * Speeds: F (mm/min) -> $LIN_SPD (m/s); optional overrides for print and travel speed.
  * Removed: purge/prime lines, travel before the first path, moves to far points after the
    last path (vertical lifts at the last point are kept), extrusion-only retract lines, M/G28 codes.
  * Optional vertical approach above the first point (default 0 = off) and vertical retract
    after the last point (default 100 mm), both without extruding.
"""
import argparse, glob, json, math, os, re, shutil, sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(HERE, 'settings.json')

DEFAULTS = {
    # --- asked in the pop-up for every file ---------------------------------------------
    "print_speed_mm_s": "",        # blank = use the G-code F values
    "travel_speed_mm_s": "",       # blank = use the G-code F values
    "flow_rate_S": -700,           # Arduino motor speed value (S command), sign = direction
    "extrusion_factor": 1.0,       # multiplies the flow rate: S written = flow_rate_S x factor
    "first_layer_z": 12.0,         # Z of the first printed layer in $UFRAME (mm)
    "approach_mm": 0.0,            # vertical approach above the first point, 0 = none
    "retract_mm": 100.0,           # vertical retract after the last point, 0 = none
    "placement": "auto",           # auto | center | keep
    # --- cell (edit here or in settings.json) --------------------------------------------
    "robot": "Comau Smart5 NJ 60-2.2",
    "uframe": [1400.0, 600.0, -12.0, 0.0, 0.0, 0.0],   # part origin in robot base (also in the pop-up)
    "tool": [606.5, 0.0, 210.0, 0.0, 90.0, 0.0],  # nozzle tip on the flange (also in the pop-up)
    "home": [-28.28540, 7.68203, -135.62900, 146.13600, 58.25590, -160.55400],
    "orient": [0.0, 180.0, 0.0],
    "config": "T1:0 T2:0 T3:0",
    "fly_dist": 1.0,
    "stress_per": 65,
    "approach_speed": 0.100,       # m/s for approach and retract moves
    "com_port": "COM1:",
    "gear_ratio": "1.0",
    "name_suffix": "Ext",
    "extensions": [".gcode", ".gco", ".nc"],
}

POPUP_FIELDS = [  # key, label, kind
    ("print_speed_mm_s", "Print speed (mm/s, blank = from G-code)", "float_or_blank"),
    ("travel_speed_mm_s", "Travel speed (mm/s, blank = from G-code)", "float_or_blank"),
    ("flow_rate_S", "Flow rate S (Arduino motor value)", "float"),
    ("extrusion_factor", "Extrusion factor (x flow rate)", "float"),
    ("first_layer_z", "First layer Z in $UFRAME (mm)", "float"),
    ("approach_mm", "Vertical approach (mm, 0 = none)", "float"),
    ("retract_mm", "Vertical retract at end (mm, 0 = none)", "float"),
    ("tool", "Tool TCP  x, y, z, e1, e2, e3", "vec6"),
    ("uframe", "Frame $UFRAME  x, y, z, e1, e2, e3", "vec6"),
]

WORD = re.compile(r'([A-Z])\s*([-+]?\d*\.?\d+)')
PURGE_ON = re.compile(r'\b(purge|prime)\b', re.I)
PURGE_OFF = re.compile(r'begin|layer|toolpath|end of header', re.I)


# ----------------------------------------------------------------------------- parsing
def parse(path):
    """Return list of moves: dict(n, x, y, z, f, ext) - ext = this move extrudes."""
    pos = {'X': None, 'Y': None, 'Z': 0.0}
    e_now, feed, absolute, abs_e, mm, purge = 0.0, None, True, True, True, False
    moves = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for n, raw in enumerate(fh, 1):
            code, _, comment = raw.partition(';')
            code = code.split('(')[0].strip().upper()
            if not code:
                c = comment.strip()
                if c and PURGE_ON.search(c): purge = True
                elif c and purge and PURGE_OFF.search(c): purge = False
                continue
            words = {}
            for k, v in WORD.findall(code):
                words.setdefault(k, float(v))
            g, m = words.get('G'), words.get('M')
            if m == 82: abs_e = True
            if m == 83: abs_e = False
            if g == 20: mm = False
            if g == 21: mm = True
            if g == 90: absolute = True
            if g == 91: absolute = False
            if g == 92:
                if 'E' in words: e_now = words['E']
                continue
            if g not in (0, 1):
                continue
            s = 1.0 if mm else 25.4
            if 'F' in words: feed = words['F'] * s
            ext = False
            de = 0.0
            if 'E' in words:
                e_new = words['E'] if abs_e else e_now + words['E']
                ext = g == 1 and e_new > e_now + 1e-9
                de = e_new - e_now
                e_now = e_new
            new = dict(pos)
            for ax in 'XYZ':
                if ax in words:
                    v = words[ax] * s
                    new[ax] = v if (absolute or new[ax] is None) else new[ax] + v
            if new['X'] is None or new['Y'] is None:      # position unknown until first XY
                pos = new
                continue
            if new == pos:
                continue
            pos = new
            moves.append(dict(n=n, x=pos['X'], y=pos['Y'], z=pos['Z'], f=feed, de=de,
                              ext=ext and not purge, purge=purge))
    return moves


def trim(moves):
    """Drop purge, travel before the first path and far moves after the last path."""
    mv = [m for m in moves if not m['purge']]
    ext_idx = [i for i, m in enumerate(mv) if m['ext']]
    if not ext_idx:
        return []
    a, b = ext_idx[0], ext_idx[-1]
    start = mv[a - 1] if a > 0 else dict(mv[a], ext=False)
    out = [dict(start, ext=False)] + mv[a:b + 1]
    last = mv[b]
    for m in mv[b + 1:]:                     # keep vertical lifts at the last point only
        if abs(m['x'] - last['x']) < 1e-6 and abs(m['y'] - last['y']) < 1e-6 and m['z'] >= last['z']:
            out.append(m)
        else:
            break
    return out


def analyse(moves):
    pr = [m for m in moves if m['ext']]
    xs, ys, zs = [m['x'] for m in pr], [m['y'] for m in pr], [m['z'] for m in pr]
    L = sum(math.dist((p['x'], p['y'], p['z']), (q['x'], q['y'], q['z']))
            for p, q in zip(moves, moves[1:]) if q['ext'])
    paths = sum(1 for p, q in zip(moves, moves[1:]) if q['ext'] and not p['ext'])
    return dict(xmin=min(xs), xmax=max(xs), ymin=min(ys), ymax=max(ys), zmin=min(zs), zmax=max(zs),
                length=L, paths=paths, moves=len(moves))


# ----------------------------------------------------------------------------- writing
def prog_name(path, cfg):
    stem = re.sub(r'[^A-Za-z0-9]', '', os.path.splitext(os.path.basename(path))[0])
    if not stem or not stem[0].isalpha():
        stem = 'P' + stem
    suf = cfg['name_suffix']
    return stem if stem.endswith(suf) else stem + suf


def f4(v):
    s = f'{v:.4f}'
    return '0.0000' if s == '-0.0000' else s


def fnum(v):
    return ('%g' % v) if v != '' else ''


def build(src, moves, st, cfg, name):
    a = analyse(moves)
    dz = float(st['first_layer_z']) - a['zmin']
    dx = dy = 0.0
    mode = st.get('placement', 'auto')
    cx, cy = (a['xmin'] + a['xmax']) / 2, (a['ymin'] + a['ymax']) / 2
    tol = 1.0   # mm: a part touching the origin counts as placed on it
    on_origin = a['xmin'] - tol <= 0 <= a['xmax'] + tol and a['ymin'] - tol <= 0 <= a['ymax'] + tol
    if mode == 'center' or (mode == 'auto' and not on_origin):
        dx, dy = -round(cx, 3), -round(cy, 3)
    ps = float(st['print_speed_mm_s']) / 1000 if st['print_speed_mm_s'] != '' else None
    ts = float(st['travel_speed_mm_s']) / 1000 if st['travel_speed_mm_s'] != '' else None
    S = int(round(float(st['flow_rate_S']) * float(st['extrusion_factor'])))
    o = cfg['orient']
    ori = f"{f4(o[0])}, {f4(o[1])}, {f4(o[2])}, '{cfg['config']}'"
    L = []
    w = L.append
    cur = [None]

    def speed(v, force=False):
        v = round(v, 3)
        if force or v != cur[0]:
            w('  $SPD_OPT := SPD_LIN')
            w(f'  $LIN_SPD := {v:.3f}')
            cur[0] = v

    def spd_of(m):
        if m['ext'] and ps: return ps
        if not m['ext'] and ts: return ts
        return (m['f'] or 3000.0) / 60000.0

    def pos(m, z=None):
        return (f"POS({f4(m['x'] + dx)}, {f4(m['y'] + dy)}, "
                f"{f4((m['z'] if z is None else z) + dz)}, {ori})")

    w(f'PROGRAM {name}')
    w('VAR vi_lun_w : INTEGER NOSAVE   -- serial channel number for the Arduino')
    w(f'ROUTINE R_{name} EXPORTED FROM {name} GLOBAL')
    w('')
    w(f'ROUTINE R_{name}')
    w('VAR')
    w('BEGIN')
    w('  -- Extruder: text commands over COM1 to the Arduino (PDLmotordriverTest.ino, 115200 baud)')
    w(f"  DV_CNTRL(4, '{cfg['com_port']}', COM_BD115200 OR COM_RDAHD OR COM_BIT8 OR COM_PAR_NO OR COM_STOP1 OR COM_PASAL, 65536)")
    w(f"  OPEN FILE vi_lun_w ('{cfg['com_port']}', 'w') WITH $FL_BINARY = ON")
    w("  WRITE vi_lun_w ('0;')       -- extruder OFF")
    w(f"  WRITE vi_lun_w ('G{cfg['gear_ratio']};')    -- gear ratio")
    w(f"  WRITE vi_lun_w ('S{S};')   -- extrusion speed = flow {fnum(float(st['flow_rate_S']))} x factor {fnum(float(st['extrusion_factor']))}; motor still disabled")
    for s in ['$ORNT_TYPE := RS_WORLD', '$MOVE_TYPE := JOINT', '$JNT_MTURN := TRUE', '$CNFG_CARE := TRUE',
              '$TURN_CARE := TRUE', '$SING_CARE := FALSE', '$TERM_TYPE := NOSETTLE', '$FLY_TYPE := FLY_CART',
              '$FLY_TRAJ := FLY_PASS', f"$FLY_DIST := {cfg['fly_dist']:.3f}", f"$STRESS_PER:= {cfg['stress_per']}"]:
        w('  ' + s)
    w(f"  -- Converted from {os.path.basename(src)} by gcode2pdl_arduino.py for {cfg['robot']} on {datetime.now():%d/%m/%Y %H:%M}")
    w(f"  -- Print speed: {'%g mm/s' % (ps * 1000) if ps else 'from G-code'}, travel speed: "
      f"{'%g mm/s' % (ts * 1000) if ts else 'from G-code'}, S{S}")
    w(f'  -- Placement: X {dx:+g}, Y {dy:+g}, Z {dz:+g} mm (first layer at Z {fnum(float(st["first_layer_z"]))})')
    speed(cfg['approach_speed'])
    w(f"  $UFRAME := POS({', '.join(f4(float(v)) for v in st['uframe'])}, '')")
    w(f"  $TOOL := POS({', '.join(f4(float(v)) for v in st['tool'])}, '')")
    w('  MOVE TO {' + ','.join(f'{j:.5f}' for j in cfg['home']) + '}')

    first = moves[0]
    app = float(st['approach_mm'])
    if app > 0:
        w(f'  -- {app:g} mm vertical approach to the first point, no extrusion')
        w(f'  MOVE LINEAR TO {pos(first, first["z"] + app)}')
    ons = 0
    for i, m in enumerate(moves):
        nxt = moves[i + 1] if i + 1 < len(moves) else None
        starts = nxt is not None and nxt['ext'] and not m['ext']
        ends = m['ext'] and (nxt is None or not nxt['ext'])
        if i > 0 or app == 0:
            speed(spd_of(m))
        stop = i == 0 or starts or ends or nxt is None
        w(f'  MOVE LINEAR TO {pos(m)}' if stop else f'  MOVEFLY LINEAR TO {pos(m)} ADVANCE')
        if starts:
            speed(spd_of(nxt), force=True)
            w("  WRITE vi_lun_w ('1;')       -- extruder ON")
            ons += 1
        if ends:
            w("  WRITE vi_lun_w ('0;')       -- extruder OFF")
    ret = float(st['retract_mm'])
    if ret > 0:
        last = moves[-1]
        w(f'  -- {ret:g} mm vertical retraction from the last point, no extrusion')
        speed(cfg['approach_speed'])
        w(f'  MOVE LINEAR TO {pos(last, last["z"] + ret)}')
    w("  WRITE vi_lun_w ('0;')       -- safety OFF")
    w('  CLOSE FILE vi_lun_w            -- release COM1')
    w(f'END R_{name}')
    w('')
    w('BEGIN')
    w(f'  R_{name}')
    w(f'END {name}')
    w('')
    return '\n'.join(L), dict(a, S=S, ons=ons, dx=dx, dy=dy, dz=dz, lines=len(L))


def estimate_min(moves, st):
    ps = float(st['print_speed_mm_s']) if st['print_speed_mm_s'] != '' else None
    ts = float(st['travel_speed_mm_s']) if st['travel_speed_mm_s'] != '' else None
    t = 0.0
    for p, q in zip(moves, moves[1:]):
        d = math.dist((p['x'], p['y'], p['z']), (q['x'], q['y'], q['z']))
        v = (ps if q['ext'] else ts) or (q['f'] or 3000.0) / 60.0
        t += d / max(v, 1e-6)
    return t / 60.0


# ----------------------------------------------------------------------------- pop-up
def gcode_values(src, moves, raw):
    """What the G-code itself says for each setting shown in the pop-up (text per key)."""
    def rng(vals):
        vals = sorted(set(round(v, 1) for v in vals))
        if not vals: return '-'
        return f'{vals[0]:g}' if len(vals) == 1 else f'{vals[0]:g}-{vals[-1]:g}'
    pr = [q for q in moves if q['ext']]
    tr = [q for q in moves if not q['ext']]
    ratios = sorted(q['de'] / d for p, q in zip(moves, moves[1:]) if q['ext']
                    and (d := math.dist((p['x'], p['y'], p['z']), (q['x'], q['y'], q['z']))) > 1e-6)
    e_mm = ratios[len(ratios) // 2] if ratios else 0
    head = open(src, encoding='utf-8', errors='replace').read(40000)
    m = (re.search(r'extrusionMultiplier\s*,\s*([\d.]+)', head) or
         re.search(r'Extrusion Factor:\s*([\d.]+)', head) or re.search(r'flow(?:rate)?\s*[:=,]\s*([\d.]+)', head, re.I))
    a = analyse(moves)
    last_print = pr[-1]
    first_layer = a['zmin']
    return {
        'print_speed_mm_s': rng(q['f'] / 60 for q in pr if q['f']) + ' mm/s',
        'travel_speed_mm_s': (rng(q['f'] / 60 for q in tr if q['f']) + ' mm/s') if tr else '-',
        'flow_rate_S': f'E {e_mm:.3g} per mm of path',
        'extrusion_factor': ('%g' % float(m.group(1))) if m else 'not given',
        'first_layer_z': f'{first_layer:g} mm',
        'approach_mm': f'starts {moves[0]["z"] - first_layer:+g} mm above layer 1',
        'retract_mm': f'ends {moves[-1]["z"] - last_print["z"]:+g} mm above last point',
        'tool': 'printer G-code, no tool',
        'uframe': 'printer bed origin, no frame',
        'placement': 'part centre X %s, Y %s' % tuple(('%.1f' % v).replace('-0.0', '0.0') for v in
                                                      ((a['xmin'] + a['xmax']) / 2, (a['ymin'] + a['ymax']) / 2)),
    }


def popup(name, src, moves, st, remaining):
    """Returns (settings, action) with action in {'convert', 'all', 'skip', 'cancel'}."""
    import tkinter as tk
    from tkinter import ttk
    a = analyse(moves)
    res = {'action': 'cancel', 'st': st}
    root = tk.Tk()
    root.title(f'{name}.pdl - print settings')
    root.resizable(False, False)
    frm = ttk.Frame(root, padding=14)
    frm.grid()
    info = (f"{os.path.basename(src)}  ->  {name}.pdl\n"
            f"{a['moves']} moves, {a['paths']} printed paths, "
            f"part {a['xmax'] - a['xmin']:.0f} x {a['ymax'] - a['ymin']:.0f} x {a['zmax'] - a['zmin']:.0f} mm, "
            f"path {a['length'] / 1000:.1f} m")
    ttk.Label(frm, text=info, justify='left').grid(row=0, column=0, columnspan=3, sticky='w', pady=(0, 10))
    gv = gcode_values(src, moves, None)
    ttk.Label(frm, text='Setting').grid(row=1, column=0, sticky='w')
    ttk.Label(frm, text='Use').grid(row=1, column=1, sticky='w', padx=(10, 0))
    ttk.Label(frm, text='In the G-code').grid(row=1, column=2, sticky='w', padx=(14, 0))
    vars_ = {}
    for r, (k, label, kind) in enumerate(POPUP_FIELDS, 2):
        ttk.Label(frm, text=label).grid(row=r, column=0, sticky='w', pady=2)
        if kind == 'vec6':
            val = ', '.join(fnum(float(x)) for x in st[k])
        else:
            val = fnum(st[k]) if st[k] != '' else ''
        v = tk.StringVar(value=val)
        ttk.Entry(frm, textvariable=v, width=26 if kind == 'vec6' else 12).grid(row=r, column=1, sticky='w', padx=(10, 0))
        ttk.Label(frm, text=gv.get(k, ''), foreground='#666').grid(row=r, column=2, sticky='w', padx=(14, 0))
        vars_[k] = (v, kind)
    r = len(POPUP_FIELDS) + 2
    ttk.Label(frm, text='Placement').grid(row=r, column=0, sticky='w', pady=2)
    pl = tk.StringVar(value=st['placement'])
    ttk.Combobox(frm, textvariable=pl, values=['auto', 'center', 'keep'], width=9,
                 state='readonly').grid(row=r, column=1, sticky='w', padx=(10, 0))
    ttk.Label(frm, text=gv['placement'], foreground='#666').grid(row=r, column=2, sticky='w', padx=(14, 0))
    status = tk.StringVar()
    ttk.Label(frm, textvariable=status, foreground='#555').grid(row=r + 1, column=0, columnspan=3, sticky='w', pady=(8, 4))

    def read():
        new = dict(st)
        for k, (v, kind) in vars_.items():
            if kind == 'vec6':
                parts = [x for x in re.split(r'[,;\s]+', v.get().strip()) if x]
                try:
                    vals = [float(x) for x in parts]
                except ValueError:
                    vals = []
                if len(vals) != 6:
                    status.set(('Tool' if k == 'tool' else 'Frame') + ' needs 6 numbers: x, y, z, e1, e2, e3')
                    return None
                new[k] = vals
                continue
            s = v.get().strip().replace(',', '.')
            if kind == 'float_or_blank' and s == '':
                new[k] = ''
                continue
            try:
                new[k] = float(s)
            except ValueError:
                status.set(f'Not a number: {s!r}')
                return None
        new['placement'] = pl.get()
        return new

    def refresh(*_):
        new = read()
        if new:
            S = int(round(new['flow_rate_S'] * new['extrusion_factor']))
            status.set(f"S written: S{S}   estimated time: {estimate_min(moves, new):.0f} min")
    for v, _ in vars_.values():
        v.trace_add('write', refresh)
    refresh()

    def done(action):
        new = read()
        if new is None and action != 'cancel' and action != 'skip':
            return
        res['action'], res['st'] = action, (new or st)
        root.destroy()

    bf = ttk.Frame(frm)
    bf.grid(row=r + 2, column=0, columnspan=3, sticky='e', pady=(6, 0))
    ttk.Button(bf, text='Skip', command=lambda: done('skip')).grid(row=0, column=0, padx=3)
    if remaining > 0:
        ttk.Button(bf, text=f'Convert all {remaining + 1} with these',
                   command=lambda: done('all')).grid(row=0, column=1, padx=3)
    ttk.Button(bf, text='Convert', command=lambda: done('convert')).grid(row=0, column=2, padx=3)
    root.protocol('WM_DELETE_WINDOW', lambda: done('cancel'))
    root.bind('<Return>', lambda e: done('convert'))
    root.mainloop()
    return res['st'], res['action']


def pick_files():
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    files = filedialog.askopenfilenames(title='G-code files to translate',
                                        filetypes=[('G-code', '*.gcode *.gco *.nc *.txt'), ('All files', '*.*')])
    out = filedialog.askdirectory(title='Folder for the .pdl files') if files else ''
    root.destroy()
    return list(files), out


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description='G-code -> Comau PDL2 with Arduino extruder (3-axis)')
    ap.add_argument('inputs', nargs='*', help='.gcode files and/or folders (none = file picker)')
    ap.add_argument('--out', help='output folder (default: next to each G-code file)')
    ap.add_argument('--copy-to', help='also copy every .pdl here (USB stick, share, ...)')
    ap.add_argument('--no-gui', action='store_true', help='no pop-up, use settings.json values')
    a = ap.parse_args()

    cfg = dict(DEFAULTS)
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE) as fh:
            cfg.update(json.load(fh))

    files, outdir = [], a.out
    if not a.inputs and not a.no_gui:
        files, picked = pick_files()
        outdir = outdir or picked
    for p in a.inputs:
        if os.path.isdir(p):
            files += sorted(f for f in glob.glob(os.path.join(p, '*'))
                            if f.lower().endswith(tuple(cfg['extensions'])))
        else:
            files += glob.glob(p) or [p]
    if not files:
        print('No G-code files given.')
        return 1

    st = {k: cfg[k] for k, _, _ in POPUP_FIELDS}
    st['placement'] = cfg['placement']
    ask = not a.no_gui
    names, done = {}, 0
    for i, f in enumerate(files):
        try:
            moves = trim(parse(f))
            if not moves:
                print(f'SKIP  {f}: no extruding moves found')
                continue
            name = prog_name(f, cfg)
            if ask:
                st, action = popup(name, f, moves, st, len(files) - i - 1)
                if action == 'cancel':
                    print('Cancelled.')
                    break
                if action == 'skip':
                    print(f'SKIP  {f}')
                    continue
                if action == 'all':
                    ask = False
            txt, info = build(f, moves, st, cfg, name)
            od = outdir or os.path.dirname(os.path.abspath(f))
            os.makedirs(od, exist_ok=True)
            dst = os.path.join(od, name + '.pdl')
            if name in names:
                print(f'WARN  {os.path.basename(f)} and {names[name]} both give {name}.pdl - overwritten')
            names[name] = os.path.basename(f)
            with open(dst, 'w', newline='\r\n') as fh:
                fh.write(txt)
            if a.copy_to:
                os.makedirs(a.copy_to, exist_ok=True)
                shutil.copy2(dst, a.copy_to)
            done += 1
            print(f"OK    {os.path.basename(f)} -> {dst}  ({info['moves']} moves, {info['ons']} paths, "
                  f"{info['lines']} lines, S{info['S']}, Z {info['zmin'] + info['dz']:.0f}-{info['zmax'] + info['dz']:.0f})")
        except Exception as e:
            print(f'FAIL  {f}: {e}')
    if st and not a.no_gui:                      # remember the last settings for next time
        cfg.update(st)
        try:
            with open(SETTINGS_FILE, 'w') as fh:
                json.dump(cfg, fh, indent=2)
        except OSError:
            pass
    print(f'{done}/{len(files)} converted')
    return 0


if __name__ == '__main__':
    sys.exit(main())
