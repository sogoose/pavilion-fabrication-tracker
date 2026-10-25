/* Shared editorial galleries: asynchronous ASCII poster conversion and rail controls */
(function(){
  "use strict";
  const shadeRamp=" .,:;irsXA253hMHGS#9B&@";
  function drawAscii(el){
    const src=el.getAttribute("data-ascii-src");
    if(!src)return;
    const image=new Image();
    image.decoding="async";
    image.onload=function(){
      try{
        const columns=86,rows=65;
        const canvas=document.createElement("canvas");
        canvas.width=columns;canvas.height=rows;
        const ctx=canvas.getContext("2d",{willReadFrequently:true});
        if(!ctx)return;
        ctx.clearRect(0,0,columns,rows);
        const iw=image.naturalWidth||columns,ih=image.naturalHeight||rows;
        const scale=Math.min((columns-8)/iw,(rows-8)/ih);
        const w=iw*scale,h=ih*scale;
        ctx.drawImage(image,(columns-w)/2,(rows-h)/2,w,h);
        const pixels=ctx.getImageData(0,0,columns,rows).data;
        let ascii="";
        for(let y=0;y<rows;y++){
          let line="";
          for(let x=0;x<columns;x++){
            const n=4*(y*columns+x),alpha=pixels[n+3]/255;
            if(alpha<.09){line+=" ";continue;}
            const br=(pixels[n]*.2126+pixels[n+1]*.7152+pixels[n+2]*.0722)/255;
            const strength=Math.max(0,Math.min(1,(1-br)*.55+alpha*.56));
            const index=Math.min(shadeRamp.length-1,Math.floor(strength*(shadeRamp.length-1)));
            line+=shadeRamp[index];
          }
          ascii+=line.replace(/\s+$/,"")+"\n";
        }
        const pre=document.createElement("pre");
        pre.setAttribute("aria-hidden","true");
        pre.textContent=ascii;
        el.replaceChildren(pre);
        el.classList.add("is-ready");
      }catch(_err){ /* preserve fallback image if canvas read is blocked */ }
    };
    image.onerror=function(){el.classList.remove("is-ready")};
    image.src=new URL(src,document.baseURI).href;
  }
  function setupRail(rail){
    let originX=0, originScroll=0, moved=false, dragging=false;
    const buttons=document.querySelectorAll('[data-rail-target="'+rail.id+'"]');
    function updateArrows(){
      const max=Math.max(0,rail.scrollWidth-rail.clientWidth-1);
      buttons.forEach(btn=>btn.disabled=btn.dataset.railDir==="prev"?rail.scrollLeft<=2:rail.scrollLeft>=max);
    }
    buttons.forEach(btn=>btn.addEventListener("click",function(){
      const card=rail.querySelector(".ed-card");
      const n=(card?.getBoundingClientRect().width||rail.clientWidth*.78)+16;
      rail.scrollBy({left:(btn.dataset.railDir==="prev"?-1:1)*n,behavior:"smooth"});
    }));
    rail.addEventListener("scroll",updateArrows,{passive:true});
    rail.addEventListener("pointerdown",function(e){
      if(e.pointerType!=="mouse"||e.button!==0)return;
      originX=e.clientX;originScroll=rail.scrollLeft;moved=false;dragging=true;
    });
    window.addEventListener("pointermove",function(e){
      if(!dragging)return;
      const delta=e.clientX-originX;
      if(Math.abs(delta)>7){moved=true;rail.scrollLeft=originScroll-delta;}
    },{passive:true});
    window.addEventListener("pointerup",function(){dragging=false});
    rail.addEventListener("click",function(e){
      if(!moved)return;
      e.preventDefault();e.stopPropagation();
      moved=false;
    },true);
    rail.addEventListener("keydown",function(e){
      if(e.target!==rail)return;
      if(e.key==="ArrowRight"||e.key==="ArrowLeft"){
        e.preventDefault();
        rail.scrollBy({left:(e.key==="ArrowRight"?1:-1)*rail.clientWidth*.7,behavior:"smooth"});
      }
    });
    updateArrows();
    window.addEventListener("resize",updateArrows,{passive:true});
  }
  document.querySelectorAll(".ed-ascii").forEach(drawAscii);
  document.querySelectorAll(".ed-rail").forEach(setupRail);
})();
