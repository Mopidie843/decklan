'use strict';
(async () => {
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- helpers DOM ----------
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const rid = (p) => p + Math.random().toString(16).slice(2, 10);
  const field = (label, ...ctrl) => h('div', { class: 'field' }, h('label', {}, label), ...ctrl);
  const toast = (text, kind = '') => {
    const t = h('div', { class: 'toast ' + kind }, text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 4200 : 1800);
  };
  const select = (opts, value, onchange) => {
    const s = h('select', { onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = value;
    return s;
  };
  const textInput = (value, oninput, ph = '') => h('input', { type: 'text', value: value || '', placeholder: ph, oninput: (e) => oninput(e.target.value), spellcheck: 'false' });

  // ---------- état ----------
  const st = await api.getState();
  let cfg = st.config;
  let status = st.status;
  let view = 'editor';
  let pi = 0;           // index de page courante
  let selId = null;     // id du bouton sélectionné
  let inspTab = 'button';
  let dragId = null;
  let emojiOpen = false;
  let pickTarget = null, iconTab = 'icons', iconQ = '';

  const page = () => cfg.pages[Math.min(pi, cfg.pages.length - 1)];
  const selBtn = () => page().buttons.find((b) => b.id === selId) || null;

  let saveT = null;
  // Historique : snapshots de cfg.pages ; les frappes rapprochées sont fusionnées en un seul pas.
  let hist = [JSON.stringify(cfg.pages)], hp = 0, lastPush = 0, clip = null;
  const flush = () => { clearTimeout(saveT); saveT = setTimeout(() => api.saveConfig(cfg), 220); };
  const save = () => {
    const j = JSON.stringify(cfg.pages);
    if (j !== hist[hp]) {
      const now = Date.now();
      if (now - lastPush < 700 && hp === hist.length - 1 && hp > 0) hist[hp] = j;
      else { hist = hist.slice(0, hp + 1); hist.push(j); hp = hist.length - 1; if (hist.length > 80) { hist.shift(); hp--; } }
      lastPush = now;
      if (view === 'editor') updateHistBtns();
    }
    flush();
  };
  function travel(d) {
    const n = hp + d; if (n < 0 || n >= hist.length) return;
    hp = n; cfg.pages = JSON.parse(hist[hp]); lastPush = 0;
    pi = Math.min(pi, cfg.pages.length - 1); if (!selBtn()) selId = null;
    flush(); renderEditor(); toast(d < 0 ? 'Annulé' : 'Rétabli');
  }
  const updateHistBtns = () => {
    const u = $('#undo'), r = $('#redo'); if (u) u.disabled = hp === 0; if (r) r.disabled = hp >= hist.length - 1;
    const c = $('#paste'); if (c) c.hidden = !clip;
  };
  function copySel() { const b = selBtn(); if (!b) return; clip = JSON.parse(JSON.stringify(b)); updateHistBtns(); toast('Bouton copié', 'ok'); }
  function pasteBtn() {
    if (!clip) return; const p = page(); const free = freeCells(p)[0];
    if (!free) return toast('La page est pleine', 'err');
    const c = JSON.parse(JSON.stringify(clip)); c.id = rid('b_'); c.row = free.r; c.col = free.c; p.buttons.push(c); selId = c.id;
    save(); renderGrid(); renderInspector();
  }
  const applyAccent = () => document.documentElement.style.setProperty('--accent', cfg.settings.accent);
  applyAccent();

  // ---------- données statiques ----------
  const EMOJI = ('⏯️ ⏮️ ⏭️ ⏹️ 🔇 🔈 🔉 🔊 🎵 🎶 🎧 🎤 🎙️ 🎬 🎮 🕹️ 📸 📷 🎥 📹 🖥️ 💻 ⌨️ 🖱️ 🖨️ 📱 🔒 🔓 🔑 🛡️ ⚙️ 🛠️ 🧰 🔧 📁 📂 🗂️ 📄 📝 📋 📥 📤 📎 ✂️ 🧮 📊 📈 📅 ⏰ ⏱️ 🌐 🔍 🏠 ⭐ ❤️ 🔥 ⚡ 💡 🔔 ✅ ❌ ⚠️ ➕ ➖ ✖️ ➡️ ⬅️ ⬆️ ⬇️ ↩️ ↪️ 🔄 ▶️ ⏸️ ⏺️ 🔴 🟢 🟡 🔵 😀 😎 🤖 👾 🚀 🌙 ☀️ 🌈 🍕 ☕ 🎯 🏆 💬 📧 📞 🔗 🧠 🎨 🖌️ 🪟 🗑️ 📌 🔦 🔋 📡 🛰️ 🎲 🧩 🪄').split(' ');
  const SWATCHES = ['#7c5cff', '#2563eb', '#0ea5a4', '#30c48d', '#f59e0b', '#e5484d', '#ec4899', '#8b5cf6', '#3b3b44', '#111218'];
  const MEDIA = [['playpause', 'Lecture / Pause'], ['next', 'Piste suivante'], ['prev', 'Piste précédente'], ['stop', 'Stop'], ['volup', 'Volume +'], ['voldown', 'Volume −'], ['mute', 'Muet']];
  const TYPES = [['none', 'Aucune action'], ['hotkey', 'Raccourci clavier'], ['text', 'Taper du texte'], ['open', 'Ouvrir appli / fichier / lien'], ['command', 'Commande Windows'], ['media', 'Média / volume'], ['audio', 'Micro / haut-parleurs (Windows)'], ['obs', 'OBS Studio'], ['wol', 'Réveiller un PC (Wake-on-LAN)'], ['http', 'Requête web (HTTP / domotique)'], ['power', 'Alimentation (verrouiller, veille, arrêt…)'], ['mouse', 'Souris (clic, déplacement, molette)'], ['appvolume', 'Volume d’une application'], ['page', 'Aller à une page / dossier'], ['profile', 'Changer de profil'], ['multi', 'Enchaînement d’actions']];
  const NESTED_TYPES = [['hotkey', 'Raccourci clavier'], ['text', 'Taper du texte'], ['open', 'Ouvrir appli / fichier / lien'], ['command', 'Commande Windows'], ['media', 'Média / volume'], ['audio', 'Micro / haut-parleurs (Windows)'], ['obs', 'OBS Studio'], ['wol', 'Réveiller un PC (Wake-on-LAN)'], ['http', 'Requête web (HTTP / domotique)'], ['power', 'Alimentation (verrouiller, veille, arrêt…)'], ['mouse', 'Souris (clic, déplacement, molette)'], ['appvolume', 'Volume d’une application'], ['wait', 'Attendre']];
  const OBS_CMDS = [['scene', 'Changer de scène'], ['toggleRecord', 'Enregistrement : démarrer / arrêter'], ['startRecord', 'Démarrer l’enregistrement'], ['stopRecord', 'Arrêter l’enregistrement'], ['toggleStream', 'Direct : démarrer / arrêter'], ['startStream', 'Démarrer le direct'], ['stopStream', 'Arrêter le direct'], ['toggleMute', 'Couper / réactiver une source audio']];
  const defaults = {
    none: () => ({ type: 'none' }), hotkey: () => ({ type: 'hotkey', keys: '' }), text: () => ({ type: 'text', text: '', enter: false }),
    open: () => ({ type: 'open', target: '' }), command: () => ({ type: 'command', cmd: '' }), media: () => ({ type: 'media', key: 'playpause' }),
    page: () => ({ type: 'page', pageId: '__back' }), multi: () => ({ type: 'multi', steps: [], times: 1 }), http: () => ({ type: 'http', url: '', method: 'GET', body: '', json: false, headers: '' }), power: () => ({ type: 'power', what: 'lock' }), mouse: () => ({ type: 'mouse', mode: 'click', x: 0, y: 0, current: true, amount: 3 }), appvolume: () => ({ type: 'appvolume', process: '', mode: 'toggle', value: 10 }), wait: () => ({ type: 'wait', ms: 500 }),
    audio: () => ({ type: 'audio', what: 'mic', mode: 'toggle' }), obs: () => ({ type: 'obs', cmd: 'toggleRecord', name: '' }),
    wol: () => ({ type: 'wol', mac: '', ip: '' }), profile: () => ({ type: 'profile', profileId: '' }),
  };
  // P(libellé, icône, fond, action, extras) ; extras = widget / bind / alt / w / repeat
  const P = (label, icon, bg, action, extra = {}) => ({ label, icon, bg, action, extra });
  const hk = (keys) => ({ type: 'hotkey', keys });
  const md = (key) => ({ type: 'media', key });
  const L = (n) => 'lucide:' + n;
  const PRESETS = [
    ['Média', [P('Lecture', L('play'), '#7c5cff', md('playpause')), P('Suivant', L('skip-forward'), '#3b3b44', md('next')), P('Précédent', L('skip-back'), '#3b3b44', md('prev')), P('Stop', L('square'), '#3b3b44', md('stop')), P('Vol +', L('volume-2'), '#3b3b44', md('volup'), { repeat: true }), P('Vol −', L('volume-1'), '#3b3b44', md('voldown'), { repeat: true }), P('Muet', L('volume-x'), '#e5484d', md('mute'))]],
    ['Audio & curseurs', [
      P('Volume', '', '#3b3b44', { type: 'none' }, { widget: 'volume', w: 2 }),
      P('Micro', L('mic'), '#3b3b44', { type: 'audio', what: 'mic', mode: 'toggle' }, { bind: 'mic', alt: { label: 'Micro coupé', icon: L('mic-off'), image: '', bg: '#e5484d', fg: '#ffffff', action: { type: 'audio', what: 'mic', mode: 'toggle' } } }),
      P('Son PC', L('volume-2'), '#3b3b44', { type: 'audio', what: 'speaker', mode: 'toggle' }, { bind: 'mute', alt: { label: 'Son coupé', icon: L('volume-x'), image: '', bg: '#e5484d', fg: '#ffffff', action: { type: 'audio', what: 'speaker', mode: 'toggle' } } })]],
    ['OBS Studio', [
      P('Enregistrer', L('circle'), '#3b3b44', { type: 'obs', cmd: 'toggleRecord', name: '' }, { bind: 'obsrec', alt: { label: 'REC', icon: L('square'), image: '', bg: '#e5484d', fg: '#ffffff', action: { type: 'obs', cmd: 'toggleRecord', name: '' } } }),
      P('Direct', L('radio'), '#3b3b44', { type: 'obs', cmd: 'toggleStream', name: '' }, { bind: 'obsstream', alt: { label: 'EN DIRECT', icon: L('radio'), image: '', bg: '#e5484d', fg: '#ffffff', action: { type: 'obs', cmd: 'toggleStream', name: '' } } }),
      P('Scène', L('clapperboard'), '#8b5cf6', { type: 'obs', cmd: 'scene', name: 'Scène' }),
      P('Couper micro OBS', L('mic-off'), '#3b3b44', { type: 'obs', cmd: 'toggleMute', name: 'Mic/Aux' })]],
    ['Navigation', [P('Haut', L('arrow-up'), '#3b3b44', hk('up'), { repeat: true }), P('Bas', L('arrow-down'), '#3b3b44', hk('down'), { repeat: true }), P('Gauche', L('arrow-left'), '#3b3b44', hk('left'), { repeat: true }), P('Droite', L('arrow-right'), '#3b3b44', hk('right'), { repeat: true }), P('Page préc.', L('chevron-up'), '#3b3b44', hk('pageup'), { repeat: true }), P('Page suiv.', L('chevron-down'), '#3b3b44', hk('pagedown'), { repeat: true }), P('Entrée', L('check'), '#30c48d', hk('enter')), P('Échap', L('x'), '#3b3b44', hk('esc'))]],
    ['Windows', [P('Capture', L('camera'), '#0ea5a4', hk('win+shift+s')), P('Verrouiller', L('lock'), '#f59e0b', hk('win+l')), P('Bureau', L('monitor'), '#3b3b44', hk('win+d')), P('Explorateur', L('folder-open'), '#f59e0b', hk('win+e')), P('Tâches', L('activity'), '#3b3b44', hk('ctrl+shift+esc')), P('Exécuter', L('terminal'), '#3b3b44', hk('win+r')), P('Paramètres', L('settings'), '#3b3b44', hk('win+i')), P('Presse-papier', L('clipboard'), '#3b3b44', hk('win+v')), P('Annuler arrêt', L('x'), '#3b3b44', { type: 'command', cmd: 'shutdown /a' })]],
    ['Alimentation', [P('Verrouiller', L('lock'), '#f59e0b', { type: 'power', what: 'lock' }), P('Veille', L('moon'), '#8b5cf6', { type: 'power', what: 'sleep' }), P('Hibernation', L('moon'), '#6d5bd0', { type: 'power', what: 'hibernate' }, { confirm: true }), P('Redémarrer', L('rotate-cw'), '#e58a2d', { type: 'power', what: 'restart' }, { confirm: true }), P('Éteindre', L('power'), '#e5484d', { type: 'power', what: 'shutdown' }, { confirm: true }), P('Déconnexion', L('log-out'), '#3b3b44', { type: 'power', what: 'logoff' }, { confirm: true })]],
    ['Souris & applis', [P('Clic', L('mouse'), '#3b3b44', { type: 'mouse', mode: 'click', x: 0, y: 0, current: true, amount: 3 }), P('Double-clic', L('mouse'), '#3b3b44', { type: 'mouse', mode: 'double', x: 0, y: 0, current: true, amount: 3 }), P('Clic droit', L('mouse'), '#3b3b44', { type: 'mouse', mode: 'right', x: 0, y: 0, current: true, amount: 3 }), P('Molette ↑', L('arrow-up'), '#3b3b44', { type: 'mouse', mode: 'scrollup', x: 0, y: 0, current: true, amount: 3 }, { repeat: true }), P('Molette ↓', L('arrow-down'), '#3b3b44', { type: 'mouse', mode: 'scrolldown', x: 0, y: 0, current: true, amount: 3 }, { repeat: true }), P('Spotify muet', L('volume-x'), '#1db954', { type: 'appvolume', process: 'spotify', mode: 'toggle', value: 10 }), P('Discord −', L('volume-1'), '#5865f2', { type: 'appvolume', process: 'discord', mode: 'down', value: 10 }, { repeat: true }), P('Discord +', L('volume-2'), '#5865f2', { type: 'appvolume', process: 'discord', mode: 'up', value: 10 }, { repeat: true }), P('Jeu −', L('volume-1'), '#3b3b44', { type: 'appvolume', process: '', mode: 'down', value: 10 }, { repeat: true }), P('Jeu +', L('volume-2'), '#3b3b44', { type: 'appvolume', process: '', mode: 'up', value: 10 }, { repeat: true })]],
    ['Domotique & web', [P('Hue allumer', L('lightbulb'), '#f59e0b', { type: 'http', url: 'http://192.168.1.2/api/TA-CLE/lights/1/state', method: 'PUT', body: '{"on":true}', json: true, headers: '' }), P('Hue éteindre', L('lightbulb'), '#3b3b44', { type: 'http', url: 'http://192.168.1.2/api/TA-CLE/lights/1/state', method: 'PUT', body: '{"on":false}', json: true, headers: '' }), P('Home Assistant', L('home'), '#0ea5e9', { type: 'http', url: 'http://homeassistant.local:8123/api/services/light/toggle', method: 'POST', body: '{"entity_id":"light.salon"}', json: true, headers: 'Authorization: Bearer TON-JETON' }), P('Discord webhook', L('message-square'), '#5865f2', { type: 'http', url: 'https://discord.com/api/webhooks/ID/JETON', method: 'POST', body: '{"content":"Je suis en direct !"}', json: true, headers: '' }), P('Notif téléphone', L('bell'), '#0ea5a4', { type: 'http', url: 'https://ntfy.sh/mon-sujet', method: 'POST', body: 'Bouton pressé à {time}', json: false, headers: 'Title: DeckLan' }), P('Shelly', L('plug'), '#3b3b44', { type: 'http', url: 'http://192.168.1.60/relay/0?turn=toggle', method: 'GET', body: '', json: false, headers: '' }),P('Webhook', L('webhook'), '#0ea5a4', { type: 'http', url: 'http://homeassistant.local:8123/api/webhook/mon-id', method: 'POST', body: '', json: false }), P('Lumière ON', L('lightbulb'), '#f59e0b', { type: 'http', url: 'http://192.168.1.50/relay/0?turn=on', method: 'GET', body: '', json: false }), P('Lumière OFF', L('lightbulb'), '#3b3b44', { type: 'http', url: 'http://192.168.1.50/relay/0?turn=off', method: 'GET', body: '', json: false }), P('Date du jour', L('calendar'), '#3b3b44', { type: 'text', text: '{date}', enter: false }), P('Coller presse-papiers', L('clipboard-paste'), '#3b3b44', { type: 'text', text: '{clipboard}', enter: false })]],
    ['Réseau', [P('Réveiller PC', L('power'), '#30c48d', { type: 'wol', mac: '', ip: '' })]],
    ['Édition', [P('Copier', L('copy'), '#3b3b44', hk('ctrl+c')), P('Coller', L('clipboard-paste'), '#3b3b44', hk('ctrl+v')), P('Couper', L('scissors'), '#3b3b44', hk('ctrl+x')), P('Annuler', L('undo-2'), '#3b3b44', hk('ctrl+z')), P('Rétablir', L('redo-2'), '#3b3b44', hk('ctrl+y')), P('Tout sél.', L('layout-grid'), '#3b3b44', hk('ctrl+a')), P('Enregistrer', L('save'), '#2563eb', hk('ctrl+s'))]],
    ['Applis & web', [P('Calculatrice', '🧮', '#3b3b44', { type: 'open', target: 'calc' }), P('Bloc-notes', L('file-text'), '#3b3b44', { type: 'open', target: 'notepad' }), P('Paint', L('palette'), '#3b3b44', { type: 'open', target: 'mspaint' }), P('YouTube', L('play'), '#e5484d', { type: 'open', target: 'https://www.youtube.com' }), P('Twitch', L('gamepad-2'), '#8b5cf6', { type: 'open', target: 'https://www.twitch.tv' }), P('GitHub', L('git-branch'), '#111218', { type: 'open', target: 'https://github.com' }), P('Gmail', L('mail'), '#e5484d', { type: 'open', target: 'https://mail.google.com' })]],
    ['Widgets', [P('Heure', '', '#111218', { type: 'none' }, { widget: 'clock' }), P('Date', '', '#111218', { type: 'none' }, { widget: 'date' }), P('CPU', '', '#111218', { type: 'none' }, { widget: 'cpu' }), P('RAM', '', '#111218', { type: 'none' }, { widget: 'ram' }), P('Météo', '', '#111218', { type: 'none' }, { widget: 'weather' }), P('Média en cours', '', '#111218', { type: 'media', key: 'playpause' }, { widget: 'nowplaying', w: 2 }), P('Luminosité', '', '#3b3b44', { type: 'none' }, { widget: 'brightness', w: 2 }), P('Chrono', '', '#111218', { type: 'none' }, { widget: 'stopwatch' }), P('Minuteur 5 min', '', '#111218', { type: 'none' }, { widget: 'timer', timerMin: 5 }), P('Minuteur 25 min', '', '#111218', { type: 'none' }, { widget: 'timer', timerMin: 25 })]],
    ['Vocal', [P('Discord muet', L('mic-off'), '#e5484d', hk('ctrl+shift+m')), P('Discord sourdine', L('headphones'), '#f59e0b', hk('ctrl+shift+d')), P('Texte rapide', L('message-square'), '#0ea5a4', { type: 'text', text: 'Bonjour !', enter: true })]],
  ];

  // icône : emoji/texte, ou « lucide:nom » (SVG qui prend la couleur du texte du bouton)
  function setIcon(el, icon) {
    if (typeof icon === 'string' && icon.startsWith('lucide:') && window.dlIconSvg) { el.innerHTML = window.dlIconSvg(icon.slice(7)); el.classList.add('svg'); }
    else el.textContent = icon || '';
  }
  const iconNode = (icon, cls = 'ic', style) => { const e = h('span', { class: cls, style }); setIcon(e, icon); return e; };

  // ---------- navigation ----------
  const nav = $('#nav');
  document.querySelectorAll('#nav [data-ic]').forEach((e) => { if (window.dlIconSvg) { e.innerHTML = window.dlIconSvg(e.dataset.ic); e.classList.add('ic', 'svg'); } });
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    view = b.dataset.view; emojiOpen = false;
    for (const x of nav.children) x.classList.toggle('on', x === b);
    render();
  });

  function updatePill() {
    const pill = $('#pill'); const n = status.clients.length;
    pill.className = 'pill ' + (!status.running ? 'err' : n ? 'ok' : 'wait');
    pill.lastChild.textContent = !status.running ? 'Serveur arrêté' : n ? `${n} appareil${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''}` : 'En attente du téléphone';
  }
  api.onStatus((s) => { status = s; updatePill(); if (view === 'connect') renderConnect(); });
  api.onToast((m) => toast(m.text, m.kind));
  api.onConfig((c) => { cfg = c; pi = 0; selId = null; hist = [JSON.stringify(cfg.pages)]; hp = 0; lastPush = 0; applyAccent(); render(); toast('Profil changé depuis le téléphone : ' + cfg.profile.name); });
  api.onPressed((p) => {
    const c = document.querySelector(`.cell[data-id="${CSS.escape(p.id)}"]`);
    if (c) { c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }
  });

  function render() {
    if (view === 'editor') renderEditor();
    else if (view === 'connect') renderConnect();
    else if (view === 'planning') renderPlanning();
    else if (view === 'journal') renderJournal();
    else renderSettings();
    updatePill();
  }

  // Petite boîte de saisie (window.prompt n'existe pas dans Electron).
  function ask(title, value = '') {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'text', value, maxlength: 30, spellcheck: 'false' });
      const close = (v) => { bg.remove(); resolve(v); };
      const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(null); } },
        h('div', { class: 'modal' }, h('h3', {}, title), inp,
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Annuler'), h('button', { class: 'btn primary', onclick: () => close(inp.value.trim() || null) }, 'OK'))));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(inp.value.trim() || null); if (e.key === 'Escape') close(null); });
      document.body.append(bg); inp.focus(); inp.select();
    });
  }

  // ---------- profils ----------
  const newPages = () => [{ id: rid('p_'), name: 'Accueil', cols: 4, rows: 3, hidden: false, app: '', buttons: [] }];
  function resetAfterProfileChange() {
    pi = 0; selId = null; hist = [JSON.stringify(cfg.pages)]; hp = 0; lastPush = 0;
    api.saveConfig(cfg); renderEditor();
  }
  function stash() { cfg.profiles.push({ id: cfg.profile.id, name: cfg.profile.name, pages: cfg.pages }); }
  function switchProfile(id) {
    if (id === cfg.profile.id) return;
    const i = cfg.profiles.findIndex((x) => x.id === id); if (i < 0) return;
    const t = cfg.profiles.splice(i, 1)[0];
    stash(); cfg.profile = { id: t.id, name: t.name }; cfg.pages = t.pages; resetAfterProfileChange();
  }
  async function addProfile() {
    if (cfg.profiles.length >= 14) return toast('Maximum 15 profils', 'err');
    const name = await ask('Nom du nouveau profil', 'Jeu'); if (!name) return;
    stash(); cfg.profile = { id: rid('pr_'), name }; cfg.pages = newPages(); resetAfterProfileChange(); toast('Profil « ' + name + ' » créé', 'ok');
  }
  async function renameProfile() {
    const name = await ask('Renommer le profil', cfg.profile.name); if (!name) return;
    cfg.profile.name = name; api.saveConfig(cfg); renderProfBar();
  }
  async function dupProfile() {
    if (cfg.profiles.length >= 14) return toast('Maximum 15 profils', 'err');
    const copy = JSON.parse(JSON.stringify(cfg.pages)); copy.forEach((p) => { p.id = rid('p_'); p.buttons.forEach((b) => { b.id = rid('b_'); }); });
    // les boutons « page » du double pointent vers les pages d'origine : on les remappe
    const map = {}; cfg.pages.forEach((p, i) => { map[p.id] = copy[i].id; });
    copy.forEach((p) => p.buttons.forEach((b) => { if (b.action.type === 'page' && map[b.action.pageId]) b.action.pageId = map[b.action.pageId]; }));
    stash(); cfg.profile = { id: rid('pr_'), name: (cfg.profile.name + ' (copie)').slice(0, 30) }; cfg.pages = copy; resetAfterProfileChange(); toast('Profil dupliqué', 'ok');
  }
  function delProfile() {
    if (!cfg.profiles.length) return toast('Il faut garder au moins un profil', 'err');
    if (!confirm(`Supprimer le profil « ${cfg.profile.name} » et toutes ses pages ?`)) return;
    const gone = cfg.profile.id; const t = cfg.profiles.shift();
    cfg.profile = { id: t.id, name: t.name }; cfg.pages = t.pages;
    const fix = (pages) => pages.forEach((p) => p.buttons.forEach((b) => { if (b.action.type === 'profile' && b.action.profileId === gone) b.action = { type: 'none' }; }));
    fix(cfg.pages); cfg.profiles.forEach((q) => fix(q.pages)); resetAfterProfileChange();
  }
  function renderProfBar() {
    const bar = $('#profbar'); if (!bar) return;
    bar.className = 'profbar';
    const all = [cfg.profile, ...cfg.profiles];
    bar.replaceChildren(h('span', { class: 'lbl' }, 'Profil'),
      select(all.map((x) => [x.id, '👤 ' + x.name]), cfg.profile.id, (v) => switchProfile(v)),
      h('button', { class: 'btn sm', title: 'Nouveau profil vide', onclick: addProfile }, '＋ Nouveau'),
      h('button', { class: 'btn sm', onclick: renameProfile }, 'Renommer'),
      h('button', { class: 'btn sm', onclick: dupProfile }, 'Dupliquer'),
      h('button', { class: 'btn sm danger', disabled: !cfg.profiles.length, onclick: delProfile }, 'Supprimer'),
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm', onclick: async () => { if (await api.exportProfile({ name: cfg.profile.name, pages: cfg.pages })) toast('Profil exporté', 'ok'); } }, 'Exporter'),
        h('button', { class: 'btn sm', onclick: async () => {
          const r = await api.importProfile(); if (!r) return; if (r.error) return toast('Import impossible : ' + r.error, 'err');
          if (cfg.profiles.length >= 14) return toast('Maximum 15 profils', 'err');
          stash(); cfg.profile = { id: rid('pr_'), name: String(r.name || 'Importé').slice(0, 30) }; cfg.pages = Array.isArray(r.pages) && r.pages.length ? r.pages : newPages();
          resetAfterProfileChange(); toast('Profil importé', 'ok');
        } }, 'Importer')));
  }

  // ================= ÉDITEUR =================
  function renderEditor() {
    const view$ = $('#view');
    view$.replaceChildren(h('div', { class: 'editor' },
      h('section', { class: 'stage' }, h('div', { id: 'profbar' }), h('div', { id: 'pagebar' }), h('div', { id: 'pageset' }), h('div', { class: 'gridwrap', id: 'gridwrap' }, h('div', { class: 'phone' }, h('div', { class: 'pgrid', id: 'pgrid' }))),
        h('div', { class: 'hintbar hint' }, 'Clique une case pour la modifier · glisse un bouton pour le déplacer ou l’échanger · Suppr pour l’effacer')),
      h('aside', { class: 'inspector', id: 'insp' })));
    renderProfBar(); renderPageBar(); renderGrid(); renderInspector();
  }

  function renderPageBar() {
    const bar = $('#pagebar'); if (!bar) return;
    bar.className = 'pagebar';
    bar.replaceChildren(
      ...cfg.pages.map((p, i) => h('button', { class: 'ptab' + (i === pi ? ' on' : ''), onclick: () => { pi = i; selId = null; emojiOpen = false; renderEditor(); } }, (p.hidden ? '📁 ' : '') + p.name)),
      cfg.pages.length < 20 ? h('button', { class: 'ptab', title: 'Ajouter une page', onclick: addPage }, '＋') : null,
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm', id: 'paste', title: 'Coller le bouton copié (Ctrl+V)', hidden: !clip, onclick: pasteBtn }, '📋 Coller'),
        h('button', { class: 'btn sm', id: 'undo', title: 'Annuler (Ctrl+Z)', disabled: hp === 0, onclick: () => travel(-1) }, '↶ Annuler'),
        h('button', { class: 'btn sm', id: 'redo', title: 'Rétablir (Ctrl+Y)', disabled: hp >= hist.length - 1, onclick: () => travel(1) }, '↷ Rétablir')));
    const p = page();
    const stepper = (get, set) => h('div', { class: 'stepper' }, h('button', { onclick: () => set(get() - 1) }, '−'), h('b', {}, get()), h('button', { onclick: () => set(get() + 1) }, '+'));
    $('#pageset').className = 'pageset';
    $('#pageset').replaceChildren(
      h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Nom'), textInput(p.name, (v) => { p.name = v.slice(0, 30); save(); const t = $('#pagebar').children[pi]; if (t) t.textContent = (p.hidden ? '📁 ' : '') + p.name; })),
      h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Colonnes'), stepper(() => p.cols, (v) => resize(v, p.rows))),
      h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Lignes'), stepper(() => p.rows, (v) => resize(p.cols, v))),
      h('div', { class: 'grp', title: 'Quand cette appli passe au premier plan sur le PC, le téléphone affiche cette page (comme les profils Elgato). Ex : chrome, obs64, discord' }, h('span', { class: 'lbl' }, 'Appli liée'), h('input', { type: 'text', style: { width: '120px' }, value: p.app || '', placeholder: 'ex : obs64', oninput: (e) => { p.app = e.target.value.trim().toLowerCase().replace(/\.exe$/, ''); save(); } })),
      h('label', { class: 'grp', title: 'Un dossier n’apparaît pas dans les onglets du téléphone : on y entre via un bouton « Aller à une page ».' },
        h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: p.hidden, onchange: (e) => { if (e.target.checked && cfg.pages.filter((x) => !x.hidden).length < 2) { e.target.checked = false; toast('Garde au moins une page visible', 'err'); return; } p.hidden = e.target.checked; save(); renderPageBar(); } }), h('span')), 'Dossier (caché des onglets)'),
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } },
        h('button', { class: 'btn sm', disabled: cfg.pages.length >= 20, onclick: dupPage }, 'Dupliquer la page'),
        h('button', { class: 'btn sm danger', disabled: cfg.pages.length < 2, onclick: delPage }, 'Supprimer la page')));
  }

  function addPage() {
    cfg.pages.push({ id: rid('p_'), name: 'Page ' + (cfg.pages.length + 1), cols: 4, rows: 3, hidden: false, buttons: [] });
    pi = cfg.pages.length - 1; selId = null; save(); renderEditor();
  }
  function dupPage() {
    const c = JSON.parse(JSON.stringify(page())); c.id = rid('p_'); c.name = (c.name + ' (copie)').slice(0, 30);
    c.buttons.forEach((b) => { b.id = rid('b_'); });
    cfg.pages.splice(pi + 1, 0, c); pi++; selId = null; save(); renderEditor();
  }
  function delPage() {
    const p = page();
    if (!confirm(`Supprimer la page « ${p.name} » et ses ${p.buttons.length} bouton(s) ?`)) return;
    cfg.pages.splice(pi, 1);
    for (const q of cfg.pages) for (const b of q.buttons) {
      if (b.action.type === 'page' && b.action.pageId === p.id) b.action = { type: 'none' };
    }
    if (cfg.pages.every((x) => x.hidden)) cfg.pages[0].hidden = false;
    pi = Math.max(0, pi - 1); selId = null; save(); renderEditor();
  }

  // cases occupées (en comptant la largeur des boutons larges)
  const spanOf = (b) => Math.max(1, b.w || 1);
  function occupiedSet(p, ignore = null, cols = p.cols, rows = p.rows) {
    const used = new Set();
    for (const b of p.buttons) { if (b === ignore || b.row >= rows) continue; for (let k = 0; k < spanOf(b) && b.col + k < cols; k++) used.add(b.row + ',' + (b.col + k)); }
    return used;
  }
  const occupant = (p, r, c, ignore = null) => p.buttons.find((b) => b !== ignore && b.row === r && c >= b.col && c < b.col + spanOf(b)) || null;
  function freeCells(p, cols = p.cols, rows = p.rows, ignore = null) {
    const used = occupiedSet(p, ignore, cols, rows);
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!used.has(r + ',' + c)) out.push({ r, c });
    return out;
  }
  function resize(cols, rows) {
    const p = page();
    cols = Math.min(8, Math.max(1, cols)); rows = Math.min(8, Math.max(1, rows));
    if (cols === p.cols && rows === p.rows) return;
    const out = p.buttons.filter((b) => b.row >= rows || b.col >= cols);
    const inside = p.buttons.filter((b) => b.row < rows && b.col < cols);
    for (const b of inside) b.w = Math.min(spanOf(b), cols - b.col);
    if (out.length) {
      const taken = new Set();
      for (const b of inside) for (let k = 0; k < spanOf(b); k++) taken.add(b.row + ',' + (b.col + k));
      const free = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!taken.has(r + ',' + c)) free.push({ r, c });
      if (free.length < out.length) { toast('Pas assez de place : libère des cases avant de réduire', 'err'); return; }
      out.forEach((b, i) => { b.row = free[i].r; b.col = free[i].c; b.w = 1; });
    }
    p.cols = cols; p.rows = rows; save(); renderPageBar(); renderGrid();
  }

  function renderGrid() {
    const g = $('#pgrid'); if (!g) return;
    const p = page(); const wrap = $('#gridwrap'); const gap = 10;
    const aw = wrap.clientWidth - 48 - 34, ah = wrap.clientHeight - 48 - 34;
    const size = Math.max(52, Math.min(120, Math.floor(Math.min((aw - (p.cols - 1) * gap) / p.cols, (ah - (p.rows - 1) * gap) / p.rows))));
    g.style.gridTemplateColumns = `repeat(${p.cols}, ${size}px)`; g.style.gridAutoRows = size + 'px';
    const cells = [];
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const b = p.buttons.find((x) => x.row === r && x.col === c);
      if (!b && occupant(p, r, c)) continue; // case recouverte par un bouton large
      const cell = h('div', { class: 'cell ' + (b ? 'btn-cell' : 'empty') + (b && b.id === selId ? ' sel' : ''), style: { gridRow: r + 1, gridColumn: (c + 1) + ' / span ' + (b ? spanOf(b) : 1) } });
      if (b) {
        cell.dataset.id = b.id; cell.draggable = true;
        cell.style.background = `linear-gradient(160deg, ${b.bg}, ${shade(b.bg, -24)})`; cell.style.color = b.fg;
        if (b.widget === 'volume' || b.widget === 'brightness') {
          cell.style.flexDirection = 'row'; cell.style.gap = '8px'; cell.style.padding = '0 10px';
          cell.append(iconNode(L(b.widget === 'brightness' ? 'sun' : 'volume-2'), 'ic', { fontSize: Math.round(size * 0.26) + 'px' }), h('div', { class: 'vtrack' }, h('div', { class: 'vfill', style: { width: '62%' } })));
        } else if (b.widget) cell.append(h('span', { class: 'lb', style: { fontSize: Math.max(10, Math.round(size * 0.16)) + 'px', fontWeight: 700, overflow: 'visible' } }, { clock: '12:34', date: 'lun. 16', cpu: 'CPU 23%', ram: 'RAM 41%', weather: '☀️ 18°', nowplaying: '▶ Titre', brightness: '🔆 60%', stopwatch: '00:00', timer: String(b.timerMin || 5).padStart(2, '0') + ':00' }[b.widget]));
        else if (b.image) cell.append(h('img', { src: b.image, draggable: 'false', style: { width: Math.round(size * 0.58) + 'px', height: Math.round(size * 0.58) + 'px', objectFit: 'cover', borderRadius: '10px', pointerEvents: 'none' } }));
        else if (b.icon) cell.append(iconNode(b.icon, 'ic', { fontSize: Math.round(size * 0.38) + 'px' }));
        if (!b.widget && b.label) cell.append(h('span', { class: 'lb', style: { fontSize: Math.max(10, Math.round(size * 0.13)) + 'px' } }, b.label));
        const tags = (b.action.type === 'page' ? (b.action.pageId === '__back' ? '↩' : b.action.pageId === '__home' ? '🏠' : '📁') : b.action.type === 'multi' ? '⛓' : b.action.type === 'profile' ? '👤' : '') + (b.alt ? '⇄' : '') + (b.bind ? '🔗' : '') + (b.repeat ? '↻' : '') + (b.hold && b.hold.type !== 'none' ? '⏱' : '');
        if (tags) cell.append(h('span', { class: 'tag' }, tags));
        cell.addEventListener('dragstart', (e) => { dragId = b.id; e.dataTransfer.setData('text/plain', b.id); e.dataTransfer.effectAllowed = 'move'; });
        cell.addEventListener('dragend', () => { dragId = null; });
      } else cell.textContent = '+';
      cell.addEventListener('click', () => {
        if (b) selId = b.id;
        else { const nb = newButton(r, c); p.buttons.push(nb); selId = nb.id; save(); }
        inspTab = 'button'; emojiOpen = false; renderGrid(); renderInspector();
      });
      cell.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); cell.classList.add('over'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault(); cell.classList.remove('over');
        const mv = p.buttons.find((x) => x.id === dragId); dragId = null; if (!mv) return;
        const w = spanOf(mv); const tc = Math.min(c, p.cols - w);
        if (w === 1) {
          const other = occupant(p, r, tc, mv);
          if (other && spanOf(other) > 1) return toast('Case occupée par un bouton large : libère la place', 'err');
          if (other) { other.row = mv.row; other.col = mv.col; }
        } else {
          for (let k = 0; k < w; k++) if (occupant(p, r, tc + k, mv)) return toast('Pas assez de place pour ce bouton large', 'err');
        }
        mv.row = r; mv.col = tc; save(); renderGrid();
      });
      cells.push(cell);
    }
    g.replaceChildren(...cells);
  }
  window.addEventListener('resize', () => { if (view === 'editor') renderGrid(); });

  function newButton(row, col) {
    return { id: rid('b_'), row, col, w: 1, label: 'Bouton', icon: L('star'), image: '', bg: '#3b3b44', fg: '#ffffff', widget: '', bind: '', repeat: false, confirm: false, shortcut: '', timerMin: 5, action: { type: 'none' }, hold: { type: 'none' } };
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, v + amt));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }

  document.addEventListener('keydown', (e) => {
    if (view !== 'editor' || recording) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); return travel(-1); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); return travel(1); }
      if (k === 'c') { e.preventDefault(); return copySel(); }
      if (k === 'v') { e.preventDefault(); return pasteBtn(); }
      if (k === 'd') { e.preventDefault(); return dupSel(); }
    }
    if (e.key === 'Delete' && selId && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) deleteSel();
  });
  function dupSel() {
    const b = selBtn(); if (!b) return; const p = page();
    const free = freeCells(p)[0]; if (!free) return toast('La page est pleine', 'err');
    const c = JSON.parse(JSON.stringify(b)); c.id = rid('b_'); c.row = free.r; c.col = free.c; p.buttons.push(c); selId = c.id; save(); renderGrid(); renderInspector();
  }
  function deleteSel() {
    const p = page(); const i = p.buttons.findIndex((b) => b.id === selId);
    if (i < 0) return;
    p.buttons.splice(i, 1); selId = null; save(); renderGrid(); renderInspector();
  }

  // ---------- inspecteur ----------
  const CAT_ICONS = { 'Média': 'music', 'Audio & curseurs': 'sliders-horizontal', 'OBS Studio': 'video', 'Navigation': 'mouse-pointer', 'Windows': 'monitor', 'Alimentation': 'power', 'Souris & applis': 'mouse', 'Domotique & web': 'lightbulb', 'Réseau': 'globe', 'Édition': 'scissors', 'Applis & web': 'folder-open', 'Widgets': 'layout-grid', 'Vocal': 'mic' };
  const WIDGET_ICONS = { volume: 'sliders-horizontal', clock: 'clock', date: 'calendar', cpu: 'cpu', ram: 'memory-stick', stopwatch: 'timer', timer: 'hourglass', weather: 'cloud', nowplaying: 'music', brightness: 'sun' };
  const catOpen = new Set(['Média']);
  function renderInspector() {
    const el = $('#insp'); if (!el) return;
    const b = selBtn();
    const tabs = h('div', { class: 'itabs' },
      h('button', { class: inspTab === 'button' ? 'on' : '', onclick: () => { inspTab = 'button'; emojiOpen = false; renderInspector(); } }, 'Bouton'),
      h('button', { class: inspTab === 'presets' ? 'on' : '', onclick: () => { inspTab = 'presets'; emojiOpen = false; renderInspector(); } }, 'Modèles'));
    const body = h('div', { class: 'ibody' });
    if (inspTab === 'presets' || !b) {
      const list = h('div', { class: 'cats' });
      const fill = (q) => {
        list.replaceChildren();
        PRESETS.forEach(([group, items], gi) => {
          const f = items.filter((it) => !q || (it.label + ' ' + group).toLowerCase().includes(q));
          if (!f.length) return;
          const det = h('details', { class: 'cat' });
          det.open = !!q || catOpen.has(group);
          det.addEventListener('toggle', () => { if (!q) { if (det.open) catOpen.add(group); else catOpen.delete(group); } });
          det.append(h('summary', {}, iconNode(L(CAT_ICONS[group] || 'folder'), 'ic cat-ic'), h('span', { class: 'cat-name' }, group), h('span', { class: 'cat-n' }, String(f.length))),
            h('div', { class: 'presets' }, f.map((it) =>
              h('button', { class: 'preset', title: it.label, onclick: () => applyPreset(it) }, h('i', { style: { background: it.bg } }, iconNode(it.icon || L(WIDGET_ICONS[it.extra && it.extra.widget] || 'star'))), h('span', {}, it.label)))));
          list.append(det);
        });
        if (!list.children.length) list.append(h('div', { class: 'hint' }, 'Aucune action.'));
      };
      body.append(h('div', { class: 'searchbox' }, iconNode(L('search'), 'ic'), h('input', { type: 'text', placeholder: 'Rechercher une action…', oninput: (e) => fill(e.target.value.trim().toLowerCase()) })));
      body.append(h('p', { class: 'hint tip' }, b ? 'Un clic remplace le bouton sélectionné s’il est vierge, sinon prend la première case libre.' : 'Clique une action pour l’ajouter, ou sélectionne une case pour modifier son bouton.'));
      fill(''); body.append(list);
    } else {
      body.append(buttonForm(b));
    }
    el.replaceChildren(tabs, body);
    if (emojiOpen && b && inspTab === 'button') {
      const tgt = pickTarget || b;
      const grid = h('div', { class: 'emoji-grid' });
      const fill = () => {
        grid.replaceChildren();
        grid.className = 'emoji-grid ' + iconTab;
        if (iconTab === 'emoji') EMOJI.forEach((em) => grid.append(h('button', { onclick: () => { tgt.icon = em; emojiOpen = false; save(); renderGrid(); renderInspector(); } }, em)));
        else {
          const q = iconQ.trim().toLowerCase();
          Object.keys(window.DL_ICONS || {}).filter((n) => !q || n.includes(q)).forEach((n) => grid.append(h('button', { title: n, onclick: () => { tgt.icon = L(n); emojiOpen = false; save(); renderGrid(); renderInspector(); } }, iconNode(L(n), 'ic'))));
          if (!grid.children.length) grid.append(h('div', { class: 'hint', style: { gridColumn: '1/-1' } }, 'Aucune icône.'));
        }
      };
      const pop = h('div', { class: 'emoji-pop' },
        h('div', { class: 'ptabs' },
          h('button', { class: iconTab === 'icons' ? 'on' : '', onclick: () => { iconTab = 'icons'; renderInspector(); } }, `Icônes (${Object.keys(window.DL_ICONS || {}).length})`),
          h('button', { class: iconTab === 'emoji' ? 'on' : '', onclick: () => { iconTab = 'emoji'; renderInspector(); } }, 'Emoji'),
          h('button', { class: 'x', onclick: () => { emojiOpen = false; renderInspector(); } }, '✕')),
        iconTab === 'icons' ? h('input', { type: 'text', placeholder: '🔍 mic, volume, play…', value: iconQ, oninput: (e) => { iconQ = e.target.value; fill(); } }) : null,
        grid);
      fill(); el.append(pop);
    }
  }

  function applyPreset(it) {
    const p = page(); let b = selBtn();
    // remplace le bouton sélectionné seulement s'il est encore vierge ; sinon ajoute dans une case libre
    if (b && !(b.label === 'Bouton' && b.action.type === 'none' && !b.alt && !b.widget)) b = null;
    const w = (it.extra && it.extra.w) || 1;
    if (!b) {
      const free = freeCells(p).find((f) => f.c + w <= p.cols && Array.from({ length: w }, (_, k) => !occupant(p, f.r, f.c + k)).every(Boolean));
      if (!free) { toast('Pas de place sur la page', 'err'); return; }
      b = newButton(free.r, free.c); p.buttons.push(b); selId = b.id;
    }
    Object.assign(b, { label: it.label, icon: it.icon, image: '', bg: it.bg, fg: '#ffffff', widget: '', bind: '', repeat: false, confirm: false, shortcut: '', timerMin: 5, w: 1, action: JSON.parse(JSON.stringify(it.action)), hold: { type: 'none' } });
    delete b.alt;
    Object.assign(b, JSON.parse(JSON.stringify(it.extra || {})));
    if (b.w > 1) { // la largeur doit tenir sur la page et ne pas recouvrir un voisin
      b.w = Math.min(b.w, p.cols - b.col);
      for (let k = 1; k < b.w; k++) if (occupant(p, b.row, b.col + k, b)) { b.w = k; break; }
    }
    save(); renderGrid(); renderInspector(); toast(`« ${it.label} » ajouté`, 'ok');
  }

  const openSecs = { look: true, action: true, hold: false, alt: false };
  const section = (key, title, hint, ...kids) => {
    const d = h('details', { class: 'sec', ontoggle: () => { openSecs[key] = d.open; } }, h('summary', {}, title, hint ? h('em', {}, hint) : null), h('div', { class: 'secbody' }, ...kids));
    d.open = !!openSecs[key]; return d;
  };

  async function pickImage(onDone) {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const url = URL.createObjectURL(f); const img = new Image();
      img.onload = () => {
        for (const size of [144, 112, 80]) {
          const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
          const m = Math.min(img.width, img.height); g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
          const data = c.toDataURL('image/webp', 0.85);
          if (data.length <= 90000) { URL.revokeObjectURL(url); return onDone(data); }
        }
        URL.revokeObjectURL(url); toast('Image trop lourde', 'err');
      };
      img.onerror = () => toast('Image illisible', 'err'); img.src = url;
    };
    inp.click();
  }

  function colorsField(face, after) {
    const bg = h('input', { type: 'color', value: face.bg, oninput: (e) => { face.bg = e.target.value; save(); after(); } });
    const fg = h('input', { type: 'color', value: face.fg, oninput: (e) => { face.fg = e.target.value; save(); after(); } });
    return field('Couleurs', h('div', { class: 'row' }, bg, h('span', { class: 'hint' }, 'fond'), fg, h('span', { class: 'hint' }, 'texte')),
      h('div', { class: 'swatches', style: { marginTop: '6px' } }, SWATCHES.map((c) => h('button', { class: 'sw', style: { background: c }, onclick: () => { face.bg = c; bg.value = c; save(); after(); } }))));
  }

  function setWidth(b, w) {
    const p = page(); w = Math.max(1, Math.min(4, w));
    if (b.col + w > p.cols) return toast('Pas assez de colonnes', 'err');
    for (let k = 1; k < w; k++) if (occupant(p, b.row, b.col + k, b)) return toast('Libère d’abord la case à droite', 'err');
    b.w = w; save(); renderGrid(); renderInspector();
  }

  function buttonForm(b) {
    const p = page();
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'ititle' }, `Case ${b.row + 1}·${b.col + 1}`, h('span', { class: 'hint' }, 'ligne · colonne')));

    // --- apparence ---
    const look = [];
    look.push(field('Contenu', select([['', 'Bouton normal'], ['volume', '🎚 Curseur de volume du PC'], ['clock', '🕒 Widget : heure'], ['date', '📅 Widget : date'], ['cpu', '🧠 Widget : CPU du PC'], ['ram', '📊 Widget : RAM du PC'], ['weather', '🌤 Widget : météo (ville dans Réglages)'], ['nowplaying', '🎵 Widget : média en cours (toucher = lecture/pause)'], ['brightness', '🔆 Curseur de luminosité (écran intégré)'], ['stopwatch', '⏱ Chronomètre (sur le téléphone)'], ['timer', '⏳ Minuteur (sur le téléphone)']], b.widget || '', (v) => {
      b.widget = v;
      if ((v === 'volume' || v === 'brightness') && spanOf(b) < 2) { let w = 1; while (w < 3 && b.col + w < p.cols && !occupant(p, b.row, b.col + w, b)) w++; b.w = w; if (w < 2) toast('Le curseur est plus agréable sur 2 colonnes : libère la case à droite', 'err'); }
      if (v === 'nowplaying' && b.action.type === 'none') b.action = { type: 'media', key: 'playpause' };
      save(); renderGrid(); renderInspector();
    })));
    if (b.widget === 'timer') look.push(field('Durée du minuteur', h('div', { class: 'row' }, h('input', { type: 'number', min: 1, max: 180, value: b.timerMin || 5, oninput: (e) => { b.timerMin = Math.max(1, Math.min(180, +e.target.value || 5)); save(); renderGrid(); } }), h('span', { class: 'hint' }, 'minutes · toucher = démarrer / pause · maintenir = remettre à zéro'))));
    if (b.widget === 'stopwatch') look.push(h('div', { class: 'hint', style: { marginBottom: '10px' } }, 'Toucher = démarrer / pause · maintenir = remettre à zéro. Tourne sur le téléphone, rien n’est envoyé au PC.'));
    look.push(field('Largeur', h('div', { class: 'row' }, h('div', { class: 'stepper' },
      h('button', { onclick: () => setWidth(b, spanOf(b) - 1) }, '−'), h('b', {}, spanOf(b)), h('button', { onclick: () => setWidth(b, spanOf(b) + 1) }, '+')), h('span', { class: 'hint' }, 'colonnes (1 à 4)'))));
    look.push(field('Libellé', textInput(b.label, (v) => { b.label = v.slice(0, 40); save(); renderGrid(); })));
    const iconInput = textInput(b.icon, (v) => { b.icon = v.slice(0, 48); save(); renderGrid(); }, 'emoji, texte ou lucide:nom');
    look.push(field('Icône', h('div', { class: 'row' }, iconInput, h('button', { class: 'btn', onclick: () => { emojiOpen = !emojiOpen; pickTarget = b; renderInspector(); } }, '😀 / ◇')),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn sm', onclick: () => pickImage((d) => { b.image = d; save(); renderGrid(); renderInspector(); }) }, '🖼 Image personnalisée'),
        b.image ? h('img', { src: b.image, style: { width: '30px', height: '30px', borderRadius: '6px', objectFit: 'cover' } }) : null,
        b.image ? h('button', { class: 'btn sm danger', onclick: () => { b.image = ''; save(); renderGrid(); renderInspector(); } }, 'Retirer') : null)));
    look.push(colorsField(b, renderGrid));
    wrap.append(section('look', 'Apparence', '', ...look));

    // --- action ---
    wrap.append(section('action', 'Action à l’appui', '', actionEditor(b.action, (a) => { b.action = a; save(); renderGrid(); }, { nested: false }),
      h('label', { class: 'row', style: { marginTop: '12px' }, title: 'Idéal pour volume, flèches, page précédente/suivante.' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!b.repeat, onchange: (e) => { b.repeat = e.target.checked; save(); renderGrid(); renderInspector(); } }), h('span')), 'Répéter tant que le bouton est maintenu'),
      h('label', { class: 'row', style: { marginTop: '10px' }, title: 'Le téléphone demande une confirmation avant d’envoyer l’ordre.' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!b.confirm, onchange: (e) => { b.confirm = e.target.checked; save(); renderInspector(); } }), h('span')), 'Demander confirmation avant d’exécuter'),
      field('Raccourci clavier sur le PC', textInput(b.shortcut, (v) => { b.shortcut = v.trim().toLowerCase(); save(); }, 'ex : ctrl+alt+1'),
        h('div', { class: 'hint' }, 'Lance ce bouton depuis ton clavier, sans le téléphone. Un modificateur est obligatoire (ctrl, alt, shift, win). Fonctionne tant que DeckLan tourne.'))));

    // --- appui long ---
    if (!b.hold) b.hold = { type: 'none' };
    wrap.append(section('hold', 'Appui long', b.hold.type !== 'none' ? ' · actif' : '',
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, (b.repeat ? '⚠ Désactivé : « Répéter tant que maintenu » est actif. ' : '') + 'Maintenir le bouton 0,5 s lance cette action à la place. Si elle est définie, l’action normale part au relâchement.'),
      actionEditor(b.hold, (a) => { b.hold = a; save(); renderGrid(); }, { nested: false })));

    // --- 2 états ---
    const altBody = [];
    altBody.push(h('label', { class: 'row' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!b.alt, onchange: (e) => {
      if (e.target.checked) b.alt = { label: b.label, icon: b.icon, image: '', bg: b.bg, fg: b.fg, action: JSON.parse(JSON.stringify(b.action)) }; else { delete b.alt; b.bind = ''; }
      openSecs.alt = true; save(); renderGrid(); renderInspector();
    } }), h('span')), 'Bouton à 2 états (bascule)'));
    if (b.alt) {
      const a = b.alt;
      altBody.push(h('div', { class: 'hint', style: { margin: '8px 0 12px' } }, 'Chaque appui alterne : 1er appui = action ci-dessus et affichage de l’état 2 ; appui suivant = action de l’état 2 et retour à l’état 1. Ex : micro muet / actif.'));
      altBody.push(field('Libellé état 2', textInput(a.label, (v) => { a.label = v.slice(0, 40); save(); }))); 
      altBody.push(field('Icône état 2', h('div', { class: 'row' }, textInput(a.icon, (v) => { a.icon = v.slice(0, 48); save(); }, 'emoji, texte ou lucide:nom'), h('button', { class: 'btn', onclick: () => { emojiOpen = !emojiOpen; pickTarget = a; renderInspector(); } }, '😀 / ◇'))));
      altBody.push(field('État lié (retour réel du PC)', select([['', 'Aucun : simple bascule locale'], ['mic', 'Micro Windows coupé'], ['mute', 'Haut-parleurs Windows coupés'], ['obsrec', 'OBS enregistre'], ['obsstream', 'OBS en direct']], b.bind || '', (v) => { b.bind = v; save(); renderGrid(); })),
        h('div', { class: 'hint' }, 'Lié : le bouton affiche l’état 2 quand le système l’indique, même si tu changes le micro ailleurs. L’action de l’état 2 est alors ignorée : mets la même que ci-dessus.'));
      altBody.push(colorsField(a, () => {}));
      altBody.push(h('div', { class: 'lbl', style: { margin: '6px 0 8px' } }, 'Action de l’état 2'));
      altBody.push(actionEditor(a.action, (x) => { a.action = x; save(); }, { nested: false }));
    }
    wrap.append(section('alt', 'Bascule', b.alt ? ' · actif' : '', ...altBody));

    const test = h('button', { class: 'btn primary', onclick: async () => {
      if (b.action.type === 'page') return toast('Navigation : à tester sur le téléphone');
      const r = await api.testAction(b.action); toast(r.ok ? 'Action envoyée' : r.err, r.ok ? 'ok' : 'err');
    } }, '▶ Tester sur ce PC');
    wrap.append(h('div', { class: 'actions-foot' }, test, h('button', { class: 'btn', title: 'Ctrl+D', onclick: dupSel }, 'Dupliquer'), h('button', { class: 'btn', title: 'Ctrl+C', onclick: copySel }, 'Copier'), h('button', { class: 'btn danger', onclick: deleteSel }, 'Supprimer')));
    return wrap;
  }

  // ---------- éditeur d'action (réutilisé pour les étapes d'un enchaînement) ----------
  let recording = null;
  function actionEditor(action, onChange, { nested }) {
    const box = h('div', {});
    const rebuild = () => { box.replaceChildren(...build()); };
    const set = (patch) => { Object.assign(action, patch); onChange(action); };
    const build = () => {
      const out = [];
      const types = nested ? NESTED_TYPES : TYPES;
      const typeSel = select(types, action.type, (t) => {
        for (const k of Object.keys(action)) delete action[k];
        Object.assign(action, defaults[t]());
        if (t === 'page') action.pageId = '__back';
        onChange(action); rebuild();
      });
      out.push(typeSel);
      const gap = { marginTop: '10px' };
      switch (action.type) {
        case 'hotkey': {
          const inp = textInput(action.keys, (v) => set({ keys: v }), 'ex : ctrl+shift+m');
          const rec = h('button', { class: 'btn' }, '⏺ Enregistrer');
          rec.onclick = () => {
            if (recording) { recording.stop(); return; }
            rec.textContent = '… appuie sur la combinaison'; inp.focus();
            recording = {
              stop: () => { window.removeEventListener('keydown', onKey, true); recording = null; rec.textContent = '⏺ Enregistrer'; },
            };
            const onKey = (e) => {
              e.preventDefault(); e.stopPropagation();
              if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
              const k = keyName(e); if (!k) return;
              const mods = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'win'].filter(Boolean);
              const combo = [...mods, k].join('+'); inp.value = combo; set({ keys: combo }); recording.stop();
            };
            window.addEventListener('keydown', onKey, true);
          };
          out.push(h('div', { class: 'row', style: gap }, inp, rec), h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Modificateurs : ctrl, shift, alt, win. Touches : a-z, 0-9, f1-f24, enter, esc, tab, space, up, down…'));
          break;
        }
        case 'text':
          out.push(h('textarea', { style: gap, placeholder: 'Texte à taper dans la fenêtre active. Variables : {date} {time} {datetime} {clipboard}', oninput: (e) => set({ text: e.target.value } ) }, action.text || ''),
            h('label', { class: 'row', style: gap }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: action.enter, onchange: (e) => set({ enter: e.target.checked }) }), h('span')), 'Appuyer sur Entrée à la fin'));
          break;
        case 'open': {
          const inp = textInput(action.target, (v) => set({ target: v }), 'https://…  ou  C:\\…\\app.exe  ou  calc');
          out.push(h('div', { class: 'row', style: gap }, inp, h('button', { class: 'btn', onclick: async () => { const f = await api.pickFile(); if (f) { inp.value = f; set({ target: f }); } } }, 'Parcourir')));
          break;
        }
        case 'command':
          out.push(h('div', { style: gap }, textInput(action.cmd, (v) => set({ cmd: v }), 'ex : shutdown /a')), h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Exécutée via cmd, sans fenêtre visible.'));
          break;
        case 'media':
          out.push(h('div', { style: gap }, select(MEDIA, action.key, (v) => set({ key: v }))));
          break;
        case 'audio':
          out.push(h('div', { style: gap }, select([['mic', '🎙 Micro (entrée par défaut)'], ['speaker', '🔊 Haut-parleurs (sortie par défaut)']], action.what, (v) => set({ what: v }))),
            h('div', { style: gap }, select([['toggle', 'Basculer muet / actif'], ['mute', 'Couper (muet)'], ['unmute', 'Réactiver']], action.mode, (v) => set({ mode: v }))),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Agit sur le périphérique Windows par défaut. Pour que le bouton reflète l’état réel, utilise « Bascule » puis « État lié ».'));
          break;
        case 'obs': {
          const dl = h('datalist', { id: 'obs-names-' + Math.random().toString(16).slice(2, 6) });
          const needsName = action.cmd === 'scene' || action.cmd === 'toggleMute';
          out.push(h('div', { style: gap }, select(OBS_CMDS, action.cmd, (v) => { set({ cmd: v }); rebuild(); })));
          if (needsName) {
            const inp = h('input', { type: 'text', value: action.name || '', placeholder: action.cmd === 'scene' ? 'Nom exact de la scène' : 'Nom exact de la source audio', list: dl.id, oninput: (e) => set({ name: e.target.value }) });
            out.push(h('div', { class: 'row', style: gap }, inp, action.cmd === 'scene' ? h('button', { class: 'btn', title: 'Charger les scènes depuis OBS', onclick: async () => {
              const r = await api.obsScenes(); if (!r.ok) return toast(r.err, 'err');
              dl.replaceChildren(...r.scenes.map((n) => h('option', { value: n }))); toast(r.scenes.length + ' scène(s) chargée(s) — clique le champ', 'ok'); inp.focus();
            } }, '⟳ Scènes') : null), dl);
          }
          out.push(h('div', { class: 'hint', style: { marginTop: '6px' } }, 'OBS : Outils → Paramètres du serveur WebSocket (activer). Renseigne le mot de passe dans Réglages.'));
          break;
        }
        case 'wol':
          out.push(h('div', { style: gap }, textInput(action.mac, (v) => set({ mac: v.toUpperCase() }), 'Adresse MAC : AA:BB:CC:DD:EE:FF')),
            h('div', { style: gap }, textInput(action.ip, (v) => set({ ip: v }), 'Broadcast (facultatif) : 192.168.1.255')),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Un PC endormi n’écoute pas : l’ordre doit venir d’une machine toujours allumée qui fait tourner DeckLan (voir « npm run headless »).'));
          break;
        case 'http': {
          out.push(h('div', { class: 'row', style: gap }, select([['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['DELETE', 'DELETE']], action.method || 'GET', (v) => { set({ method: v }); rebuild(); }), textInput(action.url, (v) => set({ url: v.trim() }), 'http://192.168.1.50/api/…')));
          if ((action.method || 'GET') !== 'GET') out.push(h('textarea', { style: gap, placeholder: 'Corps de la requête (facultatif)', oninput: (e) => set({ body: e.target.value }) }, action.body || ''),
            h('label', { class: 'row', style: gap }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!action.json, onchange: (e) => set({ json: e.target.checked }) }), h('span')), 'Envoyer comme JSON'));
          out.push(h('textarea', { style: gap, rows: 2, placeholder: 'En-têtes (facultatif), un par ligne :\nAuthorization: Bearer ton-jeton', oninput: (e) => set({ headers: e.target.value }) }, action.headers || ''));
          out.push(h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Envoyée par le PC : Home Assistant, Shelly, IFTTT, Discord/Slack webhooks, API locales… Réponse non lue ; une erreur HTTP s’affiche. Variables : {date} {time} {datetime} {clipboard}.'));
          break;
        }
        case 'mouse': {
          const sc = action.mode === 'scrollup' || action.mode === 'scrolldown';
          out.push(h('div', { style: gap }, select([['click', 'Clic gauche'], ['double', 'Double-clic'], ['right', 'Clic droit'], ['middle', 'Clic milieu'], ['move', 'Déplacer seulement'], ['scrollup', 'Molette vers le haut'], ['scrolldown', 'Molette vers le bas']], action.mode, (v) => { set({ mode: v }); rebuild(); })));
          out.push(h('label', { class: 'row', style: gap }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!action.current, onchange: (e) => { set({ current: e.target.checked }); rebuild(); } }), h('span')), 'À la position actuelle du curseur'));
          if (!action.current) {
            const xi = h('input', { type: 'number', min: 0, max: 20000, style: { width: '90px' }, value: action.x, oninput: (e) => set({ x: Math.max(0, +e.target.value || 0) }) });
            const yi = h('input', { type: 'number', min: 0, max: 20000, style: { width: '90px' }, value: action.y, oninput: (e) => set({ y: Math.max(0, +e.target.value || 0) }) });
            out.push(h('div', { class: 'row', style: gap }, h('span', { class: 'hint' }, 'X'), xi, h('span', { class: 'hint' }, 'Y'), yi,
              h('button', { class: 'btn sm', onclick: async () => { toast('Place le curseur où tu veux : lecture dans 3 s…'); const r = await api.mousePos(); if (!r.ok) return toast(r.err, 'err'); xi.value = r.x; yi.value = r.y; set({ x: r.x, y: r.y }); toast(`Position ${r.x}, ${r.y} enregistrée`, 'ok'); } }, '🎯 Capturer (3 s)')));
          }
          if (sc) out.push(h('div', { class: 'row', style: gap }, h('input', { type: 'number', min: 1, max: 20, style: { width: '70px' }, value: action.amount || 3, oninput: (e) => set({ amount: Math.max(1, Math.min(20, +e.target.value || 3)) }) }), h('span', { class: 'hint' }, 'crans')));
          out.push(h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Coordonnées en pixels depuis le coin haut-gauche de l’écran principal. Une position fixe dépend de la résolution et de l’agencement de tes écrans.'));
          break;
        }
        case 'appvolume': {
          out.push(h('div', { style: gap }, textInput(action.process, (v) => set({ process: v.replace(/\.exe$/i, '') }), 'Processus : spotify, chrome, discord, vlc…')));
          out.push(h('div', { style: gap }, select([['toggle', 'Basculer muet / actif'], ['mute', 'Couper'], ['unmute', 'Réactiver'], ['up', 'Volume +'], ['down', 'Volume −'], ['set', 'Régler à une valeur']], action.mode, (v) => { set({ mode: v }); rebuild(); })));
          if (['up', 'down', 'set'].includes(action.mode)) out.push(h('div', { class: 'row', style: gap }, h('input', { type: 'number', min: 0, max: 100, style: { width: '80px' }, value: action.value, oninput: (e) => set({ value: Math.max(0, Math.min(100, +e.target.value || 0)) }) }), h('span', { class: 'hint' }, action.mode === 'set' ? '% (0 à 100)' : '% par appui')));
          out.push(h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Nom du processus tel que dans le Gestionnaire des tâches, sans .exe. L’appli doit jouer un son pour avoir une session audio.'));
          break;
        }
        case 'power':
          out.push(h('div', { style: gap }, select([['lock', '🔒 Verrouiller la session'], ['sleep', '🌙 Mettre en veille'], ['hibernate', '🛏 Hibernation'], ['restart', '🔄 Redémarrer (5 s)'], ['shutdown', '⏻ Éteindre (5 s)'], ['logoff', '🚪 Fermer la session']], action.what, (v) => set({ what: v }))),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Arrêt, redémarrage et déconnexion demandent une confirmation sur le téléphone par défaut. Annulation possible pendant 5 s avec la commande « shutdown /a ».'));
          break;
        case 'profile': {
          const opts = [['', '— choisir —'], ...cfg.profiles.map((x) => [x.id, x.name])];
          out.push(h('div', { style: gap }, select(opts, action.profileId || '', (v) => set({ profileId: v }))),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Bascule tout le téléphone sur ce profil (ses pages). Ajoute un bouton « retour » dans l’autre profil.'));
          break;
        }
        case 'wait':
          out.push(h('div', { class: 'row', style: gap }, h('input', { type: 'number', min: 0, max: 60000, step: 100, value: action.ms, oninput: (e) => set({ ms: Math.max(0, Math.min(60000, +e.target.value || 0)) }) }), h('span', { class: 'hint' }, 'millisecondes')));
          break;
        case 'page': {
          const opts = [['__back', '↩ Retour (page précédente)'], ['__home', '🏠 Accueil'], ...cfg.pages.filter((x) => x.id !== page().id).map((x) => [x.id, (x.hidden ? '📁 ' : '') + x.name])];
          if (!opts.some(([v]) => v === action.pageId)) action.pageId = '__back';
          out.push(h('div', { style: gap }, select(opts, action.pageId, (v) => set({ pageId: v }))));
          break;
        }
        case 'multi': {
          const list = h('div', { style: gap });
          action.steps.forEach((s, i) => {
            const ed = actionEditor(s, () => onChange(action), { nested: true });
            const head = h('div', { class: 'head' }, h('span', { class: 'hint' }, i + 1 + '.'), ed.firstChild, h('button', { class: 'x', title: 'Retirer', onclick: () => { action.steps.splice(i, 1); onChange(action); rebuild(); } }, '✕'));
            const rest = Array.from(ed.children).slice(1);
            list.append(h('div', { class: 'sub' }, head, ...rest));
          });
          const recBtn = h('button', { class: 'btn sm' + (recording ? ' primary rec' : ''), onclick: () => {
            if (recording) { recording.stop(); return; }
            recording = startMacro(action, () => { recording = null; onChange(action); rebuild(); });
            recBtn.textContent = '⏹ Arrêter l’enregistrement'; recBtn.classList.add('primary', 'rec'); toast('Tape ta séquence au clavier, puis arrête', 'ok');
          } }, recording ? '⏹ Arrêter l’enregistrement' : '⏺ Enregistrer au clavier');
          if (!nested) out.push(h('div', { class: 'row', style: gap }, h('span', { class: 'hint' }, 'Répéter l’enchaînement'), h('input', { type: 'number', min: 1, max: 20, style: { width: '70px' }, value: action.times || 1, oninput: (e) => set({ times: Math.max(1, Math.min(20, +e.target.value || 1)) }) }), h('span', { class: 'hint' }, 'fois')));
          out.push(list, h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn sm', onclick: () => { if (action.steps.length >= 60) return; action.steps.push(defaults.hotkey()); onChange(action); rebuild(); } }, '＋ Ajouter une étape'), recBtn),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'L’enregistreur capte les touches tapées dans cette fenêtre (texte, raccourcis, pauses). Les clics souris ne sont pas enregistrés.'),
            h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Astuce : insère « Attendre » entre deux étapes pour laisser une appli s’ouvrir.'));
          break;
        }
        default:
          out.push(h('div', { class: 'hint', style: gap }, 'Ce bouton ne fait rien (utile comme séparateur ou étiquette).'));
      }
      return out;
    };
    rebuild();
    return box;
  }

  // Enregistre les frappes clavier (dans la fenêtre) en étapes : texte, raccourcis, pauses > 0,5 s.
  function startMacro(action, done) {
    const steps = []; let last = 0, text = '';
    const flushText = () => { if (text) { steps.push({ type: 'text', text, enter: false }); text = ''; } };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const now = Date.now();
      if (last && now - last > 500) { flushText(); steps.push({ type: 'wait', ms: Math.min(60000, Math.round((now - last) / 100) * 100) }); }
      last = now;
      const mods = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'win'].filter(Boolean);
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) { text += e.key; return; } // texte (Maj donne la majuscule)
      const k = keyName(e); if (!k) return;
      flushText(); steps.push({ type: 'hotkey', keys: [...mods, k].join('+') });
    };
    window.addEventListener('keydown', onKey, true);
    return { stop: () => {
      window.removeEventListener('keydown', onKey, true); flushText();
      while (steps.length && steps[steps.length - 1].type === 'wait') steps.pop();
      action.steps.push(...steps.slice(0, Math.max(0, 60 - action.steps.length)));
      toast(steps.length + ' étape(s) enregistrée(s)', 'ok'); done();
    } };
  }

  function keyName(e) {
    const c = e.code;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad\d$/.test(c)) return 'num' + c.slice(6);
    if (/^F\d{1,2}$/.test(c)) return c.toLowerCase();
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'", Semicolon: ';', PrintScreen: 'printscreen', ContextMenu: 'menu', Pause: 'pause' };
    return map[c] || null;
  }

  // ================= CONNEXION =================
  function deviceName(ua) { return /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad' : 'Navigateur'; }
  let qrMode = 'web';
  function renderConnect() {
    const s = status;
    const fw = `netsh advfirewall firewall add rule name="DeckLan" dir=in action=allow protocol=TCP localport=${s.port || cfg.settings.port}`;
    $('#view').replaceChildren(h('div', { class: 'page' },
      h('h1', {}, 'Connexion du téléphone'), h('div', { class: 'sub-t' }, 'Le téléphone et le PC doivent être sur le même Wi-Fi / réseau local.'),
      s.error ? h('div', { class: 'alert' }, '⚠ ' + s.error) : null,
      h('div', { class: 'cols2' },
        h('div', { class: 'card' },
          h('div', { class: 'seg' },
            h('button', { class: qrMode === 'web' ? 'on' : '', onclick: () => { qrMode = 'web'; renderConnect(); } }, 'Navigateur'),
            h('button', { class: qrMode === 'app' ? 'on' : '', onclick: () => { qrMode = 'app'; renderConnect(); } }, 'Application DeckLan')),
          (qrMode === 'app' ? s.qrApp : s.qr) ? h('div', { class: 'qrbox' }, h('img', { src: qrMode === 'app' ? s.qrApp : s.qr, alt: 'QR code' })) : h('div', { class: 'qrbox off' }, 'Serveur arrêté — pas de QR code.'),
          s.ips.length > 1 ? field('Adresse du PC (carte réseau)', select(s.ips.map((x) => [x.ip, `${x.ip}  ·  ${x.name}`]), s.ip, (v) => api.setIp(v))) : null,
          field('Adresse à ouvrir sur le téléphone', h('div', { class: 'urlrow' }, h('input', { type: 'text', readonly: true, value: s.url || '' }), h('button', { class: 'btn', disabled: !s.url, onclick: () => { api.copy(s.url); toast('Lien copié', 'ok'); } }, 'Copier'))),
          s.nameUrl ? field('Adresse fixe (nom .local)', h('div', { class: 'urlrow' }, h('input', { type: 'text', readonly: true, value: s.nameUrl }), h('button', { class: 'btn', onclick: () => { api.copy(s.nameUrl); toast('Lien copié', 'ok'); } }, 'Copier')),
            h('div', { class: 'hint' }, 'Ne change pas quand l’IP du PC change. Si le téléphone ne la résout pas, utilise l’adresse IP ci-dessus.')) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !s.url, onclick: () => api.openPhone() }, 'Tester dans le navigateur du PC'),
            h('button', { class: 'btn danger', onclick: async () => { if (!confirm('Régénérer le code ? Les téléphones déjà liés devront rescanner le QR code.')) return; cfg = await api.regenToken(); toast('Nouveau code généré', 'ok'); } }, 'Régénérer le code'))),
        h('div', {},
          h('ol', { class: 'steps' },
            h('li', {}, h('div', {}, h('b', {}, 'Scanne le QR code'), h('div', { class: 'hint' }, 'Onglet « Application DeckLan » : l’appareil photo ouvre l’app installée. Onglet « Navigateur » : ouvre le lien dans Chrome.'))),
            h('li', {}, h('div', {}, h('b', {}, 'Ouvre le lien dans Chrome'), h('div', { class: 'hint' }, 'Le téléphone est appairé : plus besoin de rescanner ensuite (adresse enregistrée dans le navigateur).'))),
            h('li', {}, h('div', {}, h('b', {}, 'Mets en plein écran'), h('div', { class: 'hint' }, 'Bouton ⛶ en haut à droite. Pour un raccourci : menu ⋮ de Chrome → « Ajouter à l’écran d’accueil ».')))),
          h('div', { class: 'lbl', style: { marginBottom: '8px' } }, `Appareils connectés (${s.clients.length})`),
          s.clients.length ? s.clients.map((c) => h('div', { class: 'dev' }, h('span', { class: 'ic' }, '📱'), h('div', {}, h('b', {}, deviceName(c.ua)), h('div', { class: 'hint' }, c.ip + ' · depuis ' + new Date(c.since).toLocaleTimeString('fr-FR'))))) : h('div', { class: 'hint' }, 'Aucun appareil pour l’instant.'),
          h('details', {}, h('summary', {}, 'Le téléphone n’arrive pas à se connecter ?'),
            h('p', { class: 'hint' }, 'Au premier lancement, Windows demande d’autoriser DeckLan sur les réseaux privés : accepte. Sinon, ouvre un terminal en administrateur et lance :'),
            h('div', { class: 'row' }, h('span', { class: 'code' }, fw), h('button', { class: 'btn sm', onclick: () => { api.copy(fw); toast('Commande copiée', 'ok'); } }, 'Copier')),
            h('p', { class: 'hint' }, 'Vérifie aussi que le Wi-Fi n’isole pas les appareils (« isolation AP / invité ») et que le réseau Windows est en « Privé ».'))))));
  }

  // ================= RÉGLAGES =================
  // ---------- planning : un bouton lancé automatiquement à heure fixe ----------
  const DAYS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
  function allButtons() {
    const out = [];
    for (const p of cfg.pages) for (const b of p.buttons) if (!b.widget) out.push([p.id + '|' + b.id, `${p.name} › ${b.label || b.id}`]);
    return out;
  }
  function renderPlanning() {
    if (!cfg.schedules) cfg.schedules = [];
    const btns = allButtons();
    const rows = cfg.schedules.map((x, i) => h('div', { class: 'card sched', style: { marginBottom: '12px' } },
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '12px' } },
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: x.on, onchange: (e) => { x.on = e.target.checked; save(); } }), h('span')),
        h('input', { type: 'text', value: x.name, style: { width: '170px' }, oninput: (e) => { x.name = e.target.value.slice(0, 40); save(); } }),
        h('input', { type: 'time', value: x.time, onchange: (e) => { if (e.target.value) { x.time = e.target.value; save(); } } }),
        h('div', { class: 'days' }, DAYS.map(([d, l]) => h('button', { class: 'day' + (x.days.includes(d) ? ' on' : ''), onclick: (e) => {
          x.days = x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d].sort();
          if (!x.days.length) x.days = [d];
          save(); renderPlanning();
        } }, l))),
        select([['|', '— choisir un bouton —'], ...btns], x.page + '|' + x.btn, (v) => { const [pg, bt] = v.split('|'); x.page = pg; x.btn = bt; save(); }),
        h('button', { class: 'btn sm danger', onclick: () => { cfg.schedules.splice(i, 1); save(); renderPlanning(); } }, 'Supprimer'))));
    $('#view').replaceChildren(h('div', { class: 'page' },
      h('h1', {}, 'Planning'), h('div', { class: 'sub-t' }, 'Lance un bouton à heure fixe : ouvrir une appli le matin, couper le micro, allumer une lumière… Le PC doit être allumé et DeckLan lancé.'),
      h('div', { style: { maxWidth: '900px' } }, ...rows,
        h('button', { class: 'btn primary', onclick: () => {
          if (cfg.schedules.length >= 30) return toast('30 entrées maximum', 'err');
          cfg.schedules.push({ id: rid('s_'), name: 'Planning', time: '09:00', days: [1, 2, 3, 4, 5], page: '', btn: '', on: true }); save(); renderPlanning();
        } }, '＋ Ajouter une heure'),
        h('div', { class: 'hint', style: { marginTop: '12px' } }, 'Le planning suit le profil actif : si le bouton n’existe plus (autre profil, supprimé), l’entrée est ignorée. Les boutons à confirmation s’exécutent sans demande.'))));
  }

  // ---------- journal : derniers appuis et erreurs (en mémoire, effacé à la fermeture) ----------
  let logRows = [];
  const fmtT = (t) => new Date(t).toLocaleTimeString('fr-FR');
  function drawLog() {
    const box = $('#logbox'); if (!box) return;
    box.replaceChildren(...(logRows.length ? logRows.slice().reverse().map((e) => h('div', { class: 'logrow ' + e.kind }, h('span', { class: 'lt' }, fmtT(e.t)), h('span', { class: 'lk' }, e.kind === 'err' ? '⚠' : '▶'), h('span', {}, e.text))) : [h('div', { class: 'hint' }, 'Rien pour l’instant : appuie sur un bouton du téléphone.')]));
  }
  async function renderJournal() {
    logRows = await api.getLog();
    $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Journal'), h('div', { class: 'sub-t' }, 'Les 100 derniers appuis et erreurs. Utile pour comprendre pourquoi un bouton ne fait rien.'),
      h('div', { class: 'card', id: 'logbox', style: { maxWidth: '900px' } })));
    drawLog();
  }
  api.onLog((e) => { logRows.push(e); if (logRows.length > 100) logRows.shift(); if (view === 'journal') drawLog(); });

  function renderSettings() {
    const s = cfg.settings;
    const sw = (key, onch) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s[key], onchange: (e) => { s[key] = e.target.checked; save(); if (onch) onch(); } }), h('span'));
    const row = (t, d, ctrl) => h('div', { class: 'setrow' }, h('div', {}, h('div', { class: 't' }, t), h('div', { class: 'd' }, d)), ctrl);
    $('#view').replaceChildren(h('div', { class: 'page' },
      h('h1', {}, 'Réglages'), h('div', { class: 'sub-t' }, 'Tout est enregistré automatiquement.'),
      h('div', { class: 'card', style: { maxWidth: '760px' } },
        row('Port du serveur', 'Change-le si un autre programme utilise déjà ce port. Les téléphones doivent rescanner le QR code.',
          h('input', { type: 'number', min: 1024, max: 65535, value: s.port, onchange: (e) => { s.port = Math.max(1024, Math.min(65535, +e.target.value || 8765)); e.target.value = s.port; save(); toast('Port appliqué — rescanne le QR code', 'ok'); } })),
        row('Couleur d’accent', 'Appliquée à l’application et au téléphone.', h('input', { type: 'color', value: s.accent, oninput: (e) => { s.accent = e.target.value; applyAccent(); save(); } })),
        row('Vibration sur le téléphone', 'Léger retour haptique à chaque appui.', sw('vibrate')),
        row('Langue du téléphone', 'Boutons, messages et dates sur le téléphone. L’application PC reste en français.', select([['fr', 'Français'], ['en', 'English']], s.lang || 'fr', (v) => { s.lang = v; save(); })),
        row('Profil propre à chaque téléphone', 'Activé : un changement de profil sur un téléphone ne touche pas les autres (chacun garde son profil tant que le PC tourne). Désactivé : tout le monde suit le profil actif.', sw('perPhoneProfiles')),
        row('HTTPS (certificat auto-signé)', 'Chiffre le trafic sur le Wi-Fi et active l’écran toujours allumé du navigateur. Le téléphone affichera un avertissement au premier accès : accepte-le. Rescanne le QR code.', sw('https', () => toast('HTTPS appliqué — rescanne le QR code', 'ok'))),
        row('Ville pour le widget météo', 'Open-Meteo, sans clé. Ex : Cavaillon', h('input', { type: 'text', style: { width: '170px' }, value: s.weatherCity || '', onchange: (e) => { s.weatherCity = e.target.value.trim(); save(); toast('Ville enregistrée', 'ok'); } })),
        row('Mises à jour', 'Dépôt GitHub des releases (utilisateur/depot). Vérifie au démarrage et à la demande ; ouvre la page de téléchargement.', h('div', { class: 'row' }, h('input', { type: 'text', style: { width: '170px' }, value: s.updateRepo || '', placeholder: 'utilisateur/depot', onchange: (e) => { s.updateRepo = e.target.value.trim(); save(); } }),
          h('button', { class: 'btn', onclick: async () => { const r = await api.checkUpdate(); toast(!r.ok ? r.err : r.newer ? `Nouvelle version ${r.latest} (actuelle ${r.current}) : page de téléchargement ouverte` : `À jour (${r.current})`, r.ok ? 'ok' : 'err'); } }, 'Vérifier'))),
        row('Clic sonore sur le téléphone', 'Petit bip à chaque appui (en plus de la vibration).', sw('sound')),
        row('Code PIN du téléphone', s.pinHash ? '🔒 Actif : le téléphone demande le code à la connexion et après la veille. Le PC le vérifie ; 5 essais puis 30 s de pause.' : 'Optionnel : 4 à 8 chiffres. Protège l’accès aux boutons si quelqu’un prend ton téléphone.',
          h('div', { class: 'row' }, h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, style: { width: '110px' }, placeholder: s.pinHash ? '••••' : '4 à 8 chiffres', id: 'pinInput' }),
            h('button', { class: 'btn', onclick: () => {
              const v = $('#pinInput').value;
              if (!/^\d{4,8}$/.test(v)) return toast('Le code doit faire 4 à 8 chiffres', 'err');
              api.saveConfig({ ...cfg, settings: { ...cfg.settings, pin: v } }).then((r) => { cfg.settings = r.settings; toast('Code PIN enregistré', 'ok'); renderSettings(); });
            } }, 'Définir'),
            s.pinHash ? h('button', { class: 'btn danger', onclick: () => api.saveConfig({ ...cfg, settings: { ...cfg.settings, pin: '' } }).then((r) => { cfg.settings = r.settings; toast('Code PIN retiré', 'ok'); renderSettings(); }) }, 'Retirer') : null)),
        row('Veille de l’écran du téléphone', 'Écran noir avec l’horloge après inactivité. Un toucher réveille, sans rien envoyer au PC.',
          select([['0', 'Jamais'], ['1', '1 minute'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes']], String(s.idle), (v) => { s.idle = +v; save(); })),
        row('Adresse fixe « nom.local » (mDNS)', 'Le téléphone retrouve le PC par son nom même si l’IP change. Fonctionne sur la plupart des téléphones récents ; garde l’IP en secours.', sw('mdns')),
        row('Nom sur le réseau', 'Lettres, chiffres et tirets. Rescanner le QR code après changement.', h('div', { class: 'row' }, h('input', { type: 'text', style: { width: '130px' }, value: s.hostname, onchange: (e) => { s.hostname = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'decklan'; e.target.value = s.hostname; save(); toast('Nom appliqué — rescanne le QR code', 'ok'); } }), h('span', { class: 'hint' }, '.local'))),
        row('Le QR code utilise', 'L’IP est la plus sûre. « nom.local » survit aux changements d’IP du routeur.', select([['ip', 'Adresse IP'], ['mdns', 'Nom .local']], s.qrHost, (v) => { s.qrHost = v; save(); toast('QR code mis à jour', 'ok'); })),
        row('OBS Studio (WebSocket)', status.obs && status.obs.enabled ? (status.obs.connected ? '🟢 Connecté à OBS' : '🟠 Activé, OBS injoignable (lancé ? serveur WebSocket activé ? mot de passe ?)') : 'Dans OBS : Outils → Paramètres du serveur WebSocket → Activer. Port 4455 par défaut.', sw('obsEnabled', () => setTimeout(() => api.getState().then((st) => { status = st.status; if (view === 'settings') renderSettings(); }), 1500))),
        h('div', { class: 'setrow' }, h('div', { class: 't' }, 'Serveur OBS'), h('div', { class: 'row' },
          h('input', { type: 'text', style: { width: '120px' }, value: s.obsHost, placeholder: 'localhost', onchange: (e) => { s.obsHost = e.target.value.trim() || 'localhost'; save(); } }),
          h('input', { type: 'number', style: { width: '80px' }, value: s.obsPort, min: 1, max: 65535, onchange: (e) => { s.obsPort = Math.max(1, Math.min(65535, +e.target.value || 4455)); save(); } }),
          h('input', { type: 'password', style: { width: '140px' }, value: s.obsPassword, placeholder: 'mot de passe', onchange: (e) => { s.obsPassword = e.target.value; save(); } }))),
        row('Lancer avec Windows', 'DeckLan démarre en arrière-plan à l’ouverture de session.', sw('autostart')),
        row('Réduire dans la zone de notification', 'Fermer la fenêtre garde le serveur actif (icône près de l’horloge).', sw('minimizeToTray')),
        row('Démarrer réduit', 'N’affiche pas la fenêtre au lancement.', sw('startHidden')),
        row('Sauvegarde', 'Exporte ou importe pages et boutons (le code d’appairage n’est pas inclus).', h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => { if (await api.exportConfig()) toast('Configuration exportée', 'ok'); } }, 'Exporter'),
          h('button', { class: 'btn', onclick: async () => {
            const r = await api.importConfig(); if (!r) return;
            if (r.error) return toast('Import impossible : ' + r.error, 'err');
            cfg = r; pi = 0; selId = null; applyAccent(); render(); toast('Configuration importée', 'ok');
          } }, 'Importer'))))));
  }

  render();
})();
