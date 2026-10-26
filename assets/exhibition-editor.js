/* PRINT("HELLO, EARTH")³ — Supabase exhibition content + storage editor.
 * Readers need no account. Database and bucket RLS enforce editor membership.
 * Never ship private service keys, shared passwords or public writer policies. */
(()=>{
"use strict";
const root=window.PAVILION_CONFIG||{};
const dialog=document.getElementById("exhibitionEditorDialog");
const opener=document.getElementById("chapterFileUpload");
const archiveList=document.getElementById("chapterDownloadList");
const section=document.getElementById("chapterDialog");
if(!root.supabaseUrl||!root.supabaseAnonKey||!window.supabase||!dialog||!opener)return;
const client=window.supabase.createClient(root.supabaseUrl,root.supabaseAnonKey);
const BUCKET="pavilion-exhibition-files",TABLE="pavilion_exhibition_chapters";
const ids={
 title:"exEditorTitle",question:"exEditorQuestion",questionLabel:"exEditorQuestionLabel",
 storyLabel:"exEditorStoryLabel",paragraphs:"exEditorBody",links:"exEditorLinks"
};
const $=id=>document.getElementById(id);
let active=1,authorized=false,draft=null,busy=false;
const store={};
const normalizeURL=(u)=>{
 try{const parsed=new URL(u,location.href);return /^(https?:)$/.test(parsed.protocol)?parsed.href:""}catch{return ""}
};
const escapeText=v=>String(v==null?"":v);
const titleNum=n=>String(n).padStart(2,"0");
const filesize=n=>n<1024?n+" B":n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";
const status=(message,isError=false)=>{
  for(const id of ["exEditorStatus","exEditorAuthStatus"]){
    const el=$(id);if(!el)continue;
    el.textContent=message||"";el.style.color=isError?"#af4439":"";
  }
};
const base=n=>window.helloEarthGetChapter?.(n)||null;
const latest=n=>({...base(n),...(store[n]||{})});
function publicFiles(chapter){
 if(!archiveList)return;
 archiveList.replaceChildren();
 const files=store[chapter]?.files||[];
 files.forEach(item=>{
   if(!normalizeURL(item.url))return;
   const row=document.createElement("div");row.className="chapter-downloads-row";
   const a=document.createElement("a");a.textContent=item.name||"FILE";a.href=normalizeURL(item.url);
   a.target="_blank";a.rel="noopener noreferrer";a.download=item.name||"";
   const meta=document.createElement("span");meta.textContent=filesize(item.size||0)+" ↗";
   row.append(a,meta);archiveList.append(row);
 });
}
window.loadChapterDownloads=chapter=>publicFiles(chapter);
async function hydrate(){
 const {data,error}=await client.from(TABLE).select("chapter_no,content");
 if(error){console.warn("Exhibition CMS read failed",error.message);return;}
 for(const item of data||[]){
   if(!item||!item.content||item.chapter_no<1||item.chapter_no>5)continue;
   store[item.chapter_no]=item.content;
   window.helloEarthApplyChapter?.(item.chapter_no,item.content);
 }
 publicFiles(window.helloEarthActiveChapter?.()||1);
}
function drawAssets(id,items,isSlide){
 const host=$(id);host.replaceChildren();
 if(!items.length){
   const empty=document.createElement("p");empty.className="ex-editor-empty";
   empty.textContent=isSlide?"No images yet. Add images below.":"No files uploaded.";
   host.append(empty);return;
 }
 items.forEach((asset,index)=>{
   const row=document.createElement("div");row.className="ex-editor-asset";
   if(isSlide){
     const img=document.createElement("img");img.src=normalizeURL(asset.src)||"";img.alt="";
     row.append(img);
   }
   const name=document.createElement("input");name.value=asset.title||asset.name||"";
   name.setAttribute("aria-label",isSlide?"Slide title":"Filename");
   name.addEventListener("input",()=>{if(isSlide)asset.title=name.value;else asset.name=name.value});
   const controls=document.createElement("div");controls.className="ex-asset-actions";
   if(isSlide){
     for(const [sign,diff] of [["↑",-1],["↓",1]]){
       const b=document.createElement("button");b.type="button";b.textContent=sign;
       b.setAttribute("aria-label",diff<0?"Move image earlier":"Move image later");
       b.disabled=index+diff<0||index+diff>=items.length;
       b.onclick=()=>{[items[index],items[index+diff]]=[items[index+diff],items[index]];refreshAssets()};
       controls.append(b);
     }
   }
   const remove=document.createElement("button");remove.type="button";remove.textContent="REMOVE";
   remove.setAttribute("aria-label","Remove "+(asset.title||asset.name||"asset"));
   remove.onclick=()=>{items.splice(index,1);refreshAssets();status("Removed from draft. Save to publish changes.")};
   controls.append(remove);
   row.append(name,controls);host.append(row);
 });
}
function refreshAssets(){
 drawAssets("exEditorSlides",draft.slides,true);
 drawAssets("exEditorFiles",draft.files,false);
}
function readForm(){
 const o={...draft};
 for(const name of ["heading","question","questionLabel","storyLabel"]){
   const id=name==="heading"?"title":name;
   o[name]=$(ids[id]).value.trim();
 }
 o.paragraphs=$(ids.paragraphs).value.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
 o.links=$(ids.links).value.split(/\r?\n/).map(line=>{
   const pos=line.indexOf("|");
   if(pos<0)return null;
   const label=line.slice(0,pos).trim();
   const url=normalizeURL(line.slice(pos+1).trim());
   return label&&url?{label,url}:null;
 }).filter(Boolean);
 return o;
}
function setFields(chapter){
 active=chapter;
 $("exEditorChapterNumber").textContent=titleNum(chapter);
 draft=JSON.parse(JSON.stringify(latest(chapter)));
 if(!Array.isArray(draft.slides))draft.slides=[];
 if(!Array.isArray(draft.files))draft.files=[];
 if(!Array.isArray(draft.links))draft.links=[];
 $(ids.title).value=escapeText(draft.heading);
 $(ids.question).value=escapeText(draft.question);
 $(ids.questionLabel).value=escapeText(draft.questionLabel);
 $(ids.storyLabel).value=escapeText(draft.storyLabel);
 $(ids.paragraphs).value=(draft.paragraphs||[]).join("\n\n");
 $(ids.links).value=draft.links.map(l=>l.label+" | "+l.url).join("\n");
 const labels=document.querySelector(".ex-editor-labels");
 labels.hidden=chapter>3;
 refreshAssets();
 status("Edit text, links and files, then save.");
}
async function verifyEditor(){
 const {data:{user},error}=await client.auth.getUser();
 if(error||!user){authorized=false;return false}
 const r=await client.from("pavilion_workflow_editors").select("user_id").eq("user_id",user.id).maybeSingle();
 authorized=!r.error&&!!r.data;
 return authorized;
}
async function showEditor(){
 active=window.helloEarthActiveChapter?.()||1;
 if(!dialog.open)dialog.showModal();
 status("");
 const ok=await verifyEditor();
 $("exEditorAuth").hidden=ok;
 $("exEditorForm").hidden=!ok;
 if(ok)setFields(active);
 else if((await client.auth.getUser()).data.user)status("Signed in, but this account is not an authorised editor.",true);
}
opener.addEventListener("click",e=>{e.preventDefault();showEditor()});
$("exEditorHeaderButton")?.addEventListener("click",e=>{e.preventDefault();showEditor()});
$("exEditorClose").addEventListener("click",()=>dialog.close());
$("exEditorLoginForm").addEventListener("submit",async e=>{
 e.preventDefault();status("Signing in…");
 const email=$("exEditorEmail").value.trim(),password=$("exEditorPassword").value;
 const {error}=await client.auth.signInWithPassword({email,password});
 $("exEditorPassword").value="";
 if(error){status("Sign-in failed: "+error.message,true);return;}
 if(!await verifyEditor()){
   status("This account is not on the authorised editor list.",true);
   await client.auth.signOut();return;
 }
 $("exEditorAuth").hidden=true;$("exEditorForm").hidden=false;
 setFields(active);
});
$("exEditorSignOut").onclick=async()=>{
 await client.auth.signOut();authorized=false;
 $("exEditorForm").hidden=true;$("exEditorAuth").hidden=false;status("Signed out.");
};
const slug=name=>{
 const parts=name.toLowerCase().replace(/[^a-z0-9.\-_]/g,"-").replace(/-+/g,"-");
 return parts.slice(-90)||"file";
};
async function uploadFiles(input,type){
 if(!authorized||busy)return;
 const files=Array.from(input.files||[]);
 if(!files.length)return;
 busy=true;status("Uploading "+files.length+" file(s) to Supabase…");
 const result=[];
 try{
   for(const file of files){
     if(file.size>50*1024*1024)throw Error(file.name+" is over the 50 MB upload limit");
     if(type==="slides"&&!/^image\/(png|jpeg|webp|avif)$/.test(file.type))throw Error("Slide images must be JPG, PNG, WebP or AVIF");
     const path="chapters/"+titleNum(active)+"/"+(type==="slides"?"slides/":"resources/")+crypto.randomUUID()+"-"+slug(file.name);
     const mime=file.type||"application/octet-stream";
     const {error}=await client.storage.from(BUCKET).upload(path,file,{contentType:mime,cacheControl:"3600",upsert:false});
     if(error)throw Error(file.name+": "+error.message);
     const url=client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
     result.push(type==="slides"?{src:url,title:file.name.replace(/\.[^.]+$/,""),path}:{name:file.name,url,path,size:file.size});
   }
   if(type==="slides"){
     if(active<=2)draft.slides=[result[result.length-1]];
     else draft.slides.push(...result);
   }else draft.files.push(...result);
   refreshAssets();
   status(result.length+" file(s) uploaded. Choose SAVE CHANGES to publish.");
 }catch(err){status(err.message||"Upload failed",true)}
 finally{busy=false;input.value="";}
}
$("exEditorSlideInput").addEventListener("change",e=>uploadFiles(e.target,"slides"));
$("exEditorFileInput").addEventListener("change",e=>uploadFiles(e.target,"files"));
$("exEditorForm").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!authorized||busy)return;
 busy=true;status("Saving…");
 try{
   if(!await verifyEditor())throw Error("Your edit permission has expired. Please sign in again.");
   const content=readForm();
   if(!content.heading)throw Error("Chapter title cannot be empty.");
   if(JSON.stringify(content).length>150000)throw Error("Content is too large.");
   const {data:{user}}=await client.auth.getUser();
   const {error}=await client.from(TABLE).upsert({
     chapter_no:active,content,updated_at:new Date().toISOString(),updated_by:user.id
   },{onConflict:"chapter_no"});
   if(error)throw Error(error.message);
   store[active]=content;
   window.helloEarthApplyChapter?.(active,content);
   publicFiles(active);
   status("Saved in Supabase. The public chapter is updated.");
   draft=JSON.parse(JSON.stringify(content));
 }catch(err){status(err.message||"Could not save changes",true);}
 finally{busy=false;}
});
window.addEventListener("helloearth:chapterchange",event=>{
 publicFiles(event.detail.chapter);
});
window.helloEarthEditor={refresh:hydrate};
hydrate();
if(section?.open)publicFiles(window.helloEarthActiveChapter?.()||1);
})();