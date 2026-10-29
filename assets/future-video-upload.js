/* THE FUTURE: same video canvas / static effects; Supabase controls only video src. */
(async()=>{
"use strict";
const cfg=window.PAVILION_CONFIG||{}, video=document.querySelector("#poster-05 .future-video"), button=document.getElementById("futureVideoUploadButton"), input=document.getElementById("futureVideoUploadInput");
if(!video||!button||!input||!window.supabase||!cfg.supabaseUrl||!cfg.supabaseAnonKey)return;
const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const bucket="pavilion-exhibition-files",table="pavilion_exhibition_future_video";
const status=document.getElementById("futureVideoUploadStatus");
function show(message){status.textContent=message||""}
function setVideo(path){
 if(!/^chapters\/05\/video\/[a-f0-9-]{36}\.mp4$/i.test(path||""))return;
 const url=client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
 video.pause();video.querySelector("source").src=url;
 video.load();video.defaultPlaybackRate=.5;video.playbackRate=.5;
 video.dispatchEvent(new Event("loadedmetadata"));
}
async function load(){
 const {data,error}=await client.from(table).select("storage_path").eq("id",1).maybeSingle();
 if(!error&&data?.storage_path)setVideo(data.storage_path);
}
button.addEventListener("click",()=>{if(!cfg.readOnly)input.click()});
input.addEventListener("change",async()=>{
 if(cfg.readOnly)return;
 const file=input.files?.[0];if(!file)return;
 if(file.size>50*1024*1024){show("Maximum video size: 50 MB");input.value="";return}
 if(file.type!=="video/mp4"){show("Please select an H.264 MP4 video");input.value="";return}
 button.disabled=true;show("Uploading video...");
 try{
  const path="chapters/05/video/"+crypto.randomUUID()+".mp4";
  const up=await client.storage.from(bucket).upload(path,file,{contentType:"video/mp4",upsert:false,cacheControl:"3600"});
  if(up.error)throw up.error;
  const save=await client.from(table).upsert({id:1,storage_path:path,updated_at:new Date().toISOString()},{onConflict:"id"});
  if(save.error)throw save.error;
  setVideo(path);show("Video updated. Existing visual effects preserved.");
 }catch(err){show("Upload failed: "+(err.message||err))}
 finally{button.disabled=false;input.value=""}
});
await load();
})();