const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, {recursive:true});
for (const file of ['index.html','styles.css','admin.css','meals.css','app.js','admin.js','meals.js','meal-summary.js','cafe-draft.js','cafe-draft.css','naver-ui.js','naver-ui.css']) {
  fs.copyFileSync(path.join(root,file),path.join(output,file));
}
console.log('Built 12 public application files.');
