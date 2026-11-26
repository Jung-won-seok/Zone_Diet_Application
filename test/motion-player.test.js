const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const motion = {
  id: 'test-lift',
  duration: 2,
  frames: [
    { at: 0, label: '준비' }, { at: 0.3, label: '준비' },
    { at: 0.8, label: '들기' }, { at: 2, label: '마무리' },
  ],
};

class Control extends EventTarget {
  dataset = {};
  attrs = {};
  textContent = '';
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  focus() { this.focused = true; }
  fire(type, props) { return this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props)); }
}

function fixture() {
  const controls = new Map(['canvas', 'play', 'play-label', 'icon', 'rate', 'rates', 'time', 'current', 'label', 'muscles', 'camera']
    .map(key => [key, new Control()]));
  controls.get('rates').hidden = true;
  const speeds = [0.5, 0.75, 1, 1.25, 1.5].map(speed => {
    const button = new Control();
    button.dataset.motionSpeed = String(speed);
    return button;
  });
  const steps = [0, 2, 3].map(index => {
    const button = new Control();
    button.dataset.motionPhase = String(index);
    return button;
  });
  const modes = ['2d', '3d'].map(mode => {
    const button = new Control();
    button.dataset.motionMode = mode;
    return button;
  });
  const presets = ['oblique', 'front', 'side', 'back'].map(view => {
    const button = new Control();
    button.dataset.cameraView = view;
    return button;
  });
  const zoomScale = new Control();
  controls.get('camera').querySelector = selector => selector === '[data-camera-scale]' ? zoomScale : null;
  controls.get('camera').querySelectorAll = selector => selector === '[data-camera-view]' ? presets : [];
  const root = Object.assign(new Control(), {
    querySelector(selector) { return controls.get(selector.replace(/^\[data-motion-(.+)\]$/, '$1')); },
    querySelectorAll(selector) {
      return { '[data-motion-mode]': modes, '[data-motion-phase]': steps, '[data-motion-speed]': speeds }[selector];
    }
  });
  const document = new Control();
  let now = 0, next = 0, disconnected = false;
  const frames = new Map(), draws = [], draws3D = [], muscleUpdates = [];
  const ui = vm.createContext({
    escapeHTML: value => value,
    movementMuscleView: () => '<section data-motion-muscles></section>',
    getMovementMuscles(id, phase) {
      assert.equal(id, motion.id);
      return [['core'], ['core'], ['quads'], ['shoulders']][phase];
    },
    updateMovementMuscleView(panel, regions) {
      assert.equal(panel, controls.get('muscles'));
      muscleUpdates.push(regions);
    },
    AbortController,
    performance: { now: () => now },
    document,
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      observe() {}
      disconnect() { disconnected = true; }
    },
    drawMovementPose(canvas, definition, pose, regions) {
      assert.equal(canvas, controls.get('canvas'));
      assert.equal(definition, motion);
      assert.equal(regions, muscleUpdates.at(-1));
      draws.push(pose.time);
    },
    drawMovementPose3D(canvas, definition, pose, regions, view) {
      assert.equal(canvas, controls.get('canvas'));
      assert.equal(definition, motion);
      draws3D.push({ time: pose.time, regions, yaw: view.yaw });
    },
    sampleMovementPose(definition, time) {
      return { pose: { time }, phaseIndex: definition.frames.findLastIndex(frame => frame.at <= time) };
    },
  });
  for (const file of ['motion-3d-controls', 'motion-player']) {
    vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), ui);
  }
  const player = ui.mountMovementPlayer(root, motion);
  return {
    player, ui, root, document, frames, steps, controls, draws, draws3D, muscleUpdates, modes, presets, speeds, disconnected: () => disconnected,
    el: key => controls.get(key),
    elapse(ms) { now += ms; },
    tick(ms) {
      now += ms;
      const callbacks = Array.from(frames.values());
      frames.clear();
      callbacks.forEach(callback => callback(now));
    },
  };
}

test('시간 이동과 단계 선택은 즉시 자세를 바꾸고 재생을 멈춘다', () => {
  const f = fixture();
  assert.equal(f.draws.at(-1), 0);
  assert.equal(f.frames.size, 0);
  assert.doesNotMatch(f.ui.movementPlayerView(motion), /data-motion-phase="1"/);
  f.el('play').fire('click');
  f.tick(700);
  assert.equal(f.draws.at(-1), 0.7);
  f.el('time').value = '1.07';
  f.el('time').fire('input');
  assert.equal(f.draws.at(-1), 1.07);
  assert.equal(f.el('current').textContent, '1.07');
  assert.equal(f.el('time').attrs['aria-valuetext'], '1.07초, 들기');
  assert.equal(f.steps[1].attrs['aria-current'], 'step');
  assert.equal(f.frames.size, 0);
  f.steps[0].fire('click');
  assert.equal(f.draws.at(-1), 0);
  assert.equal(f.steps[1].attrs['aria-current'], undefined);
});

