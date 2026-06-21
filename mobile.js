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
// Mobile bundle entry — Home screen (P2). Loaded only on phones, via boot.js.
// Builds its own DOM and drives it through the shared funeral-core.js model.
//
// P2 delivers: the slot list (display + remove), the full-screen hamburger
// (context / season / appearance / theme / New), and the persistent
// Save · Preview · Share bar. Save and Share are functional; +Add (P3),
// Preview (P4) and Open-from-library (P5) are stubbed with a toast. Loading a
// funeral still works in P2 via a shared link's URL hash (restoreOnBoot).
import './mobile.css';
import {
  state, currentSel, poolFor, orderedSlotKeys, groupBodyLines, CTX_SLOTS, SLOT_LABEL, PRAYER_FOR_CTX,
  makePrayersForContext, configure, scheduleCommit, commitNow, restoreOnBoot, isDirty, isBlank,
  getCurrentFuneralId, setCurrentFuneralId, loadLibrary, saveLibrary, libFind,
  saveFuneral, newFuneral, openFuneral, loadDoc, docFromState,
  shareUrl, emailShare,
} from './funeral-core.js';
import { applyDropCap, applyDropCapShapes } from './dropcap.js';
import { exportAll, importAll, fitExcerpts, fmtDate } from './library-io.js';
import { currentTheme, applyTheme, initTheme } from './theme.js';
import { encode, decode } from './share.js';
import { expandRef, formatRef, formatRefUI, toUiResponsum, normalizeBookRefs } from './books.js';
import { easterSeasonLabel } from './easter.js';

// search.js statically imports the ~MB transformers embedder. Load it lazily on
// first use (dynamic import → its own chunk) so the initial mobile bundle stays
// tiny; warm it when the Add view opens so it's ready by the time the user types.
let _searchMod = null;
function searchModule() {
  if (!_searchMod) _searchMod = import('./search.js').then(m => { m.preloadEmbedder(); return m; });
  return _searchMod;
}

// Theme (device-local) lives in the shared theme.js; mobile refreshes its menu
// toggle via updateThemeButton (also on live OS-theme changes while unset).
initTheme(updateThemeButton);

