'use strict';
// Génère phone/icons.js et renderer/icons.js depuis lucide-static (licence ISC).
// Usage : npm i --no-save lucide-static && node scripts/gen-icons.js
const fs = require('fs'); const path = require('path');
const dir = path.join(require.resolve('lucide-static/package.json'), '..', 'icons');
const NAMES = `circle circle-dot disc play pause skip-forward skip-back square circle-play volume-2 volume-1 volume-x volume mic mic-off headphones music music-2 radio speaker video video-off camera camera-off clapperboard film tv monitor monitor-play laptop smartphone tablet keyboard mouse gamepad-2 joystick cpu hard-drive memory-stick wifi wifi-off bluetooth battery-charging power power-off lock lock-open unlock key shield shield-check settings sliders-horizontal wrench hammer cog folder folder-open file file-text files clipboard clipboard-copy clipboard-paste copy scissors save download upload trash-2 undo-2 redo-2 rotate-cw refresh-cw search zoom-in zoom-out globe link external-link mail message-circle message-square phone bell bell-off calendar clock timer alarm-clock hourglass sun moon sunrise cloud cloud-rain flame zap lightbulb plug star heart thumbs-up smile ghost bot rocket sparkles trophy target flag bookmark pin map-pin navigation home house user users eye eye-off image palette brush pen pencil type bold italic underline list layout-grid layout-dashboard columns-2 grid-3x3 maximize minimize arrow-up arrow-down arrow-left arrow-right chevron-up chevron-down chevron-left chevron-right plus minus x check circle-check circle-x circle-alert triangle-alert info help-circle badge-check shuffle repeat repeat-1 radio-tower cast airplay tv-minimal gauge activity bar-chart-3 line-chart pie-chart terminal code git-branch github twitch youtube chrome figma slack discord dices puzzle swords sword shield-half crosshair scan-eye scan-line wand-2 coffee pizza beer gift shopping-cart credit-card wallet banknote log-out send webhook calendar-clock plug-zap list-checks scroll-text mouse-pointer`.split(/\s+/);
const out = {}; const missing = [];
for (const n of NAMES) {
  const f = path.join(dir, n + '.svg');
  if (!fs.existsSync(f)) { missing.push(n); continue; }
  const svg = fs.readFileSync(f, 'utf8');
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (m) out[n] = m[1].replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}
const js = `'use strict';\n// Généré par scripts/gen-icons.js — icônes Lucide (ISC).\nwindow.DL_ICONS = ${JSON.stringify(out)};\n` +
  `window.dlIconSvg = function (name) { var p = window.DL_ICONS[name]; return p ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>' : ''; };\n`;
for (const t of ['phone', 'renderer']) fs.writeFileSync(path.join(__dirname, '..', t, 'icons.js'), js);
console.log(Object.keys(out).length, 'icônes', missing.length ? '| absentes : ' + missing.join(' ') : '');
