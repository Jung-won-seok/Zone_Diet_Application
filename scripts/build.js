const fs = require('node:fs');
const path = require('node:path');
const publicAssets = require('../config/public-assets');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.rmSync(output, {recursive:true,force:true});
fs.mkdirSync(output, {recursive:true});
for (const [filename, sourcePath] of Object.entries(publicAssets)) {
  fs.copyFileSync(path.join(root, sourcePath), path.join(output, filename));
}
console.log(`Built ${Object.keys(publicAssets).length} public application files.`);
