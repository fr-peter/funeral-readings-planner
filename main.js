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
import allPrayers from './prayers.json';
import { search, preloadEmbedder } from './search.js';
import { isDuringEasterTime, easterSeasonLabel } from './easter.js';
import { expandRef, formatRef, formatRefUI, toUiResponsum, normalizeBookRefs } from './books.js';
import { encode, decode } from './share.js';
import {
  SLOTS, SLOT_LABEL, SLOT_TYPE, CTX_SLOTS, PRAYER_FOR_CTX,
  state, currentSel, poolFor, orderedSlotKeys, groupBodyLines,
  READING_BY_ID, selectionsToIds, selectionsToObjects,
  docFromState, applyDocToState,
  configure, scheduleCommit, commitNow, restoreOnBoot,
  getCurrentFuneralId, setCurrentFuneralId, setLoading,
  loadLibrary, saveLibrary, libFind, blankDoc, isDirty, isBlank,
  loadDoc, newFuneral, openFuneral, saveFuneral,
  shareUrl, shareName, emailShare,
} from './funeral-core.js';
import { applyDropCap, applyDropCapShapes, clearDCAdvCache } from './dropcap.js';
import { exportAll, importAll, fitExcerpts, fmtDate } from './library-io.js';
import { currentTheme, applyTheme, initTheme } from './theme.js';

// ── Constants ────────────────────────────────────────────────────────────────

// Inline glyphs for the empty-pane onboarding text: the SAME icons as the controls
// they name (gear = Print settings toolbar button; printer = Print / Save as PDF),
// so the prose points the eye at a button it can recognise. Wrapped in .ui-ref
// (white-space: nowrap) so the glyph never line-breaks away from its label.
const UI_REF_GEAR  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const UI_REF_PRINT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6V2.5h7V6M4.5 11.5h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1M4.5 9.5h7v4h-7z"/></svg>`;

// ── Document rendering ───────────────────────────────────────────────────────

// Prevent line breaks before em-dashes: browsers treat — as a valid break
// opportunity on both sides; U+2060 Word Joiner before the dash suppresses
// the break between the preceding word and the dash without affecting the
// break opportunity after the dash.
const fixEmDash = s => s.replace(/—/g, '⁠—');

function toLines(html) {
  return html.split('\n').filter(l => l.trim())
    .map(l => `<div class="r-line">${fixEmDash(l)}</div>`).join('');
}

function responseLines(html, glyph, firstIndent) {
  return html.split('\n').filter(l => l.trim()).map((l, i) => {
    const content = i === 0 ? `${glyph} ${fixEmDash(l)}` : fixEmDash(l);
    const cls = i === 0 && firstIndent ? 'r-line-indent' : 'r-line';
    return `<div class="${cls}">${content}</div>`;
  }).join('');
}

// Drop-cap engine (applyDropCap / applyDropCapShapes + sizing constants and the
// per-letter offset table) now lives in the shared ./dropcap.js module, imported
// above and used by both this desktop bundle and mobile.js.

function typeLabelOf(type) {
  if (type === 'psalm') return 'Responsorial Psalm';
  return type.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// The id (e.g. `1014(6A)`) is set in all-small-caps up to and including the
// closing paren; any trailing qualifier (` Shorter`, ` Longer`) is set in
// normal upper-and-lowercase via .r-id-tail.
function formatIdHtml(id) {
  const i = id.lastIndexOf(')');
  if (i === -1 || i === id.length - 1) return id;
  return id.slice(0, i + 1) + `<span class="r-id-tail">${id.slice(i + 1)}</span>`;
}

function renderReadingHtml(r, subheadLabel = null, slotKey = null) {
  const p = [];

  if (state.includeSubhead) {
    const label = subheadLabel ?? typeLabelOf(r.type);
    p.push(`<div class="r-sub">${label}</div>`);
  }

  if (state.includeRef || state.includeId) {
    const idPart  = state.includeId  ? `<span class="r-id">${formatIdHtml(r.id)}</span>` : '';
    const refPart = state.includeRef ? `<span class="r-ref">${formatRef(r.ref)}</span>` : '';
    p.push(`<div class="r-ref-line">${idPart}${refPart}</div>`);
    p.push(`<span class="r-gap"></span>`);
  }

  const readerName = state.includeReader && slotKey && slotKey !== 'gospel' && state.readers[slotKey];
  if (readerName) {
    p.push(`<div class="r-reader">${escapeHtml(state.readers[slotKey])}:</div>`);
  }

  if (r.type === 'psalm') {
    p.push(renderPsalmBody(r));
    return p.join('');
  }

  if (r.intro) {
    if (r.type === 'gospel') {
      p.push(`<div class="r-intro"><div class="r-line"><span class="r-cross">✠</span>${r.intro}</div></div>`);
    } else {
      p.push(`<div class="r-intro">${toLines(r.intro)}</div>`);
    }
    p.push(`<span class="r-gap"></span>`);
  }

  const termLine = r.type === 'gospel' ? 'The Gospel of the Lord.' : 'The word of the Lord.';
  const terminal = `<span class="r-gap r-gap--term"></span><div class="r-terminal"><div class="r-line">${termLine}</div></div>`;
  const lines  = r.text.split('\n').filter(l => l.trim());

  // Clause-grouped body: page breaks fall only between groups; the last group
  // keeps the final line + conclusion together and avoids a break before it so the
  // final line is never orphaned. Shared by the normal path and the drop-cap tail.
  const renderGroups = (lns) => groupBodyLines(lns).map((grp, gi, arr) => {
    const last = gi === arr.length - 1;
    const lineHtml = grp.map(l => `<div class="r-line">${fixEmDash(l)}</div>`).join('');
    return `<div class="r-group${last ? ' r-group--last' : ''}">${lineHtml}${last ? terminal : ''}</div>`;
  }).join('');

  if (state.dropCaps) {
    // Head = the cap + the two lines that wrap beside it (lines 0–1, inline so they
    // flow around the float) + the first line that clears the cap (line 2, a block
    // .r-line). Three lines exceed the cap's height, so the float is fully contained
    // in this block — the tail below is ordinary full-width text that gets the same
    // clause-grouping / orphan / conclusion protection as the normal path. The
    // open-quote/hanging-cap handling stays at the cap-float + doc-padding level, so
    // the tail shares the head's left edge automatically. No margin sits at the
    // head/tail seam, so inter-line spacing stays uniform across the boundary.
    const head = lines.slice(0, 2).map((l, i) =>
      i === 0 ? applyDropCap(fixEmDash(l)) : `<span class="r-drop-2nd"></span>${fixEmDash(l)}`
    ).join('<br>');
    const headLine3 = lines.length > 2 ? `<div class="r-line">${fixEmDash(lines[2])}</div>` : '';
    const tailLines = lines.slice(3);
    if (tailLines.length) {
      p.push(`<div class="r-body r-body-dropcap">${head}${headLine3}</div>`);
      p.push(`<div class="r-body">${renderGroups(tailLines)}</div>`);
    } else {
      // ≤3 lines: nothing clears into a tail, so the conclusion stays in the head.
      p.push(`<div class="r-body r-body-dropcap">${head}${headLine3}${terminal}</div>`);
    }
  } else {
    p.push(`<div class="r-body">${renderGroups(lines)}</div>`);
  }

  return p.join('');
}

function renderPsalmBody(r) {
  const glyph   = `<span class="r-glyph">℟.</span>`;
  const stanzas = r.text.split('{{response}}').map(s => s.trim()).filter(Boolean);
  const p = [];

  p.push(`<div class="psalm-response">${toLines(r.response)}</div>`);
  p.push(`<div class="psalm-response-first">${responseLines(r.response, glyph, true)}</div>`);
  p.push(`<span class="r-gap"></span>`);

  stanzas.forEach((stanza, si) => {
    p.push(`<div class="psalm-unit">`);
    if (si === 0 && state.dropCaps) {
      const lines = stanza.split('\n').filter(l => l.trim());
      const bodyContent = lines.map((l, i) => {
        const fixed = fixEmDash(l);
        if (i === 0) return applyDropCap(fixed);
        if (i === 1) return `<span class="r-drop-2nd"></span>${fixed}`;
        return fixed;
      }).join('<br>');
      p.push(`<div class="psalm-stanza r-body-dropcap">${bodyContent}</div>`);
    } else {
      p.push(`<div class="psalm-stanza">${toLines(stanza)}</div>`);
    }
    p.push(`<span class="r-gap"></span>`);
    p.push(`<div class="psalm-response-line">${responseLines(r.response, glyph, false)}</div>`);
    p.push(`</div>`);
    p.push(`<span class="r-gap"></span>`);
  });

  return p.join('');
}

// ── Prayers rendering ────────────────────────────────────────────────────────

function resolvePrayerText(text, html = false) {
  const rawName = state.name.trim();
  // In html mode the result is inserted via innerHTML, so all user-controlled
  // text — the deceased's name AND the (editable) petition/response/intro/closing
  // text — MUST be HTML-escaped. Our own markup (alt spans, name placeholder) is
  // added AFTER escaping. This matters especially once readings can be loaded from
  // an untrusted shared link/code. The {{...}} placeholders survive escapeHtml
  // (braces aren't escaped) and are replaced below with escaped/trusted content.
  const name = rawName
    ? (html ? escapeHtml(rawName) : rawName)
    : (html ? '<span class="prayer-name-ph">N.</span>' : 'N.');
  // m = masculine, f = feminine, u = unspecified (dual form "he (she)")
  const alt = (m, f) => {
    if (state.sex === 'm') return m;
    if (state.sex === 'f') return f;
    return html
      ? `${m} <span class="prayer-alt">(</span>${f}<span class="prayer-alt">)</span>`
      : `${m} (${f})`;
  };
  return (html ? escapeHtml(text) : text)
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{he\}\}/g, alt('he', 'she'))
    .replace(/\{\{him\}\}/g, alt('him', 'her'))
    .replace(/\{\{his\}\}/g, alt('his', 'her'))
    .replace(/\{\{brother_sister\}\}/g, alt('brother', 'sister'));
}

