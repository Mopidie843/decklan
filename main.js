'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, clipboard, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');
const { Store } = require('./src/store');
const { Actions } = require('./src/actions');
const { DeckServer } = require('./src/server');
const { Obs } = require('./src/obs');
const { Runtime } = require('./src/runtime');
const { collect } = require('./src/shortcuts');
const { getCert } = require('./src/tls');
const { checkLatest } = require('./src/updates');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// --- faible RAM : pas de GPU process, V8 plafonné, pas de réseau de fond ---
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=64');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion');

let win = null, tray = null, store = null, actions = null, server = null, obs = null, runtime = null;
let quitting = false;
let serverError = null;
let chosenIp = null;
let lastPressed = null;
let qrCache = { url: '', data: null };
let qrAppCache = { url: '', data: null };
const journal = []; // derniers appuis et erreurs (mémoire seulement, 100 entrées)

function logEntry(kind, text) {
  const e = { t: Date.now(), kind, text: String(text).slice(0, 300) };
  journal.push(e); if (journal.length > 100) journal.shift();
  if (win && !win.isDestroyed()) win.webContents.send('log', e);
}

// Raccourcis globaux : relus depuis la config à chaque changement (profil actif uniquement).
function registerShortcuts() {
  try { globalShortcut.unregisterAll(); } catch { /* ok */ }
  const failed = [];
  for (const sc of collect(store.config.pages)) {
    let ok = false;
    try { ok = globalShortcut.register(sc.accelerator, () => { if (server) server.trigger(sc.page, sc.btn, 'Raccourci ' + sc.accelerator); }); } catch { ok = false; }
    if (!ok) failed.push(sc.accelerator);
  }
  if (failed.length) logEntry('err', 'Raccourci déjà pris par une autre appli : ' + failed.join(', '));
}

function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      out.push({ name, ip: i.address, priv });
    }
  }
  out.sort((a, b) => Number(b.priv) - Number(a.priv));
  return out;
}

async function buildStatus() {
  const ips = lanIps();
  const ip = (chosenIp && ips.find((x) => x.ip === chosenIp)) ? chosenIp : (ips[0] && ips[0].ip) || '127.0.0.1';
  const s = store.config.settings;
  const port = server && server.port;
  const host = s.mdns && s.qrHost === 'mdns' ? `${s.hostname}.local` : ip;
  const sch = (server && server.scheme) || 'http';
  const url = port ? `${sch}://${host}:${port}/?t=${s.token}` : null;
  const ipUrl = port ? `${sch}://${ip}:${port}/?t=${s.token}` : null;
  const nameUrl = port && s.mdns ? `${sch}://${s.hostname}.local:${port}/?t=${s.token}` : null;
  let qr = null;
  if (url) {
    if (qrCache.url !== url) qrCache = { url, data: await QRCode.toDataURL(url, { margin: 1, width: 420, errorCorrectionLevel: 'M' }) };
    qr = qrCache.data;
  }
  let qrApp = null; // lien decklan:// : ouvre directement l'application Android quand on le scanne avec l'appareil photo
  if (url) {
    const link = `decklan://pair?u=${encodeURIComponent(url)}`;
    if (qrAppCache.url !== link) qrAppCache = { url: link, data: await QRCode.toDataURL(link, { margin: 1, width: 420, errorCorrectionLevel: 'M' }) };
    qrApp = qrAppCache.data;
  }
  return {
    running: !!port, port, error: serverError, ips, ip, url, ipUrl, nameUrl, qr, qrApp, token: s.token, obs: { enabled: s.obsEnabled, connected: !!(obs && obs.connected) },
    clients: server ? server.clientList() : [], pcName: os.hostname(), lastPressed,
  };
}

async function pushStatus() {
  syncRuntime();
  if (win && !win.isDestroyed()) win.webContents.send('status', await buildStatus());
}

function syncRuntime() { if (runtime) runtime.sync(); }

async function startServer() {
  if (server) { server.stop(); server = null; }
  serverError = null;
  server = new DeckServer({ store, actions, phoneDir: path.join(__dirname, 'phone'), pcName: os.hostname() });
  server.on('clients', pushStatus);
  server.on('profile', () => { registerShortcuts(); if (win && !win.isDestroyed()) win.webContents.send('config', store.config); });
  server.setSys({ obsrec: obs.state.obsrec, obsstream: obs.state.obsstream });
  server.on('pressed', (p) => { logEntry('press', `${p.label} (${p.ip})`); lastPressed = p; setTimeout(() => runtime && runtime.pollAudio(), 200); if (win && !win.isDestroyed()) win.webContents.send('pressed', p); });
  server.on('action-error', (m) => { logEntry('err', m); if (win && !win.isDestroyed()) win.webContents.send('toast', { kind: 'err', text: m }); });
  try {
    const st = store.config.settings;
    const tls = st.https ? await getCert(app.getPath('userData'), `${st.hostname}.local`, lanIps().map((x) => x.ip)) : null;
    await server.start(st.port, tls);
    server.startHeartbeat();
  } catch (e) {
    serverError = e.code === 'EADDRINUSE' ? `Port ${store.config.settings.port} déjà utilisé. Change-le dans Réglages.` : e.message;
    server = null;
  }
  pushStatus();
}

