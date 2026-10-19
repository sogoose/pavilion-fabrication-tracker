/* Pavilion Fabrication Catalogue — CAD-style A4 landscape PDF.
 * Runs entirely in the visitor's browser; does not mutate Tracker records.
 * Module records come from shared Supabase (fallback: current Rhino/Tracker).
 * One image-rich technical sheet per module, optional summary cover.
 */
import { idOrder, parseGcode3D, drawSheet as drawVectorSheet, drawCover as drawVectorCover }
  from './vector-sheet.js?v=20261019-v5';

export function setupCatalog({ THREE, getState, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML =
    '<div class="catalog-shell">' +
      '<div class="catalog-head"><span class="catalog-kicker">PAVILION / DOCUMENTATION</span>' +
      '<button type="button" class="catalog-close" aria-label="Close">×</button></div>' +
      '<h2>Fabrication Catalogue</h2>' +
      '<p class="catalog-lead">A4 landscape · currently modelled modules only · one CAD sheet per module.</p>' +
      '<label class="catalog-field">PAGES' +
        '<select class="catalog-scope"><option value="all">Full catalogue / all modules</option>' +
        '<option value="upper">Uppercase IDs only / A, B, C…</option>' +
        '<option value="selected">Selected module / one sheet</option></select></label>' +

      '<label class="catalog-check"><input class="catalog-cover" type="checkbox" checked>' +
        '<span>Include overview / cover page in full catalogue</span></label>' +
      '<p class="catalog-footnote">Only modules in the currently loaded Rhino file are included. One A4 sheet per module. The larger render and latest two site photos are placed beside vector CAD data.</p>' +
      '<div class="catalog-progress" hidden><div class="catalog-track"><div class="catalog-progress-fill"></div></div>' +
        '<span class="catalog-status" role="status" aria-live="polite"></span></div>' +
      '<div class="catalog-actions"><button type="button" class="catalog-cancel">Cancel</button>' +
        '<button type="button" class="catalog-download">Download PDF ↗</button></div>' +
    '</div>';
  document.body.append(dialog);

  const $ = s => dialog.querySelector(s);
  const scope = $('.catalog-scope');
  const cover = $('.catalog-cover');
  const progress = $('.catalog-progress');
  const progressFill = $('.catalog-progress-fill');
  const status = $('.catalog-status');
  const download = $('.catalog-download');
  const cancel = $('.catalog-cancel');
  let busy = false, cancelled = false;

  function message(text, fraction) {
    progress.hidden = false;
    status.textContent = text;
    if (typeof fraction === 'number') {
      progressFill.style.width = Math.max(0, Math.min(100, fraction * 100)) + '%';
    }
  }
  function close() {
    if (busy) {
      cancelled = true;
      message('Stopping after current sheet…');
      return;
    }
    dialog.close();
  }
  $('.catalog-close').addEventListener('click', close);
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', e => {
    if (busy) { e.preventDefault(); close(); }
  });
  dialog.addEventListener('click', e => {
    if (e.target === dialog) close();
  });
  scope.addEventListener('change', () => { cover.disabled = scope.value === 'selected'; });
  function open(requested = 'all') {
    if (busy) return;
    const state = getState();
    const hasSelection = !!(state.selectedKey && state.records[state.selectedKey]);
    scope.querySelector('option[value="selected"]').disabled = !hasSelection;
    scope.value = requested === 'selected' && hasSelection ? 'selected' : 'all';
    cover.disabled = scope.value === 'selected';
    progress.hidden = true;
    progressFill.style.width = '0%';
    status.textContent = '';
    dialog.showModal();
  }
  // Module records take priority over the current viewport filter/search.
  const compareIds = (a,b) => idOrder(a.record.Object_ID,b.record.Object_ID);

  function clean(v) {
    return (v === undefined || v === null || String(v).trim() === '')
      ? '—' : String(v).trim();
  }
  function prettyDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 16).replace('T',' ');
  }
  function fieldValue(record, key) {
    return clean(record[key]);
  }
  function mapCloud(row, dbMap) {
    const record = {};
    for (const [key,column] of Object.entries(dbMap)) {
      record[key] = row[column] ?? '';
    }
    return record;
  }
  async function gatherRecords(state) {
    // Rhino geometry is authoritative. NEVER resurrect historical cloud records
    // or cached modules whose GUID is absent from the currently loaded .3dm.
    const currentParts = (state.parts || []).filter(part =>
      part && part.key && Array.isArray(part.meshes) && part.meshes.length > 0
    );
    if(!currentParts.length) {
      throw new Error('Current Rhino model is not loaded. Wait for model.3dm to load before downloading the catalogue.');
    }
    const partById = new Map(currentParts.map(part => [String(part.key),part]));
    const all = new Map();
    for (const [key,part] of partById) {
      const local = state.records?.[key] || {};
      all.set(key, {key, part, record:{...local, Rhino_GUID:key}});
    }
    if (state.client && state.liveMode) {
      const response = await state.client.from('pavilion_parts')
        .select('*').eq('project_id',state.projectId).range(0, 1999);
      if (response.error) {
        console.warn('Catalogue: shared records unavailable; using current model records.',response.error.message);
      } else {
        for (const row of response.data || []) {
          const key = String(row.rhino_guid || '');
          if (!all.has(key)) continue;
          const entry=all.get(key);
          entry.record = {...entry.record, ...mapCloud(row,state.dbMap)};
        }
      }
    }
    return [...all.values()].sort(compareIds);
  }
  async function gatherPhotos(state) {
    const photos = new Map();
    if (!state.liveMode || !state.client) return photos;
    const {data,error} = await state.client
      .from('pavilion_module_photos')
      .select('rhino_guid,storage_path,note,created_at,object_id')
      .eq('project_id',state.projectId)
      .order('created_at',{ascending:false}).range(0,1999);
    if (error) {
      console.warn('Catalogue photos unavailable:',error.message);
      return photos;
    }
    for (const item of data || []) {
      const key = String(item.rhino_guid || '');
      if (!key) continue;
      const list = photos.get(key) || [];
      if (list.length >= 2) continue;
      list.push(item);
      photos.set(key,list);
    }
    return photos;
  }
  function createIsolatedCapture() {
    let renderer=null;
    const material=new THREE.MeshStandardMaterial({
      color:0xcac0a9,roughness:0.94,metalness:0,side:THREE.DoubleSide
    });
    try {
      renderer=new THREE.WebGLRenderer({ antialias:true,preserveDrawingBuffer:true,alpha:false });
      renderer.setPixelRatio(1);
      renderer.setSize(1650,1100,false);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
    } catch(error) { console.warn('Catalogue isolated 3D renderer:',error); return null; }
    const render = part => {
      if (!part?.meshes?.length) return null;
      const scene=new THREE.Scene();
      scene.background=new THREE.Color(0xf1f0eb);
      scene.add(new THREE.HemisphereLight(0xffffff,0xb7afa0,2.4));
      const light=new THREE.DirectionalLight(0xffffff,3.1);
      light.position.set(7,-9,11);scene.add(light);
      const group=new THREE.Group();scene.add(group);
      for(const mesh of part.meshes) {
        if(!mesh.geometry) continue;
        mesh.updateWorldMatrix(true,false);
        const clone=new THREE.Mesh(mesh.geometry,material);
        clone.matrixAutoUpdate=false;
        clone.matrix.copy(mesh.matrixWorld);
        group.add(clone);
      }
      if(!group.children.length) return null;
      const box=new THREE.Box3().setFromObject(group);
      if(box.isEmpty()) return null;
      const center=box.getCenter(new THREE.Vector3());
      const size=box.getSize(new THREE.Vector3());
      const radius=Math.max(size.length()/2,0.01);
      const camera=new THREE.PerspectiveCamera(32,1650/1100,0.01,Math.max(10000,radius*60));
      const direction=new THREE.Vector3(1,-1,0.86).normalize();
      const distance=Math.max(2.75*radius,radius/Math.sin(16*Math.PI/180)*1.12);
      camera.position.copy(center).addScaledVector(direction,distance);
      camera.up.set(0,0,1);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.render(scene,camera);
      return renderer.domElement;
    };
    return {render,dispose:()=>{renderer.dispose();renderer.forceContextLoss?.();material.dispose();}};
  }
  async function photoVisual(client,bucket,item) {
    if(!client || !item?.storage_path)return null;
    const {data,error}=await client.storage.from(bucket).download(item.storage_path);
    if(error || !data)throw error || new Error('No image');
    const image=await createImageBitmap(data);
    return {canvas:image,kind:'SITE PHOTO / FABRICATION',note:item.note || ''};
  }
  async function moduleAssets(state,entry,photos,capture,visualPref) {
    const asset={photos:[],model:null,gcode:[]};
    // Only the latest two uploaded photos enter the thumbnail strip.
    // A failed photo never prevents the Rhino render or G-code from appearing.
    if(photos.has(entry.key) && state.client) {
      for(const item of photos.get(entry.key).slice(0,2)) {
        try {
          const loaded=await photoVisual(state.client,state.photoBucket,item);
          if(loaded?.canvas) asset.photos.push(loaded.canvas);
        } catch(error) {
          console.warn('Catalogue photo '+entry.key+':',error);
        }
      }
    }
    if(entry.part && capture) {
      try {asset.model=capture.render(entry.part);}catch(error) {
        console.warn('Catalogue Rhino capture '+entry.key+':',error);
      }
    }
    const path=String(entry.record.GCode_File||'').trim();
    if(path.startsWith(state.projectId+'/') && state.client){
      try{
        const {data,error}=await state.client.storage.from(state.gcodeBucket).download(path);
        if(error)throw error;
        asset.gcode=parseGcode3D(await data.slice(0,8*1024*1024).text());
      }catch(error){
        console.warn('Catalogue G-code '+entry.key+':',error);
      }
    }
    return asset;
  }
  download.addEventListener('click',async()=>{
    if(busy)return;
    const Class=window.jspdf?.jsPDF;
    if(!Class){
      message('PDF library unavailable. Check your connection and reload.');
      return;
    }
    busy=true;cancelled=false;download.disabled=true;scope.disabled=true;
    cover.disabled=true;
    const original=download.textContent;
    download.textContent='Generating…';
    let capture=null;
    try{
      const state=getState();
      message('Reading shared fabrication data…',0);
      if(document.fonts?.ready)await document.fonts.ready;
      const all=await gatherRecords(state);
      let entries=scope.value==='selected'
        ? all.filter(e=>e.key===String(state.selectedKey))
        : scope.value==='upper'
        ? all.filter(e=>/^[A-Z]/.test(String(e.record.Object_ID||'')))
        : all;
      if(!entries.length)throw new Error('No modules found. Load or sync the Tracker first.');
      const photos=await gatherPhotos(state);
      const pdf=new Class({orientation:'landscape',unit:'mm',format:'a4',
        compress:true,putOnlyUsedFonts:true,precision:4});
      pdf.setProperties({title:'Pavilion Fabrication Catalogue',
        subject:'CAD fabrication module records',author:'Pavilion Fabrication Tracker'});
      let pages=0;
      const next=()=>{
        if(pages)pdf.addPage('a4','landscape');
        pages++;
      };
      if(scope.value!=='selected'&&cover.checked){
        next();
        const currentIds=new Set(entries.map(e=>e.key));
        const selectedPhotos=[...photos.keys()].filter(key=>currentIds.has(key)).length;
        drawVectorCover(pdf,entries,selectedPhotos,
          entries.filter(e=>String(e.record.GCode_File||'').trim()).length);
      }
      capture=createIsolatedCapture();
      for(let i=0;i<entries.length;i++){
        if(cancelled)throw new Error('Catalogue cancelled.');
        const entry=entries[i];
        message('CAD sheet '+(i+1)+' / '+entries.length+' · '+clean(entry.record.Object_ID),
          (i+.1)/entries.length);
        const asset=await moduleAssets(state,entry,photos,capture,'model');
        next();
        drawVectorSheet(pdf,entry,asset,{
          THREE,number:i+1,total:entries.length
        });
        for(const img of asset.photos || []) if(img?.close)img.close();
        if(i%2===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(cancelled)throw new Error('Catalogue cancelled.');
      message('Saving '+pages+' vector PDF pages…',1);
      const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
      const name=scope.value==='selected'
        ? 'Pavilion_Module_'+(entries[0].record.Object_ID||'record').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf'
        : 'Pavilion_Fabrication_Catalogue_'+(scope.value==='upper'?'Uppercase_':'')+stamp+'.pdf';
      await pdf.save(name,{returnPromise:true});
      message('Saved '+pages+' pages · '+entries.length+' modules · vector CAD.',1);
      notify?.('Vector PDF ready · '+entries.length+' module sheets.');
    }catch(error){
      message(error?.message||'Could not generate the catalogue PDF.');
      if(!cancelled)notify?.('Catalogue PDF failed: '+(error?.message||error),true);
    }finally{
      capture?.dispose();
      busy=false;cancelled=false;
      download.disabled=false;scope.disabled=false;
      cover.disabled=scope.value==='selected';
      download.textContent=original;
    }
  });

  return {open};
}
