/* Python lives in a dedicated Web Worker, never on the Tracker's main thread. */
'use strict';
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let bootPromise = null;
let py = null;
const say = progress => self.postMessage({progress});
const root = new URL('./', self.location.href);
const sources = [
  'lama_engine.py','lama_server.py',
  'toolpaths/N1/weave_pattern.py','toolpaths/N1/weave_slice.py','toolpaths/N1/weave_gcode.py',
  'toolpaths/N2/weave_pattern.py','toolpaths/N2/weave_slice.py','toolpaths/N2/weave_gcode.py',
  'converters/gcode2pdl_arduino.py','converters/settings.json'
];
async function boot() {
  say('Loading Python/WebAssembly (first use downloads the runtime)…');
  importScripts(PYODIDE + 'pyodide.js');
  py = await loadPyodide({indexURL:PYODIDE});
  say('Loading numpy + shapely + scipy…');
  await py.loadPackage(['numpy', 'shapely', 'scipy', 'networkx', 'micropip']);
  say('Loading original mesh-processing dependencies…');
  await py.runPythonAsync("import micropip; await micropip.install('trimesh==4.6.2', deps=False)");
  const base = '/work/lama';
  py.FS.mkdirTree(base);
  say('Installing the original N1/N2 and PDL toolpath files…');
  const patchResp = await fetch(new URL('reference-patch.py', root).href, {cache:'no-store'});
  if (!patchResp.ok) throw new Error('Unable to load reference-section compatibility update: HTTP ' + patchResp.status);
  const referencePatch = await patchResp.text();
  for (const relative of sources) {
    const resp = await fetch(new URL('app/py/' + relative, root).href);
    if (!resp.ok) throw new Error('LAMA source missing: ' + relative + ' — re-import LAMA_Slicer.zip');
    const dest = base + '/' + relative;
    const dir = dest.slice(0, dest.lastIndexOf('/'));
    py.FS.mkdirTree(dir);
    let source = await resp.text();
    if (/^toolpaths\\/N[12]\\/weave_pattern\\.py$/.test(relative)) {
      source += '\\n\\n' + referencePatch;
    }
    py.FS.writeFile(dest, source);
  }
  py.FS.mkdirTree(base + '/output');
  py.FS.mkdirTree(base + '/.work');
  py.runPython(`
import os, sys, io, json, time, base64, contextlib, traceback
sys.path.insert(0, '/work/lama')
import lama_server, lama_engine

def _lama_inline_engine(job, timeout=1800):
    t0 = time.monotonic()
    os.makedirs(job['work_dir'], exist_ok=True)
    buf = io.StringIO()
    r = {'ok': False}
    try:
        with contextlib.redirect_stdout(buf):
            if job['kind'] == 'slice':
                data = lama_engine.job_slice(job)
            elif job['kind'] == 'export':
                data = lama_engine.job_export(job)
            else:
                raise ValueError('Unsupported job kind: ' + str(job['kind']))
        r.update(data)
        r['ok'] = True
    except BaseException as e:
        r['error'] = str(type(e).__name__) + ': ' + str(e)
        r['trace'] = traceback.format_exc()
    r['seconds'] = round(time.monotonic() - t0, 2)
    r['log'] = [s for s in buf.getvalue().splitlines() if s.strip()]
    return r

lama_server.run_engine = _lama_inline_engine

def _lama_dispatch(path, raw):
    body = json.loads(raw)
    if path == '/api/config':
        return {
            'toolpaths': {n:lama_server.toolpath_defaults(n) for n in ('N1','N2')},
            'pdl': lama_server.pdl_defaults(),
            'saved': None,
            'out_dir': 'Browser downloads',
        }
    if path == '/api/slice':
        return lama_server.api_slice(body)
    if path == '/api/export':
        # Browsers have no permission to write into a local Windows folder.
        body['out_dir'] = '/work/lama/output'
        r = lama_server.api_export(body)
        if r.get('ok'):
            payloads = []
            for f in r['files']:
                with open(f['path'], 'rb') as handle:
                    encoded = base64.b64encode(handle.read()).decode('ascii')
                payloads.append({'path':f['path'], 'name':f['name'], 'data':encoded})
            r['file_payloads'] = payloads
        return r
    return {'ok':False, 'error':'Unknown API method: ' + path}
`);
  say('Checking original toolpaths and PDL converter…');
  py.runPython(`
import os
diag = '/work/lama/.work/lama_selftest'
os.makedirs(diag, exist_ok=True)
for kind in ('N1', 'N2'):
    for fname in ('weave_pattern.py','weave_slice.py','weave_gcode.py'):
        source = os.path.join('/work/lama/toolpaths', kind, fname)
        with open(source, encoding='utf-8') as f:
            compile(f.read(), source, 'exec')
gc = os.path.join(diag, 'LamaDiagnostics.gcode')
with open(gc, 'w', encoding='utf-8') as f:
    f.write("G21\\nG90\\nM82\\nG92 E0\\nG0 X0 Y0 Z2 F2000\\nG1 X10 Y0 Z2 E1 F1200\\nG1 X10 Y10 E2\\nG1 X0 Y10 E3\\n")
pd = lama_engine.to_pdl(gc, {'placement':'keep'}, diag)
assert os.path.isfile(pd) and os.path.getsize(pd) > 500, 'PDL conversion failed'
`);
  say('Original N1/N2 source, adaptive reference selection and PDL converter verified; loading machine scene…');
}
self.addEventListener('message', async event => {
  const {id, path, body} = event.data || {};
  if (typeof id !== 'number') return;
  try {
    if (!bootPromise) bootPromise = boot();
    await bootPromise;
    say(path === '/api/slice' ? 'Computing the original ' + (body?.toolpath || 'N2') + ' toolpath…'
      : path === '/api/export' ? 'Exporting machine instructions…' : 'Loading settings…');
    py.globals.set('_lama_path_arg', path);
    py.globals.set('_lama_json_arg', JSON.stringify(body || {}));
    const output = py.runPython('json.dumps(_lama_dispatch(_lama_path_arg, _lama_json_arg), separators=(",", ":"))');
    self.postMessage({id, result:JSON.parse(output)});
  } catch (error) {
    self.postMessage({id,error:error?.stack || String(error)});
  }
});