function renderPrayerText(text) {
  if (state.dropCaps) {
    const lines = text.split('\n').filter(l => l.trim());
    const content = lines.map((l, i) => {
      const fixed = fixEmDash(l);
      if (i === 0) return applyDropCap(fixed);
      if (i === 1) return `<span class="r-drop-2nd"></span>${fixed}`;
      return fixed;
    }).join('<br>');
    return `<div class="r-body r-body-dropcap">${content}</div>`;
  }
  return toLines(text);
}

// Quote-safe: also escapes " (and ') so the same helper is safe inside
// double-quoted value="..."/data-...="..." attributes fed untrusted, attacker-
// controlled data from a shared link/imported backup — not just text content.
// Mirrors mobile's `esc`. Harmless in text/textarea contexts (&quot; renders as ").
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function prayerElementText(type, index, html = false) {
  if (!state.prayers) return '';
  if (type === 'intro')    return resolvePrayerText(state.prayers.intro,              html);
  if (type === 'closing')  return resolvePrayerText(state.prayers.closing,            html);
  if (type === 'petition') return resolvePrayerText(state.prayers.petitions[index],   html);
  if (type === 'response') return resolvePrayerText(state.prayers.response,           html);
  return '';
}

// Maps a rendered-text character position (ignoring \n) back to the fullText position.
function renderedToFullPos(renderedPos, fullText) {
  const lines = fullText.split('\n');
  let cum = 0;
  for (let i = 0; i < lines.length; i++) {
    if (renderedPos <= cum + lines[i].length) {
      let pos = renderedPos - cum;
      for (let j = 0; j < i; j++) pos += lines[j].length + 1;
      return pos;
    }
    cum += lines[i].length;
  }
  return fullText.length;
}

