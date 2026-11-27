const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push('api', 'client', 'config', 'scripts', 'server', 'shared');

function check(target) {
  if (statSync(target).isDirectory()) {
    for (const name of readdirSync(target)) check(path.join(target, name));
  } else if (path.extname(target) === '.js') {
    const result = spawnSync(process.execPath, ['--check', target], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

for (const target of targets) check(path.resolve(root, target));
