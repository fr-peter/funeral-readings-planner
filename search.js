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
import Fuse from './vendor/fuse.mjs';
import { pipeline, env } from '@xenova/transformers';
import { expandRef } from './books.js';

// Model weights and WASM runtime are bundled under public/ — no network needed.
env.allowRemoteModels = false;
env.allowLocalModels  = true;
// Base-relative so the app works whether served at the domain root or under a
// GitHub Pages project subpath (/<repo>/). BASE_URL is '/' by default.
env.localModelPath    = import.meta.env.BASE_URL + 'models/';
env.backends.onnx.wasm.wasmPaths = import.meta.env.BASE_URL + 'wasm/';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DTYPE = 'q8';

// Weights for combining scores.
const WEIGHTS = { literal: 0.35, fuzzy: 0.25, semantic: 0.40 };

// Raw cosine similarities from all-MiniLM-L6-v2 sit on a compressed scale that
// never reaches the 1.0 a literal/fuzzy hit can, so combining them directly made
// the 0.40 semantic weight under-bite. Rescale cosine → [0, 1] with an affine
// clamp before weighting, calibrated from the corpus: nonsense queries top out
// around 0.19 cosine, genuine matches run ~0.28–0.57. Anything at/below FLOOR is
// treated as no semantic signal; at/above CEIL it's a strong match (saturates).
const SEMANTIC_FLOOR = 0.20;
const SEMANTIC_CEIL  = 0.50;

// Drop near-zero combined scores so a nonsense query returns nothing rather than
// reshuffling the whole category. Sits below the weakest genuine signal: any
// literal hit ≥ 0.21, any fuzzy hit ≥ 0.175, a weak-but-real semantic-only hit
// ≈ 0.13; a nonsense semantic hit rescales to ~0.
const MIN_SCORE = 0.05;

function scaleSemantic(sim) {
  return Math.max(0, Math.min(1, (sim - SEMANTIC_FLOOR) / (SEMANTIC_CEIL - SEMANTIC_FLOOR)));
}

// Eagerly initialised — started on import, awaited on first search.
let embedderPromise = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  }
  return embedderPromise;
}

// Call this at page load to start warming up the model in the background.
// Returns a promise that resolves when the model is ready (or rejects on failure).
export function preloadEmbedder() {
  return getEmbedder().catch(() => {}); // warm up; ignore errors here
}

async function embedQuery(text) {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function cosineSimilarity(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '');
}

// Normalise text for punctuation-insensitive literal matching.
// Applied to body text only — refs and IDs are matched exactly so that
// "Jn 11:17" and verse ranges continue to work.
function normText(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // fold accents: "Éloi" → "eloi", "Gólgotha" → "golgotha"
    .replace(/['''‘’]/g, '')             // strip apostrophes: "father's" → "fathers"
    .replace(/[,.\-–—;:!?"""«»]/g, ' ')  // other punctuation → space
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function literalScore(reading, q) {
  const lq = q.toLowerCase();
  if (reading.id.toLowerCase().includes(lq))          return 1.0;
  if (reading.ref.toLowerCase().includes(lq))         return 1.0;
  if ((reading.tags ?? []).some(t => t.includes(lq))) return 1.0;
  // Text: normalise punctuation on both sides so "behold your mother"
  // matches "Behold, your mother" and "father's house" matches "fathers house".
  const lqn = normText(q);
  if (lqn && normText(stripHtml(reading.text)).includes(lqn)) return 0.6;
  return 0;
}

// Callers are responsible for pre-filtering readings (e.g. by type, paschaltide).
//
// mode: 'all' | 'literal' | 'fuzzy' | 'semantic'
// limit: max results to return
//
// In 'all' mode the result pool is the union of:
//   - all literal matches
//   - all fuzzy matches (up to Fuse's threshold)
//   - all semantic matches above the rescale floor (SEMANTIC_FLOOR)
// Each reading in the pool gets a weighted combined score; results below
// MIN_SCORE are dropped before the top <limit> are returned.
//
// In 'semantic' mode every reading is ranked and the top <limit> returned,
// so the caller always gets a ranked list even with no keyword overlap.
export async function search(query, readings, { mode = 'all', limit = 10 } = {}) {
  if (!query.trim()) return [];

  // Map from reading.id -> { reading, scores: { literal?, fuzzy?, semantic? } }
  const pool = new Map();

  function add(reading, key, value) {
    if (!pool.has(reading.id)) pool.set(reading.id, { reading, scores: {} });
    pool.get(reading.id).scores[key] = value;
  }

  // ── Literal ──────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'literal') {
    for (const r of readings) {
      const s = literalScore(r, query);
      if (s > 0) add(r, 'literal', s);
    }
  }

  // ── Fuzzy ─────────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'fuzzy') {
    const idToReading = new Map(readings.map(r => [r.id, r]));
    const cleanedReadings = readings.map(r => ({ ...r, text: stripHtml(r.text), fullRef: expandRef(r.ref) }));
    const fuse = new Fuse(cleanedReadings, {
      keys: ['id', 'ref', 'fullRef', 'tags', 'text'],
      includeScore: true,
      threshold: 0.3,
      ignoreLocation: true,
    });
    for (const { item, score } of fuse.search(query)) {
      add(idToReading.get(item.id), 'fuzzy', 1 - score); // fuse: 0=perfect → invert so 1=best
    }
  }

  // ── Semantic ──────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'semantic') {
    try {
      const qvec = await embedQuery(query);
      const ranked = readings
        .map(r => ({ reading: r, sim: cosineSimilarity(qvec, r.vectors) }))
        .sort((a, b) => b.sim - a.sim);

      if (mode === 'semantic') {
        return ranked.slice(0, limit).map(x => x.reading);
      }

      // Combined mode: fold semantic hits into the pool, rescaled so the weight
      // bites. Inclusion is score-gated, not rank-capped: any reading that
      // rescales above 0 (cosine > SEMANTIC_FLOOR) is a candidate; everything at
      // or below the floor carries no real signal and is dropped. Final ranking
      // and the MIN_SCORE floor below decide what actually surfaces.
      for (const { reading, sim } of ranked) {
        const s = scaleSemantic(sim);
        if (s > 0) add(reading, 'semantic', s);
      }
    } catch (err) {
      console.warn('Semantic search unavailable:', err.message);
    }
  }

  // ── Combine and rank ──────────────────────────────────────────────────────
  return Array.from(pool.values())
    .map(({ reading, scores }) => ({
      reading,
      score:
        (scores.literal  ?? 0) * WEIGHTS.literal  +
        (scores.fuzzy    ?? 0) * WEIGHTS.fuzzy    +
        (scores.semantic ?? 0) * WEIGHTS.semantic,
    }))
    .filter(x => x.score >= MIN_SCORE)   // drop near-zero noise (e.g. nonsense queries)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.reading);
}