// ── Labels ───────────────────────────────────────────────────────────────────
const CTX_LABEL    = { adult: 'General use', child: 'Baptized Child', unbaptized: 'Unbaptized Child' };
const SEASON_LABEL = { outside: 'Outside Easter Time', during: 'During Easter Time' };
const APPEARANCE_TOGGLES = [
  ['includeSubhead', 'Include section titles'],
  ['includeRef',     'Include scripture reference'],
  ['includeId',      'Include lectionary number'],
  ['includeReader',  'Include reader'],
  ['dropCaps',       'Drop caps'],
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Action-bar / preview icons (defined here, before the shell HTML below, which runs at
// load). Feather-style 24-box to match ICON_GEAR et al.; Save/Share mirror the desktop
// funeral-bar glyphs (index.html), Eye = Preview, Printer = Print/Save-PDF.
const ICON_SAVE  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4M5 20h14"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h9v9M18 6L6 18"/></svg>`;
const ICON_EYE   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_PRINT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1M6 14h12v7H6z"/></svg>`;

// ── Shell ──────────────────────────────────────────────────────────────────
const root = document.createElement('div');
root.id = 'm-root';
root.innerHTML = `
  <header class="m-topbar">
    <button class="m-icon-btn" id="m-menu-open" aria-label="Menu">
      <span class="m-burger"></span>
    </button>
    <div class="m-topbar-title">Funeral Readings Planner</div>
    <div class="m-topbar-spacer"></div>
  </header>

  <main class="m-slots" id="m-slots"></main>

  <nav class="m-actionbar">
    <button class="m-bar-btn" id="m-save">${ICON_SAVE}<span>Save</span></button>
    <button class="m-bar-btn m-bar-btn--primary" id="m-preview">${ICON_EYE}<span>Preview</span></button>
    <button class="m-bar-btn" id="m-share">${ICON_SHARE}<span>Share</span></button>
  </nav>

  <div class="m-menu" id="m-menu">
    <div class="m-menu-head">
      <div class="m-menu-title">Menu</div>
      <button class="m-icon-btn" id="m-menu-close" aria-label="Close menu">✕</button>
    </div>
    <div class="m-menu-body" id="m-menu-body"></div>
  </div>
`;
document.body.appendChild(root);

const $ = (sel) => root.querySelector(sel);
const slotsEl = $('#m-slots');
const menuEl  = $('#m-menu');
const menuBody = $('#m-menu-body');
menuEl.inert = true;   // closed at boot

// ── Slot list ──────────────────────────────────────────────────────────────
// Inline reader row (Include reader on) — applies to first reading, psalm,
// second reading, and prayers; never the gospel or title.
function readerRowHTML(key) {
  const val = state.readers[key] || '';
  return `
    <div class="m-reader-row">
      <span class="m-reader-label">Reader’s name</span>
      <div class="m-reader-field">
        <input class="m-reader-input" data-reader="${key}" value="${esc(val)}"
               placeholder="Optional" autocomplete="off" enterkeyhint="done">
        <button type="button" class="m-field-clear${val ? ' visible' : ''}" data-reader-clear="${key}" aria-label="Clear" tabindex="-1">×</button>
      </div>
    </div>`;
}
function readingRowHTML(slot, r) {
  const label = SLOT_LABEL[slot];
  if (r) {
    const reader = (state.includeReader && slot !== 'gospel') ? readerRowHTML(slot) : '';
    return `
      <div class="m-slot m-slot--filled" data-slot="${slot}">
        <div class="m-slot-top">
          <div class="m-slot-main">
            <div class="m-slot-label">${esc(label)}</div>
            <div class="m-slot-ref">${esc(formatRefUI(expandRef(r.ref)))}</div>
          </div>
          <div class="m-slot-id">${esc(r.id)}</div>
          <button class="m-slot-x" data-remove="${slot}" aria-label="Remove ${esc(label)}">✕</button>
        </div>
        ${reader}
      </div>`;
  }
  return `
    <button class="m-slot m-slot--empty" data-add="${slot}">
      <span class="m-slot-plus">+</span><span>Add ${esc(label)}</span>
    </button>`;
}
// Title Page (name/date) and Prayers (name/sex) are configured by tapping the
// filled card → a config sheet. The prayers card also carries a reader row.
function specialRowHTML(kind, label, filled) {
  if (filled) {
    const reader = (kind === 'prayers' && state.includeReader) ? readerRowHTML('prayers') : '';
    return `
      <div class="m-slot m-slot--filled m-slot--special" data-special="${kind}">
        <div class="m-slot-top">
          <div class="m-slot-main"><div class="m-slot-label">${esc(label)}</div></div>
          <button class="m-slot-x" data-remove-special="${kind}" aria-label="Remove ${esc(label)}">✕</button>
        </div>
        ${reader}
      </div>`;
  }
  return `
    <button class="m-slot m-slot--empty" data-add-special="${kind}">
      <span class="m-slot-plus">+</span><span>Add ${esc(label)}</span>
    </button>`;
}
function renderSlots() {
  scheduleCommit();
  const sel = currentSel();
  const rows = [specialRowHTML('title', 'Title Page', state.titlePage)];
  for (const slot of CTX_SLOTS[state.context]) rows.push(readingRowHTML(slot, sel[slot]));
  rows.push(specialRowHTML('prayers', 'Prayers of the Faithful', !!state.prayers));
  slotsEl.innerHTML = rows.join('');
}
function addSpecial(kind) {
  if (kind === 'title') state.titlePage = true;
  else if (kind === 'prayers') {
    state.prayers = makePrayersForContext();
    state.prayersEdited = false; state.editedPetitions = new Set(); state.pendingRemove = null;
  }
  renderSlots(); updateBar();
}
function removeSpecial(kind) {
  if (kind === 'title') state.titlePage = false;
  else if (kind === 'prayers') {
    state.prayers = null; state.prayersEdited = false; state.editedPetitions = new Set(); state.pendingRemove = null;
  }
  renderSlots(); updateBar();
}

// ── Menu (built once; controls reflect + mutate state) ───────────────────────
const ICON_NEW  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>`;
const ICON_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.2l1.6 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_SUN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
// Inline so iOS doesn't substitute a colour-emoji ⚙ (U+2699). Feather "settings".
const ICON_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function buildMenu() {
  menuBody.innerHTML = `
    <section class="m-menu-section m-menu-top">
      <button class="m-quick" id="m-new">${ICON_NEW}<span>New</span></button>
      <button class="m-quick" id="m-open">${ICON_OPEN}<span>Open</span></button>
      <button class="m-quick" id="m-theme-btn"><span class="m-theme-ico"></span><span class="m-theme-lbl"></span></button>
    </section>

    <section class="m-menu-section">
      <div class="m-menu-h-row">
        <h2 class="m-menu-h">Readings</h2>
        <button class="m-help" data-help="ctx" aria-label="About the funeral readings">?</button>
      </div>
      <div class="m-pills" id="m-ctx">
        ${Object.entries(CTX_LABEL).map(([k, v]) =>
          `<button class="m-pill" data-ctx="${k}">${v}</button>`).join('')}
      </div>
    </section>

    <section class="m-menu-section">
      <div class="m-menu-h-row">
        <h2 class="m-menu-h">Liturgical season</h2>
        <button class="m-help" data-help="season" aria-label="About the liturgical season">?</button>
      </div>
      <div class="m-pills" id="m-season">
        ${Object.entries(SEASON_LABEL).map(([k, v]) =>
          `<button class="m-pill" data-season="${k}">${v}</button>`).join('')}
      </div>
    </section>

    <section class="m-menu-section">
      <h2 class="m-menu-h">Print settings</h2>
      ${printSettingsHTML()}
    </section>
  `;
  syncMenu();
}

// The print/output controls, shared verbatim by the hamburger menu and the
// Preview screen's settings sheet so the two can never drift. Markup only — the
// rows reuse the global .m-row/.m-switch/.m-seg styles; state is reflected by
// syncPrintSettings() and applied by applyToggle()/applySeg().
function printSettingsHTML() {
  return `
    ${APPEARANCE_TOGGLES.map(([key, label]) => `
      <label class="m-row">
        <span class="m-row-label">${label}</span>
        <span class="m-switch"><input type="checkbox" data-toggle="${key}"><span class="m-switch-track"></span></span>
      </label>`).join('')}
    <div class="m-row">
      <span class="m-row-label">Font size</span>
      <div class="m-seg" data-seg="fontSize">
        <button data-val="normal">Normal</button><button data-val="large">Large</button>
      </div>
    </div>
    <div class="m-row">
      <span class="m-row-label">Output</span>
      <div class="m-seg" data-seg="colorMode">
        <button data-val="color">Color</button><button data-val="bw">B&amp;W</button>
      </div>
    </div>`;
}

// Reflect live state into print-settings controls within `root` (menu or sheet).
function syncPrintSettings(root) {
  root.querySelectorAll('input[data-toggle]').forEach(inp =>
    inp.checked = !!state[inp.dataset.toggle]);
  root.querySelectorAll('.m-seg[data-seg]').forEach(seg => {
    const val = state[seg.dataset.seg];
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
  });
}

// Apply a single print-settings change to state (shared by menu + Preview sheet).
function applyToggle(key, checked) {
  state[key] = checked;
  if (key === 'includeReader') renderSlots();   // show/hide reader rows on Home
  scheduleCommit(); updateBar();
}
function applySeg(segKey, val) {
  state[segKey] = val;
  scheduleCommit();
}
function updateThemeButton() {
  const btn = menuBody.querySelector('#m-theme-btn');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  btn.querySelector('.m-theme-ico').innerHTML = dark ? ICON_SUN : ICON_MOON;   // icon of the theme you'll switch TO
  btn.querySelector('.m-theme-lbl').textContent = dark ? 'Light' : 'Dark';
}
// Tap-to-open info (mobile has no hover tooltips) — mirrors the desktop ? popovers.
function openHelp(kind) {
  let title, body;
  if (kind === 'ctx') {
    title = 'Readings';
    body = 'The Church provides a set of readings intended for general use, with special readings for the funeral of a baptized child and for a child who died before baptism. Select the set appropriate to this funeral.';
  } else {
    const { easter, pentecost } = easterSeasonLabel();
    title = 'Liturgical season';
    body = `For the readings for general use and for a baptized child, the Church provides different first readings during Easter time and outside Easter time. If the funeral date falls between ${easter} and ${pentecost}, select <strong>During Easter Time</strong>; otherwise <strong>Outside Easter Time</strong> is correct.`;
  }
  // body is trusted app text (incl. <strong> + generated dates) — inserted as HTML.
  openSheet({ title, bodyHTML: `<p class="m-sheet-sub">${body}</p>` });
}

// Reflect live state into the menu controls (mirrors desktop syncControlsToState).
function syncMenu() {
  menuBody.querySelectorAll('#m-ctx .m-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.ctx === state.context));
  menuBody.querySelectorAll('#m-season .m-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.season === state.season));
  // Season is meaningless for unbaptized children (single set of readings).
  menuBody.querySelector('#m-season').classList.toggle('m-disabled', state.context === 'unbaptized');
  syncPrintSettings(menuBody);
  updateThemeButton();
}

// ── Action bar state ─────────────────────────────────────────────────────────
// Anything that would render in the preview (mirrors previewDocHTML's emptiness
// check + desktop's print-btn enable condition). Distinct from isBlank(), which is
// also false when only a non-content setting differs from the blank default.
function hasPreviewContent() {
  const sel = currentSel();
  return !!state.titlePage || !!state.prayers || orderedSlots().some(s => sel[s]);
}

function updateBar() {
  const save = $('#m-save');
  save.disabled = isBlank() && !getCurrentFuneralId();
  save.classList.toggle('m-dirty', isDirty());
  const hasContent = hasPreviewContent();
  $('#m-preview').disabled = !hasContent;   // nothing to preview yet
  $('#m-share').disabled   = !hasContent;   // nothing to share yet
}

function syncAll() { renderSlots(); syncMenu(); updateBar(); }

// ── Menu open/close ──────────────────────────────────────────────────────────
// `inert` (not aria-hidden) so a focused control inside the closed menu is never
// hidden from assistive tech — inert also removes the subtree from the tab order
// and drops focus.
// ── Back-button / overlay history ─────────────────────────────────────────────
// Every overlay (menu, Add, browse sheet, Preview, Library, bottom sheets) pushes
// a history entry. The system Back button — or an on-screen close — rewinds
// history; popstate tears the top overlay(s) down and re-mirrors live state to the
// URL hash (going back would otherwise revert it). So Android's Back closes the
// open layer instead of leaving the app.
const overlayStack = [];
function pushOverlay(teardown) {
  overlayStack.push(teardown);
  history.pushState({ ovDepth: overlayStack.length }, '');
}
function closeTop(n = 1) {
  const k = Math.min(n, overlayStack.length);
  if (k > 0) history.go(-k);   // → popstate runs the teardown(s)
}
function closeAllOverlays() { closeTop(overlayStack.length); }
// Close every overlay, then run `fn` once they've finished tearing down. Opening a
// new overlay must wait for the close to settle: closeTop() goes through
// history.go() (async popstate), so synchronously pushing a new history entry
// afterwards would race the traversal. Instead we stash `fn` and fire it from the
// popstate handler once the stack is empty (pushState inside popstate is safe).
let _afterClose = null;
function closeAllThen(fn) {
  if (overlayStack.length === 0) { fn(); return; }
  _afterClose = fn;
  closeAllOverlays();
}
window.addEventListener('popstate', (e) => {
  const target = (e.state && e.state.ovDepth) || 0;
  let closed = false;
  while (overlayStack.length > target) {
    try { overlayStack.pop()(); } catch {}
    closed = true;
  }
  if (closed) commitNow();   // restore the URL hash to live state after rewinding
  if (_afterClose && overlayStack.length === 0) { const fn = _afterClose; _afterClose = null; fn(); }
});

function openMenu()  { syncMenu(); menuEl.classList.add('open'); menuEl.inert = false; pushOverlay(teardownMenu); }
function teardownMenu() { menuEl.classList.remove('open'); menuEl.inert = true; menuBody.scrollTop = 0; }

// Factory for the transient overlays (Add / Browse / Preview / Library) — all of
// which are created on open and destroyed on close. getEl() returns the node to
// remove; clear() nulls the module-level ref(s) and any extra state. Shape: bail
// if absent → capture el → clear refs → drop 'open' → remove after the 240ms
// transition. (The menu is reused rather than rebuilt, so teardownMenu is bespoke.)
function makeTeardown(getEl, clear) {
  return () => {
    const el = getEl();
    if (!el) return;
    clear();
    el.classList.remove('open');
    setTimeout(() => el.remove(), 240);
  };
}

// ── Model mutations (mirror desktop switchContext / switchSeason / removeSlot) ─
function setContext(ctx) {
  if (state.prayers && state.prayers.id !== PRAYER_FOR_CTX[ctx]) state.prayers = null;
  state.context = ctx;
  syncAll();
}
function setSeason(season) {
  if (state.context === 'unbaptized') return;     // no season distinction
  const from = currentSel();
  const to = state.selections[state.context][season];
  to.psalm = from.psalm; to.secondReading = from.secondReading; to.gospel = from.gospel;
  state.season = season; state.paschaltide = season === 'during';
  syncAll();
}
function removeSlot(slot) { currentSel()[slot] = null; renderSlots(); updateBar(); }

// ── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg) {
  let t = root.querySelector('.m-toast');
  if (!t) { t = document.createElement('div'); t.className = 'm-toast'; root.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

// ── Bottom sheet helper ──────────────────────────────────────────────────────
function openSheet({ title, bodyHTML, onMount }) {
  const ov = document.createElement('div');
  ov.className = 'm-sheet-overlay';
  ov.innerHTML = `
    <div class="m-sheet" role="dialog" aria-label="${esc(title)}">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-head">
        <div class="m-sheet-title">${esc(title)}</div>
        <button class="m-icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="m-sheet-body">${bodyHTML}</div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('open'));
  const teardown = () => { ov.classList.remove('open'); setTimeout(() => ov.remove(), 220); };
  pushOverlay(teardown);
  const close = () => closeTop(1);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  attachSheetDismiss(ov.querySelector('.m-sheet'), close);
  if (onMount) onMount(ov.querySelector('.m-sheet-body'), close);
  return close;
}
// Swipe-down-to-dismiss for the short bottom sheets (these don't scroll, so any
// downward drag dismisses). Drags that begin in a text field are ignored so the
// caret and selection still work.
function attachSheetDismiss(sheet, close) {
  let sy = 0, dy = 0, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea')) { dragging = false; return; }
    sy = e.touches[0].clientY; dy = 0; dragging = true;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - sy;
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) close();
  });
}

