// Decorative scorekeeping instruments. Values mirror the guide's workout examples.
const guideTermMotifs = {
  wod: '<i class="gt-paper"><i></i><i></i><i></i></i>',
  amrap: '<i class="gt-digits">10:00</i><i class="gt-progress"></i>',
  emom: '<i class="gt-intervals"></i><i class="gt-scale"><i>00</i><i>01</i><i>02</i></i>',
  'for-time': '<i class="gt-watch"><i class="gt-hand"></i></i><i class="gt-digits">06:42</i>',
  rx: '<i class="gt-stamp">Rx</i><i class="gt-check"></i>',
  scaled: '<i class="gt-slider"></i><i class="gt-slider"></i><i class="gt-slider"></i>',
  rep: '<i class="gt-tally"></i><i class="gt-tally"></i>',
  round: '<i class="gt-circuit"><i></i><i></i><i></i></i>',
  'time-cap': '<i class="gt-digits">12:00</i><i class="gt-deadline"></i>',
  benchmark: '<i class="gt-bars"><i></i><i></i><i></i></i><i class="gt-reference"></i>',
};

function guideTermArt(entry) {
  if (!Object.hasOwn(guideTermMotifs, entry.id)) return '';
  return `<span class="guide-term-art" aria-hidden="true"><i class="gt-face gt-${entry.id}">${guideTermMotifs[entry.id]}</i></span>`;
}
