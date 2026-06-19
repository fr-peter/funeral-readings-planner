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
// ── Drop-cap engine (shared by desktop main.js + mobile mobile.js) ────────────
//
// Single source of truth for the drop-cap sizing constants, per-letter offset
// table, shape-outside geometry, and the two render entry points
// (applyDropCap / applyDropCapShapes). Both bundles import this verbatim — there
// is no view-specific parameterization, because both emit the identical
// `.r-drop-cap` / `.r-drop-2nd` / `.r-drop-follow` / `.r-body-dropcap` classes.
//
// The functions are deliberately state-free (they take a container or a line of
// HTML) and depend only on browser globals (document, getComputedStyle), so this
// module is DOM-generic and carries no app state.
//
// CLAUDE.md drop-cap parity: `tools/dropcap-calibrate.html` is a SEPARATE,
// standalone calibration tool that keeps its own editable copy of the offset
// table (its whole purpose is to re-generate DROPCAP_OFFSETS for pasting back
// here). It is NOT part of the build and does not import this module. Any change
// to drop-cap sizing/shape logic must be mirrored into that tool by hand; the
// offset table itself is produced BY the tool and pasted into DROPCAP_OFFSETS
// below. The offsets are font-metric / leading-ratio driven and em-relative, so
// the same calibrated values are correct at the mobile preview measure and at
// letter print size (no per-view re-calibration).

// Capital letters whose descenders require a smaller font-size to fit within
// the 2-line zone without clipping (J curves below baseline; Q has a tail).
const DESCENDER_CAPS = new Set(['J', 'Q']);

// Horizontal offset (in body em) applied to the drop-cap float via --r-drop-offset.
// Negative values pull the cap left into the margin (hanging punctuation / optical alignment).
const MARGIN_OFFSETS = new Map([
  ['“', -0.68],  // opening double quotation mark
  ['‘', -0.41],  // opening single quotation mark
  ['"',      -0.68],  // straight double quote (fallback)
  ["'",      -0.41],  // straight single quote (fallback)
]);

// Drop-cap font-sizes (drop-cap em) — MUST match the .r-drop-cap CSS font-size
// per letter, since dropCapLineH derives the shape-outside step from them.
// J and Q each get their own size: Q's tail is short, J's is deep, so J is sized
// down until its descender reaches the same depth as Q's (cap-top held).
const FS_NORMAL = 2.999;
const FS_DESC   = new Map([['J', 2.299], ['Q', 2.551]]);

function dropCapFS(ch)   { return FS_DESC.get(ch) ?? FS_NORMAL; }

// Polygon step (drop-cap em): the line-1 → line-2 width transition.
// `ratio` is the ACTUAL rendered leading (line-height ÷ font-size), measured
// from the DOM via bodyLeadingRatio() rather than a hardcoded 17/14, so the
// shape tracks whatever size/leading is in effect (screen, print, or a future
// large-text option) — provided screen and print share the same ratio.
//
// The step is biased ~10% INTO line 2's band, not placed exactly on the
// line-1/line-2 boundary. At the exact boundary, print rounding can let line
// 1's bottom edge touch the step and pick up the wider line-2 inset (w2),
// shifting line 1 too far right (preview survives on sub-pixel luck). Because
// shape-outside applies the MAX inset across each line box, any step within
// (1 line, 2 lines) yields line 1 = w1 and line 2 = w2; the bias is a
// rounding-proof margin.
const DC_STEP_BIAS = 1.10;
function dropCapLineH(ch, ratio){ return ratio * DC_STEP_BIAS / dropCapFS(ch); }

// Actual rendered leading ratio of the body text. Falls back to 17/14 if the
// computed values can't be resolved (e.g. line-height:normal).
function bodyLeadingRatio(el) {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  const lh = parseFloat(cs.lineHeight);
  return (fs > 0 && lh > 0) ? lh / fs : 17 / 14;
}

