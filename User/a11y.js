/* a11y.js — load AFTER user.js. Layers accessibility onto the existing app
   without rewriting it: it wraps a few global functions and enhances the DOM
   whenever it changes. */
(function () {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    /* ---------- live region for announcements ---------- */
    const live = document.createElement('div');
    live.id = 'a11yLive';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.appendChild(live);
    function announce(msg) {
        live.textContent = '';
        setTimeout(() => { live.textContent = msg; }, 60);
    }
    window.a11yAnnounce = announce;

    /* ---------- landmarks, skip link, static markup ---------- */
    const content = $('#visitorContent');
    content.setAttribute('tabindex', '-1');
    content.setAttribute('role', 'region');
    const menuBtn = $('.menu-btn');
    const sidebar = $('#visitorSidebar');
    if (menuBtn) {
        menuBtn.setAttribute('aria-label', 'Open menu');
        menuBtn.setAttribute('aria-controls', 'visitorSidebar');
        const syncMenu = () => {
            const open = sidebar.classList.contains('open');
            menuBtn.setAttribute('aria-expanded', String(open));
            menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        };
        new MutationObserver(syncMenu).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        syncMenu();
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && sidebar.classList.contains('open') && !$('#activeModal')) {
                sidebar.classList.remove('open');
                menuBtn.focus();
            }
        });
    }

    /* ---------- modal: role, labelled, focus trap, background inert, focus restore ---------- */
    let lastFocus = null, suppressRestore = false;
    const _openModal = window.openModal, _closeModal = window.closeModal;
    window.openModal = function (title, bodyHtml, buttons) {
        if (!$('#activeModal')) lastFocus = document.activeElement;
        suppressRestore = true;
        _openModal.call(this, title, bodyHtml, buttons);
        suppressRestore = false;
        const wrap = $('#activeModal'), m = wrap && $('.modal', wrap);
        if (!m) return;
        const h = $('.modal-head h3', m);
        if (h) { h.id = 'activeModalTitle'; m.setAttribute('aria-labelledby', 'activeModalTitle'); }
        const closeX = $('#modalCloseX');
        if (closeX) closeX.setAttribute('aria-label', 'Close dialog');
        $('#visitorApp').inert = true;
        const first = $('.modal-body input, .modal-body select, .modal-body textarea', m);
        (first || m).focus();
    };
    window.closeModal = function () {
        const had = !!$('#activeModal');
        _closeModal();
        if (suppressRestore || !had) return;
        $('#visitorApp').inert = false;
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        lastFocus = null;
    };
    document.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const m = $('#activeModal .modal');
        if (!m) return;
        const items = $$(FOCUSABLE, m).filter(el => el.offsetParent !== null);
        if (!items.length) { e.preventDefault(); m.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === m)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* ---------- form errors: aria-invalid + aria-describedby ---------- */
    const _markField = window.markField;
    window.markField = function (id, ok, msg) {
        const r = _markField(id, ok, msg);
        const w = document.getElementById(id), i = w && $('input,select,textarea', w), e = w && $('.field-error', w);
        if (i) {
            i.setAttribute('aria-invalid', String(!ok));
            if (e) { e.id = e.id || id + 'Err'; i.setAttribute('aria-describedby', e.id); }
        }
        return r;
    };
    ['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
        if (e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false');
    }));
    const _focusFirstError = window.focusFirstError;
    window.focusFirstError = function () {
        _focusFirstError();
        const n = $$('.field.has-error').length;
        if (n) announce(n + (n === 1 ? ' field needs' : ' fields need') + ' attention.');
    };

    /* ---------- rating stars ---------- */
    const _setStars = window.setFeedbackStars;
    window.setFeedbackStars = function (n) { _setStars(n); syncStars(); };
    function syncStars() {
        $$('#fbStars .fb-star').forEach(b => {
            b.setAttribute('aria-label', b.dataset.n + (b.dataset.n === '1' ? ' star' : ' stars'));
            b.setAttribute('aria-pressed', String(b.classList.contains('on')));
        });
    }

    /* ---------- DOM enhancer (runs after every render) ---------- */
    function enhance() {
        // decorative icons
        $$('svg:not([aria-hidden]):not([role]):not([aria-label])').forEach(s => { s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); });

        // hidden file inputs are unreachable by keyboard: make their labels act as buttons
        $$('label.dropzone, label.chx-attach').forEach(l => {
            if (l.dataset.a11y) return;
            l.dataset.a11y = '1';
            l.tabIndex = 0;
            l.setAttribute('role', 'button');
            if (l.classList.contains('chx-attach')) l.setAttribute('aria-label', 'Attach files');
            l.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const i = document.getElementById(l.htmlFor); if (i) i.click(); }
            });
        });
        $$('.chx-attach-count').forEach(c => c.setAttribute('aria-hidden', 'true'));

        // required fields
        $$('.field').forEach(f => {
            if (!$('label .req', f)) return;
            const i = $('input,select,textarea', f);
            if (i) i.setAttribute('aria-required', 'true');
        });

        // sidebar: current page + unread badge text
        $$('#visitorNavList .nav-item').forEach(b => {
            if (b.classList.contains('active')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        $$('.nav-badge').forEach(b => { if (!b.dataset.a11y) { b.dataset.a11y = '1'; b.insertAdjacentHTML('beforeend', '<span class="sr-only"> unread</span>'); } });

        // visitor-type radio group: roving tabindex + arrow keys
        const g = $('#vtChooser');
        if (g) {
            const sync = () => $$('.seg-btn', g).forEach(b => { b.tabIndex = b.classList.contains('active') ? 0 : -1; });
            if (!g.dataset.a11y) {
                g.dataset.a11y = '1';
                g.addEventListener('click', () => setTimeout(sync));
                g.addEventListener('keydown', e => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                    e.preventDefault();
                    const b = $$('.seg-btn', g), d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
                    const n = b[(b.indexOf(document.activeElement) + d + b.length) % b.length];
                    n.focus(); n.click();
                });
            }
            sync();
        }

        // visit journey: spell out state, not just colour
        $$('.vjt-v-step').forEach(s => {
            const l = $('.vjt-v-lbl', s);
            if (!l || l.dataset.a11y) return;
            l.dataset.a11y = '1';
            const state = s.classList.contains('current') ? 'current step' : (s.classList.contains('done') ? 'done' : 'not yet');
            l.insertAdjacentHTML('beforeend', '<span class="sr-only"> (' + state + ')</span>');
        });
        const vj = $('.vjt-v');
        if (vj && !vj.getAttribute('role')) { vj.setAttribute('role', 'list'); $$('.vjt-v-step', vj).forEach(s => s.setAttribute('role', 'listitem')); }
        $$('.vj-card').forEach(c => c.setAttribute('role', 'region') || c.setAttribute('aria-label', 'Your visit journey'));
        $$('.qt-nowserving').forEach(c => { c.setAttribute('role', 'region'); c.setAttribute('aria-label', 'Now serving'); });

        // rating group + comment
        const stars = $('#fbStars');
        if (stars) { stars.setAttribute('role', 'group'); stars.setAttribute('aria-label', 'Rate your visit'); syncStars(); }
        const fc = $('#fbComment');
        if (fc) fc.setAttribute('aria-label', 'Optional comment');

        // chat transcripts are live logs
        $$('.chx-msgs').forEach(m => { m.setAttribute('role', 'log'); m.setAttribute('aria-live', 'polite'); m.setAttribute('aria-label', 'Conversation'); });

        // ticket stamp / decorative pieces
        $$('.ticket-v2-stub, .ticket-v2-stamp').forEach(el => el.setAttribute('aria-hidden', 'true'));

        // labelled unlabelled search / lookup inputs
        const cv = $('#cvInput'); if (cv && !cv.getAttribute('aria-label')) cv.setAttribute('aria-label', cv.placeholder);
        const cr = $('#chResume'); if (cr && !cr.getAttribute('aria-label')) cr.setAttribute('aria-label', 'Conversation code');
        const ct = $('#cfText'); if (ct && !ct.getAttribute('aria-label')) ct.setAttribute('aria-label', ct.placeholder || 'Your answer');
        const cp = $('#chReply'); if (cp && !cp.getAttribute('aria-label')) cp.setAttribute('aria-label', 'Type a message');
        const ss = $('#svcSearch'); if (ss) ss.setAttribute('aria-controls', 'svcList');
    }
    let raf = 0;
    new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(enhance); })
        .observe(document.body, { childList: true, subtree: true });
    enhance();

    /* ---------- SPA navigation: title, focus, announcements ---------- */
    function focusContent() {
        const t = $('#visitorPageTitle');
        content.setAttribute('aria-label', t ? t.textContent : 'Content');
        content.focus({ preventScroll: true });
        const cur = $('.stepper-i.current .stepper-l');
        const n = $$('.stepper-i').length;
        if (cur) announce('Step ' + ($$('.stepper-i').indexOf($('.stepper-i.current')) + 1) + ' of ' + n + ': ' + cur.textContent);
    }
    const _nav = window.navigateVisitor;
    window.navigateVisitor = function (key) {
        _nav(key);
        const t = $('#visitorPageTitle');
        if (t) document.title = t.textContent + ' — UniServe';
        focusContent();
    };
    const _rvs = window.renderVisitScreen;
    window.renderVisitScreen = function () { _rvs(); focusContent(); };

    /* service search: announce result count */
    const _filter = window.filterServices;
    let ft = 0;
    window.filterServices = function (v) {
        _filter(v);
        clearTimeout(ft);
        ft = setTimeout(() => {
            const n = $$('#svcList .svc-item:not([hidden])').length;
            announce(n === 0 ? 'No services match your search.' : n + (n === 1 ? ' service' : ' services') + ' shown.');
        }, 400);
    };

    /* chat flow: read each new OSS prompt, move focus to the first control */
    const _adv = window.advanceChatFlow;
    window.advanceChatFlow = function () {
        _adv();
        setTimeout(() => {
            const b = chatFlow && chatFlow.bubbles[chatFlow.bubbles.length - 1];
            if (b && b.sender === 'staff') announce('OSS UniServe: ' + b.text);
            const c = $('#visitorContent .cf-choice-btn');
            if (c) c.focus();
        }, 80);
    };

    /* ---------- queue ticket polling ----------
       The original re-rendered the whole ticket every 3 s, which drops keyboard
       focus and makes screen readers re-read the page. Now it only re-renders
       when something visible actually changed, and announces the change. */
    let lastSig = '', lastStatus = null, lastAhead = null;
    function ticketState() {
        const db = loadDB();
        const q = db.queues.find(x => x.id === myActiveQueueId);
        if (!q) return null;
        const ahead = q.status === 'Waiting' ? peopleAheadOf(db, q.id) : 0;
        const serving = servingQueueEntries(db).map(e => e.number).join(',');
        return { q, ahead, sig: [q.status, ahead, serving, !!q.feedback, !!q.possibleDuplicate].join('|') };
    }
    window.startTicketPolling = function () {
        stopTicketPolling();
        const s0 = ticketState();
        if (s0) { lastSig = s0.sig; lastStatus = s0.q.status; lastAhead = s0.ahead; }
        ticketPollTimer = setInterval(() => {
            if (!((visitorView === 'visit' || visitorView === 'checkvisit') && myActiveQueueId)) return;
            const s = ticketState();
            if (!s || s.sig === lastSig) return;
            const msgs = { Called: 'Your number ' + s.q.number + ' has been called. Please proceed to the counter.', Serving: 'Your service has started.', Completed: 'Your visit is complete. You can rate your experience.', Skipped: 'Your number was skipped. Please see the front desk.', Cancelled: 'Your queue number was cancelled.' };
            if (s.q.status !== lastStatus && msgs[s.q.status]) announce(msgs[s.q.status]);
            else if (s.q.status === 'Waiting' && s.ahead !== lastAhead) announce(s.ahead === 0 ? 'You are next.' : s.ahead + (s.ahead === 1 ? ' person' : ' people') + ' ahead of you.');
            // keep keyboard position across the re-render
            const items = () => $$(FOCUSABLE, content);
            const idx = content.contains(document.activeElement) ? items().indexOf(document.activeElement) : -1;
            renderQueueTicket();
            if (idx >= 0) { const el = items()[idx]; if (el) el.focus(); }
        }, 3000);
    };

    /* ---------- theme buttons ---------- */
    const _setTheme = window.setTheme;
    window.setTheme = function (t) {
        _setTheme(t);
        $$('[data-theme-btn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
    };
    window.setTheme(document.documentElement.getAttribute('data-theme') || 'light');

    /* ---------- user preferences ---------- */
    const PREF_KEY = 'ossuniserve_a11y_v2';
    const DEFAULTS = { text: 'medium', contrast: 'normal', font: 'standard', tts: false, motion: false, captions: false, colorAssist: false, zoom: 100 };
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { /* ignore */ }
    const prefs = Object.assign({}, DEFAULTS, stored || {
        motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        contrast: matchMedia('(prefers-contrast: more)').matches ? 'high' : 'normal',
    });
    const synth = window.speechSynthesis;

    /* captions: on-screen text for everything announced or spoken */
    const capEl = document.createElement('div');
    capEl.className = 'a11y-caption';
    capEl.setAttribute('aria-hidden', 'true');
    capEl.hidden = true;
    document.body.appendChild(capEl);
    let capTimer = 0;
    function showCaption(t) {
        capEl.textContent = t;
        capEl.hidden = false;
        clearTimeout(capTimer);
        capTimer = setTimeout(() => { capEl.hidden = true; }, Math.max(4000, t.length * 70));
    }
    function speak(t, opts) {
        if (!synth || !t) return;
        const u = new SpeechSynthesisUtterance(t);
        u.lang = document.documentElement.lang || 'en';
        u.rate = 0.95;
        if (opts && opts.caption && prefs.captions) u.onstart = () => showCaption(t);
        synth.speak(u);
    }
    function outputText(t) {
        if (prefs.captions) showCaption(t);
        if (prefs.tts && synth) { synth.cancel(); speak(t); }
    }
    window.a11yAnnounce = announce = function (msg) {
        live.textContent = '';
        setTimeout(() => { live.textContent = msg; }, 60);
        outputText(msg);
    };

    /* text-to-speech: read the page, read focused controls, read selected text */
    function readPage() {
        if (!synth) { announce('Text-to-speech is not supported in this browser.'); return; }
        if (synth.speaking) { synth.cancel(); syncReadBtn(); return; }
        const text = (content.innerText || '').replace(/\s*\n\s*/g, '. ');
        const chunks = text.match(/[^.!?]+[.!?]*/g) || [];
        synth.cancel();
        let buf = '';
        chunks.forEach(c => { buf += c + ' '; if (buf.length > 160) { speak(buf.trim(), { caption: true }); buf = ''; } });
        if (buf.trim()) speak(buf.trim(), { caption: true });
        setTimeout(syncReadBtn, 200);
    }
    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'btn btn-primary btn-sm a11y-read-btn';
    readBtn.hidden = true;
    readBtn.addEventListener('click', readPage);
    document.body.appendChild(readBtn);
    function syncReadBtn() {
        readBtn.hidden = !prefs.tts;
        readBtn.textContent = synth && synth.speaking ? 'Stop reading' : 'Read page aloud';
    }
    if (synth) synth.addEventListener && synth.addEventListener('voiceschanged', syncReadBtn);
    function accName(el) {
        let n = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || el.textContent || el.value || el.placeholder || '';
        n = n.replace(/\s+/g, ' ').trim().slice(0, 200);
        const role = el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : el.tagName === 'SELECT' ? 'dropdown' : el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? (el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'option' : 'text field') : '';
        return n ? n + (role ? ', ' + role : '') : '';
    }
    document.addEventListener('focusin', e => {
        if (!prefs.tts || !synth) return;
        const t = e.target;
        if (t === content || t.classList.contains('modal') || t === document.body) return;
        const n = accName(t);
        if (n) { synth.cancel(); speak(n); if (prefs.captions) showCaption(n); }
    });
    document.addEventListener('mouseup', () => {
        if (!prefs.tts || !synth) return;
        const s = String(window.getSelection() || '').trim();
        if (s.length > 1) { synth.cancel(); speak(s, { caption: true }); }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && synth && synth.speaking) { synth.cancel(); syncReadBtn(); }
    });

    /* keyboard shortcuts (Alt+Shift+…) */
    document.addEventListener('keydown', e => {
        if (!(e.altKey && e.shiftKey) || $('#activeModal')) return;
        const map = { KeyA: () => openA11yPanel(), KeyV: () => navigateVisitor('visit'), KeyC: () => navigateVisitor('checkvisit'), KeyH: () => navigateVisitor('chat'), KeyR: () => prefs.tts && readPage() };
        if (map[e.code]) { e.preventDefault(); map[e.code](); }
    });

    /* apply preferences to the page */
    function loadA11yFont() {
        if (document.getElementById('a11yFontLink')) return;
        const l = document.createElement('link');
        l.id = 'a11yFontLink';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap';
        document.head.appendChild(l);
    }
    function applyPrefs() {
        const r = document.documentElement;
        r.setAttribute('data-text', prefs.text);
        prefs.contrast === 'high' ? r.setAttribute('data-contrast', 'high') : r.removeAttribute('data-contrast');
        if (prefs.font === 'accessible') { loadA11yFont(); r.setAttribute('data-font', 'accessible'); } else r.removeAttribute('data-font');
        prefs.motion ? r.setAttribute('data-motion', 'reduce') : r.removeAttribute('data-motion');
        prefs.colorAssist ? r.setAttribute('data-color-assist', 'on') : r.removeAttribute('data-color-assist');
        r.style.zoom = prefs.zoom === 100 ? '' : String(prefs.zoom / 100);
        if (!prefs.tts && synth) synth.cancel();
        if (!prefs.captions) { capEl.hidden = true; }
        syncReadBtn();
        localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    }
    applyPrefs();

    /* settings panel */
    const seg = (name, label, opts) => `
    <fieldset class="a11y-row a11y-fs"><legend>${label}</legend>
      <div class="a11y-seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('')}</div>
    </fieldset>`;
    const sw = (id, label, desc) => `
    <div class="a11y-row a11y-flex">
      <div class="a11y-txt"><span id="${id}L" class="a11y-t">${label}</span><small id="${id}D">${desc}</small></div>
      <label class="a11y-switch"><input type="checkbox" role="switch" id="${id}" aria-labelledby="${id}L" aria-describedby="${id}D"><span class="a11y-track" aria-hidden="true"></span><span class="a11y-state" aria-hidden="true">Off</span></label>
    </div>`;
    const info = (label, badge, desc) => `
    <div class="a11y-row a11y-flex">
      <div class="a11y-txt"><span class="a11y-t">${label}</span><small>${desc}</small></div>
      <span class="a11y-badge">&#10003; ${badge}</span>
    </div>`;

    function syncControls() {
        const m = $('#activeModal');
        if (!m) return;
        const radio = (n, v) => { const el = $(`input[name="${n}"][value="${v}"]`, m); if (el) el.checked = true; };
        radio('a11yText', prefs.text);
        radio('a11yContrast', prefs.contrast);
        radio('a11yTheme', document.documentElement.getAttribute('data-theme') || 'light');
        radio('a11yFont', prefs.font);
        [['a11yTts', 'tts'], ['a11yMotion', 'motion'], ['a11yCaps', 'captions'], ['a11yColor', 'colorAssist']].forEach(([id, k]) => {
            const el = $('#' + id, m);
            if (el) { el.checked = !!prefs[k]; el.parentNode.querySelector('.a11y-state').textContent = prefs[k] ? 'On' : 'Off'; }
        });
        const z = $('#a11yZoom', m);
        if (z) { z.value = prefs.zoom; $('#a11yZoomOut', m).textContent = prefs.zoom + '%'; }
    }

    window.openA11yPanel = function () {
        const body = `
      ${seg('a11yText', 'Text size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
      ${seg('a11yContrast', 'Contrast', [['normal', 'Normal'], ['high', 'High contrast']])}
      ${seg('a11yTheme', 'Theme', [['light', 'Light'], ['dark', 'Dark']])}
      ${seg('a11yFont', 'Font', [['standard', 'Standard'], ['accessible', 'Accessibility font']])}
      <div class="a11y-row a11y-fs">
        <div class="a11y-zoomhead"><label for="a11yZoom" class="a11y-t">Zoom</label><output id="a11yZoomOut" for="a11yZoom"></output></div>
        <input type="range" id="a11yZoom" min="100" max="200" step="10" aria-describedby="a11yZoomD">
        <small id="a11yZoomD">Enlarges the whole page, including images and spacing. Your browser&rsquo;s own zoom (Ctrl/Cmd + or &minus;) also works.</small>
      </div>
      ${sw('a11yTts', 'Text-to-speech', 'Reads controls as you focus them, selected text, and announcements aloud. Adds a &ldquo;Read page aloud&rdquo; button.')}
      ${sw('a11yMotion', 'Reduced motion', 'Turns off animations, pulsing and smooth scrolling.')}
      ${sw('a11yCaps', 'Captions', 'Shows a text caption for every announcement and anything read aloud.')}
      ${sw('a11yColor', 'Color assistance', 'Color-blind-safe status colors, plus a symbol on every status label so color is never the only cue.')}
      ${info('Screen reader', 'Supported', 'Landmarks, labels, form errors and live queue updates work with NVDA, JAWS, VoiceOver and TalkBack.')}
      ${info('Keyboard navigation', 'Enabled', 'Everything works with Tab, Enter, Space and arrow keys. Shortcuts: <kbd>Alt+Shift+A</kbd> settings, <kbd>V</kbd> visit, <kbd>C</kbd> check visit, <kbd>H</kbd> chat, <kbd>R</kbd> read page, <kbd>Esc</kbd> stop reading.')}`;
        openModal('Accessibility settings', body, [
            { label: 'Reset to default', cls: 'btn-ghost', action: () => { Object.assign(prefs, DEFAULTS); applyPrefs(); setTheme('light'); syncControls(); announce('Accessibility settings reset to default.'); } },
            { label: 'Done', cls: 'btn-primary', action: closeModal },
        ]);
        const m = $('#activeModal');
        syncControls();
        m.addEventListener('change', e => {
            const t = e.target, n = t.name || t.id;
            if (n === 'a11yText') prefs.text = t.value;
            else if (n === 'a11yContrast') prefs.contrast = t.value;
            else if (n === 'a11yTheme') setTheme(t.value);
            else if (n === 'a11yFont') prefs.font = t.value;
            else if (n === 'a11yTts') prefs.tts = t.checked;
            else if (n === 'a11yMotion') prefs.motion = t.checked;
            else if (n === 'a11yCaps') prefs.captions = t.checked;
            else if (n === 'a11yColor') prefs.colorAssist = t.checked;
            applyPrefs();
            syncControls();
        });
        $('#a11yZoom', m).addEventListener('input', e => { prefs.zoom = Number(e.target.value); applyPrefs(); $('#a11yZoomOut', m).textContent = prefs.zoom + '%'; });
    };

    const a11yBtn = $('#a11yBtn');
    if (a11yBtn) a11yBtn.addEventListener('click', openA11yPanel);
})();