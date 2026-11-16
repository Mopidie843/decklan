'use strict';
// Client minimal OBS WebSocket v5 (OBS 28+ : Outils > Paramètres du serveur WebSocket).
const crypto = require('crypto');
const EventEmitter = require('events');
const WebSocket = require('ws');

const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

class Obs extends EventEmitter {
  constructor() {
    super();
    this.cfg = null; this.ws = null; this.connected = false; this.timer = null; this.pending = new Map(); this.nextId = 1;
    this.state = { obsrec: 0, obsstream: 0 };
  }

  configure(cfg) {
    const same = this.cfg && cfg && ['enabled', 'host', 'port', 'password'].every((k) => this.cfg[k] === cfg[k]);
    if (same) return;
    this.cfg = cfg; this.stop(true);
    if (cfg && cfg.enabled) this._connect();
  }

  stop(keepCfg) {
    clearTimeout(this.timer); this.timer = null;
    if (this.ws) { try { this.ws.removeAllListeners(); this.ws.on('error', () => {}); this.ws.terminate(); } catch { /* ok */ } }
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('OBS déconnecté'));
    this.pending.clear();
    if (this.connected) { this.connected = false; this._setState({ obsrec: 0, obsstream: 0 }); }
    if (!keepCfg) this.cfg = null;
  }

  _retry() { clearTimeout(this.timer); if (this.cfg && this.cfg.enabled) { this.timer = setTimeout(() => this._connect(), 8000); this.timer.unref(); } }

  _connect() {
    const { host, port, password } = this.cfg;
    let ws;
    try { ws = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json', { handshakeTimeout: 4000 }); } catch { return this._retry(); }
    this.ws = ws;
    ws.on('error', () => {});
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; if (this.connected) { this.connected = false; this._setState({ obsrec: 0, obsstream: 0 }); this.emit('connection', false); } this._retry(); } });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      const d = m.d || {};
      if (m.op === 0) { // Hello
        const id = { rpcVersion: 1 };
        if (d.authentication) id.authentication = sha(sha(password + d.authentication.salt) + d.authentication.challenge);
        ws.send(JSON.stringify({ op: 1, d: id }));
      } else if (m.op === 2) { // Identified
        this.connected = true; this.emit('connection', true);
        this.request('GetStreamStatus').then((r) => this._setState({ obsstream: r.outputActive ? 1 : 0 })).catch(() => {});
        this.request('GetRecordStatus').then((r) => this._setState({ obsrec: r.outputActive ? 1 : 0 })).catch(() => {});
      } else if (m.op === 5) { // Event
        if (d.eventType === 'StreamStateChanged') this._setState({ obsstream: d.eventData.outputActive ? 1 : 0 });
        else if (d.eventType === 'RecordStateChanged') this._setState({ obsrec: d.eventData.outputActive ? 1 : 0 });
      } else if (m.op === 7) { // RequestResponse
        const p = this.pending.get(d.requestId); if (!p) return;
        this.pending.delete(d.requestId); clearTimeout(p.t);
        if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
        else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || 'Requête OBS refusée'));
      }
    });
  }

  _setState(patch) {
    for (const [k, v] of Object.entries(patch)) if (this.state[k] !== v) { this.state[k] = v; this.emit('state', k, v); }
  }

  request(type, data) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== 1) return reject(new Error('OBS non connecté (WebSocket activé ? mot de passe ?)'));
      const requestId = 'r' + this.nextId++;
      const t = setTimeout(() => { this.pending.delete(requestId); reject(new Error('OBS ne répond pas')); }, 4000);
      this.pending.set(requestId, { resolve, reject, t });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data || undefined } }));
    });
  }

  async run(a) {
    switch (a.cmd) {
      case 'scene': if (!a.name) throw new Error('Nom de scène vide'); return this.request('SetCurrentProgramScene', { sceneName: a.name });
      case 'toggleRecord': return this.request('ToggleRecord');
      case 'startRecord': return this.request('StartRecord');
      case 'stopRecord': return this.request('StopRecord');
      case 'toggleStream': return this.request('ToggleStream');
      case 'startStream': return this.request('StartStream');
      case 'stopStream': return this.request('StopStream');
      case 'toggleMute': if (!a.name) throw new Error('Nom de la source vide'); return this.request('ToggleInputMute', { inputName: a.name });
      default: throw new Error('Commande OBS inconnue');
    }
  }

  async scenes() {
    const r = await this.request('GetSceneList');
    return (r.scenes || []).map((s) => s.sceneName).reverse();
  }
}

module.exports = { Obs };
