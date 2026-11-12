#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const landingDir = path.join(rootDir, 'eliselanding');

async function dependency(name, entry = 'index.mjs') {
  const modulesDir = process.env.CAPTURE_NODE_MODULES ?? path.join(landingDir, 'node_modules');
  const candidate = path.join(modulesDir, name, entry);
  try {
    await access(candidate);
  } catch {
    throw new Error(
      `Missing ${name}. Run \`npm ci\` in ${landingDir}, or set CAPTURE_NODE_MODULES.`,
    );
  }
  return import(pathToFileURL(candidate).href);
}

const [{ chromium }, { default: sharp }] = await Promise.all([
  dependency('playwright'),
  dependency('sharp', 'dist/index.mjs'),
]);

const supportedLanguages = ['fr', 'en', 'es', 'it', 'pt'];
const localeByLanguage = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', it: 'it-IT', pt: 'pt-PT' };
const args = process.argv.slice(2);
const option = (name) => {
  const item = args.find((argument) => argument.startsWith(`${name}=`));
  return item?.slice(name.length + 1);
};
const requestedLanguages = (option('--languages') ?? supportedLanguages.join(','))
  .split(',')
  .filter(Boolean);
const unknownLanguages = requestedLanguages.filter(
  (language) => !supportedLanguages.includes(language),
);
if (unknownLanguages.length)
  throw new Error(`Unsupported languages: ${unknownLanguages.join(', ')}`);

const baseURL = option('--url') ?? process.env.DEMO_URL ?? 'http://127.0.0.1:18091/demo/';
const parsedURL = new URL(baseURL);
if (!['127.0.0.1', 'localhost'].includes(parsedURL.hostname)) {
  throw new Error('Only an isolated local demo may be used for product captures.');
}

const execFileAsync = promisify(execFile);
const sourceCommit =
  process.env.SOURCE_COMMIT ??
  (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootDir })).stdout.trim();
const browser = await chromium.launch({ headless: true });

const screenshotCSS = `
  .demo-bar, .demo-bar-reopen, .demo-sidebar-toggle, .demo-call { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function newPage(language, viewport, deviceScaleFactor = 1, view = 'aidant') {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    locale: localeByLanguage[language],
    timezoneId: 'Europe/Paris',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((selectedLanguage) => {
    localStorage.clear();
    localStorage.setItem('elise_locale', selectedLanguage);
    localStorage.setItem('elise_sidebar_auto_hide', 'false');
    localStorage.setItem('elise_demo_sidebar_closed', 'false');
  }, language);
  const page = await context.newPage();
  const url = new URL(baseURL);
  url.searchParams.set('lang', language);
  if (view === 'tv') url.searchParams.set('vue', 'tv');
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: screenshotCSS });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return { context, page };
}

async function settle(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll('[open]')) element.removeAttribute('open');
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);
}

const identifierPattern =
  /paul@|michel\.local|\b12\s+rue\b|rtsp:|(?:access[_ -]?)?token\s*[=:]|password\s*[=:]/i;
async function assertFictionalDemo(page, id) {
  const text = await page.locator('body').innerText();
  const match = text.match(identifierPattern);
  if (match) throw new Error(`Potential non-demo identifier in ${id}: ${match[0]}`);
  if (!/Martin|Jeanne|Claire/.test(text)) {
    throw new Error(`The expected fictional Martin household is absent from ${id}.`);
  }
}

async function jpeg(page, target) {
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 91,
    animations: 'disabled',
    fullPage: false,
  });
  await writeFile(target, buffer);
}

async function webpPair(page, targetBase, capture) {
  const png = await capture();
  const image = sharp(png);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read capture ${targetBase}`);
  await image.clone().webp({ quality: 84, effort: 5 }).toFile(`${targetBase}@2x.webp`);
  await image
    .clone()
    .resize(Math.round(metadata.width / 2), Math.round(metadata.height / 2), {
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: 84, effort: 5 })
    .toFile(`${targetBase}.webp`);
}

async function selectNavigation(page, index) {
  await page.locator(`[data-tour-target="nav-${index}"]`).click();
  await page.waitForLoadState('networkidle');
  await settle(page);
}

async function captureReadme(language) {
  const outputDir = path.join(rootDir, 'docs', 'images', language);
  await mkdir(outputDir, { recursive: true });
  const { context, page } = await newPage(language, { width: 1600, height: 1000 });
  await page.locator('.sidebar-navigation').waitFor();
  const views = [
    ['accueil', 0],
    ['activite', 1],
    ['alertes', 2],
    ['liaison', 11],
    ['affichage-tv', 10],
    ['logement', 3],
    ['proches', 7],
    ['reglages', 8],
  ];
  for (const [id, index] of views) {
    await selectNavigation(page, index);
    await assertFictionalDemo(page, `README ${language}/${id}`);
    await jpeg(page, path.join(outputDir, `${id}.jpg`));
  }
  await context.close();

  const mobile = await newPage(language, { width: 739, height: 1600 });
  await mobile.page.locator('.welcome-page').waitFor();
  await settle(mobile.page);
  await assertFictionalDemo(mobile.page, `README ${language}/mobile-accueil`);
  await jpeg(mobile.page, path.join(outputDir, 'mobile-accueil.jpg'));
  await mobile.context.close();

  const tv = await newPage(language, { width: 1600, height: 900 }, 1, 'tv');
  await tv.page.locator('.resident-content').waitFor();
  await settle(tv.page);
  await assertFictionalDemo(tv.page, `README ${language}/tv-resident`);
  await jpeg(tv.page, path.join(outputDir, 'tv-resident.jpg'));
  await tv.context.close();
}