function getCursorPosFromClick(el, x, y, fullText) {
  let targetNode = null, nodeOffset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { targetNode = r.startContainer; nodeOffset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { targetNode = p.offsetNode; nodeOffset = p.offset; }
  }
  if (!targetNode) return 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let renderedPos = 0;
  let tn;
  while ((tn = walker.nextNode())) {
    if (tn === targetNode) { renderedPos += nodeOffset; break; }
    renderedPos += tn.length;
  }
  return renderedToFullPos(renderedPos, fullText);
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function prayerTab(type, index, total) {
  const pending = state.pendingRemove?.type === 'petition' && state.pendingRemove?.index === index;
  const pidx = index != null ? ` data-pidx="${index}"` : '';
  if (type === 'petition' && pending) {
    return `<div class="prayer-element-tab prayer-element-tab--confirm" data-ptype="${type}"${pidx}>
      <span class="pe-confirm-label">Remove?</span>
      <button class="pe-confirm-yes" data-pidx="${index}">Yes</button>
      <button class="pe-confirm-no"  data-pidx="${index}">No</button>
    </div>`;
  }
  const parts = [];
  if (type === 'petition') {
    if (index > 0)          parts.push(`<button class="pe-btn pe-up"     data-pidx="${index}" title="Move up"></button>`);
    if (index < total - 1)  parts.push(`<button class="pe-btn pe-down"   data-pidx="${index}" title="Move down"></button>`);
  }
  parts.push(`<span class="pe-edit-label">Edit</span>`);
  if (type === 'petition')  parts.push(`<button class="pe-btn pe-remove" data-pidx="${index}" title="Remove">✕</button>`);
  return `<div class="prayer-element-tab" data-ptype="${type}"${pidx}>${parts.join('')}</div>`;
}

function prayerEditActions(text = 'x') {
  const disabled = text.trim() === '' ? ' disabled' : '';
  return `<div class="prayer-edit-actions">
    <button class="pe-cancel">Cancel</button>
    <button class="pe-accept"${disabled}>Accept</button>
  </div>`;
}

function renderPrayerHtml() {
  const pr  = state.prayers;
  const ed  = state.prayerEditing;
  const glyph    = `<span class="r-glyph">℟.</span>`;
  const response = fixEmDash(resolvePrayerText(pr.response, true));
  const total    = pr.petitions.length;
  const parts    = [];

  if (state.includeSubhead) {
    parts.push(`<div class="r-sub">Prayers of the Faithful</div>`);
  }
  parts.push(`<span class="r-gap"></span>`);

  // ── Priest intro ──────────────────────────────────────────────────────────
  const editingIntro = ed?.type === 'intro';
  const introText    = prayerElementText('intro', null);
  const introHtml    = prayerElementText('intro', null, true);
  parts.push(`<div class="prayer-element${editingIntro ? ' prayer-element--editing' : ''}" data-ptype="intro">`);
  parts.push(`<div class="prayer-rubric">Priest:</div>`);
  if (editingIntro) {
    parts.push(`<textarea id="prayer-edit-ta" class="prayer-textarea" autocomplete="off">${escapeHtml(introText)}</textarea>`);
    parts.push(prayerEditActions(introText));
  } else {
    parts.push(renderPrayerText(introHtml));
    parts.push(prayerTab('intro', null, total));
  }
  parts.push(`</div>`);

  parts.push(`<span class="r-gap"></span>`);
  const prayerReader = state.readers.prayers ? `${state.readers.prayers}:` : 'Reader:';
  parts.push(`<div class="prayer-rubric">${escapeHtml(prayerReader)}</div>`);

  // ── Petitions ─────────────────────────────────────────────────────────────
  parts.push(`<div class="prayer-petitions">`);
  parts.push(`<button class="prayer-insert" data-after="-1"><span class="prayer-insert-chip">+ Add petition</span></button>`);
  for (let i = 0; i < total; i++) {
    const editingPet  = ed?.type === 'petition' && ed.index === i;
    const editingResp = ed?.type === 'response'  && ed.index === i;
    const petText     = prayerElementText('petition', i);
    const petHtml     = prayerElementText('petition', i, true);
    const respText    = prayerElementText('response', i);

    parts.push(`<div class="prayer-petition-wrap">`);

    parts.push(`<div class="prayer-element${editingPet ? ' prayer-element--editing' : ''}" data-ptype="petition" data-pidx="${i}">`);
    if (editingPet) {
      parts.push(`<textarea id="prayer-edit-ta" class="prayer-textarea" autocomplete="off">${escapeHtml(petText)}</textarea>`);
    } else {
      parts.push(toLines(petHtml));
      parts.push(prayerTab('petition', i, total));
    }
    parts.push(`</div>`);

    if (editingPet) {
      parts.push(`<div class="prayer-response-actions">`);
      parts.push(`<div class="prayer-element prayer-element--response" data-ptype="response" data-pidx="${i}"><div class="prayer-response-line">${glyph} ${response}</div></div>`);
      parts.push(prayerEditActions(petText));
      parts.push(`</div>`);
    } else {
      parts.push(`<div class="prayer-element prayer-element--response${editingResp ? ' prayer-element--editing' : ''}" data-ptype="response" data-pidx="${i}">`);
      if (editingResp) {
        parts.push(`<textarea id="prayer-edit-ta" class="prayer-textarea" autocomplete="off">${escapeHtml(respText)}</textarea>`);
        parts.push(prayerEditActions(respText));
      } else {
        parts.push(`<div class="prayer-response-line">${glyph} ${response}</div>`);
        parts.push(prayerTab('response', i, total));
      }
      parts.push(`</div>`);
    }

    parts.push(`</div>`); // prayer-petition-wrap
    parts.push(`<button class="prayer-insert" data-after="${i}"><span class="prayer-insert-chip">+ Add petition</span></button>`);
  }
  parts.push(`</div>`); // prayer-petitions

  parts.push(`<span class="r-gap"></span>`);

  // ── Priest closing ────────────────────────────────────────────────────────
  const editingClosing = ed?.type === 'closing';
  const closingText    = prayerElementText('closing', null);
  const closingHtml    = prayerElementText('closing', null, true);
  parts.push(`<div class="prayer-element${editingClosing ? ' prayer-element--editing' : ''}" data-ptype="closing">`);
  parts.push(`<div class="prayer-rubric">Priest:</div>`);
  if (editingClosing) {
    parts.push(`<textarea id="prayer-edit-ta" class="prayer-textarea" autocomplete="off">${escapeHtml(closingText)}</textarea>`);
    parts.push(prayerEditActions(closingText));
  } else {
    parts.push(renderPrayerText(closingHtml));
    parts.push(prayerTab('closing', null, total));
  }
  parts.push(`</div>`);
  parts.push(`<div class="prayer-response-line">${glyph} Amen.</div>`);

  return parts.join('');
}

// ── Prayer editing interactions ───────────────────────────────────────────────

function enterPrayerEdit(type, index, cursorPos) {
  state.prayerEditing = { type, index };
  renderPreview();
  const ta = document.getElementById('prayer-edit-ta');
  if (ta) {
    autoResizeTextarea(ta);
    ta.focus();
    ta.setSelectionRange(cursorPos, cursorPos);
  }
  // For petition edits, scroll so the paired response line is visible
  if (type === 'petition') {
    const resp = document.querySelector(`.prayer-element--response[data-pidx="${index}"]`);
    if (resp) resp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function acceptPrayerEdit(text) {
  const { type, index } = state.prayerEditing;
  if      (type === 'intro')    state.prayers.intro = text;
  else if (type === 'closing')  state.prayers.closing = text;
  else if (type === 'petition') { state.prayers.petitions[index] = text; state.editedPetitions.add(index); }
  else if (type === 'response') state.prayers.response = text;
  state.prayersEdited = true;
  state.prayerEditing = null;
  renderPreview();
}

function cancelPrayerEdit() {
  const { type, index } = state.prayerEditing;
  if (type === 'petition' && state.prayers.petitions[index] === '') {
    state.prayers.petitions.splice(index, 1);
  }
  state.prayerEditing = null;
  renderPreview();
}

function movePetition(index, dir) {
  const pets = state.prayers.petitions;
  const j = index + dir;
  if (j < 0 || j >= pets.length) return;
  [pets[index], pets[j]] = [pets[j], pets[index]];
  state.prayersEdited = true;
  renderPreview();
}

function removePetition(index) {
  state.prayers.petitions.splice(index, 1);
  state.prayersEdited = true;
  renderPreview();
}

function addPetition() {
  state.prayers.petitions.push('');
  enterPrayerEdit('petition', state.prayers.petitions.length - 1, 0);
}

function addPetitionAt(after) {
  const insertIdx = after + 1; // after=-1 → index 0 (prepend)
  state.prayers.petitions.splice(insertIdx, 0, '');
  enterPrayerEdit('petition', insertIdx, 0);
}

function attachPrayerListeners(doc) {
  if (!state.prayers) return;

  // Textarea interactions (when editing)
  const ta = doc.querySelector('#prayer-edit-ta');
  if (ta) {
    const acceptBtn = doc.querySelector('.pe-accept');
    const original = ta.value;
    ta.addEventListener('input', () => {
      autoResizeTextarea(ta);
      if (acceptBtn) acceptBtn.disabled = ta.value.trim() === '';
    });
    ta.addEventListener('keydown', e => { if (e.key === 'Escape') cancelPrayerEdit(); });
    // Clicking outside the editing box with no changes made exits the edit, same
    // as Cancel. Deferred so a click on Accept/Cancel resolves first; with unsaved
    // changes the blur is ignored so nothing is lost.
    ta.addEventListener('blur', () => {
      setTimeout(() => {
        if (!state.prayerEditing) return;                       // already resolved
        if (document.getElementById('prayer-edit-ta') !== ta) return;  // re-rendered
        if (ta.value === original) cancelPrayerEdit();
      }, 0);
    });
    acceptBtn?.addEventListener('click', () => {
      if (ta.value.trim() === '') return;
      acceptPrayerEdit(ta.value);
    });
    doc.querySelector('.pe-cancel')?.addEventListener('click', cancelPrayerEdit);
    return; // don't attach interaction listeners while editing
  }

  // Element body click → edit at click position
  doc.querySelectorAll('.prayer-element').forEach(el => {
    el.addEventListener('click', e => {
      if (state.prayerEditing) return;
      if (e.target.closest('.prayer-element-tab')) return;
      const type  = el.dataset.ptype;
      const index = el.dataset.pidx !== undefined ? +el.dataset.pidx : null;
      const text  = prayerElementText(type, index);
      const pos   = getCursorPosFromClick(el, e.clientX, e.clientY, text);
      enterPrayerEdit(type, index, pos);
    });
  });

  // Edit label click → edit at position 0
  doc.querySelectorAll('.prayer-element-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      e.stopPropagation();
      if (state.prayerEditing) return;
      const type  = tab.dataset.ptype;
      const index = tab.dataset.pidx !== undefined ? +tab.dataset.pidx : null;
      enterPrayerEdit(type, index, 0);
    });
  });

  // Up / down
  doc.querySelectorAll('.pe-up').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); movePetition(+btn.dataset.pidx, -1); })
  );
  doc.querySelectorAll('.pe-down').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); movePetition(+btn.dataset.pidx,  1); })
  );

  // Remove — confirm if petition was edited
  doc.querySelectorAll('.pe-remove').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.pidx;
      if (state.editedPetitions.has(idx)) {
        state.pendingRemove = { type: 'petition', index: idx };
        renderPreview();
      } else {
        removePetition(idx);
      }
    })
  );
  doc.querySelectorAll('.pe-confirm-yes').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.pidx;
      state.pendingRemove = null;
      removePetition(idx);
    })
  );
  doc.querySelectorAll('.pe-confirm-no').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.pendingRemove = null;
      renderPreview();
    })
  );

  // Insert petition at position
  doc.querySelectorAll('.prayer-insert').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addPetitionAt(+btn.dataset.after);
    })
  );
}

// ── Preview panel ────────────────────────────────────────────────────────────

function renderTitleHtml() {
  const name = escapeHtml(state.titleName);
  const date = escapeHtml(state.titleDate);
  return `<div class="title-page">
    <div class="title-funeral">Funeral</div>
    ${name ? `<div class="title-name">${name}</div>` : ''}
    ${date ? `<div class="title-date">${date}</div>` : ''}
  </div>`;
}