// Per-letter right-side gaps (drop-cap em). pr1 = line 1, pr2 = line 2.
// Visually calibrated. Extended characters fall back to computed defaults.
const DROPCAP_OFFSETS = new Map([
  ['A', { pr1: -0.120, pr2: 0.254 }],
  ['B', { pr1: -0.010, pr2: 0.194 }],
  ['C', { pr1:  0.025, pr2: 0.209 }],
  ['D', { pr1:  0.020, pr2: 0.204 }],
  ['E', { pr1:  0.015, pr2: 0.219 }],
  ['F', { pr1:  0.040, pr2: 0.190 }],
  ['G', { pr1:  0.015, pr2: 0.204 }],
  ['H', { pr1:  0.030, pr2: 0.214 }],
  ['I', { pr1:  0.005, pr2: 0.189 }],
  ['J', { pr1:  0.045, pr2: 0.281 }],
  ['K', { pr1:  0.000, pr2: 0.204 }],
  ['L', { pr1: -0.180, pr2: 0.254 }],
  ['M', { pr1:  0.030, pr2: 0.214 }],
  ['N', { pr1:  0.045, pr2: 0.229 }],
  ['O', { pr1:  0.030, pr2: 0.214 }],
  ['P', { pr1:  0.050, pr2: 0.179 }],
  ['Q', { pr1:  0.065, pr2: 0.456 }],
  ['R', { pr1: -0.105, pr2: 0.199 }],
  ['S', { pr1:  0.010, pr2: 0.204 }],
  ['T', { pr1:  0.050, pr2: 0.214 }],
  ['U', { pr1:  0.055, pr2: 0.239 }],
  ['V', { pr1:  0.060, pr2: 0.219 }],
  ['W', { pr1:  0.065, pr2: 0.219 }],
  ['X', { pr1:  0.010, pr2: 0.194 }],
  ['Y', { pr1:  0.055, pr2: 0.239 }],
  ['Z', { pr1:  0.015, pr2: 0.209 }],
]);

const DEFAULT_DC_PR1 = 0.070;
function defaultDCPr2(ch) { return DEFAULT_DC_PR1 + 0.5 / dropCapFS(ch); }
function dcOffsets(ch) {
  return DROPCAP_OFFSETS.get(ch) ?? { pr1: DEFAULT_DC_PR1, pr2: defaultDCPr2(ch) };
}

// ── Drop-cap shape-outside ────────────────────────────────────────────────────
let _dcMbox = null;
const _dcAdvCache = {};

function measureDCAdvW(ch) {
  if (ch in _dcAdvCache) return _dcAdvCache[ch];
  if (!_dcMbox) {
    _dcMbox = document.createElement('div');
    _dcMbox.style.cssText = 'position:absolute;top:-9999px;left:0;visibility:hidden;font-size:calc(14pt * 4/3)';
    document.body.appendChild(_dcMbox);
  }
  const fs = dropCapFS(ch);
  const s  = document.createElement('span');
  s.style.cssText = `display:inline-block;white-space:nowrap;line-height:1;` +
    `font-family:'Cormorant Garamond','EB Garamond',serif;font-size:${fs}em`;
  s.textContent = ch;
  _dcMbox.appendChild(s);
  const pxW  = s.getBoundingClientRect().width;
  const fsPx = parseFloat(getComputedStyle(s).fontSize);
  _dcMbox.removeChild(s);
  const adv = pxW / fsPx;
  // Only cache once the display font is actually loaded; otherwise a measurement
  // taken before font load would poison the cache with fallback-font metrics.
  if (document.fonts.check('1em "Cormorant Garamond"')) _dcAdvCache[ch] = adv;
  return adv;
}

// Drop the cached advance-width measurements. Desktop calls this once the
// display font has loaded (it's font-display:swap), so any width that was
// measured against the fallback font is discarded and re-measured against the
// real font on the next applyDropCapShapes pass.
export function clearDCAdvCache() {
  for (const k of Object.keys(_dcAdvCache)) delete _dcAdvCache[k];
}

