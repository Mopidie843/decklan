'use strict';
// Raccourcis clavier globaux sur le PC : « ctrl+alt+1 » déclenche un bouton sans toucher le téléphone.
const MODS = ['ctrl', 'alt', 'shift', 'win'];
const NAMED = ['space', 'enter', 'tab', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'esc', 'backspace',
  'plus', 'minus', 'numadd', 'numsub', 'nummult', 'numdiv', 'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9'];

function isKey(k) {
  return /^[a-z0-9]$/.test(k) || /^f([1-9]|1\d|2[0-4])$/.test(k) || NAMED.includes(k);
}

// Retourne la forme normalisée (« ctrl+alt+1 ») ou '' si invalide. Un modificateur est obligatoire.
function cleanShortcut(v) {
  if (typeof v !== 'string') return '';
  const parts = v.toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return '';
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!isKey(key) || !mods.every((m) => MODS.includes(m)) || new Set(mods).size !== mods.length) return '';
  mods.sort((a, b) => MODS.indexOf(a) - MODS.indexOf(b));
  return [...mods, key].join('+');
}

const NAME = { win: 'Super', esc: 'Escape', pageup: 'PageUp', pagedown: 'PageDown', numadd: 'numadd', numsub: 'numsub', nummult: 'nummult', numdiv: 'numdiv' };

// Format attendu par globalShortcut d'Electron.
function toAccelerator(s) {
  const c = cleanShortcut(s);
  if (!c) return null;
  return c.split('+').map((p) => {
    if (NAME[p]) return NAME[p];
    if (/^num\d$/.test(p)) return p;
    return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }).join('+');
}

// Liste {accelerator, page, btn} des boutons du profil actif ; un même raccourci n'est pris qu'une fois.
function collect(pages) {
  const seen = new Set(); const out = [];
  for (const p of pages) for (const b of p.buttons) {
    const acc = b.shortcut && toAccelerator(b.shortcut);
    if (!acc || seen.has(acc)) continue;
    seen.add(acc); out.push({ accelerator: acc, page: p.id, btn: b.id });
  }
  return out;
}

module.exports = { cleanShortcut, toAccelerator, collect };
