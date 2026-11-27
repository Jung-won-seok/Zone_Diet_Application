// Row-major order of the 6 × 4 atlas, rendered from the corresponding 3D motion timelines.
const guideMovementPoseTiles = [
  'toes-to-bar', 'thruster', 'pull-up', 'bar-muscle-up', 'ring-muscle-up', 'push-up',
  'air-squat', 'deadlift', 'front-squat', 'overhead-squat', 'push-press', 'push-jerk',
  'clean-and-jerk', 'snatch', 'power-clean', 'power-snatch', 'burpee', 'box-jump',
  'double-under', 'wall-ball', 'kettlebell-swing', 'sit-up', 'handstand-push-up', 'row',
];

function guideMovementArt(entry) {
  const tile = guideMovementPoseTiles.indexOf(entry.id);
  if (tile < 0) return '';
  const x = (tile % 6) * 100 / 5;
  const y = Math.floor(tile / 6) * 100 / 3;
  return `<span class="guide-movement-art" aria-hidden="true" style="background-position:${x}% ${y}%"></span>`;
}
