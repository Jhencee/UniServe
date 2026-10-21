let centralAuditPage = 1;
let centralAuditRequest=0;
let centralAuditFilterTimer;
function queueCentralAuditFilter(){clearTimeout(centralAuditFilterTimer);centralAuditRequest++;centralAuditPage=1;centralAuditFilterTimer=setTimeout(loadCentralAudit,350);}
function setCentralAuditDates(mode){const date=mode==='today'?OfficeCalendar.parts().date:'';document.getElementById('centralAuditFrom').value=date;document.getElementById('centralAuditTo').value=date;queueCentralAuditFilter();}
async function renderCentralAudit() {
  const host=document.getElementById('content');
  let panel=document.getElementById('centralAudit');
  if(!panel){panel=document.createElement('div');panel.id='centralAudit';panel.className='card ux-audit';host.appendChild(panel);
    panel.innerHTML=`<div class="card-head"><div><h3>Audit Trail</h3><div class="desc">Who acted, what happened, and which record changed</div></div><div class="audit-toolbar"><button class="btn btn-primary btn-sm" onclick="exportCentralAudit('print')">${icon('print',14)} Print Report</button><button class="btn btn-ghost btn-sm" onclick="exportCentralAudit('xlsx')">${icon('download',14)} Download Excel</button><button class="btn btn-ghost btn-sm" onclick="loadCentralAudit()">Refresh</button></div></div>
      <div class="filter-bar"><div class="date-range" role="group" aria-label="Audit date range"><span class="dr-ic">${icon('calendar',15)}</span><label class="dr-field"><span>From</span><input id="centralAuditFrom" class="date-in" type="date" aria-label="From date" onchange="queueCentralAuditFilter()"></label><span class="dr-sep" aria-hidden="true">–</span><label class="dr-field"><span>To</span><input id="centralAuditTo" class="date-in" type="date" aria-label="To date" onchange="queueCentralAuditFilter()"></label><span class="dr-actions"><button class="dr-btn" onclick="setCentralAuditDates('today')">Today</button><button class="dr-btn" onclick="setCentralAuditDates('all')">All dates</button></span></div><select class="filter-select" id="centralAuditCategory" aria-label="Category" onchange="queueCentralAuditFilter()"><option value="">All categories</option>${['Authentication','Accounts','Queue','Appointments','Transactions','Settings','Confidential','Data','Messages','Feedback','System'].map(c=>`<option>${c}</option>`).join('')}</select><div class="search-box audit-actor-search">${icon('search',15)}<input id="centralAuditActor" aria-label="Search name" placeholder="Name" oninput="queueCentralAuditFilter()"></div><div class="search-box">${icon('search',15)}<input id="centralAuditQ" aria-label="Search action or Visit ID" placeholder="Action or Visit ID" oninput="queueCentralAuditFilter()"></div></div>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Who</th><th>Category</th><th>Action</th><th>Details</th></tr></thead><tbody id="centralAuditBody"></tbody></table></div><div class="card-pad" id="centralAuditPager"></div>`;
  }
  await UniServeUX.syncAudit(); await loadCentralAudit();
}
function clearCentralAudit(){['centralAuditQ','centralAuditActor','centralAuditCategory','centralAuditFrom','centralAuditTo'].forEach(id=>document.getElementById(id).value='');centralAuditPage=1;loadCentralAudit();}
async function loadCentralAudit(){
  const requestNumber=++centralAuditRequest;
  const body=document.getElementById('centralAuditBody');if(!body)return;
  body.innerHTML='<tr><td colspan="5">Loading shared audit records…</td></tr>';
  const params=centralAuditParams();params.set('page',centralAuditPage);
  try{
    const result=await UniServeUX.request('/audit?'+params);
    if(!body.isConnected||requestNumber!==centralAuditRequest)return;
    body.innerHTML=result.data.length?result.data.map(e=>{
      const date=new Date(e.created_at.includes('T')?e.created_at:e.created_at.replace(' ','T')+'Z');
      return `<tr><td>${escapeHtml(date.toLocaleString('en-PH',{timeZone:'Asia/Manila',hour12:true}))}</td><td>${escapeHtml(e.actor_name)}</td><td>${auditCatPill(e.category)}</td><td>${escapeHtml(auditActionLabel(e.action))}</td><td>${auditDetailsHtml(e)}</td></tr>`;
    }).join(''):'<tr><td colspan="5">No shared audit records match these filters. Clear the filters or try another date range.</td></tr>';
    document.getElementById('centralAuditPager').innerHTML=`<div class="audit-pagination"><p class="audit-pagination-info">Page <b>${result.current_page}</b> of ${result.last_page}<span>${result.total} records</span></p><nav class="audit-pagination-buttons" aria-label="Audit pages"><button class="btn btn-ghost btn-sm" ${result.current_page===1?'disabled':''} onclick="centralAuditPage--;loadCentralAudit()">Previous</button><button class="btn btn-ghost btn-sm" ${result.current_page>=result.last_page?'disabled':''} onclick="centralAuditPage++;loadCentralAudit()">Next</button></nav></div>`;
  }catch(error){if(body.isConnected&&requestNumber===centralAuditRequest)body.innerHTML=`<tr><td colspan="5" role="alert">${escapeHtml(error.message)} <button class="btn btn-ghost btn-sm" onclick="loadCentralAudit()">Retry</button></td></tr>`;}
}
function centralAuditParams(){const params=new URLSearchParams();for(const [id,key] of [['centralAuditQ','q'],['centralAuditActor','actor'],['centralAuditCategory','category'],['centralAuditFrom','from'],['centralAuditTo','to']]){const value=document.getElementById(id)?.value;if(value)params.set(key,value);}return params;}
let centralAuditExportBusy=false;
async function exportCentralAudit(format){
 if(centralAuditExportBusy)return;centralAuditExportBusy=true;
 try{
  const params=centralAuditParams(),entries=[];let page=1,result;
  do{params.set('page',page++);result=await UniServeUX.request('/audit?'+params);entries.push(...result.data);}while(result.next_page_url);
  const rows=entries.map(e=>[new Date(e.created_at.includes('T')?e.created_at:e.created_at.replace(' ','T')+'Z').toLocaleString('en-PH',{timeZone:'Asia/Manila',hour12:true}),e.actor_name,e.category,auditActionLabel(e.action),e.target&&!/^\/?api\//.test(e.target)?e.target:'',(e.changes||[]).map(c=>`${c.field}: ${c.from?c.from+' → ':''}${c.to}`).join('; ')]);
  const headers=['Time','Who','Category','Action','Record','Changes'];
  const detailHeaders=['Event ID','Time','Who','Category','Action','Record','Field','Before','After'];
  const value=v=>v===''||v==null?'Not set':String(v);
  const detailRows=entries.flatMap((entry,index)=>(entry.changes?.length?entry.changes:[null]).map(change=>[entry.id??'',...rows[index].slice(0,5),change?.field||'',change?value(change.from):'',change?value(change.to):'']));
  if(format==='xlsx')SpreadsheetExport.download('Audit_Trail.xlsx',[detailHeaders,...detailRows],[12,24,24,18,32,24,26,36,36]);
  else printInjected(`<h2>Audit Trail</h2><p>${rows.length} matching records</p><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  const db=loadDB();logActivity(db,currentUser,format!=='print'?'Downloaded audit trail':'Opened audit trail print report',{category:'Data'});saveDB(db);
 }catch(error){toast(escapeHtml(error.message),'err');}finally{centralAuditExportBusy=false;}
}
