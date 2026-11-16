'use strict';
// Serveur HTTP (sert l'UI téléphone) + WebSocket (/ws) sur le réseau local.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const EventEmitter = require('events');
const { WebSocketServer } = require('ws');
const { checkPin } = require('./store');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class DeckServer extends EventEmitter {
  constructor({ store, actions, phoneDir, pcName }) {
    super();
    this.store = store; this.actions = actions; this.phoneDir = phoneDir; this.pcName = pcName || 'PC';
    this.scheme = 'http'; this.profByIp = new Map();
    this.http = null; this.wss = null; this.clients = new Map(); this.nextId = 1; this.port = null;
    this.toggles = new Map(); this._cpu = null; this._stats = null;
    this._files = new Map();
    this.sys = { mic: 0, mute: 0, obsrec: 0, obsstream: 0, vol: null, bri: null, weather: null, np: null };
  }

  // tls = { key, cert } pour servir en HTTPS (certificat auto-signé), sinon HTTP.
  start(port, tls) {
    return new Promise((resolve, reject) => {
      const handler = (req, res) => this._serve(req, res);
      const srv = tls ? https.createServer(tls, handler) : http.createServer(handler);
      this.scheme = tls ? 'https' : 'http';
      const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
      srv.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname !== '/ws') return socket.destroy();
        socket.setNoDelay(true); // pas d'attente de Nagle : l'appui part tout de suite
        wss.handleUpgrade(req, socket, head, (ws) => this._onConnect(ws, req, url));
      });
      srv.once('error', (e) => reject(e));
      srv.listen(port, '0.0.0.0', () => {
        this.http = srv; this.wss = wss; this.port = srv.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    clearInterval(this._hb); clearInterval(this._st);
    for (const c of this.clients.values()) { try { c.ws.terminate(); } catch { /* ok */ } }
    this.clients.clear();
    if (this.wss) this.wss.close();
    if (this.http) this.http.close();
    this.http = this.wss = null; this.port = null;
    this.emit('clients', this.clientList());
  }

  clientList() {
    return [...this.clients.values()].map((c) => ({ id: c.id, ip: c.ip, ua: c.ua, since: c.since }));
  }

  _allPages() {
    const c = this.store.config;
    return [...c.pages, ...c.profiles.flatMap((q) => q.pages)];
  }

  _states() {
    const out = {}; const ids = new Set();
    for (const p of this._allPages()) for (const b of p.buttons) {
      ids.add(b.id);
      if (b.bind) out[b.id] = this.sys[b.bind] ? 1 : 0; // état réel (micro, OBS…) plutôt que bascule locale
    }
    for (const k of this.toggles.keys()) if (!ids.has(k)) this.toggles.delete(k);
    for (const [k, v] of this.toggles) if (!(k in out)) out[k] = v;
    return out;
  }

  _cfgMsg(c) {
    return JSON.stringify({ t: 'config', config: this.store.publicConfig(this.pcName, c && c.pid), states: this._states(), sys: this._sysMsg() });
  }

  _sysMsg() { return { vol: this.sys.vol, mute: this.sys.mute, mic: this.sys.mic, bri: this.sys.bri, weather: this.sys.weather, np: this.sys.np }; }

  // Met à jour l'état réel du système ; prévient les téléphones des boutons liés et des curseurs.
  setSys(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) if (JSON.stringify(this.sys[k]) !== JSON.stringify(v)) { this.sys[k] = v; changed.push(k); }
    if (!changed.length) return;
    for (const p of this._allPages()) for (const b of p.buttons) if (b.bind && changed.includes(b.bind)) this.broadcast({ t: 'state', id: b.id, s: this.sys[b.bind] ? 1 : 0 });
    if (changed.some((k) => ['vol', 'mute', 'mic', 'bri', 'weather', 'np'].includes(k))) this.broadcast({ t: 'sys', ...this._sysMsg() });
  }

  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const c of this.clients.values()) if (c.authed && c.ws.readyState === 1) c.ws.send(msg);
  }

  broadcastConfig() {
    const needPin = !!this.store.config.settings.pinHash;
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1) continue;
      if (!needPin) c.authed = true; // PIN retiré dans l'éditeur : plus de verrou
      if (!this.store.config.settings.perPhoneProfiles) c.pid = null;
      if (c.authed) c.ws.send(this._cfgMsg(c));
      else c.ws.send('{"t":"locked"}');
    }
  }

  kick(all = true) { for (const c of this.clients.values()) c.ws.close(4001, 'token'); if (all) this.clients.clear(); this.emit('clients', this.clientList()); }

  _serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(this.phoneDir, p));
    if (!file.startsWith(this.phoneDir + path.sep)) { res.writeHead(403); return res.end(); }
    // Fichiers du téléphone gardés en mémoire (compressés une seule fois) + ETag : rechargement quasi instantané.
    const hit = this._files.get(file);
    const send = (f) => {
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ETag: f.etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const h = { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ETag: f.etag, Vary: 'Accept-Encoding' };
      if (gz) h['Content-Encoding'] = 'gzip';
      const body = gz ? f.gz : f.raw;
      h['Content-Length'] = body.length;
      res.writeHead(200, h);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
      const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
      if (hit && hit.etag === etag) return send(hit);
      fs.readFile(file, (e2, raw) => {
        if (e2) { res.writeHead(404); return res.end('404'); }
        const type = MIME[path.extname(file)] || 'application/octet-stream';
        const gz = raw.length > 1024 && /^(text|application\/(javascript|json|manifest))|svg/.test(type) ? zlib.gzipSync(raw, { level: 9 }) : null;
        const f = { etag, type, raw, gz };
        this._files.set(file, f);
        send(f);
      });
    });
  }

  _onConnect(ws, req, url) {
    const token = url.searchParams.get('t') || '';
    const ok = safeEq(token, this.store.config.settings.token);
    if (!ok) {
      ws.send(JSON.stringify({ t: 'denied' }));
      return ws.close(4003, 'denied');
    }
    const id = this.nextId++;
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    const c = { id, ws, ip, ua: String(req.headers['user-agent'] || '').slice(0, 120), since: Date.now(), last: 0, authed: !this.store.config.settings.pinHash, fails: 0, blockedUntil: 0, pid: this.store.config.settings.perPhoneProfiles ? (this.profByIp.get(ip) || null) : null };
    this.clients.set(id, c);
    this.emit('clients', this.clientList());
    ws.send(c.authed ? this._cfgMsg(c) : '{"t":"locked"}');

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => this._onMessage(c, raw));
    ws.on('close', () => { this.clients.delete(id); this.emit('clients', this.clientList()); });
    ws.on('error', () => {});
  }

  async _onMessage(c, raw) {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') return c.ws.send('{"t":"pong"}');
    if (m.t === 'lock') { if (this.store.config.settings.pinHash) { c.authed = false; c.ws.send('{"t":"locked"}'); } return; }
    if (m.t === 'unlock') {
      const now = Date.now();
      if (now < c.blockedUntil) return c.ws.send(JSON.stringify({ t: 'unlock', ok: false, wait: Math.ceil((c.blockedUntil - now) / 1000) }));
      if (checkPin(this.store.config.settings, m.pin)) { c.authed = true; c.fails = 0; c.ws.send(JSON.stringify({ t: 'unlock', ok: true })); c.ws.send(this._cfgMsg(c)); }
      else {
        c.fails++;
        if (c.fails >= 5) { c.fails = 0; c.blockedUntil = now + 30000; } // 5 essais, puis 30 s de pause
        c.ws.send(JSON.stringify({ t: 'unlock', ok: false, wait: c.blockedUntil > now ? 30 : 0 }));
      }
      return;
    }
    if (!c.authed) return; // verrouillé : rien d'autre n'est accepté
    if (m.t === 'vol' || m.t === 'bri') { // curseurs : l'id du bouton doit être un widget volume / luminosité existant
      const vb = this.store.findButton(String(m.page), String(m.id), c.pid);
      const kind = m.t === 'vol' ? 'volume' : 'brightness';
      if (vb && vb.widget === kind) {
        const v = Math.max(0, Math.min(100, Math.round(+m.v) || 0));
        if (m.t === 'vol') { this.sys.vol = v; this.actions.setVolume && this.actions.setVolume(v); } else { this.sys.bri = v; this.actions.setBrightness && this.actions.setBrightness(v); }
        this.broadcast({ t: 'sys', ...this._sysMsg() });
      }
      return;
    }
    if (m.t !== 'press') return;
    const now = Date.now();
    if (now - c.last < 25) return; // anti-spam
    c.last = now;
    const btn = this.store.findButton(String(m.page), String(m.id), c.pid);
    if (!btn) return c.ws.send(JSON.stringify({ t: 'ack', id: m.id, ok: false, err: 'Bouton inconnu' }));
    if (btn.confirm && m.confirmed !== true) return c.ws.send(JSON.stringify({ t: 'ack', id: btn.id, ok: false, err: 'Confirmation requise' }));
    try {
      await this._execute(String(m.page), btn, m.hold === true, c.ip, c);
      if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'ack', id: btn.id, ok: true }));
    } catch (e) {
      this.emit('action-error', e.message);
      if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'ack', id: btn.id, ok: false, err: e.message }));
    }
  }

  // Exécute un bouton (appui, appui long, raccourci PC ou planning). L'action est toujours relue dans la config.
  async _execute(pageId, btn, hold, from, client) {
    let action = btn.action;
    if (hold) action = btn.hold;
    else if (btn.alt && !btn.bind) { // bouton à 2 états : alterne (si lié à un état réel, c'est le système qui décide)
      const s = this.toggles.get(btn.id) || 0;
      action = s ? btn.alt.action : btn.action;
      this.toggles.set(btn.id, s ? 0 : 1);
      this.broadcast({ t: 'state', id: btn.id, s: s ? 0 : 1 });
    }
    if (action.type === 'profile') {
      const cfg = this.store.config;
      if (cfg.settings.perPhoneProfiles && client) { // ce téléphone seulement : les autres gardent leur profil
        const target = action.profileId === cfg.profile.id ? null : (cfg.profiles.some((q) => q.id === action.profileId) ? action.profileId : client.pid);
        client.pid = target; this.profByIp.set(client.ip, target);
        if (client.ws.readyState === 1) client.ws.send(this._cfgMsg(client));
      } else if (this.store.switchProfile(action.profileId)) { this.toggles.clear(); this.broadcastConfig(); this.emit('profile'); }
    } else await this.actions.run(action, { onError: (e) => this.emit('action-error', e) });
    this.emit('pressed', { page: pageId, id: btn.id, label: btn.label || btn.widget || btn.id, ip: from });
  }

  // Déclenchement depuis le PC (raccourci global, planning). Retourne false si le bouton n'existe plus.
  async trigger(pageId, btnId, from = 'PC') {
    const btn = this.store.findButton(String(pageId), String(btnId));
    if (!btn) return false;
    try { await this._execute(String(pageId), btn, false, from); } catch (e) { this.emit('action-error', e.message); return false; }
    return true;
  }

  _needsStats() {
    return this._allPages().some((p) => p.buttons.some((b) => b.widget === 'cpu' || b.widget === 'ram'));
  }

  _sampleStats() {
    const cpus = os.cpus(); let idle = 0, total = 0;
    for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
    let cpu = 0;
    if (this._cpu) { const dt = total - this._cpu.total; const di = idle - this._cpu.idle; cpu = dt > 0 ? Math.round((1 - di / dt) * 100) : 0; }
    this._cpu = { idle, total };
    const ram = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    return { cpu, ram };
  }

  // Heartbeat : ferme les clients morts (téléphone en veille). Stats uniquement si un widget CPU/RAM existe.
  startHeartbeat() {
    this._st = setInterval(() => {
      if (!this.clients.size || !this._needsStats()) { this._cpu = null; return; }
      this.broadcast({ t: 'stats', ...this._sampleStats() });
    }, 2000);
    this._st.unref();
    this._hb = setInterval(() => {
      for (const c of this.clients.values()) {
        if (c.ws.isAlive === false) { c.ws.terminate(); continue; }
        c.ws.isAlive = false; try { c.ws.ping(); } catch { /* ok */ }
      }
    }, 15000);
    this._hb.unref();
  }
}

module.exports = { DeckServer };
