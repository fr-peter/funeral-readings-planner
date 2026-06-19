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
// Save / Load / Share codec.
//
// A funeral selection is encoded into a short, URL- and double-click-friendly
// Base62 string prefixed with a schema tag ("FR1"). The same code drives the URL
// hash (#FR1…) and the copy-code box. Design notes (see plan + memory):
//   - reading selections are stored as indices into a stable canonical list,
//     not ID strings (denser, robust to ID-text quirks)
//   - every other field is delta-encoded (defaults omitted; toggles packed into
//     one bitfield); no generic compression
//   - DECODING IS HARDENED: validate-and-reconstruct. We never merge parsed data
//     into live state — we read fixed keys and build a fresh, fully-validated
//     document (enums allow-listed, lengths/counts capped, reading indices checked
//     against the table + slot/context compatibility). JSON.parse only, no eval.
//
// The module deals in *documents* (the user-facing field vocabulary used by
// main.js, with reading ID strings); main.js maps documents <-> live state.

import allReadings from './readings.json' with { type: 'json' };

// ── Canonical reading index ──────────────────────────────────────────────────
// Sorted by id for determinism (independent of array order). Index is opaque;
// if the reading SET ever changes, bump SCHEMA below so old codes are rejected
// rather than silently resolving to the wrong reading.
const CANON_IDS = allReadings.map(r => r.id).slice().sort();
const ID_TO_IDX = new Map(CANON_IDS.map((id, i) => [id, i]));
const READING_BY_ID = new Map(allReadings.map(r => [r.id, r]));

const SCHEMA = 'FR1';
const MAX_CODE_LEN = 8192;     // reject absurd payloads before any work
const MAX_TEXT = 2000;         // per free-text field
const MAX_PETITIONS = 50;
const MAX_SELECTIONS = 60;

const CTX  = ['adult', 'child', 'unbaptized'];
const SZN  = ['outside', 'during'];
const SLOT = ['firstReading', 'psalm', 'secondReading', 'gospel'];
const CTX_FLAG = { adult: 'adult', child: 'child', unbaptized: 'unbaptizedchild' };
const CTX_SLOTS = {
  adult:      ['firstReading', 'psalm', 'secondReading', 'gospel'],
  child:      ['firstReading', 'psalm', 'secondReading', 'gospel'],
  unbaptized: ['firstReading', 'psalm', 'gospel'],
};
const SLOT_TYPE = {
  firstReading: 'first reading', psalm: 'psalm',
  secondReading: 'second reading', gospel: 'gospel',
};
// flag bitfield: bit0 ref, bit1 id, bit2 subhead, bit3 reader, bit4 dropCaps
const DEFAULT_FLAGS = 0b00101; // ref + subhead on by default

export const DEFAULT_DOC = {
  context: 'adult', season: 'outside',
  includeRef: true, includeId: false, includeSubhead: true,
  includeReader: false, dropCaps: false,
  colorMode: 'color', fontSize: 'normal',
  titlePage: false, titleName: '', titleDate: '', titleBlankVerso: false,
  readers: { firstReading: '', psalm: '', secondReading: '', prayers: '' },
  name: '', sex: 'u',
  prayers: null,            // null | { edited, intro, response, petitions[], closing, editedPetitions[] }
  selections: emptySelections(),
};

export function emptySelections() {
  const slots = () => ({ firstReading: null, psalm: null, secondReading: null, gospel: null });
  return {
    adult:      { outside: slots(), during: slots() },
    child:      { outside: slots(), during: slots() },
    unbaptized: { firstReading: null, psalm: null, gospel: null },
  };
}

// ── Base62 (byte-array <-> string), leading-zero safe ─────────────────────────
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function bytesToBase62(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 62;
      carry = (carry / 62) | 0;
    }
    while (carry > 0) { digits.push(carry % 62); carry = (carry / 62) | 0; }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += B62[0];
  for (let i = digits.length - 1; i >= 0; i--) out += B62[digits[i]];
  return out;
}
function base62ToBytes(str) {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = B62.indexOf(str[i]);
    if (val < 0) throw new Error('invalid character in code');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 62;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === B62[0]; i++) zeros++;
  const out = new Array(zeros).fill(0);
  for (let i = bytes.length - 1; i >= 0; i--) out.push(bytes[i]);
  return Uint8Array.from(out);
}

// ── Encode ────────────────────────────────────────────────────────────────────
function buildCompact(doc) {
  const c = {};
  c.c = Math.max(0, CTX.indexOf(doc.context));     // always present
  c.s = doc.season === 'during' ? 1 : 0;           // always present
  const f = (doc.includeRef ? 1 : 0) | (doc.includeId ? 2 : 0) | (doc.includeSubhead ? 4 : 0)
          | (doc.includeReader ? 8 : 0) | (doc.dropCaps ? 16 : 0);
  if (f !== DEFAULT_FLAGS) c.f = f;
  if (doc.colorMode === 'bw') c.col = 1;
  if (doc.fontSize === 'large') c.ft = 1;
  if (doc.name) c.n = String(doc.name);
  if (doc.sex === 'm') c.x = 1; else if (doc.sex === 'f') c.x = 2;
  if (doc.titlePage) c.t = [String(doc.titleName || ''), String(doc.titleDate || ''), doc.titleBlankVerso ? 1 : 0];
  const rd = doc.readers || {};
  if (rd.firstReading || rd.psalm || rd.secondReading || rd.prayers)
    c.rd = [rd.firstReading || '', rd.psalm || '', rd.secondReading || '', rd.prayers || ''];
  if (doc.prayers) {
    const p = doc.prayers;
    c.p = p.edited
      ? [String(p.intro || ''), String(p.response || ''), (p.petitions || []).map(String),
         String(p.closing || ''), (p.editedPetitions || []).map(Number)]
      : 0;
  }
  const sel = [];
  for (const ctx of CTX) {
    const ci = CTX.indexOf(ctx);
    if (ctx === 'unbaptized') {
      for (const slot of CTX_SLOTS.unbaptized) {
        const id = doc.selections?.unbaptized?.[slot];
        if (id && ID_TO_IDX.has(id)) sel.push([ci, 0, SLOT.indexOf(slot), ID_TO_IDX.get(id)]);
      }
    } else {
      for (const szn of SZN) {
        for (const slot of CTX_SLOTS[ctx]) {
          const id = doc.selections?.[ctx]?.[szn]?.[slot];
          if (id && ID_TO_IDX.has(id)) sel.push([ci, SZN.indexOf(szn), SLOT.indexOf(slot), ID_TO_IDX.get(id)]);
        }
      }
    }
  }
  if (sel.length) c.r = sel;
  return c;
}

