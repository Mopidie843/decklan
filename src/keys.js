'use strict';
// Nom de touche -> code VK Windows.
const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, meta: 0x5b, cmd: 0x5b,
  enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b, tab: 0x09, space: 0x20,
  backspace: 0x08, delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23,
  pageup: 0x21, pagedown: 0x22, up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  printscreen: 0x2c, pause: 0x13, capslock: 0x14, numlock: 0x90, scrolllock: 0x91, menu: 0x5d,
  ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
  '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde,
  volup: 0xaf, voldown: 0xae, mute: 0xad, next: 0xb0, prev: 0xb1, stop: 0xb2, playpause: 0xb3,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) { VK[String(i)] = 0x30 + i; VK['num' + i] = 0x60 + i; }
for (let i = 1; i <= 24; i++) VK['f' + i] = 0x6f + i;

// "Ctrl + Shift+M" -> [0x11, 0x10, 0x4d] ; null si touche inconnue.
function parseCombo(combo) {
  if (typeof combo !== 'string' || !combo.trim()) return null;
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const codes = [];
  for (const p of parts) {
    if (!(p in VK)) return null;
    codes.push(VK[p]);
  }
  return codes;
}

// Échappe le texte pour SendKeys (.NET).
function escapeSendKeys(text) {
  return String(text)
    .replace(/\r?\n/g, '\u0000ENTER\u0000')
    .replace(/[+^%~(){}[\]]/g, (c) => '{' + c + '}')
    .replace(/\u0000ENTER\u0000/g, '{ENTER}');
}

module.exports = { VK, parseCombo, escapeSendKeys };
