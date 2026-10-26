/* Exhibition landing photo archive. Edit writes go only to this gallery table and
   image folder. Gallery editing can later be frozen via gallery_settings.editing_enabled. */
(()=>{
  "use strict";
  const config=window.PAVILION_CONFIG||{};
  const root=document.getElementById("landingGallery");
  if(!root)return;
  const $=id=>document.getElementById(id);
  const editor=$("landingGalleryEditor");
  const lightbox=$("landingGalleryLightbox");
  const grid=$("landingGalleryGrid");
  const TABLE="pavilion_exhibition_gallery_items";
  const SETTINGS="pavilion_exhibition_gallery_settings";
  const BUCKET="pavilion-exhibition-files";
  const allowed=new Set(["image/jpeg","image/png","image/webp","image/avif"]);
  let client=null,items=[],draft=[],toDelete=new Set(),editEnabled=false,busy=false,viewIndex=0;
  const status=(text,isError=false)=>{
    const el=$("landingGalleryStatus");
    el.textContent=text||"";
    el.style.color=isError?"#b3483c":"";
  };
  const publicUrl=path=>{
    if(!client||!/^chapters\/gallery\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$/i.test(path||""))return "";
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };
  function render(){
    grid.replaceChildren();
    $("landingGalleryCount").textContent=String(items.length).padStart(2,"0");
    $("landingGalleryEdit").hidden=!editEnabled;
    const empty=$("landingGalleryEmpty");
    empty.hidden=items.length>0||!editEnabled;
    if(items.length===0){root.hidden=!editEnabled;return;}
    root.hidden=false;
    items.forEach((item,index)=>{
      const src=publicUrl(item.storage_path);
      if(!src)return;
      const button=document.createElement("button");
      button.type="button";button.className="landing-gallery-item";
      button.setAttribute("aria-label",item.caption||"Open gallery photo "+(index+1));
      const img=document.createElement("img");
      img.src=src;img.alt=item.caption||"Fabrication archive photograph "+(index+1);
      img.loading=index<4?"eager":"lazy";
      img.decoding="async";
      button.append(img);
      button.addEventListener("click",()=>openLightbox(index));
      grid.append(button);
    });
  }
  function renderEditor(){
    const parent=$("landingGalleryEditItems");parent.replaceChildren();
    for(const [index,item] of draft.entries()){
      const row=document.createElement("div");row.className="landing-gallery-edit-item";
      const img=document.createElement("img");img.src=publicUrl(item.storage_path);img.alt="";
      const label=document.createElement("input");label.type="text";label.maxLength=160;
      label.value=item.caption||"";label.placeholder="Optional caption / alt text";
      label.setAttribute("aria-label","Caption for photo "+(index+1));
      label.addEventListener("input",()=>item.caption=label.value);
      const actions=document.createElement("div");actions.className="landing-gallery-edit-actions";
      for(const [symbol,dir,title] of [["↑",-1,"Move earlier"],["↓",1,"Move later"]]){
        const b=document.createElement("button");b.type="button";b.textContent=symbol;
        b.title=title;b.setAttribute("aria-label",title+" photo "+(index+1));
        b.disabled=index+dir<0||index+dir>=draft.length;
        b.addEventListener("click",()=>{
          [draft[index],draft[index+dir]]=[draft[index+dir],draft[index]];
          renderEditor();status("Order changed. Save to publish.");
        });
        actions.append(b);
      }
      const remove=document.createElement("button");remove.type="button";remove.textContent="REMOVE";
      remove.title="Remove photo from public gallery";
      remove.setAttribute("aria-label","Remove photo "+(index+1));
      remove.addEventListener("click",()=>{
        toDelete.add(item.id);draft.splice(index,1);renderEditor();
        status("Photo removed from draft. Save to publish.");
      });
      actions.append(remove);
      row.append(img,label,actions);parent.append(row);
    }
    $("landingGallerySave").disabled=busy;
  }
  function openEditor(){
    if(!editEnabled)return;
    draft=items.map(item=>({...item}));toDelete=new Set();status("");
    renderEditor();
    if(!editor.open)editor.showModal();
  }
  const setBusy=value=>{
    busy=value;
    $("landingGallerySave").disabled=value;
    $("landingGalleryUpload").disabled=value;
  };
  async function refresh(){
    if(!client)return;
    const [settings,records]=await Promise.all([
      client.from(SETTINGS).select("editing_enabled").eq("id",1).maybeSingle(),
      client.from(TABLE).select("id,storage_path,caption,display_order,created_at")
       .order("display_order",{ascending:true}).order("created_at",{ascending:true}).limit(120)
    ]);
    if(settings.error||records.error){
      console.warn("Photo archive could not load",settings.error||records.error);
      status("Photo archive could not load.",true);
      root.hidden=true;return;
    }
    editEnabled=settings.data?.editing_enabled===true;
    items=records.data||[];
    render();
    if(!editEnabled&&editor.open)editor.close();
  }
  async function toOptimizedPhoto(file){
    // Downsize large camera photos before upload. The source file is never changed.
    if(!("createImageBitmap" in window))return {blob:file,extension:(file.name.split(".").pop()||"jpg").toLowerCase()};
    try{
      const bitmap=await createImageBitmap(file);
      const edge=Math.max(bitmap.width,bitmap.height);
      const scale=Math.min(1,2600/edge);
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(bitmap.width*scale);
      canvas.height=Math.round(bitmap.height*scale);
      const ctx=canvas.getContext("2d");
      if(!ctx)throw Error("Canvas unsupported");
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close?.();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.88));
      if(blob?.type==="image/webp")return {blob,extension:"webp"};
    }catch(err){console.warn("Using original photo",err)}
    return {blob:file,extension:(file.name.split(".").pop()||"jpg").toLowerCase()};
  }
  async function upload(files){
    if(!editEnabled||busy||!files?.length)return;
    const chosen=Array.from(files);
    if(chosen.some(file=>!allowed.has(file.type)||file.size>50*1024*1024)){
      status("Please choose JPG, PNG, WebP or AVIF images under 50 MB.",true);return;
    }
    if(items.length+chosen.length>100){
      status("This photo archive supports up to 100 images.",true);return;
    }
    setBusy(true);
    let successes=0;
    try{
      for(const file of chosen){
        status("Uploading "+(successes+1)+" / "+chosen.length+"…");
        const {blob,extension}=await toOptimizedPhoto(file);
        const path="chapters/gallery/"+crypto.randomUUID()+"."+extension;
        const {error:uploadError}=await client.storage.from(BUCKET).upload(path,blob,{
          contentType:blob.type||file.type,upsert:false,cacheControl:"3600"
        });
        if(uploadError)throw new Error(uploadError.message);
        const record={
          storage_path:path,
          caption:"",
          display_order:Math.min(9999,Math.max(0,...items.map(item=>Number(item.display_order)||0))+10)
        };
        const {data,error}=await client.from(TABLE).insert(record)
          .select("id,storage_path,caption,display_order,created_at").single();
        if(error)throw new Error("Image uploaded but its gallery record was not saved: "+error.message);
        successes++;
        items.push(data);draft.push({...data});
        render();renderEditor();
      }
      status(successes+" photo(s) uploaded and published.");
    }catch(err){
      status("Upload stopped after "+successes+" image(s): "+(err.message||err),true);
    }finally{
      setBusy(false);
      $("landingGalleryUpload").value="";
    }
  }
  async function save(){
    if(!editEnabled||busy)return;
    setBusy(true);status("Saving captions and order…");
    try{
      // Verify the editor switch; database RLS independently blocks changes after freeze.
      const settings=await client.from(SETTINGS).select("editing_enabled").eq("id",1).single();
      if(settings.error||!settings.data?.editing_enabled)throw new Error("Gallery editing has been closed.");
      const rows=draft.map((item,index)=>({
        id:item.id,storage_path:item.storage_path,
        caption:(item.caption||"").trim().slice(0,160),display_order:index*10
      }));
      if(rows.length){
        const {error}=await client.from(TABLE).upsert(rows,{onConflict:"id"});
        if(error)throw new Error(error.message);
      }
      if(toDelete.size){
        const {error}=await client.from(TABLE).delete().in("id",[...toDelete]);
        if(error)throw new Error(error.message);
      }
      await refresh();
      draft=items.map(item=>({...item}));toDelete.clear();renderEditor();
      status("Saved. The gallery is updated.");
    }catch(err){
      status("Could not save: "+(err.message||err),true);
    }finally{setBusy(false)}
  }
  function updateLightbox(){
    const item=items[viewIndex];
    if(!item)return;
    const img=$("landingGalleryLargeImage");
    img.src=publicUrl(item.storage_path);
    img.alt=item.caption||"Gallery photo "+(viewIndex+1);
    $("landingGalleryLightCount").textContent=(viewIndex+1)+" / "+items.length;
    $("landingGalleryLightPrev").disabled=viewIndex===0;
    $("landingGalleryLightNext").disabled=viewIndex===items.length-1;
  }
  function openLightbox(index){
    viewIndex=index;updateLightbox();if(!lightbox.open)lightbox.showModal();
  }
  function stepLightbox(delta){
    viewIndex=Math.max(0,Math.min(items.length-1,viewIndex+delta));updateLightbox();
  }
  $("landingGalleryEdit").addEventListener("click",openEditor);
  $("landingGalleryEmptyAdd").addEventListener("click",()=>{
    openEditor();if(editor.open)$("landingGalleryUpload").click();
  });
  $("landingGalleryEditorClose").addEventListener("click",()=>editor.close());
  $("landingGalleryUpload").addEventListener("change",e=>upload(e.target.files));
  $("landingGallerySave").addEventListener("click",save);
  $("landingGalleryLightClose").addEventListener("click",()=>lightbox.close());
  $("landingGalleryLightPrev").addEventListener("click",()=>stepLightbox(-1));
  $("landingGalleryLightNext").addEventListener("click",()=>stepLightbox(1));
  document.addEventListener("keydown",e=>{
    if(!lightbox.open)return;
    if(e.key==="ArrowRight"){e.preventDefault();stepLightbox(1)}
    if(e.key==="ArrowLeft"){e.preventDefault();stepLightbox(-1)}
  });
  if(!config.supabaseUrl||!config.supabaseAnonKey||!window.supabase){
    console.warn("Photo gallery Supabase configuration unavailable.");root.hidden=true;return;
  }
  client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  refresh();
})();
