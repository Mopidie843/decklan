'use strict';
// Config persistante : profils > pages > boutons, réglages. Écriture atomique + validation stricte.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanShortcut } = require('./shortcuts');

const uid = (p) => p + crypto.randomBytes(4).toString('hex');
const newToken = () => crypto.randomBytes(9).toString('base64url');

const ACTION_TYPES = ['none', 'hotkey', 'text', 'open', 'command', 'media', 'page', 'multi', 'wait', 'audio', 'obs', 'wol', 'profile', 'http', 'power', 'mouse', 'appvolume'];
const WIDGETS = ['', 'clock', 'date', 'cpu', 'ram', 'volume', 'stopwatch', 'timer', 'brightness', 'weather', 'nowplaying'];
const MOUSE_MODES = ['click', 'double', 'right', 'middle', 'move', 'scrollup', 'scrolldown'];
const APPVOL_MODES = ['toggle', 'mute', 'unmute', 'up', 'down', 'set'];
const LANGS = ['fr', 'en'];
const BAD_HEADERS = ['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'expect'];
const POWER = ['lock', 'sleep', 'hibernate', 'shutdown', 'restart', 'logoff'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const BINDS = ['', 'mic', 'mute', 'obsrec', 'obsstream'];
const MEDIA_KEYS = ['playpause', 'next', 'prev', 'stop', 'volup', 'voldown', 'mute'];
const OBS_CMDS = ['scene', 'toggleRecord', 'startRecord', 'stopRecord', 'toggleStream', 'startStream', 'stopStream', 'toggleMute'];
const IDLES = [0, 1, 2, 5, 10];

const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const int = (v, lo, hi, d) => { const n = Number.isFinite(+v) ? Math.round(+v) : d; return Math.min(hi, Math.max(lo, n)); };
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const hostName = (v, d) => { const s = String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30); return s || d; };

function defaultConfig() {
  const b = (id, row, col, label, icon, bg, action, extra = {}) => ({ id, row, col, label, icon, bg, fg: '#ffffff', action, ...extra });
  return {
    version: 2,
    settings: {
      port: 8765, token: newToken(), vibrate: true, idle: 2, accent: '#7c5cff',
      autostart: false, minimizeToTray: true, startHidden: false,
      mdns: true, hostname: 'decklan', qrHost: 'ip', sound: false, pinHash: '', pinSalt: '', https: false, perPhoneProfiles: false, lang: 'fr', weatherCity: '', updateRepo: '',
      obsEnabled: false, obsHost: 'localhost', obsPort: 4455, obsPassword: '',
    },
    profile: { id: 'main', name: 'Principal' },
    profiles: [],
    schedules: [],
    pages: [
      {
        id: 'home', name: 'Accueil', cols: 4, rows: 3, hidden: false, app: '',
        buttons: [
          b('b_play', 0, 0, 'Lecture', '⏯️', '#7c5cff', { type: 'media', key: 'playpause' }),
          b('b_prev', 0, 1, 'Précédent', '⏮️', '#2b2f45', { type: 'media', key: 'prev' }),
          b('b_next', 0, 2, 'Suivant', '⏭️', '#2b2f45', { type: 'media', key: 'next' }),
          b('b_mute', 0, 3, 'Muet', '🔇', '#e5484d', { type: 'media', key: 'mute' }),
          b('b_vdn', 1, 0, 'Vol -', '🔉', '#2b2f45', { type: 'media', key: 'voldown' }, { repeat: true }),
          b('b_vup', 1, 1, 'Vol +', '🔊', '#2b2f45', { type: 'media', key: 'volup' }, { repeat: true }),
          b('b_shot', 1, 2, 'Capture', '📸', '#0ea5a4', { type: 'hotkey', keys: 'win+shift+s' }),
          b('b_desk', 1, 3, 'Bureau', '🖥️', '#2b2f45', { type: 'hotkey', keys: 'win+d' }),
          b('b_web', 2, 0, 'Navigateur', '🌐', '#2563eb', { type: 'open', target: 'https://www.google.com' }),
          b('b_lock', 2, 1, 'Verrouiller', '🔒', '#f59e0b', { type: 'hotkey', keys: 'win+l' }),
          b('b_clock', 2, 2, '', '', '#111218', { type: 'none' }, { widget: 'clock' }),
          b('b_tools', 2, 3, 'Outils', '🧰', '#8b5cf6', { type: 'page', pageId: 'tools' }),
        ],
      },
      {
        id: 'tools', name: 'Outils', cols: 4, rows: 3, hidden: true, app: '',
        buttons: [
          b('t_back', 0, 0, 'Retour', '⬅️', '#2b2f45', { type: 'page', pageId: '__back' }),
          b('t_calc', 0, 1, 'Calculatrice', '🧮', '#2b2f45', { type: 'open', target: 'calc' }),
          b('t_expl', 0, 2, 'Explorateur', '📁', '#f59e0b', { type: 'hotkey', keys: 'win+e' }),
          b('t_task', 0, 3, 'Tâches', '📊', '#2b2f45', { type: 'hotkey', keys: 'ctrl+shift+esc' }),
          b('t_copy', 1, 0, 'Copier', '📋', '#2b2f45', { type: 'hotkey', keys: 'ctrl+c' }),
          b('t_paste', 1, 1, 'Coller', '📥', '#2b2f45', { type: 'hotkey', keys: 'ctrl+v' }),
          b('t_undo', 1, 2, 'Annuler', '↩️', '#2b2f45', { type: 'hotkey', keys: 'ctrl+z' }),
        ],
      },
    ],
  };
}

// En-têtes HTTP : « Nom: valeur », une par ligne (10 max), sans retour chariot ni en-tête dangereux.
function cleanHeaders(v) {
  const out = [];
  for (const line of String(typeof v === 'string' ? v : '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9-]{1,40})\s*:\s*(.{0,300})$/.exec(line);
    if (!m || BAD_HEADERS.includes(m[1].toLowerCase())) continue;
    out.push(m[1] + ': ' + m[2].replace(/[\u0000-\u001f\u007f]/g, '').trim());
    if (out.length >= 10) break;
  }
  return out.join('\n');
}

function cleanAction(a, depth = 0) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) return { type: 'none' };
  switch (a.type) {
    case 'hotkey': return { type: 'hotkey', keys: str(a.keys, 80) };
    case 'text': return { type: 'text', text: str(a.text, 2000), enter: !!a.enter };
    case 'open': return { type: 'open', target: str(a.target, 1000) };
    case 'command': return { type: 'command', cmd: str(a.cmd, 1000) };
    case 'media': return { type: 'media', key: MEDIA_KEYS.includes(a.key) ? a.key : 'playpause' };
    case 'page': return { type: 'page', pageId: str(a.pageId, 40) };
    case 'profile': return { type: 'profile', profileId: str(a.profileId, 40) };
    case 'wait': return { type: 'wait', ms: int(a.ms, 0, 60000, 500) };
    case 'audio': return { type: 'audio', what: a.what === 'speaker' ? 'speaker' : 'mic', mode: ['toggle', 'mute', 'unmute'].includes(a.mode) ? a.mode : 'toggle' };
    case 'obs': return { type: 'obs', cmd: OBS_CMDS.includes(a.cmd) ? a.cmd : 'toggleRecord', name: str(a.name, 120) };
    case 'wol': return { type: 'wol', mac: str(a.mac, 17).toUpperCase(), ip: str(a.ip, 45) };
    case 'http': {
      const url = str(a.url, 1000).trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return { type: 'none' };
      return { type: 'http', url, method: HTTP_METHODS.includes(a.method) ? a.method : 'GET', body: str(a.body, 2000), json: !!a.json, headers: cleanHeaders(a.headers) };
    }
    case 'mouse': return { type: 'mouse', mode: MOUSE_MODES.includes(a.mode) ? a.mode : 'click', x: int(a.x, 0, 20000, 0), y: int(a.y, 0, 20000, 0), current: typeof a.current === 'boolean' ? a.current : !('x' in a), amount: int(a.amount, 1, 20, 3) };
    case 'appvolume': return { type: 'appvolume', process: str(a.process, 60).replace(/\.exe$/i, '').replace(/[^\w .-]/g, '').trim(), mode: APPVOL_MODES.includes(a.mode) ? a.mode : 'toggle', value: int(a.value, 0, 100, 10) };
    case 'power': return { type: 'power', what: POWER.includes(a.what) ? a.what : 'lock' };
    case 'multi': {
      if (depth > 0) return { type: 'none' };
      const steps = Array.isArray(a.steps) ? a.steps.slice(0, 60).map((s) => cleanAction(s, depth + 1)) : [];
      return { type: 'multi', steps, times: int(a.times, 1, 20, 1) };
    }
    default: return { type: 'none' };
  }
}

