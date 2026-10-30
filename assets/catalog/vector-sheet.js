/* Native vector A4 landscape fabrication sheets. Only photos and shaded
 * model previews are bitmaps; all CAD table lines, Latin text and G-code
 * toolpaths are native PDF drawing operations.
 */
const PW=297, PH=210, PTMM=25.4/72;
const ink=[38,42,38],grey=[116,120,113],rule=[207,209,203];
// The same RGB is used by the Rhino WebGL capture and its PDF panel.
export const MODULE_PANEL_RGB=Object.freeze([246,246,242]);
const present=v=>v===null||v===undefined||String(v).trim()===''?'-':String(v).trim();
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
function photoFit(pdf,img,x,y,w,h,format='JPEG',rotateLandscape=false){
  const iw=img.width||img.videoWidth||1,ih=img.height||img.videoHeight||1;
  // Only site photographs opt in: landscape images are turned clockwise for
  // portrait PDF panels, but portrait/square photos and Rhino renders stay as-is.
  const turn=rotateLandscape && iw>ih;
  const displayW=turn?ih:iw,displayH=turn?iw:ih;
  const scale=Math.min(w/displayW,h/displayH);
  const iwmm=displayW*scale,ihmm=displayH*scale;
  const cv=document.createElement('canvas');
  const down=Math.min(1800/displayW,1300/displayH,1);
  cv.width=Math.max(1,Math.round(displayW*down));
  cv.height=Math.max(1,Math.round(displayH*down));
  const ctx=cv.getContext('2d');
  if(turn){
    ctx.translate(cv.width,0);
    ctx.rotate(Math.PI/2);
    ctx.drawImage(img,0,0,cv.height,cv.width);
  }else{
    ctx.drawImage(img,0,0,cv.width,cv.height);
  }
  // Keep Rhino previews lossless: JPEG can shift the nearly-white
  // background by 1-2 RGB values, creating a visible rectangular seam.
  const png=format==='PNG';
  const data=png?cv.toDataURL('image/png'):cv.toDataURL('image/jpeg',.92);
  pdf.addImage(data,png?'PNG':'JPEG',
    x+(w-iwmm)/2,y+(h-ihmm)/2,iwmm,ihmm,undefined,'FAST');
}
function photoThumbnail(pdf,img,x,y,w,h){
  const iw=img.width||img.videoWidth||1,ih=img.height||img.videoHeight||1;
  // A centred, high-resolution cropped thumbnail fills the narrow photo cells.
  const sourceRatio=iw/ih,targetRatio=w/h;
  const cropW=sourceRatio>targetRatio?ih*targetRatio:iw;
  const cropH=sourceRatio>targetRatio?ih:iw/targetRatio;
  const sx=(iw-cropW)/2,sy=(ih-cropH)/2;
  const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(w*12));
  cv.height=Math.max(1,Math.round(h*12));
  cv.getContext('2d').drawImage(img,sx,sy,cropW,cropH,0,0,cv.width,cv.height);
  pdf.addImage(cv.toDataURL('image/jpeg',.92),'JPEG',x,y,w,h,undefined,'FAST');
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
// Representative, continuous printing contours for a *legible* compact 3D view.
// IMPORTANT: Never subsample individual line segments. Doing so turns continuous
// toolpaths into the disconnected black dashes visible in older PDF exports.
function toolpathRuns(paths,select=null) {
  const result=[];
  let run=null;
  const flush=()=>{
    if(run&&run.length>1)result.push(run);
    run=null;
  };
  let previousIndex=-2;
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  for(let i=0;i<paths.length;i++){
    const seg=paths[i];
    if(seg.travel||(select&&!select(i,seg))){flush();continue;}
    if(!seg.a.every(Number.isFinite)||!seg.b.every(Number.isFinite)){flush();continue;}
    const continuous=run&&previousIndex===i-1&&distance(run[run.length-1],seg.a)<.03;
    if(!continuous){flush();run=[seg.a];}
    run.push(seg.b);
    previousIndex=i;
  }
  flush();
  return result;
}
function reducedToolpathRuns(paths,maxSegments=6500) {
  const work=paths.some(s=>!s.travel)?paths.filter(s=>!s.travel):paths;
  if(!work.length)return [];
  const xs=[],ys=[],zs=[];
  for(let i=0;i<work.length;i+=Math.max(1,Math.floor(work.length/4000))){
    xs.push(work[i].a[0],work[i].b[0]);
    ys.push(work[i].a[1],work[i].b[1]);
    zs.push(work[i].a[2],work[i].b[2]);
  }
  const zmin=Math.min(...zs),zmax=Math.max(...zs),height=zmax-zmin;
  const diag=Math.hypot(Math.max(...xs)-Math.min(...xs),
    Math.max(...ys)-Math.min(...ys),height);
  let runs=toolpathRuns(work);
  // Dense clay prints may contain tens of thousands of G1 micro-segments.
  // Prefer complete representative Z layers (planar printing), falling back
  // to narrow height bands for continuous/spiral toolpaths.
  if(work.length>maxSegments*1.55 && height>Math.max(.8,diag*.012)){
    const levels=new Map();
    for(const seg of work){
      const z=(seg.a[2]+seg.b[2])*.5;
      const key=Math.round(z*10)/10;
      levels.set(key,(levels.get(key)||0)+1);
    }
    const dominant=[...levels].filter(([,n])=>
      n>=Math.max(20,work.length/Math.max(1,levels.size)*.45))
      .map(([z])=>z).sort((a,b)=>a-b);
    const planar=dominant.length>=7 &&
      dominant.length<=500 &&
      dominant.length/work.length<.006;
    let selections=[];
    if(planar){
      const count=Math.min(11,dominant.length);
      const centres=Array.from({length:count},(_,i)=>
        dominant[Math.round(i*(dominant.length-1)/(count-1))]);
      selections.push((i,seg)=>{
        const z=(seg.a[2]+seg.b[2])*.5;
        return centres.some(c=>Math.abs(z-c)<=.065);
      });
    }
    const count=9;
    const centres=Array.from({length:count},(_,i)=>zmin+
      height*i/(count-1));
    for(const factor of [.007,.018]){
      const halfWidth=Math.max(.12,height*factor);
      selections.push((i,seg)=>{
        const z=(seg.a[2]+seg.b[2])*.5;
        return centres.some(c=>Math.abs(z-c)<=halfWidth);
      });
    }
    for(const selector of selections){
      const chosen=toolpathRuns(work,selector);
      const segments=chosen.reduce((sum,points)=>sum+points.length-1,0);
      const meaningfulEdges=chosen.filter(points=>points.length>=4)
        .reduce((sum,points)=>sum+points.length-1,0);
      if(segments>=Math.min(160,maxSegments*.06)&&meaningfulEdges>=segments*.45){
        runs=chosen;
        break;
      }
    }
  }
  if(!runs.length)return [];
  // Remove isolated infill specks ONLY when a substantial number of connected
  // contours remains. Never hide genuinely short jobs.
  if(runs.length>30) {
    const substantive=runs.filter(points=>points.length>=4);
    const totalSubstantive=substantive.reduce((sum,p)=>sum+p.length-1,0);
    if(substantive.length && totalSubstantive>=Math.max(80,maxSegments*.2)){
      runs=substantive;
    }
  }
  // Preserve links inside *every* selected path: compress by joining adjacent
  // vertices, not by skipping and drawing scattered original segments.
  const totalEdges=runs.reduce((sum,p)=>sum+p.length-1,0);
  const stride=Math.max(1,Math.ceil(totalEdges/maxSegments));
  const cleaned=[];
  for(const run of runs){
    const simplified=[run[0]];
    for(let i=stride;i<run.length-1;i+=stride)simplified.push(run[i]);
    simplified.push(run[run.length-1]);
    // Suppress minuscule isolated strokes when they dominate the view.
    if(totalEdges>maxSegments && run.length<3 &&
       Math.hypot(...run[0].map((v,i)=>v-run.at(-1)[i]))<diag*.006)continue;
    if(simplified.length>=2)cleaned.push(simplified);
  }
  // An unfiltered small file still retains all its original toolpath edges.
  return cleaned;
}
export function drawGcode3D(pdf,paths,x,y,w,h,maxSegments=6500){
  if(!paths?.length)return false;
  const runs=reducedToolpathRuns(paths,maxSegments);
  if(!runs.length)return false;
  const vertices=[];
  for(const run of runs)for(const point of run)vertices.push(iso(point));
  const fit=viewport(vertices,x,y,w,h);
  if(!fit)return false;
  pdf.setDrawColor(48,56,49);
  pdf.setLineWidth(.12);
  let count=0;
  for(const run of runs){
    for(let i=1;i<run.length;i++){
      const a=fit(iso(run[i-1])),b=fit(iso(run[i]));
      pdf.line(a[0],a[1],b[0],b[1]);
      count++;
    }
  }
  return count>0;
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
    ['MATERIAL',r.Material,'INFILL / DENSITY',
      present(r.Infill_Pattern)+' / '+(present(r.Infill_Density_pct)==='-'?'-':present(r.Infill_Density_pct)+'%')],
    ['WET WEIGHT / KG',r.Wet_Weight_kg,'DRY WEIGHT / KG',r.Weight_kg]
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
    ['FIRING STATUS',r.Manufacturing_Method==='Rammed Earth'?'N/A':(r.Firing_Status||'Not fired'),
      'FIRING DATE',r.Firing_Date],
    ['TEMPERATURE / C',r.Firing_Peak_Temp_C,'DURATION / H',r.Firing_Duration_h],
    ['KILN / MACHINE',r.Manufacturing_Method==='3D Printing'?(r.Firing_Kiln||'ROHDE-kiln'):'-',
      'FIRING BATCH',r.Firing_Batch]
  ]);
  section('06  ADDITIONAL',[
    ['COMPRESSION / KN',r.Compression_Force_kN,'G-CODE FILE',
      r.GCode_File?String(r.GCode_File).split('/').pop().replace(/^\d+_/,''):'-']
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

  // Main LEFT: a large fabrication photo, with a Rhino fallback for modules
  // that have not yet been photographed. Keep its original 101 x 137 mm frame.
  const primaryPhoto=asset.photos?.[0] || null;
  const hero=primaryPhoto || asset.model || null;
  bg(pdf,10,33,101,137,primaryPhoto?[250,250,247]:MODULE_PANEL_RGB);
  if(hero){
    try { photoFit(pdf,hero,11,34,99,135,primaryPhoto?'JPEG':'PNG',Boolean(primaryPhoto)); }
    catch(err){console.warn('PDF module hero:',err);}
  }else if(!drawGcode3D(pdf,asset.gcode,14,39,93,124)) {
    print(pdf,'NO SITE PHOTO',35,104,65,8,false,grey);
  }
  frame(pdf,10,33,101,137);
  label(pdf,primaryPhoto?'SITE PHOTO / 01':asset.model?'RHINO / MODULE 3D':'MODULE VISUAL',10,173.6);

  // Upper RIGHT: unchanged vector G-code axonometric.
  box(pdf,114,33,53,73,'G-CODE / 3D AXONOMETRIC');
  if(!drawGcode3D(pdf,asset.gcode,116,41,49,63,9500)) {
    label(pdf,'NO G-CODE LINK',123,70);
  }

  // Lower RIGHT: smaller Rhino 3D preview when a site photo fills the hero.
  // If no photo exists, the full-size Rhino is already shown on the left.
  box(pdf,114,109,53,61,primaryPhoto?'RHINO / MODULE 3D':'SITE PHOTO / 01');
  if(primaryPhoto && asset.model){
    try { photoFit(pdf,asset.model,115,116,51,53,'PNG'); }
    catch(err){console.warn('PDF Rhino thumbnail:',err);}
  }else if(primaryPhoto){
    label(pdf,'NO 3D MODEL',121,139);
  }else{
    label(pdf,'NO UPLOADED PHOTO',120,139);
  }

  // Mix recipe is independent from annotations and module notes.
  stroke(pdf,10,175.2,167,175.2,[75,79,72],.17);
  label(pdf,'MATERIAL COMPOSITION / RECIPE',10,179.4);
  const recipe=wrap(pdf,r.Material_Details,156,5);
  recipe.lines.forEach((txt,i)=>print(pdf,txt,10,184+i*2.7,156,recipe.size,false,ink));
  const end=table(pdf,r);
  if(end>197)console.warn('Catalogue: table exceeds footer',end);
}


/* Cropped, edge-to-edge photographs for the editorial A4 sheet.
 * This intentionally differs from the technical PDF's contain/fit layout.
 * Rotating landscape site photos remains consistent with the earlier request.
 */
function simplePhotoFill(pdf,img,x,y,w,h,format='JPEG',rotateLandscape=true){
  const iw=img.width||img.videoWidth||1,ih=img.height||img.videoHeight||1;
  const rotate=rotateLandscape&&iw>ih;
  let oriented=img,ow=iw,oh=ih;
  if(rotate){
    const rotated=document.createElement('canvas');
    rotated.width=ih;rotated.height=iw;
    const ctx=rotated.getContext('2d');
    ctx.translate(ih,0);ctx.rotate(Math.PI/2);
    ctx.drawImage(img,0,0,iw,ih);
    oriented=rotated;ow=ih;oh=iw;
  }
  const targetAspect=w/h,sourceAspect=ow/oh;
  const cropW=sourceAspect>targetAspect?oh*targetAspect:ow;
  const cropH=sourceAspect>targetAspect?oh:ow/targetAspect;
  const sx=(ow-cropW)/2,sy=(oh-cropH)/2;
  const cv=document.createElement('canvas');
  const density=Math.min(12,1600/Math.max(w,h));
  cv.width=Math.max(1,Math.round(w*density));
  cv.height=Math.max(1,Math.round(h*density));
  cv.getContext('2d').drawImage(oriented,sx,sy,cropW,cropH,0,0,cv.width,cv.height);
  const png=format==='PNG';
  pdf.addImage(cv.toDataURL(png?'image/png':'image/jpeg',.92),
    png?'PNG':'JPEG',x,y,w,h,undefined,'FAST');
}

// Measured text wrapping at the ACTUAL displayed font size. Unlike the old
// small caption helper, this preserves multi-line mix compositions.
function simpleCopyLines(pdf,content,w,fontSize=10.5,maxLines=10){
  const paragraphs=String(content??'').replace(/\r/g,'').split('\n');
  pdf.setFont('helvetica','normal');pdf.setFontSize(fontSize);
  const lines=[];
  for(const paragraph of paragraphs){
    const words=paragraph.trim().split(/\s+/).filter(Boolean);
    if(!words.length){if(lines.length)lines.push('');continue;}
    let line='';
    for(const word of words){
      const candidate=line?line+' '+word:word;
      if(pdf.getTextWidth(candidate)<=w){line=candidate;continue;}
      if(line){lines.push(line);line='';}
      for(const ch of word){
        if(line&&pdf.getTextWidth(line+ch)>w){lines.push(line);line='';}
        line+=ch;
      }
    }
    if(line)lines.push(line);
  }
  if(lines.length>maxLines){
    const clipped=lines.slice(0,maxLines);
    clipped[maxLines-1]=clipped[maxLines-1].replace(/\s*$/,'')+'…';
    return clipped;
  }
  return lines;
}

/* A4 portrait photo record: generous typography, no letterboxed photo
 * frames, original recorded material composition and clear notes.
 */
export function drawSimpleSheet(pdf,entry,asset,{number=1,total=1}={}){
  const r=entry.record||{};
  const photos=asset.photos||[];
  // Rammed-earth R/r modules use only uploaded site photos in the Simple PDF.
  // Never substitute the Rhino render or show missing-image placeholders.
  const isRammedModule=/^[Rr]/.test(String(r.Object_ID||'').trim());
  const detail=String(r.Material_Details||'').trim();
  const notes=String(r.Notes||'').trim();
  const materialGroups=detail.split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean);
  const multiMix=materialGroups.length>=2;
  const longMix=multiMix||detail.length>160||detail.split(/\r?\n/).filter(line=>line.trim()).length>5;
  const pageInk=[31,34,30],soft=[105,108,101];
  const outer=12,imageY=63,imageH=isRammedModule?124:(longMix?102:124),photoWidth=91;
  const infoY=imageY+imageH+19;
  bg(pdf,0,0,210,297,[252,251,248]);

  // Exhibition website hierarchy: oversized module ID, tight black type.
  print(pdf,'PRINT("HELLO, EARTH")³',outer,15,140,11.5,true,pageInk);
  print(pdf,'FABRICATION ARCHIVE',143,14.5,55,7.2,true,soft);
  stroke(pdf,outer,22,198,22,[55,60,53],.22);
  print(pdf,present(r.Object_ID),outer,47,113,43,true,pageInk);
  print(pdf,'FABRICATION DATE',137,37,61,8,true,soft);
  print(pdf,r.Fabrication_Date||'NOT RECORDED',137,49,61,12,true,pageInk);

  const photographs=[
    {image:photos[0]||(!isRammedModule?asset.model:null)||null,photo:!!photos[0],
     caption:photos[0]?'01  /  SITE PHOTO':!isRammedModule&&asset.model?'01  /  RHINO 3D':'01  /  NO IMAGE'},
    {image:photos[1]||(!isRammedModule&&photos[0]?asset.model:null),photo:!!photos[1],
     caption:photos[1]?'02  /  SITE PHOTO':!isRammedModule&&photos[0]&&asset.model?'02  /  RHINO 3D':'02  /  NO IMAGE'}
  ];
  for(let i=0;i<2;i++){
    const x=i===0?outer:107;
    const item=photographs[i];
    // Keep the right-hand area empty for R/r modules with one photo.
    // The image grid, typography and material/notes positions do not change.
    if(isRammedModule&&!item.image)continue;
    if(item.image){
      try{
        // Crop only the surplus edge area, never show grey/white letterboxing.
        simplePhotoFill(pdf,item.image,x,imageY,photoWidth,imageH,
          item.photo?'JPEG':'PNG',item.photo);
      }catch(error){
        console.warn('Simple PDF photo '+(i+1),error);
        print(pdf,'IMAGE UNAVAILABLE',x+8,imageY+imageH/2,76,9,true,soft);
      }
    }else{
      // An absent image is deliberately left on the cream page, unboxed.
      print(pdf,'NO SECOND IMAGE',x+10,imageY+imageH/2,75,9,true,soft);
    }
    print(pdf,item.caption,x,imageY+imageH+7,91,8.5,true,pageInk);
  }
  stroke(pdf,outer,infoY-4,198,infoY-4,[55,60,53],.2);

  print(pdf,'MATERIAL',outer,infoY+5,106,9.5,true,soft);
  print(pdf,r.Material||'NOT RECORDED',outer,infoY+19,180,19,true,pageInk);
  print(pdf,'MIX / COMPOSITION',outer,infoY+31,150,8.5,true,soft);

  if(!detail){
    print(pdf,'No material composition recorded',outer,infoY+43,88,10.5,false,soft);
  }else if(multiMix){
    // All Simple PDF sheets share the SAME material/notes columns and type scale.
    // Rammed-earth mixes are the only special case: two narrow subcolumns
    // inside the normal 91 mm MATERIAL column (not across the NOTES area).
    const groups=[materialGroups[0],materialGroups.slice(1).join('\n\n')];
    const recipes=groups.map((group,index)=>{
      const rows=String(group).replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
      const hasHeading=/^\*?\s*mix\s*\d+/i.test(rows[0]||'');
      return {
        heading:hasHeading?rows[0].replace(/^\*+\s*/,''):'Mix '+(index+1),
        ingredients:hasHeading?rows.slice(1).join('\n'):rows.join('\n')
      };
    });

    // Use the same 10.5 pt body font as 3D-printing blocks whenever possible.
    // Reduce it only when a batch contains more than seven ingredient rows.
    let fontSize=10.5;
    let recipeLines=recipes.map(recipe=>simpleCopyLines(pdf,recipe.ingredients,39,fontSize,30));
    if(Math.max(...recipeLines.map(lines=>lines.length))>7){
      fontSize=9.4;
      recipeLines=recipes.map(recipe=>simpleCopyLines(pdf,recipe.ingredients,39,fontSize,30));
    }
    if(Math.max(...recipeLines.map(lines=>lines.length))>8){
      fontSize=8.4;
      recipeLines=recipes.map(recipe=>simpleCopyLines(pdf,recipe.ingredients,39,fontSize,30));
    }
    const maxLines=8;
    const longest=Math.max(1,...recipeLines.map(lines=>Math.min(lines.length,maxLines)));
    const lineStep=Math.min(4.5,27/Math.max(1,longest-1));
    recipes.forEach((recipe,col)=>{
      const x=col===0?outer:58;
      print(pdf,recipe.heading,x,infoY+40,39,10.5,true,pageInk);
      const lines=recipeLines[col].slice(0,maxLines);
      if(recipeLines[col].length>maxLines){
        lines[maxLines-1]=lines[maxLines-1].replace(/\s*$/,'')+'…';
      }
      lines.forEach((line,j)=>{
        if(line)print(pdf,line,x,infoY+45+j*lineStep,39,fontSize,false,pageInk);
      });
    });
  }else{
    const mixLines=simpleCopyLines(pdf,detail,88,10.5,8);
    mixLines.forEach((line,j)=>{
      if(line)print(pdf,line,outer,infoY+43+j*6.5,88,10.5,false,pageInk);
    });
  }

  // Shared across BOTH printing and rammed-earth sheets: identical divider,
  // NOTES title, font size, line height, and position relative to MATERIAL.
  stroke(pdf,103,infoY+2,103,281,[223,225,220],.15);
  print(pdf,'NOTES',112,infoY+5,86,9.5,true,soft);
  const noteLines=simpleCopyLines(pdf,notes||'No notes recorded',84,11,9);
  noteLines.forEach((line,j)=>{
    if(line)print(pdf,line,112,infoY+20+j*6.2,84,11,false,notes?pageInk:soft);
  });
  // Footer stays quiet: module data and photographs remain the main event.
  stroke(pdf,outer,288,198,288,[55,60,53],.15);
  print(pdf,'FABRICATION RECORD',outer,294,85,7.5,true,soft);
  print(pdf,String(number).padStart(2,'0')+' / '+String(total).padStart(2,'0'),
    169,294,29,7.5,true,soft);
}

