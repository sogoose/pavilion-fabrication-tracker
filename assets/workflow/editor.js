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
    ])
  });
  const apply = (id, value) => {
    const node = sections.get(id);
    if (!node || !value || typeof value !== 'object') return;
    const data = { ...originals.get(id), ...value };
    if (typeof data.title === 'string') titleNode(node).textContent = data.title;
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
    ['eyebrow', 'Small top label', '.wb-eyebrow', 'input', 120],
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
      if (id === 'title' && value[id].includes('&')) {
        // Preserve the existing understated accent on ampersands.
        const fragments = value[id].split('&');
        element.replaceChildren();
        fragments.forEach((fragment, index) => {
          element.append(document.createTextNode(fragment));
          if (index !== fragments.length - 1) {
            const accent = document.createElement('span');
            accent.className = 'wb-title-amp';
            accent.textContent = '&';
            element.append(accent);
          }
        });
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
    const links = addField('File links — one LABEL | https://... per line (or #tracker)',
      (data.links || []).map(pair => pair.join(' | ')).join('\n'));
    credits.rows = 3; description.rows = 4; links.rows = 4;
    addButton('Save changes', async () => {
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
          links: parseRows(links.value, 16)
        };
        if (!value.title) throw new Error('A title is required.');
        for (const pair of value.links) if (!pair[0] || !safeHref(pair[1])) throw new Error('Links must use https:// or #tracker.');
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
    dialog.showModal(); title.focus();
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
