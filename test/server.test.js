'use strict';
// Test bout en bout sans Electron : store + serveur WS + actions factices.
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Store } = require('../src/store');
const { DeckServer } = require('../src/server');
const { parseCombo, escapeSendKeys } = require('../src/keys');
const { Actions } = require('../src/actions');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decklan-'));
const store = new Store(dir);
const ran = [];
const actions = { run: async (a) => { if (a.type === 'command' && a.cmd === 'boom') throw new Error('boom'); ran.push(a); } };
const srv = new DeckServer({ store, actions, phoneDir: path.join(__dirname, '..', 'phone'), pcName: 'TEST' });

const open = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d))); ws.on('open', () => res({ ws, msgs })); ws.on('error', rej); ws.on('close', () => { ws.closed = true; }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, p) => new Promise((res, rej) => require('http').get({ port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));

(async () => {
  // clavier
  assert.deepStrictEqual(parseCombo('Ctrl + Shift+M'), [17, 16, 77]);
  assert.strictEqual(parseCombo('ctrl+nope'), null);
  assert.strictEqual(escapeSendKeys('a+b\n(x)'), 'a{+}b{ENTER}{(}x{)}');

  const port = await srv.start(0);
  const token = store.config.settings.token;

  // HTTP : statique + traversal
  assert.strictEqual((await get(port, '/')).status, 200);
  assert.strictEqual((await get(port, '/app.js')).status, 200);
  assert.strictEqual((await get(port, '/..%2f..%2fpackage.json')).status, 403);
  assert.strictEqual((await get(port, '/nope')).status, 404);

  // mauvais token
  const bad = await open(`ws://127.0.0.1:${port}/ws?t=wrong`); await wait(100);
  assert.ok(bad.msgs.some((m) => m.t === 'denied') && bad.ws.closed, 'mauvais token refusé');

  // bon token
  const a = await open(`ws://127.0.0.1:${port}/ws?t=${token}`); await wait(100);
  const cfg = a.msgs.find((m) => m.t === 'config');
  assert.ok(cfg && cfg.config.pages.length >= 2);
  assert.strictEqual(JSON.stringify(cfg).includes(token), false, 'token jamais envoyé au téléphone');

  // press
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'b_play' })); await wait(120);
  assert.deepStrictEqual(ran.pop(), { type: 'media', key: 'playpause' });
  assert.ok(a.msgs.some((m) => m.t === 'ack' && m.ok));
  // le téléphone ne peut pas injecter d'action
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'b_play', action: { type: 'command', cmd: 'calc' } })); await wait(120);
  assert.deepStrictEqual(ran.pop(), { type: 'media', key: 'playpause' });
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'inconnu' })); await wait(120);
  assert.ok(a.msgs.some((m) => m.t === 'ack' && !m.ok));

  // toggle + hold + erreur
  const c2 = JSON.parse(JSON.stringify(store.config));
  const btn = c2.pages[0].buttons[0];
  btn.alt = { label: 'B', icon: '🔊', bg: '#112233', fg: '#ffffff', action: { type: 'media', key: 'mute' } };
  btn.hold = { type: 'command', cmd: 'boom' };
  store.save(c2); srv.broadcastConfig(); await wait(100);
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'b_play' })); await wait(120);
  assert.ok(a.msgs.some((m) => m.t === 'state' && m.s === 1), 'état 2');
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'b_play' })); await wait(120);
  assert.deepStrictEqual(ran.slice(-2).map((x) => x.key), ['playpause', 'mute']);
  a.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'b_play', hold: true })); await wait(120);
  assert.ok(a.msgs.filter((m) => m.t === 'ack' && !m.ok).length >= 2, 'erreur remontée');

  // config rejouée au téléphone + sanitize
  const evil = JSON.parse(JSON.stringify(store.config));
  evil.pages[0].buttons[0].action = { type: 'rm -rf', x: 1 };
  evil.pages[0].buttons[0].bg = 'javascript:1'; evil.pages[0].buttons[0].image = 'data:text/html;base64,AAAA';
  const clean = store.save(evil).pages[0].buttons[0];
  assert.strictEqual(clean.action.type, 'none'); assert.strictEqual(clean.bg, '#2b2f45'); assert.strictEqual(clean.image, '');

  // régénération du token : l'ancien client est expulsé
  store.regenToken(); srv.kick(); await wait(150);
  assert.ok(a.ws.closed);
  const stale = await open(`ws://127.0.0.1:${port}/ws?t=${token}`); await wait(100);
  assert.ok(stale.msgs.some((m) => m.t === 'denied'));

  // Actions : hors Windows, un raccourci échoue proprement
  const real = new Actions({ platform: 'linux' });
  await assert.rejects(() => real.run({ type: 'hotkey', keys: 'ctrl+c' }), /Windows/);
  await real.run({ type: 'wait', ms: 5 }); await real.run({ type: 'none' });
  assert.strictEqual(await real.foreground(), '');

  await extra();
  await extra2();
  await extra3();
  srv.stop(); real.stop();
  console.log('TOUS LES TESTS OK');
  process.exit(0);
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });


