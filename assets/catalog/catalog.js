/* Pavilion Fabrication Catalogue — CAD-style A4 landscape PDF.
 * Runs entirely in the visitor's browser; does not mutate Tracker records.
 * Module records come from shared Supabase (fallback: current Rhino/Tracker).
 * One image-rich technical sheet per module, optional summary cover.
 */
export function setupCatalog({ THREE, getState, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML =
    '<div class="catalog-shell">' +
      '<div class="catalog-head"><span class="catalog-kicker">PAVILION / DOCUMENTATION</span>' +
      '<button type="button" class="catalog-close" aria-label="Close">×</button></div>' +
      '<h2>Fabrication Catalogue</h2>' +
      '<p class="catalog-lead">A4 landscape · one CAD-style fabrication record per module · photographs, toolpaths and model drawings.</p>' +
      '<label class="catalog-field">PAGES' +
        '<select class="catalog-scope"><option value="all">Full catalogue / all modules</option>' +
        '<option value="selected">Selected module / one sheet</option></select></label>' +
      '<label class="catalog-field">MAIN VISUAL' +
        '<select class="catalog-media"><option value="auto">Auto / photo → G-code → 3D</option>' +
        '<option value="photo">Photograph first</option>' +
        '<option value="gcode">G-code toolpath first</option>' +
        '<option value="model">Isolated Rhino 3D first</option></select></label>' +
      '<label class="catalog-check"><input class="catalog-cover" type="checkbox" checked>' +
        '<span>Include overview / cover page in full catalogue</span></label>' +
      '<p class="catalog-footnote">Reads current shared data. Blank fields are marked —. G-code preview shows XY linear moves (G0/G1); it does not replace machine simulation.</p>' +
      '<div class="catalog-progress" hidden><div class="catalog-track"><div class="catalog-progress-fill"></div></div>' +
        '<span class="catalog-status" role="status" aria-live="polite"></span></div>' +
      '<div class="catalog-actions"><button type="button" class="catalog-cancel">Cancel</button>' +
        '<button type="button" class="catalog-download">Download PDF ↗</button></div>' +
    '</div>';
  document.body.append(dialog);

  const $ = s => dialog.querySelector(s);
  const scope = $('.catalog-scope');
  const media = $('.catalog-media');
  const cover = $('.catalog-cover');
  const progress = $('.catalog-progress');
  const progressFill = $('.catalog-progress-fill');
  const status = $('.catalog-status');
  const download = $('.catalog-download');
  const cancel = $('.catalog-cancel');
  let busy = false, cancelled = false;
  let previousScope = 'all';

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
  const compareIds = (a,b) => String(a.record.Object_ID || '')
    .localeCompare(String(b.record.Object_ID || ''), undefined,
      {numeric: true, sensitivity:'variant', caseFirst:'upper'});

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
    const partById = new Map((state.parts || []).map(part => [String(part.key),part]));
    const all = new Map();
    for (const [key, record] of Object.entries(state.records || {})) {
      all.set(String(key), {key:String(key), record:{...record}, part:partById.get(String(key))});
    }
    if (state.client && state.liveMode) {
      const response = await state.client.from('pavilion_parts')
        .select('*').eq('project_id',state.projectId).range(0, 1999);
      if (response.error) throw new Error('Shared module data unavailable: ' + response.error.message);
      for (const row of response.data || []) {
        const key = String(row.rhino_guid || '');
        if (!key) continue;
        const existing = all.get(key);
        all.set(key,{
          key,
          part:partById.get(key),
          record:{...(existing?.record || {}), ...mapCloud(row,state.dbMap)}
        });
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
      if (key && !photos.has(key)) photos.set(key,item);
    }
    return photos;
  }
  function buildCanvas(width = 1700,height = 1202) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  function wrapped(ctx,text,width,maxLines=Infinity) {
    const source = clean(text);
    const lines = [];
    const paragraphs = source.split(/\r?\n/);
    for (const paragraph of paragraphs) {
      let row = '';
      // Break by whitespace, but also support very long paths/Korean strings.
      for (const token of (paragraph.match(/\S+|\s+/g) || [''])) {
        const candidate = row + token;
        if (ctx.measureText(candidate).width <= width) { row=candidate; continue; }
        if (row.trim()) { lines.push(row.trim()); row=''; }
        for (const character of token) {
          if (ctx.measureText(row + character).width > width && row) {
            lines.push(row); row='';
          }
          row += character;
        }
      }
      if (row.trim()) lines.push(row.trim());
      else if (!paragraph) lines.push('');
    }
    return { lines:lines.slice(0,maxLines), total:lines.length };
  }
  function stroke(ctx,x,y,w,h,color='#d4d4ce') {
    ctx.strokeStyle=color; ctx.lineWidth=1;
    ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  }
  function drawFit(ctx,source,x,y,w,h,bg='#f0f0eb') {
    ctx.fillStyle=bg; ctx.fillRect(x,y,w,h);
    const sw=source.width || source.videoWidth || 1;
    const sh=source.height || source.videoHeight || 1;
    const scale=Math.min(w / sw,h / sh);
    const iw=sw * scale, ih=sh * scale;
    ctx.drawImage(source,x+(w-iw)/2,y+(h-ih)/2,iw,ih);
  }
  function label(ctx,value,x,y,color='#7d7e78') {
    ctx.font='600 12px "IBM Plex Mono",monospace';
    ctx.fillStyle=color; ctx.fillText(value,x,y);
  }
  function text(ctx,value,x,y,size=18,weight=500,color='#292c29') {
    ctx.font=weight+' '+size+'px Inter,Arial,sans-serif';
    ctx.fillStyle=color; ctx.fillText(clean(value),x,y);
  }
  function truncate(ctx,value,width) {
    let valueText=clean(value);
    if (ctx.measureText(valueText).width<=width) return valueText;
    while(valueText.length>1 && ctx.measureText(valueText+'…').width>width) {
      valueText=valueText.slice(0,-1);
    }
    return valueText+'…';
  }
  function techCell(ctx,x,y,w,key,val) {
    ctx.font='600 10px "IBM Plex Mono",monospace';
    ctx.fillStyle='#85877f'; ctx.fillText(key.toUpperCase(),x,y);
    ctx.font='500 15px Inter,Arial,sans-serif';
    ctx.fillStyle='#191d1b';
    ctx.fillText(truncate(ctx,val,w-12),x,y+18);
  }
  function drawSection(ctx,x,y,title,pairs,width=500) {
    const gap=14;
    ctx.fillStyle='#30342f'; ctx.fillRect(x,y,width,2);
    label(ctx,title,x,y+19,'#393e38');
    let py=y+37;
    const cellWidth=(width-gap)/2;
    for(let i=0;i<pairs.length;i+=2) {
      const [k1,v1]=pairs[i];
      techCell(ctx,x,py,cellWidth,k1,v1);
      if(pairs[i+1]){
        const [k2,v2]=pairs[i+1];
        techCell(ctx,x+cellWidth+gap,py,cellWidth,k2,v2);
      }
      py+=31;
    }
    return py+8;
  }
  function drawLong(ctx,title,value,x,y,width,maxLines) {
    label(ctx,title,x,y);
    ctx.font='400 19px Inter,Arial,sans-serif';
    ctx.fillStyle='#30322d';
    const items=wrapped(ctx,value,width,maxLines);
    items.lines.forEach((line,i) => ctx.fillText(line,x,y+30+25*i));
    if(items.total>maxLines) {
      label(ctx,'CONTINUED ↗',x+650,y,'#9a8562');
    }
    return items.total>maxLines;
  }
  function drawGrid(ctx,x,y,w,h) {
    ctx.save();
    ctx.fillStyle='#f6f6f2'; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#e8e8e2'; ctx.lineWidth=1;
    for(let ix=x;ix<=x+w;ix+=38){ ctx.beginPath();ctx.moveTo(ix,y);ctx.lineTo(ix,y+h);ctx.stroke(); }
    for(let iy=y;iy<=y+h;iy+=38){ ctx.beginPath();ctx.moveTo(x,iy);ctx.lineTo(x+w,iy);ctx.stroke(); }
    ctx.restore();
  }
  function footer(ctx,sheet,total,record) {
    ctx.fillStyle='#d0d0ca';ctx.fillRect(56,988,1378,2);
    label(ctx,'SOIL-BASED PAVILION / FABRICATION RECORD',56,1017);
    label(ctx,'RHINO ID  '+clean(record?.Rhino_GUID).slice(0,42),480,1017);
    label(ctx,'ISSUED  '+new Date().toISOString().slice(0,10),1040,1017);
    label(ctx,'SHEET  '+sheet+' / '+total,1260,1017,'#343a36');
  }
  function drawSheet(entry,mediaResult,i,total) {
    const record=entry.record;
    const canvas=buildCanvas();
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.save();ctx.scale(canvas.width/1490,canvas.height/1050);
    ctx.fillStyle='#fbfbf8';ctx.fillRect(0,0,1490,1050);
    label(ctx,'PAVILION  /  FABRICATION CATALOGUE',56,66,'#555a55');
    label(ctx,'MODULE RECORD  /  '+String(i).padStart(3,'0'),1016,66);
    ctx.fillStyle='#252a27';ctx.font='600 54px Syne,Inter,Arial,sans-serif';
    ctx.fillText(truncate(ctx,record.Object_ID || 'UNNAMED MODULE',950),56,137);
    ctx.fillStyle='#bdbaa9';ctx.fillRect(56,164,1378,2);

    const vx=56,vy=186,vw=805,vh=557;
    drawGrid(ctx,vx,vy,vw,vh);
    if(mediaResult && mediaResult.canvas) drawFit(ctx,mediaResult.canvas,vx+15,vy+15,vw-30,vh-30);
    else {
      ctx.fillStyle='#bbbcb2';ctx.font='500 24px Inter,Arial,sans-serif';
      ctx.fillText('IMAGE / G-CODE / MODEL NOT AVAILABLE',vx+70,vy+vh/2);
    }
    stroke(ctx,vx,vy,vw,vh);
    label(ctx,'01  /  '+(mediaResult?.kind || 'MODULE DOCUMENTATION'),vx,774);
    ctx.font='400 15px Inter,Arial,sans-serif';ctx.fillStyle='#77796f';
    ctx.fillText(truncate(ctx,mediaResult?.note || 'Produced from live fabrication records',790),vx,801);

    // CAD data table: fixed groups and paired values; all numeric parameters.
    let y=186;
    const rightX=894,rightW=540;
    y=drawSection(ctx,rightX,y,'01   IDENTITY',[
      ['MODULE NO.',fieldValue(record,'Module_No')],['LEVEL',fieldValue(record,'Level')],
      ['SEQUENCE',fieldValue(record,'Sequence')],['ASSIGNED TO',fieldValue(record,'Assigned_To')]
    ],rightW);
    y=drawSection(ctx,rightX,y,'02   MATERIAL / FABRICATION',[
      ['METHOD',fieldValue(record,'Manufacturing_Method')],['MACHINE',fieldValue(record,'Machine')],
      ['MATERIAL',fieldValue(record,'Material')],['WEIGHT (KG)',fieldValue(record,'Weight_kg')],
      ['INFILL',fieldValue(record,'Infill_Pattern')],['DENSITY (%)',fieldValue(record,'Infill_Density_pct')]
    ],rightW);
    y=drawSection(ctx,rightX,y,'03   QUALITY / STATUS',[
      ['STRUCTURE',fieldValue(record,'Structural_Status')],['READY',fieldValue(record,'Ready_for_Production')],
      ['PRODUCTION',fieldValue(record,'Production_Status')],['DRYING / QC',fieldValue(record,'Drying_QC_Status')],
      ['ASSEMBLY',fieldValue(record,'Construction_Status')],['OVERALL',fieldValue(record,'Overall_Status')]
    ],rightW);
    y=drawSection(ctx,rightX,y,'04   MACHINE SETTINGS',[
      ['MOTOR (STEPS/S)',fieldValue(record,'Motor_Speed')],['MANUAL ADJ. (%)',fieldValue(record,'Motor_Speed_Manual_Adjustment_pct')],
      ['AIR PRESS. (BAR)',fieldValue(record,'Air_Pressure_bar')],['FIRST LAYER (MM)',fieldValue(record,'First_Layer_Height_mm')],
      ['LAYER HEIGHT',fieldValue(record,'Layer_Height_mm')],['DURATION (MIN)',fieldValue(record,'Print_Duration_min')]
    ],rightW);
    y=drawSection(ctx,rightX,y,'05   STRUCTURE / FIRING',[
      ['FORCE (KN)',fieldValue(record,'Compression_Force_kN')],['ROUTE',fieldValue(record,'Firing_Route')],
      ['FIRING STATUS',fieldValue(record,'Firing_Status')],['KILN',fieldValue(record,'Firing_Kiln')],
      ['BATCH',fieldValue(record,'Firing_Batch')],['PEAK TEMP (C)',fieldValue(record,'Firing_Peak_Temp_C')],
      ['DATE',fieldValue(record,'Firing_Date')],['SHRINKAGE (%)',fieldValue(record,'Firing_Shrinkage_pct')],
      ['BEFORE (MM)',fieldValue(record,'Firing_Dimension_Before_mm')],['AFTER (MM)',fieldValue(record,'Firing_Dimension_After_mm')]
    ],rightW);
    // Complete source references are also repeated without truncation
    // on a continuation sheet when they are long.
    label(ctx,'G-CODE / '+truncate(ctx,record.GCode_File,485),rightX,921);
    label(ctx,'FIRING PROGRAM / '+truncate(ctx,record.Firing_Program,440),rightX,940);
    label(ctx,'UPDATED / '+prettyDate(record.Last_Updated)+'  BY '+truncate(ctx,record.Updated_By,180),rightX,963);

    ctx.fillStyle='#d2d2ca';ctx.fillRect(56,821,805,1);
    const extra1=drawLong(ctx,'MATERIAL COMPOSITION / RECIPE',record.Material_Details,56,847,790,2);
    const extra2=drawLong(ctx,'FABRICATION NOTES',record.Notes,56,927,790,1);
    footer(ctx,i,total,record);
    ctx.restore();
    return {canvas,hasOverflow:extra1||extra2 ||
      ['Firing_Program','GCode_File','Rhino_Object_Name','Material',
       'Infill_Pattern','Assigned_To','Updated_By'].some(key=>clean(record[key]).length>45)};
  }

  function drawAppendixPages(entry,i,total) {
    const r=entry.record;
    const blocks=[
      ['RHINO OBJECT NAME',r.Rhino_Object_Name],
      ['FULL RHINO GUID',r.Rhino_GUID],
      ['MATERIAL / SPECIFICATION',r.Material],
      ['MATERIAL COMPOSITION / MIX',r.Material_Details],
      ['FABRICATION NOTES',r.Notes],
      ['ASSIGNED TO',r.Assigned_To],
      ['FIRING PROGRAM',r.Firing_Program],
      ['G-CODE FILE / REFERENCE',r.GCode_File],
      ['OTHER DETAILS','Module '+clean(r.Module_No)+' / '+clean(r.Manufacturing_Method)]
    ];
    const pages=[];
    let canvas,ctx,y=200;
    const start=()=>{
      canvas=buildCanvas();
      ctx=canvas.getContext('2d',{alpha:false});
      ctx.save();ctx.scale(canvas.width/1490,canvas.height/1050);
      ctx.fillStyle='#fbfbf8';ctx.fillRect(0,0,1490,1050);
      label(ctx,'PAVILION  /  FABRICATION CATALOGUE',56,67);
      ctx.fillStyle='#262b27';ctx.font='600 47px Syne,Inter,Arial,sans-serif';
      ctx.fillText(truncate(ctx,clean(r.Object_ID)+' / ADDITIONAL DATA',1335),56,136);
      ctx.fillStyle='#cfcec5';ctx.fillRect(56,162,1378,2);
      y=200;
    };
    const finish=()=>{
      footer(ctx,i,total,r);
      ctx.restore();
      pages.push(canvas);
    };
    start();
    for(const [heading,raw] of blocks) {
      ctx.font='400 19px Inter,Arial,sans-serif';
      const lines=wrapped(ctx,raw,1325,Infinity).lines;
      if(y+65>953){ finish();start(); }
      label(ctx,heading,56,y);
      y+=38;
      ctx.font='400 19px Inter,Arial,sans-serif';
      ctx.fillStyle='#2f312c';
      for(const line of lines) {
        if(y+27>959) {
          finish();start();
          label(ctx,heading+' / CONTINUED',56,y);
          y+=38;
        }
        ctx.fillText(line,56,y);
        y+=29;
      }
      y+=31;
    }
    finish();
    return pages;
  }
  function drawCover(all,photoCount,gcodeCount) {
    const canvas=buildCanvas();
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.save();ctx.scale(canvas.width/1490,canvas.height/1050);
    ctx.fillStyle='#fafaf6';ctx.fillRect(0,0,1490,1050);
    ctx.strokeStyle='#d2d3ce';ctx.lineWidth=1;
    for(let x=58;x<1430;x+=84){ctx.beginPath();ctx.moveTo(x,64);ctx.lineTo(x,971);ctx.stroke();}
    ctx.fillStyle='#fafaf6';ctx.fillRect(54,55,1382,845);
    label(ctx,'TU DELFT  /  SOIL-BASED PAVILION',58,94);
    label(ctx,'FABRICATION  /  PRODUCTION RECORDS',1050,94);
    ctx.fillStyle='#232823';ctx.font='600 91px Syne,Inter,Arial,sans-serif';
    ctx.fillText('FABRICATION',58,288);
    ctx.fillText('CATALOGUE',58,388);
    ctx.fillStyle='#b2aa94';ctx.fillRect(58,448,1358,3);
    const printing=all.filter(x=>x.record.Manufacturing_Method==='3D Printing').length;
    const rammed=all.filter(x=>x.record.Manufacturing_Method==='Rammed Earth').length;
    const overview=[
      ['TOTAL RECORDS',all.length],['3D PRINTING',printing],['RAMMED EARTH',rammed],
      ['PHOTOS',photoCount],['G-CODE LINKS',gcodeCount]
    ];
    overview.forEach(([k,v],i)=>{
      const x=58+i*272;
      label(ctx,k,x,528);
      ctx.fillStyle='#202421';ctx.font='600 51px Syne,Inter,Arial,sans-serif';
      ctx.fillText(String(v),x,598);
    });
    label(ctx,'DOCUMENT INDEX / MODULE IDS',58,694);
    ctx.font='400 16px "IBM Plex Mono",monospace';ctx.fillStyle='#767770';
    const idEntries=all.slice(0,105);
    idEntries.forEach((entry,n)=>{
      const row=Math.floor(n/10),col=n%10;
      const id=clean(entry.record.Object_ID).slice(0,14);
      ctx.fillText(id,58+col*136,730+row*20);
    });
    if(all.length>105)label(ctx,'+ '+(all.length-105)+' ADDITIONAL RECORDS',58,960);
    ctx.fillStyle='#c3c4bd';ctx.fillRect(58,988,1358,2);
    label(ctx,'SOURCE  /  PAVILION FABRICATION TRACKER · SHARED MODULE RECORDS',58,1017);
    label(ctx,'ISSUED  '+new Date().toISOString().slice(0,10),1130,1017);
    ctx.restore();
    return canvas;
  }
  function createIsolatedCapture() {
    let renderer=null;
    const material=new THREE.MeshStandardMaterial({
      color:0xcac0a9,roughness:0.94,metalness:0,side:THREE.DoubleSide
    });
    try {
      renderer=new THREE.WebGLRenderer({ antialias:true,preserveDrawingBuffer:true,alpha:false });
      renderer.setPixelRatio(1);
      renderer.setSize(1130,780,false);
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
      const camera=new THREE.PerspectiveCamera(32,1130/780,0.01,Math.max(10000,radius*60));
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
  function gcodePreview(source) {
    const segments=[], maxSegments=65000;
    let x=0,y=0,relative=false;
    for(const raw of source.split(/\r?\n/)){
      if(segments.length>=maxSegments)break;
      const line=raw.split(';')[0].replace(/\(.*?\)/g,'').trim().toUpperCase();
      if(!line)continue;
      if(/(?:^|\s)G90(?:\s|$)/.test(line)){ relative=false;continue; }
      if(/(?:^|\s)G91(?:\s|$)/.test(line)){ relative=true;continue; }
      if(/(?:^|\s)G92(?:\s|$)/.test(line)){const mx=line.match(/X\s*(-?\d+(?:\.\d+)?)/);const my=line.match(/Y\s*(-?\d+(?:\.\d+)?)/);if(mx)x=Number(mx[1]);if(my)y=Number(my[1]);continue;}
      const motion=line.match(/(?:^|\s)G0?([01])(?:\s|$)/);
      if(!motion)continue;
      const mx=line.match(/(?:^|\s)X\s*(-?(?:\d+\.?\d*|\.\d+))/);
      const my=line.match(/(?:^|\s)Y\s*(-?(?:\d+\.?\d*|\.\d+))/);
      if(!mx&&!my)continue;
      const nx=mx?(relative?x+Number(mx[1]):Number(mx[1])):x;
      const ny=my?(relative?y+Number(my[1]):Number(my[1])):y;
      if(Number.isFinite(nx)&&Number.isFinite(ny)){
        if(Math.hypot(nx-x,ny-y)>0.0001)segments.push({x,y,nx,ny,travel:motion[1]==='0'});
        x=nx;y=ny;
      }
    }
    if(!segments.length)return null;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const p of segments){
      minX=Math.min(minX,p.x,p.nx);maxX=Math.max(maxX,p.x,p.nx);
      minY=Math.min(minY,p.y,p.ny);maxY=Math.max(maxY,p.y,p.ny);
    }
    const canvas=buildCanvas(1130,750),ctx=canvas.getContext('2d',{alpha:false});
    drawGrid(ctx,0,0,1130,750);
    const w=Math.max(maxX-minX,0.1),h=Math.max(maxY-minY,0.1);
    const scale=Math.min(1010/w,625/h);
    const ox=(1130-w*scale)/2,oy=(750-h*scale)/2;
    const px=x=>ox+(x-minX)*scale;
    const py=y=>750-(oy+(y-minY)*scale);
    ctx.lineWidth=1.15;ctx.strokeStyle='#424b45';
    ctx.beginPath();
    for(const p of segments) {
      if(p.travel){ctx.moveTo(px(p.nx),py(p.ny));continue;}
      ctx.moveTo(px(p.x),py(p.y));ctx.lineTo(px(p.nx),py(p.ny));
    }
    ctx.stroke();
    ctx.font='14px "IBM Plex Mono",monospace';
    ctx.fillStyle='#777c73';ctx.fillText('XY / TOOLPATH PROJECTION',30,40);
    ctx.fillText('X '+w.toFixed(1)+'  /  Y '+h.toFixed(1)+' mm',30,68);
    return canvas;
  }
  async function photoVisual(client,bucket,item) {
    if(!client || !item?.storage_path)return null;
    const {data,error}=await client.storage.from(bucket).download(item.storage_path);
    if(error || !data)throw error || new Error('No image');
    const image=await createImageBitmap(data);
    return {canvas:image,kind:'SITE PHOTO / FABRICATION',note:item.note || ''};
  }
  async function gcodeVisual(state,record) {
    const path=String(record.GCode_File||'').trim();
    if(!path.startsWith(state.projectId+'/') || !state.client)return null;
    const {data,error}=await state.client.storage.from(state.gcodeBucket).download(path);
    if(error || !data)throw error || new Error('No G-code');
    // Limit parsing to first 5 MB; huge machine jobs should not freeze the browser.
    const preview=gcodePreview(await data.slice(0,5*1024*1024).text());
    return preview?{canvas:preview,kind:'G-CODE / XY TOOLPATH PREVIEW',
      note:path.split('/').pop().replace(/^\d+_/,'')}:null;
  }
  async function visualFor(state,entry,photos,preference,capture) {
    const routes=preference==='gcode'?['gcode','photo','model']:
      preference==='model'?['model','photo','gcode']:
      ['photo','gcode','model'];
    for(const kind of routes) {
      try {
        if(kind==='photo' && photos.has(entry.key)) {
          const visual=await photoVisual(state.client,state.photoBucket,photos.get(entry.key));
          if(visual)return visual;
        }
        if(kind==='gcode') {
          const visual=await gcodeVisual(state,entry.record);
          if(visual)return visual;
        }
        if(kind==='model') {
          const source=capture?.render(entry.part);
          if(source)return {canvas:source,kind:'ISOLATED RHINO GEOMETRY / AXONOMETRIC',
            note:'Single module from the live 3D model'};
        }
      } catch(error) {
        console.warn('Catalogue '+kind+' unavailable for '+entry.key+':',error);
      }
    }
    return null;
  }
  download.addEventListener('click',async()=>{
    if(busy)return;
    const pdfClass=window.jspdf?.jsPDF;
    if(!pdfClass){
      message('PDF export library not loaded. Check your connection and refresh.');
      return;
    }
    busy=true;cancelled=false;download.disabled=true;scope.disabled=true;media.disabled=true;
    cover.disabled=true;
    const originally=download.textContent;
    download.textContent='Generating…';
    let capture;
    try {
      const state=getState();
      message('Reading fabrication records…',0);
      const all=await gatherRecords(state);
      let entries=all;
      if(scope.value==='selected'){
        entries=all.filter(entry=>entry.key===String(state.selectedKey));
      }
      if(!entries.length)throw new Error('No modules found. Load the Rhino model or sync shared data first.');
      const photos=await gatherPhotos(state);
      const pdf=new pdfClass({
        orientation:'landscape',unit:'mm',format:'a4',
        compress:true,putOnlyUsedFonts:true
      });
      pdf.setProperties({
        title:'Pavilion Fabrication Catalogue',
        subject:'Soil-based pavilion - module production records',
        author:'Pavilion Fabrication Tracker'
      });
      let page=0,hasFirst=false;
      const appendCanvas=(canvas)=>{
        if(hasFirst)pdf.addPage('a4','landscape');
        const image=canvas.toDataURL('image/jpeg',0.79);
        pdf.addImage(image,'JPEG',0,0,297,210,undefined,'FAST');
        hasFirst=true;page++;
      };
      if(scope.value==='all' && cover.checked){
        appendCanvas(drawCover(entries,photos.size,
          entries.filter(e=>String(e.record.GCode_File||'').trim()).length));
      }
      // Only make a second WebGL context if needed.
      capture=createIsolatedCapture();
      for(let i=0;i<entries.length;i++){
        if(cancelled)throw new Error('Catalogue cancelled.');
        const entry=entries[i];
        message('Sheet '+(i+1)+' / '+entries.length+
          ' · '+clean(entry.record.Object_ID), i/entries.length);
        const image=await visualFor(state,entry,photos,media.value,capture);
        const sheet=drawSheet(entry,image,i+1,entries.length);
        appendCanvas(sheet.canvas);
        if(sheet.hasOverflow) {
          for(const additional of drawAppendixPages(entry,i+1,entries.length)) {
            appendCanvas(additional);
          }
        }
        if(image?.canvas && typeof image.canvas.close==='function')image.canvas.close();
        // Yield to the UI: 100+ images must not monopolize the main thread.
        if(i%3===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(cancelled)throw new Error('Catalogue cancelled.');
      message('Saving '+page+' PDF pages…',1);
      const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
      const name=scope.value==='selected'
        ? 'Pavilion_Module_'+(entries[0].record.Object_ID||'record').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf'
        : 'Pavilion_Fabrication_Catalogue_'+stamp+'.pdf';
      await pdf.save(name,{returnPromise:true});
      message('Saved '+page+' PDF pages · '+entries.length+' module records.',1);
      notify?.('Catalogue PDF ready · '+entries.length+' modules.');
    } catch(error) {
      message(error.message || 'Could not generate PDF.');
      if(!cancelled)notify?.('Catalogue PDF failed: '+(error.message || error),true);
    } finally {
      capture?.dispose();
      busy=false;cancelled=false;
      download.disabled=false;scope.disabled=false;media.disabled=false;
      cover.disabled=scope.value==='selected';
      download.textContent=originally;
    }
  });
  return {open};
}
