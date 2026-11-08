// Small, local SVG vocabulary. Paths are static and never come from user data.
const ZONDA_ICONS = Object.freeze({
  today: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M20.5 20v-2a5.5 5.5 0 0 0-3.5-5.1"/>',
  board: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 10h17M10 10v10.5M7 7h.01M10 7h.01"/>',
  record: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>',
  progress: '<path d="M4 4v16h16M7 15l4-4 3 2 6-7M16 6h4v4"/>',
  admin: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  accounts: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="9" cy="9" r="2.5"/><path d="M5.5 16.5a3.5 3.5 0 0 1 7 0M15.5 8h2M15.5 12h2M15.5 16h2"/>',
  naver: '<path d="m9 15 6-6M8.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M15.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/>',
  settings: '<path d="m9.8 3-.6 2.1-2 .9-2.1-.5L3 9.2l1.5 1.6v2.4L3 14.8l2.1 3.7 2.1-.5 2 .9.6 2.1h4.4l.6-2.1 2-.9 2.1.5 2.1-3.7-1.5-1.6v-2.4L21 9.2l-2.1-3.7-2.1.5-2-.9-.6-2.1z"/><circle cx="12" cy="12" r="3"/>',
  scale: '<rect x="4" y="3.5" width="16" height="17" rx="4"/><path d="M8 9a4 4 0 0 1 8 0M12 9l2-2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".7" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h1M15 14h1M8 17h1"/>',
  meal: '<path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M18 3c-2 2-3 5-3 8h4M19 3v18"/>',
  exercise: '<path d="m7 7 10 10M4 9l5-5M3 6l3-3M15 20l5-5M18 21l3-3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h11"/>'
});

function zondaIcon(name, className = '') {
  const extraClass = typeof className === 'string' && /^[a-zA-Z0-9_ -]*$/.test(className) ? className.trim() : '';
  const path = Object.hasOwn(ZONDA_ICONS, name) ? ZONDA_ICONS[name] : ZONDA_ICONS.arrow;
  return `<svg class="zonda-icon${extraClass ? ' '+extraClass : ''}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