export function encode(doc) {
  const json = JSON.stringify(buildCompact(doc));
  return SCHEMA + bytesToBase62(new TextEncoder().encode(json));
}

// Canonical, stable string for dirty-tracking / equality (not the share code).
export function serialize(doc) {
  return JSON.stringify(buildCompact(doc));
}

// ── Decode (hardened) ──────────────────────────────────────────────────────────
const clampStr = (v, max = MAX_TEXT) => (typeof v === 'string' ? v : '').slice(0, max);
const asInt = v => (Number.isInteger(v) ? v : 0);

// Accepts a bare code or a full pasted URL (anything after the last '#').
export function stripToCode(input) {
  let s = String(input || '').trim();
  if (s.includes('#')) s = s.slice(s.lastIndexOf('#') + 1);
  return s.trim();
}

export function decode(input) {
  const code = stripToCode(input);
  if (code.length < SCHEMA.length || code.length > MAX_CODE_LEN) throw new Error('Not a valid code');
  if (code.slice(0, SCHEMA.length) !== SCHEMA) throw new Error('Unrecognized code version');
  const body = code.slice(SCHEMA.length);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base62ToBytes(body)));
  } catch {
    throw new Error('Corrupted code');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Corrupted code');

  // Build a FRESH document from validated primitives — never merge parsed in.
  const doc = structuredClone(DEFAULT_DOC);
  doc.context = CTX[asInt(parsed.c)] || 'adult';
  doc.season  = asInt(parsed.s) === 1 ? 'during' : 'outside';
  const f = Number.isInteger(parsed.f) ? parsed.f : DEFAULT_FLAGS;
  doc.includeRef     = !!(f & 1);
  doc.includeId      = !!(f & 2);
  doc.includeSubhead = !!(f & 4);
  doc.includeReader  = !!(f & 8);
  doc.dropCaps       = !!(f & 16);
  doc.colorMode = parsed.col === 1 ? 'bw' : 'color';
  doc.fontSize  = parsed.ft === 1 ? 'large' : 'normal';
  doc.name = clampStr(parsed.n);
  doc.sex  = parsed.x === 1 ? 'm' : parsed.x === 2 ? 'f' : 'u';

  if (Array.isArray(parsed.t)) {
    doc.titlePage = true;
    doc.titleName = clampStr(parsed.t[0]);
    doc.titleDate = clampStr(parsed.t[1], 100);
    doc.titleBlankVerso = !!parsed.t[2];
  }
  if (Array.isArray(parsed.rd)) {
    doc.readers = {
      firstReading: clampStr(parsed.rd[0]), psalm: clampStr(parsed.rd[1]),
      secondReading: clampStr(parsed.rd[2]), prayers: clampStr(parsed.rd[3]),
    };
  }
  if (parsed.p === 0) {
    doc.prayers = { edited: false, intro: '', response: '', petitions: [], closing: '', editedPetitions: [] };
  } else if (Array.isArray(parsed.p)) {
    const pet = Array.isArray(parsed.p[2]) ? parsed.p[2].slice(0, MAX_PETITIONS).map(x => clampStr(x)) : [];
    const ed = Array.isArray(parsed.p[4])
      ? parsed.p[4].map(asInt).filter(i => i >= 0 && i < pet.length) : [];
    doc.prayers = {
      edited: true,
      intro: clampStr(parsed.p[0]), response: clampStr(parsed.p[1]),
      petitions: pet, closing: clampStr(parsed.p[3]), editedPetitions: ed,
    };
  }

  if (Array.isArray(parsed.r)) {
    for (const entry of parsed.r.slice(0, MAX_SELECTIONS)) {
      if (!Array.isArray(entry)) continue;
      const ci = asInt(entry[0]), si = asInt(entry[1]), sl = asInt(entry[2]), idx = asInt(entry[3]);
      const ctx = CTX[ci], slot = SLOT[sl], id = CANON_IDS[idx];
      if (!ctx || !slot || !id) continue;
      const reading = READING_BY_ID.get(id);
      if (!reading) continue;
      if (reading.type !== SLOT_TYPE[slot]) continue;          // slot/type compatibility
      if (reading[CTX_FLAG[ctx]] !== true) continue;           // context compatibility
      if (!CTX_SLOTS[ctx].includes(slot)) continue;            // e.g. no secondReading for unbaptized
      if (ctx === 'unbaptized') doc.selections.unbaptized[slot] = id;
      else doc.selections[ctx][si === 1 ? 'during' : 'outside'][slot] = id;
    }
  }
  return doc;
}

