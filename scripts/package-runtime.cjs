/** Package the installed, lockfile-verified production graph without resolving it again. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const app = path.resolve(root, process.argv[2]);
const output = path.resolve(process.argv[3]);
const visited = new Map();
fs.mkdirSync(output, { recursive: true });
function manifest(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
}
function resolve(name, from) {
  if (name.startsWith('@michel/')) {
    const local = path.join(root, 'packages', name.slice(8));
    if (fs.existsSync(path.join(local, 'package.json'))) return local;
  }
  for (let folder = from; ; folder = path.dirname(folder)) {
    const candidate = path.join(folder, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(folder) === folder) return null;
  }
}
function linkPackage(folder) {
  folder = fs.realpathSync(folder);
  if (visited.has(folder)) return visited.get(folder);
  const id = crypto.createHash('sha256').update(folder).digest('hex').slice(0, 20);
  const target = path.join(output, 'node_modules', '.elise', id);
  visited.set(folder, target);
  fs.cpSync(folder, target, {
    recursive: true,
    filter: (source) => !['node_modules', '.git'].includes(path.basename(source)),
  });
  const pkg = manifest(folder);
  const dependencies = {
    ...pkg.peerDependencies,
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  };
  // Prisma's generated client is installed adjacent to @prisma/client, outside its manifest.
  if (pkg.name === '@prisma/client') dependencies['.prisma/client'] = '*';
  for (const name of Object.keys(dependencies)) {
    const source = resolve(name, folder);
    if (!source) {
      if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name])
        throw new Error(`Missing installed dependency ${pkg.name} → ${name}`);
      continue;
    }
    const destination = linkPackage(source);
    const link = path.join(target, 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (!fs.existsSync(link)) fs.symlinkSync(path.relative(path.dirname(link), destination), link);
  }
  return target;
}
for (const item of ['package.json', 'dist', 'prisma']) {
  const source = path.join(app, item);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, item), { recursive: true });
}
for (const name of Object.keys(manifest(app).dependencies ?? {})) {
  const source = resolve(name, app);
  if (!source) throw new Error(`Missing installed dependency ${name}`);
  const target = linkPackage(source);
  const link = path.join(output, 'node_modules', name);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(link), target), link);
  const pkg = manifest(source);
  const bins =
    typeof pkg.bin === 'string' ? { [pkg.name.split('/').at(-1)]: pkg.bin } : (pkg.bin ?? {});
  for (const [bin, file] of Object.entries(bins)) {
    const executable = path.join(target, file);
    const binPath = path.join(output, 'node_modules', '.bin', bin);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    if (!fs.existsSync(binPath))
      fs.symlinkSync(path.relative(path.dirname(binPath), executable), binPath);
    fs.chmodSync(executable, 0o755);
  }
}
console.log(`Packaged ${visited.size} installed production packages for ${manifest(app).name}`);
