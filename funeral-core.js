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
// funeral-core.js — the view-agnostic funeral model.
//
// Holds the live `state`, the state <-> share-document serialization, and the
// draft/library persistence. Shared by the desktop (main.js) and mobile
// (mobile.js) layouts so a funeral round-trips losslessly between them and the
// share format stays single-source.
//
// No DOM access lives here. The host view registers re-render callbacks via
// configure({ afterLoad, afterCommit }); `currentFuneralId` and the loading
// flag are reached through accessors.
//
// CRITICAL invariant (see CLAUDE.md): when you add any new funeral state, extend
// DEFAULT_DOC + buildCompact/decode in share.js AND docFromState/applyDocToState
// below, or the state silently won't save/share.

import allReadings from './readings.json' with { type: 'json' };
import allPrayers from './prayers.json' with { type: 'json' };
import { isDuringEasterTime } from './easter.js';
import { encode, decode, DEFAULT_DOC, emptySelections } from './share.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const SLOTS = ['firstReading', 'psalm', 'secondReading', 'gospel'];
export const SLOT_LABEL = {
  firstReading:  'First Reading',
  psalm:         'Psalm',
  secondReading: 'Second Reading',
  gospel:        'Gospel',
};
export const SLOT_TYPE = {
  firstReading:  'first reading',
  psalm:         'psalm',
  secondReading: 'second reading',
  gospel:        'gospel',
};
export const CTX_SLOTS = {
  adult:      ['firstReading', 'psalm', 'secondReading', 'gospel'],
  child:      ['firstReading', 'psalm', 'secondReading', 'gospel'],
  unbaptized: ['firstReading', 'psalm', 'gospel'],
};

export const PRAYER_FOR_CTX = { adult: 'adult', child: 'baptized-child', unbaptized: 'unbaptized-child' };

// ── State ────────────────────────────────────────────────────────────────────

export const state = {
  context:        'adult',
  season:         'outside',
  paschaltide:    false,
  includeRef:     true,
  includeId:      false,
  includeSubhead: true,
  includeReader:  false,
  dropCaps:       false,
  colorMode:      'color',
  fontSize:       'normal',  // 'normal' (14/17, 1.25in margins) | 'large' (17pt, 0.95in margins)
  titlePage:      false,
  titleName:      '',
  titleDate:      '',
  titleBlankVerso: false,
  readers:        { firstReading: '', psalm: '', secondReading: '', prayers: '' },
  activeSlot:     null,
  previewing:     null,
  name:           '',
  sex:            'u',
  prayers:        null,
  prayerEditing:  null,
  prayersEdited:  false,
  editedPetitions: new Set(),
  pendingRemove:  null,
  selections: {
    adult: {
      outside: { firstReading: null, psalm: null, secondReading: null, gospel: null },
      during:  { firstReading: null, psalm: null, secondReading: null, gospel: null },
    },
    child: {
      outside: { firstReading: null, psalm: null, secondReading: null, gospel: null },
      during:  { firstReading: null, psalm: null, secondReading: null, gospel: null },
    },
    unbaptized: { firstReading: null, psalm: null, gospel: null },
  },
};

export function currentSel() {
  if (state.context === 'unbaptized') return state.selections.unbaptized;
  return state.selections[state.context][state.season];
}

// Deep-copied Prayers-of-the-Faithful template for a context (null if none).
export function makePrayersForContext(ctx = state.context) {
  const tmpl = allPrayers.find(p => p.id === PRAYER_FOR_CTX[ctx]);
  return tmpl ? JSON.parse(JSON.stringify(tmpl)) : null;
}

// ── Filtering ────────────────────────────────────────────────────────────────

export function poolFor(slotKey) {
  const type = SLOT_TYPE[slotKey];
  return allReadings.filter(r => {
    if (r.type !== type) return false;
    if (state.context === 'adult'      && !r.adult)           return false;
    if (state.context === 'child'      && !r.child)           return false;
    if (state.context === 'unbaptized' && !r.unbaptizedchild) return false;
    if ( state.paschaltide && r.duringpt === false) return false;
    if (!state.paschaltide && r.duringpt === true)  return false;
    return true;
  });
}

// ── Output order ─────────────────────────────────────────────────────────────

