function guideAliasKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\s\p{Pd}]+/gu, '').replace(/[’‘]/g, "'");
}

function guideSearchMatches(entry, query) {
  const key = guideAliasKey(query);
  if (!key) return true;
  const latin = /^[a-z0-9]+$/.test(key);
  return [entry.name, entry.english, ...(entry.aliases || [])].some(name => {
    if (!guideAliasKey(name).includes(key)) return false;
    if (!latin) return true;
    // Join complete words for "muscleup", without matching "rmu" across "bar muscle-up".
    const words = name.normalize('NFKC').split(/[\s\p{Pd}]+/u).map(guideAliasKey);
    return words.some((word, index) => word.includes(key) || words.slice(index).join('').startsWith(key));
  });
}

function guideMovementPlural(name) {
  if (!/^[a-z0-9 -]+$/i.test(name)) return '';
  if (/(?:ss|sh|ch|x|z)$/i.test(name)) return name + 'es';
  if (/[^aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies';
  if (/s$/i.test(name) || !/[a-z]$/i.test(name)) return '';
  return name + 's';
}

function guideAliasPattern(alias) {
  return alias.trim().split(/[\s\p{Pd}]+/u).map(part =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]")
  ).join('[\\p{Zs}\\t\\p{Pd}]*');
}

let guideInlineIndex;

function guideBuildInlineIndex() {
  const aliases = new Map();
  for (const entry of guideEntries()) {
    for (const name of [entry.name, entry.english, ...(entry.aliases || [])]) {
      if (!name) continue;
      const variants = [name];
      if (entry.category === 'movement') variants.push(guideMovementPlural(name));
      for (const variant of variants) {
        if (!variant) continue;
        const key = guideAliasKey(variant);
        const pattern = guideAliasPattern(variant);
        const previous = aliases.get(key);
        // When both "풀업" and "풀 업" exist, accept either spelling.
        if (!previous || (previous.entry.id === entry.id && pattern.length > previous.pattern.length)) {
          aliases.set(key, { key, pattern, entry });
        }
      }
    }
  }
  const alternatives = [...aliases.values()].sort((a, b) => b.key.length - a.key.length).map(row => row.pattern);
  const boundary = '[^\\p{L}\\p{M}\\p{N}_]';
  // Keep Korean particles outside the button, e.g. "T2B를" and "풀업으로".
  const particles = '으로는|으로|에서는|에서|에는|부터|까지|마다|이면|라면|입니다|이에요|예요|은|는|이|가|을|를|와|과|에|로|의|도|만';
  const left = '(^[0-9]*|' + boundary + '[0-9]*)';
  const right = '(?=$|' + boundary + '|(?:' + particles + ')(?:$|' + boundary + ')|[0-9]+(?:회|개|번)(?:$|' + boundary + '))';
  return { aliases, pattern: alternatives.length ? new RegExp(left + '(' + alternatives.join('|') + ')' + right, 'giu') : null };
}

function guideInlineHTML(text) {
  const value = String(text ?? '');
  if (!value) return '';
  guideInlineIndex ??= guideBuildInlineIndex();
  const { aliases, pattern } = guideInlineIndex;
  if (!pattern) return escapeHTML(value);
  let html = '', offset = 0;
  for (const match of value.matchAll(pattern)) {
    const label = match[2];
    const entry = aliases.get(guideAliasKey(label)).entry;
    const start = match.index + match[1].length;
    html += escapeHTML(value.slice(offset, start));
    html += `<button type="button" class="wod-guide-term" data-guide-entry="${escapeHTML(entry.id)}" aria-haspopup="dialog" aria-label="${escapeHTML(label)} 가이드 보기">${escapeHTML(label)}</button>`;
    offset = start + label.length;
  }
  return html + escapeHTML(value.slice(offset));
}