export function applyDropCapShapes(container) {
  const leadingRatio = bodyLeadingRatio(container);
  container.querySelectorAll('.r-body-dropcap').forEach(bodyEl => {
    const span = bodyEl.querySelector('.r-drop-cap');
    if (!span) return;
    const plain = span.textContent;
    const firstIsLetter = /\p{L}/u.test(plain[0]);
    const ch = firstIsLetter ? plain[0] : (plain[1] ?? '');
    if (!ch) return;

    const { pr1, pr2 } = dcOffsets(ch);
    const advW = measureDCAdvW(ch);

    // Leading non-letter (open double/single quote, etc.): hang it FULLY in the
    // left margin so the drop-cap LETTER sits flush at the text margin, exactly
    // like a letter-initial cap. The hang is the leading glyph's true horizontal
    // contribution = advance(quote+letter) − advance(letter); measuring the pair
    // together (not the quote in isolation) captures the quote/letter kern pair,
    // which can shrink or grow the combined width. Works for any leading glyph.
    //
    // With the letter flush, lines 1/2 wrap around the letter with the very same
    // pr1/pr2 as the non-quote case — no per-line "lead" term is needed.
    let hang = 0;   // cap-em, ≥ 0
    if (!firstIsLetter) {
      const comboW = measureDCAdvW(plain.slice(0, 2));   // kerned quote+letter advance
      hang = comboW - advW;
      span.style.marginLeft = `${(-hang).toFixed(5)}em`;
    }

    const w1   = advW + pr1;
    const w2   = advW + pr2;
    const maxW = Math.max(w1, w2);
    const lh   = dropCapLineH(ch, leadingRatio);
    const f    = v => v.toFixed(5);
    // Widen the float box by the hang. The negative margin-left shrinks the
    // (shape reference) margin box; without this it would be narrower than the
    // polygon's reach, so the browser clips the shape to the box and BOTH lines
    // wrap at the rectangular box edge — losing the pr1/pr2 distinction. Adding
    // `hang` makes margin-box width = maxW, exactly containing the polygon.
    span.style.width        = `${f(maxW + hang)}em`;
    span.style.paddingRight = '0';
    span.style.overflow     = 'visible';
    span.style.shapeOutside =
      `polygon(0 0,${f(w1)}em 0,${f(w1)}em ${f(lh)}em,` +
      `${f(w2)}em ${f(lh)}em,${f(w2)}em 100%,0 100%)`;

    const spacer = bodyEl.querySelector('.r-drop-2nd');
    if (spacer) spacer.style.width = '0';
  });
}

// Injects drop-cap markup into the first line of the reading body.
//
// Drop cap extent:
//   - First char is a letter → 1-char drop cap
//   - First char is non-letter (e.g. opening quote) → 2-char drop cap
//
// The effective first letter determines:
//   - Whether to use the descender-aware CSS class (J, Q)
//   - The first-word length rule for small-caps coverage
//
// Small-caps follow span covers:
//   first word ≥ 3 chars → rest of first word only
//   first word ≤ 2 chars → rest of first word + entire second word
export function applyDropCap(lineHtml) {
  const plain = lineHtml.replace(/<[^>]+>/g, '');
  if (!plain) return lineHtml;

  const firstIsLetter = /\p{L}/u.test(plain[0]);
  const dropCharCount  = firstIsLetter ? 1 : 2;
  const effectiveLetter = firstIsLetter ? plain[0] : (plain[1] ?? '');

  // Walk lineHtml to find the end of the drop cap (dropCharCount plain-text chars).
  let dropEnd = 0, nPlain = 0;
  while (dropEnd < lineHtml.length && nPlain < dropCharCount) {
    if (lineHtml[dropEnd] === '<') {
      const close = lineHtml.indexOf('>', dropEnd);
      dropEnd = close === -1 ? lineHtml.length : close + 1;
    } else {
      nPlain++;
      dropEnd++;
    }
  }

  const dropHtml = lineHtml.slice(0, dropEnd);
  const rest      = lineHtml.slice(dropEnd);

  const dropClass = effectiveLetter === 'J'
    ? 'r-drop-cap r-drop-cap--desc r-drop-cap--descj'
    : DESCENDER_CAPS.has(effectiveLetter)
      ? 'r-drop-cap r-drop-cap--desc'
      : 'r-drop-cap';

  const offset = MARGIN_OFFSETS.get(plain[0]) ?? 0;
  const dropCapEm = offset / dropCapFS(effectiveLetter);
  const styleAttr = dropCapEm !== 0 ? ` style="--r-drop-offset:${dropCapEm.toFixed(4)}em"` : '';

  // First-word length: measured from the effective first letter.
  // plain.slice(dropCharCount - 1) starts at the effective letter's position.
  const plainFromLetter = plain.slice(dropCharCount - 1);
  const m = plainFromLetter.match(/^(\S+)/);
  const firstWordLen = m ? m[1].length : 0;

  if (!firstWordLen) return `<span class="${dropClass}"${styleAttr}>${dropHtml}</span>${rest}`;

  const followBoundaries = firstWordLen === 2 ? 2 : 1;
  let wordsCompleted = 0;
  let inWord  = firstWordLen > 1; // true when drop char is mid-word
  let wrapEnd = rest.length;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '<') {
      const close = rest.indexOf('>', i);
      i = close === -1 ? rest.length - 1 : close;
    } else if (/\s/.test(rest[i])) {
      if (inWord) {
        wordsCompleted++;
        if (wordsCompleted >= followBoundaries) { wrapEnd = i; break; }
        inWord = false;
      }
    } else {
      inWord = true;
    }
  }

  return `<span class="${dropClass}"${styleAttr}>${dropHtml}</span><span class="r-drop-follow">${rest.slice(0, wrapEnd)}</span>${rest.slice(wrapEnd)}`;
}