// ---------- v3 : profils, volume, états liés, OBS, WoL, mDNS ----------
async function extra() {
  const crypto = require('crypto');
  const dgram = require('dgram');
  const { Obs } = require('../src/obs');
  const { magicPacket, sendMagic } = require('../src/wol');
  const { answersFor } = require('../src/mdns');
  const { sanitize } = require('../src/store');

  // --- profils : bascule depuis le téléphone ---
  const base = JSON.parse(JSON.stringify(store.config));
  base.profiles = [{ id: 'jeu', name: 'Jeu', pages: [{ id: 'g1', name: 'Jeu 1', cols: 3, rows: 2, buttons: [{ id: 'g_a', row: 0, col: 0, label: 'Tir', action: { type: 'hotkey', keys: 'space' } }] }] }];
  base.pages[0].buttons[1].action = { type: 'profile', profileId: 'jeu' };
  const id1 = base.pages[0].buttons[1].id; const pg1 = base.pages[0].id;
  store.save(base);
  const tok = store.config.settings.token;
  const c = await open(`ws://127.0.0.1:${srv.port}/ws?t=${tok}`); await wait(100);
  let profileEvt = 0; srv.on('profile', () => profileEvt++);
  c.ws.send(JSON.stringify({ t: 'press', page: pg1, id: id1 })); await wait(150);
  const cf = c.msgs.filter((m) => m.t === 'config').pop();
  assert.strictEqual(cf.config.profile, 'Jeu'); assert.strictEqual(cf.config.pages[0].id, 'g1'); assert.strictEqual(profileEvt, 1);
  assert.strictEqual(store.config.profiles.length, 1, 'ancien profil rangé');

  // --- curseur de volume : seul un widget volume l'accepte ---
  const vols = []; actions.setVolume = (v) => vols.push(v);
  const c3 = JSON.parse(JSON.stringify(store.config));
  c3.pages[0].buttons.push({ id: 'vol1', row: 1, col: 0, w: 3, widget: 'volume' });
  store.save(c3); srv.broadcastConfig(); await wait(80);
  c.ws.send(JSON.stringify({ t: 'vol', page: 'g1', id: 'vol1', v: 42 })); c.ws.send(JSON.stringify({ t: 'vol', page: 'g1', id: 'g_a', v: 99 })); await wait(100);
  assert.deepStrictEqual(vols, [42]);
  assert.strictEqual(store.config.pages[0].buttons.find((b) => b.id === 'vol1').w, 3);

  // --- états liés (bind) : le système décide, pas la bascule locale ---
  const c4 = JSON.parse(JSON.stringify(store.config));
  c4.pages[0].buttons.push({ id: 'mic1', row: 0, col: 1, bind: 'mic', action: { type: 'audio', what: 'mic', mode: 'toggle' }, alt: { label: 'Coupé', action: { type: 'audio', what: 'mic', mode: 'toggle' } } });
  store.save(c4); srv.broadcastConfig(); await wait(80);
  c.ws.send(JSON.stringify({ t: 'press', page: 'g1', id: 'mic1' })); await wait(100);
  assert.ok(!c.msgs.some((m) => m.t === 'state' && m.id === 'mic1'), 'pas de bascule locale sur un bouton lié');
  srv.setSys({ mic: 1 }); await wait(80);
  assert.ok(c.msgs.some((m) => m.t === 'state' && m.id === 'mic1' && m.s === 1), 'état réel poussé');
  srv.setSys({ vol: 30 }); await wait(60);
  assert.ok(c.msgs.some((m) => m.t === 'sys' && m.vol === 30));
  c.ws.close();

  // --- sanitize : largeur, chevauchements, nouvelles actions ---
  const w = sanitize({ pages: [{ id: 'p', cols: 4, rows: 1, buttons: [
    { id: 'a', row: 0, col: 2, w: 4, action: { type: 'obs', cmd: 'scene', name: 'Jeu' } },
    { id: 'b', row: 0, col: 3, w: 1, action: { type: 'wol', mac: 'aa:bb:cc:dd:ee:ff' } },
    { id: 'c', row: 0, col: 0, w: 2, bind: 'evil', widget: 'nope', action: { type: 'audio', what: 'x', mode: 'y' } },
  ] }] }, store.config).pages[0].buttons;
  assert.strictEqual(w.find((b) => b.id === 'a').w, 2, 'largeur bornée à la grille');
  assert.ok(!w.find((b) => b.id === 'b'), 'case recouverte rejetée');
  assert.strictEqual(w.find((b) => b.id === 'c').bind, ''); assert.strictEqual(w.find((b) => b.id === 'c').widget, '');
  assert.deepStrictEqual(w.find((b) => b.id === 'c').action, { type: 'audio', what: 'mic', mode: 'toggle' });

  // --- Wake-on-LAN ---
  const pkt = magicPacket('AA:BB:CC:DD:EE:FF');
  assert.strictEqual(pkt.length, 102); assert.ok(pkt.subarray(0, 6).every((b) => b === 0xff)); assert.strictEqual(pkt.subarray(96).toString('hex'), 'aabbccddeeff');
  assert.throws(() => magicPacket('pas-une-mac'), /MAC/);
  const udp = dgram.createSocket('udp4'); const got = new Promise((res) => udp.once('message', res));
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  await sendMagic('AA:BB:CC:DD:EE:FF', { ip: '127.0.0.1', port: udp.address().port });
  assert.strictEqual((await got).length, 102); udp.close();

  // --- mDNS : réponse A pour decklan.local seulement ---
  assert.deepStrictEqual(answersFor('decklan', [{ name: 'DeckLan.local', type: 'A' }], ['192.168.1.5']).map((a) => a.data), ['192.168.1.5']);
  assert.strictEqual(answersFor('decklan', [{ name: 'autre.local', type: 'A' }], ['1.1.1.1']).length, 0);

  // --- OBS : faux serveur WebSocket v5 avec authentification ---
  const { WebSocketServer } = require('ws');
  const PASS = 'secret', SALT = 'salty', CH = 'chal';
  const sha = (x) => crypto.createHash('sha256').update(x).digest('base64');
  const expect = sha(sha(PASS + SALT) + CH);
  const reqs = []; let authOk = false; let sock = null;
  const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'obswebsocket.json' });
  await new Promise((r) => wss.on('listening', r));
  wss.on('connection', (ws) => {
    sock = ws;
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: { challenge: CH, salt: SALT } } }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.op === 1) { authOk = m.d.authentication === expect; if (authOk) ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); else ws.close(4009); }
      if (m.op === 6) {
        reqs.push(m.d.requestType + (m.d.requestData ? JSON.stringify(m.d.requestData) : ''));
        const data = m.d.requestType === 'GetRecordStatus' ? { outputActive: true } : m.d.requestType === 'GetSceneList' ? { scenes: [{ sceneName: 'B' }, { sceneName: 'A' }] } : {};
        ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, responseData: data } }));
      }
    });
  });
  const obs = new Obs(); const states = [];
  obs.on('state', (k, v) => states.push(k + '=' + v));
  obs.configure({ enabled: true, host: '127.0.0.1', port: wss.address().port, password: PASS });
  for (let i = 0; i < 40 && !obs.connected; i++) await wait(50);
  assert.ok(authOk && obs.connected, 'auth OBS (sha256 challenge)');
  await wait(100);
  assert.ok(states.includes('obsrec=1'), 'état enregistrement initial');
  await obs.run({ cmd: 'scene', name: 'Jeu' }); await obs.run({ cmd: 'toggleStream' });
  assert.ok(reqs.includes('SetCurrentProgramScene{"sceneName":"Jeu"}') && reqs.includes('ToggleStream'));
  assert.deepStrictEqual(await obs.scenes(), ['A', 'B']);
  sock.send(JSON.stringify({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: true } } })); await wait(60);
  assert.ok(states.includes('obsstream=1'), 'événement live');
  const viaActions = new Actions({ platform: 'linux', obs }); await viaActions.run({ type: 'obs', cmd: 'startRecord' }); assert.ok(reqs.includes('StartRecord'));
  obs.stop(); wss.close();
  await assert.rejects(() => new Obs().run({ cmd: 'toggleRecord' }), /non connecté/);
}

