#!/usr/bin/env python3
"""LAMA Slicer - local server.

Desktop window: lama_app.pyw (LAMA Slicer shortcut). Browser mode: python lama_server.py

The interface lives in web/. Slicing and export run lama_engine.py in a separate process
so the toolpath scripts always start from a clean state.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))          # program files (read only when installed as .exe)
FROZEN = getattr(sys, 'frozen', False)
# installed with LAMA_Slicer_Setup.exe (or packaged as .exe): program files stay untouched, the user's
# projects, settings and imported toolpaths live in %LOCALAPPDATA%\LAMA Slicer, exports in Documents
INSTALLED = FROZEN or os.path.exists(os.path.join(HERE, 'installed.flag'))
DATA = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'LAMA Slicer') if INSTALLED else HERE
WEB = os.path.join(HERE, 'web')
WORK = os.path.join(DATA, '.work')
SETTINGS_FILE = os.path.join(DATA, 'lama_settings.json')
PROJECTS = os.path.join(DATA, 'projects')                  # one .json per project + .meta.json (name, thumbnail)
DEFAULT_OUT = os.path.join(os.path.expanduser('~'), 'Documents', 'LAMA Slicer') if INSTALLED else os.path.join(HERE, 'output')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)      # Windows: no console window for the engine
PORT = int(os.environ.get('LAMA_PORT', '8765'))
BUILTIN_TOOLPATHS = ['N1', 'N2']
# N1 / N2 (ids kept for saved projects) run the same weave scripts in toolpaths/sinusoidal with different settings,
# as given in the scripts' comments. Preset lengths are in the scripts' millimetres (6 mm reference bead).
BUILTIN_INFO = {
    'N1': dict(dir='sinusoidal', title='Simple sinusoidal',
               description='plain sinusoidal weave on every layer.',
               pattern=dict(AUTO_WAVELENGTH=False, WAVELENGTH=27.0, ANCHOR=8.0, OVERLAP=8.0), slice=dict(ARCH_PULL=False)),
    'N2': dict(dir='sinusoidal', title='Improved sinusoidal',
               description='sinusoidal weave; under the arch opening a double wall along the corridors and U-supports.',
               pattern={}, slice={}),
}
PRESET_SCALED = ('WAVELENGTH', 'ANCHOR', 'OVERLAP', 'NECK_REACH')
SINUSOIDAL = os.path.join(HERE, 'toolpaths', 'sinusoidal')
WRITER = os.path.join(SINUSOIDAL, 'weave_gcode.py')      # every toolpath is written with this G-code writer


def _f(key, label, unit='', step=1, min=None, max=None, kind='num', bead=0, layer=0, tip=''):
    """bead / layer: the value follows nozzle / 6 mm and layer height / 3.5 mm to these powers (shown and used scaled)"""
    return dict(key=key, label=label, unit=unit, step=step, min=min, max=max, kind=kind, bead_scaled=bead, layer_scaled=layer, tip=tip)


# GENERAL settings: weave_gcode.py, the writer of every toolpath (sinusoidal, Contour, Orthogonal, imported), by theme.
# machines: who shows the group (UR5 writes the Comau-format G-code, so it uses the Comau values).
# Defaults = the script's values, except LAMA_DEFAULTS. bead: shown for the nozzle in use (x nozzle / 6 mm).
LAMA_DEFAULTS = {'COMAU_END_LIFT': 100.0}
WASP, COMAU = ['wasp'], ['comau', 'ur5']
GENERAL = [
    dict(section='speed', title='Speed', fold=True, machines=WASP, fields=[
        _f('FIRST_LAYER_SPEED', 'First layer speed', 'mm/s', min=1), _f('PERIMETER_SPEED', 'Perimeter speed', 'mm/s', min=1),
        _f('EXTERNAL_PERIMETER_SPEED', 'External perimeter speed', 'mm/s', min=1), _f('INFILL_SPEED', 'Infill speed', 'mm/s', min=1),
        _f('TRAVEL_SPEED', 'Travel speed', 'mm/s', min=1), _f('Z_SPEED', 'Z speed (lower)', 'mm/s', min=1),
        _f('RETRACT_LIFT_SPEED', 'Retraction lift speed', 'mm/s', min=1), _f('SLOW_LIFT_SPEED', 'Slow lift speed', 'mm/s', min=1)]),
    dict(section='speed', title='Speed', fold=True, machines=COMAU, fields=[
        _f('COMAU_PRINT_FEED', 'Print feed', 'mm/min', 100, min=1), _f('COMAU_TRAVEL_FEED', 'Travel feed', 'mm/min', 100, min=1),
        _f('COMAU_Z_FEED', 'Z feed (lower)', 'mm/min', 100, min=1), _f('COMAU_LIFT_FEED', 'Lift feed', 'mm/min', 100, min=1),
        _f('COMAU_SLOW_LIFT_FEED', 'Slow lift feed', 'mm/min', 50, min=1)]),
    dict(section='material', title='Wet density (g/cm³)', machines=WASP, cols=3, fields=[
        _f('FILAMENT_DENSITY', 'Mean (assumed)', '', 0.01, min=0.01), _f('WET_DENSITY_WASP_MIN', 'Min', '', 0.01, min=0.01),
        _f('WET_DENSITY_WASP_MAX', 'Max', '', 0.01, min=0.01)]),
    dict(section='material', title='Mass per E unit (g/E)', machines=COMAU, cols=3, fields=[
        _f('COMAU_G_PER_E', 'Mean (assumed)', '', 0.001, min=0.0001), _f('COMAU_G_PER_E_MIN', 'Min', '', 0.001, min=0.0001),
        _f('COMAU_G_PER_E_MAX', 'Max', '', 0.001, min=0.0001)]),
    dict(section='material', title='Flow', machines=WASP, fields=[_f('EXTRUSION_MULTIPLIER', 'Extrusion multiplier', '', 0.05, min=0.01)]),
    dict(section='material', title='Flow', machines=COMAU, fields=[
        _f('COMAU_E_PER_MM', 'E per mm of path', 'E/mm', 0.01, min=0.0001, bead=1, layer=1, tip='follows bead width x layer height'),
        _f('FLOW_SCALE_BY_HEIGHT', 'Scale flow by layer height', kind='bool'), _f('FLOW_SCALE_THIN_LAYERS', 'Scale flow of thin layers', kind='bool')]),
    dict(section='material', title='Weight', machines=None, fields=[_f('MAX_WEIGHT_KG', 'Maximum part weight', 'kg', 0.1, min=0, tip='warning in the results; 0 = no check')]),
    dict(section='printer', fold=True, title='Extruder', machines=WASP, fields=[
        _f('RETRACT_LENGTH', 'Retract length', 'mm', 0.5, min=0), _f('RETRACT_SPEED', 'Retract speed', 'mm/s', min=0.1),
        _f('DERETRACT_SPEED', 'Deretract speed', 'mm/s', min=0.1), _f('RETRACT_LIFT', 'Retraction lift (Z hop)', 'mm', min=0),
        _f('RETRACT_BEFORE_TRAVEL', 'Retract before travel', 'mm', 0.5, min=0, bead=1), _f('RETRACT_ON_LAYER_CHANGE', 'Retract on layer change', kind='bool')]),
    dict(section='printer', fold=True, title='Extruder', machines=COMAU, fields=[_f('COMAU_LIFT', 'Travel height (lift)', 'mm', min=0.1)]),
    dict(section='printer', fold=True, title='Path ends', machines=None, fields=[
        _f('COAST_DISTANCE', 'Coast distance', 'mm', 0.5, min=0, bead=1, tip='0 = off'), _f('LOOP_OVERLAP', 'Loop overlap', 'mm', 0.5, min=0, bead=1),
        _f('WIPE_DISTANCE', 'Wipe distance', 'mm', 0.5, min=0, bead=1, tip='0 = off'),
        _f('WIPE_SIDE_DRIFT', 'Wipe side drift (perimeters)', 'mm', 0.5, min=0, bead=1, tip='0 = along the bead')]),
    dict(section='printer', fold=True, title='End', machines=COMAU, fields=[
        _f('COMAU_END_LIFT', 'End lift', 'mm', 5, min=0.1), _f('COMAU_END_EXIT', 'Exit beyond part before home', kind='bool'),
        _f('COMAU_END_EXIT_MARGIN', 'Exit margin', 'mm', 5, min=0)]),
    dict(section='output', machines=None, fields=[_f('TIME_CORRECTION', 'Time correction factor', '×', 0.01, min=1)]),
]


def general_settings():
    out = []
    for g in GENERAL:
        g = dict(g, fields=[dict(a, default=LAMA_DEFAULTS.get(a['key'], script_setting(WRITER, a['key']))) for a in g['fields']])
        out.append(g)
    return out


def writer_values(gs):
    """general settings sent by the interface (only the changed ones) -> writer overrides, checked against GENERAL"""
    spec = {a['key']: a for g in GENERAL for a in g['fields']}
    out = {k: v for k, v in LAMA_DEFAULTS.items()}
    for k, v in (gs or {}).items():
        a = spec.get(k)
        if not a or v is None:
            continue
        if a['kind'] == 'bool':
            out[k] = bool(v)
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        if a['min'] is not None:
            v = max(a['min'], v)
        if a['max'] is not None:
            v = min(a['max'], v)
        out[k] = v
    return out
CONFIG_DIR = os.path.join(HERE, 'configurations')


def configurations():
    """configuration modes (configurations/*.json): which toolpaths a project offers, its factory toolpath /
    machine and its colours. 'standard' = the plain slicer; project configurations such as 'earthen' sit next to it"""
    out = []
    if os.path.isdir(CONFIG_DIR):
        for f in sorted(os.listdir(CONFIG_DIR)):
            if f.endswith('.json'):
                try:
                    with open(os.path.join(CONFIG_DIR, f), encoding='utf-8') as fh:
                        c = json.load(fh)
                except (OSError, ValueError):
                    continue
                c.setdefault('id', f[:-5])
                if c.get('code'):
                    c['code_path'] = os.path.join(HERE, *c['code'].split('/'))
                out.append(c)
    if not any(c['id'] == 'standard' for c in out):
        out.append(dict(id='standard', order=0, title='LAMA Slicer', label='Standard', description='', imported=True,
                        toolpaths=[t for t in toolpath_types()], defaults=dict(toolpath='N2', machine='comau'), theme={}))
    return sorted(out, key=lambda c: (c.get('order', 99), c['id']))


CUSTOM_DIR = os.path.join(DATA, 'toolpaths_imported') if INSTALLED else os.path.join(HERE, 'toolpaths', 'imported')
EXAMPLE_DIR = os.path.join(HERE, 'toolpaths', 'examples')        # shipped examples (Contour)


def custom_toolpaths():
    """imported toolpath scripts: name -> file"""
    out = {}
    for d in (EXAMPLE_DIR, CUSTOM_DIR):
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith('.py') and not f.startswith('_'):
                    out[f[:-3]] = os.path.join(d, f)
    return out


def toolpath_types():
    return BUILTIN_TOOLPATHS + list(custom_toolpaths())


def custom_info(path):
    """NAME / DESCRIPTION / DEFAULTS of a custom toolpath script, read without running it"""
    import ast
    with open(path, encoding='utf-8') as fh:
        tree = ast.parse(fh.read())
    info = dict(DESCRIPTION=ast.get_docstring(tree) or '', DEFAULTS={})
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                info[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                pass
    info['has_generate'] = any(isinstance(n, ast.FunctionDef) and n.name == 'generate' for n in tree.body)
    return info

MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'}

SLICES = {}          # slice id -> work folder with toolpaths.json
LOCK = threading.Lock()


# ------------------------------------------------------------------------------ defaults
def script_setting(path, name):
    """read `NAME = value` from a script's SETTINGS block"""
    with open(path, encoding='utf-8') as fh:
        m = re.search(r'^%s\s*=\s*([^#\n]+)' % re.escape(name), fh.read(), re.M)
    if not m:
        return None
    v = m.group(1).strip()
    try:
        return json.loads(v.replace("'", '"').replace('True', 'true').replace('False', 'false').replace('None', 'null'))
    except ValueError:
        return v


def toolpath_defaults(tp):
    custom = custom_toolpaths()
    if tp in custom:                      # custom script: N2 values, overridden by the script's DEFAULTS
        out = toolpath_defaults('N2')
        info = custom_info(custom[tp])
        out.update({k: v for k, v in info.get('DEFAULTS', {}).items() if k in out})
        first = (info.get('DESCRIPTION') or '').strip().splitlines()
        out.update(description=first[0] if first else 'Imported toolpath', custom=True,
                   builtin=os.path.dirname(custom[tp]) == EXAMPLE_DIR, title=str(info.get('NAME', tp)))
        adv = []
        for a in info.get('ADVANCED', []) or []:          # ADVANCED = [{'key': 'ANGLE', 'label': ..}, ..]
            if isinstance(a, dict) and a.get('key') in info:
                adv.append(dict(a, default=info[a['key']]))
        out['advanced'] = adv
        return out
    info = BUILTIN_INFO[tp]
    d = os.path.join(HERE, 'toolpaths', info['dir'])
    sl, gc = os.path.join(d, 'weave_slice.py'), os.path.join(d, 'weave_gcode.py')
    out = {n: script_setting(sl, n) for n in ('FIRST_LAYER_HEIGHT', 'LAYER_HEIGHT', 'FIRST_LAYER_WIDTH',
                                               'EXTERNAL_PERIMETER_WIDTH', 'PERIMETER_WIDTH', 'INFILL_WIDTH')}
    out.update({n: script_setting(gc, n) for n in ('INFILL_SPEED', 'TRAVEL_SPEED', 'COMAU_PRINT_FEED',
                                                    'COMAU_TRAVEL_FEED', 'FILAMENT_DENSITY')})
    out.update(title=info['title'], description=info['description'])
    pat = os.path.join(d, 'weave_pattern.py')
    sval = lambda n: info['pattern'][n] if n in info['pattern'] else script_setting(pat, n)
    S_ = lambda n: script_setting(sl, n)
    A = lambda key, label, unit, default, to, group, step=1, mn=None, mx=None, kind='num', bead=0, tip='': dict(
        key=key, label=label, unit=unit, default=default, to=to, group=group, step=step, min=mn, max=mx, kind=kind, bead_scaled=bead, tip=tip)
    out['advanced'] = [   # settings of the sinusoidal scripts (lengths in the scripts' mm for the 6 mm bead; the wavelength follows from them)
        A('EXTERNAL_PERIMETER_WIDTH', 'External perimeter width', 'mm', S_('EXTERNAL_PERIMETER_WIDTH'), 'both', 'Perimeters', 0.5, 0.5, bead=1),
        A('FIRST_LAYER_WIDTH', 'First layer width', 'mm', S_('FIRST_LAYER_WIDTH'), 'slice', 'Perimeters', 0.5, 0.5, bead=1),
        A('INFILL_PERIMETER_OVERLAP', 'Infill/perimeter overlap', '%', S_('INFILL_PERIMETER_OVERLAP'), 'slice', 'Perimeters', 5, 0, 99),
        A('FILL_MIN_AREA', 'Min. fill island area', 'mm²', S_('FILL_MIN_AREA'), 'slice', 'Perimeters', 10, 0, bead=2),
        A('FILL_OUTSIDE_PATTERN', 'Concentric fill outside pattern', '', S_('FILL_OUTSIDE_PATTERN'), 'slice', 'Perimeters', kind='bool'),
        A('ANCHOR', 'Anchor', 'mm', sval('ANCHOR'), 'pattern', 'Infill', 0.5, 4, 8, bead=1, tip='shared peak contact length: 4 to 8 mm for the 6 mm bead'),
        A('OVERLAP', 'Wall contact length', 'mm', sval('OVERLAP'), 'pattern', 'Infill', 0.5, 0.5, bead=1),
        A('INFILL_INFILL_OVERLAP', 'Infill/infill overlap', '%', S_('INFILL_INFILL_OVERLAP'), 'slice', 'Infill', 5, 0, 99),
        A('CONTACT_LIKE_FIRST_LAYER', 'Contacts like first layer', '', S_('CONTACT_LIKE_FIRST_LAYER'), 'slice', 'Infill', kind='bool'),
    ]
    return out


def pdl_defaults():
    """the .bat converter's DEFAULTS, updated with its settings.json"""
    conv = os.path.join(HERE, 'converters')
    with open(os.path.join(conv, 'gcode2pdl_arduino.py'), encoding='utf-8') as fh:
        src = fh.read()
    block = src[src.index('DEFAULTS = {'):]
    block = block[:block.index('\n}\n') + 2]
    ns = {}
    exec(block, ns)
    cfg = dict(ns['DEFAULTS'])
    sfile = os.path.join(conv, 'settings.json')
    if os.path.exists(sfile):
        with open(sfile, encoding='utf-8') as fh:
            cfg.update(json.load(fh))
    return cfg


def load_saved():
    try:
        with open(SETTINGS_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------------------ engine
def run_engine(job, timeout=1800):
    os.makedirs(job['work_dir'], exist_ok=True)
    jf = os.path.join(job['work_dir'], 'job_%s.json' % job['kind'])
    job['result_file'] = os.path.join(job['work_dir'], 'result_%s.json' % job['kind'])
    with open(jf, 'w', encoding='utf-8') as fh:
        json.dump(job, fh)
    env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    t0 = time.time()
    cmd = [sys.executable, '--engine', jf] if FROZEN else [sys.executable, os.path.join(HERE, 'lama_engine.py'), jf]
    p = subprocess.run(cmd, cwd=job['work_dir'], capture_output=True, text=True, timeout=timeout, env=env,
                       stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
    try:
        with open(job['result_file'], encoding='utf-8') as fh:
            res = json.load(fh)
    except (OSError, ValueError):
        res = dict(ok=False, error='The engine stopped without a result.', log=(p.stderr or '').splitlines()[-30:])
    res['seconds'] = round(time.time() - t0, 1)
    return res


def nozzle_widths(tp, nozzle):
    """all bead widths scale with the nozzle / bead width (default = the script's INFILL_WIDTH)"""
    d = toolpath_defaults(tp)
    k = float(nozzle) / float(d['INFILL_WIDTH'])
    return {n: round(float(d[n]) * k, 3) for n in ('FIRST_LAYER_WIDTH', 'EXTERNAL_PERIMETER_WIDTH',
                                                    'PERIMETER_WIDTH', 'INFILL_WIDTH')}


def adv_values(tp, adv):
    """the Advanced settings sent by the interface, limited to the keys this toolpath offers"""
    spec = {a['key']: a for a in toolpath_defaults(tp).get('advanced', [])}
    out = {}
    for k, v in (adv or {}).items():
        if k in spec and v is not None and spec[k].get('kind') == 'bool':
            out[k] = bool(v)
        elif k in spec and v is not None:
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            out[k] = int(round(v)) if spec[k].get('int') else v
    return out


def api_slice(body, preview=False):
    tp = body['toolpath']
    if tp not in toolpath_types():
        return dict(ok=False, error='Unknown toolpath type %s' % tp)
    if not body.get('objects'):
        return dict(ok=False, error='Add an object to the plate first.')
    sid = uuid.uuid4().hex[:10]
    work = os.path.join(WORK, sid)
    os.makedirs(work, exist_ok=True)
    meshes = []
    for i, o in enumerate(body['objects']):
        path = os.path.join(work, 'obj%d.stl' % i)
        with open(path, 'wb') as fh:
            fh.write(base64.b64decode(o['stl']))
        meshes.append(dict(name=o.get('name', 'object'), path=path))
    p = body['params']
    adv = adv_values(tp, body.get('adv'))
    kind = 'preview' if preview else 'slice'
    custom = custom_toolpaths()
    params = dict(nozzle=float(p['nozzle']), layer_height=float(p['layer_height']),
                  first_layer_height=float(p['first_layer_height']))
    if tp in custom:                      # imported script: generate(mesh, settings) -> layers
        res = run_engine(dict(kind=kind, toolpath=tp, custom_file=custom[tp], work_dir=work, meshes=meshes,
                              params=params, adv=adv), timeout=300 if preview else 1800)
        if preview:
            shutil.rmtree(work, ignore_errors=True)
            return res
        if res.get('ok'):
            with LOCK:
                SLICES[sid] = dict(work=work, toolpath=tp, file=res.pop('toolpaths_file'), writer='N2')
            res['slice_id'] = sid
        return res
    widths = nozzle_widths(tp, p['nozzle'])
    spec = {a['key']: a for a in toolpath_defaults(tp)['advanced']}
    for k in ('EXTERNAL_PERIMETER_WIDTH', 'FIRST_LAYER_WIDTH'):      # widths set in the infill settings (real mm)
        if k in adv:
            widths[k] = adv.pop(k)
    pat_adv = {k: v for k, v in adv.items() if spec[k].get('to') in ('pattern', 'both')}
    sl_adv = {k: v for k, v in adv.items() if spec[k].get('to') in ('slice', 'both')}
    common = dict(MODEL_UNITS_TO_MM=1.0, FIRST_LAYER_HEIGHT=float(p['first_layer_height']),
                  AUTO_FLIP=False)     # the part is printed as it stands on the plate (the view shows it so)
    info = BUILTIN_INFO[tp]                  # preset lengths -> mm for this nozzle (the engine scales them back)
    k = widths['INFILL_WIDTH'] / float(toolpath_defaults(tp)['INFILL_WIDTH'])
    preset = {n: (v * k if n in PRESET_SCALED else v) for n, v in info['pattern'].items()}
    pattern_over = dict(common, EXTERNAL_PERIMETER_WIDTH=widths['EXTERNAL_PERIMETER_WIDTH'],
                        PERIMETER_WIDTH=widths['PERIMETER_WIDTH'], INFILL_WIDTH=widths['INFILL_WIDTH'], **dict(preset, **pat_adv))
    slice_over = dict(common, **dict(info['slice'], **sl_adv), **widths, LAYER_HEIGHT=float(p['layer_height']))
    res = run_engine(dict(kind=kind, toolpath=tp, work_dir=work, meshes=meshes, params=params,
                          pattern_over=pattern_over, slice_over=slice_over), timeout=300 if preview else 1800)
    if preview:
        shutil.rmtree(work, ignore_errors=True)
        return res
    if res.get('ok'):
        with LOCK:
            SLICES[sid] = dict(work=work, toolpath=tp, file=res.pop('toolpaths_file'), writer=tp)
        res['slice_id'] = sid
        res['widths'] = widths
    return res


def safe_name(s):
    s = re.sub(r'[^A-Za-z0-9_\-]', '', (s or '').replace(' ', '_'))
    return s or 'part'


MACHINE_NAMES = dict(wasp='WASP 40100', ur5='UR5', comau='Comau NJ60-2.2')
ROBOT_SUFFIX = dict(wasp='Wasp', ur5='UR5', comau='Comau')


def fmt_hms(t):
    t = int(round(t))
    h, r = divmod(t, 3600)
    m, sec = divmod(r, 60)
    return ('%d h ' % h if h else '') + '%d min %d s' % (m, sec)


def results_rows(r, toolpath):
    """the Results table -> [(section, label, value)]; section '' = general, 'pattern' = sinusoidal toolpaths only"""
    t0, t1 = r['time_s']
    du = 'g/cm³' if r['density_unit'] == 'g/cm3' else 'g per E'
    lim, (w0, w1) = r['max_weight_kg'], r['weight_kg']
    if not lim:
        wl = 'no check'
    elif r['weight_mean_kg'] > lim:
        wl = 'OVER %.1f kg (assumed mean %.2f kg)' % (lim, r['weight_mean_kg']) + (
            '; try bead width %.1f mm' % r['next_bead_mm'] if r.get('next_bead_mm') else '')
    elif w1 > lim:
        wl = '%.1f kg: OK at the assumed mean, the upper end is above it' % lim
    else:
        wl = '%.1f kg: OK' % lim
    rows = [('', 'Extrusion path length', '%.2f m' % r['extrusion_m']),
            ('', 'Travel path length', '%.2f m  (+ %.2f m lift / lower)' % (r['travel_m'], r['lift_m'])),
            ('', 'Estimated printing time', '%s – %s  (× %.2f)' % (fmt_hms(t0), fmt_hms(t1), r['time_correction'])),
            ('', 'Estimated wet weight', '%.2f – %.2f kg' % (w0, w1) if w1 >= 1 else '%.0f – %.0f g' % (w0 * 1000, w1 * 1000)),
            ('', 'Wet density used' if du == 'g/cm³' else 'Mass per E used', '%g – %g %s' % (r['density'][0], r['density'][1], du)),
            ('', 'Maximum part weight', wl)]
    sr = r.get('slicer')
    if sr and toolpath in BUILTIN_TOOLPATHS:
        if toolpath == 'N2':
            rows.append(('pattern', 'Double-wall region length', '%.2f m printed, %.0f mm in plan' % (
                sr.get('double_wall_printed_mm', 0) / 1000.0, sr.get('double_wall_plan_mm', 0))))
        rows += [('pattern', 'Net bottom surface area', '%.1f cm²' % (sr.get('net_bottom_area_mm2', 0) / 100.0)),
                 ('pattern', 'Net top surface area', '%.1f cm²' % (sr.get('net_top_area_mm2', 0) / 100.0)),
                 ('pattern', 'Infill in cylinders', '%.1f %%' % sr.get('infill_in_cylinders_pct', 0)),
                 ('pattern', 'Infill in walls', '%.1f %%' % sr.get('infill_in_walls_pct', 0))]
    return rows


def results_text(r, meta):
    title = toolpath_defaults(meta['toolpath']).get('title', meta['toolpath']) if meta.get('toolpath') else ''
    lines = ['LAMA Slicer - results', '',
             'Object:    %s' % meta.get('name', ''), 'Machine:   %s' % MACHINE_NAMES.get(r['machine'], r['machine']),
             'Toolpath:  %s' % title, 'Layers:    %d (%.1f mm)' % (r['layers'], r['height_mm']),
             'Date:      %s' % time.strftime('%Y-%m-%d %H:%M'), '']
    rows = results_rows(r, meta.get('toolpath'))
    wd = max(len(l) for _, l, _ in rows) + 3
    for sec in ('', 'pattern'):
        part = [x for x in rows if x[0] == sec]
        if part:
            lines.append('General' if not sec else '%s' % title)
            lines += ['  ' + l.ljust(wd) + v for _, l, v in part]
            lines.append('')
    ch = meta.get('changed') or []
    if ch:
        lines.append('Settings (bead, layers and the values changed from the defaults)')
        lines += ['  %s = %s' % (k, v) for k, v in ch]
    return '\n'.join(lines).rstrip() + '\n'


def api_results(body):
    with LOCK:
        sl = SLICES.get(body.get('slice_id'))
    if not sl:
        return dict(ok=False, error='Slice the plate first.')
    machine = body.get('machine', 'comau')
    res = run_engine(dict(kind='results', machine=machine, toolpath=sl['writer'], toolpaths_file=sl['file'],
                          work_dir=sl['work'], writer_over=writer_values(body.get('gs'))), timeout=600)
    if res.get('ok'):
        res['rows'] = results_rows(res['results'], sl['toolpath'])
    return res


def api_export(body):
    machine = body['machine']
    name = safe_name(body.get('name'))
    out_dir = os.path.join(body.get('out_dir') or DEFAULT_OUT, name)      # one folder per export, named after the object
    if body.get('gcode_text') is not None:           # imported G-code
        work = os.path.join(WORK, 'import_' + uuid.uuid4().hex[:8])
        os.makedirs(work, exist_ok=True)
        gfile = os.path.join(work, name + '.gcode')
        with open(gfile, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(body['gcode_text'])
        job = dict(kind='export', machine=machine, work_dir=work, out_dir=out_dir, name=name,
                   gcode_file=gfile, pdl=body.get('pdl', {}))
    else:
        with LOCK:
            sl = SLICES.get(body.get('slice_id'))
        if not sl:
            return dict(ok=False, error='Slice the plate first.')
        job = dict(kind='export', machine=machine, toolpath=sl['writer'], toolpaths_file=sl['file'],
                   work_dir=sl['work'], out_dir=out_dir, name=name, writer_over=writer_values(body.get('gs')),
                   pdl=body.get('pdl', {}))
    res = run_engine(job)
    if res.get('ok'):
        stem = name + ROBOT_SUFFIX.get(machine, '')
        if body.get('results_txt') and res.get('results'):
            f = os.path.join(out_dir, stem + '_results.txt')
            with open(f, 'w', encoding='utf-8', newline='\r\n') as fh:
                fh.write(results_text(res['results'], dict(name=name, toolpath=sl['toolpath'], changed=body.get('changed'))))
            res['files'].append(f)
        png = body.get('preview_png')
        if png:
            f = os.path.join(out_dir, '%s_preview_L%d.png' % (stem, int(body.get('preview_layer') or 1)))
            with open(f, 'wb') as fh:
                fh.write(base64.b64decode(png.split(',', 1)[-1]))
            res['files'].append(f)
        if res.get('results'):
            res['rows'] = results_rows(res['results'], sl['toolpath'])
        res['out_dir'] = out_dir
        res['files'] = [dict(path=f, name=os.path.basename(f), size=os.path.getsize(f)) for f in res['files']]
    return res


def toolpath_import(body):
    """save an imported toolpath script (.py with generate(mesh, settings)) next to the built-in toolpaths"""
    import ast
    code = body.get('code', '')
    name = re.sub(r'[^A-Za-z0-9_\-]', '', os.path.splitext(os.path.basename(body.get('filename', '')))[0].replace(' ', '_'))[:40]
    if not name:
        return dict(ok=False, error='The file needs a name.')
    if name in BUILTIN_TOOLPATHS:
        name += '_custom'
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return dict(ok=False, error='Python error in %s, line %s: %s' % (body.get('filename'), e.lineno, e.msg))
    if not any(isinstance(n, ast.FunctionDef) and n.name == 'generate' for n in tree.body):
        return dict(ok=False, error='No function generate(mesh, settings) found. Start from toolpaths/examples/Contour.py.')
    os.makedirs(CUSTOM_DIR, exist_ok=True)
    with open(os.path.join(CUSTOM_DIR, name + '.py'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(code)
    return dict(ok=True, name=name, toolpaths={t: toolpath_defaults(t) for t in toolpath_types()})


def toolpath_delete(name):
    path = os.path.join(CUSTOM_DIR, re.sub(r'[^A-Za-z0-9_\-]', '', name) + '.py')
    if not os.path.exists(path):
        return dict(ok=False, error='Only imported toolpaths can be removed.')
    os.remove(path)
    return dict(ok=True, toolpaths={t: toolpath_defaults(t) for t in toolpath_types()})


def project_path(pid, meta=False):
    pid = re.sub(r'[^A-Za-z0-9_\-]', '', pid or '')
    if not pid:
        raise ValueError('no project id')
    return os.path.join(PROJECTS, pid + ('.meta.json' if meta else '.json'))


def projects_list():
    out = []
    if os.path.isdir(PROJECTS):
        for f in os.listdir(PROJECTS):
            if f.endswith('.meta.json'):
                try:
                    with open(os.path.join(PROJECTS, f), encoding='utf-8') as fh:
                        out.append(json.load(fh))
                except (OSError, ValueError):
                    pass
    return dict(ok=True, projects=sorted(out, key=lambda m: m.get('modified', 0), reverse=True))


def project_save(body):
    os.makedirs(PROJECTS, exist_ok=True)
    pid = body['id']
    meta = dict(body.get('meta', {}), id=pid, modified=time.time())
    if body.get('data') is not None:
        tmp = project_path(pid) + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(body['data'], fh, separators=(',', ':'))
        os.replace(tmp, project_path(pid))                 # never leave a half-written project
    old = {}
    if os.path.exists(project_path(pid, True)):
        with open(project_path(pid, True), encoding='utf-8') as fh:
            old = json.load(fh)
    old.update({k: v for k, v in meta.items() if v is not None})
    with open(project_path(pid, True), 'w', encoding='utf-8') as fh:
        json.dump(old, fh)
    return dict(ok=True, meta=old)


def project_load(pid):
    with open(project_path(pid), encoding='utf-8') as fh:
        data = json.load(fh)
    with open(project_path(pid, True), encoding='utf-8') as fh:
        meta = json.load(fh)
    return dict(ok=True, data=data, meta=meta)


def project_delete(pid):
    for m in (False, True):
        if os.path.exists(project_path(pid, m)):
            os.remove(project_path(pid, m))
    return dict(ok=True)


def reveal(path):
    """show a file selected in the file manager"""
    if not os.path.exists(path):
        return dict(ok=False, error='Not found: ' + path)
    if sys.platform.startswith('win'):
        subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', '-R', path])
    else:
        subprocess.Popen(['xdg-open', os.path.dirname(path)])
    return dict(ok=True)


def open_folder(path):
    if not os.path.isdir(path):
        return dict(ok=False, error='Folder not found: ' + path)
    if sys.platform.startswith('win'):
        os.startfile(path)                                   # noqa
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])
    return dict(ok=True)


# ------------------------------------------------------------------------------ http
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, code, data, ctype='application/json', extra=None):
        if not isinstance(data, (bytes, bytearray)):
            data = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/api/config':
            return self.send(200, dict(toolpaths={t: toolpath_defaults(t) for t in toolpath_types()},
                                       general=general_settings(), pdl=pdl_defaults(), saved=load_saved(), out_dir=DEFAULT_OUT,
                                       configs=configurations()))
        if u.path == '/api/projects':
            return self.send(200, projects_list())
        if u.path == '/api/project':
            try:
                return self.send(200, project_load(parse_qs(u.query).get('id', [''])[0]))
            except (OSError, ValueError) as e:
                return self.send(200, dict(ok=False, error='Project not found (%s)' % e))
        if u.path == '/api/file':
            path = os.path.abspath(parse_qs(u.query).get('path', [''])[0])
            if not path.lower().endswith(('.gcode', '.pdl')) or not os.path.isfile(path):
                return self.send(404, dict(error='not found'))
            with open(path, 'rb') as fh:
                return self.send(200, fh.read(), 'application/octet-stream',
                                 {'Content-Disposition': 'attachment; filename="%s"' % os.path.basename(path)})
        rel = 'index.html' if u.path in ('/', '') else u.path.lstrip('/')
        path = os.path.abspath(os.path.join(WEB, rel))
        if not path.startswith(WEB) or not os.path.isfile(path):
            return self.send(404, b'not found', 'text/plain')
        with open(path, 'rb') as fh:
            self.send(200, fh.read(), MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
            route = urlparse(self.path).path
            if route == '/api/slice':
                res = api_slice(body)
            elif route == '/api/preview':
                res = api_slice(body, preview=True)
            elif route == '/api/results':
                res = api_results(body)
            elif route == '/api/export':
                res = api_export(body)
            elif route == '/api/toolpath_import':
                res = toolpath_import(body)
            elif route == '/api/toolpath_delete':
                res = toolpath_delete(body.get('name', ''))
            elif route == '/api/settings':
                with open(SETTINGS_FILE, 'w', encoding='utf-8') as fh:
                    json.dump(body, fh, indent=2)
                res = dict(ok=True)
            elif route == '/api/open_folder':
                res = open_folder(body.get('path') or DEFAULT_OUT)
            elif route == '/api/open_code':
                c = next((c for c in configurations() if c['id'] == body.get('config')), None)
                res = open_folder(c['code_path']) if c and c.get('code_path') else dict(ok=False, error='This configuration has no code folder.')
            elif route == '/api/project_save':
                res = project_save(body)
            elif route == '/api/project_delete':
                res = project_delete(body.get('id', ''))
            elif route == '/api/reveal':
                res = reveal(body.get('path', ''))
            else:
                return self.send(404, dict(error='unknown route'))
            self.send(200, res)
        except Exception as e:                                  # report, keep the server alive
            self.send(200, dict(ok=False, error='%s: %s' % (type(e).__name__, e)))


def start(port=0):
    """start the server in a background thread -> (server, url); port 0 = any free port"""
    shutil.rmtree(WORK, ignore_errors=True)          # slices of the last session
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(DEFAULT_OUT, exist_ok=True)
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


def main():
    shutil.rmtree(WORK, ignore_errors=True)          # slices of the last session
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(DEFAULT_OUT, exist_ok=True)
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = 'http://localhost:%d' % PORT
    print('LAMA Slicer running at %s  (close this window to stop)' % url)
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
