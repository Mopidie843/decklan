'use strict';
// Certificat HTTPS auto-signé, créé une fois et gardé dans le dossier de config.
// Le navigateur du téléphone affiche un avertissement la première fois : à accepter (réseau local uniquement).
const fs = require('fs');
const path = require('path');

async function getCert(dir, host = 'decklan.local', ips = []) {
  const file = path.join(dir, 'tls.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && c.key && c.cert && c.host === host) return { key: c.key, cert: c.cert };
  } catch { /* à créer */ }
  const selfsigned = require('selfsigned');
  const alt = [{ type: 2, value: host }, { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))];
  const pems = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: host }], {
    days: 3650, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: alt }],
  }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ host, key: pems.private, cert: pems.cert }), { mode: 0o600 });
  return { key: pems.private, cert: pems.cert };
}

module.exports = { getCert };