// --- v4 : HTTP, variables, PIN, confirmation, raccourcis, planning, sauvegardes ---
async function extra2() {
  const http = require('http');
  const { sanitize, Store: St, checkPin } = require('../src/store');
  const { cleanShortcut, toAccelerator, collect } = require('../src/shortcuts');
  const { Runtime } = require('../src/runtime');
  const { Obs } = require('../src/obs');

  // raccourcis
  assert.strictEqual(cleanShortcut('Ctrl + Alt+1'), 'ctrl+alt+1');
  assert.strictEqual(cleanShortcut('alt+ctrl+f5'), 'ctrl+alt+f5');
  assert.strictEqual(cleanShortcut('a'), '', 'un modificateur est obligatoire');
  assert.strictEqual(cleanShortcut('ctrl+ctrl+a'), '');
  assert.strictEqual(cleanShortcut('ctrl+nope'), '');
  assert.strictEqual(toAccelerator('win+shift+esc'), 'Shift+Super+Escape');
  assert.strictEqual(collect([{ id: 'p', buttons: [{ id: 'a', shortcut: 'ctrl+alt+1' }, { id: 'b', shortcut: 'ctrl+alt+1' }, { id: 'c', shortcut: 'ctrl+alt+2' }] }]).length, 2, 'doublon ignoré');

  // sanitize : http / power / multi.times / confirm automatique
  const cl = sanitize({ pages: [{ id: 'p', buttons: [
    { id: 'h1', row: 0, col: 0, action: { type: 'http', url: 'http://x.local/a', method: 'PATCH', body: 'b' } },
    { id: 'h2', row: 0, col: 1, action: { type: 'http', url: 'file:///etc/passwd' } },
    { id: 'pw', row: 0, col: 2, action: { type: 'power', what: 'shutdown' } },
    { id: 'pw2', row: 0, col: 3, confirm: false, action: { type: 'power', what: 'restart' } },
    { id: 'lk', row: 1, col: 0, action: { type: 'power', what: 'rm -rf' } },
    { id: 'mt', row: 1, col: 1, action: { type: 'multi', times: 99, steps: [{ type: 'wait', ms: 1 }] } },
    { id: 'tm', row: 1, col: 2, widget: 'timer', timerMin: 999 },
  ] }] }, null).pages[0].buttons;
  const by = (i) => cl.find((b) => b.id === i);
  assert.strictEqual(by('h1').action.method, 'GET'); assert.strictEqual(by('h2').action.type, 'none', 'file:// refusé');
  assert.strictEqual(by('pw').confirm, true, 'arrêt = confirmation par défaut'); assert.strictEqual(by('pw2').confirm, false);
  assert.strictEqual(by('lk').action.what, 'lock', 'valeur inconnue → verrouillage'); assert.strictEqual(by('mt').action.times, 20);
  assert.strictEqual(by('tm').widget, 'timer'); assert.strictEqual(by('tm').timerMin, 180);

  // actions : HTTP réel + variables + répétition
  const hits = [];
  const web = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { hits.push(req.method + ' ' + req.url + ' ' + b + ' ' + (req.headers['content-type'] || '')); res.writeHead(req.url === '/fail' ? 500 : 200); res.end('ok'); }); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const wp = web.address().port;
  const a = new Actions({ platform: 'linux', clipboard: { readText: () => 'CLIP' } });
  await a.run({ type: 'http', url: `http://127.0.0.1:${wp}/x?d={clipboard}`, method: 'POST', body: '{"a":"{clipboard}"}', json: true });
  assert.strictEqual(hits[0], 'POST /x?d=CLIP {"a":"CLIP"} application/json');
  await assert.rejects(() => a.run({ type: 'http', url: `http://127.0.0.1:${wp}/fail`, method: 'GET' }), /HTTP 500/);
  await assert.rejects(() => a.run({ type: 'http', url: 'ftp://x' }), /URL/);
  assert.ok(/^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(a._expand('{datetime}')));
  let n = 0; const rr = new Actions({ platform: 'linux' }); const orig = rr.run.bind(rr);
  rr.run = async (x, c) => { if (x.type === 'wait') n++; else return orig(x, c); };
  await orig.call(rr, { type: 'multi', times: 3, steps: [{ type: 'wait', ms: 1 }, { type: 'wait', ms: 1 }] }); assert.strictEqual(n, 6, 'multi répété 3 fois');
  web.close();

  // serveur : PIN, confirmation, trigger, planning
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'decklan2-'));
  const st = new St(dir2); const ran2 = [];
  const sv = new DeckServer({ store: st, actions: { run: async (x) => { ran2.push(x); } }, phoneDir: path.join(__dirname, '..', 'phone'), pcName: 'T2' });
  const pt = await sv.start(0);
  const cfg = JSON.parse(JSON.stringify(st.config));
  cfg.settings.pin = '4321';
  cfg.pages[0].buttons = [
    { id: 'k1', row: 0, col: 0, label: 'Eteindre', confirm: true, action: { type: 'hotkey', keys: 'ctrl+1' } },
    { id: 'k2', row: 0, col: 1, label: 'Normal', action: { type: 'hotkey', keys: 'ctrl+2' } },
  ];
  cfg.schedules = [{ id: 's1', name: 'Matin', time: '09:30', days: [1], page: cfg.pages[0].id, btn: 'k2', on: true }];
  st.save(cfg);
  assert.ok(st.config.settings.pinHash && !('pin' in st.config.settings), 'PIN haché, jamais en clair');
  assert.ok(!JSON.stringify(st.publicConfig('x')).includes(st.config.settings.pinHash), 'hash non envoyé au téléphone');
  assert.strictEqual(st.publicConfig('x').ui.pin, true);
  const pg = st.config.pages[0].id; const tk = st.config.settings.token;

  const p1 = await open(`ws://127.0.0.1:${pt}/ws?t=${tk}`); await wait(120);
  assert.ok(p1.msgs.some((m) => m.t === 'locked') && !p1.msgs.some((m) => m.t === 'config'), 'config retenue tant que verrouillé');
  p1.ws.send(JSON.stringify({ t: 'press', page: pg, id: 'k2' })); await wait(80);
  assert.strictEqual(ran2.length, 0, 'aucun appui avant déverrouillage');
  p1.ws.send(JSON.stringify({ t: 'unlock', pin: '0000' })); await wait(80);
  assert.ok(p1.msgs.some((m) => m.t === 'unlock' && m.ok === false));
  p1.ws.send(JSON.stringify({ t: 'unlock', pin: '4321' })); await wait(120);
  assert.ok(p1.msgs.some((m) => m.t === 'unlock' && m.ok === true) && p1.msgs.some((m) => m.t === 'config'), 'déverrouillé + config');
  p1.ws.send(JSON.stringify({ t: 'press', page: pg, id: 'k2' })); await wait(80);
  assert.strictEqual(ran2.length, 1);
  p1.ws.send(JSON.stringify({ t: 'press', page: pg, id: 'k1' })); await wait(80);
  assert.strictEqual(ran2.length, 1, 'confirmation exigée');
  assert.ok(p1.msgs.some((m) => m.t === 'ack' && m.id === 'k1' && m.ok === false));
  await wait(40);
  p1.ws.send(JSON.stringify({ t: 'press', page: pg, id: 'k1', confirmed: true })); await wait(80);
  assert.strictEqual(ran2.length, 2);
  p1.ws.send(JSON.stringify({ t: 'lock' })); await wait(60);
  await wait(40); p1.ws.send(JSON.stringify({ t: 'press', page: pg, id: 'k2' })); await wait(80);
  assert.strictEqual(ran2.length, 2, 'verrouillé par la veille');

  // 5 mauvais essais → pause 30 s, même avec le bon code
  const p2 = await open(`ws://127.0.0.1:${pt}/ws?t=${tk}`); await wait(100);
  for (let i = 0; i < 5; i++) p2.ws.send(JSON.stringify({ t: 'unlock', pin: '1111' }));
  await wait(120);
  p2.ws.send(JSON.stringify({ t: 'unlock', pin: '4321' })); await wait(80);
  const last = p2.msgs.filter((m) => m.t === 'unlock').pop();
  assert.ok(last.ok === false && last.wait > 0, 'limitation des essais');

  // retrait du PIN : le verrou tombe
  const c2 = JSON.parse(JSON.stringify(st.config)); c2.settings.pin = ''; st.save(c2); sv.broadcastConfig(); await wait(100);
  assert.ok(p2.msgs.filter((m) => m.t === 'config').length >= 1, 'config envoyée après retrait du PIN');

  // trigger (raccourci PC / planning)
  ran2.length = 0;
  assert.strictEqual(await sv.trigger(pg, 'k2', 'PC'), true); assert.strictEqual(ran2.length, 1);
  assert.strictEqual(await sv.trigger(pg, 'inconnu'), false);
  const rt = new Runtime({ store: st, actions: { }, obs: new Obs(), getServer: () => sv });
  const mon = new Date(2026, 10, 16, 9, 30, 5); // lundi 16 nov. 2026
  assert.strictEqual(mon.getDay(), 1);
  assert.deepStrictEqual(rt.tickSchedules(mon), ['s1']); await wait(50);
  assert.strictEqual(ran2.length, 2, 'planning exécuté');
  assert.deepStrictEqual(rt.tickSchedules(mon), [], 'une seule fois par minute');
  assert.deepStrictEqual(rt.tickSchedules(new Date(2026, 10, 17, 9, 30)), [], 'mauvais jour');
  rt.stop();

  // sauvegarde quotidienne
  const bk = path.join(dir2, 'backups');
  new St(dir2); assert.ok(fs.readdirSync(bk).some((f) => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f)), 'sauvegarde créée');
  p1.ws.close(); p2.ws.close(); sv.stop();
}

