/* Aggregates only accessible records. Missing timestamps are not invented. */
function adminOfficeInsights(db,dates) {
  const day=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?OfficeCalendar.parts(d).date:'';};
  const within=value=>dates.includes(day(value));
  const queues=(db.queues||[]).filter(q=>!q.restricted);
  const arrivals=queues.filter(q=>within(q.checkedInAt));
  const completed=queues.filter(q=>q.status==='Completed'&&within(q.completedAt));
  const appointments=(db.appointments||[]).filter(a=>!a.restricted&&dates.includes(a.date));
  const hours=Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0')+':00',count:0}));
  const services=new Map();
  arrivals.forEach(q=>{
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(new Date(q.checkedInAt)));
    hours[hour].count++;
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
    services:[...services.values()].sort((a,b)=>b.count-a.count).slice(0,5),hours:hours.filter(h=>h.count),
    attendance:[['Attended',['Checked-in','Completed','Unfinished']],['No-show',['No-show']],['Cancelled',['Cancelled']],['Awaiting arrival',['Booked','Scheduled']],['Awaiting approval',['Requested']]].map(([label,statuses])=>({label,count:appointments.filter(a=>statuses.includes(a.status)).length})),
    appointments:appointments.length,wait:mean(wait),service:mean(service),waitSamples:wait.length,serviceSamples:service.length,
    feedback:feedback.length,rating:mean(feedback.map(q=>q.feedback.rating)),ratings:[5,4,3,2,1].map(n=>({label:n+' stars',count:feedback.filter(q=>q.feedback.rating===n).length}))
  };
}
function adminOfficeInsightsHtml(db,dates) {
  const data=adminOfficeInsights(db,dates);
  const card=(title,description,body,note)=>'<section class="card admin-insight-card"><div class="card-head"><div><h3>'+title+'</h3><div class="desc">'+description+'</div></div></div><div class="card-pad">'+body+'</div><p class="admin-insight-note">'+note+'</p></section>';
  const bars=(rows,empty)=>rows.some(r=>r.count)?dashboardBarChart(rows):emptyChart(empty);
  const time=(label,value,samples)=>'<div><dt>'+label+'</dt><dd>'+(value===null?'&mdash;':value+'<small> min</small>')+'</dd><span>'+samples+' valid samples</span></div>';
  const timing='<dl class="admin-timing-summary">'+time('Average wait',data.wait,data.waitSamples)+time('Average service',data.service,data.serviceSamples)+'</dl>';
  const outcomes=data.appointments?'<ul class="admin-outcome-list">'+data.attendance.map(row=>'<li><span>'+row.label+'</span><strong>'+row.count+'</strong></li>').join('')+'</ul>':emptyChart('No scheduled appointments in this period.');
  return '<section class="admin-office-insights" aria-labelledby="officeInsightsTitle"><div class="admin-insights-heading"><div><h2 id="officeInsightsTitle">Office performance</h2><p>'+dates[0]+' to '+dates[dates.length-1]+' &middot; Philippine time &middot; Accessible records only</p></div></div><div class="admin-insights-grid">'+
    card('Arrivals and completions','Daily visits &middot; '+data.arrivals+' arrivals / '+data.completed+' completions',data.arrivals||data.completed?superComparisonChart(data.daily.map(d=>d.label),[{label:'Arrivals',values:data.daily.map(d=>d.arrivals)},{label:'Completed',values:data.daily.map(d=>d.completed)}],'line','Daily arrivals and completed visits'):emptyChart('No recorded arrivals or completions in this period.'),'Uses actual check-in and completion dates. Arrivals and completions may include different visits.')+
    card('Wait and service time','Single-service visits completed in this period',timing,'Wait measures arrival to service start. Service measures service start to completion. Missing or invalid timestamps and transferred visits are excluded; each figure shows its own sample count.')+
    card('Most requested services','Top five &middot; Checked-in visits',bars(data.services,'No checked-in visits with service data.'),'Counts visits, not completed transactions. A transferred visit uses its current service.')+
    card('Busy arrival hours','Check-ins by hour &middot; Philippine time',data.hours.length?dashboardChart(data.hours,'columns','Recorded arrivals by hour'):emptyChart('No recorded check-in times in this period.'),'Hours with arrivals only. Booking submission time is not used.')+
    card('Appointment outcomes',data.appointments+' appointments scheduled in this period',outcomes,'Shows current status. Awaiting visits are not counted as no-shows; attended includes checked-in, completed and unfinished visits.')+
    card('Visitor feedback','Visits completed in this period',data.feedback?'<p class="admin-rating-summary"><strong>'+data.rating+' <small>/ 5</small></strong><span>'+data.feedback+' responses</span></p><div class="admin-rating-bars">'+dashboardBarChart(data.ratings)+'</div>':emptyChart('No feedback on completed visits in this period.'),'Optional responses; this does not represent every visitor. Ratings belong to visits completed in the selected period, not necessarily feedback submitted during that period.')+
    '</div></section>';
}