function cleanFace(b) {
  const image = typeof b.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image) && b.image.length <= 90000 ? b.image : '';
  const icon = typeof b.icon === 'string' && /^lucide:[a-z0-9-]{1,40}$/.test(b.icon) ? b.icon : str(b.icon, 16);
  return { label: str(b.label, 40), icon, image, bg: color(b.bg, '#2b2f45'), fg: color(b.fg, '#ffffff') };
}

function sanitizePages(pages) {
  const out = [];
  const seenP = new Set();
  for (const p of Array.isArray(pages) ? pages.slice(0, 20) : []) {
    let id = str(p && p.id, 40) || uid('p_');
    if (seenP.has(id)) id = uid('p_');
    seenP.add(id);
    const cols = int(p && p.cols, 1, 8, 4);
    const rows = int(p && p.rows, 1, 8, 3);
    const taken = new Set();
    const seenB = new Set();
    const buttons = [];
    for (const b of Array.isArray(p && p.buttons) ? p.buttons.slice(0, 64) : []) {
      if (!b) continue;
      const row = int(b.row, 0, rows - 1, 0);
      const col = int(b.col, 0, cols - 1, 0);
      let w = int(b.w, 1, 4, 1);
      w = Math.min(w, cols - col);
      let ok = true;
      for (let k = 0; k < w; k++) if (taken.has(row + ',' + (col + k))) { if (k === 0) ok = false; else { w = k; break; } }
      if (!ok) continue;
      for (let k = 0; k < w; k++) taken.add(row + ',' + (col + k));
      let bid = str(b.id, 40) || uid('b_');
      if (seenB.has(bid)) bid = uid('b_');
      seenB.add(bid);
      const btn = {
        id: bid, row, col, w, ...cleanFace(b),
        widget: WIDGETS.includes(b.widget) ? b.widget : '',
        bind: BINDS.includes(b.bind) ? b.bind : '',
        repeat: !!b.repeat,
        confirm: !!b.confirm || (b.action && b.action.type === 'power' && ['shutdown', 'restart', 'logoff'].includes(b.action.what) && b.confirm !== false),
        shortcut: cleanShortcut(b.shortcut),
        timerMin: int(b.timerMin, 1, 180, 5),
        action: cleanAction(b.action), hold: cleanAction(b.hold),
      };
      if (b.alt && typeof b.alt === 'object') btn.alt = { ...cleanFace(b.alt), action: cleanAction(b.alt.action) };
      buttons.push(btn);
    }
    out.push({ id, name: str(p && p.name, 30, 'Page'), cols, rows, hidden: !!(p && p.hidden), app: str(p && p.app, 60).trim().toLowerCase().replace(/\.exe$/, ''), buttons });
  }
  if (out.length && out.every((p) => p.hidden)) out[0].hidden = false;
  return out;
}

