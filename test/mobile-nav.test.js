const test = require('node:test');
const assert = require('node:assert/strict');
const MobileNavigation = require('../mobile-nav');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, values = {}) {
    const event = {
      pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 200, clientY: 300, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...values
    };
    for (const listener of this.listeners.get(name) || []) listener(event);
    return event;
  }
}

class Element extends Events {
  constructor(tagName, rect = {}) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) };
    const styles = new Map();
    this.style = { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name), getPropertyValue: name => styles.get(name) || '' };
    this.rect = { left: 0, top: 0, width: 0, height: 0, ...rect };
    this.clientWidth = this.scrollWidth = this.rect.width;
    this.clientHeight = this.scrollHeight = this.rect.height;
    this.clientLeft = 0;
    this.computedStyle = { overflowX: 'visible', overflowY: 'visible' };
  }
  append(child) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.children.push(child); return child; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll(selector) {
    const matches = element => selector === '.drag-preview' ? element.classList.contains('drag-preview') : element.tagName === 'A' && element.attributes.has('data-page');
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  closest() {
    for (let node = this; node; node = node.parentElement) {
      if (['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY', 'DIALOG', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME'].includes(node.tagName)
        || ['button', 'slider'].includes(node.getAttribute('role'))
        || (node.attributes.has('contenteditable') && node.getAttribute('contenteditable') !== 'false')
        || node.attributes.has('data-no-swipe')) return node;
    }
    return null;
  }
}

function fixture(options = {}) {
  const win = new Events(), doc = new Events(), media = new Events();
  media.matches = options.mobile !== false;
  doc.defaultView = win;
  doc.documentElement = { clientWidth: 400 };
  win.innerWidth = 400;
  win.getComputedStyle = element => element.computedStyle;
  win.getSelection = () => ({ isCollapsed: true });
  win.matchMedia = () => media;
  const root = new Element('aside', { left: 10, top: 740, width: 380, height: 70 });
  root.ownerDocument = doc;
  root.clientLeft = 1;
  const content = new Element('div', { left: 0, top: 0, width: 400, height: 700 });
  content.ownerDocument = doc;
  const plain = content.append(new Element('p', { left: 30, top: 200, width: 300, height: 120 }));
  const links = ['today', 'team', 'board', 'record', 'settings'].map((name, index) => {
    const link = root.append(new Element('a', { left: 20 + index * 72, top: 748, width: 72, height: 54 }));
    link.setAttribute('href', `#${name}`);
    link.setAttribute('data-page', name);
    return link;
  });
  const activate = index => links.forEach((link, position) => {
    link.classList[position === index ? 'add' : 'remove']('active');
    if (position === index) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  activate(options.active ?? 0);
  const calls = [];
  let blocked = false;
  const controller = MobileNavigation.create({ root, content, navigate: href => { calls.push(href); return options.navigate?.(href); }, isBlocked: () => blocked });
  const point = (type, x, y, extra = {}) => doc.emit(type, { target: links[0], clientX: x, clientY: y, ...extra });
  const swipe = (dx, extra = {}) => {
    point('pointerdown', 200, 300, { target: plain, ...extra });
    const move = point('pointermove', 200 + dx, 302, extra);
    point('pointerup', 200 + dx, 302, extra);
    return move;
  };
  return { root, content, plain, links, calls, win, doc, media, controller, point, swipe, activate, block: value => { blocked = value; } };
}

test('indicator follows current page, hidden menus, and freshly rendered links', () => {
  const f = fixture();
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '9px');
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-width'), '72px');
  assert.ok(f.root.classList.contains('has-nav-indicator'));
  f.activate(2);
  f.controller.sync();
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '153px');
  f.links[2].rect.width = 0;
  f.controller.sync();
  assert.equal(f.root.classList.contains('has-nav-indicator'), false);
  f.root.children = [];
  const fresh = f.root.append(new Element('a', { left: 40, top: 748, width: 100, height: 54 }));
  fresh.setAttribute('data-page', 'accounts'); fresh.setAttribute('href', '#accounts'); fresh.setAttribute('aria-current', 'page');
  f.controller.sync();
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '29px');
});

