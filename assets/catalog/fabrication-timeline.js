/* Fabrication Timeline / by actual Fabrication_Date.
   Shows daily module counts by manufacturing method. No schema changes:
   records are read live from the active 3DM-backed Tracker state. */
export function setupFabricationTimeline({getEntries,selectModule}) {
  const dialog=document.createElement('dialog');
  dialog.className='fab-timeline-dialog';
  dialog.setAttribute('aria-label','Fabrication timeline by date');
  dialog.innerHTML=
    '<div class="fab-timeline-shell">'+
      '<header class="fab-timeline-head"><div><span class="fab-timeline-eyebrow">PAVILION / FABRICATION RECORD</span>'+
      '<h2>Fabrication Timeline</h2><p>Daily module production, grouped by fabrication date.</p></div>'+
      '<button type="button" class="fab-timeline-close" aria-label="Close timeline">×</button></header>'+
      '<div class="fab-timeline-stats" role="status"></div>'+
      '<div class="fab-timeline-toolbar"><div class="fab-timeline-filters" aria-label="Manufacturing method filter">'+
        '<button type="button" data-method="All" aria-pressed="true">All</button>'+
        '<button type="button" data-method="3D Printing" aria-pressed="false">3D Printing</button>'+
        '<button type="button" data-method="Rammed Earth" aria-pressed="false">Rammed Earth</button>'+
      '</div><div class="fab-timeline-legend"><span class="fab-legend-print">3D Printing</span><span class="fab-legend-rammed">Rammed Earth</span></div></div>'+
      '<div class="fab-timeline-chart" aria-label="Fabrication counts for each recorded date"></div>'+
      '<section class="fab-timeline-detail" aria-label="Modules for selected fabrication date">'+
      '<h3>Select a date</h3><div class="fab-timeline-items"></div></section>'+
      '<p class="fab-timeline-note">Dates reflect module records entered in the Tracker; missing dates are excluded from the chart. Each module is counted once. Select a module to locate it in the 3D model.</p>'+
    '</div>';
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  const chart=$('.fab-timeline-chart');
  const stats=$('.fab-timeline-stats');
  const heading=$('.fab-timeline-detail h3');
  const detail=$('.fab-timeline-items');
  let method='All',selectedDate=null;
  const isDate=value=>{
    const text=String(value||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
    const date=new Date(text+'T12:00:00Z');
    return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===text;
  };
  const shortDate=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'});
  const longDate=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const text=(tag,cls,value)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(value!==undefined)el.textContent=String(value);
    return el;
  };
  const read=()=>getEntries().filter(x=>x?.record);
  const scoped=(entries)=>entries.filter(x=>method==='All'||x.record.Manufacturing_Method===method);
  const renderDetails=(entries)=>{
    const items=selectedDate?entries.filter(x=>String(x.record.Fabrication_Date).trim()===selectedDate):[];
    heading.textContent=selectedDate?longDate(selectedDate)+'  /  '+items.length+' MODULE'+(items.length===1?'':'S'):'Select a date';
    detail.replaceChildren();
    if(!items.length){
      detail.append(text('p','fab-timeline-empty','Select a bar to view its modules.'));
      return;
    }
    items.sort((a,b)=>String(a.record.Object_ID||'').localeCompare(String(b.record.Object_ID||''),undefined,{numeric:true}));
    items.forEach(item=>{
      const record=item.record;
      const btn=text('button','fab-timeline-module');
      btn.type='button';
      btn.append(text('strong','fab-timeline-module-id',record.Object_ID||item.key));
      const meta=text('span','fab-timeline-module-info');
      meta.append(text('span','',record.Manufacturing_Method||'Other'));
      meta.append(text('span','',record.Production_Status||'Not Started'));
      meta.append(text('span','',record.Assigned_To||'Unassigned'));
      btn.append(meta,text('span','fab-timeline-module-arrow','↗'));
      btn.addEventListener('click',()=>{
        dialog.close();
        selectModule(item.key);
      });
      detail.append(btn);
    });
  };
  const render=()=>{
    const entries=read(),valid=entries.filter(x=>isDate(x.record.Fabrication_Date));
    const undated=entries.length-valid.length;
    const active=scoped(valid);
    const groups=new Map();
    for(const item of active){
      const date=String(item.record.Fabrication_Date).trim();
      if(!groups.has(date))groups.set(date,[]);
      groups.get(date).push(item);
    }
    const days=[...groups].sort((a,b)=>a[0].localeCompare(b[0]));
    // Keep the horizontal scroll position when a user selects a date.
    const currentScroll=chart.scrollLeft,hadSelection=days.some(([d])=>d===selectedDate);
    if(!hadSelection)selectedDate=days.length?days[days.length-1][0]:null;
    const printed=active.filter(x=>x.record.Manufacturing_Method==='3D Printing').length;
    const rammed=active.filter(x=>x.record.Manufacturing_Method==='Rammed Earth').length;
    const values=[
      [active.length,'DATED MODULES'],
      [days.length,'FABRICATION DAYS'],
      [printed,'3D PRINTING'],
      [rammed,'RAMMED EARTH'],
      [undated,'NO DATE (ALL METHODS)']
    ];
    stats.replaceChildren();
    values.forEach(([number,label])=>{
      const box=text('div','fab-timeline-stat');
      box.append(text('strong','',number),text('span','',label));
      stats.append(box);
    });
    chart.replaceChildren();
    if(!days.length){
      chart.append(text('p','fab-timeline-empty',
        entries.length?'No fabrication dates for this method yet. Enter Fabrication Date on a module to see it here.':'Load the Rhino model and its module records to see the timeline.'));
      renderDetails(active);
      return;
    }
    const max=Math.max(...days.map(([,list])=>list.length),1);
    const inner=text('div','fab-timeline-bars');
    days.forEach(([date,items])=>{
      const printCount=items.filter(x=>x.record.Manufacturing_Method==='3D Printing').length;
      const rammedCount=items.filter(x=>x.record.Manufacturing_Method==='Rammed Earth').length;
      const other=items.length-printCount-rammedCount;
      const btn=text('button','fab-timeline-day'+(date===selectedDate?' is-selected':''));
      btn.type='button';
      btn.setAttribute('aria-pressed',String(date===selectedDate));
      btn.setAttribute('aria-label',longDate(date)+': '+items.length+' modules, '+printCount+' 3D printed, '+rammedCount+' rammed earth');
      const count=text('span','fab-timeline-count',items.length);
      const bar=text('span','fab-timeline-bar');
      const height=Math.max(items.length/max*165,4);
      bar.style.height=height+'px';
      const addSegment=(cls,value)=>{
        if(value<1)return;
        const seg=text('span',cls);
        seg.style.flexGrow=String(value);
        bar.append(seg);
      };
      // Bottom: printing; above: rammed and other (plain grey).
      addSegment('fab-bar-other',other);
      addSegment('fab-bar-rammed',rammedCount);
      addSegment('fab-bar-print',printCount);
      const dateLabel=text('span','fab-timeline-date',shortDate(date));
      btn.append(count,bar,dateLabel);
      btn.addEventListener('click',()=>{selectedDate=date;render();});
      inner.append(btn);
    });
    chart.append(inner);
    // On initial open show the most recent date; after clicking, don't jump.
    chart.scrollLeft=hadSelection?currentScroll:Math.max(0,chart.scrollWidth-chart.clientWidth);
    renderDetails(active);
  };
  $('.fab-timeline-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.querySelectorAll('[data-method]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      method=btn.dataset.method;selectedDate=null;
      dialog.querySelectorAll('[data-method]').forEach(input=>input.setAttribute('aria-pressed',String(input===btn)));
      render();
    });
  });
  return {open(){dialog.showModal();render();},refresh(){if(dialog.open)render();}};
}
