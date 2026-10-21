/* LAMA browser host: preserve the original UI and toolpath Python source. */
(() => {
  'use strict';
  // Visual identity and credits only. The original 3D, slicing and export code is untouched.
  const attribution = "© 2026–27 Maria Dumitrache · Rojin Aghaei · Niels Dobroschelski · TU Delft Creative Robotics 26–27 Students. All rights reserved.";
  // Keep a fallback stylesheet link for old cached workspaces.
  // New installations load the same stylesheet in <head> before the first paint.
  if (!document.getElementById('lama-pavilion-loading-theme')) {
    const theme = document.createElement('link');
    theme.id = 'lama-pavilion-loading-theme';
    theme.rel = 'stylesheet';
    theme.href = new URL('../loading-theme.css', location.href).href;
    document.head.appendChild(theme);
  }
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
  const CACHE = 'lama-slicer-assets-v5';
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