function renderPreview() {
  scheduleCommit();
  const doc = document.getElementById('preview-doc');
  const classes = [state.colorMode === 'color' ? 'doc-color' : 'doc-bw'];
  if (state.dropCaps) classes.push('drop-caps');
  doc.className = classes.join(' ');

  const sel     = currentSel();
  const printBtn = document.getElementById('print-btn');
  printBtn.disabled = !Object.values(sel).some(Boolean) && !state.prayers && !state.titlePage;
  const visible = CTX_SLOTS[state.context];

  // Build slot contents: reading object | 'ghost' | null
  const slotContent = {};
  for (const slot of visible) {
    if (state.activeSlot === slot) {
      slotContent[slot] = state.previewing || 'ghost';
    } else {
      slotContent[slot] = sel[slot] || null;
    }
  }

  const anyContent = visible.some(slot => slotContent[slot]) || !!state.prayers || state.titlePage;
  if (!anyContent) {
    const { easter, pentecost } = easterSeasonLabel();
    doc.innerHTML = `<div class="doc-empty">
      <p>This tool helps you choose and print the readings for a Catholic funeral. The Liturgy of the Word draws from Scripture passages the Church has approved specifically for funerals: one or two readings, a responsorial psalm, and a Gospel. Use the buttons on the left to add whichever elements you need, in any combination, along with a Title Page and the Prayers of the Faithful if you wish. You may also change various settings, such as showing reader names, in the <span class="ui-ref">${UI_REF_GEAR}Print settings</span> menu.</p>
      <p>Before settling on a psalm or Gospel, it is worth checking with the priest. The psalm is sometimes sung by the choir, who may have their own repertoire, and the priest may wish to choose the Gospel himself.</p>
      <p>Two things have already been set and can be changed on the left. The <strong>Readings</strong> setting determines which set is offered—general use, or the special readings for a baptized child or a child who died before Baptism. The <strong>Liturgical season</strong> has been set based on today’s date. If the funeral falls between ${easter} and ${pentecost}, choose <strong>During Easter Time</strong>; otherwise <strong>Outside Easter Time</strong> is correct.</p>
      <p>As you add elements, a print-ready preview builds here. When you’re ready, use <span class="ui-ref">${UI_REF_PRINT}Print / Save as PDF</span>. You may also save the funeral to reopen later or share it by link, using the appropriate buttons in the top left toolbar.</p>
    </div>`;
    return;
  }

  doc.classList.toggle('slot-open',      !!state.activeSlot);
  doc.classList.toggle('editable',       !state.activeSlot && !state.prayerEditing);
  doc.classList.toggle('prayer-editing', !!state.prayerEditing);
  document.body.classList.toggle('prayer-editing-active', !!state.prayerEditing);

  // Build ordered pairs [slotKey, item] so each block knows its slot. The order
  // rule lives in core's orderedSlotKeys; here "present" includes a 'ghost'
  // placeholder (the slot being actively selected), since it's truthy.
  const orderedPairs = orderedSlotKeys(s => !!slotContent[s]).map(s => [s, slotContent[s]]);

  const readingCount = orderedPairs.filter(([slot]) =>
    slot === 'firstReading' || slot === 'secondReading'
  ).length;

  const prayerBlock = state.prayers
    ? `<div class="reading-block" id="prayer-block">${renderPrayerHtml()}</div>`
    : '';

  const titleTabs = `<div class="title-hover-bridge"></div><div class="reading-block-tabs" id="title-block-tabs">
      <span class="reading-block-tab-label">&#8203;</span>
      <button class="reading-block-tab-remove" id="title-block-remove">✕</button>
    </div>`;
  const titleBlock = state.titlePage
    ? `<div class="reading-block title-page-block" id="title-block">${titleTabs}${renderTitleHtml()}</div>${state.titleBlankVerso ? '<div class="title-blank-verso"></div>' : ''}`
    : '';

  doc.innerHTML = titleBlock + orderedPairs.map(([slot, item]) => {
    if (item === 'ghost') {
      return `<div class="reading-block reading-ghost reading-active">Select a ${SLOT_LABEL[slot]}…</div>`;
    }
    const isActive = state.activeSlot === slot && state.previewing?.id === item.id;
    const isReading = slot === 'firstReading' || slot === 'secondReading';
    const subheadLabel = isReading && readingCount === 1 ? 'Reading' : null;
    const tabs = `<div class="reading-block-tabs" data-slot="${slot}">
      <span class="reading-block-tab-label">Change</span>
      <button class="reading-block-tab-remove" data-slot="${slot}">✕</button>
    </div>`;
    return `<div class="reading-block${isActive ? ' reading-active' : ''}" data-slot="${slot}">${tabs}${renderReadingHtml(item, subheadLabel, slot)}</div>`;
  }).join('') + prayerBlock;

  if (state.dropCaps) applyDropCapShapes(doc);

  doc.querySelectorAll('.reading-block-tabs').forEach(tab =>
    tab.addEventListener('click', e => { e.stopPropagation(); openSlot(tab.dataset.slot); })
  );
  doc.querySelectorAll('.reading-block-tab-remove[data-slot]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeSlot(btn.dataset.slot); })
  );
  const titleRemoveBtn = doc.querySelector('#title-block-remove');
  if (titleRemoveBtn) {
    titleRemoveBtn.addEventListener('click', e => {
      e.stopPropagation();
      state.titlePage = false;
      renderSlots();
      renderPreview();
    });
  }
  attachPrayerListeners(doc);
}

// ── Scroll animation ─────────────────────────────────────────────────────────

let scrollTopBeforeSlot = 0;
let cancelCurrentScroll = null;
let _prayerConfirmDismiss = null;

function readerFieldHtml(key) {
  const val = state.readers[key] || '';
  return `<div class="slot-card-bottom">
    <span class="slot-reader-label">Reader’s name</span>
    <input type="text" class="slot-reader-input" data-reader="${key}" placeholder="Optional" value="${escapeHtml(val)}" autocomplete="off">
    <button class="slot-x slot-reader-clear${val ? ' visible' : ''}" data-reader="${key}" aria-label="Clear" tabindex="-1">×</button>
  </div>`;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateTo(container, target, duration, callback) {
  if (cancelCurrentScroll) cancelCurrentScroll();

  const start    = container.scrollTop;
  const distance = target - start;
  let cancelled  = false;

  cancelCurrentScroll = () => { cancelled = true; };

  if (Math.abs(distance) < 2) {
    cancelCurrentScroll = null;
    if (callback) callback();
    return;
  }

  const startTime = performance.now();

  function step(now) {
    if (cancelled) return;
    const progress = Math.min((now - startTime) / duration, 1);
    container.scrollTop = start + distance * easeInOutCubic(progress);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      cancelCurrentScroll = null;
      if (callback) callback();
    }
  }

  requestAnimationFrame(step);
}

function scrollToBlock(id) {
  const container = document.getElementById('preview-scroll');
  const el        = document.getElementById(id);
  if (!el || !container) return;
  const paddingTop    = parseFloat(getComputedStyle(container).paddingTop);
  const containerRect = container.getBoundingClientRect();
  const elRect        = el.getBoundingClientRect();
  const targetTop     = container.scrollTop + elRect.top - containerRect.top - paddingTop;
  const naturalMax    = Math.max(0, container.scrollHeight - container.clientHeight);
  animateTo(container, Math.min(targetTop, naturalMax), 450);
}

function scrollToPrayerBlock() { scrollToBlock('prayer-block'); }

function scrollToActive() {
  if (!state.activeSlot) return;
  const container = document.getElementById('preview-scroll');
  const el = document.querySelector('.reading-active');
  if (!el || !container) return;

  const paddingTop    = parseFloat(getComputedStyle(container).paddingTop);
  const containerRect = container.getBoundingClientRect();
  const elRect        = el.getBoundingClientRect();
  const target        = container.scrollTop + elRect.top - containerRect.top - paddingTop;

  animateTo(container, target, 450);
}

// Wraps renderPreview() with scroll-anchor preservation so inserting/removing
// content above the viewport doesn't cause a visual jump.
function renderPreviewAnchored() {
  const container = document.getElementById('preview-scroll');
  if (!container) { renderPreview(); return; }

  const containerRect = container.getBoundingClientRect();

  // Use the first non-ghost reading block that is at least partially visible.
  let anchor = null;
  for (const block of container.querySelectorAll('.reading-block[data-slot]')) {
    if (block.getBoundingClientRect().bottom > containerRect.top) {
      anchor = block;
      break;
    }
  }

  const anchorSlot   = anchor?.dataset.slot ?? null;
  const anchorBefore = anchor ? anchor.getBoundingClientRect().top : null;

  renderPreview();

  if (anchorSlot && anchorBefore !== null) {
    const newAnchor = container.querySelector(`.reading-block[data-slot="${anchorSlot}"]`);
    if (newAnchor) {
      container.scrollTop += newAnchor.getBoundingClientRect().top - anchorBefore;
    }
  }
}

// ── Slot area ────────────────────────────────────────────────────────────────

