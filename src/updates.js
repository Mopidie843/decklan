'use strict';
// Vérifie la dernière version publiée sur GitHub (releases). Ne télécharge ni n'installe rien : ouvre la page.
const num = (v) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
function isNewer(latest, current) {
  const a = num(latest), b = num(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; }
  return false;
}

async function checkLatest(repo, current, f = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Dépôt GitHub invalide (format : utilisateur/depot)');
  const res = await f(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeckLan' }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new Error('Aucune release publiée sur ce dépôt');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const latest = String(j.tag_name || '');
  return { latest, current, newer: isNewer(latest, current), url: String(j.html_url || `https://github.com/${repo}/releases`) };
}

module.exports = { checkLatest, isNewer };
