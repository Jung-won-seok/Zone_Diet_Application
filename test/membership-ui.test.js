const test = require('node:test');
const assert = require('node:assert/strict');
const { readPublicAsset } = require('./support/public-assets');
const vm = require('node:vm');

class Control {
  constructor() {
    this.children = new Map();
    this.events = {};
    this.value = '';
    this.checked = false;
  }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Control());
    return this.children.get(selector);
  }
  querySelectorAll() { return []; }
  addEventListener(event, handler) { this.events[event] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
}

function fields(names) {
  return Object.fromEntries(names.map(name => [name, new Control()]));
}

test('coach reviews the newest visit balance after a conflict and explicitly selects a replacement pass', async () => {
  const root = new Control();
  const editor = root.querySelector('#box-pass-form');
  editor.elements = fields(['kind', 'remainingVisits', 'expiresOn', 'replacePass']);
  root.querySelector('#box-member-form').elements = fields(['name', 'username', 'password', 'zonda']);
  const member = { id: 'm1', name: '김회원', username: 'member' };
  const updates = [];
  let pass;
  let conflict = false;
  async function api(url, options) {
    if (!options) return { members: [{ ...member, membership: pass }], revision: 0 };
    assert.equal(url, '/api/admin/members/membership');
    assert.equal(options.method, 'PUT');
    const payload = JSON.parse(options.body);
    updates.push(payload);
    if (conflict) {
      conflict = false;
      throw Object.assign(new Error('다른 요청이 이용권을 변경했습니다.'), { status: 409 });
    }
    pass = { ...payload, revision: payload.revision + 1 };
    return pass;
  }
  const context = vm.createContext({ document: { querySelector: () => root }, bootstrap: { revision: 0, teams: [] }, api, escapeHTML: String });
  vm.runInContext(readPublicAsset('member-management.js'), context);
  vm.runInContext('mountBoxMembers()', context);
  await new Promise(resolve => setImmediate(resolve));
  const list = root.querySelector('#box-member-directory');
  function openEditor() {
    list.events.click({ target: { closest: selector => selector === '[data-pass-member]' ? { dataset: { passMember: member.id } } : null } });
  }
  const controls = editor.elements;
  const save = () => editor.events.submit({ preventDefault() {} });
  openEditor();
  assert.equal(controls.kind.value, 'unassigned');
  controls.kind.value = 'period';
  controls.kind.events.change();
  assert.equal(controls.expiresOn.required, true);
  controls.kind.value = 'visits';
  controls.kind.events.change();
  assert.equal(controls.expiresOn.required, false);
  assert.equal(controls.replacePass.disabled, true);
  controls.remainingVisits.value = '0';
  await save();
  assert.deepEqual(updates[0], { memberId: member.id, kind: 'visits', expiresOn: null, remainingVisits: 0, revision: 0 });

  openEditor();
  controls.remainingVisits.value = '8';
  controls.replacePass.checked = true;
  conflict = true;
  pass = { kind: 'visits', remainingVisits: 100001, expiresOn: null, revision: 5 };
  await save();
  assert.equal(root.querySelector('#box-pass-dialog').open, true);
  assert.equal(Number(controls.remainingVisits.value), 100001);
  assert.equal(controls.remainingVisits.max, '100001');
  assert.equal(controls.replacePass.checked, false);
  assert.match(root.querySelector('#box-pass-feedback').textContent, /최신/);

  controls.replacePass.checked = true;
  controls.replacePass.events.change();
  assert.equal(controls.remainingVisits.max, '100000');
  controls.remainingVisits.value = '12';
  await save();
  assert.equal(updates.at(-1).revision, 5);
  assert.equal(updates.at(-1).replacePass, true);
  assert.match(root.querySelector('#box-member-message').textContent, /12회/);
});
