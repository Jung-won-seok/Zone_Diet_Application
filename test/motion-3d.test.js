const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const scene = vm.createContext({ window: { devicePixelRatio: 1 } });
for (const file of ['guide-movements', 'motion-strength', 'motion-equipment', 'motion-bodyweight', 'motion-muscle-ups',
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

test('ring muscle-up keeps each moving hand on its own closed ring and each strap on its mount', () => {
  const motion = scene.getMovementMotion('ring-muscle-up');
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const startPose = motion.frames[0].pose;
  for (const sign of [-1, 1]) {
    const start = scene.movementRingGeometry(motion.anchor, startPose, sign);
    let travel = 0;
    for (let i = 0; i <= 40; i++) {
      const { pose } = scene.sampleMovementPose(motion, i * motion.duration / 40);
      const ring = scene.movementRingGeometry(motion.anchor, pose, sign);
      const parts = build(motion, pose);
      const hasTube = (from, to) => parts.some(p => p.type === 'tube' &&
        ((distance(p.a, from) < 0.001 && distance(p.b, to) < 0.001) ||
         (distance(p.b, from) < 0.001 && distance(p.a, to) < 0.001)));
      assert.equal(distance(start.mount, ring.mount), 0);
      assert.ok(Math.abs(distance(ring.mount, ring.top) - distance(start.mount, start.top)) < 1);
      assert.ok(hasTube(ring.mount, ring.top));
      assert.equal(distance(ring.grip, ring.points[0]), 0);
      assert.equal(distance(ring.grip, ring.points.at(-1)), 0);
      assert.ok(parts.some(p => p.type === 'ellipsoid' && distance(p.center, ring.grip) < 0.001));
      for (let j = 1; j < ring.points.length; j++) assert.ok(hasTube(ring.points[j - 1], ring.points[j]));
      travel = Math.max(travel, distance(start.grip, ring.grip));
    }
    assert.ok(travel > 1, 'the grip moves with the swing');
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
