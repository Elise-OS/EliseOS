#!/usr/bin/env node
// One-off migration of inline French/English pairs to catalog keys.
//
//   node migrate-bilingual.mjs --catalogs <dir with fr.json/en.json> --module <i18n module path> <files…>
//
// Rewrites, in each file:
//   tr('Bonjour', 'Hello')                     → t('ns.hello')
//   fr ? `Il y a ${n} min` : `${n} min ago`    → t('ns.minAgo', { n })
//   locale === 'fr' ? 'Oui' : 'Yes'            → t('ns.yes')
// and any call to a local `(fr: string, en: string) =>` helper. "ns" is the file name.
// Pairs whose two sides do not insert the same values, or that pick words inside a template
// (hand-made plurals), are left as they are and listed for a manual migration.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const ts = require('typescript');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const catalogDir = option('--catalogs');
const modulePath = option('--module');
const files = args;
if (!catalogDir || !modulePath || !files.length) {
  console.error('Usage: migrate-bilingual.mjs --catalogs <dir> --module <i18n module> <files…>');
  process.exit(2);
}

const readCatalog = (language) => {
  try {
    return JSON.parse(readFileSync(join(catalogDir, `${language}.json`), 'utf8'));
  } catch {
    return {};
  }
};
const catalogs = { fr: readCatalog('fr'), en: readCatalog('en') };
const skipped = [];
let replaced = 0;

const camel = (words) =>
  words.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word)).join('');
const wordsOf = (text) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\{\{\w+\}\}/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function namespaceOf(file) {
  let name = basename(file).replace(/\.(web\.)?(tsx?|jsx?)$/, '');
  if (name === 'index' || name === '_layout') name = basename(dirname(file));
  return camel(wordsOf(name.replace(/([a-z])([A-Z])/g, '$1 $2'))) || 'common';
}

function keyFor(ns, fr, en) {
  const frTable = (catalogs.fr[ns] ??= {});
  const enTable = (catalogs.en[ns] ??= {});
  for (const [key, value] of Object.entries(frTable))
    if (value === fr && enTable[key] === en) return `${ns}.${key}`;
  let base = camel(wordsOf(en).slice(0, 5)).slice(0, 40) || 'text';
  if (/^\d/.test(base)) base = `n${base}`;
  let key = base;
  for (let n = 2; key in frTable; n += 1) key = `${base}${n}`;
  frTable[key] = fr;
  enTable[key] = en;
  return `${ns}.${key}`;
}

const unwrap = (node) => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
  )
    node = node.expression;
  return node;
};
const isStringish = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

const localeNames = new Set(['locale', 'language', 'lang', 'current', 'appLanguage']);
const localeCalls = new Set(['appLocale', 'currentLanguage']);
const frenchFlags = new Set(['fr', 'isFr', 'isFrench', 'french']);

/** 'fr' when the true branch is French, 'en' when it is English, null when not a language test. */
function languageTest(node) {
  node = unwrap(node);
  if (ts.isIdentifier(node) && frenchFlags.has(node.text)) return 'fr';
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = languageTest(node.operand);
    return inner && (inner === 'fr' ? 'en' : 'fr');
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const equal =
      op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
    const different =
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !different) return null;
    const [left, right] = [unwrap(node.left), unwrap(node.right)];
    const literal = ts.isStringLiteral(right) ? right : ts.isStringLiteral(left) ? left : null;
    const other = literal === right ? left : right;
    if (!literal || !['fr', 'en'].includes(literal.text)) return null;
    const isLocale =
      (ts.isIdentifier(other) && localeNames.has(other.text)) ||
      (ts.isPropertyAccessExpression(other) && localeNames.has(other.name.text)) ||
      (ts.isCallExpression(other) &&
        ts.isIdentifier(other.expression) &&
        localeCalls.has(other.expression.text));
    if (!isLocale) return null;
    const french = literal.text === 'fr' ? equal : different;
    return french ? 'fr' : 'en';
  }
  return null;
}

