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
  const card=(title,description,body,note)=>'<section class="card admin-insight-card"><div class="card-head"><div><h3>'+title+'</h3><div class="desc">'+description+'</div></div></div><div class="card-pad">'+body+'</div><div class="analytics-footer">'+note+'</div></section>';
  const bars=(rows,empty)=>rows.some(r=>r.count)?dashboardBarChart(rows):emptyChart(empty);
  const timing=[];if(data.wait!==null)timing.push({label:'Arrival to service start',count:data.wait});if(data.service!==null)timing.push({label:'Service duration',count:data.service});
  return '<section class="admin-office-insights" aria-labelledby="officeInsightsTitle"><div class="admin-insights-heading"><div><h2 id="officeInsightsTitle">Office performance</h2><p>'+dates[0]+' to '+dates[dates.length-1]+' &middot; Philippine time &middot; Accessible records only</p></div></div><div class="admin-insights-grid">'+
    card('Arrivals and completed visits','Daily counts by actual check-in and completion date',data.arrivals||data.completed?superComparisonChart(data.daily.map(d=>d.label),[{label:'Arrivals',values:data.daily.map(d=>d.arrivals)},{label:'Completed',values:data.daily.map(d=>d.completed)}],'grouped','Daily arrivals and completed visits'):emptyChart('No recorded arrivals or completions in this period.'),data.arrivals+' arrivals &middot; '+data.completed+' completed visits. These may include different visits.')+
    card('Wait and service time','Average minutes for single-service visits completed in this period',timing.length?dashboardBarChart(timing):emptyChart('No complete timing records in this period.'),data.waitSamples+' wait samples &middot; '+data.serviceSamples+' service samples. Missing timestamps and transferred visits excluded.')+
    card('Most requested services','Top five services among checked-in visits in this period',bars(data.services,'No checked-in visits with service data.'),'Counts visits, not completed transactions. A transferred visit uses its current service.')+
    card('Busy arrival hours','Check-in times grouped by hour in Philippine time',bars(data.hours,'No recorded check-in times in this period.'),'Hours with arrivals only. Booking submission time is not used.')+
    card('Appointment outcomes','Current status of appointments scheduled within this period',bars(data.attendance,'No scheduled appointments in this period.'),data.appointments+' appointments. Awaiting visits are not counted as no-shows.')+
    card('Visitor feedback','Feedback on visits completed within this period',data.feedback?'<p class="admin-rating-summary"><strong>'+data.rating+' / 5</strong><span>'+data.feedback+' responses</span></p>'+dashboardBarChart(data.ratings):emptyChart('No feedback on completed visits in this period.'),'Optional responses; this does not represent every visitor.')+
    '</div></section>';
}
