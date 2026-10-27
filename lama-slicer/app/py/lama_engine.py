#!/usr/bin/env python3
"""LAMA Slicer engine - runs the toolpath scripts (Simple / Improved sinusoidal) and the G-code -> PDL converter.

Called by lama_server.py in a separate process:   python lama_engine.py job.json
The job file says what to do; the result is written to job['result_file'] as JSON.

The toolpath scripts in toolpaths/<N>/ are the Grasshopper scripts, unchanged. They are loaded
as modules, the settings are put into their globals (the same way Grasshopper inputs override
the SETTINGS block) and their own main() is called.
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLPATHS = os.path.join(HERE, 'toolpaths')
CONVERTERS = os.path.join(HERE, 'converters')
PDL_EDITABLE = {'print_speed_mm_s', 'travel_speed_mm_s', 'flow_rate_S', 'extrusion_factor', 'first_layer_z', 'placement', 'tool', 'uframe', 'home', 'orient', 'config', 'approach_speed'}


# N1 = Simple sinusoidal, N2 = Improved sinusoidal: the same scripts, different settings (lama_server.BUILTIN_INFO)
SCRIPT_DIRS = {'N1': 'sinusoidal', 'N2': 'sinusoidal'}


def tp_path(tp):
    return os.path.join(TOOLPATHS, SCRIPT_DIRS.get(tp, tp))


def load_script(path, overrides=None):
    """Execute a script file as a module (main() does not run) and apply setting overrides."""
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    ns = {'__name__': 'lama_' + os.path.splitext(os.path.basename(path))[0], '__file__': path}
    exec(compile(src, path, 'exec'), ns)
    for k, v in (overrides or {}).items():
        ns[k] = v
    return ns


# ------------------------------------------------------------------------------------- slicing
# The sinusoidal scripts (N1 / N2) are tuned for their own bead (INFILL_WIDTH in weave_slice.py, 6 mm): wavelengths, contacts, curvature
# windows, minimum lengths ... are millimetres inside the scripts. A smaller (or larger) bead is the same problem at
# another scale (1 mm bead on a 15 % part = 6 mm bead on a 90 % part), so the part, the widths, the layer heights and
# the wave settings are scaled by f = reference bead / bead, the scripts run unchanged, and the toolpaths are scaled back.
SCALED_SETTINGS = ('FIRST_LAYER_HEIGHT', 'LAYER_HEIGHT', 'FIRST_LAYER_WIDTH', 'EXTERNAL_PERIMETER_WIDTH',
                   'PERIMETER_WIDTH', 'INFILL_WIDTH', 'WAVELENGTH', 'ANCHOR', 'OVERLAP', 'NECK_REACH')
AREA_SETTINGS = ('FILL_MIN_AREA',)          # mm2: scale with f * f
WRITER_BEAD_LENGTHS = ('COAST_DISTANCE', 'WIPE_DISTANCE', 'LOOP_OVERLAP', 'WIPE_SIDE_DRIFT',
                       'RETRACT_BEFORE_TRAVEL')                    # scale with the bead
WRITER_SECTION = ('COMAU_E_PER_MM',)          # scale with the bead cross-section (bead width x layer height)
REF_LAYER = 3.5                               # layer height the writer's values are made for (weave_slice.py)


def reference_bead(tp_dir):
    """INFILL_WIDTH written in the toolpath's weave_slice.py (the bead it was designed for)"""
    try:
        with open(os.path.join(tp_dir, 'weave_slice.py'), encoding='utf-8') as fh:
            m = re.search(r'^INFILL_WIDTH\s*=\s*([0-9.]+)', fh.read(), re.M)
        return float(m.group(1)) if m else 6.0
    except OSError:
        return 6.0


def _unscale_toolpaths(tp, f):
    """toolpaths computed at scale f -> real size"""
    tp['part_center'] = [v / f for v in tp.get('part_center', [0.0, 0.0])]
    tp['part_height'] = tp.get('part_height', 0.0) / f
    for L in tp['layers']:
        L['z'] /= f
        L['height'] /= f
        if isinstance(L.get('double_wall_mm'), (int, float)):
            L['double_wall_mm'] /= f
        for p in L['paths']:
            p['width'] = p.get('width', 0.0) / f
            p['pts'] = [[q[0] / f, q[1] / f] + list(q[2:]) for q in p['pts']]
    st = tp.get('settings', {})
    for k in SCALED_SETTINGS:
        if isinstance(st.get(k), (int, float)):
            st[k] = st[k] / f
    for k in AREA_SETTINGS:
        if isinstance(st.get(k), (int, float)):
            st[k] = st[k] / f / f
    for k, v in list(tp.get('results', {}).items()):
        if isinstance(v, (int, float)) and k.endswith('_mm2'):
            tp['results'][k] = v / f / f
        elif isinstance(v, (int, float)) and k.endswith('_mm'):
            tp['results'][k] = v / f
    tp.setdefault('notes', []).append('Computed at %.3g x size (as the bead the sinusoidal scripts are made for), then scaled back to real size.' % f)
    return tp


