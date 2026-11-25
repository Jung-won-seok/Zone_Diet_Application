const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');

test('Zonda assignment presets cover exactly the enrolled roster without exceeding a team limit', () => {
  for (const size of [0, 1, 5, 19, 20, 21, 25, 30, 31]) {
    const bootstrap = {
      members:Array.from({length:size}, (_, i) => ({id:'u'+i})),
      teams:Array.from({length:5}, (_, i) => ({id:'t'+i})),
      revision:1,
    };
    const context = vm.createContext({bootstrap});
    vm.runInContext(script, context);
    const html = vm.runInContext('initAdminDraft(); teamPresetPicker()', context);
    const options = Array.from(html.matchAll(/data-preset="([0-9,]+)"/g), match => match[1]);
    if (size === 0 || size > 30) {
      assert.equal(options.length, 0);
      continue;
    }
    assert.ok(options.length > 0, 'missing preset for '+size);
    for (const option of options) {
      const counts = option.split(',').map(Number);
      assert.equal(counts.reduce((sum, count) => sum + count, 0), size);
      assert.ok(counts.every(count => count > 0 && count <= 6));
      assert.ok(counts.length <= bootstrap.teams.length);
    }
    if (size === 20) assert.deepEqual(options, ['4,4,4,4,4', '5,5,5,5', '6,5,5,4']);
  }
});