const emptyPages = () => [{ id: uid('p_'), name: 'Accueil', cols: 4, rows: 3, hidden: false, app: '', buttons: [] }];

// Code PIN du téléphone : jamais stocké en clair, jamais renvoyé au téléphone.
const hashPin = (pin, salt) => crypto.createHash('sha256').update(salt + ':' + pin).digest('hex');
function pinFields(pin, ps) {
  if (typeof pin === 'string') {
    if (pin === '') return { pinHash: '', pinSalt: '' };
    if (/^\d{4,8}$/.test(pin)) { const salt = crypto.randomBytes(8).toString('hex'); return { pinHash: hashPin(pin, salt), pinSalt: salt }; }
  }
  return { pinHash: typeof ps.pinHash === 'string' ? ps.pinHash : '', pinSalt: typeof ps.pinSalt === 'string' ? ps.pinSalt : '' };
}
const checkPin = (settings, pin) => !!settings.pinHash && /^\d{4,8}$/.test(String(pin)) && hashPin(String(pin), settings.pinSalt) === settings.pinHash;

function cleanSchedules(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 30) : []) {
    if (!x || typeof x !== 'object') continue;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(x.time || ''));
    if (!m) continue;
    const days = [...new Set((Array.isArray(x.days) ? x.days : []).map((d) => +d).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    out.push({ id: str(x.id, 40) || uid('s_'), name: str(x.name, 40, 'Planning'), time: m[0], days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], page: str(x.page, 40), btn: str(x.btn, 40), on: x.on !== false });
  }
  return out;
}

