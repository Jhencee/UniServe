/* Aggregates only accessible records. Missing timestamps are not invented. */
let adminAnalyticsPeriod='daily';
function adminAnalyticsDates(date) {
  const end=new Date(date+'T12:00:00Z'),start=new Date(end);
  if(adminAnalyticsPeriod==='weekly')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  if(adminAnalyticsPeriod==='monthly')start.setUTCDate(1);
  if(adminAnalyticsPeriod==='quarterly'){start.setUTCDate(1);start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3);}
  return Array.from({length:Math.round((end-start)/86400000)+1},(_,i)=>new Date(+start+i*86400000).toISOString().slice(0,10));
}
function adminAnalyticsTabs() {
  return '<nav class="admin-analytics-periods" aria-label="Analytics period">'+['daily','weekly','monthly','quarterly'].map(period=>'<button type="button" aria-pressed="'+(period===adminAnalyticsPeriod)+'" onclick="setAdminAnalyticsPeriod(\''+period+'\')">'+period[0].toUpperCase()+period.slice(1)+'</button>').join('')+'</nav>';
}
function setAdminAnalyticsPeriod(period) {
  if(!['daily','weekly','monthly','quarterly'].includes(period))return;
  adminAnalyticsPeriod=period;renderDashboard();
}
function adminOfficeInsights(db,dates) {
  const day=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?OfficeCalendar.parts(d).date:'';};
  const within=value=>dates.includes(day(value));
  const queues=(db.queues||[]).filter(q=>!q.restricted);
  const arrivals=queues.filter(q=>within(q.checkedInAt));
  const completed=queues.filter(q=>q.status==='Completed'&&within(q.completedAt));
  const appointments=(db.appointments||[]).filter(a=>!a.restricted&&dates.includes(a.date));
  const hours=Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0')+':00',count:0}));
  const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const arrivalMatrix=weekdays.map(label=>({label,counts:Array(24).fill(0)}));
  const services=new Map();
  (db.services||[]).forEach(service=>services.set(service.key,{label:service.label,count:0}));
  arrivals.forEach(q=>{
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(new Date(q.checkedInAt)));
    hours[hour].count++;
    const weekday=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',weekday:'short'}).format(new Date(q.checkedInAt));
    arrivalMatrix[weekdays.indexOf(weekday)].counts[hour]++;
    const key=q.serviceKey||q.serviceLabel||'Unspecified service';
    const current=services.get(key)||{label:(db.services||[]).find(s=>s.key===key)?.label||q.serviceLabel||key,count:0};
    current.count++;services.set(key,current);
  });
  const minutes=(a,b)=>{const duration=(new Date(b)-new Date(a))/60000;return a&&b&&Number.isFinite(duration)&&duration>=0?duration:null;};
  const single=completed.filter(q=>!(q.serviceHistory||[]).some(s=>s.outcome==='Transferred'));
  const wait=single.map(q=>minutes(q.checkedInAt,q.servingAt)).filter(n=>n!==null);
  const service=single.map(q=>minutes(q.servingAt,q.completedAt)).filter(n=>n!==null);
  const mean=rows=>rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length*10)/10:null;
  const feedback=completed.filter(q=>Number.isInteger(q.feedback?.rating)&&q.feedback.rating>=1&&q.feedback.rating<=5);
  return {
    arrivals:arrivals.length,completed:completed.length,
    daily:dates.map(date=>({label:date.slice(5),arrivals:arrivals.filter(q=>day(q.checkedInAt)===date).length,completed:completed.filter(q=>day(q.completedAt)===date).length})),
    services:[...services.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)),hours:hours.filter(h=>h.count),arrivalMatrix,
    attendance:[['Attended',['Checked-in','Completed','Unfinished']],['No-show',['No-show']],['Cancelled',['Cancelled']],['Awaiting arrival',['Booked','Scheduled']],['Awaiting approval',['Requested']]].map(([label,statuses])=>({label,count:appointments.filter(a=>statuses.includes(a.status)).length})),
    appointments:appointments.length,wait:mean(wait),service:mean(service),waitSamples:wait.length,serviceSamples:service.length,
    feedback:feedback.length,satisfied:feedback.filter(q=>q.feedback.rating>=4).length,rating:mean(feedback.map(q=>q.feedback.rating)),ratings:[5,4,3,2,1].map(n=>({label:n+' stars',count:feedback.filter(q=>q.feedback.rating===n).length}))
  };
}
function adminOfficeInsightsHtml(db,dates) {
  const data=adminOfficeInsights(db,dates);
  const card=(title,description,body,note)=>'<section class="card admin-insight-card"><div class="card-head"><div><h3>'+title+'</h3><div class="desc">'+description+'</div></div></div><div class="card-pad">'+body+'</div><p class="admin-insight-note">'+note+'</p></section>';
  const bars=(rows,empty)=>rows.some(r=>r.count)?dashboardBarChart(rows):emptyChart(empty);
  const timing=adminTimingColumns(data);
  const outcomes=data.appointments?'<ul class="admin-outcome-list">'+data.attendance.map(row=>'<li><span>'+row.label+'</span><strong>'+row.count+'</strong></li>').join('')+'</ul>':emptyChart('No scheduled appointments in this period.');
  return '<section class="admin-office-insights" aria-labelledby="officeInsightsTitle"><div class="admin-insights-heading"><div><h2 id="officeInsightsTitle">Office performance</h2><p>'+dates[0]+' to '+dates[dates.length-1]+' &middot; Philippine time &middot; Accessible records only</p></div></div><div class="admin-insights-grid">'+
    card('Arrivals and completions','Daily visits &middot; '+data.arrivals+' arrivals / '+data.completed+' completions',data.arrivals||data.completed?'<div class="admin-arrival-comparison">'+superComparisonChart(data.daily.map(d=>d.label),[{label:'Arrivals',values:data.daily.map(d=>d.arrivals)},{label:'Completed',values:data.daily.map(d=>d.completed)}],'grouped','Daily arrivals and completed visits')+'</div>':emptyChart('No recorded arrivals or completions in this period.'),'Uses actual check-in and completion dates. Arrivals and completions may include different visits.')+
    card('Wait and service time','Single-service visits completed in this period',timing,'Wait: arrival to service start. Service: start to completion. Valid single-service visits only.')+
    card('Service demand','All services &middot; Checked-in visits',data.services.length?dashboardBarChart(data.services):emptyChart('No services available.'),'Counts visits, including services with zero arrivals in this period. A transferred visit uses its current service.')+
    card('Arrival patterns','Weekday and hour &middot; Philippine time',adminArrivalMatrix(data),'Counts actual check-ins in the selected period, grouped by weekday and hour. Hover over a dot for its count. Empty dots mean no recorded arrivals, not that the office was closed.')+
    card('Appointment outcomes',data.appointments+' appointments scheduled in this period',outcomes,'Shows current status. Awaiting visits are not counted as no-shows; attended includes checked-in, completed and unfinished visits.')+
    card('Visitor feedback','Visits completed in this period',adminSatisfactionPictogram(data),'Optional responses; this does not represent every visitor. Ratings belong to visits completed in the selected period, not necessarily feedback submitted during that period.')+
    '</div></section>';
}