// ── Title Page & Prayers config sheets ───────────────────────────────────────
function openTitleConfig() {
  openSheet({
    title: 'Title page',
    bodyHTML: `
      <label class="m-field-label">Name of the deceased</label>
      <input class="m-input" id="m-title-name" value="${esc(state.titleName)}" placeholder="e.g. Mary Smith" autocomplete="off" enterkeyhint="done">
      <label class="m-field-label">Date of the funeral</label>
      <input class="m-input" id="m-title-date" value="${esc(state.titleDate)}" placeholder="e.g. 14 June 2026" autocomplete="off" enterkeyhint="done">
      <label class="m-row" style="margin-top:16px">
        <span class="m-row-label">Add blank page after title</span>
        <span class="m-switch"><input type="checkbox" id="m-title-verso" ${state.titleBlankVerso ? 'checked' : ''}><span class="m-switch-track"></span></span>
      </label>`,
    onMount(body) {
      body.querySelector('#m-title-name').addEventListener('input', (e) => { state.titleName = e.target.value; scheduleCommit(); });
      body.querySelector('#m-title-date').addEventListener('input', (e) => { state.titleDate = e.target.value; scheduleCommit(); });
      body.querySelector('#m-title-verso').addEventListener('change', (e) => { state.titleBlankVerso = e.target.checked; scheduleCommit(); });
    },
  });
}
function openPrayersConfig() {
  openSheet({
    title: 'Prayers of the Faithful',
    bodyHTML: `
      <p class="m-sheet-sub">The petitions name the deceased. Set the name and pronouns to use.</p>
      <label class="m-field-label">Name</label>
      <input class="m-input" id="m-pf-name" value="${esc(state.name)}" placeholder="as used in the petitions" autocomplete="off" enterkeyhint="done">
      <label class="m-field-label">Pronouns</label>
      <div class="m-seg m-seg--wide" id="m-pf-sex">
        <button data-val="m">Male</button><button data-val="u">Unspecified</button><button data-val="f">Female</button>
      </div>`,
    onMount(body) {
      body.querySelector('#m-pf-name').addEventListener('input', (e) => { state.name = e.target.value; scheduleCommit(); });
      const seg = body.querySelector('#m-pf-sex');
      const sync = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === state.sex));
      sync();
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-val]');
        if (!b) return;
        state.sex = b.dataset.val; sync(); scheduleCommit();
      });
    },
  });
}

// ── Save ─────────────────────────────────────────────────────────────────────
// Save the funeral, then optionally run `after` (used by the dirty-guard's
// "Save & continue"). A named funeral saves silently; a new one prompts for a name.
function saveThen(after) {
  const fid = getCurrentFuneralId();
  const existing = fid ? libFind(fid) : null;
  if (existing) { saveFuneral(existing.name); toast('Saved ✓'); updateBar(); if (after) after(); return; }
  const def = state.titleName || state.name || '';
  openSheet({
    title: 'Save funeral',
    bodyHTML: `
      <p class="m-sheet-sub">Give this funeral a name so you can find it later.</p>
      <input class="m-input" id="m-save-name" placeholder="e.g. Mary Smith" value="${esc(def)}" autocomplete="off" enterkeyhint="done">
      <button class="m-btn m-btn--primary" id="m-save-confirm">Save</button>`,
    onMount(body, close) {
      const inp = body.querySelector('#m-save-name');
      inp.focus();
      const go = () => {
        const name = inp.value.trim();
        if (!name) { inp.focus(); return; }
        saveFuneral(name); updateBar(); toast('Saved ✓');
        // `after` (the dirty-guard action) calls closeAllOverlays(), which tears
        // down THIS save sheet too — so don't also close() it, or we'd queue two
        // history traversals and over-navigate. Standalone save closes its sheet.
        if (after) after(); else close();
      };
      body.querySelector('#m-save-confirm').addEventListener('click', go);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  });
}
function onSave() { saveThen(null); }

// ── Share ────────────────────────────────────────────────────────────────────
function onShare() {
  let code;
  try { code = encode(docFromState()); } catch { toast('Nothing to share yet.'); return; }
  const url = shareUrl(code);
  openSheet({
    title: 'Share this funeral',
    bodyHTML: `
      <p class="m-sheet-sub">Anyone with this link can open and print these readings.</p>
      <div class="m-sheet-row">
        <button class="m-btn m-btn--primary" id="m-copy-link">Copy link</button>
        <button class="m-btn" id="m-email">Email</button>
      </div>`,
    onMount(body) {
      body.querySelector('#m-copy-link').addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied!'), () => toast('Copy failed'));
        else toast('Copy not supported');
      });
      body.querySelector('#m-email').addEventListener('click', () => emailShare(code));
    },
  });
}

// ── New (dirty-guarded) ──────────────────────────────────────────────────────
// Run an action, guarding unsaved changes behind a confirm sheet first.
function guardThen(action) {
  if (!isDirty()) { action(); return; }
  openSheet({
    title: 'Unsaved changes',
    bodyHTML: `
      <p class="m-sheet-sub">You have unsaved changes. Save them first, or discard them and continue.</p>
      <button class="m-btn m-btn--confirm" id="m-guard-save">Save &amp; continue</button>
      <div class="m-sheet-row">
        <button class="m-btn" data-close>Cancel</button>
        <button class="m-btn m-btn--danger-outline" id="m-guard-go">Discard</button>
      </div>`,
    onMount(body) {
      // Discard / Save both run the action, which closes all overlays (incl. this
      // sheet); Cancel / backdrop use the sheet's own close (closeTop(1)).
      body.querySelector('#m-guard-go').addEventListener('click', action);
      // Save & continue: save (prompting for a name if new), then run the action.
      body.querySelector('#m-guard-save').addEventListener('click', () => saveThen(action));
    },
  });
}
function onNew() { guardThen(() => { newFuneral(); closeAllThen(openNewFuneralOverlay); }); }

