'use strict';
// Remplace l'icône de DeckLan.exe (Electron par défaut) sans Wine : resedit est du JS pur.
// Exécuté par electron-builder (build.afterPack) quand win.signAndEditExecutable = false.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  let ResEdit;
  try { ResEdit = require('resedit'); } catch { console.warn('[after-pack] resedit absent : icône de l’exe inchangée (npm i -D resedit)'); return; }
  const exePath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ctx.packager.projectDir, 'assets', 'icon.ico')));
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033, ico.icons.map((i) => i.data));
  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (info) {
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    info.setFileVersion(v[0] || 1, v[1] || 0, v[2] || 0, 0, 1033);
    info.setProductVersion(v[0] || 1, v[1] || 0, v[2] || 0, 0, 1033);
    info.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'DeckLan', FileDescription: 'DeckLan — Stream Deck sur téléphone', CompanyName: 'DeckLan', LegalCopyright: 'DeckLan', OriginalFilename: 'DeckLan.exe', InternalName: 'DeckLan',
    });
    info.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[after-pack] icône + infos appliquées à', path.basename(exePath));
};