function renderSlots() {
  scheduleCommit();
  const area = document.getElementById('slot-area');

  if (state.activeSlot) {
    area.classList.add('search-active');
    renderSearchView(area);
    return;
  }
  area.classList.remove('search-active');

  const sel     = currentSel();
  const visible = CTX_SLOTS[state.context];

  const pendingPrayers = state.pendingRemove?.type === 'prayers';
  const showPrayerReader = state.includeReader && state.prayers;
  const prayerRow = state.prayers
    ? `<div class="slot-row">
         <div class="slot-card">
           <div class="slot-card-top" id="prayers-card-top">
             <div class="slot-card-top-content">
               <span class="slot-filled-label">Prayers of the Faithful</span>
             </div>
             ${pendingPrayers
               ? `<span class="slot-confirm-inline">
                    Remove? Edits will be lost.
                    <button class="slot-confirm-yes" id="prayers-remove-confirm">Yes</button>
                    <button class="slot-confirm-no"  id="prayers-remove-cancel">No</button>
                  </span>`
               : `<button class="slot-x" id="prayers-remove" aria-label="Remove">×</button>`
             }
           </div>
           <div class="slot-card-bottom">
             <span class="slot-reader-label">Name</span>
             <input type="text" class="slot-reader-input" id="prayers-name-input"
               placeholder="as used in the petitions" value="${escapeHtml(state.name)}"
               autocomplete="off">
             <div class="seg" id="prayers-seg-sex">
               <button data-val="m" ${state.sex === 'm' ? 'class="active"' : ''}>Male</button>
               <button data-val="u" ${state.sex === 'u' ? 'class="active"' : ''}>Unspecified</button>
               <button data-val="f" ${state.sex === 'f' ? 'class="active"' : ''}>Female</button>
             </div>
           </div>
           ${showPrayerReader ? readerFieldHtml('prayers') : ''}
         </div>
       </div>`
    : `<div class="slot-row">
         <button class="slot-btn" id="prayers-btn">+ Add Prayers of the Faithful</button>
       </div>`;

  const titleRow = state.titlePage
    ? `<div class="slot-row">
         <div class="slot-card">
           <div class="slot-card-top" id="title-card-top">
             <div class="slot-card-top-content">
               <span class="slot-filled-label">Title Page</span>
             </div>
             <button class="slot-x" id="title-remove" aria-label="Remove">×</button>
           </div>
           <div class="slot-card-bottom">
             <span class="slot-reader-label">Name</span>
             <input type="text" class="slot-reader-input" id="title-name-input"
               placeholder="of the deceased" value="${escapeHtml(state.titleName)}"
               autocomplete="off">
           </div>
           <div class="slot-card-bottom">
             <span class="slot-reader-label">Date</span>
             <input type="text" class="slot-reader-input" id="title-date-input"
               placeholder="of the funeral" value="${escapeHtml(state.titleDate)}"
               autocomplete="off">
           </div>
           <div class="slot-card-bottom">
             <label class="title-verso-label">
               <input type="checkbox" id="title-blank-verso" ${state.titleBlankVerso ? 'checked' : ''}>
               <span>Add blank page after title</span>
             </label>
             <div class="help-popover-wrap">
               <button class="help-btn" aria-label="About the blank page">?</button>
               <div class="help-popover"><p>When printing double-sided, this keeps the back of the title page blank so that readings begin on a fresh right-hand page—the way a chapter opens in a book.</p></div>
             </div>
           </div>
         </div>
       </div>`
    : `<div class="slot-row">
         <button class="slot-btn" id="title-btn">+ Add Title Page</button>
       </div>`;

  const slotRows = visible.map(slot => {
    const r = sel[slot];
    const showReader = state.includeReader && slot !== 'gospel';
    return r
      ? `<div class="slot-row">
           <div class="slot-card">
             <div class="slot-card-top" data-slot="${slot}">
               <div class="slot-card-top-content">
                 <span class="slot-filled-label">${SLOT_LABEL[slot]}</span>
                 <span class="slot-filled-bottom">
                   <span class="slot-filled-ref">${formatRefUI(expandRef(r.ref))}</span>
                   <span class="slot-filled-id">${r.id}</span>
                 </span>
               </div>
               <button class="slot-x slot-remove" data-slot="${slot}" aria-label="Remove">×</button>
             </div>
             ${showReader ? readerFieldHtml(slot) : ''}
           </div>
         </div>`
      : `<div class="slot-row">
           <button class="slot-btn" data-slot="${slot}">+ Add ${SLOT_LABEL[slot]}</button>
         </div>`;
  });

  const gap = '<div class="slot-gap"></div>';
  const allRows = [titleRow, ...slotRows, prayerRow];
  area.innerHTML = `<div id="slot-content">${allRows.map(r => gap + r).join('')}${gap}</div>`;

  area.querySelectorAll('.slot-btn[data-slot]').forEach(btn =>
    btn.addEventListener('click', () => openSlot(btn.dataset.slot))
  );
  area.querySelectorAll('.slot-card-top[data-slot]').forEach(div =>
    div.addEventListener('click', () => openSlot(div.dataset.slot))
  );
  area.querySelectorAll('.slot-remove[data-slot]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeSlot(btn.dataset.slot); })
  );
  area.querySelectorAll('.slot-reader-input[data-reader]').forEach(input => {
    input.addEventListener('input', () => {
      state.readers[input.dataset.reader] = input.value;
      const btn = input.closest('.slot-card-bottom').querySelector('.slot-reader-clear');
      btn.classList.toggle('visible', !!input.value);
      renderPreview();
    });
    input.addEventListener('click', e => e.stopPropagation());
  });
  area.querySelectorAll('.slot-reader-clear[data-reader]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.readers[btn.dataset.reader] = '';
      btn.classList.remove('visible');
      btn.closest('.slot-card-bottom').querySelector('.slot-reader-input').value = '';
      renderPreview();
    });
  });

  document.getElementById('title-btn')?.addEventListener('click', () => {
    state.titlePage = true;
    renderSlots();
    renderPreview();
    requestAnimationFrame(() => scrollToBlock('title-block'));
  });
  document.getElementById('title-remove')?.addEventListener('click', e => {
    e.stopPropagation();
    state.titlePage = false;
    renderSlots();
    renderPreview();
  });
  document.getElementById('title-name-input')?.addEventListener('input', e => {
    state.titleName = e.target.value;
    renderPreview();
  });
  document.getElementById('title-name-input')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('title-date-input')?.addEventListener('input', e => {
    state.titleDate = e.target.value;
    renderPreview();
  });
  document.getElementById('title-date-input')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('title-blank-verso')?.addEventListener('change', e => {
    state.titleBlankVerso = e.target.checked;
    renderPreview();
  });
  document.getElementById('title-blank-verso')?.addEventListener('click', e => e.stopPropagation());

  document.getElementById('title-card-top')?.addEventListener('click', () => {
    requestAnimationFrame(() => scrollToBlock('title-block'));
  });
  document.getElementById('prayers-card-top')?.addEventListener('click', () => {
    requestAnimationFrame(scrollToPrayerBlock);
  });
  document.getElementById('prayers-btn')?.addEventListener('click', () => {
    const tmpl = allPrayers.find(p => p.id === PRAYER_FOR_CTX[state.context]);
    state.prayers = tmpl ? JSON.parse(JSON.stringify(tmpl)) : null;
    state.prayersEdited = false;
    state.editedPetitions = new Set();
    state.pendingRemove = null;
    renderSlots();
    renderPreview();
    requestAnimationFrame(scrollToPrayerBlock);
  });
  document.getElementById('prayers-remove')?.addEventListener('click', e => {
    e.stopPropagation();
    if (state.prayersEdited) {
      state.pendingRemove = { type: 'prayers' };
      renderSlots();
    } else {
      state.prayers = null;
      state.pendingRemove = null;
      renderSlots();
      renderPreview();
    }
  });
  document.getElementById('prayers-remove-confirm')?.addEventListener('click', e => {
    e.stopPropagation();
    state.prayers = null;
    state.prayersEdited = false;
    state.editedPetitions = new Set();
    state.pendingRemove = null;
    renderSlots();
    renderPreview();
  });
  document.getElementById('prayers-remove-cancel')?.addEventListener('click', e => {
    e.stopPropagation();
    state.pendingRemove = null;
    renderSlots();
  });

  document.getElementById('prayers-name-input')?.addEventListener('input', e => {
    state.name = e.target.value;
    renderPreview();
  });
  document.getElementById('prayers-name-input')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('prayers-seg-sex')?.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    state.sex = btn.dataset.val;
    document.querySelectorAll('#prayers-seg-sex button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === state.sex)
    );
    renderPreview();
  });

  if (_prayerConfirmDismiss) {
    document.removeEventListener('click', _prayerConfirmDismiss);
    _prayerConfirmDismiss = null;
  }
  if (pendingPrayers) {
    _prayerConfirmDismiss = e => {
      if (e.target.id === 'prayers-remove-confirm') return;
      document.removeEventListener('click', _prayerConfirmDismiss);
      _prayerConfirmDismiss = null;
      state.pendingRemove = null;
      renderSlots();
    };
    setTimeout(() => document.addEventListener('click', _prayerConfirmDismiss), 0);
  }
}

