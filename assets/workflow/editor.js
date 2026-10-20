/* Shared Workflow editor. Everyone can edit text and file links without a login.
   Separate from the 3D Tracker, whose existing collaborative permissions remain intact. */
(() => {
  const root = document.getElementById('workflowView');
  const config = window.PAVILION_CONFIG || {};
  if (!root || !window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return;

  const PROJECT = config.projectId || 'pavilion-2026';
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const sections = new Map();
  const originals = new Map();
  const published = new Map();
  let editingId = null;

  const safeText = value => String(value == null ? '' : value);
  const trimLimit = (value, max) => safeText(value).trim().slice(0, max);
  const getSectionId = node => node.dataset.process || node.className.match(/wp-(computational|construction|environment|hrc)/)?.[1];
  const titleNode = node => node.querySelector('.wb-name, .wp-title');
  const bodyNode = node => node.querySelector('.wb-detail, .wp-description');
  const linkNode = node => node.querySelector('.wb-links, .wp-links');
  // File attachments share a dedicated, 25 MiB public workflow bucket.
  // Unknown extensions and active web/script formats are not accepted.
  const WORKFLOW_FILE_MIME = Object.freeze({
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    csv: 'text/csv', txt: 'text/plain', gcode: 'text/plain',
    '3dm': 'application/octet-stream',
    dxf: 'application/octet-stream', stl: 'application/octet-stream'
  });
  const MAX_WORKFLOW_FILE_BYTES = 25 * 1024 * 1024;
  const safeHref = value => {
    const href = safeText(value).trim();
    if (href === '#tracker') return href;
    try {
      const parsed = new URL(href);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch { return null; }
  };
  const parseCredits = node => {
    const rows = [...node.querySelectorAll('.wb-credit-row')].map(row => [
      row.querySelector('.wb-credits-key')?.textContent.trim() || '',
      row.querySelector('.wb-credits-names')?.textContent.trim() || ''
    ]);
    if (rows.length) return rows;
    const team = node.querySelector('.wp-members')?.textContent.trim();
    return team ? [['TEAM', team]] : [];
  };
  const snapshot = node => ({
    title: titleNode(node)?.textContent.trim() || '',
    description: bodyNode(node)?.querySelector('p')?.textContent.trim() || '',
    caption: node.querySelector('.wb-drawing figcaption')?.textContent.trim() || '',
    credits: parseCredits(node),
    links: [...node.querySelectorAll('.wb-links a, .wp-links a')].map(a => [
      a.textContent.replace(/\s*↗\s*$/, '').trim(), a.getAttribute('href') || ''
    ]),
    gallery: (() => { try { return JSON.parse(node.dataset.workflowGallery || '[]'); } catch (_) { return []; } })()
  });
  const apply = (id, value) => {
    const node = sections.get(id);
    if (!node || !value || typeof value !== 'object') return;
    const data = { ...originals.get(id), ...value };
    if (typeof data.title === 'string') titleNode(node).textContent = data.title;
    if (Array.isArray(data.gallery)) {
      node.dataset.workflowGallery = JSON.stringify(data.gallery.slice(0, 8).filter(url => safeHref(url) && url !== '#tracker'));
    }
    const captionNode = node.querySelector('.wb-drawing figcaption');
    if (captionNode && typeof data.caption === 'string') captionNode.textContent = data.caption;
    const body = bodyNode(node);
    const paragraph = body?.querySelector('p');
    if (paragraph && typeof data.description === 'string') paragraph.textContent = data.description;
    const credits = Array.isArray(data.credits) ? data.credits : [];
    const creditWrap = node.querySelector('.wb-credits');
    if (creditWrap) {
      creditWrap.replaceChildren();
      credits.forEach(pair => {
        if (!Array.isArray(pair)) return;
        const row = document.createElement('span'); row.className = 'wb-credit-row';
        const key = document.createElement('span'); key.className = 'wb-credits-key'; key.textContent = safeText(pair[0]);
        const names = document.createElement('span'); names.className = 'wb-credits-names'; names.textContent = safeText(pair[1]);
        row.append(key, names); creditWrap.append(row);
      });
    } else {
      const team = node.querySelector('.wp-members');
      if (team) team.textContent = credits.map(pair => Array.isArray(pair) ? pair[1] : '').filter(Boolean).join(' · ');
    }
    let linksWrap = linkNode(node);
    if (!linksWrap && body) {
      linksWrap = document.createElement('div');
      linksWrap.className = node.classList.contains('wp-island') ? 'wp-links' : 'wb-links';
      body.append(linksWrap);
    }
    if (linksWrap && Array.isArray(data.links)) {
      linksWrap.replaceChildren();
      data.links.forEach(pair => {
        if (!Array.isArray(pair)) return;
        const href = safeHref(pair[1]);
        if (!href) return;
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.textContent = safeText(pair[0]) + ' ↗';
        if (href === '#tracker') anchor.className = 'wb-tracker-link';
        else { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
        linksWrap.append(anchor);
      });
    }
    // If a previously linkless process gets a file link, hide its old placeholder.
    const placeholder = body?.querySelector('.wb-note');
    if (placeholder && linksWrap) placeholder.hidden = linksWrap.querySelectorAll('a').length > 0;
    node.querySelector('.wb-preview, .wp-island-summary')?.setAttribute('aria-label', 'View ' + data.title + ' details');
  };

  // Page labels and guide copy use the same owner-only storage as process notes.
  // Plain text is assigned through textContent, never as arbitrary HTML.
  const pageFields = [
    ['title', 'Main heading', '.wb-mast h1', 'input', 120],
    ['intro', 'Introduction', '.wb-intro', 'textarea', 1000],
    ['hint', 'Instruction label', '.wb-hint', 'input', 200],
    ['management_label', 'Construction Management heading', '.wb-management-label', 'input', 120],
    ['management_description', 'Construction Management notes', '.wb-management p', 'textarea', 1000],
    ['management_link_label', 'Construction Management link text', '.wb-management a', 'input', 140],
    ['phase_label', 'Fabrication heading', '.wb-phase strong', 'input', 120],
    ['phase_note', 'Fabrication phase note', '.wb-phase span', 'input', 120],
    ['drying_label', 'Drying label', '.wb-drying', 'input', 120],
    ['footer', 'Workflow footer', '.wb-bottom span:first-child', 'input', 180]
  ];
  const pageNodes = new Map(pageFields.map(field => [field[0], root.querySelector(field[2])]));
  const pageDefaults = Object.fromEntries(pageFields.map(field => [
    field[0], pageNodes.get(field[0])?.textContent.trim() || ''
  ]));
  const managementAnchor = root.querySelector('.wb-management a');
  pageDefaults.management_link_href = managementAnchor?.getAttribute('href') || '';
  const applyPage = value => {
    if (!value || typeof value !== 'object') return;
    pageFields.forEach(field => {
      const [id] = field;
      const element = pageNodes.get(id);
      if (!element || typeof value[id] !== 'string') return;
      if (id === 'title') {
        // Shared edits always retain the one-line Workflow heading.
        // Older drafts may contain the pointing-finger emoji; strip it gently.
        const main = document.createElement('span');
        main.className = 'wb-title-main';
        main.textContent = value[id].replace(/^\s*👇\s*/, '').trim();
        element.replaceChildren(main);
      } else {
        element.textContent = value[id];
      }
    });
    if (managementAnchor && typeof value.management_link_href === 'string') {
      const href = safeHref(value.management_link_href);
      if (href && href !== '#tracker') managementAnchor.href = href;
    }
  };

  root.querySelectorAll('details.wb-block, details.wp-island').forEach(node => {
    const id = getSectionId(node);
    if (!id || sections.has(id)) return;
    sections.set(id, node);
    originals.set(id, snapshot(node));
  });

  // Events are delegated so freshly edited file links keep working.
  root.addEventListener('click', event => {
    const anchor = event.target.closest('a.wb-tracker-link');
    if (anchor) {
      event.preventDefault();
      document.getElementById('navTracker')?.click();
    }
  });

  const actions = document.createElement('div');
  actions.className = 'wf-owner-actions';
  actions.innerHTML =
    '<button type="button" class="wf-page-edit">Edit page</button>' +
    '<span class="wf-editor-state">OPEN TEAM EDITING</span>';
  // Keep the controls at the end of the Workflow, away from the diagram.
  (root.querySelector('.wb-bottom') || root.querySelector('.wb-shell'))?.after(actions);
  const pageButton = actions.querySelector('.wf-page-edit');

  const dialog = document.createElement('dialog');
  dialog.className = 'wf-edit-dialog';
  dialog.innerHTML = '<form method="dialog" class="wf-editor-form">' +
    '<div class="wf-editor-heading"><strong>WORKFLOW / EDITOR</strong><button type="button" class="wf-editor-close" aria-label="Close">×</button></div>' +
    '<div class="wf-editor-fields"></div><p class="wf-editor-feedback" role="status" aria-live="polite"></p>' +
    '<div class="wf-editor-buttons"></div></form>';
  document.body.append(dialog);
  const fields = dialog.querySelector('.wf-editor-fields');
  const feedback = dialog.querySelector('.wf-editor-feedback');
  const buttons = dialog.querySelector('.wf-editor-buttons');
  const setFeedback = (message, error = false) => {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  };
  const addField = (label, value, type = 'textarea') => {
    const wrapper = document.createElement('label'); wrapper.className = 'wf-editor-field';
    const heading = document.createElement('span'); heading.textContent = label;
    const input = document.createElement(type === 'input' ? 'input' : 'textarea');
    if (type === 'input') input.type = 'text';
    input.value = safeText(value);
    wrapper.append(heading, input); fields.append(wrapper);
    return input;
  };
  const addButton = (label, onClick, className = '') => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.className = className;
    button.addEventListener('click', onClick);
    buttons.append(button); return button;
  };
  const closeDialog = () => { dialog.close(); editingId = null; };
  dialog.querySelector('.wf-editor-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });

  const showEditor = id => {
    if (!sections.has(id)) return;
    editingId = id;
    fields.replaceChildren(); buttons.replaceChildren(); setFeedback('');
    const data = { ...originals.get(id), ...published.get(id) };
    const title = addField('Title', data.title, 'input');
    const credits = addField('Participants — one ROLE | names per line',
      (data.credits || []).map(pair => pair.join(' | ')).join('\n'));
    const description = addField('Description', data.description);
    const caption = sections.get(id)?.querySelector('.wb-drawing figcaption')
      ? addField('Drawing caption', data.caption || '', 'input') : null;
    const links = addField('Files & external links — LABEL | https://... (one per line; #tracker also works)',
      (data.links || []).map(pair => pair.join(' | ')).join('\n'));
    const gallery = addField('Gallery photos — one HTTPS image URL per line (first photo is the cover)',
      (data.gallery || []).join('\n'));
    credits.rows = 3; description.rows = 4; links.rows = 4; gallery.rows = 4;
    const uploader = document.createElement('label'); uploader.className = 'wf-editor-field wf-photo-uploader';
    const uploaderLabel = document.createElement('span'); uploaderLabel.textContent = 'UPLOAD SMALL PHOTOS · JPG / PNG / WEBP · UP TO 8';
    const photoInput = document.createElement('input'); photoInput.type = 'file';
    photoInput.accept = 'image/jpeg,image/png,image/webp'; photoInput.multiple = true;
    uploader.append(uploaderLabel, photoInput); fields.append(uploader);
    const uploadHelp = document.createElement('p'); uploadHelp.className = 'wf-photo-help';
    uploadHelp.textContent = 'Photos are converted to WebP (up to 1200px) before upload. Click Save changes to publish them in the gallery.';
    fields.append(uploadHelp);
    const uploadButton = document.createElement('button'); uploadButton.type = 'button';
    uploadButton.className = 'wf-upload-photos'; uploadButton.textContent = '↑ Upload selected photos';
    fields.append(uploadButton);
    uploadButton.addEventListener('click', async () => {
      const images = [...photoInput.files];
      if (!images.length) { setFeedback('Select one or more photos first.', true); return; }
      const existing = gallery.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (existing.length + images.length > 8) { setFeedback('Maximum 8 photos per process.', true); return; }
      uploadButton.disabled = true;
      try {
        const toWebp = file => new Promise((resolve, reject) => {
          if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) {
            reject(new Error('Only JPG, PNG or WebP photos up to 15MB are supported.')); return;
          }
          const objectUrl = URL.createObjectURL(file);
          const image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            const encode = quality => canvas.toBlob(blob => {
              if (!blob) { reject(new Error('Image conversion failed.')); return; }
              if (blob.size > 650000 && quality > .48) encode(quality - .12);
              else resolve(blob);
            }, 'image/webp', quality);
            encode(.78);
          };
          image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read ' + file.name)); };
          image.src = objectUrl;
        });
        const uploaded = [];
        for (const file of images) {
          setFeedback('Compressing and uploading ' + file.name + '…');
          const blob = await toWebp(file);
          const key = PROJECT + '/workflow/' + id + '/' + Date.now() + '-' +
            Math.random().toString(36).slice(2, 12) + '.webp';
          const bucket = client.storage.from('pavilion-module-photos');
          const { error } = await bucket.upload(key, blob, {contentType:'image/webp', cacheControl:'3600', upsert:false});
          if (error) throw error;
          const { data: publicData } = bucket.getPublicUrl(key);
          if (!publicData?.publicUrl) throw new Error('Uploaded photo URL was not returned.');
          uploaded.push(publicData.publicUrl);
          gallery.value = [...existing, ...uploaded].join('\n');
        }
        photoInput.value = '';
        setFeedback('Uploaded ' + uploaded.length + ' photo(s). Click Save changes to publish gallery.');
      } catch (error) {
        setFeedback('Photo upload failed: ' + (error.message || 'Please try again.'), true);
      } finally { uploadButton.disabled = false; }
    });
    // Upload PDFs, spreadsheets and digital fabrication source files directly.
    // Uploaded URLs join the existing shared links list; the user still needs
    // Save changes to publish the updated list to the Workflow database.
    const fileWrap = document.createElement('label');
    fileWrap.className = 'wf-editor-field wf-file-uploader';
    const fileLabel = document.createElement('span');
    fileLabel.textContent = 'ATTACH FILES · MAX 25 MB EACH';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = Object.keys(WORKFLOW_FILE_MIME).map(ext => '.' + ext).join(',');
    fileWrap.append(fileLabel, fileInput);
    fields.append(fileWrap);
    const fileHelp = document.createElement('p');
    fileHelp.className = 'wf-file-help';
    fileHelp.textContent = 'PDF · DOCX · XLSX · PPTX · ZIP · CSV · TXT · 3DM · GCODE · DXF · STL. Shared files are accessible to anyone with the link.';
    fields.append(fileHelp);
    const fileUploadBtn = document.createElement('button');
    fileUploadBtn.type = 'button';
    fileUploadBtn.className = 'wf-upload-files';
    fileUploadBtn.textContent = '+ Upload files';
    fields.append(fileUploadBtn);
    let uploadingFiles = false;
    fileUploadBtn.addEventListener('click', async () => {
      if (uploadingFiles) return;
      const selected = [...fileInput.files];
      if (!selected.length) { setFeedback('Choose one or more files to attach.', true); return; }
      const existing = links.value.split(/\r?\n/).filter(line => line.trim());
      if (existing.length + selected.length > 24) {
        setFeedback('Maximum 24 links and attached files per chapter.', true); return;
      }
      const checked = [];
      for (const file of selected) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!ext || !Object.hasOwn(WORKFLOW_FILE_MIME, ext)) {
          setFeedback('Unsupported file type: ' + file.name, true); return;
        }
        if (!file.size || file.size > MAX_WORKFLOW_FILE_BYTES) {
          setFeedback('Files must be non-empty and at most 25 MB: ' + file.name, true); return;
        }
        checked.push({ file, ext });
      }
      uploadingFiles = true;
      fileUploadBtn.disabled = true;
      const saveButton = buttons.querySelector('.wf-editor-save');
      if (saveButton) saveButton.disabled = true;
      const uploaded = [];
      try {
        for (const {file, ext} of checked) {
          setFeedback('Uploading ' + file.name + ' (' + (uploaded.length + 1) + '/' + checked.length + ')…');
          const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
          const key = PROJECT + '/workflow/' + id + '/' + uuid + '.' + ext;
          const storage = client.storage.from('pavilion-workflow-files');
          const {error} = await storage.upload(key, file, {
            contentType: WORKFLOW_FILE_MIME[ext], upsert:false, cacheControl:'3600'
          });
          if (error) throw error;
          const {data: result} = storage.getPublicUrl(key);
          if (!result?.publicUrl || !safeHref(result.publicUrl)) {
            throw new Error('Uploaded file URL was not returned.');
          }
          const safeName = file.name.replace(/[\r\n|]/g, ' ').trim().slice(0, 100);
          uploaded.push(safeName + ' | ' + result.publicUrl);
          links.value = [...existing, ...uploaded].join('\n');
        }
        fileInput.value = '';
        setFeedback('Uploaded ' + uploaded.length + ' file(s). Click Save changes to publish the attachments.');
      } catch (error) {
        setFeedback('File upload failed: ' + (error.message || 'Please try again.'), true);
      } finally {
        uploadingFiles = false;
        fileUploadBtn.disabled = false;
        if (saveButton) saveButton.disabled = false;
      }
    });
    addButton('Save changes', async () => {
      if (uploadingFiles) { setFeedback('Wait for the files to finish uploading.', true); return; }
      const parseRows = (value, maxRows) => value.split(/\r?\n/).filter(line => line.trim()).slice(0, maxRows).map(line => {
        const index = line.indexOf('|');
        if (index < 0) throw new Error('Each participant/link row needs a | separator.');
        return [trimLimit(line.slice(0, index), 100), trimLimit(line.slice(index + 1), 1000)];
      });
      let value;
      try {
        value = {
          title: trimLimit(title.value, 90),
          description: trimLimit(description.value, 1800),
          ...(caption ? { caption: trimLimit(caption.value, 220) } : {}),
          credits: parseRows(credits.value, 12).map(pair => [pair[0], pair[1].slice(0, 400)]),
          links: parseRows(links.value, 24),
          gallery: gallery.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 9)
        };
        if (!value.title) throw new Error('A title is required.');
        for (const pair of value.links) if (!pair[0] || !safeHref(pair[1])) throw new Error('Links must use https:// or #tracker.');
        if (value.gallery.length > 8 || value.gallery.some(url => !safeHref(url) || url === '#tracker'))
          throw new Error('Gallery supports up to 8 HTTPS image URLs.');
      } catch (err) { setFeedback(err.message, true); return; }
      setFeedback('Saving Workflow…');
      try {
        const { error } = await client.from('pavilion_workflow_content').upsert({
          project_id: PROJECT, section_id: id, content: value, updated_by: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'project_id,section_id' });
        if (error) throw error;
      } catch (error) {
        setFeedback('Save failed: ' + (error.message || 'Please try again.'), true);
        return;
      }
      published.set(id, value); apply(id, value); closeDialog();
    }, 'wf-editor-save');
    addButton('Cancel', closeDialog);
    dialog.showModal();
    const section = sections.get(id);
    const focusUpload = section?.dataset.wfFocus === 'files';
    if (section) delete section.dataset.wfFocus;
    if (focusUpload) {
      fileInput.focus();
      fileInput.scrollIntoView({block:'center', behavior:'instant'});
    } else title.focus();
  };

  const showPageEditor = () => {
    // Available to all visitors; Supabase RLS allows only Workflow-scoped writes.
    editingId = '__page';
    fields.replaceChildren(); buttons.replaceChildren(); setFeedback('');
    const data = { ...pageDefaults, ...(published.get('__page') || {}) };
    const inputs = new Map();
    pageFields.forEach(([key, label, selector, type]) => {
      if (pageNodes.get(key)) inputs.set(key, addField(label, data[key], type));
    });
    const linkHref = addField('Construction Management file URL (https://...)',
      data.management_link_href || '', 'input');
    addButton('Save page', async () => {
      const value = {};
      pageFields.forEach(([key, label, selector, type, max]) => {
        if (inputs.has(key)) value[key] = trimLimit(inputs.get(key).value, max);
      });
      value.management_link_href = trimLimit(linkHref.value, 1700);
      if (!value.title) { setFeedback('Please enter a page title.', true); return; }
      if (!safeHref(value.management_link_href) || value.management_link_href === '#tracker') {
        setFeedback('The Construction Management URL must begin with https://', true); return;
      }
      setFeedback('Saving Workflow…');
      try {
        const { error } = await client.from('pavilion_workflow_content').upsert({
          project_id: PROJECT, section_id: '__page', content: value, updated_by: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'project_id,section_id' });
        if (error) throw error;
      } catch (error) {
        setFeedback('Save failed: ' + (error.message || 'Please try again.'), true);
        return;
      }
      published.set('__page', value); applyPage(value); closeDialog();
    }, 'wf-editor-save');
    addButton('Cancel', closeDialog);
    dialog.showModal();
  };
  pageButton.addEventListener('click', showPageEditor);
  root.querySelector('.wb-mast h1')?.addEventListener('dblclick', event => {
    event.preventDefault(); showPageEditor();
  });

  sections.forEach((node, id) => {
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'wf-edit-trigger';
    trigger.textContent = 'EDIT';
    trigger.setAttribute('aria-label', 'Edit ' + originals.get(id).title);
    trigger.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); showEditor(id);
    });
    bodyNode(node)?.append(trigger);
    node.addEventListener('dblclick', event => {
      if (event.target.closest('a,button,input,textarea')) return;
      event.preventDefault(); showEditor(id);
    });
  });

  const loadContent = async () => {
    const { data, error } = await client.from('pavilion_workflow_content')
      .select('section_id,content').eq('project_id', PROJECT);
    if (error) { console.warn('Workflow content unavailable:', error.message); return; }
    (data || []).forEach(row => {
      if (row.section_id === '__page') {
        published.set('__page', row.content);
        applyPage(row.content);
        return;
      }
      if (!sections.has(row.section_id)) return;
      published.set(row.section_id, row.content);
      apply(row.section_id, row.content);
    });
  };
  loadContent().catch(error => console.warn('Workflow content:', error));
})();
