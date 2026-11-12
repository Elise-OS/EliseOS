#!/usr/bin/env node
// Turns the raw simulator screenshots of apps/mobile/scripts/store-screenshots.sh
// (fastlane layout: <dir>/<store-locale>/<iphone|ipad>-NN-<localized-name>.png)
// into the landing assets: eliselanding/public/screenshots/<lang>/mobile/<view>.webp + @2x.webp.
//
// Usage: node scripts/import-mobile-screenshots.mjs --from=<dir> [--languages=fr,en,es,it,pt]
// The views keep the same file names in every language (the French names), so the landing
// resolves them like the desktop views: /screenshots/<lang>/mobile/<view>.webp.

import { access, mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landingDir = path.join(rootDir, 'eliselanding');
const sharpEntry = path.join(
  process.env.CAPTURE_NODE_MODULES ?? path.join(landingDir, 'node_modules'),
  'sharp/dist/index.mjs',
);
try {
  await access(sharpEntry);
} catch {
  throw new Error(`Missing sharp. Run \`npm ci\` in ${landingDir}, or set CAPTURE_NODE_MODULES.`);
}
const { default: sharp } = await import(pathToFileURL(sharpEntry).href);

const storeLocale = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', it: 'it', pt: 'pt-PT' };
// Canonical view names (used by the landing), by device and number.
const views = {
  iphone: {
    '01': 'bienvenue',
    '02': 'tableau-de-bord',
    '03': 'alertes',
    '04': 'logement',
    '05': 'piece',
    '06': 'liaison',
    '07': 'affichage-tv',
  },
  ipad: {
    '01': 'tableau-de-bord',
    '02': 'alertes',
    '03': 'logement',
    '04': 'liaison',
    '05': 'affichage-tv',
  },
};
// 1x output size (the @2x file is twice as large).
const size = { iphone: [440, 956], ipad: [600, 800] };

const option = (name) =>
  process.argv
    .slice(2)
    .find((a) => a.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const from = option('--from');
if (!from)
  throw new Error('Usage: import-mobile-screenshots.mjs --from=<dir> [--languages=fr,en,es,it,pt]');
const languages = (option('--languages') ?? Object.keys(storeLocale).join(','))
  .split(',')
  .filter(Boolean);

for (const language of languages) {
  if (!storeLocale[language]) throw new Error(`Unsupported language: ${language}`);
  const sourceDir = path.join(from, storeLocale[language]);
  const outputDir = path.join(landingDir, 'public/screenshots', language, 'mobile');
  await mkdir(outputDir, { recursive: true });
  const files = readdirSync(sourceDir).filter((f) => f.endsWith('.png'));
  for (const [device, byNumber] of Object.entries(views)) {
    for (const [number, name] of Object.entries(byNumber)) {
      const file = files.find((f) => f.startsWith(`${device}-${number}-`));
      if (!file) throw new Error(`Missing ${device}-${number}-* in ${sourceDir}`);
      const [width, height] = size[device];
      for (const [suffix, factor] of [
        ['', 1],
        ['@2x', 2],
      ]) {
        await sharp(path.join(sourceDir, file))
          .resize(width * factor, height * factor, { fit: 'fill' })
          .webp({ quality: 82, effort: 6 })
          .toFile(path.join(outputDir, `${device}-${number}-${name}${suffix}.webp`));
      }
    }
  }
  console.log(
    `${language}: ${Object.keys(views.iphone).length} iPhone + ${Object.keys(views.ipad).length} iPad views`,
  );
}
