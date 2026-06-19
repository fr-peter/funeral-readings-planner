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
// ── Library backup I/O + small DOM helpers (shared by main.js + mobile.js) ────
// Export/import of the funeral library to/from a JSON backup file, plus two
// view-agnostic helpers (date formatting, excerpt fitting). The desktop and
// mobile bundles previously carried identical (or near-identical) copies of
// these; the only per-view differences are how feedback is surfaced (alert vs
// toast) and which list is re-rendered, so importAll takes those as callbacks.

import { loadLibrary, saveLibrary } from './funeral-core.js';
import { decode } from './share.js';

// Upper bound on entries accepted from a backup file. importAll caps the incoming
// list before any per-entry work — each entry runs decode() (O(n²) base62), so an
// oversized backup could otherwise freeze the tab.
const MAX_IMPORT = 1000;

export const fmtDate = (ts) => {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
};

export function exportAll() {
  const data = JSON.stringify({ app: 'funeral-readings', v: 1, library: loadLibrary() }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'funerals-backup.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// notify(message) surfaces the result (alert on desktop, toast on mobile);
// refresh() re-renders the caller's library list after a successful import.
export function importAll({ notify, refresh }) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        const incoming = (Array.isArray(parsed.library) ? parsed.library : []).slice(0, MAX_IMPORT);
        const byId = new Map(loadLibrary().map((e) => [e.id, e]));
        let added = 0;
        for (const e of incoming) {
          if (!e || typeof e.id !== 'string' || typeof e.code !== 'string') continue;
          if (!/^[a-z0-9]+$/i.test(e.id)) continue;      // ids are genId() (base36); reject crafted charsets
          try { decode(e.code); } catch { continue; }   // reject undecodable codes
          byId.set(e.id, {
            id: e.id, name: String(e.name || 'Untitled').slice(0, 80), code: e.code,
            createdAt: +e.createdAt || Date.now(), modifiedAt: +e.modifiedAt || Date.now(),
          });
          added++;
        }
        saveLibrary([...byId.values()]);
        refresh();
        notify(`Imported ${added} funeral${added === 1 ? '' : 's'}.`);
      } catch { notify('That file could not be read as a funerals backup.'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// Trim each element matching `selector` within `root` to fill (at most) two
// lines, ending on a whole word, by measuring against the rendered width
// (binary search on word count). Avoids the mid-word clipping a CSS line-clamp
// would produce.
export function fitExcerpts(root, selector) {
  root.querySelectorAll(selector).forEach((el) => {
    const full = el.textContent;
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const maxH = Math.round(lineH * 2) + 2;
    if (el.scrollHeight <= maxH) return;
    const words = full.split(' ');
    let lo = 1, hi = words.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      el.textContent = words.slice(0, mid).join(' ') + '…';
      if (el.scrollHeight <= maxH) lo = mid; else hi = mid - 1;
    }
    el.textContent = words.slice(0, lo).join(' ') + '…';
  });
}
