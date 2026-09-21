const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
test('packages installed nested versions and executable bins without a registry', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'elise-pack-'));
  try {
    const root = path.join(temp, 'fixture');
    const app = path.join(root, 'app');
    fs.mkdirSync(path.join(app, 'node_modules', 'parent', 'node_modules', 'child'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, 'package-runtime.cjs'),
      path.join(root, 'scripts/package-runtime.cjs'),
    );
    fs.writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'test-app', dependencies: { parent: '1' } }),
    );
    fs.writeFileSync(
      path.join(app, 'node_modules/parent/package.json'),
      JSON.stringify({
        name: 'parent',
        main: 'index.js',
        dependencies: { child: '1' },
        bin: { testbin: 'index.js' },
      }),
    );
    fs.writeFileSync(
      path.join(app, 'node_modules/parent/index.js'),
      "module.exports=require('child');",
    );
    fs.writeFileSync(
      path.join(app, 'node_modules/parent/node_modules/child/package.json'),
      JSON.stringify({ name: 'child', main: 'index.js' }),
    );
    fs.writeFileSync(
      path.join(app, 'node_modules/parent/node_modules/child/index.js'),
      "module.exports='correct-version';",
    );
    const target = path.join(temp, 'out');
    execFileSync(process.execPath, [path.join(root, 'scripts/package-runtime.cjs'), 'app', target]);
    assert.equal(require(path.join(target, 'node_modules/parent')), 'correct-version');
    assert.ok(fs.existsSync(path.join(target, 'node_modules/.bin/testbin')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
