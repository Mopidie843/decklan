'use strict';
// Colle entre serveur, actions, OBS et mDNS : maintient PowerShell chaud, sonde l'état réel du système
// et le profil lié à l'appli au premier plan. N'active que ce qui sert (RAM / CPU minimaux).
const { Responder } = require('./mdns');
const { fetchWeather } = require('./weather');

class Runtime {
  constructor({ store, actions, obs, getServer }) {
    this.store = store; this.actions = actions; this.obs = obs; this.getServer = getServer;
    this.mdns = new Responder();
    this.fgTimer = null; this.audioTimer = null; this.schedTimer = null; this.weatherTimer = null; this.npTimer = null; this.geo = null; this.lastFg = ''; this.lastFire = '';
    obs.on('state', (k, v) => { const s = this.getServer(); if (s) s.setSys({ [k]: v }); });
  }

  // Appelé à chaque changement de clients / de config / de serveur.
  sync() {
    const server = this.getServer(); const s = this.store.config.settings;
    const n = server ? server.clients.size : 0;
    const pages = this.store.config.pages;
    this.actions.keepAlive = n > 0;
    if (n > 0) this.actions.warmup();

    this.obs.configure({ enabled: s.obsEnabled, host: s.obsHost, port: s.obsPort, password: s.obsPassword });
    if (s.mdns) { if (!this.mdns.m || this.mdns.name !== s.hostname) this.mdns.start(s.hostname); } else this.mdns.stop();

    const wantFg = n > 0 && pages.some((p) => p.app);
    if (wantFg && !this.fgTimer) {
      this.fgTimer = setInterval(async () => {
        const srv = this.getServer(); if (!srv) return;
        const fg = await this.actions.foreground();
        if (!fg || fg === this.lastFg) return;
        this.lastFg = fg;
        const pg = this.store.config.pages.find((p) => p.app && p.app === fg);
        if (pg) srv.broadcast({ t: 'goto', page: pg.id });
      }, 1500);
    } else if (!wantFg && this.fgTimer) { clearInterval(this.fgTimer); this.fgTimer = null; this.lastFg = ''; }

    const wantSched = (this.store.config.schedules || []).some((x) => x.on);
    if (wantSched && !this.schedTimer) { this.schedTimer = setInterval(() => this.tickSchedules(), 15000); this.schedTimer.unref(); }
    else if (!wantSched && this.schedTimer) { clearInterval(this.schedTimer); clearInterval(this.weatherTimer); clearInterval(this.npTimer); this.schedTimer = null; }

    const widgets = new Set();
    for (const p of pages) for (const b of p.buttons) if (b.widget) widgets.add(b.widget);
    const wantWeather = n > 0 && widgets.has('weather') && !!s.weatherCity;
    if (wantWeather && !this.weatherTimer) { this.weatherTimer = setInterval(() => this.pollWeather(), 15 * 60000); this.weatherTimer.unref(); this.pollWeather(); }
    else if (!wantWeather && this.weatherTimer) { clearInterval(this.weatherTimer); this.weatherTimer = null; }
    if (wantWeather && this.lastCity !== s.weatherCity) { this.lastCity = s.weatherCity; this.pollWeather(); }
    const wantNp = n > 0 && widgets.has('nowplaying');
    if (wantNp && !this.npTimer) { this.npTimer = setInterval(() => this.pollNowPlaying(), 3000); this.pollNowPlaying(); }
    else if (!wantNp && this.npTimer) { clearInterval(this.npTimer); this.npTimer = null; }
    if (n > 0 && widgets.has('brightness') && this.getServer().sys.bri == null && !this._briAsked) { this._briAsked = true; this.actions.brightness().then((v) => { const sv = this.getServer(); if (sv && v != null) sv.setSys({ bri: v }); this._briAsked = v == null; }); }

    const wantAudio = n > 0 && pages.some((p) => p.buttons.some((b) => b.widget === 'volume' || b.bind === 'mic' || b.bind === 'mute'));
    if (wantAudio && !this.audioTimer) {
      this.audioTimer = setInterval(() => this.pollAudio(), 1500);
      this.pollAudio();
    } else if (!wantAudio && this.audioTimer) { clearInterval(this.audioTimer); this.audioTimer = null; }
  }

  // Planning : exécute les boutons programmés, une seule fois par minute et par entrée.
  tickSchedules(now = new Date()) {
    const srv = this.getServer(); if (!srv) return [];
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const fired = [];
    for (const x of this.store.config.schedules || []) {
      if (!x.on || x.time !== hhmm || !x.days.includes(now.getDay())) continue;
      const key = x.id + '@' + now.toDateString() + ' ' + hhmm;
      if (this.lastFire.includes(key)) continue;
      this.lastFire = (this.lastFire + '|' + key).slice(-400);
      srv.trigger(x.page, x.btn, 'Planning: ' + x.name);
      fired.push(x.id);
    }
    return fired;
  }

  async pollWeather(f) {
    const srv = this.getServer(); const city = this.store.config.settings.weatherCity;
    if (!srv || !city) return null;
    try {
      const r = await fetchWeather(city, this.geo, f);
      this.geo = r.geo; srv.setSys({ weather: r.weather }); return r.weather;
    } catch (e) { srv.emit('action-error', 'Météo : ' + e.message); return null; }
  }

  async pollNowPlaying() {
    const srv = this.getServer(); if (!srv) return;
    srv.setSys({ np: await this.actions.nowPlaying() });
  }

  async pollAudio() {
    const srv = this.getServer(); if (!srv) return;
    const a = await this.actions.audioState();
    if (a) srv.setSys({ vol: a.vol, mute: a.mute, mic: a.mic });
  }

  stop() {
    clearInterval(this.fgTimer); clearInterval(this.audioTimer); clearInterval(this.schedTimer); this.mdns.stop(); this.obs.stop();
  }
}

module.exports = { Runtime };