async function captureLanding(language) {
  const outputDir = path.join(landingDir, 'public', 'screenshots', language);
  await mkdir(outputDir, { recursive: true });
  const { context, page } = await newPage(language, { width: 2000, height: 1000 }, 2);
  await page.locator('.sidebar-navigation').waitFor();

  const mainClip = async (height) => {
    const main = await page.locator('main').boundingBox();
    if (!main) throw new Error('Dashboard main content is not visible.');
    return page.screenshot({
      type: 'png',
      animations: 'disabled',
      clip: { x: main.x, y: 0, width: Math.min(1600, main.width), height },
    });
  };

  await selectNavigation(page, 0);
  await assertFictionalDemo(page, `landing ${language}/accueil`);
  await webpPair(page, path.join(outputDir, 'accueil'), () => mainClip(910));
  await webpPair(page, path.join(outputDir, 'reperes'), () =>
    page.locator('.welcome-sensors').screenshot({ type: 'png', animations: 'disabled' }),
  );

  await selectNavigation(page, 3);
  await assertFictionalDemo(page, `landing ${language}/logement-config`);
  await webpPair(page, path.join(outputDir, 'logement-config'), () => mainClip(912));
  await page.locator('.add-sensor').click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor();
  const room = dialog
    .locator('button')
    .filter({ hasText: /Salle de bains|Bathroom|Baño|Bagno|Casa de banho/ });
  await room.last().click();
  await page.waitForTimeout(180);
  await page.addStyleTag({
    content: `
      .ss-backdrop { position: absolute !important; height: auto !important; min-height: 100%;
        place-items: start center !important; overflow: visible !important; }
      .ss-sheet { height: auto !important; max-height: none !important; overflow: visible !important; }
      .ss-body { flex: none !important; overflow: visible !important; }
    `,
  });
  await webpPair(page, path.join(outputDir, 'logement-ajout1'), () =>
    dialog.screenshot({ type: 'png', animations: 'disabled' }),
  );
  const contact = dialog
    .locator('button')
    .filter({ hasText: /Ouverture|Contact|Apertura|Abertura/ });
  await contact.first().click();
  await page.waitForTimeout(180);
  await webpPair(page, path.join(outputDir, 'logement-ajout2'), () =>
    dialog.screenshot({ type: 'png', animations: 'disabled' }),
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await selectNavigation(page, 10);
  await assertFictionalDemo(page, `landing ${language}/tv-aidant`);
  await webpPair(page, path.join(outputDir, 'tv-aidant'), () => mainClip(900));
  await page.locator('[role="tab"]').nth(1).click();
  await settle(page);
  await webpPair(page, path.join(outputDir, 'tv-aidant2'), () => mainClip(900));
  await context.close();

  const tv = await newPage(language, { width: 1600, height: 900 }, 2, 'tv');
  await tv.page.locator('.resident-content').waitFor();
  await settle(tv.page);
  await assertFictionalDemo(tv.page, `landing ${language}/tv-resident`);
  await webpPair(tv.page, path.join(outputDir, 'tv-resident'), () =>
    tv.page.screenshot({ type: 'png', animations: 'disabled', fullPage: false }),
  );
  await tv.context.close();
}

try {
  for (const language of requestedLanguages) {
    process.stdout.write(`Capturing desktop screenshots in ${language}...\n`);
    await captureReadme(language);
    await captureLanding(language);
  }
  const provenance = {
    product: 'Élise OS',
    sourceCommit,
    capturedAt: new Date().toISOString(),
    environment: `Local dashboard demo (${baseURL})`,
    data: 'Fictional Martin household bundled with demo mode. No field-trial data.',
    languages: requestedLanguages,
    naming: {
      readme: 'docs/images/<lang>/<view>.jpg',
      landing: 'eliselanding/public/screenshots/<lang>/<view>.webp and <view>@2x.webp',
    },
    method:
      'Actual application screens captured with Playwright from demo mode. No UI reconstruction or retouching.',
    antiIdentifiers:
      'Every view is checked for known credentials, addresses, stream URLs, tokens and passwords before it is written.',
  };
  await writeFile(
    path.join(landingDir, 'public', 'screenshots', 'provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
