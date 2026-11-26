const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const browser = vm.createContext({});
for (const file of ['guide-movements', 'motion-bodyweight', 'motion-strength', 'motion-equipment', 'motion-muscle-ups', 'motion-timeline']) {
  vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), browser);
}
const ids = vm.runInContext('guideMovements.map(m => m.id)', browser);
const required = ['head', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'toe'];
const segment = (p, a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);

test('both muscle-ups reach straight-arm support above the grip and return to the starting hang', () => {
  for (const id of ['bar-muscle-up', 'ring-muscle-up']) {
    const { frames } = browser.getMovementMotion(id);
    const hang = frames[0].pose;
    const support = frames.find(f => f.label === '팔을 펴고 지지하기').pose;
    assert.ok(hang.shoulder[1] > hang.wrist[1] && support.shoulder[1] < support.wrist[1], id);
    for (const pose of [hang, support]) {
      const reach = segment(pose, 'wrist', 'shoulder');
      const arm = segment(pose, 'wrist', 'elbow') + segment(pose, 'elbow', 'shoulder');
      assert.ok(reach > 0.98 * arm, id);
    }
    assert.deepEqual(frames.at(-1).pose, hang, id);
  }
});

test('every guide movement has a complete timeline that can be scrubbed in either direction', () => {
  assert.deepEqual(Array.from(ids).sort(), Array.from(vm.runInContext('Object.keys(movementMotions)', browser)).sort());
  assert.equal(browser.getMovementMotion('constructor'), null);
  for (const id of ids) {
    const motion = browser.getMovementMotion(id), { frames } = motion;
    assert.equal(frames[0].at, 0, id);
    assert.equal(frames.at(-1).at, motion.duration, id);
    assert.equal(browser.sampleMovementPose(motion, -1).pose, frames[0].pose);
    assert.equal(browser.sampleMovementPose(motion, motion.duration + 1).pose, frames.at(-1).pose);
    const poseKeys = Object.keys(frames[0].pose).sort();
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i], next = frames[i + 1];
      const sample = browser.sampleMovementPose(motion, frame.at);
      assert.equal(sample.phaseIndex, i, id);
      assert.equal(sample.pose, frame.pose, id);
      assert.ok(frame.label.trim(), id);
      assert.deepEqual(Object.keys(frame.pose).sort(), poseKeys, id);
      for (const key of required) assert.equal(frame.pose[key].length, 2, id);
      if (!next) continue;
      assert.ok(next.at > frame.at, id);
      for (const progress of [0.25, 0.5, 0.75]) {
        const between = browser.sampleMovementPose(motion, frame.at + (next.at - frame.at) * progress);
        assert.equal(between.phaseIndex, i);
        assert.ok(Object.values(between.pose).flat().every(Number.isFinite), id);
        // Rapid changes of direction must not collapse a limb halfway through a scrub.
        for (const [a, b] of [['shoulder', 'elbow'], ['elbow', 'wrist'], ['hip', 'knee'], ['knee', 'ankle']]) {
          const min = Math.min(segment(frame.pose, a, b), segment(next.pose, a, b));
          assert.ok(segment(between.pose, a, b) > min * 0.7, id + ' ' + a + ' ' + b);
        }
        if (motion.equipment === 'rig') assert.deepEqual(between.pose.wrist, motion.anchor, id);
        if (motion.equipment === 'barbell') assert.deepEqual(between.pose.wrist, between.pose.gear, id);
      }
    }
  }
});
