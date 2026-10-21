/* Presentation-only Tracker UI composition. Preserve all [data-field] nodes and form IDs. */
(() => {
  'use strict';
  let lastKey = null;
  let expanded = new Set();
  let previousScroll = 0;

  function fieldNode(panel, key) {
    const field = panel.querySelector('[data-field="' + key + '"]');
    return field ? field.closest('.field') : null;
  }
  function appendField(panel, destination, key) {
    const f = fieldNode(panel, key);
    if (f) destination.appendChild(f);
    return !!f;
  }
  function rows(panel, container, keys) {
    const row = document.createElement('div');
    row.className = 'tracker-fields-row';
    for (const key of keys) appendField(panel, row, key);
    if (row.children.length) container.appendChild(row);
  }
  function solo(panel, container, key) { appendField(panel, container, key); }
  function label(text, cls='tracker-panel-eyebrow') {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    return el;
  }
  function section(name, heading, hint) {
    const details = document.createElement('details');
    details.className = 'tracker-section';
    details.dataset.section = name;
    const summary = document.createElement('summary');
    const text = document.createElement('span');
    text.textContent = heading;
    summary.appendChild(text);
    if (hint) {
      const small = document.createElement('small');
      small.textContent = hint;
      summary.appendChild(small);
    }
    const inner = document.createElement('div');
    inner.className = 'tracker-section-content';
    details.append(summary, inner);
    return {details, inner};
  }
  function move(selector, source, destination) {
    const el = source.querySelector(selector);
    if(el) destination.appendChild(el);
    return el;
  }
  window.pavilionTrackerMinimal = {
    capture(panel, key) {
      if (key !== lastKey) { expanded = new Set(); previousScroll = 0; return; }
      expanded = new Set(
        [...panel.querySelectorAll('.tracker-section[open]')].map(el => el.dataset.section)
      );
      previousScroll = panel.scrollTop;
    },
    enhance(panel, record, key) {
      const oldHTML = panel.innerHTML;
      const initialFieldCount = panel.querySelectorAll('[data-field]').length;
      if (!initialFieldCount) return;
      const root = document.createElement('div');
      root.className = 'tracker-panel-layout';

      const header = document.createElement('div');
      header.className = 'tracker-panel-head';
      const identity = document.createElement('div');
      const title = move('.partTitle', panel, identity);
      if (!title) {panel.innerHTML=oldHTML;return;}
      const sub = document.createElement('div');
      sub.className = 'tracker-panel-meta';
      const method = record.Manufacturing_Method || '—';
      const machine = record.Machine || '—';
      sub.textContent = method + ' · ' + machine;
      identity.appendChild(sub);
      header.appendChild(identity);
      const pdf = move('#downloadModulePDF', panel, header);
      if (pdf) {pdf.classList.add('tracker-panel-pdf');pdf.textContent='Module PDF ↗';}
      root.appendChild(header);
      root.appendChild(label('01 / PRODUCTION RECORD'));

      const basics = document.createElement('div');
      basics.className = 'tracker-basics';
      rows(panel, basics, ['Object_ID', 'Production_Status']);
      rows(panel, basics, ['Manufacturing_Method', 'Machine']);
      rows(panel, basics, ['Fabrication_Date', 'Assigned_To']);
      rows(panel, basics, ['Material', 'Weight_kg']);
      solo(panel, basics, 'Notes');
      root.appendChild(basics);

      const files = section('files', 'Files & site photos',
        record.GCode_File ? 'G-code linked' : 'G-code · Photos');
      files.inner.appendChild(label('G-CODE', 'sectionTitle'));
      move('.gcodeUpload', panel, files.inner);
      files.inner.appendChild(label('SITE PHOTOS', 'sectionTitle'));
      move('.photoUpload', panel, files.inner);
      move('#modulePhotos', panel, files.inner);
      root.appendChild(files.details);

      const fabrication = section('fabrication', 'Fabrication parameters', 'Material · Machine settings');
      solo(panel, fabrication.inner, 'Material_Details');
      const isPrint = record.Manufacturing_Method === '3D Printing';
      if (isPrint) fabrication.inner.appendChild(label('3D PRINTING', 'sectionTitle'));
      rows(panel, fabrication.inner, ['Motor_Speed','Motor_Speed_Manual_Adjustment_pct']);
      rows(panel, fabrication.inner, ['Air_Pressure_bar','First_Layer_Height_mm']);
      rows(panel, fabrication.inner, ['Layer_Height_mm','Print_Duration_min']);
      solo(panel, fabrication.inner, 'Infill_Pattern');
      fabrication.inner.appendChild(label('INFILL', 'sectionTitle'));
      solo(panel, fabrication.inner, 'Infill_Density_pct');
      move('.infillPreview', panel, fabrication.inner);
      fabrication.inner.appendChild(label('STRUCTURAL RECORD', 'sectionTitle'));
      solo(panel, fabrication.inner, 'Structural_Status');
      solo(panel, fabrication.inner, 'Compression_Force_kN');
      const derived = [...panel.querySelectorAll('.autoStatus')];
      if (derived[0]) fabrication.inner.appendChild(derived[0]);
      const noStructuralApproval = document.createElement('p');
      noStructuralApproval.className = 'tracker-panel-legacy-note';
      noStructuralApproval.textContent = 'Structural checks are archived here; they do not confirm a completed structural test.';
      fabrication.inner.appendChild(noStructuralApproval);
      root.appendChild(fabrication.details);

      const stages = section('stages','Drying · Firing · Assembly','Optional stages');
      rows(panel, stages.inner, ['Drying_QC_Status','Construction_Status']);
      if (isPrint) {
        stages.inner.appendChild(label('FIRING', 'sectionTitle'));
        rows(panel, stages.inner, ['Firing_Status','Firing_Date']);
        rows(panel, stages.inner, ['Firing_Peak_Temp_C','Firing_Duration_h']);
        solo(panel, stages.inner, 'Firing_Kiln');
      }
      const overall = panel.querySelector('.autoStatus');
      if (overall) stages.inner.appendChild(overall);
      root.appendChild(stages.details);

      const metadata = section('metadata','Technical metadata','Legacy IDs · Rhino');
      const legacy = document.createElement('p');
      legacy.className = 'tracker-panel-legacy-note';
      legacy.textContent = 'Archive fields. Changing Module No., Level or Sequence can regenerate Object ID.';
      metadata.inner.appendChild(legacy);
      rows(panel, metadata.inner, ['Module_No','Level']);
      rows(panel, metadata.inner, ['Sequence','Rhino_Object_Name']);
      const info = document.createElement('div');
      info.className = 'tracker-panel-footnote';
      info.textContent = 'Rhino GUID: ' + (record.Rhino_GUID||'—') +
        ' · Last updated: ' + (record.Last_Updated||'—') +
        ' · Updated by: ' + (record.Updated_By||'—');
      metadata.inner.appendChild(info);
      const footActions = move('.footerActions', panel, metadata.inner);
      if (footActions) {
        const focus = footActions.querySelector('#focusSelected');
        if (focus) {
          focus.textContent='Focus object';
          header.appendChild(focus);
        }
      }
      const liveNote = move('.liveNote',panel,metadata.inner);
      if (liveNote) liveNote.classList.add('tracker-metadata-note');
      root.appendChild(metadata.details);

      // If a future input gets added upstream, keep it accessible rather
      // than silently discarding it during a visual redesign.
      const leftover = [...panel.querySelectorAll('[data-field]')].map(el=>el.closest('.field'));
      if (leftover.length) {
        for (const f of [...new Set(leftover)]) metadata.inner.appendChild(f);
      }
      const finalCount = root.querySelectorAll('[data-field]').length;
      const requiredIds=['downloadModulePDF','stampNow','focusSelected','gcodeInput',
        'uploadGCode','modulePhotoInput','uploadModulePhoto','modulePhotos'];
      const missing=requiredIds.filter(id=>!root.querySelector('#'+id));
      if (finalCount !== initialFieldCount || missing.length) {
        console.warn('[Tracker UI] Preserving legacy panel after a composition mismatch',
          {initialFieldCount,finalCount,missing});
        panel.innerHTML=oldHTML;
        return;
      }
      for (const details of root.querySelectorAll('.tracker-section')) {
        details.open = expanded.has(details.dataset.section);
      }
      panel.replaceChildren(root);
      panel.scrollTop = key===lastKey ? previousScroll : 0;
      lastKey=key;
    }
  };
  document.addEventListener('click', e => {
    for (const menu of document.querySelectorAll('.tracker-menu[open]')) {
      if (!menu.contains(e.target) || e.target.closest('button')) menu.open=false;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.tracker-menu[open]')
      .forEach(menu=>menu.open=false);
  });
})();