function sanitize(cfg, prev) {
  const d = defaultConfig();
  const s = (cfg && cfg.settings) || {};
  const ps = (prev && prev.settings) || d.settings;
  const pick = (k, fn) => (s[k] !== undefined ? fn(s[k]) : ps[k] !== undefined ? ps[k] : d.settings[k]);
  const out = { version: 2, settings: {}, pages: [], profile: null, profiles: [], schedules: [] };
  out.settings = {
    port: int(s.port, 1024, 65535, ps.port),
    token: typeof ps.token === 'string' && ps.token ? ps.token : newToken(), // le token ne change que via regenToken()
    vibrate: pick('vibrate', Boolean),
    idle: IDLES.includes(+s.idle) ? +s.idle : (IDLES.includes(+ps.idle) ? +ps.idle : 2),
    accent: color(s.accent, ps.accent || d.settings.accent),
    autostart: pick('autostart', Boolean),
    minimizeToTray: pick('minimizeToTray', Boolean),
    startHidden: pick('startHidden', Boolean),
    mdns: pick('mdns', Boolean),
    hostname: hostName(s.hostname !== undefined ? s.hostname : ps.hostname, 'decklan'),
    qrHost: (s.qrHost || ps.qrHost) === 'mdns' ? 'mdns' : 'ip',
    sound: pick('sound', Boolean),
    https: pick('https', Boolean),
    perPhoneProfiles: pick('perPhoneProfiles', Boolean),
    lang: LANGS.includes(s.lang) ? s.lang : (LANGS.includes(ps.lang) ? ps.lang : 'fr'),
    weatherCity: str(s.weatherCity !== undefined ? s.weatherCity : ps.weatherCity, 80, '').trim(),
    updateRepo: /^[\w.-]{1,40}\/[\w.-]{1,80}$/.test(String(s.updateRepo !== undefined ? s.updateRepo : ps.updateRepo || '').trim()) ? String(s.updateRepo !== undefined ? s.updateRepo : ps.updateRepo).trim() : '',
    ...pinFields(s.pin, ps),
    obsEnabled: pick('obsEnabled', Boolean),
    obsHost: str(s.obsHost !== undefined ? s.obsHost : ps.obsHost, 120, 'localhost').trim() || 'localhost',
    obsPort: int(s.obsPort !== undefined ? s.obsPort : ps.obsPort, 1, 65535, 4455),
    obsPassword: str(s.obsPassword !== undefined ? s.obsPassword : ps.obsPassword, 200, ''),
  };
  out.schedules = cleanSchedules(cfg && cfg.schedules !== undefined ? cfg.schedules : prev && prev.schedules);
  out.pages = sanitizePages(cfg && cfg.pages);
  if (!out.pages.length) out.pages = cfg && cfg.pages !== undefined ? emptyPages() : d.pages;
  const pr = (cfg && cfg.profile) || {};
  out.profile = { id: str(pr.id, 40) || 'main', name: str(pr.name, 30, 'Principal') || 'Principal' };
  const seen = new Set([out.profile.id]);
  for (const q of Array.isArray(cfg && cfg.profiles) ? cfg.profiles.slice(0, 15) : []) {
    let id = str(q && q.id, 40) || uid('pr_');
    if (seen.has(id)) id = uid('pr_');
    seen.add(id);
    let pages = sanitizePages(q && q.pages);
    if (!pages.length) pages = emptyPages();
    out.profiles.push({ id, name: str(q && q.name, 30, 'Profil') || 'Profil', pages });
  }
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.config = null;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }
  load() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* premier lancement ou fichier cassé */ }
    this.config = raw ? sanitize(raw, raw) : defaultConfig();
    if (raw) this.backup();
    this.persist();
  }
  // Une copie par jour au démarrage, 7 gardées : filet de sécurité contre une mauvaise manip.
  backup() {
    try {
      const dir = path.join(path.dirname(this.file), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const target = path.join(dir, `config-${day}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(dir).filter((f) => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 7))) fs.unlinkSync(path.join(dir, f));
    } catch { /* sauvegarde best-effort */ }
  }
  persist() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2));
    fs.renameSync(tmp, this.file);
  }
  save(cfg) {
    this.config = sanitize(cfg, this.config);
    this.persist();
    return this.config;
  }
  regenToken() {
    this.config.settings.token = newToken();
    this.persist();
    return this.config;
  }
  // Bascule de profil (depuis le téléphone ou l'éditeur) : l'actif est rangé, le choisi devient actif.
  switchProfile(id) {
    const c = this.config;
    if (id === c.profile.id) return false;
    const i = c.profiles.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const target = c.profiles.splice(i, 1)[0];
    c.profiles.push({ id: c.profile.id, name: c.profile.name, pages: c.pages });
    c.profile = { id: target.id, name: target.name };
    c.pages = target.pages;
    this.persist();
    return true;
  }
  // Pages d'un profil : l'actif par défaut, ou un profil rangé (téléphone avec son propre profil).
  pagesOf(profileId) {
    if (profileId && profileId !== this.config.profile.id) {
      const q = this.config.profiles.find((x) => x.id === profileId);
      if (q) return q.pages;
    }
    return this.config.pages;
  }
  profileName(profileId) {
    const q = profileId && this.config.profiles.find((x) => x.id === profileId);
    return q ? q.name : this.config.profile.name;
  }
  findButton(pageId, btnId, profileId) {
    const p = this.pagesOf(profileId).find((x) => x.id === pageId);
    return p ? p.buttons.find((x) => x.id === btnId) : null;
  }
  // Version envoyée au téléphone : jamais le token ni le mot de passe OBS.
  publicConfig(pcName, profileId) {
    const { settings } = this.config;
    const pages = this.pagesOf(profileId);
    const profile = { name: this.profileName(profileId) };
    return { pcName, profile: profile.name, ui: { vibrate: settings.vibrate, accent: settings.accent, idle: settings.idle, sound: settings.sound, pin: !!settings.pinHash, lang: settings.lang }, pages };
  }
}

module.exports = { Store, sanitize, defaultConfig, uid, checkPin, MEDIA_KEYS, OBS_CMDS, POWER };
