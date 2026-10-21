async function renderCalendarAudit() {
  const content = document.getElementById('content'), panel = document.createElement('div');
  panel.className = 'card card-pad'; panel.id = 'calendarAudit';
  panel.innerHTML = '<h3>Calendar changes</h3><p>Loading saved calendar changes…</p>';
  content.appendChild(panel);
  try {
    const session = JSON.parse(sessionStorage.getItem('ossuniserve_session') || '{}');
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/calendar/audit', {headers: {Accept:'application/json',Authorization:'Bearer '+(session.token || '')}});
    if (!response.ok) throw new Error('Cannot load calendar audit records. Please sign in again or check the backend.');
    const {entries} = await response.json();
    if (!panel.isConnected) return;
    panel.innerHTML = `<h3>Calendar changes</h3><p class="muted">Latest 500 saved changes · Bookings are retained.</p>${entries.length ? entries.map(e => {
      const changes = [];
      if (JSON.stringify(e.before.weekly) !== JSON.stringify(e.after.weekly)) changes.push('Weekly hours');
      if (JSON.stringify(e.before.lunch) !== JSON.stringify(e.after.lunch)) changes.push('Lunch break');
      const dates = new Set([...Object.keys(e.before.days),...Object.keys(e.after.days)]);
      for (const date of dates) if (JSON.stringify(e.before.days[date]) !== JSON.stringify(e.after.days[date])) changes.push(date);
      const date=new Date(e.created_at.includes('T')?e.created_at:e.created_at.replace(' ','T')+'Z');
      const when=date.toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})+' ? '+date.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
      return `<details style="margin:14px 0"><summary>${escapeHtml(when)} · ${escapeHtml(e.actor_name)} · ${escapeHtml(changes.join(', '))}</summary><p>${e.effects.affected} booking(s) affected. Decision: ${e.effects.decision === 'review' ? 'Review bookings' : 'Keep bookings'}.</p><p>Admin ID: ${escapeHtml(e.actor_id)}</p><p>Revision ${e.before.revision} → ${e.after.revision}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify({before:e.before,after:e.after},null,2))}</pre></details>`;
    }).join('') : '<p>No calendar changes yet.</p>'}`;
  } catch (error) {panel.innerHTML = `<h3>Calendar changes</h3><p role="alert">${escapeHtml(error.message)}</p>`;}
}
