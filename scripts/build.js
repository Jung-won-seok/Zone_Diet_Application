const fs = require('node:fs');
const path = require('node:path');
const publicAssets = require('../public-assets');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.rmSync(output, {recursive:true,force:true});
fs.mkdirSync(output, {recursive:true});
for (const file of publicAssets) {
  fs.copyFileSync(path.join(root,file),path.join(output,file));
}
console.log(`Built ${publicAssets.length} public application files.`);