// ── New-funeral overlay (mobile onboarding) ──────────────────────────────────
// Shown on a blank boot and on every +New. Surfaces the two reading-set-defining
// choices (context + season) that otherwise live in the menu, so a first-time
// (lay) user sets them deliberately instead of silently inheriting defaults.
// Season is pre-set from today's date (blankDoc already did this) and greys out
// for an unbaptized child (no season distinction), mirroring the menu.
//
// Staged: selections apply only on Accept. Any dismissal (X / backdrop / swipe /
// Back) leaves state untouched — i.e. keeps the pre-existing defaults (adult +
// date-derived season for a fresh funeral; the restored values on a blank boot).
function openNewFuneralOverlay() {
  let pendingCtx    = state.context;
  let pendingSeason = state.season;
  const { easter, pentecost } = easterSeasonLabel();
  openSheet({
    title: 'New funeral',
    bodyHTML: `
      <div class="nf-group">
        <h2 class="m-menu-h">Readings</h2>
        <p class="m-sheet-sub">The Church provides a set of readings intended for general use, with special readings for the funeral of a baptized child and for a child who died before baptism.</p>
        <div class="m-pills" id="nf-ctx">
          ${Object.entries(CTX_LABEL).map(([k, v]) =>
            `<button class="m-pill" data-ctx="${k}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="nf-group">
        <h2 class="m-menu-h">Liturgical season</h2>
        <p class="m-sheet-sub">The season has been set based on today’s date. If the funeral falls between ${esc(easter)} and ${esc(pentecost)}, choose <strong>During Easter Time</strong>; otherwise <strong>Outside Easter Time</strong>.</p>
        <div class="m-pills" id="nf-season">
          ${Object.entries(SEASON_LABEL).map(([k, v]) =>
            `<button class="m-pill" data-season="${k}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="nf-foot"><button class="m-btn m-btn--confirm" id="nf-accept">Accept</button></div>`,
    onMount(body, close) {
      body.closest('.m-sheet').classList.add('nf-sheet');   // scope the overlay's tighter spacing
      const ctxWrap    = body.querySelector('#nf-ctx');
      const seasonWrap = body.querySelector('#nf-season');
      const sync = () => {
        ctxWrap.querySelectorAll('[data-ctx]').forEach(b =>
          b.classList.toggle('active', b.dataset.ctx === pendingCtx));
        seasonWrap.querySelectorAll('[data-season]').forEach(b =>
          b.classList.toggle('active', b.dataset.season === pendingSeason));
        seasonWrap.classList.toggle('m-disabled', pendingCtx === 'unbaptized');
      };
      sync();
      ctxWrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ctx]'); if (!b) return;
        pendingCtx = b.dataset.ctx; sync();
      });
      seasonWrap.addEventListener('click', (e) => {
        if (pendingCtx === 'unbaptized') return;   // no season distinction
        const b = e.target.closest('[data-season]'); if (!b) return;
        pendingSeason = b.dataset.season; sync();
      });
      body.querySelector('#nf-accept').addEventListener('click', () => {
        setContext(pendingCtx);
        if (pendingCtx !== 'unbaptized') setSeason(pendingSeason);
        close();
      });
    },
  });
}

// Content-based "blank" test for the boot prompt: true when none of the funeral's
// *content* exists (title page, any reading in any context/season, prayers of the
// faithful). Deliberately ignores print settings / context / season, so tweaking a
// toggle and reopening still counts as blank (unlike isBlank(), which compares the
// whole doc). A restored share-link / saved funeral has readings, so it won't fire.
function anySlotFilled(node) {
  return Object.values(node).some(v =>
    (v && typeof v === 'object') ? anySlotFilled(v) : Boolean(v));
}
function funeralHasContent() {
  if (state.titlePage || state.titleName.trim() || state.titleDate.trim()) return true;
  if (state.prayers) return true;
  return anySlotFilled(state.selections);
}

// Drop-cap engine (applyDropCap / applyDropCapShapes + sizing constants and the
// per-letter offset table) now lives in the shared ./dropcap.js module, imported
// above and used by both this mobile bundle and the desktop main.js. The mobile
// preview measure and letter print size share the calibrated em-relative values,
// so no mobile-specific re-calibration is needed.

// ── Clean reading render (browse sheet) ──────────────────────────────────────
// NOT print-faithful: EB Garamond body, sense-lines preserved with a hanging
// indent for narrow-screen wraps, no drop cap / red ref / print layout. Inline
// .sc small-caps spans in the data pass through (styled by the desktop tokens).
const fixEmDash = (s) => s.replace(/—/g, '⁠—');   // word-joiner: no break before em-dash
function senseLines(text) {
  return text.split('\n').filter(l => l.trim())
    .map(l => `<div class="mr-line">${fixEmDash(l)}</div>`).join('');
}
// firstIndent indents the ℟ line (the cantor response), matching desktop.
function responseLines(text, firstIndent) {
  return text.split('\n').filter(l => l.trim()).map((l, i) => {
    const content = i === 0 ? `<span class="mr-glyph">℟.</span> ${fixEmDash(l)}` : fixEmDash(l);
    const cls = (i === 0 && firstIndent) ? 'mr-line-indent' : 'mr-line';
    return `<div class="${cls}">${content}</div>`;
  }).join('');
}
// Drop-cap body lines: first line gets the cap, the second the zero-width spacer,
// the rest plain; joined with <br> so the first two flow around the float. Used
// by the reading head, the psalm first stanza, and prayer paragraphs (mirrors
// desktop renderReadingHtml / renderPsalmBody / renderPrayerText). `text` may
// already contain markup (e.g. resolved prayer spans); applyDropCap walks it.
function dropCapLines(text) {
  return text.split('\n').filter(l => l.trim()).map((l, i) => {
    const fixed = fixEmDash(l);
    if (i === 0) return applyDropCap(fixed);
    if (i === 1) return `<span class="r-drop-2nd"></span>${fixed}`;
    return fixed;
  }).join('<br>');
}
// dropCap renders the print-faithful head/tail drop-cap structure (assembled
// preview + print only). The browse sheet calls renderReadingClean(r) with no
// dropCap, so it stays flat and never needs the applyDropCapShapes pass.
function renderReadingClean(r, dropCap = false) {
  if (r.type === 'psalm') {
    // Antiphon shown twice (plain, then ℟ + indent), then each stanza followed
    // by the response — mirrors the desktop psalm layout.
    const stanzas = r.text.split('{{response}}').map(s => s.trim()).filter(Boolean);
    const parts = [
      `<div class="mr-response">${senseLines(r.response)}</div>`,
      `<div class="mr-response-cantor">${responseLines(r.response, true)}</div>`,
      `<div class="mr-gap"></div>`,
    ];
    // Each stanza + the response printed after it is one unit (never split across
    // a page in print). The drop cap (when enabled) goes on the FIRST stanza's
    // first line, matching desktop renderPsalmBody.
    stanzas.forEach((st, si) => {
      const stanzaHTML = (si === 0 && dropCap)
        ? `<div class="mr-stanza r-body-dropcap">${dropCapLines(st)}</div>`
        : `<div class="mr-stanza">${senseLines(st)}</div>`;
      parts.push(`<div class="mr-psalm-unit">${stanzaHTML}` +
        `<div class="mr-gap"></div>` +
        `<div class="mr-response-line">${responseLines(r.response, false)}</div></div>`);
      parts.push(`<div class="mr-gap"></div>`);
    });
    return parts.join('');
  }
  // First/second reading + gospel: intro, then body grouped into clause units so
  // page breaks (in print) fall only between groups, never mid-clause.
  const parts = [];
  if (r.intro) {
    const introHTML = r.type === 'gospel'
      ? `<div class="mr-line"><span class="mr-cross">✠</span>${r.intro}</div>`
      : senseLines(r.intro);
    parts.push(`<div class="mr-intro">${introHTML}</div>`);
    parts.push(`<div class="mr-gap"></div>`);
  }
  const term = r.type === 'gospel' ? 'The Gospel of the Lord.' : 'The word of the Lord.';
  // Conclusion lives with the last line; guarded against a break before it
  // (.mr-gap--term / .mr-terminal) so it's never orphaned — needed in the
  // drop-cap ≤3-line case where it sits bare in .r-body-dropcap (desktop parity).
  const terminal = `<div class="mr-gap mr-gap--term"></div><div class="mr-line mr-terminal">${term}</div>`;
  const lines = r.text.split('\n').filter(l => l.trim());
  // Clause-grouped body: breaks fall only between groups; the last group keeps the
  // final line + conclusion together and avoids a break before it. Shared by the
  // normal path and the drop-cap tail.
  const renderGroups = (lns) => groupBodyLines(lns).map((grp, gi, arr) => {
    const last = gi === arr.length - 1;
    const linesHtml = grp.map(l => `<div class="mr-line">${fixEmDash(l)}</div>`).join('');
    return `<div class="mr-group${last ? ' mr-group--last' : ''}">${linesHtml}${last ? terminal : ''}</div>`;
  }).join('');

  if (dropCap) {
    // Head = cap + the two lines that wrap beside it (inline, flowing around the
    // float) + the first line that clears the cap (line 2, a block .mr-line). Three
    // lines exceed the cap's height, so the float is fully contained in the head;
    // the tail below is ordinary clause-grouped text. Mirrors desktop.
    const head = lines.slice(0, 2).map((l, i) =>
      i === 0 ? applyDropCap(fixEmDash(l)) : `<span class="r-drop-2nd"></span>${fixEmDash(l)}`
    ).join('<br>');
    const headLine3 = lines.length > 2 ? `<div class="mr-line">${fixEmDash(lines[2])}</div>` : '';
    const tailLines = lines.slice(3);
    if (tailLines.length) {
      parts.push(`<div class="mr-body r-body-dropcap">${head}${headLine3}</div>`);
      parts.push(`<div class="mr-body">${renderGroups(tailLines)}</div>`);
    } else {
      // ≤3 lines: nothing clears into a tail, so the conclusion stays in the head.
      parts.push(`<div class="mr-body r-body-dropcap">${head}${headLine3}${terminal}</div>`);
    }
  } else {
    parts.push(`<div class="mr-body">${renderGroups(lines)}</div>`);
  }
  return parts.join('');
}
const useLabel = (slot) =>
  slot === 'psalm' ? 'Use this psalm' : slot === 'gospel' ? 'Use this Gospel' : 'Use this reading';

