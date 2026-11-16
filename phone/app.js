'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), tabs = $('tabs'), dot = $('dot'), pname = $('pname'), back = $('back');
  const pinEl = $('pin'), cfEl = $('confirm');
  const ov = $('overlay'), ovTitle = $('ov-title'), ovText = $('ov-text'), ovBtn = $('ov-btn'), toast = $('toast');

  // --- token : reçu via ?t=... (QR code), puis gardé en local ---
  const q = new URLSearchParams(location.search);
  if (q.get('t')) { try { localStorage.setItem('dl_token', q.get('t')); } catch (e) {} history.replaceState(null, '', location.pathname); }
  let token = ''; try { token = localStorage.getItem('dl_token') || ''; } catch (e) {}

  let ws = null, cfg = null, pageId = null, stack = [], retry = 0, timer = null, denied = false;
  let states = {}, stats = { cpu: 0, ram: 0 }, sys = { vol: null, mute: 0, mic: 0 }, volDragUntil = 0;

  // --- langue : français (défaut) ou anglais ; les textes sont cherchés par leur version française ---
  const EN = {
    'Connexion…': 'Connecting…', 'Recherche du PC sur le réseau local.': 'Looking for the PC on your network.', 'Réessayer': 'Retry',
    'Appairage requis': 'Pairing required', 'Scanne le QR code affiché dans DeckLan sur ton PC (onglet Connexion).': 'Scan the QR code shown in DeckLan on your PC (Connection tab).',
    'Accès refusé': 'Access denied', 'Le code a changé. Rescanne le QR code affiché sur le PC.': 'The code changed. Scan the QR code on the PC again.',
    'Code régénéré': 'Code regenerated', 'Rescanne le QR code affiché sur le PC.': 'Scan the QR code on the PC again.',
    'Connexion perdue…': 'Connection lost…', 'Hors ligne': 'Offline', 'Erreur': 'Error', 'Plein écran indisponible': 'Fullscreen unavailable',
    'Code PIN': 'PIN code', 'Code incorrect': 'Wrong code', 'Confirmer ?': 'Confirm?', 'Lancer cette action sur le PC ?': 'Run this action on the PC?',
    'Annuler': 'Cancel', 'Confirmer': 'Confirm', 'Touche l’écran pour réveiller': 'Touch the screen to wake', 'Minuteur terminé': 'Timer finished',
    'Chrono': 'Stopwatch', 'Rien en lecture': 'Nothing playing', 'Retour': 'Back', 'Plein écran': 'Fullscreen',
  };
  const LOC = () => (cfg && cfg.ui && cfg.ui.lang === 'en' ? 'en-GB' : 'fr-FR');
  const T = (s) => (cfg && cfg.ui && cfg.ui.lang === 'en' && EN[s]) || s;
  function applyLang() {
    for (const el of document.querySelectorAll('[data-t]')) { if (!el.dataset.fr) el.dataset.fr = el.dataset.t; el.textContent = T(el.dataset.fr); }
    document.documentElement.lang = cfg && cfg.ui && cfg.ui.lang === 'en' ? 'en' : 'fr';
  }

  const page = () => cfg && (cfg.pages.find((p) => p.id === pageId) || cfg.pages.find((p) => !p.hidden) || cfg.pages[0]);

  function showOverlay(title, text, btn) {
    ovTitle.textContent = T(title); ovText.textContent = T(text); ovBtn.hidden = !btn; ov.hidden = false;
  }
  function setState(s) { dot.className = 'dot ' + (s === 'on' ? '' : s === 'wait' ? 'wait' : 'off'); }

  function connect() {
    clearTimeout(timer);
    if (!token) { denied = true; setState('off'); showOverlay('Appairage requis', 'Scanne le QR code affiché dans DeckLan sur ton PC (onglet Connexion).', false); return; }
    setState('wait'); denied = false;
    if (!cfg) showOverlay('Connexion…', 'Recherche du PC sur le réseau local.', false);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`); }
    catch (e) { return schedule(); }
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'config') { pinEl.hidden = true; states = m.states || {}; if (m.sys) sys = m.sys; onConfig(m.config); setState('on'); ov.hidden = true; }
      else if (m.t === 'locked') { cfg = null; grid.replaceChildren(); ov.hidden = true; setState('on'); showPin(''); }
      else if (m.t === 'unlock') { pinResult(m); }
      else if (m.t === 'state') { states[m.id] = m.s; if (cfg) render(); }
      else if (m.t === 'stats') { stats = m; updateWidgets(); }
      else if (m.t === 'sys') { sys = m; updateVolumes(); }
      else if (m.t === 'goto') { if (cfg && cfg.pages.some((x) => x.id === m.page) && m.page !== pageId) { pageId = m.page; stack = []; render(); } }
      else if (m.t === 'denied') { denied = true; try { localStorage.removeItem('dl_token'); } catch (e) {} token = ''; cfg = null; showOverlay('Accès refusé', 'Le code a changé. Rescanne le QR code affiché sur le PC.', false); }
      else if (m.t === 'ack') ack(m);
    };
    ws.onclose = (ev) => {
      setState('off');
      if (ev.code === 4001) { denied = true; try { localStorage.removeItem('dl_token'); } catch (e) {} token = ''; cfg = null; showOverlay('Code régénéré', 'Rescanne le QR code affiché sur le PC.', false); return; }
      if (!denied) { if (cfg) showToast(T('Connexion perdue…')); schedule(); }
    };
    ws.onerror = () => {};
  }
  function schedule() { clearTimeout(timer); retry = Math.min(retry + 1, 6); timer = setTimeout(connect, Math.min(4000, 400 * retry)); }
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (!ws || ws.readyState > 1) && !denied) connect(); });

  function onConfig(c) {
    cfg = c;
    document.documentElement.style.setProperty('--accent', (c.ui && c.ui.accent) || '#7c5cff');
    pname.textContent = c.pcName || 'DeckLan';
    applyLang();
    if (!pageId || !c.pages.find((p) => p.id === pageId)) { pageId = (c.pages.find((p) => !p.hidden) || c.pages[0]).id; stack = []; }
    render();
  }

  // Cases quasi carrées (ratio max 1.3), centrées : proche d'un vrai Stream Deck.
  function layout() {
    const p = page(); if (!p) return;
    const gap = 10, w = grid.clientWidth - 24, hh = grid.clientHeight - 18;
    const cw = Math.floor((w - gap * (p.cols - 1)) / p.cols);
    let ch = Math.floor((hh - gap * (p.rows - 1)) / p.rows);
    ch = Math.min(ch, Math.floor(cw * 1.3)); const cw2 = cw;
    grid.style.gridTemplateColumns = `repeat(${p.cols}, ${Math.max(40, cw2)}px)`;
    grid.style.gridTemplateRows = `repeat(${p.rows}, ${Math.max(40, ch)}px)`;
  }
  window.addEventListener('resize', layout);

  function render() {
    const p = page(); if (!p) return;
    grid.replaceChildren();
    for (const b of p.buttons) {
      const alt = b.alt && states[b.id] ? b.alt : null;
      const face = alt || b;
      const el = document.createElement('button');
      const isFolder = b.action && b.action.type === 'page' && b.action.pageId !== '__back' && b.action.pageId !== '__home';
      el.className = 'key' + (isFolder ? ' folder' : '') + (b.widget ? ' widget' : '');
      el.style.gridColumn = (b.col + 1) + ' / span ' + (b.w || 1); el.style.gridRow = String(b.row + 1);
      el.style.background = `linear-gradient(160deg, ${face.bg}, ${shade(face.bg, -22)})`; el.style.color = face.fg;
      el.dataset.id = b.id;
      if (b.widget === 'volume' || b.widget === 'brightness') {
        buildVolume(el, p, b, b.widget === 'brightness' ? 'bri' : 'vol');
        grid.appendChild(el); continue;
      }
      if (b.widget === 'stopwatch' || b.widget === 'timer') {
        const w = document.createElement('span'); w.className = 'wv sw'; el.appendChild(w);
        const l = document.createElement('span'); l.className = 'lb'; l.textContent = face.label || (b.widget === 'timer' ? (cfg.ui.lang === 'en' ? 'Timer ' : 'Minuteur ') + b.timerMin + ' min' : T('Chrono')); el.appendChild(l);
        bindTimer(el, b);
        grid.appendChild(el); continue;
      }
      if (b.widget) {
        const w = document.createElement('span'); w.className = 'wv' + (b.widget === 'nowplaying' ? ' np' : ''); w.dataset.w = b.widget; el.appendChild(w);
        if (b.widget === 'nowplaying') { const l = document.createElement('span'); l.className = 'lb sub'; l.dataset.np = '1'; el.appendChild(l); bindKey(el, p, b); }
        else if (face.label) { const l = document.createElement('span'); l.className = 'lb'; l.textContent = face.label; el.appendChild(l); }
      } else {
        if (face.image) { const im = document.createElement('img'); im.className = 'im'; im.src = face.image; im.draggable = false; el.appendChild(im); }
        else if (face.icon) { const i = document.createElement('span'); i.className = 'ic'; setIcon(i, face.icon); el.appendChild(i); }
        if (face.label) { const l = document.createElement('span'); l.className = 'lb'; l.textContent = face.label; el.appendChild(l); }
      }
      bindKey(el, p, b);
      grid.appendChild(el);
    }
    layout();
    updateWidgets();
    drawTimers();
    const tabPages = cfg.pages.filter((x) => !x.hidden);
    tabs.hidden = tabPages.length < 2;
    tabs.replaceChildren(...tabPages.map((x) => {
      const t = document.createElement('button'); t.textContent = x.name; if (x.id === p.id) t.className = 'on';
      t.onclick = () => { pageId = x.id; stack = []; vib(8); render(); }; return t;
    }));
    back.hidden = !stack.length;
    back.style.visibility = stack.length ? 'visible' : 'hidden';
  }

  function setIcon(el, icon) {
    if (icon.indexOf('lucide:') === 0 && window.dlIconSvg) { el.innerHTML = window.dlIconSvg(icon.slice(7)); el.classList.add('svg'); }
    else el.textContent = icon;
  }

  // --- curseur de volume (widget) : glisser = règle le volume du PC, valeur réelle remontée par le PC ---
  function buildVolume(el, p, b, kind = 'vol') {
    el.classList.add('widget', 'vol');
    const ic = document.createElement('span'); ic.className = 'ic vi';
    const track = document.createElement('div'); track.className = 'vt';
    const fill = document.createElement('div'); fill.className = 'vf'; track.appendChild(fill);
    const pct = document.createElement('span'); pct.className = 'vp';
    el.append(ic, track, pct);
    if (b.label) { const l = document.createElement('span'); l.className = 'lb'; l.textContent = b.label; el.appendChild(l); }
    let drag = false, last = 0, timer = null;
    const setPct = (v) => {
      v = Math.max(0, Math.min(100, Math.round(v)));
      fill.style.width = v + '%'; pct.textContent = v + '%';
      setIcon(ic, kind === 'bri' ? 'lucide:sun' : 'lucide:' + (sys.mute || v === 0 ? 'volume-x' : v < 40 ? 'volume-1' : 'volume-2'));
      return v;
    };
    const send = (v, force) => {
      const now = Date.now();
      if (!force && now - last < 50) { clearTimeout(timer); timer = setTimeout(() => send(v, true), 55); return; }
      last = now;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: kind, page: p.id, id: b.id, v }));
    };
    const at = (e) => { const r = track.getBoundingClientRect(); return setPct(((e.clientX - r.left) / r.width) * 100); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = true; volDragUntil = Date.now() + 1e9; try { el.setPointerCapture(e.pointerId); } catch (x) {} vib(8); send(at(e)); });
    el.addEventListener('pointermove', (e) => { if (drag) send(at(e)); });
    const end = () => { if (drag) { drag = false; volDragUntil = Date.now() + 700; } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.dataset.vol = kind;
    el._set = (v) => setPct(v);
    setPct(kind === 'bri' ? (sys.bri == null ? 50 : sys.bri) : (sys.vol == null ? 50 : sys.vol));
  }
  function updateVolumes() {
    if (Date.now() < volDragUntil) return;
    for (const el of grid.querySelectorAll('[data-vol]')) { const v = el.dataset.vol === 'bri' ? sys.bri : sys.vol; if (v != null) el._set(v); }
    updateWidgets();
  }

  const HOLD_MS = 450;
  function bindKey(el, p, b) {
    const hasHold = b.hold && b.hold.type && b.hold.type !== 'none' && !b.repeat;
    const isNav = b.action && b.action.type === 'page';
    let t = null, fired = false, active = false, rep = null;
    const clear = () => { clearTimeout(t); t = null; clearInterval(rep); rep = null; el.classList.remove('down'); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); active = true; fired = false; el.classList.add('down'); vib(14);
      if (b.repeat && !isNav) { // répétition tant que le doigt reste appuyé
        run(p, b, el, false);
        t = setTimeout(() => { rep = setInterval(() => { vib(6); run(p, b, el, false, true); }, 100); }, 380);
        return;
      }
      if (!hasHold) { run(p, b, el, false); return; }
      t = setTimeout(() => { fired = true; vib([20, 30, 20]); run(p, b, el, true); }, HOLD_MS);
    });
    el.addEventListener('pointerup', () => { if (active && hasHold && !fired) run(p, b, el, false); active = false; clear(); });
    el.addEventListener('pointerleave', () => { active = false; clear(); });
    el.addEventListener('pointercancel', () => { active = false; clear(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function run(p, b, el, hold, quiet) {
    const a = (hold ? b.hold : (b.alt && states[b.id] ? b.alt.action : b.action)) || { type: 'none' };
    if (a.type === 'page') {
      if (a.pageId === '__back') return goBack();
      if (a.pageId === '__home') { pageId = (cfg.pages.find((x) => !x.hidden) || cfg.pages[0]).id; stack = []; return render(); }
      if (cfg.pages.some((x) => x.id === a.pageId)) { stack.push(p.id); pageId = a.pageId; render(); }
      return;
    }
    if (a.type === 'none' && !(b.alt && !hold)) return;
    if (!ws || ws.readyState !== 1) { showToast(T('Hors ligne')); flash(b.id, 'err'); return; }
    if (b.confirm && !quiet) { askConfirm(b, () => send(p, b, hold, true)); return; }
    send(p, b, hold, false);
  }
  function send(p, b, hold, confirmed) {
    beep();
    ws.send(JSON.stringify({ t: 'press', page: p.id, id: b.id, hold: !!hold, confirmed }));
  }

  // --- confirmation avant les actions risquées (arrêt, redémarrage…) ---
  function askConfirm(b, yes) {
    $('cf-title').textContent = b.label || T('Confirmer ?');
    $('cf-text').textContent = T('Lancer cette action sur le PC ?');
    cfEl.hidden = false;
    $('cf-no').onclick = () => { cfEl.hidden = true; };
    $('cf-yes').onclick = () => { cfEl.hidden = true; yes(); };
  }

  // --- code PIN : vérifié par le PC, jamais stocké sur le téléphone ---
  let pinBuf = '';
  const pad = $('pin-pad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']) {
    const b = document.createElement('button'); b.textContent = k;
    b.onclick = () => { vib(8); if (k === '⌫') pinBuf = pinBuf.slice(0, -1); else if (k === 'OK') return submitPin(); else if (pinBuf.length < 8) pinBuf += k; drawDots(); };
    pad.appendChild(b);
  }
  function drawDots() {
    const d = $('pin-dots'); d.replaceChildren();
    for (let i = 0; i < Math.max(4, pinBuf.length); i++) { const e = document.createElement('i'); if (i < pinBuf.length) e.className = 'on'; d.appendChild(e); }
  }
  function showPin(msg) { pinBuf = ''; drawDots(); $('pin-msg').textContent = msg || ''; pinEl.hidden = false; }
  function submitPin() {
    if (pinBuf.length < 4 || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'unlock', pin: pinBuf }));
  }
  function pinResult(m) {
    if (m.ok) return; // la config suit
    pinBuf = ''; drawDots(); vib([30, 40, 30]);
    $('pin-msg').textContent = m.wait ? (cfg && cfg.ui && cfg.ui.lang === 'en' ? `Too many tries. Wait ${m.wait} s.` : `Trop d'essais. Attends ${m.wait} s.`) : T('Code incorrect');
    pinEl.classList.remove('shake'); void pinEl.offsetWidth; pinEl.classList.add('shake');
  }

  // --- clic sonore optionnel ---
  let actx = null;
  function beep() {
    if (!cfg || !cfg.ui || !cfg.ui.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.03);
    } catch (e) {}
  }

  // --- chronomètre / minuteur : locaux au téléphone, rien n'est envoyé au PC ---
  const timers = {}; let timerTick = null;
  function timerMs(b) {
    const t = timers[b.id] || (timers[b.id] = { run: false, at: 0, acc: 0, done: false });
    const el = t.acc + (t.run ? Date.now() - t.at : 0);
    return b.widget === 'timer' ? Math.max(0, b.timerMin * 60000 - el) : el;
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p2 = (n) => String(n).padStart(2, '0'); return (h ? h + ':' : '') + p2(m) + ':' + p2(x); };
  function drawTimers() {
    let any = false;
    for (const el of grid.querySelectorAll('[data-timer]')) {
      const b = page().buttons.find((x) => x.id === el.dataset.id); if (!b) continue;
      const ms = timerMs(b); const t = timers[b.id];
      el.querySelector('.wv').textContent = fmt(ms);
      if (t.run) any = true;
      if (t.run && b.widget === 'timer' && ms <= 0) { t.run = false; t.done = true; t.acc = 0; vib([200, 100, 200, 100, 400]); beep(); el.classList.add('timer-done'); showToast(T('Minuteur terminé')); }
    }
    if (!any && timerTick) { clearInterval(timerTick); timerTick = null; }
    if (any && !timerTick) timerTick = setInterval(drawTimers, 250);
  }
  function bindTimer(el, b) {
    el.dataset.timer = '1';
    let t = null, long = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); long = false; el.classList.add('down'); vib(10);
      t = setTimeout(() => { long = true; vib([20, 30, 20]); timers[b.id] = { run: false, at: 0, acc: 0, done: false }; el.classList.remove('timer-done'); drawTimers(); }, 600);
    });
    el.addEventListener('pointerup', () => {
      clearTimeout(t); el.classList.remove('down'); if (long) return;
      const s = timers[b.id] || (timers[b.id] = { run: false, at: 0, acc: 0, done: false });
      if (s.run) { s.acc += Date.now() - s.at; s.run = false; } else { s.run = true; s.at = Date.now(); s.done = false; el.classList.remove('timer-done'); }
      drawTimers();
    });
    const off = () => { clearTimeout(t); el.classList.remove('down'); };
    el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // --- widgets : horloge/date locales, CPU/RAM poussés par le PC ---
  function updateWidgets() {
    const d = new Date();
    for (const w of grid.querySelectorAll('.wv')) {
      const k = w.dataset.w;
      if (k === 'clock') w.textContent = d.toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
      else if (k === 'date') w.textContent = d.toLocaleDateString(LOC(), { weekday: 'short', day: 'numeric', month: 'short' });
      else if (k === 'cpu') w.textContent = 'CPU ' + stats.cpu + '%';
      else if (k === 'ram') w.textContent = 'RAM ' + stats.ram + '%';
      else if (k === 'weather') w.textContent = sys.weather ? sys.weather.icon + ' ' + sys.weather.t + '°' : '…';
      else if (k === 'nowplaying') {
        const np = sys.np; w.textContent = np ? (np.playing ? '▶ ' : '⏸ ') + np.title : T('Rien en lecture');
        const l = w.parentElement.querySelector('[data-np]'); if (l) l.textContent = np ? np.artist : '';
      }
    }
  }
  setInterval(updateWidgets, 5000);

  function goBack() { if (stack.length) { pageId = stack.pop(); render(); } }
  back.onclick = goBack;

  function ack(m) {
    flash(m.id, m.ok ? 'ok' : 'err');
    if (!m.ok) { vib([30, 40, 30]); showToast(m.err || T('Erreur')); }
  }
  function flash(id, cls) {
    const el = grid.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!el) return;
    el.classList.remove('ok', 'err'); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 500);
  }

  function vib(p) { if (cfg && cfg.ui && !cfg.ui.vibrate) return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  let tt; function showToast(t) { toast.textContent = t; toast.hidden = false; clearTimeout(tt); tt = setTimeout(() => { toast.hidden = true; }, 2200); }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, v + amt));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }

  // --- plein écran + écran toujours allumé ---
  let wakeVideo = null;
  async function keepAwake() {
    try { if (navigator.wakeLock) { await navigator.wakeLock.request('screen'); return; } } catch (e) {}
    if (wakeVideo) return;
    try { // repli HTTP : une vidéo muette en boucle empêche la veille
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d'); g.fillRect(0, 0, 16, 16);
      const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none';
      v.srcObject = c.captureStream(2); document.body.appendChild(v); await v.play(); wakeVideo = v;
      setInterval(() => g.fillRect(0, 0, 16, 16), 1000);
    } catch (e) {}
  }
  if (!document.documentElement.requestFullscreen) $('fs').hidden = true; // iPhone : pas d'API plein écran, utiliser « Sur l'écran d'accueil »
  $('fs').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); }
    } catch (e) { showToast(T('Plein écran indisponible')); }
    keepAwake();
  };
  document.addEventListener('pointerdown', () => keepAwake(), { once: true });
  ovBtn.onclick = () => { retry = 0; connect(); };
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- veille : écran noir + horloge après inactivité (le toucher de réveil n'envoie rien au PC) ---
  const sleepEl = $('sleep');
  let lastTouch = Date.now(), asleep = false;
  const wake = () => { asleep = false; sleepEl.hidden = true; lastTouch = Date.now(); };
  const sleepNow = () => {
    asleep = true; sleepEl.hidden = false; tickSleep();
    if (cfg && cfg.ui && cfg.ui.pin && ws && ws.readyState === 1) ws.send('{"t":"lock"}'); // la veille reverrouille
  };
  const tickSleep = () => {
    const d = new Date();
    $('sclock').textContent = d.toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
    $('sdate').textContent = d.toLocaleDateString(LOC(), { weekday: 'long', day: 'numeric', month: 'long' });
  };
  document.addEventListener('pointerdown', (e) => {
    if (asleep) { e.preventDefault(); e.stopPropagation(); wake(); } else lastTouch = Date.now();
  }, true);
  setInterval(() => {
    const idle = cfg && cfg.ui ? +cfg.ui.idle : 2;
    if (asleep) return tickSleep();
    if (idle > 0 && ov.hidden && pinEl.hidden && Date.now() - lastTouch > idle * 60000) sleepNow();
  }, 1000);

  connect();
})();