test('normal taps and keyboard activation keep native anchor behavior', () => {
  const f = fixture();
  f.point('pointerdown', 55, 770);
  f.point('pointerup', 57, 771);
  assert.deepEqual(f.calls, []);
  assert.equal(f.root.emit('click', { detail: 1 }).defaultPrevented, false);
  assert.equal(f.root.emit('click', { detail: 0 }).defaultPrevented, false);
});

test('bar drag previews, commits once at release, and restores actual page after declined navigation', () => {
  const f = fixture({ navigate: () => false });
  f.point('pointerdown', 55, 770);
  const move = f.point('pointermove', 200, 770);
  assert.ok(move.defaultPrevented);
  assert.ok(f.root.classList.contains('is-dragging'));
  assert.ok(f.links[2].classList.contains('drag-preview'));
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '153px');
  assert.deepEqual(f.calls, []);
  f.point('pointerup', 200, 770);
  f.point('pointerup', 200, 770);
  assert.deepEqual(f.calls, ['#board']);
  assert.equal(f.root.classList.contains('is-dragging'), false);
  assert.equal(f.links[2].classList.contains('drag-preview'), false);
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '9px');
  assert.equal(f.root.emit('click', { detail: 0 }).defaultPrevented, false);
  const synthetic = f.root.emit('click', { detail: 1 });
  assert.ok(synthetic.defaultPrevented);
  assert.ok(synthetic.stopped);
  assert.equal(f.root.emit('click', { detail: 1 }).defaultPrevented, false);
});

test('drag suppression never consumes the next ordinary tap even when no synthetic click arrived', () => {
  const f = fixture();
  f.point('pointerdown', 55, 770);
  f.point('pointermove', 200, 770);
  f.point('pointerup', 200, 770);
  f.point('pointerdown', 280, 770, { target: f.links[3], pointerId: 2 });
  f.point('pointerup', 280, 770, { pointerId: 2 });
  assert.equal(f.root.emit('click', { detail: 1, pointerId: 2 }).defaultPrevented, false);
});

test('bar gestures cancel on vertical intent, leaving the island, cancellation, or a second finger', () => {
  const scenarios = [
    f => { f.point('pointermove', 60, 800); },
    f => { f.point('pointermove', 200, 770); f.point('pointermove', 200, 710); },
    f => { f.point('pointermove', 200, 770); f.point('pointermove', 395, 770); },
    f => { f.point('pointermove', 200, 770); f.point('pointercancel', 200, 770); },
    f => { f.point('pointermove', 200, 770); f.point('pointerdown', 260, 770, { pointerId: 2, isPrimary: false }); }
  ];
  for (const cancel of scenarios) {
    const f = fixture();
    f.point('pointerdown', 55, 770);
    cancel(f);
    f.point('pointerup', 200, 770);
    assert.deepEqual(f.calls, []);
    assert.equal(f.root.classList.contains('is-dragging'), false);
  }
});

test('an aborted horizontal bar drag cannot fall through to an anchor click', () => {
  const f = fixture();
  f.point('pointerdown', 55, 770);
  f.point('pointermove', 200, 770);
  f.point('pointermove', 200, 710);
  f.point('pointerup', 200, 770);
  assert.deepEqual(f.calls, []);
  assert.ok(f.root.emit('click', { detail: 1 }).defaultPrevented);
});

test('horizontal content swipes move exactly one visible menu in either direction, without wrapping', () => {
  for (const pointerType of ['touch', 'pen', 'mouse']) {
    const f = fixture({ active: 2 });
    assert.ok(f.swipe(-110, { pointerType }).defaultPrevented);
    assert.deepEqual(f.calls, ['#record']);
    f.swipe(110, { pointerType });
    assert.deepEqual(f.calls, ['#record', '#team']);
  }
  const first = fixture(); first.swipe(100); assert.deepEqual(first.calls, []);
  const last = fixture({ active: 4 }); last.swipe(-100); assert.deepEqual(last.calls, []);
  const hidden = fixture({ active: 2 }); hidden.links[3].rect.width = 0; hidden.swipe(-100); assert.deepEqual(hidden.calls, ['#settings']);
});

