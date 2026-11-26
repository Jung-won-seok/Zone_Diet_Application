const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element extends EventTarget {
  constructor(dataset = {}) { super(); this.dataset = dataset; }
  attrs = new Map();
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); }
  fire(type, props = {}) { this.dispatchEvent(Object.assign(new Event(type), props)); }
}

function fixture() {
  const canvas = new Element();
  const captured = new Set();
  const dialog = { scrollTop: 100 };
  Object.assign(canvas, {
    clientWidth: 320, clientHeight: 200, closest: () => dialog,
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
  });
  const buttons = ['out', 'in'].map(cameraZoom => new Element({ cameraZoom }));
  const front = new Element({ cameraView: 'front' });
  const scale = new Element();
  const controls = {
    querySelectorAll: selector => selector === '[data-camera-view]' ? [front] : buttons,
    querySelector: () => scale,
  };
  const scope = vm.createContext({ AbortController });
  vm.runInContext(fs.readFileSync(require.resolve('../motion-3d-controls'), 'utf8'), scope);
  const changes = [];
  const camera = scope.mountMovementCamera(canvas, controls, view => changes.push(view));
  camera.setEnabled(true);
  const touch = (type, id, x, y) => canvas.fire(type, {
    button: 0, pointerType: 'touch', pointerId: id, clientX: x, clientY: y,
  });
  return { camera, changes, dialog, captured, buttons, scale, front, touch };
}

test('확대·축소 버튼은 배율 범위를 지키고 시점을 바꿔도 배율을 유지한다', () => {
  const { camera, changes, buttons: [out, zoomIn], scale, front } = fixture();
  zoomIn.fire('click');
  assert.equal(scale.textContent, '125%');
  front.fire('click');
  assert.deepEqual({ ...changes.at(-1) }, { yaw: Math.PI / 2, pitch: 0, zoom: 1.25 });
  for (let i = 0; i < 10; i++) zoomIn.fire('click');
  assert.equal(camera.getView().zoom, 3);
  assert.equal(zoomIn.disabled, true);
  camera.setEnabled(false);
  out.fire('click');
  camera.setEnabled(true);
  assert.equal(camera.getView().zoom, 3);
  for (let i = 0; i < 12; i++) out.fire('click');
  assert.equal(scale.textContent, '50%');
  assert.equal(out.disabled, true);
  assert.equal(zoomIn.disabled, false);
});

test('두 손가락의 간격에 비례해 확대·축소하고 남은 손가락으로 시점이 튀지 않는다', () => {
  const { camera, changes, captured, touch, dialog } = fixture();
  const original = { ...camera.getView() };
  touch('pointerdown', 1, 50, 50);
  touch('pointerdown', 2, 50, 90);
  touch('pointermove', 2, 50, 100);
  assert.deepEqual({ ...changes.at(-1) }, { ...original, zoom: 1.25 });
  touch('pointermove', 1, 50, 80);
  assert.deepEqual({ ...changes.at(-1) }, { ...original, zoom: 0.5 });
  assert.equal(dialog.scrollTop, 100);
  touch('pointercancel', 2, 50, 100);
  touch('pointermove', 1, 150, 80);
  assert.equal(changes.length, 2);
  touch('pointerup', 1, 150, 80);
  assert.equal(captured.size, 0);
  touch('pointerdown', 3, 30, 40);
  touch('pointermove', 3, 70, 40);
  assert.notEqual(camera.getView().yaw, original.yaw);
  camera.dispose();
  assert.equal(captured.size, 0);
  touch('pointermove', 3, 100, 40);
  assert.equal(changes.length, 3);
});

test('한 손가락 세로 스와이프는 가이드의 스크롤 위치만 이동한다', () => {
  const { changes, touch, dialog } = fixture();
  touch('pointerdown', 1, 50, 100);
  touch('pointermove', 1, 55, 75);
  assert.equal(dialog.scrollTop, 125);
  assert.equal(changes.length, 0);
});
