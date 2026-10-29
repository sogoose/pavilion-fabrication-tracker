/* Viewer-only archive UI. Server grants and storage policies enforce the lock. */
(()=>{
  'use strict';
  if(!window.PAVILION_CONFIG?.readOnly)return;
  const actions='#chapterFileUpload,#exEditorHeaderButton,.wf-page-edit,#futureVideoUploadButton,#futureVideoUploadInput,#futureVideoUploadStatus,.wf-edit-trigger,.wf-editor-page-trigger,.wf-editor-login,.editorBox,#excelInput,#uploadGCode,#gcodeInput,#uploadModulePhoto,#modulePhotoInput,#stampNow,[data-photo-action],.mm-open,#landingGalleryEdit,#landingGalleryUpload,#landingGallerySave,.legendColorInput';
  const fields='#detailPanel [data-field]';
  const style=document.createElement('style');
  style.textContent=actions+'{display:none!important} #exhibitionEditorDialog,.wf-editor-dialog{display:none!important} #detailPanel [data-field]:disabled{opacity:1;color:inherit;-webkit-text-fill-color:currentColor;cursor:default}';
  document.head.append(style);
  const lock=()=>{
    document.querySelectorAll(actions+','+fields).forEach(el=>{
      if('disabled' in el&&!el.disabled)el.disabled=true;
      if(el.matches(actions)){
        if(!el.hidden)el.hidden=true;
        if(el.type==='file'){const label=el.closest('label');if(label&&!label.hidden)label.hidden=true;}
      }
    });
    document.querySelectorAll('.wf-editor-footer button').forEach(el=>{el.hidden=true;el.disabled=true});
  };
  for(const type of ['click','change','input','submit'])document.addEventListener(type,event=>{
    if(event.target instanceof Element&&event.target.closest(actions+','+fields+',#exhibitionEditorDialog,.wf-editor-dialog')){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  document.addEventListener('dblclick',event=>{if(event.target instanceof Element&&event.target.closest('#workflowView')){event.preventDefault();event.stopImmediatePropagation()}},true);
  new MutationObserver(lock).observe(document.documentElement,{childList:true,subtree:true});
  lock();
})();