test('short, vertical, and diagonal content gestures preserve the page and vertical scroll', () => {
  const f = fixture();
  f.swipe(-40);
  assert.deepEqual(f.calls, []);
  for (const [x, y] of [[202, 450], [300, 400], [207, 303]]) {
    f.point('pointerdown', 200, 300, { target: f.plain });
    const move = f.point('pointermove', x, y);
    f.point('pointerup', x, y);
    assert.equal(move.defaultPrevented, false);
    assert.deepEqual(f.calls, []);
  }
});

test('content swipe ignores controls, images, editable areas, nested scrollers, and system edges', () => {
  for (const tag of ['input', 'button', 'a', 'img', 'select', 'textarea', 'dialog', 'canvas', 'summary', 'label']) {
    const f = fixture();
    const target = f.content.append(new Element(tag));
    f.swipe(-110, { target });
    assert.deepEqual(f.calls, [], tag);
  }
  for (const attribute of ['contenteditable', 'data-no-swipe']) {
    const f = fixture(), target = f.content.append(new Element('div'));
    target.setAttribute(attribute, 'true');
    f.swipe(-110, { target });
    assert.deepEqual(f.calls, [], attribute);
  }
  for (const axis of ['X', 'Y']) {
    const f = fixture(), container = f.content.append(new Element('div'));
    container.computedStyle[`overflow${axis}`] = 'auto';
    container[axis === 'X' ? 'scrollWidth' : 'scrollHeight'] = 300;
    const target = container.append(new Element('p'));
    f.swipe(-110, { target });
    assert.deepEqual(f.calls, [], `scroll ${axis}`);
  }
  for (const x of [10, 20, 380, 390]) {
    const f = fixture({ active: 2 });
    f.point('pointerdown', x, 300, { target: f.plain });
    f.point('pointermove', 200, 300);
    f.point('pointerup', 200, 300);
    assert.deepEqual(f.calls, []);
  }
});

test('pinch and selected text do not become page navigation', () => {
  const f = fixture();
  f.point('pointerdown', 200, 300, { target: f.plain });
  f.point('pointermove', 170, 300);
  f.point('pointerdown', 300, 300, { target: f.plain, pointerId: 2, isPrimary: false });
  f.point('pointermove', 80, 300);
  f.point('pointerup', 80, 300);
  f.point('pointerup', 320, 300, { pointerId: 2 });
  assert.deepEqual(f.calls, []);
  f.win.getSelection = () => ({ isCollapsed: false });
  f.swipe(-110);
  assert.deepEqual(f.calls, []);
});

test('blocked screens, desktop layout, resizing, and destruction disable gesture navigation', () => {
  const f = fixture();
  f.block(true); f.swipe(-100); assert.deepEqual(f.calls, []);
  f.block(false);
  f.point('pointerdown', 55, 770);
  f.point('pointermove', 200, 770);
  f.block(true);
  f.point('pointerup', 200, 770);
  assert.deepEqual(f.calls, []);
  f.block(false);
  f.media.matches = false; f.media.emit('change');
  f.swipe(-100); assert.deepEqual(f.calls, []);
  assert.equal(f.root.classList.contains('has-nav-indicator'), false);
  f.media.matches = true; f.media.emit('change');
  assert.ok(f.root.classList.contains('has-nav-indicator'));
  f.links[0].rect.left = 30;
  f.win.emit('resize');
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '19px');
  f.controller.destroy();
  f.swipe(-100); assert.deepEqual(f.calls, []);
  assert.equal(f.root.classList.contains('has-nav-indicator'), false);
  assert.equal(f.root.style.getPropertyValue('--nav-indicator-x'), '');
});