// The four reading slots in output order, filtered to those present. The Second
// Reading precedes the Psalm when there is no First Reading; otherwise natural
// order. `present(slot)` reports whether a slot is filled — callers decide what
// "filled" means (a live selection on mobile, or a preview cell that may hold a
// 'ghost' placeholder on desktop). Single source of this ordering rule for both
// views.
export function orderedSlotKeys(present) {
  if (!present('firstReading') && present('secondReading') && present('psalm')) {
    return ['secondReading', 'psalm', 'gospel'].filter(present);
  }
  return ['firstReading', 'psalm', 'secondReading', 'gospel'].filter(present);
}

// Group body lines into clause/sentence units (a line ending in terminal
// punctuation closes a group). Page breaks are allowed only BETWEEN groups,
// never inside one. Shared by desktop + mobile so the break behavior is identical.
export function groupBodyLines(lines) {
  const groups = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    if (/[.,;!?”’—]$/.test(line.trimEnd())) { groups.push(current); current = []; }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ── Selections <-> ids ───────────────────────────────────────────────────────

export const READING_BY_ID = new Map(allReadings.map(r => [r.id, r]));

export function selectionsToIds(sel) {
  const conv = o => { const out = {}; for (const k in o) { const v = o[k]; out[k] = v ? (typeof v === 'string' ? v : v.id) : null; } return out; };
  return {
    adult: { outside: conv(sel.adult.outside), during: conv(sel.adult.during) },
    child: { outside: conv(sel.child.outside), during: conv(sel.child.during) },
    unbaptized: conv(sel.unbaptized),
  };
}
export function selectionsToObjects(selIds) {
  const out = emptySelections();
  const fill = (src, dst) => { for (const k in dst) dst[k] = src && src[k] ? (READING_BY_ID.get(src[k]) || null) : null; };
  fill(selIds.adult && selIds.adult.outside, out.adult.outside);
  fill(selIds.adult && selIds.adult.during, out.adult.during);
  fill(selIds.child && selIds.child.outside, out.child.outside);
  fill(selIds.child && selIds.child.during, out.child.during);
  fill(selIds.unbaptized, out.unbaptized);
  return out;
}

// ── State <-> share document ─────────────────────────────────────────────────

// Build the serialisable document (share.js vocabulary) from live state.
export function docFromState() {
  return {
    context: state.context, season: state.season,
    includeRef: state.includeRef, includeId: state.includeId, includeSubhead: state.includeSubhead,
    includeReader: state.includeReader, dropCaps: state.dropCaps,
    colorMode: state.colorMode, fontSize: state.fontSize,
    titlePage: state.titlePage, titleName: state.titleName, titleDate: state.titleDate,
    titleBlankVerso: state.titleBlankVerso,
    readers: { ...state.readers },
    name: state.name, sex: state.sex,
    prayers: state.prayers ? {
      edited: state.prayersEdited,
      intro: state.prayers.intro || '', response: state.prayers.response || '',
      petitions: (state.prayers.petitions || []).slice(),
      closing: state.prayers.closing || '',
      editedPetitions: Array.from(state.editedPetitions || []),
    } : null,
    selections: selectionsToIds(state.selections),
  };
}

// Apply a validated document into live state (resets transient UI fields).
export function applyDocToState(doc) {
  state.context = doc.context; state.season = doc.season;
  state.paschaltide = doc.season === 'during';
  state.includeRef = doc.includeRef; state.includeId = doc.includeId;
  state.includeSubhead = doc.includeSubhead; state.includeReader = doc.includeReader;
  state.dropCaps = doc.dropCaps; state.colorMode = doc.colorMode; state.fontSize = doc.fontSize;
  state.titlePage = doc.titlePage; state.titleName = doc.titleName;
  state.titleDate = doc.titleDate; state.titleBlankVerso = doc.titleBlankVerso;
  state.readers = {
    firstReading: doc.readers.firstReading || '', psalm: doc.readers.psalm || '',
    secondReading: doc.readers.secondReading || '', prayers: doc.readers.prayers || '',
  };
  state.name = doc.name; state.sex = doc.sex;
  if (!doc.prayers) {
    state.prayers = null; state.prayersEdited = false; state.editedPetitions = new Set();
  } else {
    const tmpl = allPrayers.find(p => p.id === PRAYER_FOR_CTX[doc.context]);
    const base = tmpl ? JSON.parse(JSON.stringify(tmpl))
                      : { id: PRAYER_FOR_CTX[doc.context], intro: '', response: '', petitions: [] };
    if (doc.prayers.edited) {
      base.intro = doc.prayers.intro; base.response = doc.prayers.response;
      base.petitions = doc.prayers.petitions.slice();
      if (doc.prayers.closing) base.closing = doc.prayers.closing;
      state.prayersEdited = true; state.editedPetitions = new Set(doc.prayers.editedPetitions);
    } else {
      state.prayersEdited = false; state.editedPetitions = new Set();
    }
    state.prayers = base;
  }
  state.selections = selectionsToObjects(doc.selections);
  state.activeSlot = null; state.previewing = null; state.prayerEditing = null; state.pendingRemove = null;
}

// ── View hooks ───────────────────────────────────────────────────────────────
// The host view registers what to re-render after a document load and after a
// draft commit. Defaults are no-ops so core is usable headless (tests).
let _afterLoad = () => {};
let _afterCommit = () => {};
export function configure(opts = {}) {
  if (opts.afterLoad)   _afterLoad = opts.afterLoad;
  if (opts.afterCommit) _afterCommit = opts.afterCommit;
}

// ── localStorage working draft + URL-hash sync ───────────────────────────────
// The same Base62 code drives both.
export const DRAFT_KEY = 'fr.draft.v1';
let currentFuneralId = null;   // library entry the draft derives from (null = unsaved/new)
let _loading = false;          // suppress autosave during boot/load
let _commitTimer = null;

export const getCurrentFuneralId = () => currentFuneralId;
export const setCurrentFuneralId = (v) => { currentFuneralId = v; };
export const setLoading = (v) => { _loading = v; };

export function scheduleCommit() {
  if (_loading) return;
  clearTimeout(_commitTimer);
  _commitTimer = setTimeout(commitNow, 350);
}
export function commitNow() {
  let code;
  try { code = encode(docFromState()); } catch { return; }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ fid: currentFuneralId, code })); } catch {}
  // Preserve history.state (mobile stores overlay depth there) when mirroring the
  // draft into the hash; desktop's state is always null, so this is a no-op there.
  if (location.hash.slice(1) !== code) { try { history.replaceState(history.state, '', '#' + code); } catch {} }
  _afterCommit();
}
export function restoreOnBoot() {
  const h = location.hash.slice(1);
  if (h) { try { applyDocToState(decode(h)); currentFuneralId = null; return; } catch {} }
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) { const { fid, code } = JSON.parse(raw); applyDocToState(decode(code)); currentFuneralId = fid || null; }
  } catch {}
}