test('2D·3D 전환과 카메라 회전은 현재 시각과 근육 표시를 유지한다', () => {
  const f = fixture();
  f.el('time').value = '1.25';
  f.el('time').fire('input');
  f.modes[1].fire('click');
  assert.equal(f.el('camera').hidden, false);
  assert.deepEqual(f.draws3D.at(-1), { time: 1.25, regions: ['quads'], yaw: 0.48 });
  f.presets[1].fire('click');
  assert.equal(f.draws3D.at(-1).yaw, Math.PI / 2);
  assert.equal(f.el('time').value, '1.25');
  f.el('play').fire('click');
  f.tick(100);
  f.modes[0].fire('click');
  assert.equal(f.draws.at(-1), 1.35);
  assert.equal(f.el('camera').hidden, true);
  assert.equal(f.frames.size, 1);
  f.modes[1].fire('click');
  assert.equal(f.draws3D.at(-1).yaw, Math.PI / 2);
  f.steps[0].fire('click');
  assert.deepEqual(f.draws3D.at(-1), { time: 0, regions: ['core'], yaw: Math.PI / 2 });
  f.player.dispose();
  assert.equal(f.el('camera').hidden, true);
});

test('반속에서도 남은 시간을 다음 반복에 넘기고 일시정지한 위치에서 재개한다', () => {
  const f = fixture();
  f.el('play').fire('click');
  f.tick(500);
  f.el('rate').fire('click');
  f.speeds[0].fire('click');
  assert.equal(f.el('rate').textContent, '배속 0.5×');
  f.tick(1000);
  assert.equal(f.draws.at(-1), 1);
  f.tick(10500);
  assert.equal(f.draws.at(-1), 0.25);
  assert.equal(f.el('play-label').textContent, '일시정지');
  assert.equal(f.frames.size, 1);
  f.elapse(100);
  f.el('play').fire('click');
  assert.equal(f.draws.at(-1), 0.3);
  assert.equal(f.el('play-label').textContent, '재생');
  assert.equal(f.frames.size, 0);
  f.elapse(4000);
  f.el('play').fire('click');
  f.tick(200);
  assert.equal(f.draws.at(-1), 0.4);
  f.steps.at(-1).fire('click');
  assert.equal(f.draws.at(-1), motion.duration);
  assert.equal(f.el('play-label').textContent, '다시 재생');
  f.el('play').fire('click');
  assert.equal(f.draws.at(-1), 0);
  f.tick(4000);
  assert.equal(f.draws.at(-1), 0);
  assert.equal(f.frames.size, 1);
});

test('다섯 가지 배속은 선택 시점부터 적용되고 배속을 열거나 Esc로 닫아도 재생은 이어진다', () => {
  const f = fixture();
  const rates = [0.5, 0.75, 1, 1.25, 1.5];
  const html = f.ui.movementPlayerView(motion);
  assert.deepEqual([...html.matchAll(/data-motion-speed="([^"]+)"/g)].map(match => Number(match[1])), rates);
  assert.match(html, /data-motion-speed="1"[^>]+aria-pressed="true"/);
  assert.match(html, /aria-controls="motion-rates-test-lift"/);
  assert.match(html, /id="motion-rates-test-lift"[^>]+hidden/);
  f.el('rate').fire('click');
  assert.equal(f.el('rate').attrs['aria-expanded'], 'true');
  assert.equal(f.root.fire('keydown', { key: 'Escape' }), false);
  assert.equal(f.el('rate').attrs['aria-expanded'], 'false');
  assert.ok(f.el('rate').focused);
  assert.equal(f.frames.size, 0);
  f.el('play').fire('click');
  let speed = 1, time = 0;
  for (const [i, nextSpeed] of rates.entries()) {
    f.el('rate').fire('click');
    assert.equal(f.el('rates').hidden, false);
    f.elapse(120);
    f.speeds[i].fire('click');
    time = (time + 0.12 * speed) % motion.duration;
    assert.equal(f.el('current').textContent, time.toFixed(2));
    assert.equal(f.el('rate').attrs['aria-label'], `재생 속도 ${nextSpeed}배`);
    assert.equal(f.el('rates').hidden, true);
    assert.deepEqual(f.speeds.filter(button => button.attrs['aria-pressed'] === 'true'), [f.speeds[i]]);
    assert.equal(f.frames.size, 1);
    f.tick(400);
    speed = nextSpeed;
    time = (time + 0.4 * speed) % motion.duration;
    assert.equal(f.el('current').textContent, time.toFixed(2));
  }
  f.player.pause();
  f.el('rate').fire('click');
  f.speeds[1].fire('click');
  assert.equal(f.el('current').textContent, time.toFixed(2));
  assert.equal(f.frames.size, 0);
});

test('탭이 숨겨진 동안은 그리지 않고 복귀하면 반복 재생을 이어 간다', () => {
  const f = fixture();
  f.el('play').fire('click');
  f.tick(200);
  f.elapse(50);
  f.document.hidden = true;
  f.document.fire('visibilitychange');
  assert.equal(f.frames.size, 0);
  const hiddenCount = f.draws.length;
  f.tick(4100);
  assert.equal(f.draws.length, hiddenCount);
  f.document.hidden = false;
  f.document.fire('visibilitychange');
  assert.equal(f.frames.size, 1);
  f.tick(250);
  assert.equal(f.draws.at(-1), 0.5);
  f.document.hidden = true;
  f.document.fire('visibilitychange');
  f.player.pause();
  f.document.hidden = false;
  f.document.fire('visibilitychange');
  assert.equal(f.frames.size, 0);
  f.el('play').fire('click');
  f.player.dispose();
  f.player.dispose();
  assert.ok(f.disconnected());
  const count = f.draws.length;
  f.el('play').fire('click');
  f.tick(1000);
  assert.equal(f.draws.length, count);
  assert.equal(f.frames.size, 0);
});
