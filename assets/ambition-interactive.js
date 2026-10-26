/* Random editorial cuts across existing architectural illustrations.
   Deliberately no movement or construction narrative. */
(function(){
  "use strict";
  const poster=document.getElementById("poster-01");
  if(!poster)return;
  const layers=[...poster.querySelectorAll(".ambition-slide")];
  if(layers.length!==2)return;
  const sources=[
    "../assets/exhibition/ambition-stacked.png",
    "../assets/exhibition/hero-chain.png",
    "../assets/exhibition/hero-chain-secondary-outline.svg"
  ];
  const cache=sources.map(src=>{
    const img=new Image();
    img.decoding="async";
    img.src=src;
    return img;
  });
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible=false,clock=0,active=0,shown=0,history=[0],working=false;
  function choose(){
    let possible=sources.map((_,i)=>i).filter(i=>i!==shown&&!history.includes(i));
    if(!possible.length)possible=sources.map((_,i)=>i).filter(i=>i!==shown);
    return possible[Math.floor(Math.random()*possible.length)];
  }
  function next(){
    if(!visible||document.hidden||reduced.matches||working)return;
    working=true;
    const n=choose(),target=layers[1-active],previous=layers[active];
    const candidate=cache[n];
    if(!candidate.complete){
      const ready=()=>{candidate.removeEventListener("load",ready);candidate.removeEventListener("error",ready);working=false;if(visible&&!document.hidden&&!reduced.matches) schedule();};
      candidate.addEventListener("load",ready,{once:true});
      candidate.addEventListener("error",ready,{once:true});
      return;
    }
    if(candidate.naturalWidth===0){working=false;schedule();return;}
    target.src=sources[n];
    // Most transitions are sharp editorial cuts, occasionally a very short dissolve.
    const hard=Math.random()<.76;
    layers.forEach(layer=>layer.classList.toggle("is-hard-cut",hard));
    target.classList.add("is-visible");
    previous.classList.remove("is-visible");
    active=1-active;shown=n;
    history=[history[history.length-1],n];
    working=false;schedule();
  }
  function schedule(){
    clearTimeout(clock);clock=0;
    if(!visible||document.hidden||reduced.matches)return;
    clock=setTimeout(next,1350+Math.random()*1350);
  }
  if("IntersectionObserver" in window){
    new IntersectionObserver(entries=>{
      visible=entries[0].isIntersecting;
      schedule();
    },{rootMargin:"90px 0px",threshold:.02}).observe(poster);
  }else{visible=true;schedule();}
  document.addEventListener("visibilitychange",schedule);
  if(reduced.addEventListener)reduced.addEventListener("change",schedule);
  poster.addEventListener("keydown",function(event){
    if(event.target!==poster)return;
    if(event.key==="Enter"||event.key===" "){event.preventDefault();poster.click();}
  });
})();