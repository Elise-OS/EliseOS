#!/usr/bin/env node
// Translation kit for people and agents: one flat file per block to fill, then back to the catalogs.
//
//   node packages/i18n/scripts/translations.mjs export <language> [--all]
//   node packages/i18n/scripts/translations.mjs import <language>
//   node packages/i18n/scripts/translations.mjs status
//   node packages/i18n/scripts/translations.mjs check
//
// export writes translations/<language>/<block>.json: for each text still missing (or every
// text with --all), the French source, the English translation and an empty value to fill.
// import reads those files back into each block's <language>.json, in the catalog layout
// (objects, lists, plural forms), and leaves texts left empty untouched.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Each block of Élise OS that has its own catalogs. */
const BLOCKS = {
  mobile: { catalogs: 'apps/mobile/src/i18n/locales', code: 'apps/mobile' },
  web: { catalogs: 'apps/dashboard/src/i18n/locales', code: 'apps/dashboard/src' },
  // The site reads its texts as objects (copy.nav.how), not through t(): no unused-text check.
  // Its catalogs also hold a few data fields (ids, icons, example times), never to translate.
  landing: {
    catalogs: 'eliselanding/src/i18n/locales',
    code: null,
    dataFields: /\.(id|icon|tone|time|sensor|state)$/,
  },
};
const SOURCE = 'fr';
const REFERENCE = 'en';
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

const [command, language, ...flags] = process.argv.slice(2);
const usage = () => {
  console.error(
    'Usage: translations.mjs export <language> [--all] | import <language> | status | check',
  );
  process.exit(2);
};
if (!['export', 'import', 'status', 'check'].includes(command ?? '')) usage();
if ((command === 'export' || command === 'import') && !/^[a-z]{2,3}$/.test(language ?? '')) usage();

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

/** "a.b.0.c" → value, for every text of a catalog. */
const flatten = (value, prefix = '', out = new Map()) => {
  if (typeof value === 'string') out.set(prefix, value);
  else if (Array.isArray(value))
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, out));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
  return out;
};
/** "a.b.0.c" → value, for every text, number, flag or empty list of a catalog. */
const leaves = (value, prefix = '', out = new Map()) => {
  if (value && typeof value === 'object' && Object.keys(value).length)
    for (const [key, item] of Object.entries(value))
      leaves(item, prefix ? `${prefix}.${key}` : key, out);
  else out.set(prefix, value);
  return out;
};
/** Writes `text` at `path`, building objects or lists like the French catalog does. */
const place = (target, template, path, text) => {
  // Keys may hold a dot themselves ("HS2FD-EF1-3.0"): the French layout tells them apart.
  const parts = [];
  let shape = template;
  for (const segments = path.split('.'); segments.length;) {
    let size = segments.length;
    while (size > 1 && !Object.hasOwn(Object(shape), segments.slice(0, size).join('.'))) size -= 1;
    const part = segments.splice(0, size).join('.');
    parts.push(part);
    shape = shape?.[part];
  }
  let node = target;
  shape = template;
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    const key = Array.isArray(node) ? Number(part) : part;
    shape = shape?.[key];
    if (last) node[key] = text;
    else {
      const nextShape = shape ?? (/^\d+$/.test(parts[index + 1]) ? [] : {});
      node[key] ??= Array.isArray(nextShape) ? [] : {};
      node = node[key];
    }
  });
};
const sortDeep = (value) =>
  Array.isArray(value)
    ? value.map(sortDeep)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortDeep(value[key])]),
        )
      : value;

/** Plural keys a language needs, from the French base ("x_one", "x_other" → x_one, x_few…). */
function expectedTexts(source, target) {
  const out = new Map();
  const forms = new Intl.PluralRules(target).resolvedOptions().pluralCategories;
  for (const [key, text] of source) {
    // An empty French text (a heading left out on purpose) needs no translation.
    if (!text) continue;
    if (!pluralSuffix.test(key)) {
      out.set(key, { key, fr: text });
      continue;
    }
    const base = key.replace(pluralSuffix, '');
    for (const form of forms)
      if (!out.has(`${base}_${form}`))
        out.set(`${base}_${form}`, {
          key: `${base}_${form}`,
          fr: source.get(`${base}_${form}`) ?? source.get(`${base}_other`),
          plural: form,
        });
  }
  return [...out.values()];
}