const methodNames = new Set([
  'toString',
  'join',
  'toFixed',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'toLocaleString',
]);
function paramName(node) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return paramName(node.expression);
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    if (ts.isPropertyAccessExpression(callee) && methodNames.has(callee.name.text))
      return paramName(callee.expression);
    return paramName(callee);
  }
  return 'value';
}

const contains = (node, test) => {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (test(child)) found = true;
    else ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
};

/**
 * `fr ? (x ? 'A' : 'B') : (x ? 'C' : 'D')`: both languages make the same choice, so the pair
 * becomes `x ? t(A/C) : t(B/D)`.
 */
function sameChoices(frNode, enNode) {
  frNode = unwrap(frNode);
  enNode = unwrap(enNode);
  if (isStringish(frNode) && isStringish(enNode)) return true;
  if (!ts.isConditionalExpression(frNode) || !ts.isConditionalExpression(enNode)) return false;
  if (frNode.condition.getText() !== enNode.condition.getText()) return false;
  return (
    sameChoices(frNode.whenTrue, enNode.whenTrue) && sameChoices(frNode.whenFalse, enNode.whenFalse)
  );
}

/** Message text and inserted expressions of one side of a pair. */
function sideOf(node, sourceFile) {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return { text: node.text, values: [] };
  const values = node.templateSpans.map((span) => span.expression.getText(sourceFile));
  return { node, values };
}