// ── Search view ───────────────────────────────────────────────────────────────

let searchTimer   = null;
let currentPool   = [];
let currentResults = [];

function renderSearchView(container) {
  currentPool = poolFor(state.activeSlot);

  container.innerHTML = `
    <div id="search-view">
      <div id="search-head">
        <button id="back-btn" title="Back"></button>
        <span id="search-title">Add ${SLOT_LABEL[state.activeSlot]}</span>
        <div id="search-head-spacer"></div>
      </div>
      <div id="search-input-wrap">
        <input id="search-input" type="search" placeholder="Search by keyword or theme…" autocomplete="off">
        <button type="button" id="search-clear" class="search-clear" aria-label="Clear search" tabindex="-1">×</button>
      </div>
      <div id="search-status"></div>
      <div id="search-results"></div>
      <button id="accept-btn" ${state.previewing ? '' : 'disabled'}>${
        state.activeSlot === 'psalm'   ? 'Use this psalm' :
        state.activeSlot === 'gospel'  ? 'Use this Gospel' :
                                         'Use this reading'
      }</button>
    </div>`;

  document.getElementById('back-btn').addEventListener('click', closeSlot);
  document.getElementById('accept-btn').addEventListener('click', acceptPreviewing);

  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  const syncClear = () => clearBtn.classList.toggle('visible', input.value.length > 0);
  input.addEventListener('input', () => {
    syncClear();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 220);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncClear();
    input.focus();
    clearTimeout(searchTimer);
    runSearch();
  });
  syncClear();

  displayResults(currentPool);
  input.focus();

  // Scroll result list to show the pre-selected card
  const highlighted = document.querySelector('.result-card.previewing');
  if (highlighted) highlighted.scrollIntoView({ block: 'nearest' });
}

function displayResults(results) {
  currentResults = results;
  const el     = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  if (!el) return;

  status.textContent = `${results.length} reading${results.length !== 1 ? 's' : ''}`;

  const curId = currentSel()[state.activeSlot]?.id;
  el.innerHTML = results.map((r, i) => {
    const raw = toUiResponsum(r.text.replace(/<[^>]+>/g, '').replace(/\{\{response\}\}/g, ''))
      .trim().replace(/\n+/g, ' ');
    const active = state.previewing?.id === r.id ? ' previewing' : '';
    const cur = r.id === curId ? ' <span class="rc-cur">· current</span>' : '';
    return `<button class="result-card${active}" data-i="${i}">
      <div class="rc-top">
        <span class="rc-ref">${formatRefUI(expandRef(r.ref))}${cur}</span>
        <span class="rc-id">${r.id}</span>
      </div>
      <div class="rc-excerpt">${raw}</div>
    </button>`;
  }).join('');

  el.querySelectorAll('.result-card').forEach(card =>
    card.addEventListener('click', () => previewResult(currentResults[+card.dataset.i]))
  );

  fitExcerpts(el, '.rc-excerpt');
}

async function runSearch() {
  const q = document.getElementById('search-input')?.value?.trim();
  if (!q) { displayResults(currentPool); return; }
  const results = await search(normalizeBookRefs(q), currentPool, { mode: 'all', limit: 25 });
  displayResults(results);
}

function previewResult(r) {
  state.previewing = r;
  document.querySelectorAll('.result-card').forEach(card =>
    card.classList.toggle('previewing', currentResults[+card.dataset.i]?.id === r.id)
  );
  const btn = document.getElementById('accept-btn');
  if (btn) btn.disabled = false;
  renderPreview();
  requestAnimationFrame(scrollToActive);
}

function acceptPreviewing() {
  if (!state.previewing) return;
  currentSel()[state.activeSlot] = state.previewing;

  state.previewing = null;
  state.activeSlot = null;
  renderSlots();

  const container   = document.getElementById('preview-scroll');
  const doc         = document.getElementById('preview-doc');
  const priorScroll = container.scrollTop;

  renderPreview();
  const naturalMax = Math.max(0, container.scrollHeight - container.clientHeight);

  if (priorScroll > naturalMax) {
    doc.classList.add('slot-open');
    container.scrollTop = priorScroll;
    animateTo(container, naturalMax, 450, () => doc.classList.remove('slot-open'));
  }
}

function openSlot(slot) {
  const container = document.getElementById('preview-scroll');
  scrollTopBeforeSlot = container ? container.scrollTop : 0;
  state.activeSlot = slot;
  state.previewing = currentSel()[slot] || null;
  renderSlots();
  renderPreviewAnchored();
  requestAnimationFrame(scrollToActive);
}

function closeSlot() {
  const container   = document.getElementById('preview-scroll');
  const doc         = document.getElementById('preview-doc');
  const target      = Math.max(0, scrollTopBeforeSlot);
  const priorScroll = container.scrollTop;

  state.activeSlot = null;
  state.previewing = null;
  renderSlots();
  renderPreview();

  const naturalMax = Math.max(0, container.scrollHeight - container.clientHeight);

  if (priorScroll > naturalMax) {
    doc.classList.add('slot-open');
    container.scrollTop = priorScroll;
    animateTo(container, target, 450, () => doc.classList.remove('slot-open'));
  } else {
    animateTo(container, target, 450);
  }
}

function removeSlot(slot) {
  currentSel()[slot] = null;
  renderSlots();
  renderPreview();
}

// ── Context switching ────────────────────────────────────────────────────────

function switchContext(ctx) {
  const wasInSlot = state.activeSlot;
  if (state.prayers && state.prayers.id !== PRAYER_FOR_CTX[ctx]) state.prayers = null;
  state.context = ctx;
  document.querySelectorAll('.ctx-pill[data-ctx]').forEach(p =>
    p.classList.toggle('active', p.dataset.ctx === ctx)
  );
  document.getElementById('season-bar')?.classList.toggle('season-disabled', ctx === 'unbaptized');
  if (wasInSlot && !CTX_SLOTS[ctx].includes(wasInSlot)) {
    state.activeSlot = null;
    state.previewing = null;
  } else if (wasInSlot) {
    state.previewing = currentSel()[wasInSlot] || null;
  }
  renderSlots();
  renderPreview();
}

function switchSeason(season) {
  const wasInSlot = state.activeSlot;

  // Carry shared slots (psalm, secondReading, gospel) into the destination season
  if (state.context !== 'unbaptized') {
    const from = currentSel();
    const to   = state.selections[state.context][season];
    to.psalm         = from.psalm;
    to.secondReading = from.secondReading;
    to.gospel        = from.gospel;
  }

  state.season      = season;
  state.paschaltide = season === 'during';
  document.querySelectorAll('[data-season]').forEach(b =>
    b.classList.toggle('active', b.dataset.season === season)
  );
  if (wasInSlot) {
    state.previewing = currentSel()[wasInSlot] || null;
  }
  renderSlots();
  renderPreview();
}

// ── Settings ─────────────────────────────────────────────────────────────────

