/* Material Mix quick editor for pavilion fabrication tracker.
   Presets reflect already-recorded Supabase values (October 2026), NOT unverified Excel rows.
   Zero automatic database edits: applies only by user confirmation. */
(function () {
  'use strict';

  const PRINT_KEYS=['Red clay','Yellow clay','Grey clay','Zilverzand','Chamotte','Sawdust','Water'];
  const RAMMED_KEYS=['Grey clay','Yellow clay','Zilverzand','Metselzand','Betonmix','Stones','Water'];
  const COLORS={
    'Red clay':'#a17860','Yellow clay':'#c2a182','Grey clay':'#88867d',
    'Zilverzand':'#d0c4b1','Chamotte':'#ae9477','Sawdust':'#c6ad83',
    'Water':'#a5b3b3','Metselzand':'#c1aa8d','Betonmix':'#8e857b',
    'Stones':'#696762'
  };
  const mix=(label,values)=>({label:label,values:Object.assign({},values)});
  const P=[
    {id:'yellow-375',group:'print',name:'Yellow clay · 37.5 / 41 / 20',material:'Yellow Clay',batches:[mix('Mix',{'Yellow clay':37.5,'Zilverzand':41,'Chamotte':20,'Sawdust':1.5,'Water':16.7})]},
    {id:'yellow-380',group:'print',name:'Yellow clay · 38 / 41.6 / 18.8',material:'Yellow Clay',batches:[mix('Mix',{'Yellow clay':38,'Zilverzand':41.6,'Chamotte':18.8,'Sawdust':1.5,'Water':18.3})]},
    {id:'grey-375',group:'print',name:'Grey clay · 37.5 / 41 / 20',material:'Grey Clay',batches:[mix('Mix',{'Grey clay':37.5,'Zilverzand':41,'Chamotte':20,'Sawdust':1.5,'Water':16.7})]},
    {id:'mixed-50',group:'print',name:'Mixed clay · equal yellow / grey',material:'Mixed Clay',batches:[mix('Mix',{'Yellow clay':18.8,'Grey clay':18.8,'Zilverzand':41,'Chamotte':20,'Sawdust':1.5,'Water':16.7})]},
    {id:'mixed-75',group:'print',name:'Mixed clay · 28 grey / 9.3 yellow',material:'Mixed Clay',batches:[mix('Mix',{'Grey clay':28,'Yellow clay':9.3,'Zilverzand':41.1,'Chamotte':20.1,'Sawdust':1.5,'Water':16.7})]},
    {id:'normal',group:'print',name:'NORMAL CLAY · ready-made printing clay',material:'Normal Clay',kind:'ready'},
    {id:'custom-print',group:'print',name:'Custom 3D printing mix · from zero',material:'Custom Clay Mix',batches:[mix('Mix',{})]},
    {id:'rammed-a',group:'rammed',name:'Rammed Earth · Mix 1 + Mix 2 (recorded A)',material:'Rammed Earth Mix',batches:[
      mix('*Mix 1',{'Grey clay':19.4,'Yellow clay':4.8,'Zilverzand':9.7,'Metselzand':14.5,'Betonmix':19.4,'Stones':29,'Water':3.2}),
      mix('*Mix 2',{'Yellow clay':24.3,'Zilverzand':9.7,'Metselzand':14.6,'Betonmix':19.4,'Stones':29.2,'Water':2.8})]},
    {id:'rammed-b',group:'rammed',name:'Rammed Earth · Mix 1 + Mix 2 (recorded B)',material:'Rammed Earth Mix',batches:[
      mix('*Mix 1',{'Grey clay':21,'Yellow clay':5.3,'Zilverzand':9.3,'Metselzand':14,'Betonmix':18.7,'Stones':28,'Water':3.7}),
      mix('*Mix 2',{'Yellow clay':24,'Zilverzand':9.6,'Metselzand':14.4,'Betonmix':19.2,'Stones':28.8,'Water':4})]},
    {id:'rammed-one',group:'rammed',name:'Rammed Earth · Mix 1 only',material:'Rammed Earth Mix',batches:[
      mix('Mix',{'Grey clay':19.4,'Yellow clay':4.8,'Zilverzand':9.7,'Metselzand':14.5,'Betonmix':19.4,'Stones':29,'Water':3.2})]},
    {id:'rammed-two',group:'rammed',name:'Rammed Earth · Mix 2 only',material:'Rammed Earth Mix',batches:[
      mix('Mix',{'Yellow clay':24.3,'Zilverzand':9.7,'Metselzand':14.6,'Betonmix':19.4,'Stones':29.2,'Water':2.8})]},
    {id:'custom-rammed',group:'rammed',name:'Custom rammed mix · from zero',material:'Rammed Earth Mix',batches:[mix('Mix',{})]}
  ];
  let active=null,overlay=null,previousFocus=null;

  const clone=x=>JSON.parse(JSON.stringify(x));
  const el=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=text;
    return n;
  };
  const cleanNumber=n=>{
    const v=Number(n);
    return Number.isFinite(v)?Math.max(0,Math.min(100,Math.round(v*10)/10)):0;
  };
  const formatNumber=n=>Number(n).toFixed(1);
  const normKey=s=>{
    const v=String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
    const aliases={
      'gray clay':'Grey clay','grey clay':'Grey clay',
      'red clay':'Red clay','yellow clay':'Yellow clay',
      'silverzand':'Zilverzand','zilverzand':'Zilverzand',
      'chamotte':'Chamotte','sawdust':'Sawdust','water':'Water',
      'metselzand':'Metselzand','betonmix':'Betonmix','stones':'Stones'
    };
    return aliases[v]||null;
  };
  function parseSaved(details,material){
    const raw=String(details||'');
    if(!raw.trim()){
      if(/^(normal|regular)\s*clay$/i.test(String(material||'').trim()))
        return {kind:'ready'};
      return {kind:'empty'};
    }
    if(/^(normal|regular)\s*clay$/i.test(raw.trim()) || /commercial premixed.*3d.print/i.test(raw))
      return {kind:'ready'};
    const batches=[], lines=raw.replace(/\r\n?/g,'\n').split('\n');
    let batch=mix('Mix',{}), unknown=false;
    lines.forEach(line=>{
      const v=line.trim();
      if(!v)return;
      if(/^(?:\*?\s*Mix\s*\d+|(?:First|Last)\s+\d+(?:\.\d+)?\s*%)$/i.test(v)){
        if(Object.keys(batch.values).length)batches.push(batch);
        batch=mix(v,{});
        return;
      }
      const m=v.match(/^([^:]+?)\s*:\s*(\d+(?:\.\d+)?)\s*%\s*$/);
      const name=m?normKey(m[1]):null;
      if(!name){unknown=true;return;}
      batch.values[name]=cleanNumber(m[2]);
    });
    if(Object.keys(batch.values).length)batches.push(batch);
    if(unknown||!batches.length)return {kind:'raw',raw:raw};
    return {kind:'recipe',batches:batches};
  }
  function recipeText(draft){
    if(draft.kind==='ready')return 'Normal Clay — commercial premixed 3D-printing mix';
    if(draft.kind==='raw')return draft.raw||'';
    if(draft.kind!=='recipe')return '';
    return draft.batches.map((batch,i)=>{
      const values=Object.entries(batch.values||{}).filter(([k,v])=>cleanNumber(v)>0);
      const lines=values.map(([k,v])=>k+' : '+formatNumber(v)+'%');
      if(!lines.length)return '';
      const head=draft.batches.length>1?(batch.label||'*Mix '+(i+1)):'';
      return [head,...lines].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n');
  }
  function summary(record){
    const detail=String(record.Material_Details||'');
    if(!detail.trim())return 'No percentages recorded · choose a mix';
    const parsed=parseSaved(detail,record.Material);
    if(parsed.kind==='ready')return 'Premixed product · no percentages needed';
    if(parsed.kind==='raw')return 'Saved custom notes · unchanged until you apply';
    if(parsed.batches.length>1)return parsed.batches.length+' batches recorded · edit individually';
    const b=parsed.batches[0];
    const names=Object.entries(b.values).filter(([k,v])=>k!=='Water'&&v>0).slice(0,3);
    return names.map(([k,v])=>k+' '+v+'%').join(' · ') || 'Composition recorded';
  }
  function popup(){
    if(overlay)return overlay;
    overlay=el('div','mm-overlay');
    overlay.innerHTML=
      '<section class="mm-dialog" role="dialog" aria-modal="true" aria-labelledby="mm-title">'+
       '<header class="mm-head"><div><p class="mm-eyebrow">MATERIAL / QUICK MIX</p><h2 id="mm-title">Material recipe</h2><p class="mm-context"></p></div>'+
       '<button type="button" class="mm-close" aria-label="Close material editor">×</button></header>'+
       '<div class="mm-grid">'+
        '<div class="mm-setup"><label class="mm-label" for="mm-preset">START FROM A RECIPE</label><select id="mm-preset"></select>'+
        '<p class="mm-hint">Presets are based on recipes already saved in the module tracker. They are not an import of the linked Excel workbook.</p>'+
        '<label class="mm-label" for="mm-material-name">MATERIAL NAME</label><input id="mm-material-name" type="text" maxlength="120" />'+
        '<p class="mm-note">Red and yellow clay are kept separate until the workbook terminology is confirmed.</p>'+
        '<div class="mm-small-source">Select a recipe, then adjust individual percentages as needed. Nothing changes until Apply.</div></div>'+
        '<div class="mm-editor"><div class="mm-batches"></div><div class="mm-readout"></div>'+
        '<details class="mm-source"><summary>Raw recipe preview</summary><pre></pre></details></div>'+
       '</div>'+
       '<footer class="mm-footer"><span class="mm-message" role="status"></span><div><button type="button" class="mm-cancel">Cancel</button>'+
       '<button type="button" class="mm-apply">Apply to module</button></div></footer>'+
      '</section>';
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelector('.mm-close').addEventListener('click',close);
    overlay.querySelector('.mm-cancel').addEventListener('click',close);
    overlay.querySelector('#mm-preset').addEventListener('change',e=>selectPreset(e.target.value));
    overlay.querySelector('#mm-material-name').addEventListener('input',()=>{if(active)active.dirty=true;});
    overlay.querySelector('.mm-apply').addEventListener('click',apply);
    document.addEventListener('keydown',e=>{
      if(!active || !overlay.classList.contains('mm-visible'))return;
      if(e.key==='Escape'){e.preventDefault();close();}
    });
    document.body.appendChild(overlay);
    return overlay;
  }
  function createPresets(){
    const select=overlay.querySelector('#mm-preset');
    select.replaceChildren();
    const current=el('option',null,'Current saved recipe (keep/edit)');
    current.value='current';
    select.appendChild(current);
    P.filter(p=>p.group===active.group).forEach(p=>{
      const item=el('option',null,p.name);
      item.value=p.id;
      select.appendChild(item);
    });
    const custom=el('option',null,'Manual raw text / special batches');
    custom.value='raw';
    select.appendChild(custom);
  }
  function selectPreset(id){
    if(!active)return;
    const nameInput=overlay.querySelector('#mm-material-name');
    if(id==='current'){
      active.draft=clone(active.saved);
      nameInput.value=active.originalMaterial;
      active.dirty=false;
      active.recipeDirty=false;
    }else if(id==='raw'){
      active.draft={kind:'raw',raw:active.recipeDirty?recipeText(active.draft):active.originalDetails};
      active.dirty=true;
      active.recipeDirty=true;
    }else{
      const p=P.find(x=>x.id===id && x.group===active.group);
      if(!p)return;
      active.draft=p.kind==='ready'?{kind:'ready'}:{kind:'recipe',batches:clone(p.batches)};
      // Keep the existing glazed category when updating its grey-clay recipe.
      nameInput.value=(/glaz/i.test(active.originalMaterial)&&p.material==='Grey Clay')
        ?active.originalMaterial:p.material;
      active.dirty=true;
      active.recipeDirty=true;
    }
    paint();
  }
  function appendSlider(target,batch,key,index){
    const initial=cleanNumber(batch.values[key]);
    const row=el('div','mm-ingredient');
    const label=el('label','mm-ingredient-name',key);
    const range=el('input','mm-range'),num=el('input','mm-number');
    range.type='range';range.min='0';range.max='100';range.step='0.1';range.value=initial;
    range.style.setProperty('--mm-track',COLORS[key]||'#aa9683');
    range.setAttribute('aria-label',key+' percentage for batch '+(index+1));
    num.type='number';num.min='0';num.max='100';num.step='0.1';num.value=initial;
    num.setAttribute('aria-label',key+' exact percentage for batch '+(index+1));
    const suffix=el('span','mm-percent','%');
    function update(value,fromRange){
      if(!active)return;
      const n=cleanNumber(value);
      if(!fromRange)range.value=n;
      num.value=n;
      batch.values[key]=n;
      active.dirty=true;
      active.recipeDirty=true;
      updateReadout();
    }
    range.addEventListener('input',()=>update(range.value,true));
    num.addEventListener('change',()=>update(num.value,false));
    num.addEventListener('input',()=>{const n=Number(num.value);if(Number.isFinite(n)&&num.value!==''){range.value=cleanNumber(n);batch.values[key]=cleanNumber(n);active.dirty=true;active.recipeDirty=true;updateReadout();}});
    row.append(label,range,num,suffix);
    target.appendChild(row);
  }
  function paint(){
    if(!active)return;
    const drafts=overlay.querySelector('.mm-batches');
    drafts.replaceChildren();
    const draft=active.draft;
    const note=overlay.querySelector('.mm-message');
    note.textContent='';
    note.className='mm-message';
    if(draft.kind==='empty'){
      drafts.appendChild(el('p','mm-empty','No detailed recipe is saved for this module. Choose a mix on the left to populate it.'));
    }else if(draft.kind==='ready'){
      drafts.appendChild(el('div','mm-ready','NORMAL CLAY · ready-made 3D printing mix'));
      drafts.appendChild(el('p','mm-ready-sub','No ingredient percentages are required for the commercial premixed material.'));
    }else if(draft.kind==='raw'){
      const label=el('label','mm-label','SPECIAL / ORIGINAL COMPOSITION');
      const textarea=el('textarea','mm-raw');
      textarea.value=draft.raw||'';
      textarea.rows=12;
      textarea.addEventListener('input',()=>{draft.raw=textarea.value;active.dirty=true;active.recipeDirty=true;updateReadout();});
      drafts.append(label,textarea);
    }else{
      draft.batches.forEach((b,i)=>{
        const batchBox=el('section','mm-batch');
        const head=el('div','mm-batch-head');
        head.appendChild(el('h3',null,draft.batches.length===1?'Composition':b.label||'Mix '+(i+1)));
        const total=el('span','mm-total');
        total.dataset.batch=i;
        head.appendChild(total);
        batchBox.appendChild(head);
        const ingredientKeys=active.group==='rammed'?RAMMED_KEYS:PRINT_KEYS;
        ingredientKeys.forEach(key=>appendSlider(batchBox,b,key,i));
        const bar=el('div','mm-bar');
        bar.dataset.batch=i;
        batchBox.appendChild(bar);
        batchBox.appendChild(el('p','mm-sum-note',active.group==='rammed'
          ?'Total includes water; target ≈ 100%.'
          :'Dry ingredients target ≈ 100%; water is an additional percentage.'));
        drafts.appendChild(batchBox);
      });
    }
    updateReadout();
  }
  function updateReadout(){
    if(!active)return;
    const draft=active.draft;
    const readout=overlay.querySelector('.mm-readout');
    const preview=overlay.querySelector('.mm-source pre');
    preview.textContent=recipeText(draft)||'—';
    readout.replaceChildren();
    if(draft.kind==='recipe'){
      draft.batches.forEach((b,i)=>{
        const sum=Object.entries(b.values).reduce((n,[key,value])=>
          n+(active.group==='print'&&key==='Water'?0:cleanNumber(value)),0);
        const total=overlay.querySelector('.mm-total[data-batch="'+i+'"]');
        if(total){
          total.textContent=(active.group==='print'?'Dry: ':'Total: ')+formatNumber(sum)+'%';
          total.classList.toggle('mm-warning',Math.abs(sum-100)>1.5);
        }
        const bar=overlay.querySelector('.mm-bar[data-batch="'+i+'"]');
        if(bar){
          bar.replaceChildren();
          const entries=Object.entries(b.values).filter(([k,v])=>(active.group!=='print'||k!=='Water')&&v>0);
          const divisor=Math.max(sum,.1);
          entries.forEach(([key,n])=>{
            const seg=el('span','mm-bar-segment');
            seg.style.width=(100*cleanNumber(n)/divisor)+'%';
            seg.style.background=COLORS[key]||'#a99988';
            seg.title=key+' '+n+'%';
            bar.appendChild(seg);
          });
        }
      });
      const more=el('p','mm-mix-hint');
      more.textContent=draft.batches.length>1
        ?'Each saved batch is editable separately. Original Mix 1 / Mix 2 headings are preserved.'
        :'Adjust a slider or type an exact percentage. Saved values will also appear in the existing PDF and Excel exports.';
      readout.appendChild(more);
    }else if(draft.kind==='ready'){
      readout.appendChild(el('p','mm-mix-hint','A named commercial mix is recorded instead of invented ingredient ratios.'));
    }else if(draft.kind==='raw'){
      readout.appendChild(el('p','mm-mix-hint','Free text will be stored exactly as entered, preserving unusual or multi-stage recipes.'));
    }
  }
  function close(){
    if(!overlay)return;
    overlay.classList.remove('mm-visible');
    active=null;
    if(previousFocus&&document.contains(previousFocus))previousFocus.focus();
    previousFocus=null;
  }
  function apply(){
    if(!active)return;
    const material=overlay.querySelector('#mm-material-name').value.trim();
    const message=overlay.querySelector('.mm-message');
    if(!material){message.textContent='Material name is required.';message.className='mm-message mm-error';return;}
    // Changing just the name must NOT reformat existing multi-batch or ready-mix notes.
    const details=active.recipeDirty?recipeText(active.draft):active.originalDetails;
    if(active.recipeDirty && active.draft.kind==='recipe' && !details){
      message.textContent='Add at least one ingredient before applying.';
      message.className='mm-message mm-error';return;
    }
    if(!active.dirty && material===active.originalMaterial){close();return;}
    const payload={key:active.key,material:material,details:details};
    const onApply=active.onApply;
    try{
      const result=onApply(payload);
      if(result===false){message.textContent='Module selection changed. Reopen the mix editor.';message.className='mm-message mm-error';return;}
      close();
    }catch(err){
      message.textContent='Could not save mix: '+String(err?.message||err);
      message.className='mm-message mm-error';
    }
  }
  function open(record,key,onApply){
    const pop=popup();
    previousFocus=document.activeElement;
    const m=/rammed/i.test(String(record.Manufacturing_Method||''))?'rammed':'print';
    const originalMaterial=String(record.Material||'');
    const originalDetails=String(record.Material_Details||'');
    active={key:key,group:m,originalMaterial:originalMaterial,originalDetails:originalDetails,
      saved:parseSaved(originalDetails,originalMaterial),draft:null,dirty:false,recipeDirty:false,onApply:onApply};
    active.draft=clone(active.saved);
    pop.querySelector('#mm-title').textContent='Material recipe / '+String(record.Object_ID||'Module');
    pop.querySelector('.mm-context').textContent=(m==='rammed'?'RAMMED EARTH':'3D PRINTING')+
      ' · '+(originalMaterial||'Unspecified');
    createPresets();
    pop.querySelector('#mm-preset').value='current';
    pop.querySelector('#mm-material-name').value=originalMaterial;
    paint();
    pop.classList.add('mm-visible');
    pop.querySelector('#mm-preset').focus();
  }
  window.pavilionMaterialMixer={
    enhance(panel,record,key,onApply){
      if(active && active.key!==key)close();
      const source=panel?.querySelector('[data-field="Material"]');
      const field=source?.closest('.field');
      if(!field || field.querySelector('.mm-open'))return;
      const openBtn=el('button','mm-open','MIX EDITOR ↗');
      openBtn.type='button';
      openBtn.title='Open the material recipe picker and percentage sliders';
      const hint=el('p','mm-short',summary(record));
      hint.title=String(record.Material_Details||'');
      field.append(openBtn,hint);
      openBtn.addEventListener('click',()=>open(record,key,onApply));
    },
    close:close,
    parseSaved:parseSaved,
    recipeText:recipeText
  };
})();