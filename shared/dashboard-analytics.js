/* Shared aggregate analytics for every staff dashboard. No visitor details are rendered. */
function dashboardMetricIcon(label) {
  const designs={
    Waiting:['amber','<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><path d="M12 7v5l3 2"/>'],
    Called:['blue','<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Z" fill="currentColor" opacity=".2"/><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4"/>'],
    Serving:['teal','<circle cx="12" cy="8" r="4" fill="currentColor" opacity=".22"/><path d="M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0Zm-3 12v-2a7 7 0 0 1 14 0v2"/>'],
    'Completed today':['emerald','<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><path d="m8 12 3 3 5-6"/>'],
    'Active staff accounts':['emerald','<circle cx="9" cy="8" r="4" fill="currentColor" opacity=".2"/><path d="M5 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM3 21v-2a6 6 0 0 1 12 0v2m1-9 2 2 4-5"/>'],
    'Disabled accounts':['blue','<circle cx="9" cy="8" r="4" fill="currentColor" opacity=".2"/><path d="M5 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM3 21v-2a6 6 0 0 1 12 0v2m2-8h5"/>'],
    'Failed or denied events':['amber','<path d="m12 3 10 18H2Z" fill="currentColor" opacity=".18"/><path d="m12 3 10 18H2Zm0 6v5m0 3h.01"/>'],
    'Configuration updates':['teal','<rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" opacity=".18"/><path d="M4 8h16M4 16h16M9 5v6m6 2v6"/>']
  };
  const design=designs[label];
  return design?'<span class="dashboard-metric-symbol tone-'+design[0]+'" aria-hidden="true"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+design[1]+'</svg></span>':'';
}
function dashboardOperationalData(db, start, end = new Date()) {
  const dayKey = value => {
    const date = new Date(value);
    return Number.isFinite(+date) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
  };
  const from = dayKey(start), to = dayKey(end);
  const inRange = value => { const date = new Date(value); return value && Number.isFinite(+date) && date >= start && date <= end; };
  const visits = (db.queues || []).filter(q => inRange(q.checkedInAt || q.createdAt));
  const appointments = (db.appointments || []).filter(a => a.date && a.date >= from && a.date <= to);
  const attendance = [
    { label: 'Attended', count: appointments.filter(a => ['Checked-in', 'Completed', 'Unfinished'].includes(a.status)).length },
    { label: 'No-show', count: appointments.filter(a => a.status === 'No-show').length },
    { label: 'Cancelled', count: appointments.filter(a => a.status === 'Cancelled').length },
    { label: 'Booked / scheduled', count: appointments.filter(a => ['Booked', 'Scheduled'].includes(a.status)).length },
    { label: 'Awaiting approval', count: appointments.filter(a => a.status === 'Requested').length }
  ];
  const hours = Array.from({ length: 24 }, () => 0);
  visits.forEach(q => { const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', hourCycle: 'h23' }).format(new Date(q.checkedInAt || q.createdAt))); hours[hour]++; });
  const activeHours = hours.map((count, hour) => ({ label: (hour % 12 || 12) + (hour >= 12 ? ' PM' : ' AM'), count, hour })).filter(r => r.count);
  const open = (db.transactions || []).filter(t => !['Completed', 'Approved', 'Rejected', 'Cancelled', 'Closed', 'Resolved'].includes(t.status));
  const age = t => Math.max(0, (end - new Date(t.createdAt)) / 86400000);
  const backlog = [{ label: 'Under 1 day', count: open.filter(t => age(t) < 1).length }, { label: '1–3 days', count: open.filter(t => age(t) >= 1 && age(t) < 4).length }, { label: '4–7 days', count: open.filter(t => age(t) >= 4 && age(t) < 8).length }, { label: '8+ days', count: open.filter(t => age(t) >= 8).length }];
  const completed = (db.queues || []).filter(q => q.status === 'Completed' && inRange(q.completedAt));
  const duration = (later, earlier) => later && earlier && Number.isFinite(+new Date(later)) && Number.isFinite(+new Date(earlier)) && new Date(later) >= new Date(earlier) ? (new Date(later) - new Date(earlier)) / 60000 : null;
  const wait = completed.map(q => duration(q.calledAt, typeof visitStart === 'function' ? visitStart(q) : q.checkedInAt || q.createdAt)).filter(v => v != null);
  const service = completed.map(q => duration(q.completedAt, q.servingAt)).filter(v => v != null);
  const average = rows => Math.round(rows.reduce((a, b) => a + b, 0) / rows.length * 10) / 10;
  const timing = [];
  if (wait.length) timing.push({ label: 'Average wait', count: average(wait) });
  if (service.length) timing.push({ label: 'Average service', count: average(service) });
  return { attendance, appointments: appointments.length, activeHours, visits: visits.length, backlog, open: open.length, timing, waitSamples: wait.length, serviceSamples: service.length };
}
function dashboardOperationalHtml(db, start, end, card) {
  const data = dashboardOperationalData(db, start, end);
  const graph = (rows, message, label, type = 'donut') => rows.length && rows.some(r => r.count) ? (type === 'pie' ? superPieChart(rows, label) : dashboardChart(rows, type, label)) : emptyChart(message);
  return '<section class="dash-section analytics-operations" aria-label="Appointments, demand and service performance">' +
    card('Appointment attendance', 'Scheduled dates in the last 14 days', graph(data.attendance, 'No appointment activity in this period.', 'Appointment attendance breakdown', 'columns'), data.appointments + ' appointments · Booked visits may still be awaiting arrival') +
    card('Busy arrival hours', 'Manila time · Arrivals in the last 14 days', graph(data.activeHours, 'No arrivals in this period.', 'Arrivals by hour of day', 'columns'), data.visits + ' arrivals · Hours with arrivals only') +
    card('Time since request submission', 'Current open transactions · Time since logged', graph(data.backlog, 'No unresolved requests.', 'Open requests by days since submission', 'columns'), data.open + ' unresolved requests · Calendar days') +
    card('Wait and service time', 'Minutes · Visits completed in the last 14 days', data.timing.length ? dashboardChart(data.timing, 'columns', 'Average wait and service time in minutes') : emptyChart('No completed visits with timing data.'), data.waitSamples + ' wait samples · ' + data.serviceSamples + ' service samples') + '</section>';
}
function dashboardBarChart(rows, label = 'Bar chart') {
  const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const max = Math.max(1, ...rows.map(r => r.count));
  const shades = ['var(--dashboard-chart-1, #2563eb)','var(--dashboard-chart-2, #00b894)','var(--dashboard-chart-3, #f5a623)','var(--dashboard-chart-4, #9b51e0)','var(--dashboard-chart-5, #f15a24)','var(--dashboard-chart-6, #00a8cc)'];
  return '<div class="dashboard-bars" role="img" aria-label="' + safe(label) + '">' + rows.map((r, i) =>
    '<div class="dashboard-bar-row"><span class="dashboard-bar-label" title="' + safe(r.label) + '">' + safe(r.label) + '</span><span class="dashboard-bar-track"><span class="dashboard-bar-fill" style="width:' + (r.count / max * 100).toFixed(1) + '%;background:' + shades[i % shades.length] + '"></span></span><strong>' + r.count + '</strong></div>'
  ).join('') + '</div>';
}
function dashboardChart(rows, type = 'donut', label = 'Chart', colors = null) {
  const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const shades = colors || ['var(--dashboard-chart-1, #2563eb)','var(--dashboard-chart-2, #00b894)','var(--dashboard-chart-3, #f5a623)','var(--dashboard-chart-4, #9b51e0)','var(--dashboard-chart-5, #f15a24)','var(--dashboard-chart-6, #00a8cc)'];
  const legend = rows.map((r, i) => '<div class="chart-legend-row"><i style="background:' + shades[i % shades.length] + '"></i><span>' + safe(r.label) + '</span><strong>' + r.count + '</strong></div>').join('');
  if (type === 'rings') {
    const rings=rows.map((row,index)=>{
      const radius=60-index*14,length=2*Math.PI*radius,track=length*.75,filled=total?track*row.count/total:0;
      return '<g transform="rotate(135 80 80)"><circle cx="80" cy="80" r="'+radius+'" fill="none" stroke="var(--border)" stroke-width="8" stroke-dasharray="'+track+' '+length+'" stroke-linecap="round"/><circle cx="80" cy="80" r="'+radius+'" fill="none" stroke="'+shades[index%shades.length]+'" stroke-width="8" stroke-dasharray="'+filled+' '+length+'" stroke-linecap="'+(filled?'round':'butt')+'"><title>'+safe(row.label)+': '+row.count+' of '+total+' checks</title></circle></g>';
    }).join('');
    return '<div class="dashboard-segments dashboard-rings" role="img" aria-label="'+safe(label)+'"><svg viewBox="0 0 160 160">'+rings+'<text x="80" y="83" text-anchor="middle" fill="var(--text)" font-size="20">'+total+'</text><text x="80" y="100" text-anchor="middle" fill="var(--text-soft)" font-size="10">checks</text></svg><div class="chart-legend">'+legend+'</div></div>';
  }
  if (type === 'donut') {
    let offset = 0;
    const arcs = rows.filter(r => r.count > 0).map(r => {
      const index = rows.indexOf(r), length = total ? r.count / total * 100 : 0;
      const angle = value => (value / 100 * 360 - 90) * Math.PI / 180;
      const point = value => [70 + 50 * Math.cos(angle(value)), 70 + 50 * Math.sin(angle(value))];
      const from = point(offset), to = point(offset + length);
      const shape = length >= 99.999999 ? '<circle cx="70" cy="70" r="50"' : '<path d="M ' + from.join(' ') + ' A 50 50 0 ' + (length > 50 ? 1 : 0) + ' 1 ' + to.join(' ') + '"';
      const arc = shape + ' fill="none" stroke="' + shades[index % shades.length] + '" stroke-width="16" stroke-linecap="butt"><title>' + safe(r.label) + ': ' + r.count + '</title>' + (length >= 99.999999 ? '</circle>' : '</path>');
      offset += length; return arc;
    }).join('');
    return '<div class="dashboard-donut" role="img" aria-label="' + safe(label) + '"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="50" fill="none" stroke="var(--border)" stroke-width="16"/>' + arcs + '<text x="70" y="69" text-anchor="middle" fill="var(--text)" font-size="23">' + total + '</text><text x="70" y="87" text-anchor="middle" fill="var(--text-soft)" font-size="10">Total</text></svg><div class="chart-legend">' + legend + '</div></div>';
  }
  if (type === 'segments') return '<div class="dashboard-segments" role="img" aria-label="' + safe(label) + '"><div class="segment-track">' + rows.map((r,i) => '<span style="flex:' + r.count + ';background:' + shades[i % shades.length] + '"><span class="sr-only">' + safe(r.label) + ': ' + r.count + '</span></span>').join('') + '</div><div class="chart-legend">' + legend + '</div></div>';
  const max = Math.max(1, ...rows.map(r => r.count)), width = 480, step = 440 / Math.max(1, rows.length);
  return '<svg class="dashboard-columns" viewBox="0 0 480 160" role="img" aria-label="' + safe(label) + '"><line x1="20" y1="130" x2="460" y2="130" stroke="var(--border)"/>' + rows.map((r,i) => {
    const x = 20 + step * (i + .5), h = r.count / max * 94;
    return '<g><title>' + safe(r.label) + ': ' + r.count + '</title><rect x="' + (x - Math.min(22, step * .3)) + '" y="' + (130-h) + '" width="' + Math.min(44,step*.6) + '" height="' + h + '" rx="2" fill="' + shades[i % shades.length] + '"/><text x="' + x + '" y="' + (122-h) + '" text-anchor="middle" fill="var(--text)" font-size="11">' + r.count + '</text><text x="' + x + '" y="150" text-anchor="middle" fill="var(--text-soft)" font-size="10">' + safe(r.label) + '</text></g>';
  }).join('') + '</svg>';
}

function dashboardTrendChart(trend, label, unit = 'transactions', options = {}) {
  const { labels, values } = trend;
  const gradientId = `trend-fill-${dashboardTrendChart.gradientSequence = (dashboardTrendChart.gradientSequence || 0) + 1}`;
  const w = options.width || 480, h = 220, padL = 42, padR = 24, padT = 20, padB = 34, innerW = w - padL - padR, innerH = h - padT - padB;
  const max = Math.max(1, ...values), stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: padL + (values.length > 1 ? i * stepX : innerW / 2), y: padT + innerH - (v / max) * innerH, v }));
  const line = pts.map((p, i) => {
    if (!i) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const previous = pts[i - 1], middle = (previous.x + p.x) / 2;
    return `C${middle.toFixed(1)},${previous.y.toFixed(1)} ${middle.toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z` : '';
  const tickCount = Math.min(5, max) + 1;
  const grid = Array.from({length:tickCount},(_,i)=>i/(tickCount-1)).map(f => { const y = padT + innerH - f * innerH; return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--text)" stroke-opacity="0.05"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--text)">${Math.round(max * f)}</text>`; }).join('');
  const xl = pts.map((p, i) => `<text x="${p.x.toFixed(1)}" y="${h - 10}" font-size="10" text-anchor="middle" fill="var(--text)">${escapeHtml(labels[i])}</text>`).join('');
  const dots = pts.map(p => `<g class="cl-point-group"><circle class="cl-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" stroke-width="2"/><text class="cl-val-label" x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--text)">${p.v}</text></g>`).join('');
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? (total / values.length).toFixed(1) : '0';
  const peak = values.length ? Math.max(...values) : 0;
  return `<div class="trend-summary"><span>Total <strong>${total}</strong></span><span>Daily average <strong>${average}</strong></span><span>Busiest day <strong>${peak} ${escapeHtml(unit)}</strong></span></div><div class="trend-chart-scroll"><svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; max-height:240px;" role="img" aria-label="${escapeHtml(label || 'Activity over time')}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--trend-color, #800000)" stop-opacity="0.38"/><stop offset="100%" stop-color="var(--trend-color, #800000)" stop-opacity="0.025"/></linearGradient></defs>${grid}${area && options.area !== false ? `<path class="cl-area" style="--trend-fill:url(#${gradientId})" d="${area}" stroke="none"/>` : ''}<path class="cl-line" pathLength="1000" d="${line}" fill="none" stroke-width="2.5"/>${dots}${xl}</svg></div>`;
}
