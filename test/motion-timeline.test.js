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

test('each cycle joins with the same pose, equipment position and travel velocity', () => {
  const dt = 0.0001;
  for (const id of ids) {
    const motion = browser.getMovementMotion(id);
    const [before, end, start, after] = [motion.duration - dt, motion.duration, 0, dt]
      .map(at => browser.sampleMovementPose(motion, at).pose);
    for (const key of Object.keys(start)) {
      const values = [before, end, start, after].map(pose => [pose[key]].flat());
      // After two forward turns the rope has the same orientation in space.
      const winding = key === 'ropeAngle' ? 4 * Math.PI : 0;
      for (let axis = 0; axis < values[0].length; axis++) {
        const [left, last, first, right] = values.map(point => point[axis]);
        assert.ok(Math.abs(last - first - winding) < 1e-8, id + ' ' + key + ' position');
        assert.ok(Math.abs((last - left) / dt - (right - first) / dt) < 1, id + ' ' + key + ' velocity');
      }
    }
  }
});

test('box jump steps down one foot at a time without passing either foot through the box', () => {
  const motion = browser.getMovementMotion('box-jump');
  const top = motion.frames.find(frame => frame.label === '박스 위에서 일어서기' && frame.pose.toe[1] === motion.anchor[1]);
  const [edge, height] = motion.anchor;
  for (let t = top.at; t <= motion.duration; t += 1 / 120) {
    const { pose } = browser.sampleMovementPose(motion, t);
    for (const foot of [pose.toe, pose.rearToe]) {
      assert.ok(foot[0] < edge || foot[1] <= height + 1e-6, 'foot goes through platform');
    }
    const nearOnBox = pose.toe[0] >= edge && pose.toe[1] === height;
    const farOnFloor = pose.rearToe[1] === 202;
    assert.ok(nearOnBox || farOnFloor || pose.toe[1] === 202, 'step down must stay supported');
  }
  // The transfer between legs is also a stable, individually scrubbable pose.
  const transfer = motion.frames.find(frame => frame.label === '뒷발로 바닥 짚기').pose;
  assert.equal(transfer.toe[1], height);
  assert.equal(transfer.rearToe[1], 202);
});

test('the double-under rotates forward through two airborne passes per repetition', () => {
  const motion = browser.getMovementMotion('double-under');
  let previousAngle = motion.frames[0].pose.ropeAngle, passes = 0;
  for (let i = 1; i <= 360; i++) {
    const { pose } = browser.sampleMovementPose(motion, motion.duration * i / 360);
    assert.ok(pose.ropeAngle > previousAngle);
    const pass = (passes + 0.25) * 2 * Math.PI;
    if (previousAngle < pass && pose.ropeAngle >= pass) {
      assert.ok(pose.toe[1] < 198);
      passes++;
    }
    previousAngle = pose.ropeAngle;
  }
  assert.equal(passes, 2);
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