function applyLoginItem() {
  try { app.setLoginItemSettings({ openAtLogin: !!store.config.settings.autostart, args: ['--hidden'] }); } catch { /* dev */ }
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 640, show,
    backgroundColor: '#0e0f14', title: 'DeckLan', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Fermer = détruire la fenêtre (libère le process de rendu, ~100 Mo). Le serveur continue dans le tray.
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('DeckLan');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir DeckLan', click: () => showWin() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
}

function showWin() {
  if (!win || win.isDestroyed()) createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

ipcMain.handle('state:get', async () => ({ config: store.config, status: await buildStatus() }));

ipcMain.handle('config:save', async (_e, cfg) => {
  const oldPort = store.config.settings.port; const oldHttps = store.config.settings.https; const oldHost = store.config.settings.hostname;
  const saved = store.save(cfg);
  applyLoginItem();
  registerShortcuts();
  if (saved.settings.port !== oldPort || saved.settings.https !== oldHttps || (saved.settings.https && saved.settings.hostname !== oldHost)) await startServer();
  else if (server) server.broadcastConfig();
  pushStatus();
  return saved;
});

ipcMain.handle('token:regen', async () => {
  store.regenToken();
  if (server) server.kick();
  await pushStatus();
  return store.config;
});

ipcMain.handle('action:test', async (_e, action) => {
  const { sanitize } = require('./src/store');
  // Passe par sanitize pour ne jamais exécuter une action mal formée.
  const clean = sanitize({ pages: [{ id: 't', buttons: [{ id: 't', row: 0, col: 0, action }] }] }, store.config).pages[0].buttons[0].action;
  try { await actions.run(clean, { onError: (m) => win && win.webContents.send('toast', { kind: 'err', text: m }) }); return { ok: true }; }
  catch (e) { return { ok: false, err: e.message }; }
});

ipcMain.handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Choisir une application ou un fichier' });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('config:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'decklan-config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return false;
  const copy = JSON.parse(JSON.stringify(store.config));
  delete copy.settings.token; // le token reste propre à ce PC
  fs.writeFileSync(r.filePath, JSON.stringify(copy, null, 2));
  return true;
});

ipcMain.handle('config:import', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const saved = store.save({ ...raw, settings: { ...store.config.settings, ...(raw.settings || {}) } });
    if (server) server.broadcastConfig();
    return saved;
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('profile:export', async (_e, data) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: `decklan-profil-${String((data && data.name) || 'profil').replace(/[^\w-]+/g, '_')}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, JSON.stringify({ decklanProfile: 1, name: data.name, pages: data.pages }, null, 2));
  return true;
});
ipcMain.handle('profile:import', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!raw || !Array.isArray(raw.pages)) throw new Error('Fichier de profil invalide');
    return { name: raw.name, pages: raw.pages };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('obs:scenes', async () => { try { return { ok: true, scenes: await obs.scenes() }; } catch (e) { return { ok: false, err: e.message }; } });
// Capture de la position de la souris : 3 s pour la placer, puis lecture.
ipcMain.handle('mouse:pos', async () => { await new Promise((r) => setTimeout(r, 3000)); const p = await actions.mousePos(); return p ? { ok: true, ...p } : { ok: false, err: 'Position indisponible (Windows uniquement)' }; });
ipcMain.handle('update:check', async () => {
  try {
    const r = await checkLatest(store.config.settings.updateRepo, app.getVersion());
    if (r.newer && /^https:\/\/github\.com\//.test(r.url)) shell.openExternal(r.url);
    return { ok: true, ...r };
  } catch (e) { return { ok: false, err: e.message }; }
});
ipcMain.handle('log:get', () => journal.slice());
ipcMain.handle('net:setIp', async (_e, ip) => { chosenIp = ip; await pushStatus(); });
ipcMain.handle('clipboard:write', (_e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('phone:open', async () => { const s = await buildStatus(); if (s.url) shell.openExternal(s.url); });

app.on('second-instance', showWin);

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  obs = new Obs();
  actions = new Actions({ shell, clipboard, obs, workDir: path.join(app.getPath('userData'), 'runtime') });
  runtime = new Runtime({ store, actions, obs, getServer: () => server });
  obs.on('connection', () => pushStatus());
  applyLoginItem();
  const hidden = process.argv.includes('--hidden') || store.config.settings.startHidden;
  if (!hidden) createWindow(true);
  createTray();
  await startServer();
  registerShortcuts();
  if (store.config.settings.updateRepo) setTimeout(async () => { // vérification discrète au démarrage
    try { const r = await checkLatest(store.config.settings.updateRepo, app.getVersion()); if (r.newer) logEntry('press', `Nouvelle version ${r.latest} disponible : ${r.url}`); } catch { /* hors ligne */ }
  }, 20000);
});

app.on('before-quit', () => { quitting = true; try { globalShortcut.unregisterAll(); } catch { /* ok */ } if (runtime) runtime.stop(); if (server) server.stop(); if (actions) actions.stop(); });
app.on('window-all-closed', () => { if (!store.config.settings.minimizeToTray || quitting) app.quit(); });