function initSettings() {
  const toggle = document.getElementById('settings-toggle');
  const panel  = document.getElementById('settings-panel');
  const wrap   = document.getElementById('settings-wrap');

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    toggle.classList.toggle('open', open);
  });

  // Capture phase: some text inputs stopPropagation on click (so a click inside
  // them doesn't bubble), which would otherwise prevent this dismiss from firing.
  // Capturing runs before those handlers, so an outside click always closes the panel.
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) {
      panel.classList.remove('open');
      toggle.classList.remove('open');
    }
  }, true);

  document.getElementById('s-ref').addEventListener('change', e => {
    state.includeRef = e.target.checked;
    renderPreview();
  });
  document.getElementById('s-id').addEventListener('change', e => {
    state.includeId = e.target.checked;
    renderPreview();
  });
  document.getElementById('s-dropcaps').addEventListener('change', e => {
    state.dropCaps = e.target.checked;
    renderPreview();
  });
  document.getElementById('s-subhead').addEventListener('change', e => {
    state.includeSubhead = e.target.checked;
    renderPreview();
  });
  document.getElementById('s-reader').addEventListener('change', e => {
    state.includeReader = e.target.checked;
    renderSlots();
    renderPreview();
  });

  document.getElementById('seg-color').addEventListener('click', e => {
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    state.colorMode = btn.dataset.val;
    document.querySelectorAll('#seg-color button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === state.colorMode)
    );
    renderPreview();
  });

  // Theme moved to the left funeral-bar (a viewing preference, not an output setting).

  // Font size: Normal (14pt body, 1.25in side margins) | Large (17pt, 0.95in).
  // Leading auto-derives at 17/14 from --doc-pt, so screen and print keep the
  // same ratio the drop-cap shape needs (see project-dropcap-leading); caps are
  // em/ratio-based and scale without recompute. @page can't read CSS vars
  // reliably, so margins go through a dedicated <style> element.
  applyFontSize();
  document.getElementById('seg-fontsize').addEventListener('click', e => {
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    state.fontSize = btn.dataset.val;
    document.querySelectorAll('#seg-fontsize button').forEach(b =>
      b.classList.toggle('active', b.dataset.val === state.fontSize)
    );
    applyFontSize();
    scheduleCommit();
  });

  document.getElementById('print-btn').addEventListener('click', () => {
    if (localStorage.getItem('printTipsAcknowledged') === 'true') {
      window.print();
    } else {
      showPrintTips();
    }
  });

  const overlay = document.getElementById('print-tips-overlay');

  function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox'))  return 'firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
    return 'chrome'; // Chrome, Edge, and other Chromium browsers
  }

  const PRINT_TIPS = {
    chrome: `
      <p>To remove page headers and footers:</p>
      <ol>
        <li>Click <strong>More settings</strong></li>
        <li>Uncheck <strong>Headers and footers</strong></li>
      </ol>
      <p class="tips-note">Chrome remembers this setting. You only need to do this once, unless you change it later.</p>
      <p>To save as a PDF, set <strong>Destination</strong> to <strong>Save as PDF</strong>.</p>`,
    firefox: `
      <p>To remove page headers and footers:</p>
      <ol>
        <li>Click <strong>More settings</strong></li>
        <li>Under <strong>Options</strong>, uncheck <strong>Print headers and footers</strong></li>
      </ol>
      <p class="tips-note">Firefox does not remember this setting between sessions.</p>
      <p>To save as a PDF, set <strong>Destination</strong> to <strong>Save to PDF</strong>.</p>`,
    safari: `
      <p>To remove page headers and footers:</p>
      <ol>
        <li>Find the panel dropdown (may show <strong>Layout</strong> or <strong>Safari</strong>)</li>
        <li>Select <strong>Safari</strong></li>
        <li>Uncheck <strong>Print headers and footers</strong></li>
      </ol>
      <p>To save as a PDF, click the <strong>PDF</strong> button in the bottom-left corner.</p>`,
  };

  function showPrintTips() {
    document.getElementById('print-tips-body').innerHTML = PRINT_TIPS[detectBrowser()];
    overlay.style.display = 'flex';
  }

  function closeTipsAndPrint(dismiss) {
    if (dismiss) localStorage.setItem('printTipsAcknowledged', 'true');
    overlay.style.display = 'none';
    window.print();
  }

  document.getElementById('print-tips-remind') .addEventListener('click', () => closeTipsAndPrint(false));
  document.getElementById('print-tips-dismiss').addEventListener('click', () => closeTipsAndPrint(true));

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { overlay.style.display = 'none'; }
  });

}

// ── Save / Load / Share: document model + persistence ────────────────────────

function setPageMarginX(inches) {
  let el = document.getElementById('print-margin-style');
  if (!el) { el = document.createElement('style'); el.id = 'print-margin-style'; document.head.appendChild(el); }
  el.textContent = `@page { size: letter; margin: 0.75in ${inches}in 1.25in; }`;
}
function applyFontSize() {
  const large = state.fontSize === 'large';
  document.getElementById('preview-doc').style.setProperty('--doc-pt', large ? '17pt' : '14pt');
  setPageMarginX(large ? 0.95 : 1.25);
}

// state.selections stores reading OBJECTS; the document/codec works in ID strings.
// These convert across that boundary.
function setSegActive(segId, val) {
  document.querySelectorAll(`#${segId} button[data-val]`).forEach(b =>
    b.classList.toggle('active', b.dataset.val === val));
}
// Reflect state into the static controls (settings checkboxes/segments + context/season pills).
function syncControlsToState() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  set('s-subhead', state.includeSubhead); set('s-ref', state.includeRef); set('s-id', state.includeId);
  set('s-reader', state.includeReader); set('s-dropcaps', state.dropCaps);
  setSegActive('seg-color', state.colorMode);
  setSegActive('seg-fontsize', state.fontSize);
  document.querySelectorAll('.ctx-pill[data-ctx]').forEach(p =>
    p.classList.toggle('active', p.dataset.ctx === state.context));
  document.querySelectorAll('[data-season]').forEach(b =>
    b.classList.toggle('active', b.dataset.season === state.season));
  document.getElementById('season-bar')?.classList.toggle('season-disabled', state.context === 'unbaptized');
  applyFontSize();
}

// ── Named funeral library + UI (New / Save / Open / Share) ────────────────────
// The draft/library data layer lives in funeral-core.js; the dialogs/handlers
// below are the desktop UI over it.
let libSort = 'modified';
let _pendingAction = null;   // run after the New/Open guard resolves
let _afterSave = null;       // run after a save completes (for "Save & continue")

function updateFbar() {
  const save = document.getElementById('fb-save');
  if (!save) return;
  save.classList.toggle('is-dirty', isDirty());
  save.disabled = isBlank() && !getCurrentFuneralId();   // nothing worth saving yet
}

let _flashTimer = null;
function flashSave(msg) {
  const span = document.querySelector('#fb-save span');
  if (!span) return;
  span.textContent = msg;
  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => { span.textContent = 'Save'; updateFbar(); }, 1600);
}
// First save → name it via the dialog. Already-saved → update silently with feedback.
function onSaveClick() {
  const fid = getCurrentFuneralId();
  if (fid && libFind(fid)) {
    saveFuneral(libFind(fid).name);
    flashSave('Saved ✓');
  } else {
    openSaveDialog();
  }
}
function loadFromCode() {
  const inp = document.getElementById('lib-code-input');
  let doc;
  try { doc = decode(inp.value); }
  catch { alert('That doesn’t look like a valid funeral link or code.'); return; }
  inp.value = '';
  hideModal('funeral-library-overlay');
  guardThen(() => loadDoc(doc, null));   // loads as new unsaved work; user can Save it
}

const showModal = id => { document.getElementById(id).style.display = 'flex'; };
const hideModal = id => { document.getElementById(id).style.display = 'none'; };

