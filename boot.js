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
// Single-URL layout bootstrap.
//
// The desktop and mobile layouts live at the SAME address (sharing a funeral
// link is the headline feature, so links must be device-agnostic). Only one
// bundle ever loads: we pick here and dynamically import it, so the other
// layout's code/CSS is never downloaded.
//
// Gate on INPUT TYPE + width, not width alone — a desktop user shrinking the
// window keeps `pointer: fine` and must stay on desktop. `fr.forceLayout`
// (localStorage) backs a manual "view desktop/mobile site" escape without
// changing the URL.

const FORCE_KEY = 'fr.forceLayout';

function wantsMobile() {
  let forced = null;
  try { forced = localStorage.getItem(FORCE_KEY); } catch {}
  if (forced === 'mobile') return true;
  if (forced === 'desktop') return false;
  return window.matchMedia('(pointer: coarse) and (hover: none) and (max-width: 600px)').matches;
}

// Manual escape hatch (a proper UI link comes with the mobile chrome later).
window.__setLayout = (layout) => {
  try {
    if (layout) localStorage.setItem(FORCE_KEY, layout);
    else localStorage.removeItem(FORCE_KEY);
  } catch {}
  location.reload();
};

if (wantsMobile()) {
  document.documentElement.dataset.layout = 'mobile';
  // The desktop DOM is inlined in index.html; mobile builds its own. Remove the
  // desktop shell so it can't flash or capture events. The funeral hash is left
  // untouched (no navigation), so a shared link still loads on mobile.
  document.querySelectorAll('#app, .modal-overlay, #print-tips-overlay').forEach(el => el.remove());
  import('./mobile.js');
} else {
  document.documentElement.dataset.layout = 'desktop';
  import('./main.js');
}