// ── Add view (full-screen search) ────────────────────────────────────────────
let addSlot = null;       // slot being filled
let pool = [];            // candidate readings (poolFor(addSlot))
let results = [];         // currently displayed results
let searchTimer = null;
let addEl = null;

// Full excerpt text for a result card: strip markup + collapse whitespace.
// (Trimming to fit two lines happens after layout in fitExcerpts.)
function cleanExcerpt(text) {
  return toUiResponsum(text.replace(/<[^>]+>/g, '').replace(/\{\{response\}\}/g, ''))
    .replace(/\s+/g, ' ').trim();
}
function resultCardsHTML(list) {
  if (!list.length) return `<div class="m-add-empty">No readings found.</div>`;
  const curId = currentSel()[addSlot]?.id;
  return list.map((r, i) => {
    const cur = r.id === curId;
    return `
      <button class="m-result${cur ? ' m-result--current' : ''}" data-i="${i}">
        <div class="m-result-top">
          <span class="m-result-ref">${esc(formatRefUI(expandRef(r.ref)))}${cur ? ' <span class="m-result-cur">· current</span>' : ''}</span>
          <span class="m-result-id">${esc(r.id)}</span>
        </div>
        <div class="m-result-excerpt">${esc(cleanExcerpt(r.text))}</div>
      </button>`;
  }).join('');
}
function displayResults(list) {
  results = list;
  const listEl = addEl.querySelector('#m-add-results');
  const statusEl = addEl.querySelector('#m-add-status');
  listEl.innerHTML = resultCardsHTML(list);
  statusEl.textContent = `${list.length} reading${list.length !== 1 ? 's' : ''}`;
  if (addEl) fitExcerpts(addEl, '.m-result-excerpt');
}
async function runSearch(q) {
  if (!q) { displayResults(pool); return; }
  addEl.querySelector('#m-add-status').textContent = 'Searching…';
  const { search } = await searchModule();
  // Guard against a stale async result after the view changed / closed.
  if (!addEl || addSlot == null) return;
  const found = await search(normalizeBookRefs(q), pool, { mode: 'all', limit: 25 });
  if (addEl) displayResults(found);
}

function openAdd(slot) {
  addSlot = slot;
  pool = poolFor(slot);
  searchModule();   // warm the embedder in the background

  addEl = document.createElement('div');
  addEl.className = 'm-add';
  addEl.innerHTML = `
    <header class="m-add-head">
      <button class="m-icon-btn" id="m-add-back" aria-label="Back">‹</button>
      <div class="m-add-title">Add ${esc(SLOT_LABEL[slot])}</div>
      <div class="m-add-status" id="m-add-status"></div>
    </header>
    <div class="m-add-searchwrap">
      <input class="m-add-search" id="m-add-search" type="search"
             placeholder="Search by keyword or theme…" autocomplete="off" enterkeyhint="search">
      <button type="button" class="m-field-clear" id="m-add-clear" aria-label="Clear search" tabindex="-1">×</button>
    </div>
    <div class="m-add-results" id="m-add-results"></div>`;
  document.body.appendChild(addEl);
  pushOverlay(teardownAdd);
  requestAnimationFrame(() => addEl.classList.add('open'));

  displayResults(pool);
  // If this slot is already filled, surface the current pick.
  const curCard = addEl.querySelector('.m-result--current');
  if (curCard) requestAnimationFrame(() => curCard.scrollIntoView({ block: 'center' }));

  addEl.querySelector('#m-add-back').addEventListener('click', () => closeTop(1));
  const input = addEl.querySelector('#m-add-search');
  const clearBtn = addEl.querySelector('#m-add-clear');
  const syncClear = () => clearBtn.classList.toggle('visible', input.value.length > 0);
  input.addEventListener('input', () => {
    syncClear();
    clearTimeout(searchTimer);
    const q = input.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 220);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncClear();
    input.focus();
    clearTimeout(searchTimer);
    runSearch('');
  });
  syncClear();
  addEl.querySelector('#m-add-results').addEventListener('click', (e) => {
    const card = e.target.closest('.m-result');
    if (card) openBrowse(+card.dataset.i);
  });
}
const teardownAdd = makeTeardown(() => addEl, () => { addEl = null; addSlot = null; results = []; pool = []; });

// ── Browse sheet (per-reading preview) ───────────────────────────────────────
let browseIndex = 0;
let browseEls = null;   // { overlay, sheet, scroll, ref, content, prev, next }

// Split "1 Corinthians 15:20-24a" into a breakable book name + an unbreakable
// chapter:verse location, so if the ref must wrap it breaks after the book name
// ("1 Corinthians" / "15:20-24a") rather than mid-reference ("15:20-" / "24a").
function formatBrowseRef(ref) {
  const full = formatRefUI(expandRef(ref));
  const m = full.match(/^(.*?\D)\s+(\d.*)$/);
  if (!m) return esc(full);
  // Book name stays breakable; the location breaks only after the book name and
  // after semicolons — each ;-segment is kept whole so verse ranges never split.
  const loc = m[2].split(';').map(s => s.trim()).filter(Boolean)
    .map(seg => `<span class="mr-ref-loc">${esc(seg)}</span>`).join('; ');
  return `${esc(m[1])} ${loc}`;
}
function renderBrowse() {
  const r = results[browseIndex];
  if (!r) return;
  browseEls.ref.innerHTML = formatBrowseRef(r.ref);
  browseEls.content.innerHTML = renderReadingClean(r);
  browseEls.scroll.scrollTop = 0;
  browseEls.prev.disabled = browseIndex === 0;
  browseEls.next.disabled = browseIndex === results.length - 1;
}
function navBrowse(dir) {
  const ni = browseIndex + dir;
  if (ni < 0 || ni >= results.length) return;
  browseIndex = ni;
  // brief horizontal slide to reinforce the gesture
  browseEls.content.style.transition = 'none';
  browseEls.content.style.transform = `translateX(${dir > 0 ? 24 : -24}px)`;
  browseEls.content.style.opacity = '0';
  renderBrowse();
  requestAnimationFrame(() => {
    browseEls.content.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
    browseEls.content.style.transform = 'translateX(0)';
    browseEls.content.style.opacity = '1';
  });
}
const teardownBrowse = makeTeardown(() => browseEls && browseEls.overlay, () => { browseEls = null; });
function useReading() {
  const r = results[browseIndex];
  if (!r) return;
  currentSel()[addSlot] = r;
  const label = SLOT_LABEL[addSlot];
  closeAllOverlays();   // close the browse sheet + Add view → Home
  renderSlots(); updateBar();
  toast(`${label} added`);
}

