/* Chapter file archive: public downloads, edits via GitHub-authenticated upload.
   GitHub Pages has no server and never receives writer credentials. */
(function(){
"use strict";
const folder="assets/exhibition/downloads/";
const api="https://api.github.com/repos/sogoose/pavilion-fabrication-tracker/contents/";
const upload="https://github.com/sogoose/pavilion-fabrication-tracker/upload/main/";
const root=document.getElementById("chapterDownloadList");
const uploadLink=document.getElementById("chapterFileUpload");
if(!root||!uploadLink)return;
const memory={};
let requested=0;
function clearList(){root.replaceChildren();}
const formatSize=size=>{
 if(size<1024)return size+" B";
 if(size<1048576)return (size/1024).toFixed(0)+" KB";
 return (size/1048576).toFixed(1)+" MB";
};
function drawFiles(files){
 root.replaceChildren();
 if(!files.length){
  clearList();
  return;
 }
 files.forEach(file=>{
  const row=document.createElement("div");row.className="chapter-downloads-row";
  const a=document.createElement("a");
  a.textContent=file.name;
  a.href=file.download_url;
  a.setAttribute("download",file.name);
  a.setAttribute("target","_blank");
  a.rel="noopener noreferrer";
  const size=document.createElement("span");size.textContent=formatSize(file.size||0)+"  ↗";
  row.append(a,size);root.append(row);
 });
}
window.loadChapterDownloads=async function(chapter){
 const num=String(chapter).padStart(2,"0");
 const serial=++requested;
 uploadLink.href=upload+folder+num;
 if(memory[num]){drawFiles(memory[num]);return;}
 clearList();
 try{
  const response=await fetch(api+folder+num+"?ref=main",{headers:{"Accept":"application/vnd.github+json"}});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const items=await response.json();
  if(!Array.isArray(items))throw new Error("Unexpected directory response");
  const files=items.filter(x=>x&&x.type==="file"&&!/^(README|\.gitkeep)/i.test(x.name||"")&&
   typeof x.download_url==="string"&&
   /^https:\/\/raw\.githubusercontent\.com\/sogoose\/pavilion-fabrication-tracker\//.test(x.download_url))
   .sort((a,b)=>a.name.localeCompare(b.name));
  memory[num]=files;
  if(serial===requested)drawFiles(files);
 }catch(err){
  if(serial===requested)clearList();
 }
};
// Direct #chapter-01...05 links can open before this deferred script executes.
const deepLink=location.hash.match(/^#chapter-0?([1-5])$/);
const activeDialog=document.getElementById("chapterDialog");
if(activeDialog&&activeDialog.open&&deepLink)window.loadChapterDownloads(Number(deepLink[1]));
})();