def slice_one(tp_dir, mesh_path, work, pattern_over, slice_over, tag):
    """pattern + slice for one object -> toolpaths dict"""
    bead = float(slice_over.get('INFILL_WIDTH') or pattern_over.get('INFILL_WIDTH') or 0) or None
    f = reference_bead(tp_dir) / bead if bead else 1.0
    if abs(f - 1.0) > 1e-6:
        import trimesh
        m = trimesh.load(mesh_path, force='mesh')
        m.apply_scale(f)
        mesh_path = os.path.join(work, tag + '_scaled.stl')
        m.export(mesh_path)
        sc = lambda d: {k: (v * f if k in SCALED_SETTINGS else v * f * f if k in AREA_SETTINGS else v)
                        if isinstance(v, (int, float)) and not isinstance(v, bool) else v for k, v in d.items()}
        pattern_over, slice_over = sc(pattern_over), sc(slice_over)
        print('bead %.3g mm: computed at %.3g x size (as a %.3g mm bead), scaled back to real size; sizes in the '
              'messages of the script below are at that size' % (bead, f, bead * f))
    tp = _slice_one(tp_dir, mesh_path, work, pattern_over, slice_over, tag)
    return _unscale_toolpaths(tp, f) if abs(f - 1.0) > 1e-6 else tp


def _slice_one(tp_dir, mesh_path, work, pattern_over, slice_over, tag):
    pat_file = os.path.join(work, tag + '_pattern.json')
    tp_file = os.path.join(work, tag + '_toolpaths.json')
    p = load_script(os.path.join(tp_dir, 'weave_pattern.py'), dict(pattern_over, OUTPUT_FILE=pat_file))
    p['main']([mesh_path])
    s = load_script(os.path.join(tp_dir, 'weave_slice.py'), slice_over)
    s['main']([mesh_path, pat_file, tp_file])
    with open(tp_file, encoding='utf-8') as fh:
        return json.load(fh)


def merge_toolpaths(parts):
    """several objects on one plate -> one toolpaths dict, layers merged by height (z)."""
    for i, tp in enumerate(parts):                 # remember the object of every path (preview can hide objects)
        for L in tp['layers']:
            for p in L['paths']:
                p['obj'] = i
    if len(parts) == 1:
        return parts[0]
    by_z = {}
    for tp in parts:
        for L in tp['layers']:
            key = round(L['z'], 3)
            if key not in by_z:
                by_z[key] = dict(z=L['z'], height=L['height'], paths=[])
            by_z[key]['paths'].extend(L['paths'])
    layers = [by_z[k] for k in sorted(by_z)]
    for i, L in enumerate(layers):
        L['index'] = i
    out = dict(parts[0])
    out['layers'] = layers
    out['part_center'] = [0.0, 0.0]
    out['part_height'] = max(tp['part_height'] for tp in parts)
    out['notes'] = [n for tp in parts for n in tp.get('notes', [])]
    rs = [tp.get('results') for tp in parts]
    if all(rs):                                    # slicer results of the whole plate: sums, shares by infill length
        r = {k: round(sum(x.get(k, 0.0) for x in rs), 1) for k in rs[0] if k.endswith(('_mm', '_mm2'))}
        tot = r.get('infill_length_mm', 0.0)
        r['infill_in_cylinders_pct'] = round(100.0 * r.get('infill_in_cylinders_mm', 0.0) / tot, 1) if tot > 0 else 0.0
        r['infill_in_walls_pct'] = round(100.0 - r['infill_in_cylinders_pct'], 1) if tot > 0 else 0.0
        out['results'] = r
    else:
        out.pop('results', None)
    return out


