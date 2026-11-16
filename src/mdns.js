'use strict';
// Répond aux requêtes mDNS pour <nom>.local : le téléphone garde la même adresse même si l'IP du PC change.
const os = require('os');

function lanIpv4() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

// Calcule les réponses pour une liste de questions (testable sans réseau).
function answersFor(name, questions, ips) {
  const fqdn = name.toLowerCase() + '.local';
  const hit = (questions || []).some((q) => String(q.name || '').toLowerCase() === fqdn && (q.type === 'A' || q.type === 'ANY'));
  return hit ? ips.map((data) => ({ name: fqdn, type: 'A', ttl: 120, class: 'IN', flush: true, data })) : [];
}

class Responder {
  constructor() { this.m = null; this.name = null; }
  start(name) {
    this.stop(); this.name = name;
    try {
      this.m = require('multicast-dns')({ loopback: false });
      this.m.on('error', () => {});
      this.m.on('query', (q) => {
        const answers = answersFor(this.name, q.questions, lanIpv4());
        if (answers.length) this.m.respond({ answers });
      });
      return true;
    } catch { this.m = null; return false; }
  }
  stop() { if (this.m) { try { this.m.destroy(); } catch { /* ok */ } this.m = null; } }
}

module.exports = { Responder, answersFor, lanIpv4 };
