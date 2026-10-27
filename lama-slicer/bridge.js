/* LAMA Slicer in the browser: replaces the desktop app's local HTTP server.
   Python routes go to py-worker.js (Pyodide); projects live in IndexedDB, settings in localStorage,
   exports are downloaded. Loaded by app/index.html before js/app.js. */
(() => {
  'use strict';
  const VERSION = '1.6';
  const CODE_URL = 'https://github.com/sogoose/pavilion-fabrication-tracker/tree/main/lama-slicer/app/py/toolpaths/sinusoidal';
  const CREDIT = '© 2026–27 Maria Dumitrache · Rojin Aghaei · Niels Dobroschelski · TU Delft Creative Robotics 26–27 Students. All rights reserved.';
  const root = new URL('../', location.href);
  window.lamaBrowser = true;

  // ---- credits (splash + sidebar), as on the pavilion website
  document.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('splash');
    if (splash && !splash.querySelector('.lama-splash-credit')) {
      const c = document.createElement('div'); c.className = 'lama-splash-credit'; c.textContent = CREDIT; splash.appendChild(c);
    }
    const side = document.getElementById('side');
    if (side && !side.querySelector('.lama-attribution')) {
      const c = document.createElement('div'); c.className = 'lama-attribution';
      const b = document.createElement('b'); b.textContent = 'PROJECT CREDITS / COPYRIGHT';
      const l = document.createElement('div'); l.textContent = CREDIT;
      c.append(b, l); side.appendChild(c);
    }
  });

  // ---- Python worker
  const pyodide = new URLSearchParams(location.search).get('pyodide');
  const worker = new Worker(new URL('py-worker.js?v=' + VERSION + (pyodide ? '&pyodide=' + encodeURIComponent(pyodide) : ''), root));
  const pending = new Map();
  let nextId = 1;
  const progress = text => { const el = document.querySelector('#splash .st'); if (el) el.textContent = text; console.info('[LAMA engine]', text); };
  worker.addEventListener('message', e => {
    const m = e.data || {};
    if (m.progress) { progress(m.progress); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  });
  worker.addEventListener('error', e => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The Python engine could not start.'));
    pending.clear(); progress('The Python engine could not start: ' + (e.message || ''));
  });
  const call = (path, body) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); worker.postMessage({ id, path, body }); });

  // ---- settings (localStorage) and projects (IndexedDB; memory if the browser blocks it)
  const KEY = 'lama-slicer-settings-v16';
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const store = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { console.warn(e); } };
  const mem = { projects: new Map(), meta: new Map() };
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('lama-slicer', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('projects'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }).catch(() => null));
  async function idb(storeName, mode, fn) {
    const d = await db();
    if (!d) return fn(null, mem[storeName]);
    return new Promise((res, rej) => {
      const tx = d.transaction(storeName, mode), q = fn(tx.objectStore(storeName));
      tx.oncomplete = () => res(q && 'result' in q ? q.result : q); tx.onerror = () => rej(tx.error);
    });
  }
  const get = (s, k) => idb(s, 'readonly', (st, m) => st ? st.get(k) : m.get(k));
  const put = (s, k, v) => idb(s, 'readwrite', (st, m) => st ? st.put(v, k) : m.set(k, v));
  const del = (s, k) => idb(s, 'readwrite', (st, m) => st ? st.delete(k) : m.delete(k));
  const all = s => idb(s, 'readonly', (st, m) => st ? st.getAll() : [...m.values()]);

  // ---- downloads
  const CACHE = 'lama-slicer-downloads-v16';
  function saveAs(name, bytes) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const files = new Map();        // export path -> {name, bytes}

  window.lamaApi = async function (path, body) {
    const [route, query] = path.split('?');
    switch (route) {
      case '/api/settings': store(body); return { ok: true };
      case '/api/projects': {
        const list = (await all('meta')) || [];
        return { ok: true, projects: list.sort((a, b) => (b.modified || 0) - (a.modified || 0)) };
      }
      case '/api/project': {
        const id = new URLSearchParams(query).get('id');
        const data = await get('projects', id), meta = await get('meta', id);
        return data ? { ok: true, data, meta } : { ok: false, error: 'Project not found' };
      }
      case '/api/project_save': {
        if (body.data != null) await put('projects', body.id, body.data);
        const old = (await get('meta', body.id)) || {};
        for (const [k, v] of Object.entries(body.meta || {})) if (v != null) old[k] = v;
        old.id = body.id; old.modified = Date.now() / 1000;
        await put('meta', body.id, old);
        return { ok: true };
      }
      case '/api/project_delete': await del('projects', body.id); await del('meta', body.id); return { ok: true };
      case '/api/open_code': window.open(CODE_URL, '_blank', 'noopener'); return { ok: true };
      case '/api/open_folder': alert('Browser version: the exported files are in your browser\'s Downloads.'); return { ok: true };
      case '/api/reveal': { const f = files.get(body.path); if (f) saveAs(f.name, f.bytes); return { ok: true }; }
    }
    const r = await call(route, body);
    if (route === '/api/config') { r.saved = loadSaved(); r.out_dir = 'Browser downloads'; }
    if (route === '/api/export' && r && r.ok && r.file_payloads) {
      let cache = null;
      try { cache = await caches.open(CACHE); } catch (e) { /* no Cache Storage: Download links fall back to Show */ }
      for (const f of r.file_payloads) {
        const raw = atob(f.data), bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        files.set(f.path, { name: f.name, bytes });
        if (cache) await cache.put(new URL('download?path=' + encodeURIComponent(f.path), root).href,
          new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + f.name.replace(/[^\w.\-]/g, '_') + '"' } }));
        saveAs(f.name, bytes);
      }
      delete r.file_payloads;
      r.out_dir = 'Browser downloads';
    }
    return r;
  };
})();