function adminArrivalMatrix(data) {
  if(!data.arrivals)return emptyChart('No recorded check-in times in this period.');
  const maximum=Math.max(1,...data.arrivalMatrix.flatMap(row=>row.counts));
  const level=count=>count===0?0:Math.min(3,Math.ceil(count/maximum*3));
  const dots=data.arrivalMatrix.map((row,r)=>'<text x="36" y="'+(35+r*24)+'" text-anchor="end">'+row.label+'</text>'+row.counts.map((count,h)=>'<circle class="arrival-dot level-'+level(count)+'" cx="'+(54+h*16)+'" cy="'+(31+r*24)+'" r="5"><title>'+row.label+' '+String(h).padStart(2,'0')+':00: '+count+' arrivals</title></circle>').join('')).join('');
  const ticks=[0,6,12,18,23].map(h=>'<text x="'+(54+h*16)+'" y="211" text-anchor="middle">'+String(h).padStart(2,'0')+':00</text>').join('');
  const labels=[0,1,2,3].map(l=>{const min=l?Math.floor((l-1)*maximum/3)+1:0,max=l?Math.floor(l*maximum/3):0;return l&&min>max?'':'<span><i class="arrival-dot level-'+l+'"></i>'+min+(min===max?'':'&ndash;'+max)+'</span>';}).join('');
  const summary=data.arrivalMatrix.flatMap(row=>row.counts.map((count,h)=>count?row.label+' '+h+':00, '+count+' arrivals':'').filter(Boolean)).join('; ');
  return '<div class="admin-arrival-matrix"><svg viewBox="0 0 448 226" role="img" aria-label="Arrival counts by weekday and hour"><desc>'+summary+'</desc>'+dots+ticks+'</svg><div class="arrival-matrix-legend"><span>Arrivals per dot</span>'+labels+'</div></div>';
}