// --- v5 : souris, volume par appli, média, météo, mises à jour, HTTPS, profils par téléphone, luminosité ---
async function extra3() {
  const { Actions, parseNowPlaying } = require('../src/actions');
  const { fetchWeather, iconFor } = require('../src/weather');
  const { checkLatest, isNewer } = require('../src/updates');
  const { getCert } = require('../src/tls');
  const { Store: St, sanitize } = require('../src/store');
  const { Runtime } = require('../src/runtime');
  const { Obs } = require('../src/obs');

  // actions PowerShell : commandes émises (PowerShell remplacé par un enregistreur)
  const sent = [];
  const a = new Actions({ platform: 'win32' });
  a._send = (l) => { sent.push(l); if (l.startsWith('AV ')) { const w = a.appWaiters.shift(); if (w) w(l.includes('introuvable') ? 0 : 2); } };
  await a.run({ type: 'mouse', mode: 'click', current: true });
  await a.run({ type: 'mouse', mode: 'double', x: 120, y: 340, current: false });
  await a.run({ type: 'mouse', mode: 'right', current: true });
  await a.run({ type: 'mouse', mode: 'scrolldown', x: 10, y: 20, current: false, amount: 2 });
  await a.run({ type: 'mouse', mode: 'scrollup', current: true, amount: 1 });
  assert.deepStrictEqual(sent, ['MC -1 -1 0 1', 'MC 120 340 0 2', 'MC -1 -1 1 1', 'MC 10 20 3 1', 'MW -240', 'MW 120']);
  sent.length = 0;
  await a.run({ type: 'appvolume', process: 'spotify', mode: 'up', value: 5 });
  await a.run({ type: 'appvolume', process: 'chrome', mode: 'down', value: 10 });
  await a.run({ type: 'appvolume', process: 'vlc', mode: 'set', value: 40 });
  await a.run({ type: 'appvolume', process: 'vlc', mode: 'toggle', value: 40 });
  assert.deepStrictEqual(sent, ['AV 4 0.05 spotify', 'AV 4 -0.1 chrome', 'AV 0 0.4 vlc', 'AV 3 0 vlc']);
  await assert.rejects(() => a.run({ type: 'appvolume', process: '', mode: 'mute' }), /vide/);
  const a2 = new Actions({ platform: 'win32' }); a2._send = (l) => { const w = a2.appWaiters.shift(); if (w) w(0); };
  await assert.rejects(() => a2.run({ type: 'appvolume', process: 'rien', mode: 'mute' }), /aucun son/);
  assert.strictEqual(parseNowPlaying('1 ' + Buffer.from('Titre\nArtiste').toString('base64')).title, 'Titre');
  assert.strictEqual(parseNowPlaying('1 ' + Buffer.from('Titre\nArtiste').toString('base64')).playing, true);
  assert.strictEqual(parseNowPlaying('0 '), null);
  const hdr = []; const web = require('http').createServer((req, res) => { hdr.push(req.headers.authorization + '|' + req.headers['x-a']); res.end('ok'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  await new Actions({ platform: 'linux' }).run({ type: 'http', url: `http://127.0.0.1:${web.address().port}/`, method: 'GET', headers: 'Authorization: Bearer {date}x\nX-A: 1' });
  assert.ok(/^Bearer \d\d\/\d\d\/\d{4}x\|1$/.test(hdr[0]), 'en-têtes HTTP envoyés'); web.close();

  // météo : appels simulés
  const calls = [];
  const fake = async (url) => { calls.push(url); return { ok: true, json: async () => (url.includes('geocoding') ? { results: [{ latitude: 43.8, longitude: 5.0, name: 'Cavaillon' }] } : { current: { temperature_2m: 17.6, weather_code: 3 } }) }; };
  const w1 = await fetchWeather('Cavaillon', null, fake);
  assert.deepStrictEqual(w1.weather, { t: 18, icon: '☁️', city: 'Cavaillon' }); assert.strictEqual(calls.length, 2);
  await fetchWeather('Cavaillon', w1.geo, fake); assert.strictEqual(calls.length, 3, 'géocodage mis en cache');
  await assert.rejects(() => fetchWeather('Nullepart', null, async () => ({ ok: true, json: async () => ({}) })), /introuvable/);
  assert.strictEqual(iconFor(0), '☀️'); assert.strictEqual(iconFor(95), '⛈️');

  // mises à jour
  assert.ok(isNewer('v1.2.0', '1.1.9') && isNewer('2.0', '1.9.9') && !isNewer('1.0.0', '1.0.0') && !isNewer('v0.9', '1.0.0'));
  const rel = await checkLatest('moi/decklan', '1.0.0', async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v1.1.0', html_url: 'https://github.com/moi/decklan/releases/tag/v1.1.0' }) }));
  assert.ok(rel.newer && rel.url.includes('github.com'));
  await assert.rejects(() => checkLatest('pas un depot', '1.0.0'), /invalide/);
  await assert.rejects(() => checkLatest('a/b', '1.0.0', async () => ({ ok: false, status: 404 })), /Aucune release/);
  assert.strictEqual(sanitize({ settings: { updateRepo: 'x y' } }, null).settings.updateRepo, '');
  assert.strictEqual(sanitize({ settings: { updateRepo: 'moi/decklan', lang: 'en' } }, null).settings.lang, 'en');

  // serveur HTTPS + profils par téléphone + curseur de luminosité + météo poussée
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'decklan3-'));
  const cert = await getCert(dir3, 'decklan.local', ['192.168.1.5']);
  assert.ok(cert.key.includes('PRIVATE KEY') && cert.cert.includes('CERTIFICATE'));
  assert.strictEqual((await getCert(dir3, 'decklan.local')).cert, cert.cert, 'certificat réutilisé');
  const st = new St(dir3); const ran3 = []; const bri = [];
  const sv = new DeckServer({ store: st, actions: { run: async (x) => { ran3.push(x); }, setBrightness: (v) => bri.push(v) }, phoneDir: path.join(__dirname, '..', 'phone'), pcName: 'T3' });
  const cfg = JSON.parse(JSON.stringify(st.config));
  cfg.settings.perPhoneProfiles = true; cfg.settings.weatherCity = 'Cavaillon';
  cfg.pages = [{ id: 'home', name: 'Accueil', cols: 3, rows: 2, buttons: [
    { id: 'go', row: 0, col: 0, label: 'Jeu', action: { type: 'profile', profileId: 'jeu' } },
    { id: 'br', row: 0, col: 1, w: 2, widget: 'brightness' }, { id: 'xx', row: 1, col: 0, label: 'X', action: { type: 'hotkey', keys: 'ctrl+1' } }] }];
  cfg.profiles = [{ id: 'jeu', name: 'Jeu', pages: [{ id: 'g', name: 'G', cols: 2, rows: 1, buttons: [{ id: 'tir', row: 0, col: 0, label: 'Tir', action: { type: 'hotkey', keys: 'space' } }] }] }];
  st.save(cfg);
  const pt = await sv.start(0, cert); assert.strictEqual(sv.scheme, 'https');
  const tk = st.config.settings.token;
  const secure = (url) => new Promise((res, rej) => { const ws = new WebSocket(url, { rejectUnauthorized: false }); const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d))); ws.on('open', () => res({ ws, msgs })); ws.on('error', rej); });
  const pageOk = await new Promise((res, rej) => require('https').get({ port: pt, path: '/', rejectUnauthorized: false }, (r) => res(r.statusCode)).on('error', rej));
  assert.strictEqual(pageOk, 200, 'page servie en HTTPS');
  const A = await secure(`wss://127.0.0.1:${pt}/ws?t=${tk}`); const B = await secure(`wss://127.0.0.1:${pt}/ws?t=${tk}`); await wait(150);
  const lastCfg = (c) => c.msgs.filter((m) => m.t === 'config').pop();
  assert.strictEqual(lastCfg(A).config.pages[0].id, 'home');
  A.ws.send(JSON.stringify({ t: 'press', page: 'home', id: 'go' })); await wait(150);
  assert.strictEqual(lastCfg(A).config.profile, 'Jeu', 'A est passé sur Jeu');
  assert.strictEqual(lastCfg(B).config.profile, 'Principal', 'B n\'a pas bougé');
  assert.strictEqual(st.config.profile.id, 'main', 'profil global inchangé');
  A.ws.send(JSON.stringify({ t: 'press', page: 'g', id: 'tir' })); B.ws.send(JSON.stringify({ t: 'press', page: 'g', id: 'tir' })); await wait(150);
  assert.strictEqual(ran3.length, 1, 'B ne peut pas presser un bouton d\'un profil qu\'il ne voit pas');
  B.ws.send(JSON.stringify({ t: 'bri', page: 'home', id: 'br', v: 65 })); B.ws.send(JSON.stringify({ t: 'bri', page: 'home', id: 'xx', v: 5 })); await wait(120);
  assert.deepStrictEqual(bri, [65], 'curseur de luminosité : widget seulement');
  assert.ok(A.msgs.some((m) => m.t === 'sys' && m.bri === 65));
  const rt = new Runtime({ store: st, actions: {}, obs: new Obs(), getServer: () => sv });
  const wres = await rt.pollWeather(fake); await wait(100);
  assert.strictEqual(wres.t, 18); assert.ok(A.msgs.some((m) => m.t === 'sys' && m.weather && m.weather.icon === '☁️'), 'météo poussée');
  A.ws.close(); await wait(80);
  const A2 = await secure(`wss://127.0.0.1:${pt}/ws?t=${tk}`); await wait(150);
  assert.strictEqual(lastCfg(A2).config.profile, 'Jeu', 'le téléphone retrouve son profil (même adresse)');
  // option désactivée : retour au profil global
  const c3 = JSON.parse(JSON.stringify(st.config)); c3.settings.perPhoneProfiles = false; st.save(c3); sv.broadcastConfig(); await wait(120);
  assert.strictEqual(lastCfg(A2).config.profile, 'Principal');
  rt.stop(); A2.ws.close(); B.ws.close(); sv.stop();
}
