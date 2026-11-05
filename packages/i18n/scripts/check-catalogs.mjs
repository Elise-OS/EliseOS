#!/usr/bin/env node
// Compares every catalog of a folder with the French source catalog.
// Usage: elise-i18n-check <folder holding fr.json, en.json…> [--code <source folder>]
// Errors (exit 1): a language without catalog, missing or extra keys, a {{value}} that the
// code does not provide (or, without --code, that French does not use).
// Warnings: plural forms a language uses but its catalog lacks (i18next then falls back),
// and with --code, texts that no t() call uses.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const codeIndex = args.indexOf('--code');
const codeDir = codeIndex >= 0 ? args.splice(codeIndex, 2)[1] : undefined;
const folder = args[0];
if (!folder) {
  console.error('Usage: elise-i18n-check <catalog folder> [--code <source folder>]');
  process.exit(2);
}

const languagesSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const languages = [...languagesSource.matchAll(/\{ code: '([a-z]{2,3})'/g)].map(
  (match) => match[1],
);
const source = 'fr';
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

const flatten = (value, prefix = '', out = new Map()) => {
  if (typeof value === 'string') out.set(prefix, value);
  else if (Array.isArray(value))
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, out));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
  return out;
};
const read = (language) =>
  flatten(JSON.parse(readFileSync(join(folder, `${language}.json`), 'utf8')));
const placeholders = (text) =>
  [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
// Plural keys are compared by their base; each language has its own set of forms.
const bases = (catalog) => {
  const out = new Map();
  for (const [key, text] of catalog) {
    const base = key.replace(pluralSuffix, '');
    if (!out.has(base) || key.endsWith('_other')) out.set(base, text);
  }
  return out;
};

const files = new Set(readdirSync(folder).filter((name) => name.endsWith('.json')));
let errors = 0;
let warnings = 0;
const error = (message) => {
  errors += 1;
  console.error(`✖ ${message}`);
};
const warn = (message) => {
  warnings += 1;
  console.warn(`⚠ ${message}`);
};

// Values each t('key', { … }) call passes, read from the code (keys built with `${…}` are skipped).
const provided = codeDir ? new Map() : null;
const dynamicPrefixes = [];
const splitTopLevel = (text) => {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
};
const objectAfter = (text, start) => {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}' && (depth -= 1) === 0) return text.slice(start + 1, index);
  }
  return null;
};
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(spec|test)\./.test(name)) out.push(path);
  }
  return out;
};
if (codeDir)
  for (const file of walk(codeDir)) {
    const code = readFileSync(file, 'utf8');
    // t('key', { … }), i18nT(…), textBlock('screen.copy'), readBlock(`products.${id}`).
    for (const match of code.matchAll(
      /\b(?:t|i18nT|textBlock|readBlock)\(\s*(['`])((?:(?!\1).)+)\1\s*(,\s*)?/g,
    )) {
      const key = match[2];
      if (match[1] === '`' && key.includes('${')) {
        dynamicPrefixes.push(key.slice(0, key.indexOf('${')));
        continue;
      }
      const rawOptions = match[3] ? objectAfter(code, match.index + match[0].length) : null;
      const options = rawOptions?.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '') ?? null;
      const names = new Set(
        (options ? splitTopLevel(options) : [])
          .map((entry) => entry.split(':')[0].trim())
          .filter((name) => /^\w+$/.test(name)),
      );
      const known = provided.get(key) ?? new Set();
      for (const name of names) known.add(name);
      provided.set(key, known);
    }
  }

const reference = read(source);
const referenceBases = bases(reference);
const pluralBases = new Set(
  [...reference.keys()].filter((k) => pluralSuffix.test(k)).map((k) => k.replace(pluralSuffix, '')),
);

for (const language of languages) {
  if (!files.has(`${language}.json`)) {
    error(`${language}: no ${language}.json in ${folder}`);
    continue;
  }
  if (language === source) continue;
  const catalog = read(language);
  const catalogBases = bases(catalog);
  for (const [base, text] of referenceBases) {
    const translated = catalogBases.get(base);
    if (translated === undefined) {
      error(`${language}: missing "${base}"`);
      continue;
    }
    // A translation may leave out a value or use one French leaves out, as long as the code gives it.
    const allowed = provided?.get(base) ?? new Set(placeholders(text).split(',').filter(Boolean));
    if (pluralBases.has(base)) allowed.add('count');
    const unknown = placeholders(translated)
      .split(',')
      .filter((name) => name && !allowed.has(name));
    if (unknown.length)
      error(
        `${language}: "${base}" uses {{${unknown.join('}}, {{')}}}, which the code does not give`,
      );
  }
  for (const base of catalogBases.keys())
    if (!referenceBases.has(base)) error(`${language}: "${base}" does not exist in ${source}.json`);
  const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  for (const base of pluralBases)
    for (const form of forms)
      if (!catalog.has(`${base}_${form}`) && catalogBases.has(base))
        warn(`${language}: "${base}" has no "${form}" plural form`);
}
// Keys chosen by a condition, t(up ? 'plan.stairsUp' : 'plan.stairsDown'), appear as plain strings.
const quotedKeys = new Set();
if (codeDir)
  for (const file of walk(codeDir))
    for (const match of readFileSync(file, 'utf8').matchAll(
      /['"`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)['"`]/g,
    ))
      quotedKeys.add(match[1]);

if (provided) {
  const objectBases = new Set(
    [...referenceBases.keys()].filter((base) => /\.\d+$|\.copy\./.test(base)),
  );
  for (const base of referenceBases.keys()) {
    const used =
      provided.has(base) ||
      quotedKeys.has(base) ||
      dynamicPrefixes.some((prefix) => base.startsWith(prefix)) ||
      // Blocks read with returnObjects: t('screen.copy', { returnObjects: true }).
      [...provided.keys()].some((key) => base.startsWith(`${key}.`));
    if (!used && !objectBases.has(base)) warn(`"${base}" is not used by any t() call`);
  }
}
for (const name of files)
  if (!languages.includes(name.replace(/\.json$/, '')))
    error(`${name}: not listed in LANGUAGES (packages/i18n/src/index.ts)`);

console.log(
  `${reference.size} texts, ${languages.length} languages: ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors ? 1 : 0);
