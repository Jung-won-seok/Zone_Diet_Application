const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const motion = {
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
  fire(type) { this.dispatchEvent(new Event(type)); }
}

function fixture() {
  const controls = new Map(['canvas', 'play', 'play-label', 'icon', 'rate', 'time', 'current', 'label']
    .map(key => [key, new Control()]));
  const steps = [0, 2, 3].map(index => {
    const button = new Control();
    button.dataset.motionPhase = String(index);
    return button;
  });
  const root = {
    querySelector(selector) { return controls.get(selector.replace(/^\[data-motion-(.+)\]$/, '$1')); },
    querySelectorAll() { return steps; }
  };
  const document = new Control();
  let now = 0, next = 0, disconnected = false;
  const frames = new Map(), draws = [];
  const ui = vm.createContext({
    escapeHTML: value => value,
    AbortController,
    performance: { now: () => now },
    document,
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      observe() {}
      disconnect() { disconnected = true; }
    },
    drawMovementPose(canvas, definition, pose) {
      assert.equal(canvas, controls.get('canvas'));
      assert.equal(definition, motion);
      draws.push(pose.time);
    },
    sampleMovementPose(definition, time) {
      return { pose: { time }, phaseIndex: definition.frames.findLastIndex(frame => frame.at <= time) };
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../motion-player.js'), 'utf8'), ui);
  const player = ui.mountMovementPlayer(root, motion);
  return {
    player, ui, document, frames, steps, controls, draws, disconnected: () => disconnected,
    el: key => controls.get(key),
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

test('반속 재생과 끝에서 다시 재생, 탭 이탈과 정리가 일관되게 적용된다', () => {
  const f = fixture();
  f.el('play').fire('click');
  f.tick(500);
  f.el('rate').fire('click');
  assert.equal(f.el('rate').textContent, '0.5×');
  f.tick(1000);
  assert.equal(f.draws.at(-1), 1);
  f.tick(5000);
  assert.equal(f.draws.at(-1), 2);
  assert.equal(f.el('play-label').textContent, '다시 재생');
  assert.equal(f.frames.size, 0);
  f.el('play').fire('click');
  assert.equal(f.draws.at(-1), 0);
  f.tick(200);
  f.document.hidden = true;
  f.document.fire('visibilitychange');
  assert.equal(f.frames.size, 0);
  assert.equal(f.draws.at(-1), 0.1);
  f.document.hidden = false;
  f.el('play').fire('click');
  f.player.pause();
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