function adminTimingColumns(data) {
  const rows=[{label:'Waiting time',value:data.wait,samples:data.waitSamples},{label:'Service time',value:data.service,samples:data.serviceSamples}];
  if(rows.every(r=>r.value===null))return emptyChart('No valid timing records in this period.');
  const step=Math.max(1,Math.ceil(Math.max(...rows.map(r=>r.value||0))/4)),max=step*4;
  const duration=value=>{if(value===null)return 'No data';const seconds=Math.round(value*60);return Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' sec';};
  const ticks=[0,2,4].map(i=>{const y=180-i*35;return '<line x1="54" x2="410" y1="'+y+'" y2="'+y+'" stroke="var(--border)" stroke-opacity=".5"/><text x="44" y="'+(y+4)+'" text-anchor="end">'+i*step+'</text>';}).join('');
  const columns=rows.map((row,i)=>{const x=155+i*155,height=(row.value||0)/max*140;return '<g><text x="'+x+'" y="'+(172-height)+'" text-anchor="middle" class="timing-value">'+duration(row.value)+'</text>'+(row.value!==null?'<rect x="'+(x-18)+'" y="'+(180-height)+'" width="36" height="'+height+'" rx="2" fill="'+(i?'var(--text-soft)':'var(--dashboard-chart-1)')+'"><title>'+row.label+': '+duration(row.value)+'</title></rect>':'')+'<text x="'+x+'" y="205" text-anchor="middle">'+row.label+'</text><text x="'+x+'" y="224" text-anchor="middle">'+row.samples+' valid '+(row.samples===1?'sample':'samples')+'</text></g>';}).join('');
  return '<div class="admin-timing-columns"><svg viewBox="0 0 440 240" role="img" aria-label="Average waiting time '+duration(data.wait)+', '+data.waitSamples+' samples; average service time '+duration(data.service)+', '+data.serviceSamples+' samples. Vertical axis in minutes, starting at zero."><text x="12" y="20">Minutes</text>'+ticks+columns+'</svg></div>';
}

function adminSatisfactionPictogram(data) {
  if(!data.feedback)return emptyChart('No feedback on completed visits in this period.');
  const percent=data.satisfied/data.feedback*100;
  const person='<svg viewBox="0 0 16 28" aria-hidden="true" focusable="false"><circle cx="8" cy="4" r="3"/><path d="M4 8h8a2 2 0 0 1 2 2v8h-3v10H8.5V18h-1v10H5V18H2v-8a2 2 0 0 1 2-2Z"/></svg>';
  const figures=Array.from({length:10},(_,i)=>{const fill=Math.max(0,Math.min(100,(percent-i*10)*10));return '<span class="satisfaction-person">'+person+'<span class="satisfaction-person-fill" style="clip-path:inset(0 '+(100-fill)+'% 0 0)">'+person+'</span></span>';}).join('');
  return '<div class="admin-satisfaction"><div class="admin-satisfaction-heading"><strong>'+Math.round(percent)+'%</strong><span>Satisfied respondents</span></div><div class="satisfaction-figures" role="img" aria-label="'+data.satisfied+' of '+data.feedback+' respondents rated 4 or 5 stars. Each figure represents 10 percentage points.">'+figures+'</div><p>'+data.satisfied+' of '+data.feedback+' respondents rated 4&ndash;5 stars</p><div class="admin-satisfaction-average">Average rating <strong>'+data.rating+' / 5</strong></div></div>';
}
