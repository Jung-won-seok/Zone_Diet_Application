const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const simulation = vm.createContext({});
for (const file of ['motion-strength', 'motion-equipment', 'motion-bodyweight', 'motion-muscle-ups', 'motion-timeline', 'motion-muscles']) {
  vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), simulation);
}
const regionLabels = vm.runInContext('movementMuscleLabels', simulation);
const motions = vm.runInContext('movementMotions', simulation);

test('every simulation stage has distinct, named muscle regions, including the final frame', () => {
  const highlighted = new Set();
  for (const [id, motion] of Object.entries(motions)) {
    for (const [index, frame] of motion.frames.entries()) {
      const regions = simulation.getMovementMuscles(id, index);
      const message = id + ': ' + frame.label;
      assert.ok(regions.length >= 1 && regions.length <= 3, message);
      assert.equal(new Set(regions).size, regions.length, message);
      for (const region of regions) {
        assert.ok(Object.hasOwn(regionLabels, region), message);
        assert.match(regionLabels[region], /[가-힣]/, message);
        highlighted.add(region);
      }
    }
  }
  assert.deepEqual([...highlighted].sort(), Object.keys(regionLabels).sort());
});

test('scrubbing across the leg drive and arm pull highlights different regions in either direction', () => {
  const row = motions.row;
  for (const [seconds, expected] of [[0.5, 'quads'], [0.85, 'biceps'], [1.25, 'triceps'], [0.5, 'quads']]) {
    const { phaseIndex } = simulation.sampleMovementPose(row, seconds);
    assert.ok(simulation.getMovementMuscles('row', phaseIndex).includes(expected));
  }
  for (const [id, phase] of [['constructor', 1], ['missing', 0], ['row', -1], ['row', row.frames.length], ['row', 0.5]]) {
    assert.deepEqual(Array.from(simulation.getMovementMuscles(id, phase)), []);
  }
});
