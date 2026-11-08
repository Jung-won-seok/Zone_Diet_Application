const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, {recursive:true});
const files = ['index.html','styles.css','admin.css','meals.css','app.js','admin.js','meals.js','meal-summary.js','cafe-draft.js','cafe-draft.css','naver-ui.js','naver-ui.css','glass.css','glass-admin.css','glass-meals.css','icons.js'];
for (const file of files) {
  fs.copyFileSync(path.join(root,file),path.join(output,file));
}
console.log(`Built ${files.length} public application files.`);
