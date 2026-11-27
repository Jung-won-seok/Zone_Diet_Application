// The shapes describe the viewer's right half. Mirroring them keeps both sides
// in the same position on every front and rear diagram.
const movementMuscleAnatomy = (() => {
  const outline = 'M44 23 Q45 28 42 30 L32 33 Q25 34 22 41 L18 56 Q17 61 15 65 ' +
    'L9 81 L7 87 Q4 92 5 97 Q5 100 7 98 L10 92 Q9 98 11 97 L14 89 L16 83 ' +
    'Q23 72 24 65 L29 55 L31 49 Q32 58 35 66 L36 76 Q35 81 33 87 ' +
    'Q30 99 33 114 L35 128 Q34 135 34 140 Q31 152 36 164 L39 179 L38 184 ' +
    'Q33 187 34 190 Q39 192 46 188 L47 181 L46 169 Q47 159 47 151 L46 138 ' +
    'Q48 129 48 118 L50 102 L52 118 Q52 129 54 138 L53 151 Q53 159 54 169 ' +
    'L53 181 L54 188 Q61 192 66 190 Q67 187 62 184 L61 179 L64 164 ' +
    'Q69 152 66 140 Q66 135 65 128 L67 114 Q70 99 67 87 Q65 81 64 76 ' +
    'L65 66 Q68 58 69 49 L71 55 L76 65 Q77 72 84 83 L86 89 L89 97 ' +
    'Q91 98 90 92 L93 98 Q95 100 95 97 Q96 93 93 87 L91 81 L85 65 ' +
    'Q83 61 82 56 L78 41 Q75 34 68 33 L58 30 Q55 28 56 23 Z';
  const head = 'M40 13 Q40 3 50 3 Q60 3 60 13 L59 19 Q58 24 53 26 ' +
    'Q50 28 47 26 Q42 24 41 19 Z';
  const front = {
    shoulders: 'M66 34 Q74 34 77 43 L77 48 Q73 44 68 44 L64 39 Z',
    chest: 'M51 40 Q57 35 64 38 L69 45 Q67 49 61 51 Q56 53 51 50 Z',
    biceps: 'M70 46 Q74 45 76 49 L80 59 Q79 62 76 63 Q72 59 71 55 Z',
    forearms: 'M78 65 Q79 62 82 62 Q85 65 86 70 L90 82 L87 87 L82 77 Z',
    core: 'M51 53 Q59 55 65 50 L63 63 Q61 72 58 77 L52 81 L51 72 Z',
    hipFlexors: 'M62 76 Q65 79 66 86 L65 93 Q60 88 56 86 L53 84 Z',
    quads: 'M58 89 Q61 89 66 95 Q68 103 65 115 L63 127 Q60 131 57 126 ' +
      'L54 117 Q53 105 55 98 Z'
  };
  const back = {
    shoulders: 'M65 34 Q72 33 76 40 L78 47 Q74 48 69 45 L65 41 Z',
    back: 'M52 32 Q58 34 64 35 L67 41 L68 47 Q67 57 61 65 L55 72 ' +
      'L52 68 L51 50 Z',
    triceps: 'M71 47 Q74 47 78 49 L81 60 L79 64 Q75 63 72 57 Z',
    forearms: 'M79 65 Q82 62 84 66 L90 81 L89 86 L85 81 L81 73 Z',
    glutes: 'M51 84 Q56 79 62 80 Q67 83 67 94 Q65 100 58 100 ' +
      'Q52 99 51 96 Z',
    hamstrings: 'M54 100 Q60 104 67 99 L66 112 Q65 124 62 130 ' +
      'L58 128 Q54 119 54 111 Z',
    calves: 'M58 138 Q61 135 64 137 Q67 145 65 153 Q63 160 60 167 ' +
      'L57 160 Q54 151 56 143 Z'
  };

  function pair(path) {
    return `<path d="${path}"></path><path d="${path}" transform="translate(100 0) scale(-1 1)"></path>`;
  }

  function figure(side) {
    const facingFront = side === 'front';
    const regions = facingFront ? front : back;
    const contours = facingFront
      ? 'M45 16 L47 16 M53 16 L55 16 M48 22 Q50 23 52 22 M38 34 L46 36 M62 34 L54 36 M36 134 Q40 137 44 134 M56 134 Q60 137 64 134 M42 144 L43 172 M58 144 L57 172'
      : 'M42 14 Q49 18 58 14 M45 21 Q50 24 55 21 M50 35 L50 76 M39 72 L45 79 M61 72 L55 79 M38 133 L44 132 M62 133 L56 132';
    return `<figure class="motion-muscle-figure" data-muscle-side="${side}">
      <svg viewBox="0 0 100 194" aria-hidden="true" focusable="false">
        <path class="muscle-body" d="${outline}"></path>
        <path class="muscle-body" d="${head}"></path>
        ${Object.entries(regions).map(([id, path]) =>
          `<g class="muscle-area" data-muscle-region="${id}">${pair(path)}</g>`).join('')}
        <path class="muscle-contour" d="${contours}"></path>
      </svg>
      <figcaption>${facingFront ? '앞면' : '뒷면'}</figcaption>
    </figure>`;
  }
  return { front: figure('front'), back: figure('back') };
})();

function movementMuscleView() {
  return `<section class="motion-muscles" data-motion-muscles aria-label="이 단계의 주요 근육">
    <div class="motion-muscle-map" aria-hidden="true">${movementMuscleAnatomy.front}${movementMuscleAnatomy.back}</div>
    <div class="motion-muscle-copy">
      <h4>이 단계의 주요 근육</h4>
      <ul class="motion-muscle-labels" data-muscle-labels></ul>
    </div>
  </section>`;
}

function updateMovementMuscleView(panel, regionIds) {
  const active = new Set(regionIds.filter(id => Object.hasOwn(movementMuscleLabels, id)));
  for (const area of panel.querySelectorAll('[data-muscle-region]')) {
    if (active.has(area.dataset.muscleRegion)) area.setAttribute('data-active', 'true');
    else area.removeAttribute('data-active');
  }
  const list = panel.querySelector('[data-muscle-labels]');
  const items = Array.from(active, id => {
    const item = list.ownerDocument.createElement('li');
    item.textContent = movementMuscleLabels[id];
    return item;
  });
  list.replaceChildren(...items);
}
