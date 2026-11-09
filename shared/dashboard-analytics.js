/* Shared aggregate analytics for every staff dashboard. No visitor details are rendered. */
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
  const graph = (rows, message, label, type = 'donut') => rows.length && rows.some(r => r.count) ? dashboardChart(rows, type, label) : emptyChart(message);
  return '<section class="dash-section analytics-operations" aria-label="Appointments, demand and service performance">' +
    card('Appointment attendance', 'Scheduled dates in the last 14 days', graph(data.attendance, 'No appointment activity in this period.', 'Appointment attendance breakdown'), data.appointments + ' appointments · Booked visits may still be awaiting arrival') +
    card('Busy arrival hours', 'Manila time · Arrivals in the last 14 days', graph(data.activeHours, 'No arrivals in this period.', 'Arrivals by hour of day', 'columns'), data.visits + ' arrivals · Hours with arrivals only') +
    card('Time since request submission', 'Current open transactions · Time since logged', graph(data.backlog, 'No unresolved requests.', 'Open requests by days since submission', 'segments'), data.open + ' unresolved requests · Calendar days') +
    card('Wait and service time', 'Minutes · Visits completed in the last 14 days', data.timing.length ? dashboardChart(data.timing, 'columns', 'Average wait and service time in minutes') : emptyChart('No completed visits with timing data.'), data.waitSamples + ' wait samples · ' + data.serviceSamples + ' service samples') + '</section>';
}
function dashboardBarChart(rows, label = 'Bar chart') {
  const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const max = Math.max(1, ...rows.map(r => r.count));
  const shades = ['#2563eb','#00b894','#f5a623','#9b51e0','#f15a24','#00a8cc'];
  return '<div class="dashboard-bars" role="img" aria-label="' + safe(label) + '">' + rows.map((r, i) =>
    '<div class="dashboard-bar-row"><span class="dashboard-bar-label" title="' + safe(r.label) + '">' + safe(r.label) + '</span><span class="dashboard-bar-track"><span class="dashboard-bar-fill" style="width:' + (r.count / max * 100).toFixed(1) + '%;background:' + shades[i % shades.length] + '"></span></span><strong>' + r.count + '</strong></div>'
  ).join('') + '</div>';
}
function dashboardChart(rows, type = 'donut', label = 'Chart') {
  const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const shades = ['#2563eb','#00b894','#f5a623','#9b51e0','#f15a24','#00a8cc'];
  const legend = rows.map((r, i) => '<div class="chart-legend-row"><i style="background:' + shades[i % shades.length] + '"></i><span>' + safe(r.label) + '</span><strong>' + r.count + '</strong></div>').join('');
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
