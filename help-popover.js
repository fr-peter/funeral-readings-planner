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
// Help-popover handler (desktop chrome). Lives in its own module — loaded via
// <script type="module" src="/help-popover.js"> — rather than inline in
// index.html so the page can ship a strict Content-Security-Policy with
// script-src 'self' (no 'unsafe-inline'). See the CSP <meta> in index.html.
(function () {
  let openPopover = null;

  function closeAll() {
    if (!openPopover) return;
    openPopover.popover.classList.remove('open');
    openPopover.btn.classList.remove('open');
    openPopover = null;
  }

  // Delegated so it covers help buttons in dynamically rendered cards too. Any
  // `.help-popover-wrap > .help-btn + .help-popover` works without wiring.
  document.addEventListener('click', e => {
    const btn = e.target.closest('.help-btn');
    if (btn) {
      e.stopPropagation();
      const popover = btn.parentElement.querySelector('.help-popover');
      const wasOpen = openPopover?.btn === btn;
      closeAll();
      if (!wasOpen && popover) {
        popover.classList.add('open');   // display it first so offsetWidth is real
        btn.classList.add('open');
        const r = btn.getBoundingClientRect();
        // Open below the button; clamp to the viewport's right edge (8px gutter).
        const left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8);
        popover.style.top  = (r.bottom + 8) + 'px';
        popover.style.left = Math.max(8, left) + 'px';
        openPopover = { btn, popover };
      }
      return;
    }
    closeAll();
  });
})();
