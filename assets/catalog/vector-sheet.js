/* Native vector A4 landscape fabrication sheets. Only photos and shaded
 * model previews are bitmaps; all CAD table lines, Latin text and G-code
 * toolpaths are native PDF drawing operations.
 */
const PW=297, PH=210, PTMM=25.4/72;
const ink=[38,42,38],grey=[116,120,113],rule=[207,209,203];
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
    ['TEMPERATURE / C',r.Firing_Peak_Temp_C,'ROUTE',r.Firing_Route],
    ['DURATION / H',r.Firing_Duration_h,'KILN / MACHINE',r.Firing_Kiln || (r.Manufacturing_Method==='3D Printing'?'ROHDE-kiln':'-')]
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

  // Single tall Rhino render on the LEFT. This merges the old Photo/02
  // footprint into the main figure; the separate second-photo box is removed.
  const hero=asset.model || asset.photos?.[0] || null;
  bg(pdf,10,33,101,137,[246,246,242]);
  if(hero){
    try { photoFit(pdf,hero,11,34,99,135); }
    catch(err){console.warn('PDF module hero:',err);}
  }else if(!drawGcode3D(pdf,asset.gcode,14,39,93,124)) {
    print(pdf,'NO 3D MODEL',35,104,65,8,false,grey);
  }
  frame(pdf,10,33,101,137);
  label(pdf,asset.model?'RHINO / MODULE 3D':'MODULE VISUAL',10,173.6);

  // Upper RIGHT: independent, vector G-code axonometric.
  box(pdf,114,33,53,73,'G-CODE / 3D AXONOMETRIC');
  if(!drawGcode3D(pdf,asset.gcode,116,41,49,63,9500)) {
    label(pdf,'NO G-CODE LINK',123,70);
  }

  // Lower RIGHT: latest uploaded site photo only. Older photos remain stored.
  box(pdf,114,109,53,61,'SITE PHOTO / 01');
  if(asset.photos?.[0]){
    try { photoThumbnail(pdf,asset.photos[0],115,116,51,53); }
    catch(err){console.warn('Site photo:',err);}
  }else label(pdf,'NO UPLOADED PHOTO',120,139);

  // Mix recipe is independent from annotations and module notes.
  stroke(pdf,10,175.2,167,175.2,[75,79,72],.17);
  label(pdf,'MATERIAL COMPOSITION / RECIPE',10,179.4);
  const recipe=wrap(pdf,r.Material_Details,156,5);
  recipe.lines.forEach((txt,i)=>print(pdf,txt,10,184+i*2.7,156,recipe.size,false,ink));
  const end=table(pdf,r);
  if(end>197)console.warn('Catalogue: table exceeds footer',end);
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