function guardThen(action) {
  if (!isDirty()) { action(); return; }
  _pendingAction = action;
  showModal('confirm-overlay');
}
function openSaveDialog() {
  const e = getCurrentFuneralId() ? libFind(getCurrentFuneralId()) : null;
  const inp = document.getElementById('save-name');
  inp.value = e ? e.name : (state.titleName || state.name || '');
  showModal('save-overlay');
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
function confirmSave() {
  const name = (document.getElementById('save-name').value || '').trim();
  if (!name) { document.getElementById('save-name').focus(); return; }
  saveFuneral(name);
  hideModal('save-overlay');
  const after = _afterSave; _afterSave = null;
  if (after) after();
}
function openShare() {
  let code; try { code = encode(docFromState()); } catch { return; }
  const inp = document.getElementById('share-link');
  inp.value = shareUrl(code);
  document.getElementById('share-copied').style.display = 'none';
  showModal('share-overlay');
}
const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function showCopied(msg) {
  const c = document.getElementById('share-copied');
  c.textContent = msg; c.style.display = 'inline';
}
function copyPlain(text, msg) {
  const fallback = () => { const inp = document.getElementById('share-link'); inp.focus(); inp.select(); try { document.execCommand('copy'); showCopied(msg); } catch {} };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showCopied(msg)).catch(fallback);
  else fallback();
}
// Copy link writes BOTH a rich <a> (pretty link in rich editors / mail / Word) and
// the plain URL (address bar, plain-text fields).
async function copyShare() {
  const inp = document.getElementById('share-link');
  const url = inp.value;
  const label = shareName() || 'Funeral reading selection';
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const html = `<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([url], { type: 'text/plain' }),
      })]);
      showCopied('Link copied!');
      return;
    } catch { /* fall through to plain copy */ }
  }
  copyPlain(url, 'Link copied!');
}

function renderLibrary() {
  const lib = loadLibrary().slice();
  lib.sort((a, b) => libSort === 'name' ? a.name.localeCompare(b.name) : (b.modifiedAt - a.modifiedAt));
  const list = document.getElementById('lib-list');
  if (!lib.length) { list.innerHTML = '<div class="lib-empty">No saved funerals yet. Build one, then press Save.</div>'; return; }
  list.innerHTML = lib.map(e => `
    <div class="lib-item">
      <div class="lib-item-main" data-open="${escapeHtml(e.id)}">
        <div class="lib-item-name">${escapeHtml(e.name)}${e.id === getCurrentFuneralId() ? ' <span style="color:var(--muted);font-weight:400">· current</span>' : ''}</div>
        <div class="lib-item-meta">Modified ${escapeHtml(fmtDate(e.modifiedAt))}</div>
      </div>
      <button class="lib-item-act" data-rename="${escapeHtml(e.id)}">Rename</button>
      <button class="lib-item-act lib-item-act--del" data-delete="${escapeHtml(e.id)}" aria-label="Delete" title="Delete">✕</button>
    </div>`).join('');
}
// Theme primitives (currentTheme/applyTheme/initTheme) live in the shared
// theme.js; desktop updates its toolbar icon after each change via updateThemeIcon.
function toggleTheme() { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); updateThemeIcon(); }
function updateThemeIcon() {
  const btn = document.getElementById('fb-theme'); if (!btn) return;
  const dark = currentTheme() === 'dark';
  // show the icon of the theme you'll switch TO
  btn.innerHTML = dark
    ? '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.1"/><path d="M8 .8v2.1M8 13.1v2.1M.8 8h2.1M13.1 8h2.1M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M13.6 9.7A5.5 5.5 0 1 1 6.3 2.4a4.3 4.3 0 0 0 7.3 7.3z"/></svg>';
  btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}

function initFuneralActions() {
  document.getElementById('fb-theme').addEventListener('click', toggleTheme);
  initTheme(updateThemeIcon);
  updateThemeIcon();

  document.getElementById('fb-new').addEventListener('click', () => guardThen(newFuneral));
  document.getElementById('fb-open').addEventListener('click', () => { renderLibrary(); showModal('funeral-library-overlay'); });
  document.getElementById('fb-save').addEventListener('click', onSaveClick);
  document.getElementById('fb-share').addEventListener('click', openShare);

  document.getElementById('lib-code-load').addEventListener('click', loadFromCode);
  document.getElementById('lib-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadFromCode(); });

  document.getElementById('lib-close').addEventListener('click', () => hideModal('funeral-library-overlay'));
  document.getElementById('lib-export').addEventListener('click', exportAll);
  document.getElementById('lib-import').addEventListener('click', () =>
    importAll({ notify: (m) => alert(m), refresh: renderLibrary }));
  document.getElementById('lib-clear').addEventListener('click', () => {
    // Full device wipe (shared-computer privacy): clears the saved library AND the
    // current in-progress funeral. newFuneral() resets to a blank document and
    // rewrites the working draft + URL hash with no personal data, so the next
    // person on this machine sees nothing of the previous funeral.
    if (!confirm('Clear all saved funerals and the current in-progress funeral from this device? This cannot be undone.')) return;
    saveLibrary([]);
    newFuneral();
    renderLibrary();
  });
  document.getElementById('lib-sort').addEventListener('click', e => {
    const b = e.target.closest('button[data-sort]'); if (!b) return;
    libSort = b.dataset.sort;
    document.querySelectorAll('#lib-sort button').forEach(x => x.classList.toggle('active', x.dataset.sort === libSort));
    renderLibrary();
  });
  document.getElementById('lib-list').addEventListener('click', e => {
    const ren = e.target.closest('[data-rename]');
    const del = e.target.closest('[data-delete]');
    const open = e.target.closest('[data-open]');
    if (ren) {
      const id = ren.dataset.rename, cur = libFind(id);
      const name = prompt('Rename funeral:', cur ? cur.name : '');
      if (name && name.trim()) { const lib = loadLibrary(); const x = lib.find(z => z.id === id); if (x) { x.name = name.trim().slice(0, 80); saveLibrary(lib); renderLibrary(); } }
      return;
    }
    if (del) {
      if (!confirm('Delete this funeral?')) return;
      const id = del.dataset.delete;
      saveLibrary(loadLibrary().filter(z => z.id !== id));
      if (getCurrentFuneralId() === id) setCurrentFuneralId(null);
      renderLibrary(); commitNow();
      return;
    }
    if (open) { hideModal('funeral-library-overlay'); const id = open.dataset.open; guardThen(() => openFuneral(id)); }
  });

  document.getElementById('save-cancel').addEventListener('click', () => { _afterSave = null; hideModal('save-overlay'); });
  document.getElementById('save-confirm').addEventListener('click', confirmSave);
  document.getElementById('save-name').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSave(); });

  document.getElementById('share-close').addEventListener('click', () => hideModal('share-overlay'));
  document.getElementById('share-copy-link').addEventListener('click', () => copyShare());
  document.getElementById('share-email').addEventListener('click', () => { try { emailShare(encode(docFromState())); } catch {} });

  document.getElementById('confirm-cancel').addEventListener('click', () => { _pendingAction = null; hideModal('confirm-overlay'); });
  document.getElementById('confirm-discard').addEventListener('click', () => {
    hideModal('confirm-overlay'); const a = _pendingAction; _pendingAction = null; if (a) a();
  });
  document.getElementById('confirm-save').addEventListener('click', () => {
    hideModal('confirm-overlay'); _afterSave = _pendingAction; _pendingAction = null; openSaveDialog();
  });

  document.querySelectorAll('.modal-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; }));
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Set default season from today's date
const defaultSeason = isDuringEasterTime() ? 'during' : 'outside';
state.season     = defaultSeason;
state.paschaltide = defaultSeason === 'during';
document.querySelectorAll('.ctx-pill[data-ctx]').forEach(pill =>
  pill.addEventListener('click', () => switchContext(pill.dataset.ctx))
);

document.querySelectorAll('[data-season]').forEach(btn =>
  btn.addEventListener('click', () => switchSeason(btn.dataset.season))
);

// Register the desktop view's re-render hooks into the shared core: how to
// repaint after a document load (Open/New/loadFromCode) and after a draft commit.
configure({
  afterLoad: () => { syncControlsToState(); renderSlots(); renderPreview(); },
  afterCommit: updateFbar,
});

initSettings();
initFuneralActions();
setLoading(true);
restoreOnBoot();          // URL hash > working draft > date-default season
syncControlsToState();    // reflect restored state into static controls/pills
renderSlots();
renderPreview();
setLoading(false);
commitNow();              // establish working draft + hash for the current document
preloadEmbedder();

(function () {
  const { easter, pentecost } = easterSeasonLabel();
  const el = document.getElementById('help-season-popover');
  if (el) el.innerHTML =
    `<p>For the readings for general use and for a baptized child, the Church provides different ` +
    `first readings during Easter time and outside Easter time. If the funeral date falls ` +
    `between ${easter} and ${pentecost}, select <strong>During Easter Time</strong>; ` +
    `otherwise <strong>Outside Easter Time</strong> is correct.</p>`;
})();

// Drop-cap advance widths must be measured with the display font loaded. It is
// font-display:swap and loads on demand, so an early render can measure fallback
// metrics. Once the font is ready, drop any such values and re-apply the shapes.
document.fonts.load('1em "Cormorant Garamond"').then(() => {
  clearDCAdvCache();
  if (state.dropCaps) {
    const doc = document.getElementById('preview-doc');
    if (doc) applyDropCapShapes(doc);
  }
});

document.getElementById('preview-scroll').addEventListener('click', e => {
  if (state.activeSlot) return;
  if (window.getSelection().toString()) return;
  if (state.pendingRemove?.type === 'petition') {
    if (!e.target.closest('.pe-confirm-yes, .pe-confirm-no')) {
      state.pendingRemove = null;
      renderPreview();
      return;
    }
  }
  const block = e.target.closest('.reading-block[data-slot]');
  if (block) openSlot(block.dataset.slot);
});
