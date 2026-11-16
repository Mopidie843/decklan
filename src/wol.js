'use strict';
// Wake-on-LAN : paquet magique UDP (6 x 0xFF puis 16 x adresse MAC).
const dgram = require('dgram');

const MAC_RE = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;

function magicPacket(mac) {
  if (!MAC_RE.test(mac || '')) throw new Error('Adresse MAC invalide (ex : AA:BB:CC:DD:EE:FF)');
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(bytes)]);
}

// ip : adresse de broadcast ciblée (défaut 255.255.255.255). port : 9 (standard).
function sendMagic(mac, { ip = '255.255.255.255', port = 9 } = {}) {
  const pkt = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', (e) => { try { sock.close(); } catch { /* ok */ } reject(e); });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* ok */ }
      sock.send(pkt, port, ip || '255.255.255.255', (err) => { sock.close(); err ? reject(err) : resolve(); });
    });
  });
}

module.exports = { magicPacket, sendMagic, MAC_RE };
