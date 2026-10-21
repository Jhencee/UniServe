/* Shared office calendar. All dates and times use Asia/Manila. */
(function (root) {
  'use strict';
  const API = (globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/calendar';
  const KEY = 'ossuniserve_calendar_v1';
  const holidays = {
    '2026-01-01': "New Year's Day", '2026-02-17': 'Chinese New Year',
    '2026-03-20': "Eid’l Fitr", '2026-04-02': 'Maundy Thursday',
    '2026-04-03': 'Good Friday', '2026-04-04': 'Black Saturday',
    '2026-04-09': 'Araw ng Kagitingan', '2026-05-01': 'Labor Day',
    '2026-05-27': "Eid’l Adha", '2026-06-12': 'Independence Day',
    '2026-08-21': 'Ninoy Aquino Day', '2026-08-31': 'National Heroes Day',
    '2026-11-01': "All Saints’ Day", '2026-11-02': "All Souls’ Day",
    '2026-11-30': 'Bonifacio Day', '2026-12-08': 'Feast of the Immaculate Conception of Mary',
    '2026-12-24': 'Christmas Eve', '2026-12-25': 'Christmas Day',
    '2026-12-30': 'Rizal Day', '2026-12-31': 'Last Day of the Year'
  };
  function defaults() {
    return { revision: 0, weekly: Array.from({length: 7}, (_, i) => ({open: i > 0 && i < 6, start: '08:00', end: '17:00'})),
      lunch: {enabled: true, start: '12:00', end: '13:00'},
      days: Object.fromEntries(Object.entries(holidays).map(([date, name]) => [date, {type: 'holiday', name}])) };
  }
  let config = defaults(), available = false;
  try { config = JSON.parse(localStorage.getItem(KEY)) || config; } catch (_) {}
  function parts(now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now).map(x => [x.type, x.value]));
    return {date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`};
  }
  function day(date, cfg = config) {
    // UTC midnight is the preceding day for +08:00; use noon for weekday.
    const w = new Date(date + 'T12:00:00+08:00').getUTCDay();
    const schedule = cfg.weekly[w], exception = cfg.days[date];
    if (exception && ['closed', 'holiday'].includes(exception.type)) return {...exception, open: false};
    if (exception && ['open', 'special'].includes(exception.type)) return {...exception, open: true, start: exception.start || schedule.start, end: exception.end || schedule.end};
    return {...schedule, type: schedule.open ? 'open' : 'closed', name: schedule.open ? '' : 'Weekend'};
  }
  function intervals(date, cfg = config) {
    const d = day(date, cfg);
    if (!d.open) return [];
    const lunch = cfg.lunch;
    if (!lunch.enabled || lunch.end <= d.start || lunch.start >= d.end) return [[d.start, d.end]];
    return [[d.start, lunch.start < d.end ? lunch.start : d.end], [lunch.end > d.start ? lunch.end : d.start, d.end]].filter(([a,b]) => a < b);
  }
  function at(date, time, cfg = config) {
    const d = day(date, cfg), open = intervals(date, cfg).some(([a,b]) => time >= a && time < b);
    const lunch = d.open && cfg.lunch.enabled && time >= cfg.lunch.start && time < cfg.lunch.end && time >= d.start && time < d.end;
    return {open, reason: open ? 'Open now' : lunch ? 'Closed for lunch' : !d.open ? `Closed today, ${d.name || d.reason || 'Office closure'}` : 'Closed outside daily hours', lunch};
  }
  function clock(time) { const [h,m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; }
  function label() {
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const groups = new Map();
    config.weekly.forEach((d,i) => { const hours = d.open ? `${clock(d.start)}–${clock(d.end)}` : 'closed'; if (!groups.has(hours)) groups.set(hours,[]); groups.get(hours).push(names[i]); });
    return [...groups].map(([hours,days]) => `${days.join(', ')} ${hours}`).join('; ') + (config.lunch.enabled ? `; lunch ${clock(config.lunch.start)}–${clock(config.lunch.end)}` : '') + '. Holidays and day overrides apply.';
  }
  function status(now = new Date(), cfg = config) {
    const p = parts(now), state = at(p.date, p.time, cfg);
    let next = null;
    if (!state.open) for (let offset = 0; offset < 370 && !next; offset++) {
      const date = new Date(new Date(p.date + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0,10);
      for (const [start] of intervals(date, cfg)) if (offset || start > p.time) { next = {date, time: start}; break; }
    }
    const openingDay = next ? new Date(next.date + 'T12:00:00+08:00').toLocaleDateString('en-PH', {timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', ...(next.date.slice(0,4) !== p.date.slice(0,4) ? {year: 'numeric'} : {})}) : '';
    const nextLabel = next ? `${next.date === p.date ? 'Today, ' : ''}${openingDay} at ${clock(next.time)}` : 'No opening is scheduled within the next year';
    return {...state, next, nextLabel, message: state.lunch && next && next.date === p.date ? `Closed for lunch, back at ${clock(next.time)}` : state.reason};
  }
  async function refresh() {
    try {
      const response = await fetch(API, {headers: {Accept: 'application/json'}});
      if (!response.ok) throw new Error('Calendar unavailable');
      const incoming = (await response.json()).calendar;
      if (incoming.revision >= config.revision) config = incoming;
      available = true;
      localStorage.setItem(KEY, JSON.stringify(config));
      root.dispatchEvent(new Event('office-calendar-change'));
      return true;
    } catch (_) { available = false; return false; }
  }
  async function save(candidate, effects) {
    const session = JSON.parse(sessionStorage.getItem('ossuniserve_session') || '{}');
    const response = await fetch(API, {method: 'PUT', headers: {Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session.token || '')}, body: JSON.stringify({calendar: candidate, effects})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Calendar could not be saved.');
    config = result.calendar; available = true; localStorage.setItem(KEY, JSON.stringify(config));
    root.dispatchEvent(new Event('office-calendar-change'));
    return result;
  }
  root.OfficeCalendar = {defaults, parts, day, intervals, at, status, clock, label, refresh, save, get: () => JSON.parse(JSON.stringify(config)), ready: () => available};
  if (typeof document !== 'undefined') {
    refresh(); setInterval(refresh, 15000);
    root.addEventListener('storage', e => { if (e.key === KEY) { try { config = JSON.parse(e.newValue) || defaults(); root.dispatchEvent(new Event('office-calendar-change')); } catch (_) {} } });
  }
})(globalThis);