def slice_custom(job, mesh_path):
    """imported toolpath script: generate(mesh, settings) -> layers (see toolpaths/examples/Contour.py)"""
    import trimesh
    ns = load_script(job['custom_file'], job.get('adv'))     # Advanced settings = the script's constants
    if 'generate' not in ns:
        raise ValueError('The toolpath script has no function generate(mesh, settings).')
    mesh = trimesh.load(mesh_path, force='mesh')
    st = dict(job['params'])
    layers = ns['generate'](mesh, dict(st))
    out = []
    for L in layers or []:
        paths = []
        for p in L.get('paths', []):
            pts = [[round(float(q[0]), 3), round(float(q[1]), 3)] for q in p.get('pts', [])]
            if len(pts) < 2:
                continue
            kind = p.get('type', 'external')
            paths.append(dict(type=kind if kind in ('external', 'perimeter', 'infill', 'fill') else 'external',
                              part=str(p.get('part', '')), closed=bool(p.get('closed', False)),
                              width=float(p.get('width', st['nozzle'])), pts=pts))
        if paths:
            out.append(dict(index=len(out), z=float(L['z']), height=float(L.get('height', st['layer_height'])), paths=paths))
    if not out:
        raise ValueError('The toolpath script returned no paths for this object.')
    b = mesh.bounds
    w = st['nozzle']
    return dict(version=1, units='mm', part_center=[(b[0][0] + b[1][0]) / 2.0, (b[0][1] + b[1][1]) / 2.0],
                part_height=float(b[1][2] - b[0][2]), notes=['%d layers from %s' % (len(out), os.path.basename(job['custom_file']))],
                settings=dict(INFILL_WIDTH=w, EXTERNAL_PERIMETER_WIDTH=w, PERIMETER_WIDTH=w, FIRST_LAYER_WIDTH=w,
                              LAYER_HEIGHT=st['layer_height'], FIRST_LAYER_HEIGHT=st['first_layer_height']),
                layers=out)