function migrate(file) {
  const source = readFileSync(file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const ns = namespaceOf(file);
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  // Local helpers shaped like `const t = (fr: string, en: string) => …` are pair helpers too.
  const pairHelpers = new Set(['tr']);
  const localT = [];
  const scan = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer && unwrap(node.initializer);
      const params =
        init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          ? init.parameters
          : null;
      if (
        params?.length === 2 &&
        params[0].name.getText(sourceFile) === 'fr' &&
        params[1].name.getText(sourceFile) === 'en'
      )
        pairHelpers.add(node.name.text);
      else if (node.name.text === 't') localT.push(node);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 't') localT.push(node);
    ts.forEachChild(node, scan);
  };
  scan(sourceFile);
  const tName = localT.length ? 'i18nT' : 't';

  const candidates = [];
  const visit = (node) => {
    let pair = null;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      pairHelpers.has(node.expression.text) &&
      node.arguments.length === 2
    )
      pair = { fr: node.arguments[0], en: node.arguments[1] };
    else if (ts.isConditionalExpression(node)) {
      const test = languageTest(node.condition);
      if (test)
        pair =
          test === 'fr'
            ? { fr: node.whenTrue, en: node.whenFalse }
            : { fr: node.whenFalse, en: node.whenTrue };
    }
    if (pair) {
      const [frNode, enNode] = [unwrap(pair.fr), unwrap(pair.en)];
      if (isStringish(frNode) && isStringish(enNode)) candidates.push({ node, frNode, enNode });
      else if (sameChoices(frNode, enNode)) candidates.push({ node, frNode, enNode, zipped: true });
      else if (ts.isCallExpression(node) || isStringish(frNode) || isStringish(enNode))
        skipped.push(
          `${file}:${lineOf(node)}  not two texts: ${node.getText(sourceFile).slice(0, 90)}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Innermost pairs first; an outer pair is migrated on a later pass, once its inner pairs are keys.
  const nested = (outer) =>
    candidates.some(
      (inner) =>
        inner !== outer && inner.node.pos >= outer.node.pos && inner.node.end <= outer.node.end,
    );
  const edits = [];
  const pairCall = (node, frNode, enNode) => {
    frNode = unwrap(frNode);
    enNode = unwrap(enNode);
    if (ts.isConditionalExpression(frNode)) {
      const whenTrue = pairCall(node, frNode.whenTrue, enNode.whenTrue);
      const whenFalse = whenTrue && pairCall(node, frNode.whenFalse, enNode.whenFalse);
      return whenFalse && `${frNode.condition.getText(sourceFile)} ? ${whenTrue} : ${whenFalse}`;
    }
    return leafCall(node, frNode, enNode);
  };
  const leafCall = (node, frNode, enNode) => {
    const fr = sideOf(frNode, sourceFile);
    const en = sideOf(enNode, sourceFile);
    const where = `${file}:${lineOf(node)}`;
    const sorted = (values) => [...values].sort().join('\u0000');
    if (sorted(fr.values) !== sorted(en.values)) {
      skipped.push(
        `${where}  different values in each language: ${node.getText(sourceFile).slice(0, 90)}`,
      );
      return null;
    }
    const spans = [...(fr.node?.templateSpans ?? []), ...(en.node?.templateSpans ?? [])];
    if (
      spans.some(
        (span) =>
          ts.isConditionalExpression(unwrap(span.expression)) ||
          contains(
            span.expression,
            (n) => ts.isConditionalExpression(n) || ts.isTemplateExpression(n),
          ),
      )
    ) {
      skipped.push(
        `${where}  choice inside the text (plural?): ${node.getText(sourceFile).slice(0, 90)}`,
      );
      return null;
    }
    // Same expression → same placeholder name in both languages.
    const names = new Map();
    const used = new Set();
    for (const span of fr.node?.templateSpans ?? []) {
      const text = span.expression.getText(sourceFile);
      if (names.has(text)) continue;
      let name = paramName(span.expression);
      for (let n = 2; used.has(name); n += 1) name = `${paramName(span.expression)}${n}`;
      names.set(text, name);
      used.add(name);
    }
    const message = (side) =>
      side.node
        ? side.node.head.text +
          side.node.templateSpans
            .map(
              (span) => `{{${names.get(span.expression.getText(sourceFile))}}}${span.literal.text}`,
            )
            .join('')
        : side.text;
    const key = keyFor(ns, message(fr), message(en));
    const params = [...names].map(([expr, name]) => (expr === name ? name : `${name}: ${expr}`));
    return params.length ? `${tName}('${key}', { ${params.join(', ')} })` : `${tName}('${key}')`;
  };
  for (const candidate of candidates) {
    if (nested(candidate)) continue;
    const { node, frNode, enNode, zipped } = candidate;
    const call = pairCall(node, frNode, enNode);
    if (call)
      edits.push({
        start: node.getStart(sourceFile),
        end: node.end,
        text: zipped ? `(${call})` : call,
      });
  }
  if (!edits.length) return 0;

  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);

  let specifier = relative(dirname(file), modulePath)
    .replace(/\.(ts|tsx)$/, '')
    .replace(/\/index$/, '');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const importLine =
    tName === 't'
      ? `import { t } from '${specifier}';`
      : `import { t as i18nT } from '${specifier}';`;
  const importsT = new RegExp(
    `import \\{[^}]*\\b${tName === 't' ? 't' : 't as i18nT'}\\b[^}]*\\} from '${specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}';`,
  );
  if (!importsT.test(output)) {
    const imports = [...output.matchAll(/^import [^;]+;$/gms)];
    const last = imports.at(-1);
    const at = last ? last.index + last[0].length : 0;
    output = `${output.slice(0, at)}${at ? '\n' : ''}${importLine}${at ? '' : '\n'}${output.slice(at)}`;
  }
  writeFileSync(file, output);
  return edits.length;
}

// Repeated passes: pairs nested inside other pairs only become plain texts once migrated.
for (let pass = 0; pass < 4; pass += 1) {
  const before = replaced;
  const skippedBefore = skipped.length;
  if (pass) skipped.length = 0;
  for (const file of files) replaced += migrate(file);
  if (replaced === before) break;
  void skippedBefore;
}

const sortDeep = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortDeep(value[key])]),
      )
    : value;
for (const language of ['fr', 'en'])
  writeFileSync(
    join(catalogDir, `${language}.json`),
    `${JSON.stringify(sortDeep(catalogs[language]), null, 2)}\n`,
  );

console.log(`${replaced} texts moved to ${catalogDir}`);
if (skipped.length) {
  console.log(`\n${skipped.length} pairs left for a manual migration:`);
  for (const line of [...new Set(skipped)]) console.log(`  ${line}`);
}
