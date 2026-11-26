const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const scene = vm.createContext({ window: { devicePixelRatio: 1 } });
for (const file of ['guide-movements', 'motion-strength', 'motion-equipment', 'motion-bodyweight',
  'motion-timeline', 'motion-muscles', 'motion-3d-model', 'motion-3d-renderer']) {
  vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), scene);
}
const ids = vm.runInContext('guideMovements.map(entry => entry.id)', scene);
const build = vm.runInContext('buildMovementScene3D', scene);
const draw = vm.runInContext('drawMovementPose3D', scene);

test('3D equipment and athlete follow the sampled pose at keyframes and during a scrub', () => {
  for (const id of ids) {
    const motion = scene.getMovementMotion(id);
    for (let i = 0; i < motion.frames.length; i++) {
      const start = motion.frames[i].at, next = motion.frames[i + 1];
      for (const time of next ? [start, (start + next.at) / 2] : [start]) {
        const { pose, phaseIndex } = scene.sampleMovementPose(motion, time);
        const parts = build(motion, pose, scene.getMovementMuscles(id, phaseIndex));
        const reason = id + ' at ' + time;
        for (const part of parts) {
          const points = part.type === 'tube' ? [part.a, part.b] : [part.center, ...part.axes];
          assert.ok(points.every(p => p.length === 3 && p.every(Number.isFinite)), reason);
        }
        const centers = parts.filter(p => p.type === 'ellipsoid').map(p => p.center);
        const hands = centers.filter(([x, y]) => x === pose.wrist[0] && y === pose.wrist[1]);
        assert.ok(hands.some(p => p[2] < 0) && hands.some(p => p[2] > 0), reason);
        if (motion.equipment === 'barbell' || motion.equipment === 'rig') {
          const [x, y] = motion.equipment === 'rig' ? motion.anchor : pose.gear;
          const grips = hands.map(p => p[2]);
          assert.ok(parts.some(p => p.type === 'tube' && [p.a, p.b].every(v => v[0] === x && v[1] === y)
            && Math.min(p.a[2], p.b[2]) < Math.min(...grips) && Math.max(p.a[2], p.b[2]) > Math.max(...grips)), reason);
        }
      }
    }
  }
});

test('3D rotation, time and muscle emphasis each change the rendered pixels', () => {
  let pixels;
  const context = {
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(image) { pixels = image.data; },
  };
  const canvas = { clientWidth: 160, getContext: () => context };
  const motion = scene.getMovementMotion('thruster');
  function render(seconds, yaw, highlight = true) {
    const { pose, phaseIndex } = scene.sampleMovementPose(motion, seconds);
    const regions = highlight ? scene.getMovementMuscles(motion.id, phaseIndex) : [];
    assert.ok(draw(canvas, motion, pose, regions, { yaw, pitch: 0.09 }));
    return createHash('sha256').update(pixels).digest('hex');
  }
  const start = render(0, 0.48);
  assert.notEqual(render(motion.duration, 0.48), start);
  assert.notEqual(render(0, 0.48, false), start);
  const views = [render(0, 0), render(0, Math.PI / 2), render(0, -Math.PI / 2), start];
  assert.equal(new Set(views).size, 4);
  assert.equal(render(0, 0.48), start);
});