def job_slice(job):
    if job.get('custom_file'):
        parts = []
        for i, mesh in enumerate(job['meshes']):
            print('--- object %d/%d: %s (%s)' % (i + 1, len(job['meshes']), mesh['name'], job['toolpath']))
            parts.append(slice_custom(job, mesh['path']))
        tp = merge_toolpaths(parts)
        tp['plate_coordinates'] = True
        out = os.path.join(job['work_dir'], 'toolpaths.json')
        with open(out, 'w', encoding='utf-8') as fh:
            json.dump(tp, fh, separators=(',', ':'))
        return dict(toolpaths_file=out, toolpaths=tp)
    tp_dir = tp_path(job['toolpath'])
    work = job['work_dir']
    parts = []
    for i, mesh in enumerate(job['meshes']):
        print('--- object %d/%d: %s' % (i + 1, len(job['meshes']), mesh['name']))
        tp = slice_one(tp_dir, mesh['path'], work, job['pattern_over'], job['slice_over'], 'obj%d' % i)
        # the writer moves part_center onto the bed centre; the mesh is already in plate
        # coordinates, so the centre is put at the origin and the toolpaths stay where they are
        parts.append(tp)
    tp = merge_toolpaths(parts)
    tp['plate_coordinates'] = True
    tp['part_centers'] = [p['part_center'] for p in parts]
    out = os.path.join(work, 'toolpaths.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(tp, fh, separators=(',', ':'))
    return dict(toolpaths_file=out, toolpaths=tp)


# ------------------------------------------------------------------------------------ G-code
ROBOT_NAME = {'wasp': 'Wasp', 'comau': 'Comau', 'ur5': 'UR5'}


def out_name(job, machine):
    """naming convention: [file name][robot].gcode  (A00 -> A00Comau.gcode, A00Comau.pdl)"""
    return job['name'] + ROBOT_NAME[machine]


def run_writer(job, machine):
    """the toolpath's own G-code writer, run in memory -> (writer namespace, settings, toolpaths, G-code text, weight stats)"""
    tp_dir = tp_path(job['toolpath'])
    with open(job['toolpaths_file'], encoding='utf-8') as fh:
        tp = json.load(fh)
    # keep plate coordinates: shift = BED_CENTER + PART_OFFSET - part_center = 0
    cx, cy = tp['part_center']
    over = dict(job['writer_over'], BED_CENTER_X=0.0, BED_CENTER_Y=0.0, PART_OFFSET_X=cx, PART_OFFSET_Y=cy,
                OUTPUT_FILE=job['work_dir'], FILE_NAME='lama_out')
    w = load_script(os.path.join(tp_dir, 'weave_gcode.py'), over)
    st_ = tp.get('settings', {})
    k = float(st_.get('INFILL_WIDTH') or 6.0) / reference_bead(tp_dir)
    kh = float(st_.get('LAYER_HEIGHT') or REF_LAYER) / REF_LAYER
    for n in WRITER_BEAD_LENGTHS:                 # coast / wipe / loop overlap belong to the bead, lifts do not
        if isinstance(w.get(n), (int, float)) and n not in job['writer_over']:
            w[n] = w[n] * k
    for n in WRITER_SECTION:                      # Comau E per mm: clay per mm of path ~ bead width x layer height
        if isinstance(w.get(n), (int, float)) and n not in job['writer_over']:
            w[n] = w[n] * k * kh
    S = w['get_settings']([job['toolpaths_file'], job['work_dir'], 'lama_out'])
    tp = w['load_toolpaths'](S)
    if machine == 'wasp':
        text, _, st = w['run'](S, tp)
    else:                                         # Comau and UR5 (robot-neutral, Comau-format G-code for now)
        text, _, st = w['run_comau'](S, tp)
    return w, S, tp, text, st


def results_of(w, S, tp, machine, text, st):
    """the Results table (one machine): path lengths, time range, wet weight range, slicer results.
    The same calculations as the writer's own results_report()."""
    ext, txy, tz = w['gcode_lengths'](text)
    raw = w['estimate_seconds'](text.splitlines())
    comau = machine != 'wasp'
    if comau:
        lo, hi, mean = S['COMAU_G_PER_E_MIN'], S['COMAU_G_PER_E_MAX'], S['COMAU_G_PER_E']
    else:
        lo, hi, mean = S['WET_DENSITY_WASP_MIN'], S['WET_DENSITY_WASP_MAX'], S['FILAMENT_DENSITY']
    kg = float(st['kg'])
    k_lo, k_hi = (kg * lo / mean, kg * hi / mean) if mean > 0 else (kg, kg)
    nxt = None
    try:
        bead = float(tp['settings']['INFILL_WIDTH'])
        if S['MAX_WEIGHT_KG'] and kg > S['MAX_WEIGHT_KG'] and 4.5 <= bead <= 9.0:   # the writer's estimate covers 4.5 - 9 mm beads
            m = re.search(r'Next INFILL_WIDTH to try: ([\d.]+) mm', '\n'.join(
                w['weight_report'](S, tp, 'COMAU' if comau else 'WASP', st, w['base_height'](tp['layers']))))
            nxt = float(m.group(1)) if m else None
    except Exception:
        pass
    return dict(machine=machine, layers=len(tp['layers']), height_mm=float(tp['layers'][-1]['z']) if tp['layers'] else 0.0,
                extrusion_m=ext / 1000.0, travel_m=txy / 1000.0, lift_m=tz / 1000.0,
                time_s=[raw, raw * S['TIME_CORRECTION']], time_correction=S['TIME_CORRECTION'],
                weight_kg=[k_lo, k_hi], weight_mean_kg=kg, density=[lo, hi, mean], density_unit='g/E' if comau else 'g/cm3',
                max_weight_kg=S['MAX_WEIGHT_KG'], next_bead_mm=nxt, slicer=tp.get('results'))


def job_results(job):
    w, S, tp, text, st = run_writer(job, job['machine'])
    return dict(results=results_of(w, S, tp, job['machine'], text, st))


def to_pdl(gcode_path, pdl, out_dir, name=None):
    """the user's gcode2pdl_arduino.py with the settings from the Comau panel"""
    g = load_script(os.path.join(CONVERTERS, 'gcode2pdl_arduino.py'))
    cfg = dict(g['DEFAULTS'])
    sfile = os.path.join(CONVERTERS, 'settings.json')
    if os.path.exists(sfile):
        with open(sfile, encoding='utf-8') as fh:
            cfg.update(json.load(fh))
    cfg.update({k: v for k, v in pdl.items() if k in PDL_EDITABLE})   # COM port, gear ratio, $FLY_DIST,
    cfg['name_suffix'] = ''                                             # $STRESS_PER stay as in settings.json; no name suffix
    st = {k: cfg[k] for k, _, _ in g['POPUP_FIELDS']}
    st['placement'] = cfg['placement']
    moves = g['trim'](g['parse'](gcode_path))
    if not moves:
        raise ValueError('No extruding moves found in ' + os.path.basename(gcode_path))
    pname = g['prog_name'](name or gcode_path, cfg)
    txt, info = g['build'](gcode_path, moves, st, cfg, pname)
    dst = os.path.join(out_dir, pname + '.pdl')
    with open(dst, 'w', newline='\r\n', encoding='utf-8') as fh:
        fh.write(txt)
    print('PDL: %s  (%d moves, %d paths, %d lines, S%d, Z %.1f-%.1f, est. %.0f min)' % (
        os.path.basename(dst), info['moves'], info['ons'], info['lines'], info['S'],
        info['zmin'] + info['dz'], info['zmax'] + info['dz'], g['estimate_min'](moves, st)))
    return dst


def job_export(job):
    machine = job['machine']               # wasp | comau | ur5
    os.makedirs(job['out_dir'], exist_ok=True)
    files = []
    gpath = os.path.join(job['out_dir'], out_name(job, machine) + '.gcode')
    if job.get('gcode_file'):              # imported custom G-code
        if os.path.abspath(job['gcode_file']) != os.path.abspath(gpath):
            shutil.copyfile(job['gcode_file'], gpath)
    else:                                  # UR5: the robot-neutral (Comau-format) G-code for now
        w, S, tp, text, st = run_writer(job, machine)
        with open(gpath, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)
        res = results_of(w, S, tp, machine, text, st)
    files.append(gpath)
    if machine == 'comau':
        files.append(to_pdl(gpath, job['pdl'], job['out_dir']))
    out = dict(files=files)
    if not job.get('gcode_file'):
        out['results'] = res
    return out


def crop_below(mesh, zc):
    """the part of the mesh below z = zc (triangles clipped, top left open; numpy only)"""
    import numpy as np
    import trimesh
    tri = mesh.vertices[mesh.faces]
    below = tri[:, :, 2] <= zc
    out = [tri[below.all(axis=1)]]
    for t in tri[below.any(axis=1) & ~below.all(axis=1)]:
        poly = []
        for i in range(3):                       # Sutherland-Hodgman against z <= zc
            a, b = t[i], t[(i + 1) % 3]
            ina, inb = a[2] <= zc, b[2] <= zc
            if ina:
                poly.append(a)
            if ina != inb:
                poly.append(a + (b - a) * (zc - a[2]) / (b[2] - a[2]))
        for k in range(1, len(poly) - 1):
            out.append(np.array([[poly[0], poly[k], poly[k + 1]]]))
    tris = np.concatenate([o for o in out if len(o)])
    return trimesh.Trimesh(vertices=tris.reshape(-1, 3), faces=np.arange(len(tris) * 3).reshape(-1, 3), process=False)


def job_preview(job):
    """Advanced settings preview: the first PREVIEW_LAYERS layers of one object (mesh cut above them)"""
    import trimesh
    p = job['params']
    n = 3
    z_cut = float(p['first_layer_height']) + (n - 0.5) * float(p['layer_height'])
    m = trimesh.load(job['meshes'][0]['path'], force='mesh')
    if m.bounds[1][2] > z_cut + 1e-6:
        m = crop_below(m, z_cut)
    cut = os.path.join(job['work_dir'], 'preview.stl')
    m.export(cut)
    job = dict(job, meshes=[dict(name='preview', path=cut)])
    if job.get('custom_file'):
        tp = slice_custom(job, cut)
    else:
        tp = slice_one(tp_path(job['toolpath']), cut, job['work_dir'], job['pattern_over'],
                       job['slice_over'], 'preview')
    return dict(layers=tp['layers'][:n])


def main(job_file=None):
    with open(job_file or sys.argv[1], encoding='utf-8') as fh:
        job = json.load(fh)
    buf = io.StringIO()
    res = dict(ok=False)
    try:
        with contextlib.redirect_stdout(buf):
            res.update({'slice': job_slice, 'export': job_export, 'preview': job_preview, 'results': job_results}[job['kind']](job))
        res['ok'] = True
    except SystemExit as e:
        res['error'] = 'Stopped: %s' % e
    except Exception as e:
        res['error'] = '%s: %s' % (type(e).__name__, e)
        res['trace'] = traceback.format_exc()
    res['log'] = [l for l in buf.getvalue().splitlines() if l.strip()]
    with open(job['result_file'], 'w', encoding='utf-8') as fh:
        json.dump(res, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
