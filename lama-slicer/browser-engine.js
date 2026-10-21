/* Independent LAMA browser geometry workspace.
   Browser toolpaths are NOT bit-for-bit equivalent to the original Python N1/N2 algorithms.
   Never run generated robot instructions without verifying in the original production pipeline. */
let triangles = null, bounds = null, shapeName = 'part', layers = null, previewEdges = [];
const round = n => Number(n.toFixed(3));
const tell = (kind,data={}) => postMessage(Object.assign({kind},data));
const key = p => Math.round(p[0]*20)+','+Math.round(p[1]*20);
function parseSTL(buffer) {
 const view = new DataView(buffer), bytes=buffer.byteLength;
 const n=bytes>=84?view.getUint32(80,true):0;
 const binary = bytes>=84 && 84+n*50===bytes && n>0;
 const tris=[];
 if(binary) {
   const stop=Math.min(n,350000);
   for(let i=0;i<stop;i++){
     const p=84+i*50+12, v=[];
     for(let j=0;j<9;j++) v.push(view.getFloat32(p+j*4,true));
     if(v.every(Number.isFinite)) tris.push(v);
   }
 } else {
   const txt=new TextDecoder().decode(buffer), points=[];
   const re=/vertex\s+([\-\deE+.]+)\s+([\-\deE+.]+)\s+([\-\deE+.]+)/ig;
   let m;
   while((m=re.exec(txt)) && points.length<1050000){
     points.push(+m[1],+m[2],+m[3]);
     if(points.length===9){if(points.every(Number.isFinite))tris.push(points.splice(0,9));else points.length=0;}
   }
 }
 if(!tris.length)throw Error('The file contains no readable STL triangles.');
 return tris;
}
function parseOBJ(buffer) {
 const text=new TextDecoder().decode(buffer), verts=[],tris=[];
 for(const line of text.split(/\r?\n/)){
   if(line.startsWith('v ')){
     const v=line.trim().split(/\s+/).slice(1,4).map(Number);
     if(v.length===3 && v.every(Number.isFinite))verts.push(v);
   } else if(line.startsWith('f ')){
     const indices=line.trim().split(/\s+/).slice(1).map(x=>{
       const k=parseInt(x.split('/')[0],10);return k<0?verts.length+k:k-1;
     });
     for(let j=1;j+1<indices.length;j++){
       const a=verts[indices[0]],b=verts[indices[j]],c=verts[indices[j+1]];
       if(a&&b&&c)tris.push([...a,...b,...c]);
     }
   }
 }
 if(!tris.length)throw Error('No triangle faces found in OBJ.');
 return tris;
}
function calcBounds(tris){
 const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
 for(const t of tris)for(let j=0;j<9;j++) {
   const a=j%3; if(t[j]<mn[a])mn[a]=t[j];if(t[j]>mx[a])mx[a]=t[j];
 }
 const cx=(mn[0]+mx[0])/2,cy=(mn[1]+mx[1])/2,z0=mn[2];
 for(const t of tris)for(let j=0;j<9;j+=3){t[j]-=cx;t[j+1]-=cy;t[j+2]-=z0;}
 return {min:[mn[0]-cx,mn[1]-cy,0],max:[mx[0]-cx,mx[1]-cy,mx[2]-z0],
   width:mx[0]-mn[0],depth:mx[1]-mn[1],height:mx[2]-mn[2],count:tris.length};
}
function polygonArea(p){
 let a=0;for(let i=0;i<p.length;i++){
 const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1];}
 return a/2;
}
function lineIntersection(a,b,c,d){
 const x=b[0]-a[0],y=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1],den=x*v-y*u;
 if(Math.abs(den)<1e-9)return [(b[0]+c[0])/2,(b[1]+c[1])/2];
 const t=((c[0]-a[0])*v-(c[1]-a[1])*u)/den;return [a[0]+t*x,a[1]+t*y];
}
function inset(poly,d) {
 const s=Math.sign(polygonArea(poly));if(!s)return null;
 const lines=poly.map((a,i)=>{
   const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
   if(len<1e-7)return null;
   const nx=-dy/len*s*d,ny=dx/len*s*d;
   return [[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny]];
 });
 if(lines.some(x=>!x))return null;
 const out=lines.map((line,i)=>{
   const q=lineIntersection(...lines[(i+lines.length-1)%lines.length],...line);
   const pt=poly[i],length=Math.hypot(q[0]-pt[0],q[1]-pt[1]);
   if(length>Math.max(3*d,10))return [(line[0][0]+lines[(i+lines.length-1)%lines.length][1][0])/2,(line[0][1]+lines[(i+lines.length-1)%lines.length][1][1])/2];
   return q;
 });
 if(Math.abs(polygonArea(out))<1 || Math.sign(polygonArea(out))!==s)return null;
 return out;
}
function contourAt(z) {
 const segs=[], eps=1e-7;
 for(const t of triangles){
   const points=[[t[0],t[1],t[2]],[t[3],t[4],t[5]],[t[6],t[7],t[8]]];
   const crossings=[];
   for(let k=0;k<3;k++){
     const a=points[k],b=points[(k+1)%3],za=a[2]-z,zb=b[2]-z;
     if((za< -eps && zb>eps)||(za>eps && zb< -eps)){
       const q=za/(za-zb);crossings.push([a[0]+q*(b[0]-a[0]),a[1]+q*(b[1]-a[1])]);
     } else if(Math.abs(za)<eps && Math.abs(zb)>eps)crossings.push([a[0],a[1]]);
   }
   const uniq=[];
   for(const p of crossings)if(!uniq.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.001))uniq.push(p);
   if(uniq.length>=2 && Math.hypot(uniq[0][0]-uniq[1][0],uniq[0][1]-uniq[1][1])>.001)
     segs.push([uniq[0],uniq[1]]);
 }
 const graph=new Map(),visited=new Set(),rings=[];
 for(let i=0;i<segs.length;i++)for(let j=0;j<2;j++){
   const k=key(segs[i][j]);if(!graph.has(k))graph.set(k,[]);
   graph.get(k).push([i,j]);
 }
 for(let i=0;i<segs.length;i++){
   if(visited.has(i))continue;
   let id=i,other=1,ring=[],closed=false,start=key(segs[i][0]),limit=0;
   ring.push(segs[i][0]);
   while(limit++<segs.length+1){
     visited.add(id);
     const p=segs[id][other],pkey=key(p);
     if(pkey===start){closed=true;break;}
     ring.push(p);
     const neighbors=graph.get(pkey)||[];
     const next=neighbors.find(([ix])=>!visited.has(ix));
     if(!next)break;
     id=next[0];other=1-next[1];
   }
   if(closed&&ring.length>2&&Math.abs(polygonArea(ring))>0.3)rings.push(ring);
 }
 return rings;
}
function infill(polygons,spacing,angle){
 const cs=Math.cos(angle),sn=Math.sin(angle);
 const rot=p=>[p[0]*cs+p[1]*sn,-p[0]*sn+p[1]*cs];
 const inv=(x,y)=>[x*cs-y*sn,x*sn+y*cs];
 const p2=polygons.map(poly=>poly.map(rot));
 let mn=Infinity,mx=-Infinity;
 for(const poly of p2)for(const p of poly){mn=Math.min(mn,p[1]);mx=Math.max(mx,p[1]);}
 if(!Number.isFinite(mn))return [];
 const rows=[],maxLines=2500;
 for(let j=0,y=Math.ceil(mn/spacing)*spacing;y<=mx&&j<maxLines;y+=spacing,j++){
   const xs=[];
   for(const poly of p2)for(let i=0;i<poly.length;i++){
     const a=poly[i],b=poly[(i+1)%poly.length];
     if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){
       const s=(y-a[1])/(b[1]-a[1]);xs.push(a[0]+s*(b[0]-a[0]));
     }
   }
   xs.sort((a,b)=>a-b);
   for(let k=0;k+1<xs.length;k+=2) if(xs[k+1]-xs[k]>.35){
     let a=inv(xs[k],y),b=inv(xs[k+1],y);
     if(j%2)[a,b]=[b,a];
     rows.push([a,b]);
   }
 }
 return rows;
}
function createLayer(z,opt,i){
 const rings=contourAt(z),paths=[],w=+opt.nozzle;
 for(const ring of rings){
   for(let n=0;n<opt.shells;n++){
     const p=inset(ring,w*.5+n*w);
     if(p && p.length>2)paths.push({kind:'perimeter',points:[...p,p[0]]});
   }
 }
 if(opt.infill>0 && rings.length){
   const space=Math.max(w*1.1,w*100/opt.infill);
   const angles=opt.pattern==='cross'? [Math.PI/4,3*Math.PI/4] : [i%2?3*Math.PI/4:Math.PI/4];
   const gap=opt.pattern==='cross'?space*2:space;
   for(const a of angles)for(const segment of infill(rings,gap,a))
     paths.push({kind:'infill',points:segment});
 }
 return {z:round(z),paths,rings:rings.length};
}
function toGcode(all,opt){
 const machine=opt.machine,comau=machine!=='wasp';
 const name=String(opt.name||shapeName).replace(/[^a-z\d_-]/ig,'_');
 const arr=['; Browser-native geometry slice preview','; Experimental output; NOT original Python N1/N2','; VERIFY travel, home, flow and robot postprocessing before fabrication',
   '; Model: '+name,'; Machine: '+machine,'G21','G90','M82','G92 E0'];
 if(machine==='wasp')arr.push('; WASP CLAY: confirm bed setup / homing before use','G28');
 else arr.push('; ROBOT: robot-neutral Comau-style G-code; conversion and safety checks required');
 let e=0,last=null,dist=0;
 const f=n=>Number(n).toFixed(3),base=opt.extrusion;
 for(let li=0;li<all.length;li++){
   const L=all[li],z=L.z;arr.push(';LAYER:'+li+' Z:'+f(z));
   for(const path of L.paths){
     if(path.points.length<2)continue;
     let start=path.points[0],lift=Math.max(z+Math.max(5,+opt.layer*2),5);
     if(last)arr.push('G0 Z'+f(lift)+' F'+f(opt.travel*60));
     arr.push('G0 X'+f(start[0])+' Y'+f(start[1])+' F'+f(opt.travel*60));
     arr.push('G0 Z'+f(z)+' F'+f(opt.travel*60));
     for(let k=1;k<path.points.length;k++){
       const a=path.points[k-1],b=path.points[k],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
       if(d<.001)continue;
       dist+=d;e+=d*base;
       arr.push('G1 X'+f(b[0])+' Y'+f(b[1])+' Z'+f(z)+' E'+e.toFixed(5)+' F'+f(opt.speed*60));
     }
     last=path.points[path.points.length-1];
   }
 }
 arr.push('G0 Z'+f(bounds.height+20)+' F'+f(opt.travel*60));
 arr.push('M400','; END / VERIFY BEFORE PRINTING');
 return {name:name+(machine==='wasp'?'Wasp':'Comau')+'.gcode',text:arr.join('\n')+'\n',distance:round(dist)};
}
onmessage=async ev=>{
 const msg=ev.data||{};
 try{
   if(msg.type==='load'){
     const n=msg.name||'part',ext=n.split('.').pop().toLowerCase();
     triangles=ext==='obj'?parseOBJ(msg.buffer):parseSTL(msg.buffer);
     bounds=calcBounds(triangles);shapeName=n.replace(/\.[^.]*$/,'');
     const skip=Math.max(1,Math.ceil(triangles.length/2100));previewEdges=[];
     for(let j=0;j<triangles.length;j+=skip)previewEdges.push(triangles[j]);
     layers=null;tell('loaded',{bounds,edges:previewEdges});
   } else if(msg.type==='slice'){
     if(!triangles)throw Error('Please load an STL or OBJ model first.');
     const o=msg.options,layer=+o.layer,first=+o.first;
     if(layer<=0||first<=0)throw Error('Layer heights must be positive.');
     const total=Math.max(0,Math.ceil((bounds.height-first)/layer)+1);
     if(total>700)throw Error('This model requires '+total+' layers. Increase layer height to stay below the 700-layer safety limit.');
     if(total<1)throw Error('Model is shorter than the first layer height.');
     layers=[];
     for(let i=0;i<total;i++){
       let z=first+i*layer;
       if(z>=bounds.height)z=bounds.height-.001;
       const item=createLayer(z,o,i);
       layers.push(item);
       if(i%6===0)tell('progress',{percent:Math.round(100*(i+1)/total),message:'Computing contours '+(i+1)+' / '+total});
       if(i%12===0)await new Promise(r=>setTimeout(r,0));
     }
     let paths=0;for(const L of layers)paths+=L.paths.length;
     tell('sliced',{total:layers.length,paths,layer:layers[0],maxLayer:layers.length-1});
   } else if(msg.type==='layer'){
     if(!layers)throw Error('Slice the model first.');
     const i=Math.max(0,Math.min(layers.length-1,msg.index|0));
     tell('layer',{index:i,layer:layers[i]});
   }else if(msg.type==='gcode'){
     if(!layers)throw Error('Slice the model first.');
     tell('gcode',toGcode(layers,msg.options));
   }
 }catch(e){tell('error',{message:e.message||String(e)});}
};