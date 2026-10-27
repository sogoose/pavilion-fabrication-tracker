/* LAMA Slicer in the browser: the Python engine (lama_server + lama_engine + toolpath scripts) runs in Pyodide
   inside this Web Worker. Sources come from app/py/ (listed in app/py/manifest.json, written by tools/build_web.py). */
'use strict';
const params = new URL(self.location.href).searchParams;
const PYODIDE = params.get('pyodide') || 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';
const root = new URL('./', self.location.href);
const pyBase = new URL('app/py/', root);
const say = progress => self.postMessage({ progress });
let py = null, bootPromise = null;

const BOOT = `
import os, sys, io, json, time, base64, contextlib, traceback
sys.argv = ['lama_server.py']
sys.path.insert(0, '/work/lama')
os.chdir('/work/lama')
import lama_server as S
import lama_engine as E
_KINDS = {'slice': E.job_slice, 'export': E.job_export, 'preview': E.job_preview, 'results': E.job_results}

def _run_engine(job, timeout=1800):
    """the desktop app runs lama_engine.py as a subprocess; here it runs in-process (same job / result dicts)"""
    t0 = time.monotonic()
    os.makedirs(job['work_dir'], exist_ok=True)
    cwd = os.getcwd()
    buf = io.StringIO()
    r = {'ok': False}
    try:
        os.chdir(job['work_dir'])
        with contextlib.redirect_stdout(buf):
            r.update(_KINDS[job['kind']](job))
        r['ok'] = True
    except SystemExit as e:
        r['error'] = 'Stopped: %s' % e
    except Exception as e:
        r['error'] = '%s: %s' % (type(e).__name__, e)
        r['trace'] = traceback.format_exc()
    finally:
        os.chdir(cwd)
    r['seconds'] = round(time.monotonic() - t0, 1)
    r['log'] = [l for l in buf.getvalue().splitlines() if l.strip()]
    return r

S.run_engine = _run_engine

def _dispatch(path, raw):
    body = json.loads(raw)
    if path == '/api/config':
        return dict(toolpaths={t: S.toolpath_defaults(t) for t in S.toolpath_types()}, general=S.general_settings(),
                    pdl=S.pdl_defaults(), saved=None, out_dir='Browser downloads', configs=S.configurations())
    if path == '/api/slice':
        return S.api_slice(body)
    if path == '/api/preview':
        return S.api_slice(body, preview=True)
    if path == '/api/results':
        return S.api_results(body)
    if path == '/api/toolpath_import':
        return S.toolpath_import(body)
    if path == '/api/toolpath_delete':
        return S.toolpath_delete(body.get('name', ''))
    if path == '/api/export':
        body['out_dir'] = '/work/lama/output'
        r = S.api_export(body)
        if r.get('ok'):
            r['file_payloads'] = []
            for f in r.get('files', []):
                with open(f['path'], 'rb') as fh:
                    r['file_payloads'].append(dict(path=f['path'], name=f['name'], data=base64.b64encode(fh.read()).decode('ascii')))
        return r
    return dict(ok=False, error='Not available in the browser version: ' + path)
`;

async function boot() {
  say('Loading Python (first visit downloads the runtime)…');
  importScripts(PYODIDE + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE });
  say('Loading numpy, scipy, shapely…');
  await py.loadPackage(['numpy', 'scipy', 'shapely', 'networkx', 'micropip']);
  const manifest = await (await fetch(new URL('manifest.json', pyBase), { cache: 'no-cache' })).json();
  say('Loading trimesh…');
  py.globals.set('_wheel', new URL(manifest.wheel, pyBase).href);
  await py.runPythonAsync("import micropip\nawait micropip.install(_wheel, deps=False)");
  say('Installing LAMA Slicer ' + manifest.version + '…');
  const base = '/work/lama';
  for (const rel of manifest.files) {
    const r = await fetch(new URL(rel, pyBase), { cache: 'no-cache' });
    if (!r.ok) throw new Error('Missing file ' + rel + ' (HTTP ' + r.status + ')');
    const dest = base + '/' + rel;
    py.FS.mkdirTree(dest.slice(0, dest.lastIndexOf('/')));
    py.FS.writeFile(dest, new Uint8Array(await r.arrayBuffer()));
  }
  for (const d of ['output', '.work', 'toolpaths/imported', 'projects']) py.FS.mkdirTree(base + '/' + d);
  for (const rel of manifest.patches || []) {            // browser-only compatibility patches (geos_patch.py)
    const r = await fetch(new URL(rel, pyBase), { cache: 'no-cache' });
    if (!r.ok) throw new Error('Missing file ' + rel + ' (HTTP ' + r.status + ')');
    py.runPython(await r.text());
  }
  py.runPython(BOOT);
  say('Starting the slicer…');
}

self.addEventListener('message', async event => {
  const { id, path, body } = event.data || {};
  if (typeof id !== 'number') return;
  try {
    if (!bootPromise) bootPromise = boot();
    await bootPromise;
    py.globals.set('_p', path);
    py.globals.set('_b', JSON.stringify(body || {}));
    const out = py.runPython('json.dumps(_dispatch(_p, _b), separators=(",", ":"))');
    self.postMessage({ id, result: JSON.parse(out) });
  } catch (error) {
    self.postMessage({ id, error: (error && (error.message || error.stack)) || String(error) });
  }
});