function openBrowse(index) {
  browseIndex = index;
  const overlay = document.createElement('div');
  overlay.className = 'm-browse-overlay';
  overlay.innerHTML = `
    <div class="m-browse-sheet">
      <div class="m-browse-grab"></div>
      <div class="m-browse-head">
        <button class="m-browse-nav" data-nav="-1" aria-label="Previous reading">‹</button>
        <div class="m-browse-ref"></div>
        <button class="m-browse-nav" data-nav="1" aria-label="Next reading">›</button>
        <button class="m-icon-btn m-browse-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="m-browse-scroll"><div class="m-reading"></div></div>
      <div class="m-browse-foot">
        <button class="m-btn m-btn--confirm" data-use>${esc(useLabel(addSlot))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const sheet = overlay.querySelector('.m-browse-sheet');
  browseEls = {
    overlay, sheet,
    scroll: overlay.querySelector('.m-browse-scroll'),
    ref: overlay.querySelector('.m-browse-ref'),
    content: overlay.querySelector('.m-reading'),
    prev: overlay.querySelector('[data-nav="-1"]'),
    next: overlay.querySelector('[data-nav="1"]'),
  };
  renderBrowse();
  pushOverlay(teardownBrowse);
  requestAnimationFrame(() => overlay.classList.add('open'));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { closeTop(1); return; }
    if (e.target.closest('[data-use]')) { useReading(); return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) navBrowse(+nav.dataset.nav);
  });
  attachBrowseGestures();
}

// Touch gestures: horizontal swipe → prev/next (mirrors the arrows); swipe down
// → dismiss, but ONLY when the content is scrolled to the top so it never fights
// vertical scrolling of a long reading. Screen-edge starts are ignored (iOS
// reserves the left edge for back). Axis locks once a drag passes the threshold.
function attachBrowseGestures() {
  const { sheet, scroll } = browseEls;
  const LOCK = 12, SWIPE_X = 55, DISMISS_Y = 100;
  let sx = 0, sy = 0, axis = null, dragging = false, atTop = false;

  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { dragging = false; return; }
    const t = e.touches[0];
    if (t.clientX < 18 || t.clientX > window.innerWidth - 18) { dragging = false; return; }
    sx = t.clientX; sy = t.clientY; axis = null; dragging = true;
    atTop = scroll.scrollTop <= 0;
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (!axis) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis === 'x') {
      // Window stays static; the reading text follows the finger and is then
      // replaced by the next/previous reading.
      if (e.cancelable) e.preventDefault();
      browseEls.content.style.transition = 'none';
      browseEls.content.style.transform = `translateX(${dx}px)`;
    } else if (dy > 0 && atTop) {
      if (e.cancelable) e.preventDefault();
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: false });

  sheet.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (axis === 'x') {
      const dir = dx < 0 ? 1 : -1;
      const canNav = browseIndex + dir >= 0 && browseIndex + dir < results.length;
      if (Math.abs(dx) > SWIPE_X && canNav) {
        navBrowse(dir);            // owns the slide-in animation
      } else {
        browseEls.content.style.transition = 'transform 0.18s ease';
        browseEls.content.style.transform = 'translateX(0)';
      }
    } else if (axis === 'y' && dy > DISMISS_Y && atTop) {
      closeTop(1);
    }
  });
}

// ── Preview screen (assembled funeral, read-only) ────────────────────────────
// A clean, readable assembly of the whole funeral — EB Garamond, honouring the
// output toggles (section titles, ref, id, reader, colour, prayer name/pronoun).
// Not print-pixel-perfect (no drop caps): desktop remains the full-fidelity
// path, and mobile print is a convenience. Share + Print live here.

// Resolve {{name}}/{{he}}/… in prayer text (mirrors desktop resolvePrayerText,
// HTML mode). User text is escaped; our placeholder markup is added after.
function resolvePrayerText(text) {
  const raw = (state.name || '').trim();
  const name = raw ? esc(raw) : '<span class="pv-ph">N.</span>';
  const alt = (m, f) => state.sex === 'm' ? m : state.sex === 'f' ? f
    : `${m} <span class="pv-alt">(</span>${f}<span class="pv-alt">)</span>`;
  return esc(text || '')
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{he\}\}/g, alt('he', 'she'))
    .replace(/\{\{him\}\}/g, alt('him', 'her'))
    .replace(/\{\{his\}\}/g, alt('his', 'her'))
    .replace(/\{\{brother_sister\}\}/g, alt('brother', 'sister'));
}
function prayerLines(text) {
  return resolvePrayerText(text).split('\n').filter(l => l.trim())
    .map(l => `<div class="mr-line">${fixEmDash(l)}</div>`).join('');
}

// Output order (slot keys, kept for subhead/reader lookup) — the rule lives in
// core's orderedSlotKeys; here a slot is "present" when it holds a selection.
function orderedSlots() {
  const sel = currentSel();
  return orderedSlotKeys((k) => !!sel[k]);
}

function previewTitleHTML() {
  const name = esc(state.titleName || ''), date = esc(state.titleDate || '');
  return `<div class="pv-block pv-title">
    <div class="pv-title-funeral">Funeral</div>
    ${name ? `<div class="pv-title-name">${name}</div>` : ''}
    ${date ? `<div class="pv-title-date">${date}</div>` : ''}
  </div>`;
}
// The id (e.g. `1014(6A)`) is set in all-small-caps up to and including the
// closing paren; any trailing qualifier (` Shorter`, ` Longer`) is set in
// normal upper-and-lowercase via .pv-id-tail.
function formatIdHtml(id) {
  const i = id.lastIndexOf(')');
  if (i === -1 || i === id.length - 1) return esc(id);
  return esc(id.slice(0, i + 1)) + `<span class="pv-id-tail">${esc(id.slice(i + 1))}</span>`;
}

// Subhead label, mirroring desktop's typeLabelOf: the psalm reads "Responsorial
// Psalm"; a lone reading (no companion first/second reading) is just "Reading"
// rather than "First/Second Reading".
function subheadLabelFor(r, slot) {
  const sel = currentSel();
  const isReading = slot === 'firstReading' || slot === 'secondReading';
  const readingCount = (sel.firstReading ? 1 : 0) + (sel.secondReading ? 1 : 0);
  if (isReading && readingCount === 1) return 'Reading';
  if (r.type === 'psalm') return 'Responsorial Psalm';
  return r.type.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function previewReadingHTML(r, slot) {
  const parts = [];
  if (state.includeSubhead) parts.push(`<div class="pv-sub">${esc(subheadLabelFor(r, slot))}</div>`);
  if (state.includeRef || state.includeId) {
    const idPart = state.includeId ? `<span class="pv-id">${formatIdHtml(r.id)}</span>` : '';
    const refPart = state.includeRef ? `<span class="pv-ref">${esc(formatRef(r.ref))}</span>` : '';
    parts.push(`<div class="pv-ref-line">${idPart}${refPart}</div>`);
  }
  if (state.includeReader && slot !== 'gospel' && state.readers[slot]) {
    parts.push(`<div class="pv-reader">${esc(state.readers[slot])}:</div>`);
  }
  parts.push(renderReadingClean(r, state.dropCaps));
  return `<div class="pv-block">${parts.join('')}</div>`;
}
// Prayer intro/closing paragraph — drop cap on the first line when enabled
// (desktop applies caps to intro + closing only, never petitions).
function prayerParaHTML(text) {
  return state.dropCaps
    ? `<div class="mr-body r-body-dropcap">${dropCapLines(resolvePrayerText(text))}</div>`
    : prayerLines(text);
}
function previewPrayerHTML() {
  const pr = state.prayers;
  const parts = [];
  if (state.includeSubhead) parts.push(`<div class="pv-sub">Prayers of the Faithful</div>`);
  parts.push(`<div class="pv-rubric">Priest:</div>`);
  parts.push(`<div class="pv-para">${prayerParaHTML(pr.intro)}</div>`);
  const reader = state.readers.prayers ? `${state.readers.prayers}:` : 'Reader:';
  parts.push(`<div class="pv-rubric">${esc(reader)}</div>`);
  const resp = resolvePrayerText(pr.response);
  (pr.petitions || []).forEach((p) => {
    // Petition + its response are one unit (never split across a page in print).
    parts.push(`<div class="pv-petition-unit"><div class="pv-petition">${prayerLines(p)}</div>` +
      `<div class="pv-response"><span class="mr-glyph">℟.</span> ${resp}</div></div>`);
  });
  if (pr.closing) {
    parts.push(`<div class="pv-rubric">Priest:</div>`);
    parts.push(`<div class="pv-para">${prayerParaHTML(pr.closing)}</div>`);
  }
  parts.push(`<div class="pv-response"><span class="mr-glyph">℟.</span> Amen.</div>`);
  return `<div class="pv-block pv-prayers">${parts.join('')}</div>`;
}
function buildPreviewHTML() {
  const sel = currentSel();
  const parts = [];
  let first = true;
  const pushBlock = (html) => {
    if (!first) parts.push('<div class="pv-divider"></div>');   // on-screen separator (hidden in print)
    parts.push(html);
    first = false;
  };
  if (state.titlePage) {
    pushBlock(previewTitleHTML());
    // Blank verso: an empty page after the title in print; invisible on screen.
    if (state.titleBlankVerso) parts.push('<div class="pv-blank-verso"></div>');
  }
  for (const slot of orderedSlots()) pushBlock(previewReadingHTML(sel[slot], slot));
  if (state.prayers) pushBlock(previewPrayerHTML());
  if (first) {
    return `<div class="m-pv-empty">Nothing added yet. Add readings, a title page, or prayers to preview them here.</div>`;
  }
  return parts.join('');
}

let previewEl = null;
// The assembled funeral document node (wrapper class + print-sizing vars + body).
// Shared by the initial openPreview() render and the live refreshPreviewDoc() so
// the two stay identical when print settings change from the Preview sheet.
function previewDocHTML() {
  // Print-only sizing. Font: Normal 14pt / Large 17pt. Side inset is set ~0.33in
  // SMALLER than the desktop value on purpose: iOS Safari's print backend reserves
  // its own ~0.33in minimum page margin that stacks on top of our per-block padding
  // (it ignores @page margins, hence the padding workaround). Pre-subtracting that
  // offset lands the *measured* output on the desktop measured margins — 1.46in
  // normal (1.13 + 0.33) and 0.95in large (0.62 + 0.33) — so print parity holds
  // across platforms even though the set values differ. Vars are consumed only in
  // @media print; on-screen preview stays a fixed 1.22rem by design.
  const large = state.fontSize === 'large';
  const docVars = `--doc-pt:${large ? '17pt' : '14pt'};--page-pad-x:${large ? '0.62in' : '1.13in'}`;
  const docCls = `m-preview-doc ${state.colorMode === 'color' ? 'pv-color' : 'pv-bw'}${state.dropCaps ? ' drop-caps' : ''}`;
  return `<div class="${docCls}" style="${docVars}">${buildPreviewHTML()}</div>`;
}

// Compute the per-line shape-outside polygons for drop caps within `scope`. The
// leading ratio is shared between screen and print (only font-size differs in
// @media print), so the single shape is correct in both. Re-run on font load:
// measureDCAdvW won't cache fallback-font metrics, and font-display:block hides
// the glyph until the real font arrives, so the first (pre-load) pass never
// shows a mis-shaped wrap.
function applyPreviewDropCaps(scope) {
  if (!state.dropCaps) return;
  const docEl = scope.querySelector('.m-preview-doc');
  if (!docEl) return;
  applyDropCapShapes(docEl);
  document.fonts.load('1em "Cormorant Garamond"').then(() => {
    if (docEl.isConnected) applyDropCapShapes(docEl);
  });
}

function openPreview() {
  previewEl = document.createElement('div');
  previewEl.className = 'm-preview';
  previewEl.innerHTML = `
    <header class="m-preview-head">
      <button class="m-icon-btn" id="m-pv-close" aria-label="Back">‹</button>
      <div class="m-preview-title">Preview</div>
      <button class="m-icon-btn" id="m-pv-settings" aria-label="Print settings">${ICON_GEAR}</button>
    </header>
    <div class="m-preview-scroll">${previewDocHTML()}</div>
    <nav class="m-preview-foot">
      <button class="m-btn" id="m-pv-share">${ICON_SHARE}<span>Share</span></button>
      <button class="m-btn m-btn--primary" id="m-pv-print">${ICON_PRINT}<span>Print / Save&nbsp;PDF</span></button>
    </nav>`;
  document.body.appendChild(previewEl);
  pushOverlay(teardownPreview);
  requestAnimationFrame(() => previewEl.classList.add('open'));
  applyPreviewDropCaps(previewEl);
  previewEl.querySelector('#m-pv-close').addEventListener('click', () => closeTop(1));
  previewEl.querySelector('#m-pv-settings').addEventListener('click', openPrintSettingsSheet);
  previewEl.querySelector('#m-pv-share').addEventListener('click', onShare);
  previewEl.querySelector('#m-pv-print').addEventListener('click', () => window.print());
}

// Re-render the assembled document in place after a print-settings change, so the
// Preview reflects toggles/font/output live. Preserves scroll position.
function refreshPreviewDoc() {
  if (!previewEl) return;
  const scroll = previewEl.querySelector('.m-preview-scroll');
  const top = scroll.scrollTop;
  scroll.innerHTML = previewDocHTML();
  applyPreviewDropCaps(scroll);
  scroll.scrollTop = top;
}

// Print/output settings, opened from the Preview top-bar gear. Same controls as
// the hamburger menu (printSettingsHTML); changes repaint the Preview live.
function openPrintSettingsSheet() {
  openSheet({
    title: 'Print settings',
    bodyHTML: printSettingsHTML(),
    onMount: (body) => {
      syncPrintSettings(body);
      body.addEventListener('click', (e) => {
        const seg = e.target.closest('.m-seg[data-seg] button[data-val]');
        if (!seg) return;
        applySeg(seg.parentElement.dataset.seg, seg.dataset.val);
        syncPrintSettings(body); refreshPreviewDoc();
      });
      body.addEventListener('change', (e) => {
        const tog = e.target.closest('input[data-toggle]');
        if (!tog) return;
        applyToggle(tog.dataset.toggle, tog.checked);
        refreshPreviewDoc();
      });
    },
  });
}
const teardownPreview = makeTeardown(() => previewEl, () => { previewEl = null; });

// ── Open-from-library view ───────────────────────────────────────────────────
let libEl = null;
function renderLibList() {
  if (!libEl) return;
  const listEl = libEl.querySelector('#m-lib-list');
  const lib = loadLibrary().slice().sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!lib.length) {
    listEl.innerHTML = `<div class="m-lib-empty">No saved funerals yet. Build one, then tap Save.</div>`;
    return;
  }
  const cur = getCurrentFuneralId();
  listEl.innerHTML = lib.map((e) => `
    <div class="m-lib-item">
      <button class="m-lib-open" data-open="${esc(e.id)}">
        <div class="m-lib-name">${esc(e.name)}${e.id === cur ? ' <span class="m-lib-cur">· current</span>' : ''}</div>
        <div class="m-lib-meta">Modified ${esc(fmtDate(e.modifiedAt))}</div>
      </button>
      <button class="m-lib-act" data-rename="${esc(e.id)}">Rename</button>
      <button class="m-lib-act m-lib-act--del" data-del="${esc(e.id)}" aria-label="Delete">✕</button>
    </div>`).join('');
}
function openLibrary() {
  libEl = document.createElement('div');
  libEl.className = 'm-lib';
  libEl.innerHTML = `
    <header class="m-lib-head">
      <button class="m-icon-btn" id="m-lib-back" aria-label="Back">‹</button>
      <div class="m-lib-title">Open funeral</div>
      <div class="m-topbar-spacer"></div>
    </header>
    <div class="m-lib-body">
      <section class="m-lib-section">
        <h2 class="m-menu-h">Open from a link or code</h2>
        <input class="m-input" id="m-lib-code" placeholder="Paste a shared link or code" autocomplete="off" enterkeyhint="go">
        <button class="m-btn m-btn--primary" id="m-lib-load">Load</button>
      </section>
      <section class="m-lib-section">
        <h2 class="m-menu-h">Saved funerals</h2>
        <div id="m-lib-list"></div>
      </section>
      <section class="m-lib-section">
        <button class="m-menu-action" id="m-lib-export">Export all…</button>
        <button class="m-menu-action" id="m-lib-import">Import…</button>
        <button class="m-menu-action m-menu-action--danger" id="m-lib-clear">Clear all</button>
      </section>
    </div>`;
  document.body.appendChild(libEl);
  pushOverlay(teardownLib);
  requestAnimationFrame(() => libEl.classList.add('open'));
  renderLibList();

  libEl.querySelector('#m-lib-back').addEventListener('click', () => closeTop(1));
  libEl.querySelector('#m-lib-load').addEventListener('click', loadFromCode);
  libEl.querySelector('#m-lib-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromCode(); });
  libEl.querySelector('#m-lib-export').addEventListener('click', exportAll);
  libEl.querySelector('#m-lib-import').addEventListener('click', () =>
    importAll({ notify: (m) => toast(m), refresh: renderLibList }));
  libEl.querySelector('#m-lib-clear').addEventListener('click', clearAll);
  libEl.querySelector('#m-lib-list').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { const id = open.dataset.open; guardThen(() => { openFuneral(id); closeAllOverlays(); toast('Opened'); }); return; }
    const ren = e.target.closest('[data-rename]');
    if (ren) { renameFuneral(ren.dataset.rename); return; }
    const del = e.target.closest('[data-del]');
    if (del) { deleteFuneral(del.dataset.del); return; }
  });
}
const teardownLib = makeTeardown(() => libEl, () => { libEl = null; });
function loadFromCode() {
  const inp = libEl.querySelector('#m-lib-code');
  const val = (inp.value || '').trim();
  if (!val) return;
  let doc;
  try { doc = decode(val); } catch { toast('That doesn’t look like a valid link or code.'); return; }
  guardThen(() => { loadDoc(doc, null); closeAllOverlays(); toast('Loaded'); });
}
function renameFuneral(id) {
  const e = libFind(id);
  if (!e) return;
  openSheet({
    title: 'Rename funeral',
    bodyHTML: `<input class="m-input" id="m-ren-name" value="${esc(e.name)}" autocomplete="off" enterkeyhint="done">
      <button class="m-btn m-btn--primary" id="m-ren-go">Save</button>`,
    onMount(body, close) {
      const inp = body.querySelector('#m-ren-name'); inp.focus();
      const go = () => {
        const n = inp.value.trim();
        if (!n) { inp.focus(); return; }
        const lib = loadLibrary(); const x = lib.find((z) => z.id === id);
        if (x) { x.name = n.slice(0, 80); saveLibrary(lib); }
        close(); renderLibList(); updateBar();
      };
      body.querySelector('#m-ren-go').addEventListener('click', go);
      inp.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') go(); });
    },
  });
}
function deleteFuneral(id) {
  const e = libFind(id);
  if (!e) return;
  openSheet({
    title: 'Delete funeral?',
    bodyHTML: `<p class="m-sheet-sub">Delete “${esc(e.name)}”? This cannot be undone.</p>
      <div class="m-sheet-row">
        <button class="m-btn" data-close>Cancel</button>
        <button class="m-btn m-btn--danger" id="m-del-go">Delete</button>
      </div>`,
    onMount(body, close) {
      body.querySelector('#m-del-go').addEventListener('click', () => {
        saveLibrary(loadLibrary().filter((z) => z.id !== id));
        if (getCurrentFuneralId() === id) setCurrentFuneralId(null);
        close(); renderLibList(); commitNow(); updateBar();
      });
    },
  });
}
function clearAll() {
  // Full device wipe (shared-computer privacy): clears the saved library AND the
  // current in-progress funeral, so nothing of the previous funeral survives on
  // this machine. Bail only when there's genuinely nothing to clear.
  if (!loadLibrary().length && isBlank()) { toast('Nothing to clear.'); return; }
  openSheet({
    title: 'Clear everything on this device?',
    bodyHTML: `<p class="m-sheet-sub">This deletes every saved funeral and the current in-progress funeral. This cannot be undone.</p>
      <div class="m-sheet-row">
        <button class="m-btn" data-close>Cancel</button>
        <button class="m-btn m-btn--danger" id="m-clear-go">Delete all</button>
      </div>`,
    onMount(body, close) {
      body.querySelector('#m-clear-go').addEventListener('click', () => {
        // newFuneral() resets to a blank document and rewrites the working draft +
        // URL hash with no personal data (replaces the old commitNow(), which would
        // have re-saved the current funeral's data).
        saveLibrary([]);
        newFuneral();
        close(); renderLibList(); updateBar();
      });
    },
  });
}
// ── Events (delegated) ───────────────────────────────────────────────────────
$('#m-menu-open').addEventListener('click', openMenu);
$('#m-menu-close').addEventListener('click', () => closeTop(1));

// Hitting return/Go/Search on the soft keyboard dismisses it. Every mobile text
// field is single-line (no textareas), so Enter never needs to insert a newline.
// Fields that act on Enter (Save / open-by-code / Rename) run their own handler
// first — these bubble before this document-level one — and close their sheet
// anyway; the blur just drops the keyboard for the fields that have no action.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target;
  if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search')) {
    e.preventDefault();
    el.blur();
  }
});

slotsEl.addEventListener('click', (e) => {
  const rc = e.target.closest('[data-reader-clear]');
  if (rc) {
    e.stopPropagation();
    const field = rc.closest('.m-reader-field');
    state.readers[rc.dataset.readerClear] = '';
    field.querySelector('.m-reader-input').value = '';
    rc.classList.remove('visible');
    scheduleCommit();
    return;
  }
  if (e.target.closest('.m-reader-row')) return;   // typing a reader name, not navigating
  const rm = e.target.closest('[data-remove]');
  if (rm) { e.stopPropagation(); removeSlot(rm.dataset.remove); return; }
  const rms = e.target.closest('[data-remove-special]');
  if (rms) { e.stopPropagation(); removeSpecial(rms.dataset.removeSpecial); return; }
  const add = e.target.closest('[data-add]');
  if (add) { openAdd(add.dataset.add); return; }
  const adds = e.target.closest('[data-add-special]');
  if (adds) { addSpecial(adds.dataset.addSpecial); return; }
  // Tapping a filled Title Page / Prayers card opens its config sheet.
  const special = e.target.closest('.m-slot--filled[data-special]');
  if (special) {
    if (special.dataset.special === 'title') openTitleConfig();
    else if (special.dataset.special === 'prayers') openPrayersConfig();
    return;
  }
  // Tapping a filled reading card opens the Add view to swap it.
  const filled = e.target.closest('.m-slot--filled[data-slot]');
  if (filled) { openAdd(filled.dataset.slot); return; }
});
slotsEl.addEventListener('input', (e) => {
  const inp = e.target.closest('.m-reader-input[data-reader]');
  if (inp) {
    state.readers[inp.dataset.reader] = inp.value;
    inp.closest('.m-reader-field')?.querySelector('[data-reader-clear]')
      ?.classList.toggle('visible', !!inp.value);
    scheduleCommit();
  }
});

menuBody.addEventListener('click', (e) => {
  const help = e.target.closest('[data-help]');
  if (help) { openHelp(help.dataset.help); return; }
  const ctx = e.target.closest('[data-ctx]');
  if (ctx) { setContext(ctx.dataset.ctx); return; }
  const season = e.target.closest('[data-season]');
  if (season && state.context !== 'unbaptized') { setSeason(season.dataset.season); return; }
  const seg = e.target.closest('.m-seg[data-seg] button[data-val]');
  if (seg) {
    applySeg(seg.parentElement.dataset.seg, seg.dataset.val);
    syncMenu();
    return;
  }
  if (e.target.closest('#m-theme-btn')) { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); updateThemeButton(); return; }
  if (e.target.closest('#m-open'))  { openLibrary(); return; }
  if (e.target.closest('#m-new'))   { onNew(); return; }
});

menuBody.addEventListener('change', (e) => {
  const tog = e.target.closest('input[data-toggle]');
  if (tog) { applyToggle(tog.dataset.toggle, tog.checked); return; }
});

$('#m-save').addEventListener('click', onSave);
$('#m-share').addEventListener('click', onShare);
$('#m-preview').addEventListener('click', openPreview);

// ── Boot ─────────────────────────────────────────────────────────────────────
// Re-render hooks: a document load (shared link / future Open) repaints the
// whole Home; a draft commit refreshes the Save button. Mirrors desktop.
configure({ afterLoad: syncAll, afterCommit: updateBar });
restoreOnBoot();   // URL hash > working draft
buildMenu();
syncAll();

// Onboard a fresh visit: if boot landed on a blank funeral (no content added),
// prompt for context + season up front instead of leaving them buried in the menu.
if (!funeralHasContent()) openNewFuneralOverlay();

// Preload the document serif (regular + italic) so the dynamically-inserted
// Preview/browse text uses EB Garamond — iOS Safari otherwise won't apply a
// webfont first needed by content added after the initial paint, and italics
// fall back to Georgia.
if (document.fonts && document.fonts.load) {
  document.fonts.load('1em "EB Garamond"');
  document.fonts.load('italic 1em "EB Garamond"');
}
