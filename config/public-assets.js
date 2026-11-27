// Only the files listed here can be served by the local server or copied to public/.
// The filename is the public URL. Moving its source must not invalidate bookmarks or worker scopes.
const groups = {
  'client': [
    'index.html',
  ],
  'client/app': [
    'app.js', 'styles.css', 'box.css', 'club-theme.css', 'mobile-nav.css', 'mobile-nav.js',
  ],
  'client/members': [
    'member-management.js', 'memberships.css', 'recovery.js', 'notifications.css',
    'notifications.js',
  ],
  'client/training': [
    'reservations.js', 'schedule-ui.css', 'schedule-ui.js', 'wod.css', 'wod.js',
  ],
  'client/zonda': [
    'admin.css', 'admin.js', 'meals.css', 'meals.js', 'cafe-draft.css', 'cafe-draft.js',
    'zonda-theme.css',
  ],
  'client/naver': [
    'naver-ui.css', 'naver-ui.js',
  ],
  'client/guide': [
    'guide.css', 'guide.js', 'guide-match.js', 'guide-movements.js', 'guide-terms.js',
    'guide-movement-art.css', 'guide-movement-art.js', 'guide-term-art.css', 'guide-term-art.js',
  ],
  'client/guide/motion': [
    'motion-3d-controls.js', 'motion-3d-model.js', 'motion-3d-renderer.js', 'motion-3d.css',
    'motion-bodyweight.js', 'motion-equipment.js', 'motion-muscle-ups.js', 'motion-muscle-view.js',
    'motion-muscles.css', 'motion-muscles.js', 'motion-player.css', 'motion-player.js',
    'motion-renderer.js', 'motion-strength.js', 'motion-timeline.js',
  ],
  'client/pwa': [
    'leben.webmanifest', 'push-worker.js',
  ],
  'client/assets/images': [
    'leben-192.png', 'leben-512.png', 'leben-training.png', 'guide-movement-poses.png',
    'guide-portrait-dt.webp', 'guide-portrait-murph.webp', 'guide-wod-gear.webp',
  ],
  'shared': [
    'guide-benchmarks.js', 'meal-summary.js',
  ],
};

module.exports = Object.fromEntries(Object.entries(groups).flatMap(([directory, files]) =>
  files.map(name => [name, `${directory}/${name}`])
));
