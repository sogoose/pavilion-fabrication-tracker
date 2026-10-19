/* Native vector A4 landscape fabrication sheets. Only photos and shaded
 * model previews are bitmaps; all CAD table lines, Latin text and G-code
 * toolpaths are native PDF drawing operations.
 */
const PW=297, PH=210, PTMM=25.4/72;
const ink=[38,42,38],grey=[116,120,113],rule=[207,209,203];
const present=v=>v===null||v===undefined||String(v).trim()===''?'—':String(v).trim();
export function idOrder(a,b){
  const aId=String(a||'').trim(),bId=String(b||'').trim();
  const rank=s=>/^[A-Z]/.test(s)?0:/^[a-z]/.test(s)?1:2;
  if(rank(aId)!==rank(bId))return rank(aId)-rank(bId);
  return aId.localeCompare(bId,undefined,{numeric:true,sensitivity:'variant',caseFirst:'upper'});
}
function stroke(pdf,x,y,xx,yy,color=rule,weight=.12){
  pdf.setDrawColor(...color);pdf.setLineWidth(weight);pdf.line(x,y,xx,yy);
}
function frame(pdf,x,y,w,h){
  pdf.setDrawColor(...rule);pdf.setLineWidth(.13);pdf.rect(x,y,w,h);
}
function bg(pdf,x,y,w,h,color=[250,250,247]){
  pdf.setFillColor(...color);pdf.rect(x,y,w,h,'F');
}
function label(pdf,str,x,y,color=grey,size=5.3){
  print(pdf,str,x,y,130,size,true,color);
}
function print(pdf,value,x,y,maxWidth=200,size=7,bold=false,color=ink){
  let text=present(value).replace(/\s+/g,' ');
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
  pdf.setTextColor(...color);
  // Native Helvetica lacks Hangul. Rasterise those specific cell values only,
  // keeping the rest of the PDF as selectable vector text.
  if(/[^\u0000-\u00FF]/.test(text)){
    try{
      const cv=document.createElement('canvas');
      const cx=cv.getContext('2d');
      const factor=5;
      cx.font=(bold?'600 ':'400 ')+(size*factor)+'px Inter,Arial,sans-serif';
      const naturalWidth=cx.measureText(text).width;
      cv.width=Math.max(4,Math.ceil(naturalWidth+14));
      cv.height=Math.ceil(size*factor*1.55);
      const draw=cv.getContext('2d');
      draw.font=(bold?'600 ':'400 ')+(size*factor)+'px Inter,Arial,sans-serif';
      draw.fillStyle='rgb('+color.join(',')+')';
      draw.textBaseline='middle';
      draw.fillText(text,5,cv.height*.52);
      const pw=Math.min(maxWidth,(cv.width/factor)*PTMM);
      const ph=(cv.height/factor)*PTMM;
      pdf.addImage(cv.toDataURL('image/png'),'PNG',x,y-ph*.82,pw,ph,undefined,'FAST');
      return;
    }catch(e){text=text.replace(/[^\x20-\x7E]/g,'?');}
  }
  const width=()=>pdf.getTextWidth(text);
  if(width()>maxWidth){
    let base=text;
    while(base.length>1&&pdf.getTextWidth(base+'...')>maxWidth)base=base.slice(0,-1);
    text=base+'...';
  }
  pdf.text(text,x,y);
}
function pageBase(pdf,index,total){
  bg(pdf,0,0,PW,PH,[252,252,249]);
  stroke(pdf,10,28,287,28,[63,70,62],.2);
  stroke(pdf,10,198.4,287,198.4,[76,80,72],.18);
  label(pdf,'PAVILION / FABRICATION CATALOGUE',10,10.5);
  label(pdf,'MODULE SHEET '+String(index).padStart(3,'0'),248,10.5);
  label(pdf,'SOIL-BASED PAVILION / FABRICATION RECORD',10,204);
  label(pdf,'ISSUED '+new Date().toISOString().slice(0,10),190,204);
  label(pdf,'SHEET '+index+' / '+total,257,204,[45,48,44]);
}
function wrap(pdf,str,w,maxLines=4){
  const source=present(str).replace(/\r/g,'');
  let size=6.2,lines=[];
  const layout=()=>{
    pdf.setFont('helvetica','normal');pdf.setFontSize(size);
    const items=[];
    for(const word of source.split(/\s+/)){
      if(!items.length){items.push(word);continue;}
      const candidate=items.at(-1)+' '+word;
      if(pdf.getTextWidth(candidate)<=w){items[items.length-1]=candidate;continue;}
      items.push(word);
    }
    // Split words which have no spaces.
    const output=[];
    for(const item of items){
      if(pdf.getTextWidth(item)<=w){output.push(item);continue;}
      let row='';
      for(const ch of item){
        if(row&&pdf.getTextWidth(row+ch)>w){output.push(row);row='';}
        row+=ch;
      }
      if(row)output.push(row);
    }
    return output;
  };
  do{lines=layout();if(lines.length<=maxLines)break;size-=.25;}while(size>=4.3);
  if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]+='...';}
  return {lines,size};
}
function photoFit(pdf,img,x,y,w,h){
  const iw=img.width||img.videoWidth||1,ih=img.height||img.videoHeight||1;
  const scale=Math.min(w/iw,h/ih),iwmm=iw*scale,ihmm=ih*scale;
  const cv=document.createElement('canvas');
  const down=Math.min(1800/iw,1300/ih,1);
  cv.width=Math.max(1,Math.round(iw*down));cv.height=Math.max(1,Math.round(ih*down));
  cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
  pdf.addImage(cv.toDataURL('image/jpeg',.92),'JPEG',
    x+(w-iwmm)/2,y+(h-ihmm)/2,iwmm,ihmm,undefined,'FAST');
}
function iso([x,y,z]){
  return [(x-y)*.7071067812,(x+y)*.4082482905-z*.8164965809];
}
function viewport(points,x,y,w,h) {
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const p of points){xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);}
  if(!Number.isFinite(xmin))return null;
  const dx=Math.max(.00001,xmax-xmin),dy=Math.max(.00001,ymax-ymin);
  const sc=Math.min((w-4)/dx,(h-4)/dy);
  return p=>[x+(w-dx*sc)/2+(p[0]-xmin)*sc,
             y+(h-dy*sc)/2+(ymax-p[1])*sc];
}
function sample(values,limit){
  if(values.length<=limit)return values;
  return Array.from({length:limit},(_,i)=>values[Math.round(i*(values.length-1)/(limit-1))]);
}
export function parseGcode3D(text) {
  let x=0,y=0,z=0,mode=null,absolute=true,units=1;
  const paths=[];
  for(const raw of String(text||'').split(/\r?\n/)){
    if(paths.length>=85000)break;
    const line=raw.replace(/;.*$/,'').replace(/\([^)]*\)/g,'').toUpperCase();
    const codes=[...line.matchAll(/([GMXYZ])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)];
    if(!codes.length)continue;
    const words={};
    for(const [,k,v] of codes){(words[k]??=[]).push(Number(v));}
    const g=words.G||[];
    if(g.includes(90))absolute=true;
    if(g.includes(91))absolute=false;
    if(g.includes(20))units=25.4;
    if(g.includes(21))units=1;
    if(g.includes(92)){
      if(words.X)x=words.X.at(-1)*units;
      if(words.Y)y=words.Y.at(-1)*units;
      if(words.Z)z=words.Z.at(-1)*units;
      continue;
    }
    if(g.includes(0))mode=0;
    if(g.includes(1))mode=1;
    if(g.includes(2)||g.includes(3)||mode===null)continue;
    if(!words.X&&!words.Y&&!words.Z)continue;
    const nx=words.X?(absolute?words.X.at(-1)*units:x+words.X.at(-1)*units):x;
    const ny=words.Y?(absolute?words.Y.at(-1)*units:y+words.Y.at(-1)*units):y;
    const nz=words.Z?(absolute?words.Z.at(-1)*units:z+words.Z.at(-1)*units):z;
    if(![nx,ny,nz].every(Number.isFinite))continue;
    if(Math.hypot(nx-x,ny-y,nz-z)>.00001)paths.push({a:[x,y,z],b:[nx,ny,nz],travel:mode===0});
    x=nx;y=ny;z=nz;
  }
  return paths;
}
export function drawGcode3D(pdf,paths,x,y,w,h,maxSegments=7000){
  if(!paths?.length)return false;
  const segs=sample(paths,maxSegments),vertices=[];
  for(const s of segs)vertices.push(iso(s.a),iso(s.b));
  const fit=viewport(vertices,x,y,w,h);
  if(!fit)return false;
  pdf.setLineWidth(.07);
  for(const s of segs){
    pdf.setDrawColor(...(s.travel?[188,192,184]:[51,60,53]));
    const a=fit(iso(s.a)),b=fit(iso(s.b));
    pdf.line(a[0],a[1],b[0],b[1]);
  }
  return true;
}
export function drawModel3D(pdf,THREE,part,x,y,w,h){
  if(!part?.meshes?.length||!THREE?.EdgesGeometry)return false;
  const segments=[],points=[];
  try{
    for(const mesh of part.meshes){
      if(!mesh.geometry)continue;
      mesh.updateWorldMatrix(true,false);
      const g=new THREE.EdgesGeometry(mesh.geometry,17);
      const pos=g.getAttribute('position');
      const vec=new THREE.Vector3();
      if(pos){
        const step=Math.max(2,Math.ceil(pos.count/18000)*2);
        for(let i=0;i+1<pos.count;i+=step){
          const a=vec.set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
          const p=iso([a.x,a.y,a.z]);
          const b=vec.set(pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1)).applyMatrix4(mesh.matrixWorld);
          const q=iso([b.x,b.y,b.z]);
          points.push(p,q);segments.push([p,q]);
        }
      }
      g.dispose();
    }
  }catch(e){console.warn('Vector Rhino outlines unavailable:',e);return false;}
  if(!segments.length)return false;
  const fit=viewport(points,x,y,w,h);
  pdf.setDrawColor(57,64,58);pdf.setLineWidth(.075);
  for(const [p,q] of segments){const a=fit(p),b=fit(q);pdf.line(a[0],a[1],b[0],b[1]);}
  return true;
}
function table(pdf,r){
  const x=175,w=112,half=54;
  let y=33;
  function section(title,rows){
    stroke(pdf,x,y,x+w,y,[66,72,65],.16);
    label(pdf,title,x,y+4.2,[55,61,55],5.2);
    y+=6.3;
    for(const row of rows){
      const cell=(px,name,val)=>{
        print(pdf,name.toUpperCase(),px,y+1.5,half-1,4.55,true,[138,141,136]);
        print(pdf,val,px,y+5.6,half-1,6.75,false,ink);
      };
      cell(x,row[0],row[1]);
      if(row[2])cell(x+half+4,row[2],row[3]);
      stroke(pdf,x,y+7,x+w,y+7,[235,236,232],.1);
      y+=7.3;
    }
    y+=1.2;
  }
  section('01  IDENTITY',[
    ['MODULE NO.',r.Module_No,'LEVEL',r.Level],
    ['SEQUENCE',r.Sequence,'ASSIGNED TO',r.Assigned_To]
  ]);
  section('02  MATERIAL / MANUFACTURING',[
    ['METHOD',r.Manufacturing_Method,'MACHINE',r.Machine],
    ['MATERIAL',r.Material,'WEIGHT / KG',r.Weight_kg],
    ['INFILL',r.Infill_Pattern,'DENSITY / %',r.Infill_Density_pct]
  ]);
  section('03  FABRICATION / STATUS',[
    ['FABRICATION DATE',r.Fabrication_Date,'PRODUCTION',r.Production_Status],
    ['DRYING / QC',r.Drying_QC_Status,'ASSEMBLY',r.Construction_Status],
    ['OVERALL',r.Overall_Status,'STRUCTURE',r.Structural_Status]
  ]);
  section('04  PRINT SETTINGS',[
    ['MOTOR / STEPS-S',r.Motor_Speed,'MANUAL / %',r.Motor_Speed_Manual_Adjustment_pct],
    ['AIR / BAR',r.Air_Pressure_bar,'FIRST LAYER / MM',r.First_Layer_Height_mm],
    ['LAYER / MM',r.Layer_Height_mm,'DURATION / MIN',r.Print_Duration_min]
  ]);
  section('05  FIRING',[
    ['FIRED?',r.Firing_Status==='Fired'?'Yes':r.Manufacturing_Method==='Rammed Earth'?'N/A':'No',
      'FIRING DATE',r.Firing_Date],
    ['TEMPERATURE / C',r.Firing_Peak_Temp_C,'ROUTE',r.Firing_Route]
  ]);
  section('06  ADDITIONAL',[
    ['COMPRESSION / KN',r.Compression_Force_kN,'UPDATED BY',r.Updated_By],
    ['G-CODE FILE',r.GCode_File?String(r.GCode_File).split('/').pop().replace(/^\d+_/,''):'—',
      'LAST UPDATED',r.Last_Updated]
  ]);
  return y;
}
function box(pdf,x,y,w,h,labelText){
  bg(pdf,x,y,w,h,[250,250,247]);
  frame(pdf,x,y,w,h);
  label(pdf,labelText,x+2.4,y+4.4);
  stroke(pdf,x+2,y+6.1,x+w-2,y+6.1,[228,230,224],.1);
}
export function drawSheet(pdf,entry,asset,{THREE,number=1,total=1}={}){
  const r=entry.record;
  pageBase(pdf,number,total);
  print(pdf,present(r.Object_ID),10,23,165,22,true,ink);
  // Large photography area preserved at top-left. High-res raster only here.
  bg(pdf,10,33,157,89,[246,246,242]);
  const image=asset.photo||asset.model;
  if(image){
    try{photoFit(pdf,image,11,34,155,87);}catch(e){console.warn('Main PDF photograph:',e);}
  }else if(!drawGcode3D(pdf,asset.gcode,15,41,147,74,8500)) {
    print(pdf,'NO PHOTO / MODEL AVAILABLE',33,78,107,8,false,grey);
  }
  frame(pdf,10,33,157,89);
  label(pdf,asset.photo?'SITE PHOTO':asset.model?'ISOLATED 3D / AXONOMETRIC':'G-CODE / AXONOMETRIC',10,126.7);
  box(pdf,10,131,76,39,'3D  /  RHINO AXONOMETRIC');
  if(!drawModel3D(pdf,THREE,entry.part,12,138.5,72,29)) {
    if(asset.model){try{photoFit(pdf,asset.model,13,139,70,27);}catch(e){}}
    else label(pdf,'NO 3D MODEL',29,157);
  }
  box(pdf,90,131,77,39,'G-CODE  /  3D AXONOMETRIC');
  if(!drawGcode3D(pdf,asset.gcode,92,138.5,73,29))label(pdf,'NO G-CODE UPLOADED',104,157);
  // The recipe belongs to the Material section's 'Composition / quantity' field.
  stroke(pdf,10,175.2,167,175.2,[75,79,72],.17);
  label(pdf,'MATERIAL COMPOSITION / RECIPE',10,179.4);
  const recipe=wrap(pdf,r.Material_Details,156,5);
  recipe.lines.forEach((ln,i)=>print(pdf,ln,10,184+i*2.7,156,recipe.size,false,ink));
  const end=table(pdf,r);
  if(end>197)console.warn('Catalogue: table exceeds page footer',end);
}
export function drawCover(pdf,entries,photos,gcodes) {
  pageBase(pdf,0,entries.length);
  label(pdf,'TU DELFT  /  SOIL-BASED PAVILION',10,14);
  print(pdf,'FABRICATION',10,52,270,35,true,ink);
  print(pdf,'CATALOGUE',10,69,270,35,true,ink);
  stroke(pdf,10,79,287,79,[67,73,66],.32);
  const items=[
    ['MODULES',entries.length],
    ['3D PRINTING',entries.filter(e=>e.record.Manufacturing_Method==='3D Printing').length],
    ['RAMMED EARTH',entries.filter(e=>e.record.Manufacturing_Method==='Rammed Earth').length],
    ['PHOTOS',photos],
    ['G-CODE FILES',gcodes]
  ];
  items.forEach(([key,val],i)=>{
    const x=10+i*55;
    label(pdf,key,x,89);
    print(pdf,String(val),x,105,47,23,true,ink);
  });
  stroke(pdf,10,113,287,113,[216,216,210],.15);
  label(pdf,'MODULE REGISTER   /   UPPERCASE IDS FIRST',10,121);
  entries.slice(0,168).forEach((entry,i)=>{
    const col=i%14,row=Math.floor(i/14);
    print(pdf,entry.record.Object_ID,10+col*19.8,129+row*5.2,18,6.2,false,[84,87,80]);
  });
  if(entries.length>168)label(pdf,'+ '+(entries.length-168)+' ADDITIONAL RECORDS',10,194);
}
