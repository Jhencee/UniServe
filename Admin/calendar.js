let calendarMonth = OfficeCalendar.parts().date.slice(0, 7);
let calendarBusy = false;
let calendarDisplayedConfig = null;

function calendarAppointmentWarning() {
  const date = document.getElementById('mApptDate')?.value, time = document.getElementById('mApptTime')?.value;
  const warning = document.getElementById('calendarApptWarning');
  if (!warning) return;
  warning.textContent = date && time && !OfficeCalendar.at(date,time).open ? OfficeCalendar.at(date,time).reason + '. Choose an open time outside lunch.' : '';
}

function calendarMove(delta) {
  const date = new Date(calendarMonth + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  calendarMonth = date.toISOString().slice(0, 7); renderCalendar();
}
function calendarStatusPill(type) {
  const classes = {open: 'pill-ok', closed: 'pill-danger', holiday: 'pill-info', special: 'pill-warn'};
  const labels = {open: 'Open', closed: 'Closed', holiday: 'Holiday', special: 'Special hours'};
  return '<span class="pill ' + classes[type] + '">' + labels[type] + '</span>';
}
function renderCalendar() {
  const cfg = OfficeCalendar.get(), first = new Date(calendarMonth + '-01T12:00:00Z');
  calendarDisplayedConfig = cfg;
  const count = new Date(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getDate();
  const todayKey = OfficeCalendar.parts().date, names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const upcoming = Object.entries(cfg.days).filter(([date, day]) => date >= todayKey && day.type !== 'open').sort(([a],[b]) => a.localeCompare(b)).slice(0, 6);
  document.getElementById('content').innerHTML = `
    <div class="calendar-page">
      <div class="card">
        <div class="card-head"><div><h3>Daily hours</h3><div class="desc">Weekly schedule</div></div><button class="btn btn-ghost btn-sm" onclick="calendarEditHours()">${icon('edit',14)} Edit hours</button></div>
        <div class="card-pad calendar-schedule"><div class="calendar-week">${cfg.weekly.map((day,i) => `<div class="calendar-weekday${day.open ? '' : ' is-closed'}"><span class="calendar-weekday-name">${names[i]}</span><div class="calendar-weekday-hours">${day.open ? '<div class="calendar-time-range"><time>' + OfficeCalendar.clock(day.start) + '</time><span aria-hidden="true">?</span><time>' + OfficeCalendar.clock(day.end) + '</time></div>' : '<span class="calendar-closed-label">Closed</span>'}</div></div>`).join('')}</div>
          <div class="calendar-lunch"><span>${icon('clock',14)} Lunch break</span><span>${cfg.lunch.enabled ? OfficeCalendar.clock(cfg.lunch.start) + ' &ndash; ' + OfficeCalendar.clock(cfg.lunch.end) : 'Disabled'}</span></div>
        </div>
      </div>
      <div class="calendar-layout">
        <div class="card">
          <div class="card-head"><div><h3>${first.toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'})}</h3><div class="desc">Select a day to manage its hours or closure.</div></div><div class="toolbar calendar-month-controls"><button type="button" class="btn btn-ghost btn-sm" title="Previous month" aria-label="Previous month" onclick="calendarMove(-1)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><button class="btn btn-ghost btn-sm" onclick="calendarMonth=OfficeCalendar.parts().date.slice(0,7);renderCalendar()">Today</button><button class="btn btn-ghost btn-sm" aria-label="Next month" onclick="calendarMove(1)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button></div></div>
          <div class="calendar-legend">${['open','closed','holiday','special'].map(calendarStatusPill).join('')}</div>
          <div class="calendar-grid">${names.map(n => `<span class="calendar-heading">${n}</span>`).join('')}${'<span class="calendar-empty"></span>'.repeat(first.getUTCDay())}${Array.from({length:count},(_,i) => {
            const date = `${calendarMonth}-${String(i+1).padStart(2,'0')}`, day = OfficeCalendar.day(date,cfg);
            const label = day.name || (day.type === 'special' ? OfficeCalendar.clock(day.start) + ' � ' + OfficeCalendar.clock(day.end) : day.open ? '' : 'Closed');
            return `<button class="calendar-day cal-${day.type} ${date === todayKey ? 'cal-today' : ''}" onclick="calendarEditDay('${date}')" aria-label="${date}, ${escapeHtml(day.name || day.type)}" ${date === todayKey ? 'aria-current="date"' : ''}><span class="calendar-day-number">${i+1}</span><span class="calendar-day-label">${escapeHtml(label)}</span><span class="calendar-day-dot" aria-hidden="true"></span></button>`;
          }).join('')}</div>
        </div>
        <div class="card calendar-upcoming"><div class="card-head"><div><h3>Coming up</h3><div class="desc">Upcoming holidays and changes</div></div></div><div class="card-pad">${upcoming.length ? upcoming.map(([date,day]) => `<div class="calendar-upcoming-item"><div class="calendar-upcoming-date">${new Date(date+'T12:00:00Z').toLocaleDateString('en-PH',{month:'short',day:'numeric',timeZone:'UTC'})} ${calendarStatusPill(day.type)}</div><div class="calendar-upcoming-name">${escapeHtml(day.name || 'Special hours')}</div>${day.type === 'special' ? `<div class="field-hint">${OfficeCalendar.clock(day.start)} &ndash; ${OfficeCalendar.clock(day.end)}</div>` : ''}</div>`).join('') : '<p class="muted">No upcoming exceptions.</p>'}</div></div>
      </div>
    </div>`;
}
function calendarEditHours() {
  const cfg = OfficeCalendar.get(); calendarDisplayedConfig = cfg;
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  openModal('Daily hours', `<p class="field-hint calendar-hours-note">Set the weekly schedule and lunch break. Day overrides still apply.</p><div class="calendar-hours-editor">${cfg.weekly.map((day,i) => `<div class="calendar-hours-row"><label class="calendar-check" for="calOpen${i}"><input type="checkbox" id="calOpen${i}" ${day.open ? 'checked' : ''} onchange="calendarToggleHours(${i})">${names[i]}</label><div class="field"><label for="calStart${i}">Opens</label><input type="time" id="calStart${i}" value="${day.start}" ${day.open ? '' : 'disabled'}></div><div class="field"><label for="calEnd${i}">Closes</label><input type="time" id="calEnd${i}" value="${day.end}" ${day.open ? '' : 'disabled'}></div></div>`).join('')}</div><div class="divider"></div><label class="calendar-check" for="calLunchEnabled"><input type="checkbox" id="calLunchEnabled" ${cfg.lunch.enabled ? 'checked' : ''} onchange="calendarToggleLunch()">Lunch break</label><div class="form-row calendar-lunch-fields"><div class="field"><label for="calLunchStart">Starts</label><input type="time" id="calLunchStart" value="${cfg.lunch.start}" ${cfg.lunch.enabled ? '' : 'disabled'}></div><div class="field"><label for="calLunchEnd">Ends</label><input type="time" id="calLunchEnd" value="${cfg.lunch.end}" ${cfg.lunch.enabled ? '' : 'disabled'}></div></div>`, [{label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Save daily hours',cls:'btn-primary',action:calendarSaveHours}]);
}
function calendarToggleHours(i) {
  const disabled = !document.getElementById('calOpen'+i).checked;
  document.getElementById('calStart'+i).disabled = disabled; document.getElementById('calEnd'+i).disabled = disabled;
}
function calendarToggleLunch() {
  const disabled = !document.getElementById('calLunchEnabled').checked;
  document.getElementById('calLunchStart').disabled = disabled; document.getElementById('calLunchEnd').disabled = disabled;
}
function calendarEditDay(date) {
  const cfg = OfficeCalendar.get(), existing = cfg.days[date] || OfficeCalendar.day(date,cfg);
  openModal(`Calendar · ${date}`, `
    <div class="field"><label for="calType">Day status</label><select id="calType">${['open','closed','holiday','special'].map(type => `<option value="${type}" ${existing.type === type ? 'selected' : ''}>${type === 'special' ? 'Special hours' : type[0].toUpperCase()+type.slice(1)}</option>`).join('')}</select></div>
    <div class="field"><label for="calName">Closure reason / holiday name / special-hours note</label><input id="calName" maxlength="200" value="${escapeHtml(existing.name || '')}" placeholder="Suspension, maintenance, Independence Day…"></div>
    <div class="form-row"><div class="field"><label for="calDayStart">Special opening time</label><input id="calDayStart" type="time" value="${existing.start || '08:00'}"></div><div class="field"><label for="calDayEnd">Special closing time</label><input id="calDayEnd" type="time" value="${existing.end || '17:00'}"></div></div>
    `, [
    {label:'Use weekly schedule',cls:'calendar-weekly-schedule',action:() => calendarUseWeeklySchedule(date)},
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Save day',cls:'btn-primary',action:() => {
      const type = document.getElementById('calType').value, name = document.getElementById('calName').value.trim();
      if (['closed','holiday'].includes(type) && !name) {toast('Enter a reason or holiday name.','err');return;}
      cfg.days[date] = {type,name};
      if (type === 'special') {
        const start = document.getElementById('calDayStart').value, end = document.getElementById('calDayEnd').value;
        if (!start || !end || start >= end) {toast('Closing time must be after opening time.','err');return;}
        Object.assign(cfg.days[date],{start,end});
      }
      calendarConfirmSave(cfg,date);
    }}]);
}
function calendarUseWeeklySchedule(date) {
  const cfg = OfficeCalendar.get();
  delete cfg.days[date];
  calendarConfirmSave(cfg,date);
}
function calendarSaveHours() {
  const cfg = JSON.parse(JSON.stringify(calendarDisplayedConfig || OfficeCalendar.get()));
  cfg.weekly = cfg.weekly.map((_,i) => ({open:document.getElementById(`calOpen${i}`).checked,start:document.getElementById(`calStart${i}`).value,end:document.getElementById(`calEnd${i}`).value}));
  cfg.lunch = {enabled:document.getElementById('calLunchEnabled').checked,start:document.getElementById('calLunchStart').value,end:document.getElementById('calLunchEnd').value};
  if ([...cfg.weekly,cfg.lunch].some(range => !range.start || !range.end || range.start >= range.end)) {toast('Each closing time must be after its opening time.','err');return;}
  calendarConfirmSave(cfg,'Daily hours');
}
function calendarAffected(cfg,target) {
  const singleDay = /^\d{4}-\d{2}-\d{2}$/.test(target);
  return loadDB().appointments.filter(a => a.date >= OfficeCalendar.parts().date && (!singleDay || a.date === target) && ['Requested','Booked'].includes(a.status) && (() => {
    if (!a.time) return !OfficeCalendar.intervals(a.date,cfg).length;
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(a.time);
    if (!match) return false;
    let hour = Number(match[1]); if (match[3]) hour = hour % 12 + (/PM/i.test(match[3]) ? 12 : 0);
    const time = `${String(hour).padStart(2,'0')}:${match[2]}`;
    const now=OfficeCalendar.parts();
    if(a.date===now.date&&time<=now.time)return false;
    return OfficeCalendar.at(a.date,time).open && !OfficeCalendar.at(a.date,time,cfg).open;
  })());
}
function calendarConfirmSave(cfg,target) {
  if (calendarBusy) return;
  const affected = calendarAffected(cfg,target);
  if (!affected.length) {calendarPersist(cfg,target,affected,'keep');return;}
  openModal('Existing bookings are affected', `<p><b>${affected.length} booking(s)</b> fall within the new closure or lunch hours.</p><p>Choose how to handle them. Visitors retain their bookings until an Admin changes them.</p><ul>${affected.map(a => `<li>${escapeHtml(a.date+' '+a.time+' · '+a.name+' · '+(a.visitId || a.code))}</li>`).join('')}</ul>`,[
    {label:'Go back',cls:'btn-ghost',action:closeModal},
    {label:'Save & keep bookings',cls:'btn-ghost',action:() => calendarPersist(cfg,target,affected,'keep')},
    {label:'Save & review bookings',cls:'btn-primary',action:() => calendarPersist(cfg,target,affected,'review')}
  ]);
}
async function calendarPersist(cfg,target,affected,decision) {
  if (calendarBusy) return; calendarBusy = true;
  try {
    await OfficeCalendar.save(cfg,{affected:affected.length,decision});
    const db = loadDB();
    logActivity(db,currentUser,`Changed calendar ${target}; ${affected.length} booking(s) affected; ${decision}`,{category:'Settings',target,changes:[{field:'Calendar',from:'Revision '+cfg.revision,to:'Revision '+(cfg.revision+1)}]});
    saveDB(db); closeModal(); renderCalendar(); toast('Calendar saved.'+(affected.length?' '+affected.length+' booking(s) '+(decision==='review'?'flagged for review.':'kept as scheduled.'):' No existing bookings affected.'),'ok');
    if (decision === 'review') {navigate('appointments');if(typeof renderAppointments==='function')await renderAppointments(true); if (affected[0]) openApptDetail(affected[0].id);}
  } catch (error) {toast(escapeHtml(error.message),'err'); await OfficeCalendar.refresh();}
  finally {calendarBusy = false;}
}

if (typeof window !== 'undefined') window.addEventListener('office-calendar-change', () => { if (typeof state_view !== 'undefined' && state_view === 'appointments' && !document.getElementById('activeModal')) renderApptTable(); calendarAppointmentWarning(); });
