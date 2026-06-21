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
//
// With no saved choice the app follows the OS (prefers-color-scheme), both at
// startup and live, until the user explicitly toggles — which then sticks.
export const THEME_KEY = 'fr.theme';
export const currentTheme = () => document.documentElement.classList.contains('light') ? 'light' : 'dark';

const systemTheme = () =>
  (typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
const savedTheme = () => {
  try { const t = localStorage.getItem(THEME_KEY); return (t === 'light' || t === 'dark') ? t : null; }
  catch { return null; }
};

// Apply a theme to <html>. `persist` defaults to true so an explicit user choice
// is remembered; the startup system default is applied with persist=false so the
// app keeps tracking the OS rather than freezing the resolved value.
export function applyTheme(theme, persist = true) {
  document.documentElement.className = theme === 'light' ? 'light' : 'dark';
  if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch {} }
}

// Apply the saved theme, or follow the OS when none is saved. While unsaved, also
// track live OS changes; `onChange` lets the calling view re-sync its toggle
// button. Call once at startup.
export function initTheme(onChange) {
  const saved = savedTheme();
  if (saved) { applyTheme(saved); return; }
  applyTheme(systemTheme(), false);
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (savedTheme()) return;            // user has chosen since — stop following
      applyTheme(systemTheme(), false);
      if (onChange) onChange();
    });
  } catch {}
}
