/* Workflow Process Archive.
 * The editorial diagram remains intact; selecting a stage opens an accessible
 * large process card with live description, team credits, photo gallery and links.
 * The shared Workflow editor continues to own persisted content. */
(() => {
  'use strict';
  const root = document.getElementById('workflowView');
  if (!root) return;

  const photo = file => new URL('./assets/workflow/decor/' + file + '.webp', document.baseURI).href;
  const defaultPhotos = {
    spatial: [],
    structural: [photo('rammed-blocks')],
    gcode: [photo('printer')],
    material: [photo('rammed-blocks')],
    printing: [photo('robot'), photo('printer'), photo('printed-module')],
    rammed: [photo('rammed-mould'), photo('rammed-block'), photo('rammed-blocks')],
    firing: [],
    assembly: [photo('hybrid'), photo('printed-module')],
    computational: [], construction: [], environment: [], hrc: []
  };
  const nodes = [...root.querySelectorAll('details.wb-block, details.wp-island')];
  const sectionId = node => node.dataset.process ||
    [...node.classList].find(name => name.startsWith('wp-') && name !== 'wp-island')?.replace('wp-', '') || '';
  const getText = (node, selector) => node.querySelector(selector)?.textContent.trim() || '';
  const safeUrl = value => {
    if (value === '#tracker') return value;
    try {
      const url = new URL(value, document.baseURI);
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) { return null; }
  };
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  };
  nodes.forEach(node => {
    const id = sectionId(node);
    if (id && !node.dataset.workflowGallery) {
      node.dataset.workflowGallery = JSON.stringify(defaultPhotos[id] || []);
    }
    // Remove the original, tiny inline expansion; retain it as editable data.
    node.open = false;
  });
  // The editor's existing edit trigger remains inside each hidden detail and
  // can be invoked from the much larger Archive view.
  const dialog = element('dialog', 'wb-process-dialog');
  dialog.setAttribute('aria-label', 'Fabrication process archive');
  dialog.innerHTML =
    '<div class="wb-process-shell">' +
      '<header class="wb-process-top"><span class="wb-process-kicker">PAVILION / PROCESS ARCHIVE</span>' +
      '<button type="button" class="wb-process-close" aria-label="Close process card">×</button></header>' +
      '<div class="wb-process-columns">' +
        '<section class="wb-tarot" aria-label="Process card">' +
          '<div class="wb-tarot-meta"><span class="wb-card-number"></span><span class="wb-card-category">FABRICATION CARD</span></div>' +
          '<div class="wb-card-art"></div><h2 class="wb-card-title"></h2>' +
          '<div class="wb-card-tag"></div><p class="wb-card-description"></p>' +
          '<div class="wb-card-credits"></div>' +
        '</section>' +
        '<section class="wb-archive" aria-label="Process gallery and files">' +
          '<div class="wb-archive-heading"><div><span class="wb-archive-overline">FIELD NOTES</span><h3>Process Gallery</h3></div>' +
          '<button type="button" class="wb-archive-edit">✎ Edit / Upload</button></div>' +
          '<div class="wb-gallery-stage"></div>' +
          '<div class="wb-gallery-controls"><button type="button" class="wb-gallery-prev" aria-label="Previous photo">←</button>' +
          '<span class="wb-gallery-count"></span><button type="button" class="wb-gallery-next" aria-label="Next photo">→</button></div>' +
          '<div class="wb-gallery-thumbs"></div>' +
          '<div class="wb-attachments-heading"><span class="wb-archive-overline">RESOURCES</span><h3>Attachments & Links</h3></div>' +
          '<div class="wb-attachment-links"></div>' +
        '</section>' +
      '</div>' +
    '</div>';
  document.body.appendChild(dialog);
  const q = selector => dialog.querySelector(selector);
  let activeNode = null;
  let previousFocus = null;
  let activePhotoIndex = 0;
  let activePhotos = [];
  const renderPhoto = () => {
    const stage = q('.wb-gallery-stage');
    const thumbs = q('.wb-gallery-thumbs');
    stage.replaceChildren();
    thumbs.replaceChildren();
    const count = q('.wb-gallery-count');
    if (!activePhotos.length) {
      stage.append(element('p', 'wb-gallery-empty',
        'No fabrication photos yet. Choose Edit / Upload to add process photographs.'));
      count.textContent = '0 / 0';
      q('.wb-gallery-prev').disabled = true;
      q('.wb-gallery-next').disabled = true;
      return;
    }
    activePhotoIndex = (activePhotoIndex + activePhotos.length) % activePhotos.length;
    const img = element('img', 'wb-gallery-featured');
    img.src = activePhotos[activePhotoIndex];
    img.alt = 'Fabrication gallery image ' + (activePhotoIndex + 1);
    img.loading = 'eager';
    img.decoding = 'async';
    stage.append(img);
    activePhotos.forEach((src, i) => {
      const thumb = element('button', 'wb-gallery-thumb' + (i === activePhotoIndex ? ' is-active' : ''));
      thumb.type = 'button';
      thumb.setAttribute('aria-label', 'View gallery photo ' + (i + 1));
      thumb.setAttribute('aria-pressed', String(i === activePhotoIndex));
      const image = element('img');
      image.src = src;
      image.alt = '';
      image.loading = 'lazy';
      thumb.append(image);
      thumb.addEventListener('click', () => { activePhotoIndex = i; renderPhoto(); });
      thumbs.append(thumb);
    });
    count.textContent = String(activePhotoIndex + 1).padStart(2, '0') +
      ' / ' + String(activePhotos.length).padStart(2, '0');
    q('.wb-gallery-prev').disabled = activePhotos.length < 2;
    q('.wb-gallery-next').disabled = activePhotos.length < 2;
  };
  const close = () => { if (dialog.open) dialog.close(); };
  const open = node => {
    previousFocus = document.activeElement;
    activeNode = node;
    nodes.forEach(other => { other.open = false; other.classList.toggle('wb-selected', other === node); });
    const id = sectionId(node);
    const title = getText(node, '.wb-name, .wp-title');
    const number = getText(node, '.wb-index') || '↗';
    const caption = getText(node, '.wb-drawing figcaption');
    const content = node.querySelector('.wb-detail, .wp-description');
    q('.wb-card-number').textContent = number;
    q('.wb-card-category').textContent = id === 'firing' ? 'OPTIONAL FINISH' : id === 'assembly' ? 'FINAL PROCESS' : 'PROCESS CARD';
    q('.wb-card-title').textContent = title;
    const cardTag = q('.wb-card-tag');
    cardTag.replaceChildren();
    if (caption) cardTag.append(element('span', '', '# ' + caption));
    q('.wb-card-description').textContent = content?.querySelector('p')?.textContent.trim() || 'Field documentation in progress.';
    const art = q('.wb-card-art');
    art.replaceChildren();
    const origin = node.querySelector('.wb-drawing img, .wp-art');
    if (origin) {
      const img = element('img');
      img.src = origin.src;
      img.alt = title + ' process illustration';
      art.append(img);
    }
    const credits = q('.wb-card-credits');
    credits.replaceChildren();
    const rows = [...node.querySelectorAll('.wb-credit-row')];
    if (rows.length) {
      rows.forEach(row => {
        const item = element('div', 'wb-card-credit');
        item.append(element('span', 'wb-card-credit-label', getText(row, '.wb-credits-key')));
        item.append(element('span', 'wb-card-credit-name', getText(row, '.wb-credits-names')));
        credits.append(item);
      });
    } else {
      const members = getText(node, '.wp-members');
      if (members) {
        const item = element('div', 'wb-card-credit');
        item.append(element('span', 'wb-card-credit-label', 'TEAM'));
        item.append(element('span', 'wb-card-credit-name', members));
        credits.append(item);
      }
    }
    if (!credits.children.length) credits.append(element('span', 'wb-card-no-credits', 'Team details to follow'));
    let gallery;
    try { gallery = JSON.parse(node.dataset.workflowGallery || '[]'); } catch (_) { gallery = []; }
    activePhotos = Array.isArray(gallery) ? gallery.map(safeUrl).filter(url => url && url !== '#tracker').slice(0, 8) : [];
    activePhotoIndex = 0;
    renderPhoto();
    const links = q('.wb-attachment-links');
    links.replaceChildren();
    [...node.querySelectorAll('.wb-links a, .wp-links a')].forEach(link => {
      const href = safeUrl(link.getAttribute('href'));
      if (!href) return;
      const a = element('a', 'wb-attachment', link.textContent.trim().replace(/\s*↗$/, ''));
      a.href = href;
      if (href !== '#tracker') {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else {
        a.addEventListener('click', e => {
          e.preventDefault();
          close();
          document.getElementById('navTracker')?.click();
        });
      }
      a.append(element('span', 'wb-attachment-arrow', '↗'));
      links.append(a);
    });
    if (!links.children.length) links.append(element('span', 'wb-attachment-empty', 'Links will appear here when added.'));
    q('.wb-archive-edit').hidden = !node.querySelector('.wf-edit-trigger');
    dialog.showModal();
  };
  root.querySelectorAll('details.wb-block > summary, details.wp-island > summary').forEach(summary => {
    summary.addEventListener('click', event => {
      event.preventDefault();
      const node = summary.parentElement;
      open(node);
    });
  });
  q('.wb-process-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    activeNode?.classList.remove('wb-selected');
    activeNode = null;
    previousFocus?.focus?.({preventScroll:true});
  });
  q('.wb-gallery-prev').addEventListener('click', () => { activePhotoIndex--; renderPhoto(); });
  q('.wb-gallery-next').addEventListener('click', () => { activePhotoIndex++; renderPhoto(); });
  q('.wb-archive-edit').addEventListener('click', () => {
    const edit = activeNode?.querySelector('.wf-edit-trigger');
    if (!edit) return;
    close();
    edit.click();
  });
  // Preserve the existing shortcut for links outside the modal.
  root.addEventListener('click', e => {
    const link = e.target.closest('.wb-tracker-link');
    if (link) {
      e.preventDefault();
      document.getElementById('navTracker')?.click();
    }
  });
})();