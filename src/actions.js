'use strict';
// Exécute les actions d'un bouton sur le PC. Les téléphones n'envoient QUE des ids de boutons :
// l'action est relue dans la config locale, jamais acceptée depuis le réseau.
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { parseCombo, escapeSendKeys, VK } = require('./keys');
const { sendMagic } = require('./wol');

const POWER_CMDS = {
  lock: 'rundll32.exe user32.dll,LockWorkStation',
  sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
  hibernate: 'shutdown /h',
  shutdown: 'shutdown /s /t 5',
  restart: 'shutdown /r /t 5',
  logoff: 'shutdown /l',
};

// 'N <lecture> <base64 titre\nartiste>' -> { playing, title, artist } ou null si rien ne joue.
function parseNowPlaying(rest) {
  const i = rest.indexOf(' ');
  const playing = rest.slice(0, i) === '1';
  const b64 = rest.slice(i + 1).trim();
  if (!b64) return null;
  const [title, artist] = Buffer.from(b64, 'base64').toString('utf8').split('\n');
  return title || artist ? { playing, title: title || '', artist: artist || '' } : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Actions {
  // deps.shell = shell d'Electron (openExternal/openPath) ; deps.workDir = dossier pour écrire le .ps1
  constructor(deps = {}) {
    this.shell = deps.shell || null;
    this.clipboard = deps.clipboard || null;
    this.workDir = deps.workDir || require('os').tmpdir();
    this.platform = deps.platform || process.platform;
    this.ps = null;
    this.psReady = false;
    this.lastUse = 0;
    this.fgWaiters = [];
    this.audioWaiters = [];
    this.posWaiters = []; this.briWaiters = []; this.npWaiters = []; this.appWaiters = [];
    this._bri = null; this._briT = null;
    this.obs = deps.obs || null;
    this._vol = null; this._volT = null;
    this.keepAlive = false; // true tant qu'un téléphone est connecté
    this._idle = setInterval(() => { if (this.ps && !this.keepAlive && Date.now() - this.lastUse > 120000) this.stop(); }, 30000);
    this._idle.unref();
  }

  _ensureShell() {
    if (this.platform !== 'win32') throw new Error('Simulation clavier : Windows uniquement');
    if (this.ps && !this.ps.killed) return this.ps;
    fs.mkdirSync(this.workDir, { recursive: true });
    const script = path.join(this.workDir, 'keyboard.ps1');
    fs.writeFileSync(script, '﻿' + fs.readFileSync(path.join(__dirname, 'keyboard.ps1'), 'utf8'));
    const ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    ps.stdout.setEncoding('utf8');
    let buf = '';
    ps.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'ready') this.psReady = true;
        else if (line.startsWith('F')) { const w = this.fgWaiters.shift(); if (w) w(line.slice(2).trim().toLowerCase()); }
        else if (line.startsWith('P ')) { const w = this.posWaiters.shift(); if (w) { const [x, y] = line.slice(2).split(' ').map(Number); w({ x, y }); } }
        else if (line.startsWith('B ')) { const w = this.briWaiters.shift(); if (w) { const n = Number(line.slice(2)); w(n >= 0 ? n : null); } }
        else if (line.startsWith('N ')) { const w = this.npWaiters.shift(); if (w) w(parseNowPlaying(line.slice(2))); }
        else if (line.startsWith('V ')) { const w = this.appWaiters.shift(); if (w) w(Number(line.slice(2)) || 0); }
        else if (line.startsWith('A ')) { const w = this.audioWaiters.shift(); if (w) { const [v, sm, mm] = line.slice(2).split(' ').map(Number); w({ vol: v < 0 ? null : Math.round(v * 100), mute: sm === 1 ? 1 : 0, mic: mm === 1 ? 1 : 0 }); } }
      }
    });
    ps.on('exit', () => { if (this.ps === ps) { this.ps = null; this.psReady = false; } });
    ps.on('error', () => { if (this.ps === ps) { this.ps = null; this.psReady = false; } });
    this.ps = ps;
    return ps;
  }

  warmup() { try { this._ensureShell(); } catch { /* hors Windows */ } }

  // Nom du processus au premier plan (sans .exe), '' si inconnu.
  foreground() {
    return new Promise((resolve) => {
      if (this.platform !== 'win32') return resolve('');
      const t = setTimeout(() => { const i = this.fgWaiters.indexOf(done); if (i >= 0) this.fgWaiters.splice(i, 1); resolve(''); }, 1500);
      const done = (v) => { clearTimeout(t); resolve(v); };
      this.fgWaiters.push(done);
      try { this._send('F -'); } catch { done(''); }
    });
  }

  // Volume principal 0..100 ; envois groupés (dernier gagne) pour ne pas saturer PowerShell pendant un glissement.
  setVolume(pct) {
    this._vol = Math.max(0, Math.min(100, Math.round(+pct) || 0));
    if (this._volT) return;
    this._volT = setTimeout(() => { this._volT = null; try { this._send('VS ' + (this._vol / 100)); } catch { /* hors Windows */ } }, 40);
  }

  // { vol, mute, mic } ou null.
  audioState() {
    return new Promise((resolve) => {
      if (this.platform !== 'win32') return resolve(null);
      const t = setTimeout(() => { const i = this.audioWaiters.indexOf(done); if (i >= 0) this.audioWaiters.splice(i, 1); resolve(null); }, 2000);
      const done = (v) => { clearTimeout(t); resolve(v); };
      this.audioWaiters.push(done);
      try { this._send('AG'); } catch { done(null); }
    });
  }

  // Réponse unique à une commande PowerShell ; renvoie fallback après un délai ou hors Windows.
  _ask(cmd, waiters, fallback, ms = 2000) {
    return new Promise((resolve) => {
      if (this.platform !== 'win32') return resolve(fallback);
      const t = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); resolve(fallback); }, ms);
      const done = (v) => { clearTimeout(t); resolve(v); };
      waiters.push(done);
      try { this._send(cmd); } catch { done(fallback); }
    });
  }
  mousePos() { return this._ask('MP', this.posWaiters, null); }
  brightness() { return this._ask('BG', this.briWaiters, null, 4000); }
  nowPlaying() { return this._ask('NP', this.npWaiters, null, 4000); }

  // Luminosité 0..100 de l'écran intégré ; envois groupés (WMI est lent).
  setBrightness(pct) {
    this._bri = Math.max(0, Math.min(100, Math.round(+pct) || 0));
    if (this._briT) return;
    this._briT = setTimeout(() => { this._briT = null; try { this._send('BS ' + this._bri); } catch { /* hors Windows */ } }, 150);
  }

  // Variables des textes et URL : {date} {time} {datetime} {clipboard}. Le presse-papiers n'existe qu'avec Electron.
  _expand(t) {
    const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return String(t).replace(/\{(date|time|datetime|clipboard)\}/g, (_m, k) => {
      if (k === 'date') return date;
      if (k === 'time') return time;
      if (k === 'datetime') return date + ' ' + time;
      try { return this.clipboard ? this.clipboard.readText() : ''; } catch { return ''; }
    });
  }

  stop() { if (this.ps) { try { this.ps.stdin.end(); this.ps.kill(); } catch { /* déjà mort */ } this.ps = null; } }

  _send(line) {
    this.lastUse = Date.now();
    const ps = this._ensureShell();
    ps.stdin.write(line + '\n');
  }

  async run(action, ctx = {}) {
    if (!action || typeof action !== 'object') return;
    switch (action.type) {
      case 'none': case 'page': case 'profile': return;
      case 'wait': await sleep(Math.min(60000, Math.max(0, action.ms | 0))); return;
      case 'hotkey': {
        const codes = parseCombo(action.keys);
        if (!codes) throw new Error('Raccourci invalide : ' + action.keys);
        this._send('K ' + codes.join(','));
        return;
      }
      case 'media': {
        const code = VK[action.key];
        if (!code) throw new Error('Touche média inconnue');
        this._send('K ' + code);
        return;
      }
      case 'audio': {
        const flow = action.what === 'speaker' ? 0 : 1;
        this._send(action.mode === 'toggle' ? 'MT ' + flow : 'MS ' + flow + ' ' + (action.mode === 'mute' ? 1 : 0));
        return;
      }
      case 'obs': {
        if (!this.obs) throw new Error('OBS non configuré');
        await this.obs.run(action);
        return;
      }
      case 'http': {
        if (!/^https?:\/\//i.test(action.url || '')) throw new Error('URL invalide');
        const init = { method: action.method || 'GET', signal: AbortSignal.timeout(10000), headers: {} };
        for (const line of String(action.headers || '').split('\n')) { const k = line.indexOf(':'); if (k > 0) init.headers[line.slice(0, k).trim()] = this._expand(line.slice(k + 1).trim()); }
        if (action.body && init.method !== 'GET') { init.body = this._expand(action.body); if (action.json && !Object.keys(init.headers).some((k) => k.toLowerCase() === 'content-type')) init.headers['Content-Type'] = 'application/json'; }
        const res = await fetch(this._expand(action.url), init);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return;
      }
      case 'mouse': {
        const x = action.current ? -1 : action.x | 0; const y = action.current ? -1 : action.y | 0;
        if (action.mode === 'scrollup' || action.mode === 'scrolldown') {
          if (!action.current) this._send(`MC ${x} ${y} 3 1`);
          this._send('MW ' + (action.mode === 'scrollup' ? 1 : -1) * 120 * Math.max(1, action.amount | 0 || 3));
        } else {
          const b = { click: 0, double: 0, right: 1, middle: 2, move: 3 }[action.mode];
          this._send(`MC ${x} ${y} ${b === undefined ? 0 : b} ${action.mode === 'double' ? 2 : 1}`);
        }
        return;
      }
      case 'appvolume': {
        const proc = String(action.process || '').trim();
        if (!proc) throw new Error('Nom de processus vide (ex : spotify, chrome)');
        const v = Math.max(0, Math.min(100, action.value | 0)) / 100;
        const [mode, val] = { mute: [1, 0], unmute: [2, 0], toggle: [3, 0], up: [4, v], down: [4, -v], set: [0, v] }[action.mode] || [3, 0];
        const hit = await this._ask(`AV ${mode} ${val} ${proc}`, this.appWaiters, null, 3000);
        if (hit === 0) throw new Error(`« ${proc} » ne joue aucun son en ce moment`);
        return;
      }
      case 'power': {
        const cmd = POWER_CMDS[action.what];
        if (!cmd) throw new Error('Action d\'alimentation inconnue');
        exec(cmd, { windowsHide: true }, (e) => { if (e && ctx.onError) ctx.onError(e.message); });
        return;
      }
      case 'wol': await sendMagic(action.mac, { ip: action.ip || undefined, port: action.port }); return;
      case 'text': {
        if (!action.text) return;
        const t = escapeSendKeys(this._expand(action.text)) + (action.enter ? '{ENTER}' : '');
        this._send('T ' + Buffer.from(t, 'utf8').toString('base64'));
        return;
      }
      case 'open': {
        const target = String(action.target || '').trim();
        if (!target) throw new Error('Cible vide');
        if (/^(https?:|mailto:|[a-z][a-z0-9+.-]*:\/\/)/i.test(target)) {
          if (this.shell) await this.shell.openExternal(target);
          else exec(`start "" "${target.replace(/"/g, '')}"`, { windowsHide: true });
        } else if (this.shell && /[\\/]/.test(target)) {
          const err = await this.shell.openPath(target);
          if (err) throw new Error(err);
        } else {
          // nom d'appli (calc, notepad, discord...) : laisse Windows résoudre
          exec(`start "" "${target.replace(/"/g, '')}"`, { windowsHide: true }, () => {});
        }
        return;
      }
      case 'command': {
        const cmd = String(action.cmd || '').trim();
        if (!cmd) throw new Error('Commande vide');
        exec(cmd, { windowsHide: true, timeout: 120000 }, (e) => { if (e && ctx.onError) ctx.onError(e.message); });
        return;
      }
      case 'multi': {
        for (let i = 0; i < Math.min(20, Math.max(1, action.times | 0 || 1)); i++) for (const step of action.steps || []) await this.run(step, ctx);
        return;
      }
      default: throw new Error('Action inconnue');
    }
  }
}

module.exports = { Actions, parseNowPlaying };