const STATUS_ORDER=['Not Started','Queued','Printing','Printed','Failed'];
const DEFAULT_STATUS_COLORS={
  'Not Started':'#d6d6d1','Queued':'#a8c7e8',
  'Printing':'#e7c971','Printed':'#79aa7a','Failed':'#cc6b62'
};
function statusColor(value,palette){
  return (palette && palette[value]) || DEFAULT_STATUS_COLORS[value] || '#bbbdb7';
}
function rgb(value){
  let hex=String(value||'').trim();
  if(!/^#[0-9a-f]{6}$/i.test(hex))hex='#b8bab4';
  return [1,3,5].map(start=>parseInt(hex.slice(start,start+2),16));
}
function swatch(pdf,x,y,status,palette,w=3.6,h=3.6){
  pdf.setFillColor(...rgb(statusColor(status,palette)));
  pdf.rect(x,y,w,h,'F');
}
function statusCounts(entries){
  const totals={};
  for(const entry of entries){
    const status=present(entry.record.Production_Status);
    totals[status]=(totals[status]||0)+1;
  }
  return totals;
}
function drawStatusKeymap(pdf,entries,palette,x=224,y=53,w=63){
  const totals=statusCounts(entries);
  stroke(pdf,x,y,x+w,y,[65,70,63],.24);
  label(pdf,'PRODUCTION STATUS / KEY MAP',x,y+5,[48,56,47],6.1);
  let rowY=y+12;
  for(const status of [...STATUS_ORDER,...Object.keys(totals).filter(key=>!STATUS_ORDER.includes(key))]){
    swatch(pdf,x+1,rowY-3,status,palette,4.4,4.4);
    print(pdf,status,x+8.5,rowY+.4,w-23,8,false,ink);
    print(pdf,String(totals[status]||0),x+w-11,rowY+.4,10,8,true,ink);
    rowY+=9.7;
  }
  return rowY;
}
function placedLabels(pdf,positions,x,y,w,h,palette){
  if(!positions?.length)return;
  // Minimal label design: native PDF letters directly over the exploded Rhino.
  // An 8-direction white halo keeps dark ink legible over status colours.
  // Candidate positions avoid label-vs-label overlaps; no boxes or swatches.
  const used=[];
  const placed=[];
  const minX=x+1.0,minY=y+1.7,maxX=x+w-1.0,maxY=y+h-1.0;
  const height=2.25;
  const order=[...positions].filter(p=>Number.isFinite(p.u)&&Number.isFinite(p.v))
    .sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  pdf.setFont('helvetica','bold');
  pdf.setFontSize(5.6);
  for(const point of order){
    const name=present(point.id).slice(0,13);
    const tw=Math.max(2,pdf.getTextWidth(name));
    const anchorX=x+point.u*w,anchorY=y+point.v*h;
    let candidate=null;
    // Search close to the original module centre first. Avoid collisions even
    // for dense, near-overlapping geometries; only adjust label positions.
    for(let ring=0;ring<=16 && !candidate;ring++){
      const radius=ring*1.5;
      const steps=ring===0?1:Math.max(12,Math.round(2*Math.PI*radius/2));
      for(let i=0;i<steps;i++){
        const angle=2*Math.PI*i/steps;
        const tx=Math.max(minX+tw/2,Math.min(maxX-tw/2,anchorX+Math.cos(angle)*radius));
        const ty=Math.max(minY+height/2,Math.min(maxY-height/2,anchorY+Math.sin(angle)*radius));
        const left=tx-tw/2,top=ty-height/2;
        if(used.every(b=>left>b.x+b.w+.45||left+tw+.45<b.x||
            top>b.y+b.h+.25||top+height+.25<b.y)){
          candidate={cx:tx,cy:ty,x:left,y:top,w:tw,h:height};
          break;
        }
      }
    }
    if(!candidate){
      // Register page still contains all IDs if a particularly dense view
      // cannot accommodate more labels without collisions.
      continue;
    }
    used.push(candidate);
    placed.push({name,...candidate});
  }
  pdf.setFont('helvetica','bold');
  pdf.setFontSize(5.6);
  const offsets=[[-.25,0],[.25,0],[0,-.25],[0,.25],
    [-.18,-.18],[.18,-.18],[-.18,.18],[.18,.18]];
  for(const p of placed){
    pdf.setTextColor(255,255,252);
    for(const [dx,dy] of offsets)
      pdf.text(p.name,p.cx+dx,p.cy+dy,{align:'center',baseline:'middle'});
    pdf.setTextColor(25,30,26);
    pdf.text(p.name,p.cx,p.cy,{align:'center',baseline:'middle'});
  }
}

export function drawStatusCover(pdf,entries,overview,{palette={}}={}){
  bg(pdf,0,0,PW,PH,[252,252,249]);
  label(pdf,'TU DELFT  /  SOIL-BASED PAVILION',10,11);
  print(pdf,'FABRICATION / STATUS MAP',10,23,248,25,true,ink);
  stroke(pdf,10,27.5,287,27.5,[68,71,65],.24);
  const area={x:10,y:33,w:211,h:151};
  bg(pdf,area.x,area.y,area.w,area.h,[242,242,238]);
  if(overview?.canvas){
    photoFit(pdf,overview.canvas,area.x,area.y,area.w,area.h);
    placedLabels(pdf,overview.labels,area.x,area.y,area.w,area.h,palette);
  }else{
    print(pdf,'3D MODEL OVERVIEW UNAVAILABLE',37,112,155,12,false,grey);
  }
  frame(pdf,area.x,area.y,area.w,area.h);
  const rowEnd=drawStatusKeymap(pdf,entries,palette,225,34,62);
  stroke(pdf,225,rowEnd+5,287,rowEnd+5,[197,201,192],.14);
  label(pdf,'MODEL / INVENTORY',225,rowEnd+12);
  print(pdf,String(entries.length)+' MODULES',225,rowEnd+23,60,15,true,ink);
  print(pdf,String(entries.filter(e=>e.record.Manufacturing_Method==='3D Printing').length)+' PRINTED',225,rowEnd+31,59,8,false,ink);
  print(pdf,String(entries.filter(e=>e.record.Manufacturing_Method==='Rammed Earth').length)+' RAMMED',225,rowEnd+38,59,8,false,ink);
  label(pdf,'MODULE IDS ARE ANNOTATED',10,191);
  label(pdf,'SEE MODULE REGISTER / NEXT PAGE',125,191);
  stroke(pdf,10,198.4,287,198.4,[76,80,72],.18);
  label(pdf,'SOIL-BASED PAVILION / CURRENT RHINO GEOMETRY',10,204);
  label(pdf,'ISSUED '+new Date().toISOString().slice(0,10),228,204);
}
export function drawRegisterPage(pdf,entries,{palette={},startIndex=0,total=entries.length}={}){
  bg(pdf,0,0,PW,PH,[252,252,249]);
  label(pdf,'PAVILION / FABRICATION CATALOGUE',10,11);
  print(pdf,'MODULE REGISTER',10,24,215,23,true,ink);
  stroke(pdf,10,28.5,287,28.5,[65,70,63],.22);
  label(pdf,'OBJECT ID  /  PRODUCTION STATUS  /  METHOD',10,35);
  label(pdf,'UPPERCASE IDS FIRST  /  CURRENT RHINO ONLY',192,35);
  const perColumn=22,countCols=4,columnWidth=69.25;
  for(let i=0;i<entries.length;i++) {
    const column=Math.floor(i/perColumn);
    if(column>=countCols)break;
    const row=i%perColumn;
    const x=10+column*columnWidth,y=43+row*6.65;
    const record=entries[i].record;
    const status=present(record.Production_Status);
    const shortMethod=record.Manufacturing_Method==='3D Printing'?'3DP':
      record.Manufacturing_Method==='Rammed Earth'?'RE':'-';
    swatch(pdf,x,y-3,status,palette,3.2,3.2);
    print(pdf,record.Object_ID,x+5.1,y,15.5,7.7,true,ink);
    print(pdf,status,x+23,y,32,6.6,false,ink);
    print(pdf,shortMethod,x+57,y,11,6.2,false,grey);
    stroke(pdf,x,y+2.3,x+columnWidth-3,y+2.3,[226,228,221],.085);
  }
  stroke(pdf,10,193,287,193,[104,109,100],.16);
  const totals=statusCounts(entries);
  let xx=10;
  for(const status of STATUS_ORDER){
    swatch(pdf,xx,195.0,status,palette,2.5,2.5);
    print(pdf,status+' '+String(totals[status]||0),xx+4,197.3,48,5.9,false,ink);
    xx+=54.9;
  }
  label(pdf,'REGISTER '+(startIndex+1)+' - '+(startIndex+entries.length)+' / '+total,10,204);
  label(pdf,'ISSUED '+new Date().toISOString().slice(0,10),225,204);
}


/* Fabrication-date report, rendered with native PDF vector operations.
   Unlike a screenshot of the UI, numbers, dates and bars remain selectable
   and sharp when printed. The 3D view is a temporary isolated Rhino render. */
const DATE_METHOD_PALETTE=Object.freeze({
  '3D Printing':'#4e85c0',
  'Rammed Earth':'#a78252',
  'Other':'#859a83',
  'Later':'#bfc3c0',
  'Undated':'#e7e8e4'
});
export function fabricationDateGroups(entries){
  const isDate=value=>{
    const date=String(value||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
    const parsed=new Date(date+'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===date;
  };
  const grouped=new Map();
  let undated=0,printTotal=0,rammedTotal=0,otherTotal=0;
  for(const item of entries){
    const r=item.record||{};
    if(!isDate(r.Fabrication_Date)){undated++;continue;}
    const date=r.Fabrication_Date;
    if(!grouped.has(date))grouped.set(date,{date,printing:0,rammed:0,other:0,ids:[]});
    const bucket=grouped.get(date);
    if(r.Manufacturing_Method==='3D Printing'){bucket.printing++;printTotal++;}
    else if(r.Manufacturing_Method==='Rammed Earth'){bucket.rammed++;rammedTotal++;}
    else {bucket.other++;otherTotal++;}
    bucket.ids.push(String(r.Object_ID||item.key||'—'));
  }
  return {
    dates:[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    total:entries.length,dated:entries.length-undated,undated,
    printing:printTotal,rammed:rammedTotal,other:otherTotal
  };
}
export function drawFabricationTimelinePage(pdf,entries,overview,{
  dateWindow=null,section=1,totalSections=1
}={}){
  const counts=fabricationDateGroups(entries);
  const days=dateWindow||counts.dates;
  const latest=days.at(-1)?.date||'—';
  bg(pdf,0,0,PW,PH,[252,252,249]);
  label(pdf,'PAVILION / FABRICATION CATALOGUE',10,10.5);
  label(pdf,'DATE REGISTER '+section+' / '+totalSections,235,10.5);
  print(pdf,'FABRICATION / TIMELINE',10,23,240,23,true,ink);
  stroke(pdf,10,28,287,28,[60,67,60],.24);
  const stats=[
    [String(counts.dated),'DATED MODULES'],
    [String(counts.dates.length),'DAYS RECORDED'],
    [String(counts.printing),'3D PRINTING'],
    [String(counts.rammed),'RAMMED EARTH'],
    [String(counts.undated),'NO DATE']
  ];
  stats.forEach(([value,title],i)=>{
    const x=10+i*55.4;
    if(i)stroke(pdf,x-3,31,x-3,46,[214,217,211],.12);
    print(pdf,value,x,38,38,17,true,ink);
    label(pdf,title,x,43.8,grey,5.3);
  });
  stroke(pdf,10,47.5,287,47.5,[174,178,170],.12);
  label(pdf,'DAILY MODULE OUTPUT / RECORDED FABRICATION DATE',10,53,[60,69,61],6.3);
  const keys=[['3D Printing',DATE_METHOD_PALETTE['3D Printing']],['Rammed Earth',DATE_METHOD_PALETTE['Rammed Earth']],['Other',DATE_METHOD_PALETTE.Other]];
  keys.forEach(([title,c],i)=>{
    const x=198+i*29.7;
    pdf.setFillColor(...rgb(c));pdf.rect(x,50.1,3,3,'F');
    print(pdf,title,x+4,52.7,28,5.6,false,ink);
  });
  // Draw a daily stacked bar chart. Up to 27 dates per page for legible ticks.
  const plot={x:14,y:57,w:269,h:48};
  stroke(pdf,plot.x,plot.y+plot.h,plot.x+plot.w,plot.y+plot.h,[92,99,90],.18);
  const max=Math.max(1,...days.map(d=>d.printing+d.rammed+d.other));
  for(let t=1;t<=3;t++){
    const y=plot.y+plot.h-t*plot.h/4;
    stroke(pdf,plot.x,y,plot.x+plot.w,y,[227,229,222],.085);
  }
  if(!days.length){
    print(pdf,'NO FABRICATION DATES RECORDED',85,83,135,12,false,grey);
  }else{
    const pitch=plot.w/days.length;
    const bw=Math.min(11,Math.max(2.5,pitch*.58));
    days.forEach((day,i)=>{
      const x=plot.x+pitch*i+(pitch-bw)/2;
      let y=plot.y+plot.h;
      const full=day.printing+day.rammed+day.other;
      const seq=[
        [day.printing,DATE_METHOD_PALETTE['3D Printing']],
        [day.rammed,DATE_METHOD_PALETTE['Rammed Earth']],
        [day.other,DATE_METHOD_PALETTE.Other]
      ];
      for(const [value,c] of seq){
        if(!value)continue;
        const barH=value/max*(plot.h-6);
        y-=barH;
        pdf.setFillColor(...rgb(c));pdf.rect(x,y,bw,barH,'F');
      }
      print(pdf,String(full),x+bw/2,Math.max(plot.y+1,y-1.6),10,6.3,true,ink);
      const dateLabel=day.date.slice(5).replace('-','/');
      pdf.setFont('helvetica','normal');pdf.setFontSize(days.length>21?5.3:6.3);
      pdf.setTextColor(...grey);
      pdf.text(dateLabel,x+bw/2,plot.y+plot.h+5.1,{align:'center'});
    });
  }
  label(pdf,'3D / MODULE GEOMETRY BY FABRICATION DATE',10,117,[60,69,61],6.3);
  label(pdf,'CUMULATIVE THROUGH '+latest,134,117,grey,5.4);
  bg(pdf,10,120,113,69,[246,246,242]);
  if(overview?.canvas){
    photoFit(pdf,overview.canvas,11,121,111,67,'PNG');
    // Small, native PDF module labels, not permanent changes to the Rhino file.
    placedLabels(pdf,overview.labels,11,121,111,67,{
      '3D Printing':DATE_METHOD_PALETTE['3D Printing'],
      'Rammed Earth':DATE_METHOD_PALETTE['Rammed Earth'],
      Other:DATE_METHOD_PALETTE.Other,
      Later:DATE_METHOD_PALETTE.Later,
      Undated:DATE_METHOD_PALETTE.Undated
    });
  }else{
    print(pdf,'3D MODEL VIEW UNAVAILABLE',22,157,89,9,false,grey);
  }
  frame(pdf,10,120,113,69);
  stroke(pdf,130,120,130,189,[180,184,177],.14);
  label(pdf,'DAILY RECORD / MODULES FABRICATED',136,123,[60,69,61],6.2);
  // Right-side register matches the plotted daily bins, not inferred timestamps.
  const registerDates=days.slice(-9);
  for(let i=0;i<registerDates.length;i++){
    const day=registerDates[i],y=132+i*6.05;
    print(pdf,day.date.slice(5),136,y,21,7.2,true,ink);
    print(pdf,String(day.printing)+'  3DP',165,y,25,6.5,false,rgb(DATE_METHOD_PALETTE['3D Printing']));
    print(pdf,String(day.rammed)+'  RE',193,y,24,6.5,false,rgb(DATE_METHOD_PALETTE['Rammed Earth']));
    const ids=day.ids.slice(0,5).join(', ')+(day.ids.length>5?' ...':'');
    print(pdf,ids,221,y,65,6,false,grey);
    stroke(pdf,136,y+1.8,287,y+1.8,[232,233,227],.08);
  }
  label(pdf,'DATES REFLECT RECORDED FABRICATION, NOT SCHEDULED OUTPUT',136,188,grey,5.5);
  stroke(pdf,10,198,287,198,[75,81,74],.17);
  label(pdf,'CURRENT RHINO MODULES / SOURCE: TRACKER FABRICATION DATE',10,204);
  label(pdf,'ISSUED '+new Date().toISOString().slice(0,10),228,204);
}
