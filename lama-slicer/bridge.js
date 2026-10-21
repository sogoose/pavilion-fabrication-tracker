/* LAMA browser host: preserve the original UI and toolpath Python source. */
(() => {
  'use strict';
  // Visual identity and credits only. The original 3D, slicing and export code is untouched.
  const attribution = "© 2026–27 Maria Dumitrache · Rojin Aghaei · Niels Dobroschelski · TU Delft Creative Robotics 26–27 Students. All rights reserved.";
  const theme = document.createElement('style');
  theme.id = 'lama-pavilion-loading-theme';
  theme.textContent = [
    '#splash{background:#f5f5f2;color:#151515;font-family:Inter,Arial,sans-serif;transition:opacity .35s ease}',
    '#splash::before{content:"PAVILION / FABRICATION     ·     03 / LAMA SLICER";position:absolute;top:26px;left:clamp(20px,4vw,56px);right:clamp(20px,4vw,56px);padding-bottom:15px;border-bottom:1px solid #c7c7c1;color:#555;font:11px/1.5 Consolas,monospace;letter-spacing:.07em}',
    '#splash svg{width:90px;height:90px;filter:grayscale(1);opacity:.8}',
    '#splash .nm{color:#151515;margin-top:18px;font-size:19px;letter-spacing:.15em}',
    '#splash .nm span{color:#777;font-weight:400}',
    '#splash .ld{color:#151515;font:600 11px/1.5 Consolas,monospace;letter-spacing:.1em;animation:none}',
    '#splash .st{color:#777;font:11px/1.5 Consolas,monospace}',
    '#splash .track{background:#deded8;width:220px;height:2px}',
    '#splash .track i{background:#222}',
    '#splash.err .ld{color:#b42318}',
    '.lama-splash-credit{position:absolute;bottom:26px;left:20px;right:20px;text-align:center;color:#777;font:10px/1.6 Consolas,monospace}',
    '.lama-attribution{margin:10px 16px 0;border-top:1px solid #d9d9d4;padding:15px 0 8px;color:#777;font:10px/1.6 Consolas,monospace;overflow-wrap:anywhere}',
    '.lama-attribution b{font-weight:600;color:#333;display:block;margin-bottom:5px}',
    '@media(max-width:600px){#splash::before{font-size:9px;letter-spacing:0}.lama-splash-credit{font-size:9px}}'
  ].join(String.fromCharCode(10));
  document.head.appendChild(theme);
  const splash = document.getElementById('splash');
  if (splash && !splash.querySelector('.lama-splash-credit')) {
    const credit = document.createElement('div');
    credit.className = 'lama-splash-credit';
    credit.textContent = attribution;
    splash.appendChild(credit);
  }
  const side = document.getElementById('side');
  if (side && !side.querySelector('.lama-attribution')) {
    const credit = document.createElement('div');
    credit.className = 'lama-attribution';
    const label = document.createElement('b');
    label.textContent = 'PROJECT CREDITS / COPYRIGHT';
    const line = document.createElement('div');
    line.textContent = attribution;
    credit.append(label, line);
    side.appendChild(credit);
  }

  const root = new URL('../', location.href);
  const worker = new Worker(new URL('py-worker.js', root));
  const pending = new Map();
  let nextId = 1;
  const KEY = 'lama-slicer-settings-v1';
  const CACHE = 'lama-slicer-assets-v4';
  const progress = text => {
    const el = document.querySelector('#splash .st');
    if (el) el.textContent = text;
    console.info('[LAMA engine]', text);
  };
  worker.addEventListener('message', event => {
    const m = event.data || {};
    if (m.progress) { progress(m.progress); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
  });
  worker.addEventListener('error', event => {
    for (const p of pending.values()) p.reject(new Error(event.message || 'Python worker failed'));
    pending.clear();
    progress('The browser Python engine could not start.');
  });
  function call(path, body) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {resolve, reject});
      worker.postMessage({id, path, body});
    });
  }
  const loadSaved = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  };
  const store = data => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn(e); }
  };
  function download(path) {
    const a = document.createElement('a');
    a.href = new URL('download?path=' + encodeURIComponent(path), root).href;
    a.download = path.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.lamaApi = async function(path, body) {
    if (path === '/api/settings') {
      store(body);
      return {ok:true};
    }
    if (path === '/api/open_folder') {
      alert('Browser mode: export files are downloaded individually with the Download links in the export panel.');
      return {ok:true};
    }
    if (path === '/api/reveal') {
      download(body.path);
      return {ok:true};
    }
    const result = await call(path, body);
    if (path === '/api/config') {
      result.saved = loadSaved();
      result.out_dir = 'Browser downloads';
    }
    if (path === '/api/export' && result?.ok && result.file_payloads) {
      const cache = await caches.open(CACHE);
      for (const item of result.file_payloads) {
        const raw = atob(item.data);
        const arr = new Uint8Array(raw.length);
        for (let i=0; i<raw.length; i++) arr[i] = raw.charCodeAt(i);
        const url = new URL('download?path=' + encodeURIComponent(item.path), root);
        await cache.put(url.href, new Response(arr, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="' + item.name.replace(/[^\w.\-]/g, '_') + '"',
            'Cache-Control': 'no-store'
          }
        }));
      }
      delete result.file_payloads;
      result.out_dir = 'Browser downloads (click Download)';
    }
    return result;
  };
})();