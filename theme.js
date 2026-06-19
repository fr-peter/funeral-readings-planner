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
// ── Theme (device-local viewing preference) ───────────────────────────────────
// Dark/light is persisted to localStorage under fr.theme and applied as the
// <html> class. It is NOT part of the funeral document — it never travels in a
// share (a shared link opens in the recipient's own theme; see share.js). Shared
// by desktop + mobile; each view updates its own theme-toggle button after
// calling applyTheme (desktop updateThemeIcon, mobile updateThemeButton).
export const THEME_KEY = 'fr.theme';
export const currentTheme = () => document.documentElement.classList.contains('light') ? 'light' : 'dark';

export function applyTheme(theme) {
  document.documentElement.className = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

// Apply the persisted theme (defaulting to dark). Call once at startup.
export function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
}
