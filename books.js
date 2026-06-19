/*
 * Funeral Readings Planner: A resource for planning & printing Catholic funeral readings in Canada
 * Copyright (C) 2026 Fr Peter Do
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
// Canonical abbreviation (as used in readings.json) → full display name.
// Only books that actually appear in the funeral lectionary data.
export const BOOK_NAMES = {
  '1 Cor':   '1 Corinthians',
  '1 Jn':    '1 John',
  '1 Pet':   '1 Peter',
  '1 Thess': '1 Thessalonians',
  '2 Cor':   '2 Corinthians',
  '2 Macc':  '2 Maccabees',
  '2 Tim':   '2 Timothy',
  'Acts':    'Acts',
  'Dan':     'Daniel',
  'Eccl':    'Ecclesiastes',
  'Eph':     'Ephesians',
  'Ezek':    'Ezekiel',
  'Isa':     'Isaiah',
  'Jn':      'John',
  'Job':     'Job',
  'Lam':     'Lamentations',
  'Lk':      'Luke',
  'Mk':      'Mark',
  'Mt':      'Matthew',
  'Phil':    'Philippians',
  'Ps':      'Psalm',
  'Rev':     'Revelation',
  'Rom':     'Romans',
  'Wis':     'Wisdom',
};

// Sorted longest-first so multi-word entries match before their substrings.
const SORTED_ABBREVS = Object.keys(BOOK_NAMES).sort((a, b) => b.length - a.length);

// Replaces the book abbreviation at the start of a ref string with its full name.
// e.g. "Rom 14 : 7–9" → "Romans 14 : 7–9"
export function expandRef(ref) {
  for (const abbrev of SORTED_ABBREVS) {
    if (ref.startsWith(abbrev + ' ') || ref === abbrev) {
      return BOOK_NAMES[abbrev] + ref.slice(abbrev.length);
    }
  }
  return ref;
}

// Single source of truth for how a scripture reference is spaced for display:
// a hair space (U+200A) on each side of every colon (e.g. "Ps 23:1" →
// "Ps 23 : 1"). Used at EVERY place a ref is shown — slot lists, search/browse
// results, and the preview/print document, on both desktop and mobile. Change
// the spacing here (widen, narrow, or remove it) and it updates everywhere.
// Book-abbreviation expansion is a separate concern — compose with expandRef()
// where the surface uses full names (the printed document keeps abbreviations).
export function formatRef(ref) {
  return ref.replace(/:/g, ' : ');
}

// The app-chrome font (Source Sans 3) has no ℟ (U+211F RESPONSE), so anything
// shown in the UI — psalm refs like "(℟. 4ab)", search excerpts — swaps it for
// this. The print/preview document is EB Garamond, which HAS ℟, so those
// call-sites use formatRef()/raw text directly and keep the glyph. Change the
// chrome representation in ONE place here.
export const UI_RESPONSUM = 'R.';
// Collapse the glyph plus its trailing period ("℟.") to a single UI_RESPONSUM,
// so we get "R." not "R..". A lone ℟ (no data has one, but defensively) also
// becomes "R.". Use on any chrome string; formatRefUI is the ref shorthand.
export function toUiResponsum(s) {
  return s.replace(/℟\.?/g, UI_RESPONSUM);
}
export function formatRefUI(ref) {
  return toUiResponsum(formatRef(ref));
}

// ── Query normalisation ───────────────────────────────────────────────────────

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Aliases: normalized form (lowercase, no periods) → canonical abbreviation.
// Covers full names, Vatican/CCC abbreviations, and common alternative systems.
const RAW_ALIASES = {
  // 1 Corinthians
  '1 corinthians': '1 Cor',
  '1corinthians':  '1 Cor',
  '1cor':          '1 Cor',

  // 1 John
  '1 john':      '1 Jn',
  '1john':       '1 Jn',
  '1jn':         '1 Jn',
  'first john':  '1 Jn',

  // 1 Peter
  '1 peter':     '1 Pet',
  '1peter':      '1 Pet',
  '1pet':        '1 Pet',
  'first peter': '1 Pet',

  // 1 Thessalonians
  '1 thessalonians': '1 Thess',
  '1thessalonians':  '1 Thess',
  '1 thes':          '1 Thess',  // Vatican/CCC
  '1thess':          '1 Thess',
  '1thes':           '1 Thess',

  // 2 Corinthians
  '2 corinthians': '2 Cor',
  '2corinthians':  '2 Cor',
  '2cor':          '2 Cor',

  // 2 Maccabees
  '2 maccabees':  '2 Macc',
  '2maccabees':   '2 Macc',
  '2 mc':         '2 Macc',  // Vatican/CCC
  '2mc':          '2 Macc',
  '2 mac':        '2 Macc',
  '2mac':         '2 Macc',
  '2macc':        '2 Macc',

  // 2 Timothy
  '2 timothy': '2 Tim',
  '2timothy':  '2 Tim',
  '2tim':      '2 Tim',

  // Acts
  'acts of the apostles': 'Acts',

  // Daniel
  'daniel': 'Dan',
  'dn':     'Dan',  // Vatican/CCC

  // Ecclesiastes
  'ecclesiastes': 'Eccl',
  'eccles':       'Eccl',
  'qo':           'Eccl',  // Vatican/CCC (Qohelet)
  'qohelet':      'Eccl',

  // Ephesians
  'ephesians': 'Eph',

  // Ezekiel
  'ezekiel': 'Ezek',
  'ez':      'Ezek',  // Vatican/CCC
  'eze':     'Ezek',

  // Isaiah — "is" requires chapter context (see CONTEXT_REQUIRED below)
  'isaiah': 'Isa',
  'is':     'Isa',  // Vatican/CCC

  // Job
  'jb': 'Job',  // Vatican/CCC

  // John (Gospel) — after numbered "1 john" etc. in sorted order
  'john': 'Jn',

  // Lamentations
  'lamentations': 'Lam',
  'lm':           'Lam',  // Vatican/CCC

  // Luke
  'luke': 'Lk',

  // Mark
  'mark': 'Mk',
  'marc': 'Mk',  // French/older Latin abbreviation

  // Matthew
  'matthew': 'Mt',
  'matt':    'Mt',

  // Philippians
  'philippians': 'Phil',
  'php':         'Phil',
  'phlp':        'Phil',

  // Psalms
  'psalms': 'Ps',
  'psalm':  'Ps',

  // Revelation
  'revelation': 'Rev',
  'apocalypse': 'Rev',
  'apoc':       'Rev',  // traditional Catholic
  'rv':         'Rev',  // CMOS shorter form

  // Romans
  'romans': 'Rom',

  // Wisdom
  'wisdom':            'Wis',
  'wisdom of solomon': 'Wis',
};

// Aliases that are also ordinary English words: only replace when immediately
// followed by a chapter number (e.g. "Is 25" but not "Is this the right one").
const CONTEXT_REQUIRED = new Set(['is']);

// Sort by descending word count so "acts of the apostles" matches before "acts",
// "1 corinthians" matches before "corinthians", etc.
const SORTED_ALIASES = Object.entries(RAW_ALIASES)
  .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

// Normalises book references in a search query to canonical abbreviations.
// Strips periods first so "Rom." and "1 Cor." work transparently.
// e.g. "Romans 14"   → "Rom 14"
//      "Is 25"       → "Isa 25"
//      "1 Thes 4"    → "1 Thess 4"
//      "eternal life" → "eternal life"  (unchanged)
export function normalizeBookRefs(query) {
  let result = query.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  for (const [alias, canonical] of SORTED_ALIASES) {
    const re = CONTEXT_REQUIRED.has(alias)
      ? new RegExp('\\b' + escapeRe(alias) + '(?=\\s+\\d)', 'gi')
      : new RegExp('\\b' + escapeRe(alias) + '\\b', 'gi');
    result = result.replace(re, canonical);
  }
  return result;
}
