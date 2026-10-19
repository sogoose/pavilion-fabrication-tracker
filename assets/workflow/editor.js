/* Owner-only Workflow editor. Read access stays public; write access is RLS-protected.
   No privileged keys or email allowlists are shipped to the browser. */
(() => {
  const root = document.getElementById('workflowView');
  const config = window.PAVILION_CONFIG || {};
  if (!root || !window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) return;

  const PROJECT = config.projectId || 'pavilion-2026';
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'pavilion-workflow-auth' }
  });
  const sections = new Map();
  const originals = new Map();
  const published = new Map();
  let currentUser = null;
  let canEdit = false;
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
    node.querySelector('.wb-preview, .wp-island-summary')?.setAttribute('aria-label', 'View ' + data.title + ' details');
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
  actions.innerHTML = '<button type="button" class="wf-login" aria-label="Workflow editor login">Editor login</button><button type="button" class="wf-logout" hidden>Sign out</button><span class="wf-editor-state" role="status" aria-live="polite"></span>';
  root.querySelector('.wb-mast > div')?.append(actions);
  const loginButton = actions.querySelector('.wf-login');
  const logoutButton = actions.querySelector('.wf-logout');
  const stateLabel = actions.querySelector('.wf-editor-state');

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

  const showLogin = () => {
    editingId = null; fields.replaceChildren(); buttons.replaceChildren(); setFeedback('');
    const email = addField('Your editor email', '', 'input');
    email.type = 'email'; email.autocomplete = 'email'; email.placeholder = 'you@example.com';
    addButton('Send sign-in link', async () => {
      const address = email.value.trim();
      if (!address || !email.checkValidity()) { setFeedback('Enter a valid email address.', true); return; }
      setFeedback('Sending…');
      const { error } = await client.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: location.origin + location.pathname + '#workflow', shouldCreateUser: false }
      });
      setFeedback(error ? error.message : 'Check your email for the sign-in link. Return to this site after signing in.', !!error);
    }, 'wf-editor-save');
    addButton('Cancel', closeDialog);
    dialog.showModal(); email.focus();
  };
  loginButton.addEventListener('click', showLogin);
  logoutButton.addEventListener('click', async () => {
    await client.auth.signOut();
    currentUser = null; canEdit = false; updatePermissions();
  });

  const updatePermissions = () => {
    loginButton.hidden = !!currentUser;
    logoutButton.hidden = !currentUser;
    stateLabel.textContent = canEdit ? 'EDITOR ACCESS' : currentUser ? 'READ ONLY' : '';
    root.querySelectorAll('.wf-edit-trigger').forEach(button => { button.hidden = !canEdit; });
  };

  const showEditor = id => {
    if (!canEdit || !currentUser || !sections.has(id)) return;
    editingId = id;
    fields.replaceChildren(); buttons.replaceChildren(); setFeedback('');
    const data = { ...originals.get(id), ...published.get(id) };
    const title = addField('Title', data.title, 'input');
    const credits = addField('Participants — one ROLE | names per line',
      (data.credits || []).map(pair => pair.join(' | ')).join('\n'));
    const description = addField('Description', data.description);
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
          credits: parseRows(credits.value, 12).map(pair => [pair[0], pair[1].slice(0, 400)]),
          links: parseRows(links.value, 16)
        };
        if (!value.title) throw new Error('A title is required.');
        for (const pair of value.links) if (!pair[0] || !safeHref(pair[1])) throw new Error('Links must use https:// or #tracker.');
      } catch (err) { setFeedback(err.message, true); return; }
      setFeedback('Saving to shared Workflow…');
      const { error } = await client.from('pavilion_workflow_content').upsert({
        project_id: PROJECT, section_id: id, content: value,
        updated_by: currentUser.id, updated_at: new Date().toISOString()
      }, { onConflict: 'project_id,section_id' });
      if (error) { setFeedback('Save failed: ' + error.message, true); return; }
      published.set(id, value); apply(id, value); closeDialog();
    }, 'wf-editor-save');
    addButton('Cancel', closeDialog);
    dialog.showModal(); title.focus();
  };

  sections.forEach((node, id) => {
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'wf-edit-trigger';
    trigger.textContent = 'EDIT'; trigger.hidden = true;
    trigger.setAttribute('aria-label', 'Edit ' + originals.get(id).title);
    trigger.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); showEditor(id);
    });
    bodyNode(node)?.append(trigger);
    node.addEventListener('dblclick', event => {
      if (!canEdit || event.target.closest('a,button,input,textarea')) return;
      event.preventDefault(); showEditor(id);
    });
  });

  const loadContent = async () => {
    const { data, error } = await client.from('pavilion_workflow_content')
      .select('section_id,content').eq('project_id', PROJECT);
    if (error) { console.warn('Workflow content unavailable:', error.message); return; }
    (data || []).forEach(row => {
      if (!sections.has(row.section_id)) return;
      published.set(row.section_id, row.content);
      apply(row.section_id, row.content);
    });
  };
  const refreshAuth = async () => {
    const { data: { user }, error } = await client.auth.getUser();
    currentUser = error ? null : user;
    canEdit = false;
    if (currentUser) {
      const { data } = await client.from('pavilion_workflow_editors')
        .select('user_id').eq('user_id', currentUser.id).maybeSingle();
      canEdit = !!data;
    }
    updatePermissions();
  };

  client.auth.onAuthStateChange(() => {
    // Avoid running Supabase queries inside the auth callback itself.
    setTimeout(() => { refreshAuth(); }, 0);
  });
  Promise.all([loadContent(), refreshAuth()]).catch(error => console.warn('Workflow editor:', error));
})();