const blocks = Object.entries(BLOCKS)
  .map(([name, { catalogs, code, dataFields }]) => ({
    name,
    dir: join(root, catalogs),
    code: code && join(root, code),
    dataFields,
  }))
  .filter(({ name, dir }) => {
    if (existsSync(join(dir, `${SOURCE}.json`))) return true;
    console.warn(`· ${name}: no catalogs in ${relative(root, dir)} yet, skipped`);
    return false;
  });

if (command === 'check') {
  const checker = join(dirname(fileURLToPath(import.meta.url)), 'check-catalogs.mjs');
  let failed = false;
  for (const { name, dir, code } of blocks) {
    console.log(`\n${name}`);
    const run = spawnSync(process.execPath, [checker, dir, ...(code ? ['--code', code] : [])], {
      stdio: 'inherit',
    });
    failed ||= run.status !== 0;
  }
  process.exit(failed ? 1 : 0);
}

const blockData = (name) => blocks.find((block) => block.name === name)?.dataFields;

if (command === 'status') {
  for (const { name, dir } of blocks) {
    const source = flatten(readJson(join(dir, `${SOURCE}.json`)));
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
    const counts = files.map((file) => {
      const code = file.replace(/\.json$/, '');
      const catalog = flatten(readJson(join(dir, file)));
      const expected = expectedTexts(source, code).filter(({ key }) => !blockData(name)?.test(key));
      const done = expected.filter(({ key }) => catalog.get(key)).length;
      return `${code} ${done}/${expected.length}`;
    });
    console.log(`${name.padEnd(8)} ${counts.join('   ')}`);
  }
  process.exit(0);
}

const outDir = join(root, 'translations', language);
if (command === 'export') {
  const all = flags.includes('--all');
  for (const { name, dir, dataFields } of blocks) {
    const source = flatten(readJson(join(dir, `${SOURCE}.json`)));
    const reference = flatten(readJson(join(dir, `${REFERENCE}.json`)) ?? {});
    const current = flatten(readJson(join(dir, `${language}.json`)) ?? {});
    const entries = {};
    for (const { key, fr, plural } of expectedTexts(source, language)) {
      if (dataFields?.test(key)) continue;
      if (!all && current.get(key)) continue;
      const base = key.replace(pluralSuffix, '');
      entries[key] = {
        fr,
        en: reference.get(key) ?? reference.get(`${base}_other`) ?? '',
        ...(plural ? { plural } : {}),
        [language]: current.get(key) ?? '',
      };
    }
    const file = join(outDir, `${name}.json`);
    writeJson(file, entries);
    console.log(
      `${name}: ${Object.keys(entries).length} texts to translate → ${relative(root, file)}`,
    );
  }
  console.log(`\nInstructions: docs/traductions-agents.md. Then: pnpm i18n:import ${language}`);
}

if (command === 'import') {
  for (const { name, dir, dataFields } of blocks) {
    const file = join(outDir, `${name}.json`);
    const entries = readJson(file);
    if (!entries) {
      console.warn(`· ${name}: no ${relative(root, file)}, skipped`);
      continue;
    }
    const template = readJson(join(dir, `${SOURCE}.json`));
    const catalogPath = join(dir, `${language}.json`);
    const catalog = readJson(catalogPath) ?? {};
    let count = 0;
    for (const [key, entry] of Object.entries(entries)) {
      const text = entry?.[language];
      // A text that is only a line break in French stays one.
      if (typeof text !== 'string' || (!text.trim() && text !== entry.fr)) continue;
      place(catalog, template, key, text);
      count += 1;
    }
    // Data fields, numbers and texts left empty in French are never exported: copied as they are.
    const current = leaves(catalog);
    for (const [key, value] of leaves(template))
      if ((typeof value !== 'string' || dataFields?.test(key) || !value) && !current.has(key))
        place(catalog, template, key, value);
    writeJson(catalogPath, sortDeep(catalog));
    console.log(`${name}: ${count} texts written to ${relative(root, catalogPath)}`);
  }
  console.log('\nCheck them with: pnpm i18n:check');
}
