/* Pavilion Fabrication Catalogue — CAD-style A4 landscape PDF.
 * Runs entirely in the visitor's browser; does not mutate Tracker records.
 * Module records come from shared Supabase (fallback: current Rhino/Tracker).
 * One image-rich technical sheet per module, optional summary cover.
 */
import {
  idOrder, parseGcode3D, MODULE_PANEL_RGB,
  drawSheet as drawVectorSheet,
  drawSimpleSheet as drawSimpleVectorSheet,
  drawStatusCover as drawVectorCover,
  drawRegisterPage as drawVectorRegister,
  drawFabricationTimelinePage as drawDatePage,
  fabricationDateGroups
} from './vector-sheet.js?v=20261028-simple-record-v1';

export function setupCatalog({ THREE, getState, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML =
    '<div class="catalog-shell">' +
      '<div class="catalog-head"><span class="catalog-kicker">PAVILION / DOCUMENTATION</span>' +
      '<button type="button" class="catalog-close" aria-label="Close">×</button></div>' +
      '<h2>Fabrication Catalogue</h2>' +
      '<p class="catalog-lead">Export the production-status map, fabrication-date timeline with 3D model, module register and individual CAD sheets.</p>' +
      '<label class="catalog-field">FORMAT' +
        '<select class="catalog-format"><option value="technical">Technical / detailed catalogue</option>' +
        '<option value="simple">Simple / photo + date + material + notes</option></select></label>' +
      '<label class="catalog-field">PAGES' +
        '<select class="catalog-scope"><option value="all">Full catalogue / all modules</option>' +
        '<option value="upper">Uppercase IDs only / A, B, C…</option>' +
        '<option value="selected">Selected module / one sheet</option>' +
        '<option value="timeline">Fabrication timeline / 3D map only</option></select></label>' +

      '<label class="catalog-check"><input class="catalog-cover" type="checkbox" checked>' +
        '<span>Include status map + module register at the front</span></label>' +
      '<label class="catalog-check"><input class="catalog-dates" type="checkbox" checked>' +
        '<span>Include fabrication timeline + dated 3D pavilion map</span></label>' +
      '<p class="catalog-footnote">Only modules in the current Rhino model are included. Individual sheets place the latest site photo in the large left frame, with 3D G-code above a smaller Rhino render. Modules without site photos retain the Rhino hero.</p>' +
      '<div class="catalog-progress" hidden><div class="catalog-track"><div class="catalog-progress-fill"></div></div>' +
        '<span class="catalog-status" role="status" aria-live="polite"></span></div>' +
      '<div class="catalog-actions"><button type="button" class="catalog-cancel">Cancel</button>' +
        '<button type="button" class="catalog-download">Download PDF ↗</button></div>' +
    '</div>';
  document.body.append(dialog);

  const $ = s => dialog.querySelector(s);
  const scope = $('.catalog-scope');
  const format = $('.catalog-format');
  const description = $('.catalog-lead');
  const footnote = $('.catalog-footnote');
  const heading = dialog.querySelector('h2');
  const cover = $('.catalog-cover');
  const datesOption = $('.catalog-dates');
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
  function syncOptions(){
    const simple=format.value==='simple';
    const timeline=scope.querySelector('option[value="timeline"]');
    timeline.disabled=simple;
    if(simple && scope.value==='timeline')scope.value='all';
    cover.closest('label').style.display=simple?'none':'';
    datesOption.closest('label').style.display=simple?'none':'';
    cover.disabled=simple||scope.value==='selected'||scope.value==='timeline';
    datesOption.disabled=simple||scope.value==='timeline';
    heading.textContent=simple?'Simple Module Catalogue':'Fabrication Catalogue';
    description.textContent=simple
      ? 'One photo-first A4 sheet per module: fabrication date, material and notes. No technical parameters.'
      : 'Export the production-status map, fabrication-date timeline with 3D model, module register and individual CAD sheets.';
    footnote.textContent=simple
      ? 'The latest uploaded site photo is shown large. If no photo exists, the Rhino model is used instead. The full technical catalogue remains available.'
      : 'Only modules in the current Rhino model are included. Individual sheets place the latest site photo in the large left frame, with 3D G-code above a smaller Rhino render. Modules without site photos retain the Rhino hero.';
  }
  scope.addEventListener('change',()=>{
    if(format.value!=='simple')datesOption.checked=scope.value!=='selected';
    syncOptions();
  });
  format.addEventListener('change',()=>{
    if(format.value!=='simple')datesOption.checked=scope.value!=='selected';
    syncOptions();
  });
  function open(requested='all',layout='technical'){
    if(busy)return;
    const state=getState();
    const hasSelection=!!(state.selectedKey&&state.records[state.selectedKey]);
    scope.querySelector('option[value="selected"]').disabled=!hasSelection;
    format.value=layout==='simple'?'simple':'technical';
    scope.value=requested==='timeline'&&format.value!=='simple'?'timeline':
      requested==='selected'&&hasSelection?'selected':'all';
    datesOption.checked=scope.value!=='selected'&&format.value!=='simple';
    syncOptions();
    progress.hidden=true;
    progressFill.style.width='0%';
    status.textContent='';
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
      renderer.setSize(1320,1320,false);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
    } catch(error) { console.warn('Catalogue isolated 3D renderer:',error); return null; }
    const render = part => {
      if (!part?.meshes?.length) return null;
      const scene=new THREE.Scene();
      // Keep the Rhino canvas identical to the PDF figure background.
      scene.background=new THREE.Color('rgb('+MODULE_PANEL_RGB.join(',')+')');
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
      const camera=new THREE.PerspectiveCamera(32,1,0.01,Math.max(10000,radius*60));
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
  const DEFAULT_PRODUCTION_COLORS={
    'Not Started':'#d6d6d1','Queued':'#a8c7e8',
    'Printing':'#e7c971','Printed':'#79aa7a','Failed':'#cc6b62'
  };
  function captureProductionOverview(state,entries,{fabricationCutoff=null}={}) {
    // Use a separate scene and material clones: never disturb the interactive
    // Tracker viewer, camera, visibility or its selected-object colors.
    const width=2100,height=1503;
    let overviewRenderer=null;
    const colors={...DEFAULT_PRODUCTION_COLORS,...(state.productionPalette||{})};
    const fabricationPalette={
      '3D Printing':'#4e85c0','Rammed Earth':'#a78252',
      Other:'#859a83',Later:'#bfc3c0',Undated:'#e7e8e4'
    };
    const materials=new Map();
    try{
      overviewRenderer=new THREE.WebGLRenderer({
        antialias:true,preserveDrawingBuffer:true,alpha:false
      });
      overviewRenderer.setPixelRatio(1);
      overviewRenderer.setSize(width,height,false);
      overviewRenderer.outputColorSpace=THREE.SRGBColorSpace;
      const scene=new THREE.Scene();
      scene.background=new THREE.Color(0xf6f6f2);
      const group=new THREE.Group();
      scene.add(group);
      // Moderate lighting keeps the legend's status colours distinguishable:
      // very bright lights previously washed out light-grey and pastel blocks.
      scene.add(new THREE.HemisphereLight(0xffffff,0xb3b4a9,1.25));
      const key=new THREE.DirectionalLight(0xffffff,1.55);
      key.position.set(9,-11,16);scene.add(key);
      const fill=new THREE.DirectionalLight(0xffffff,.4);
      fill.position.set(-8,7,6);scene.add(fill);

      const anchors=[];
      for(const entry of entries) {
        if(!entry.part?.meshes?.length)continue;
        let status=String(entry.record.Production_Status||'Not Started');
        let color=colors[status]||'#bbbdb7';
        if(fabricationCutoff!==null){
          const date=String(entry.record.Fabrication_Date||'').trim();
          const valid=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+'T12:00:00Z'));
          status=!valid?'Undated':date>fabricationCutoff?'Later':
            fabricationPalette[entry.record.Manufacturing_Method]?entry.record.Manufacturing_Method:'Other';
          color=fabricationPalette[status];
        }
        if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({
          color,roughness:.9,metalness:0,side:THREE.DoubleSide
        }));
        const local=new THREE.Group();
        for(const mesh of entry.part.meshes){
          if(!mesh?.geometry)continue;
          mesh.updateWorldMatrix(true,false);
          const clone=new THREE.Mesh(mesh.geometry,materials.get(color));
          clone.matrixAutoUpdate=false;
          clone.matrix.copy(mesh.matrixWorld);
          local.add(clone);
        }
        if(!local.children.length)continue;
        group.add(local);
        const bounds=new THREE.Box3().setFromObject(local);
        if(!bounds.isEmpty())anchors.push({
          id:String(entry.record.Object_ID||entry.key),status,
          originalCenter:bounds.getCenter(new THREE.Vector3()),
          local
        });
      }
      // Explode only the temporary *PDF scene*. Never move original Tracker
      // meshes or alter assembly records. Offset each module 5.5% of the
      // full-model diagonal away from the assembly's centre.
      const assembledBox=new THREE.Box3().setFromObject(group);
      if(assembledBox.isEmpty())throw Error('Rhino overview contains no visible geometry.');
      const assembledCenter=assembledBox.getCenter(new THREE.Vector3());
      const assembledDiagonal=Math.max(assembledBox.getSize(new THREE.Vector3()).length(),.01);
      const explodeDistance=assembledDiagonal*.055;
      for(let i=0;i<anchors.length;i++){
        const item=anchors[i];
        const dx=item.originalCenter.x-assembledCenter.x;
        const dy=item.originalCenter.y-assembledCenter.y;
        const dz=item.originalCenter.z-assembledCenter.z;
        let ux=dx,uy=dy,uz=dz*.58;
        const length=Math.hypot(ux,uy,uz);
        if(length<assembledDiagonal*.002){
          // Two coincident module centres still need distinct directions.
          const theta=i*2.399963229728653;
          ux=Math.cos(theta);uy=Math.sin(theta);uz=.24;
        }else{
          ux/=length;uy/=length;uz/=length;
        }
        const norm=Math.hypot(ux,uy,uz)||1;
        item.local.position.set(
          (ux/norm)*explodeDistance,
          (uy/norm)*explodeDistance,
          (uz/norm)*explodeDistance
        );
        item.local.updateMatrixWorld(true);
        // Recompute after explosion, so the printed label points to the actual
        // shifted module rather than its original assembly location.
        item.center=new THREE.Box3().setFromObject(item.local)
          .getCenter(new THREE.Vector3());
      }
      const bbox=new THREE.Box3().setFromObject(group);
      if(bbox.isEmpty())throw Error('Exploded Rhino overview contains no visible geometry.');
      const center=bbox.getCenter(new THREE.Vector3());
      const diagonal=Math.max(bbox.getSize(new THREE.Vector3()).length(),.01);
      const direction=new THREE.Vector3(1.3,-1.65,1.04).normalize();
      const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,diagonal*12);
      camera.up.set(0,0,1);
      camera.position.copy(center).addScaledVector(direction,diagonal*2.4);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      const boxPoints=[];
      for(const ix of [bbox.min.x,bbox.max.x])
        for(const iy of [bbox.min.y,bbox.max.y])
          for(const iz of [bbox.min.z,bbox.max.z])
            boxPoints.push(new THREE.Vector3(ix,iy,iz).applyMatrix4(camera.matrixWorldInverse));
      const xs=boxPoints.map(p=>p.x),ys=boxPoints.map(p=>p.y);
      const modelWidth=Math.max(...xs)-Math.min(...xs);
      const modelHeight=Math.max(...ys)-Math.min(...ys);
      const aspect=width/height;
      const halfH=Math.max(modelHeight/2*1.24,modelWidth/(2*aspect)*1.24,.001);
      camera.left=-halfH*aspect;camera.right=halfH*aspect;
      camera.top=halfH;camera.bottom=-halfH;
      camera.updateProjectionMatrix();
      overviewRenderer.render(scene,camera);
      const labels=anchors.map(part=>{
        const projected=part.center.clone().project(camera);
        return {
          id:part.id,status:part.status,
          u:(projected.x+1)/2,v:(1-projected.y)/2,depth:projected.z
        };
      });
      return {
        canvas:overviewRenderer.domElement,labels,
        dispose(){
          materials.forEach(m=>m.dispose());
          overviewRenderer.dispose();
          overviewRenderer.forceContextLoss?.();
        }
      };
    }catch(error){
      console.warn('3D production overview unavailable:',error);
      materials.forEach(m=>m.dispose());
      overviewRenderer?.dispose();
      overviewRenderer?.forceContextLoss?.();
      return null;
    }
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
    // Up to two recent photos are loaded; the newest is featured as the large site-photo hero.
    // A failed photo never prevents the Rhino render or G-code from appearing.
    if(photos.has(entry.key) && state.client) {
      for(const item of photos.get(entry.key).slice(0,visualPref==='simple'?1:2)) {
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
    if(visualPref!=='simple' && path.startsWith(state.projectId+'/') && state.client){
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
    busy=true;cancelled=false;download.disabled=true;scope.disabled=true;format.disabled=true;
    const simple=format.value==='simple';
    cover.disabled=true;datesOption.disabled=true;
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
      const timelineOnly=!simple&&scope.value==='timeline';
      const photos=timelineOnly?new Map():await gatherPhotos(state);
      const pdf=new Class({orientation:'landscape',unit:'mm',format:'a4',
        compress:true,putOnlyUsedFonts:true,precision:4});
      pdf.setProperties({title:simple?'Pavilion Simple Module Catalogue':'Pavilion Fabrication Catalogue',
        subject:simple?'Site photos, fabrication dates, materials and notes':'CAD fabrication module records',author:'Pavilion Fabrication Tracker'});
      let pages=0;
      const next=()=>{
        if(pages)pdf.addPage('a4','landscape');
        pages++;
      };
      if(!simple&&scope.value!=='selected'&&scope.value!=='timeline'&&cover.checked){
        message('Rendering 3D production-status map…',.025);
        let overview=null;
        try {
          overview=captureProductionOverview(state,entries);
          next();
          drawVectorCover(pdf,entries,overview,{
            palette:state.productionPalette||DEFAULT_PRODUCTION_COLORS
          });
        }finally{
          overview?.dispose();
        }
        // Keep the cover focused on a legible colour-coded pavilion model.
        // The register is a dedicated second page (88 rows per page).
        const perRegisterPage=88;
        for(let offset=0;offset<entries.length;offset+=perRegisterPage){
          if(cancelled)throw new Error('Catalogue cancelled.');
          next();
          drawVectorRegister(pdf,entries.slice(offset,offset+perRegisterPage),{
            palette:state.productionPalette||DEFAULT_PRODUCTION_COLORS,
            startIndex:offset,total:entries.length
          });
        }
      }
      if(!simple&&datesOption.checked){
        // The same date groups and colours are used for the 3D scrubber
        // and the native PDF timeline, without changing Tracker state.
        const dated=fabricationDateGroups(entries);
        const groups=[];
        for(let start=0;start<dated.dates.length;start+=27)groups.push(dated.dates.slice(start,start+27));
        if(!groups.length)groups.push([]);
        for(let i=0;i<groups.length;i++){
          if(cancelled)throw new Error('Catalogue cancelled.');
          const days=groups[i];
          message('Rendering fabrication date diagram '+(i+1)+' / '+groups.length+'…',.05);
          let dateOverview=null;
          try{
            dateOverview=captureProductionOverview(state,entries,{
              fabricationCutoff:days.at(-1)?.date||'0000-00-00'
            });
            next();
            drawDatePage(pdf,entries,dateOverview,{
              dateWindow:days,section:i+1,totalSections:groups.length
            });
          }finally{dateOverview?.dispose();}
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      if(!timelineOnly)capture=createIsolatedCapture();
      for(let i=0;!timelineOnly&&i<entries.length;i++){
        if(cancelled)throw new Error('Catalogue cancelled.');
        const entry=entries[i];
        message((simple?'Simple record ':'CAD sheet ')+(i+1)+' / '+entries.length+' · '+clean(entry.record.Object_ID),
          (i+.1)/entries.length);
        const asset=await moduleAssets(state,entry,photos,capture,simple?'simple':'model');
        next();
        if(simple)drawSimpleVectorSheet(pdf,entry,asset,{number:i+1,total:entries.length});
        else drawVectorSheet(pdf,entry,asset,{THREE,number:i+1,total:entries.length});
        for(const img of asset.photos || []) if(img?.close)img.close();
        if(i%2===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(cancelled)throw new Error('Catalogue cancelled.');
      message('Saving '+pages+(simple?' simple':' vector')+' PDF pages…',1);
      const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
      const name=simple
        ? (scope.value==='selected'
          ? 'Pavilion_Simple_Module_'+(entries[0].record.Object_ID||'record').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf'
          : 'Pavilion_Simple_Catalogue_'+(scope.value==='upper'?'Uppercase_':'')+stamp+'.pdf')
        : timelineOnly
        ? 'Pavilion_Fabrication_Timeline_'+stamp+'.pdf'
        : scope.value==='selected'
        ? 'Pavilion_Module_'+(entries[0].record.Object_ID||'record').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf'
        : 'Pavilion_Fabrication_Catalogue_'+(scope.value==='upper'?'Uppercase_':'')+stamp+'.pdf';
      await pdf.save(name,{returnPromise:true});
      message('Saved '+pages+' pages · '+entries.length+' modules · '+(simple?'simple records':'vector CAD')+'.',1);
      notify?.((simple?'Simple PDF ready · ':'Vector PDF ready · ')+(timelineOnly?'fabrication timeline':entries.length+' module sheets')+'.');
    }catch(error){
      message(error?.message||'Could not generate the catalogue PDF.');
      if(!cancelled)notify?.('Catalogue PDF failed: '+(error?.message||error),true);
    }finally{
      capture?.dispose();
      busy=false;cancelled=false;
      download.disabled=false;scope.disabled=false;format.disabled=false;
      syncOptions();
      download.textContent=original;
    }
  });

  return {open,downloadTimeline(){
    if(busy)return;
    open('timeline');
    download.click();
  }};
}
