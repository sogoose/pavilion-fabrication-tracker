/* THE AMBITION: animated masked modules cut from the existing 1706x2048
   transparent plate. Auto-loop, pointer-directed assembly, and manual modes.
   All runtime animation stops outside the viewport and under reduced motion. */
(function(){
  "use strict";
  const poster=document.getElementById("poster-01");
  if(!poster)return;
  const sheet=poster.querySelector(".ambition-sheet");
  const base=poster.querySelector(".ambition-body");
  const parts=Array.from(poster.querySelectorAll(".ambition-unit"));
  const control=poster.querySelector(".ambition-mode-button");
  const label=poster.querySelector(".ambition-status");
  const bar=poster.querySelector(".ambition-progress-fill");
  if(!sheet||!base||parts.length!==4||!control)return;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const fine=window.matchMedia("(hover:hover) and (pointer:fine)");
  const dock=[
    {x:.105,y:.375,rot:-7,depth:1.35},
    {x:.165,y:.304,rot: 5,depth:.82},
    {x:-.165,y:.213,rot:-6,depth:1.1},
    {x:-.075,y:.117,rot: 6,depth:.7}
  ];
  let frame=0,last=0,elapsed=0,visible=false,hover=false,manual=-1;
  let pointerX=0,pointerY=.5,parallaxX=0,parallaxY=0,assembly=0.05;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function updateControl(){
    const mode=manual===-1?"AUTO":manual===1?"ASSEMBLED":"EXPLODED";
    control.textContent=mode+"  ↔";
    control.setAttribute("aria-label",
      manual===-1?"Show assembled pavilion":manual===1?"Show exploded modules":"Resume automatic assembly");
    control.setAttribute("aria-pressed",String(manual!==-1));
  }
  function paint(time){
    const w=sheet.clientWidth,h=sheet.clientHeight;
    const target=manual!==-1?manual:
      hover&&fine.matches?clamp((pointerY-.17)/.65,0,1):
      .5-.5*Math.cos(elapsed*Math.PI*2/13700);
    assembly+=(target-assembly)*.075;
    parallaxX+=((hover?pointerX:Math.sin(elapsed/2700)*.28)-parallaxX)*.055;
    parallaxY+=((hover?(pointerY-.5)*2:Math.cos(elapsed/3500)*.18)-parallaxY)*.055;
    const isQuiet=reduced.matches;
    const a=isQuiet?0:assembly;
    parts.forEach((part,i)=>{
      const p=dock[i],float=isQuiet?0:Math.sin(elapsed/(1100+i*173)+i*1.2)*(1-a)*3.5;
      const dx=a*p.x*w+parallaxX*(13+p.depth*11);
      const dy=a*p.y*h+parallaxY*(5+p.depth*5)+float;
      const rot=a*p.rot+parallaxX*p.depth*1.1;
      const scale=1-a*.10;
      part.style.transform="translate3d("+dx.toFixed(2)+"px,"+dy.toFixed(2)+"px,0) rotate("+rot.toFixed(2)+"deg) scale("+scale.toFixed(4)+")";
      part.style.opacity=String(clamp(1-a*.92,.08,1));
    });
    base.style.transform="translate3d("+(parallaxX*3.0).toFixed(2)+"px,"+(parallaxY*2.5-a*4).toFixed(2)+"px,0)";
    if(bar)bar.style.width=(a*100).toFixed(1)+"%";
    if(label){
      label.textContent=manual===1?"ASSEMBLED SYSTEM":manual===0?"EXPLODED MODULES":
        hover&&fine.matches?"INTERACTIVE ASSEMBLY":a>.8?"ASSEMBLING":a<.2?"EXPLODED MODULES":"MODULAR CONFIGURATION";
    }
  }
  function tick(now){
    frame=0;
    if(!visible||document.hidden||reduced.matches){last=0;return;}
    if(last)elapsed+=Math.min(50,now-last);
    last=now;paint(now);
    frame=window.requestAnimationFrame(tick);
  }
  function sync(){
    if(frame)window.cancelAnimationFrame(frame);
    frame=0;last=0;
    if(reduced.matches){paint(0);return;}
    if(visible&&!document.hidden)frame=window.requestAnimationFrame(tick);
  }
  poster.addEventListener("pointermove",function(ev){
    if(!fine.matches||ev.pointerType==="touch")return;
    const rect=poster.getBoundingClientRect();
    pointerX=clamp((ev.clientX-rect.left)/rect.width*2-1,-1,1);
    pointerY=clamp((ev.clientY-rect.top)/rect.height,0,1);
    hover=true;
  },{passive:true});
  poster.addEventListener("pointerleave",()=>{hover=false;});
  poster.addEventListener("focusout",function(ev){
    if(!poster.contains(ev.relatedTarget))hover=false;
  });
  control.addEventListener("click",function(ev){
    ev.stopPropagation();
    manual=manual===-1?1:manual===1?0:-1;
    hover=false;
    updateControl();sync();
  });
  control.addEventListener("keydown",ev=>ev.stopPropagation());
  poster.addEventListener("keydown",function(ev){
    if(ev.target!==poster)return;
    if(ev.key==="Enter"||ev.key===" "){
      ev.preventDefault();poster.click();
    }
  });
  if("IntersectionObserver" in window){
    new IntersectionObserver(entries=>{
      visible=entries[0].isIntersecting;sync();
    },{rootMargin:"100px 0px",threshold:.01}).observe(poster);
  }else visible=true;
  document.addEventListener("visibilitychange",sync);
  if(typeof reduced.addEventListener==="function")reduced.addEventListener("change",sync);
  if("ResizeObserver" in window)new ResizeObserver(()=>paint(0)).observe(sheet);
  updateControl();paint(0);sync();
})();
