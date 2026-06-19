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
// Meeus/Jones/Butcher algorithm — accurate for all Gregorian calendar years (1583+)
export function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Pentecost is 49 days after Easter Sunday (the 50th day of Easter Time)
export function pentecostDate(year) {
  const easter = easterDate(year);
  const p = new Date(easter);
  p.setDate(p.getDate() + 49);
  return p;
}

// Easter Time: Easter Sunday 00:00:00 → Pentecost Sunday 23:59:59
export function isDuringEasterTime(date = new Date()) {
  const year = date.getFullYear();
  const e = easterDate(year);
  const p = pentecostDate(year);
  const start = new Date(year, e.getMonth(), e.getDate(),  0,  0,  0);
  const end   = new Date(year, p.getMonth(), p.getDate(), 23, 59, 59);
  return date >= start && date <= end;
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Returns the Easter year relevant for near-future funeral planning:
// current year before/during Easter; next year from Monday after Pentecost through Jan 31.
export function relevantEasterYear(today = new Date()) {
  const y = today.getFullYear();
  const p = pentecostDate(y);
  const dayAfter = new Date(y, p.getMonth(), p.getDate() + 1, 0, 0, 0);
  const jan31Next = new Date(y + 1, 0, 31, 23, 59, 59);
  return (today >= dayAfter && today <= jan31Next) ? y + 1 : y;
}

// Returns formatted Easter and Pentecost strings for the relevant year,
// e.g. { easter: "April 5", pentecost: "May 24, 2026" }
export function easterSeasonLabel(today = new Date()) {
  const year = relevantEasterYear(today);
  const e = easterDate(year);
  const p = pentecostDate(year);
  return {
    easter:    `${MONTHS[e.getMonth()]} ${e.getDate()}`,
    pentecost: `${MONTHS[p.getMonth()]} ${p.getDate()}, ${year}`,
  };
}
