#!/usr/bin/env node
// Second pass of the migration: tables of [French, English] pairs.
//
//   node migrate-pair-tables.mjs --catalogs <dir with fr.json/en.json> <files…>
//
// const labels: Record<string, [string, string]> = { OPEN: ['Ouvert', 'Open'] };
// labels[status]?.[locale === 'fr' ? 0 : 1]
// becomes
// const labels: Record<string, () => string> = { OPEN: () => t('ns.labels.OPEN') };
// labels[status]?.()
// Each pair is read when called, so the table follows a change of language.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const ts = require('typescript');

const args = process.argv.slice(2);
const at = args.indexOf('--catalogs');
const catalogDir = at >= 0 ? args.splice(at, 2)[1] : undefined;
const files = args;
if (!catalogDir || !files.length) {
  console.error('Usage: migrate-pair-tables.mjs --catalogs <dir> <files…>');
  process.exit(2);
}
const catalogs = Object.fromEntries(
  ['fr', 'en'].map((lang) => [
    lang,
    JSON.parse(readFileSync(join(catalogDir, `${lang}.json`), 'utf8')),
  ]),
);
const camel = (text) =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, index) =>
      index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join('');
const namespaceOf = (file) => {
  let name = basename(file).replace(/\.(tsx?|jsx?)$/, '');
  if (name === 'index') name = basename(dirname(file));
  return camel(name);
};
const unwrap = (node) => {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression?.(node)
  )
    node = node.expression;
  return node;
};
const isText = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const isPair = (node) => {
  node = unwrap(node);
  return (
    ts.isArrayLiteralExpression(node) &&
    node.elements.length === 2 &&
    node.elements.every((e) => isText(unwrap(e)))
  );
};
/** `[cond ? 0 : 1]` reading the French (0) or English (1) side. */
const isSideIndex = (node) => {
  node = unwrap(node);
  return (
    ts.isConditionalExpression(node) &&
    ts.isNumericLiteral(unwrap(node.whenTrue)) &&
    ts.isNumericLiteral(unwrap(node.whenFalse)) &&
    unwrap(node.whenTrue).text === '0' &&
    unwrap(node.whenFalse).text === '1'
  );
};

let total = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const ns = namespaceOf(file);
  const edits = [];
  const tables = new Set();
  const visit = (node) => {
    // A table: an object whose values are all [French, English] pairs.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      if (
        ts.isObjectLiteralExpression(init) &&
        init.properties.length &&
        init.properties.every((p) => ts.isPropertyAssignment(p) && isPair(p.initializer))
      ) {
        const table = node.name.text;
        tables.add(table);
        // Tables of the same name live in different functions: the function names the group.
        let owner = node.parent;
        while (
          owner &&
          !ts.isFunctionDeclaration(owner) &&
          !(
            ts.isVariableDeclaration(owner) &&
            owner !== node &&
            owner.initializer &&
            (ts.isArrowFunction(unwrap(owner.initializer)) ||
              ts.isFunctionExpression(unwrap(owner.initializer)))
          )
        )
          owner = owner.parent;
        let group = owner?.name ? `${owner.name.getText(sf)}.${table}` : table;
        const taken = (path) => {
          let fr = catalogs.fr[ns];
          for (const part of path.split('.')) {
            if (fr === undefined) return false;
            if (typeof fr === 'string') return true;
            fr = fr[part];
          }
          return typeof fr === 'string';
        };
        while (taken(group)) group = `${group}Table`;
        for (const property of init.properties) {
          const name = property.name.getText(sf).replace(/^['"]|['"]$/g, '');
          const [fr, en] = unwrap(property.initializer).elements.map((e) => unwrap(e).text);
          const key = `${ns}.${group}.${name}`;
          for (const [lang, text] of [
            ['fr', fr],
            ['en', en],
          ]) {
            let target = (catalogs[lang][ns] ??= {});
            for (const part of group.split('.')) target = target[part] ??= {};
            target[name] = text;
          }
          edits.push({
            start: property.initializer.getStart(sf),
            end: property.initializer.end,
            text: `() => t('${key}')`,
          });
        }
        const type = node.type?.getText(sf);
        if (type?.includes('[string, string]'))
          edits.push({
            start: node.type.getStart(sf),
            end: node.type.end,
            text: type.replace(/(readonly )?\[string, string\]/, '() => string'),
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Reads: table[key][side], table[key]?.[side] → table[key](), table[key]?.()
  const reads = (node) => {
    if (ts.isElementAccessExpression(node) && isSideIndex(node.argumentExpression)) {
      let base = unwrap(node.expression);
      while (ts.isElementAccessExpression(base) || ts.isNonNullExpression(base)) {
        if (ts.isIdentifier(unwrap(base.expression)) && tables.has(unwrap(base.expression).text))
          break;
        base = unwrap(base.expression);
      }
      const root = ts.isElementAccessExpression(base) ? unwrap(base.expression) : base;
      if (ts.isIdentifier(root) && tables.has(root.text)) {
        const head = node.expression.getText(sf);
        edits.push({
          start: node.getStart(sf),
          end: node.end,
          text: node.questionDotToken ? `${head}?.()` : `${head}()`,
        });
        return;
      }
    }
    ts.forEachChild(node, reads);
  };
  reads(sf);
  if (!edits.length) continue;
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  writeFileSync(file, output);
  total += edits.length;
  console.log(`${file}: ${[...tables].join(', ')}`);
}
const sortDeep = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortDeep(value[key])]),
      )
    : value;
for (const lang of ['fr', 'en'])
  writeFileSync(
    join(catalogDir, `${lang}.json`),
    `${JSON.stringify(sortDeep(catalogs[lang]), null, 2)}\n`,
  );
console.log(`${total} edits`);
