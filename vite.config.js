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
import { defineConfig } from 'vite';

export default defineConfig({
  // Prevent Vite pre-bundling @huggingface/transformers — it uses dynamic
  // imports for the WASM runtime that break under Vite's pre-bundle step.
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
  // public/ is copied verbatim into dist/, giving us model weights + WASM at
  // known paths without any hashing or transformation.
  publicDir: 'public',
});