// ── Named funeral library (data layer) ───────────────────────────────────────
export const LIB_KEY = 'fr.library.v1';

export function loadLibrary() { try { const a = JSON.parse(localStorage.getItem(LIB_KEY)); return Array.isArray(a) ? a : []; } catch { return []; } }
export function saveLibrary(a) { try { localStorage.setItem(LIB_KEY, JSON.stringify(a)); } catch {} }
export function libFind(id) { return loadLibrary().find(e => e.id === id) || null; }
export function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export function blankDoc() {
  const d = JSON.parse(JSON.stringify(DEFAULT_DOC));
  d.season = isDuringEasterTime() ? 'during' : 'outside';
  return d;
}
// "Dirty" = current work differs from the saved funeral it derives from (or, if
// unsaved, from a blank new funeral). Drives the New/Open guard + Save highlight.
export function isDirty() {
  let cur; try { cur = encode(docFromState()); } catch { return false; }
  if (currentFuneralId) { const e = libFind(currentFuneralId); if (e) return cur !== e.code; }
  return cur !== encode(blankDoc());
}
export function isBlank() {
  try { return encode(docFromState()) === encode(blankDoc()); } catch { return false; }
}

export function loadDoc(doc, fid) {
  _loading = true;
  applyDocToState(doc);
  currentFuneralId = fid;
  _afterLoad();
  _loading = false;
  commitNow();
}
export function newFuneral() { loadDoc(blankDoc(), null); }
export function openFuneral(id) {
  const e = libFind(id);
  if (!e) return;
  try { loadDoc(decode(e.code), id); }
  catch { alert('This saved funeral could not be opened (its data is corrupted).'); }
}
export function saveFuneral(name) {
  const code = encode(docFromState());
  const lib = loadLibrary();
  const now = Date.now();
  let e = currentFuneralId ? lib.find(x => x.id === currentFuneralId) : null;
  if (e) {
    e.name = name;
    if (e.code !== code) { e.code = code; e.modifiedAt = now; }  // only content changes bump modified
  } else {
    e = { id: genId(), name, code, createdAt: now, modifiedAt: now };
    lib.push(e);
    currentFuneralId = e.id;
  }
  saveLibrary(lib);
  commitNow();   // persist draft with the (possibly new) funeral id
}
