'use strict';
// Mode serveur sans fenêtre : pour une machine toujours allumée (portable, Raspberry Pi…),
// utile pour envoyer un Wake-on-LAN au PC principal. Usage : node src/headless.js [dossier-config]
const os = require('os');
const path = require('path');
const { Store } = require('./store');
const { Actions } = require('./actions');
const { Obs } = require('./obs');
const { DeckServer } = require('./server');
const { Runtime } = require('./runtime');
const { lanIpv4 } = require('./mdns');
const { getCert } = require('./tls');

(async () => {
  const dir = process.argv[2] || process.env.DECKLAN_DIR || path.join(os.homedir(), '.decklan');
  const store = new Store(dir);
  const obs = new Obs();
  const actions = new Actions({ obs, workDir: path.join(dir, 'runtime') });
  let server = null;
  const runtime = new Runtime({ store, actions, obs, getServer: () => server });
  server = new DeckServer({ store, actions, phoneDir: path.join(__dirname, '..', 'phone'), pcName: os.hostname() });
  server.on('clients', () => runtime.sync());
  server.on('action-error', (m) => console.error('[erreur]', m));
  server.on('pressed', (p) => console.log('[bouton]', p.label || p.id));
  const st0 = store.config.settings;
  const tls = st0.https ? await getCert(dir, `${st0.hostname}.local`, lanIpv4()) : null;
  const port = await server.start(st0.port, tls);
  const sch = server.scheme;
  server.startHeartbeat();
  runtime.sync();
  const s = store.config.settings;
  console.log(`DeckLan (sans fenêtre) — config : ${dir}`);
  for (const ip of lanIpv4()) console.log(`  ${sch}://${ip}:${port}/?t=${s.token}`);
  if (s.mdns) console.log(`  ${sch}://${s.hostname}.local:${port}/?t=${s.token}`);
  const bye = () => { runtime.stop(); server.stop(); actions.stop(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
})().catch((e) => { console.error(e.message); process.exit(1); });
