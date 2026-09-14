/**
 * On-disk index: embeddings.bin (Float32) + bm25.json + docs.json + meta.json.
 * Git-ignored; rebuilt from the advisory DB. No external store.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { EMBED_DIM } from './embeddings.js';
import type { AdvisoryDoc } from './document.js';
import type { Bm25Data } from './bm25.js';

export const INDEX_DIR = process.env.SEMANTIC_INDEX_DIR || './.semantic-index';

export interface IndexMeta {
  model: string;
  dim: number;
  count: number;
  dbCommit: string;
  builtAt: string;
}

// Fields kept for rerank/display (drop the heavy `text`).
export type StoredDoc = Omit<AdvisoryDoc, 'text'>;

export interface LoadedIndex {
  meta: IndexMeta;
  docs: StoredDoc[];
  vectors: Float32Array; // count * dim, row-major
  bm25: Bm25Data;
}

export async function saveIndex(
  meta: IndexMeta,
  docs: AdvisoryDoc[],
  vectors: Float32Array[],
  bm25: Bm25Data
): Promise<void> {
  await mkdir(INDEX_DIR, { recursive: true });
  const flat = new Float32Array(vectors.length * EMBED_DIM);
  vectors.forEach((v, i) => flat.set(v, i * EMBED_DIM));
  await writeFile(join(INDEX_DIR, 'embeddings.bin'), Buffer.from(flat.buffer));
  const stored: StoredDoc[] = docs.map(({ text, ...rest }) => rest);
  await writeFile(join(INDEX_DIR, 'docs.json'), JSON.stringify(stored));
  await writeFile(join(INDEX_DIR, 'bm25.json'), JSON.stringify(bm25));
  await writeFile(join(INDEX_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
}

export function indexExists(): boolean {
  return ['embeddings.bin', 'docs.json', 'bm25.json', 'meta.json']
    .every(f => existsSync(join(INDEX_DIR, f)));
}

export async function loadIndex(): Promise<LoadedIndex> {
  const meta: IndexMeta = JSON.parse(await readFile(join(INDEX_DIR, 'meta.json'), 'utf-8'));
  const docs: StoredDoc[] = JSON.parse(await readFile(join(INDEX_DIR, 'docs.json'), 'utf-8'));
  const bm25: Bm25Data = JSON.parse(await readFile(join(INDEX_DIR, 'bm25.json'), 'utf-8'));
  const buf = await readFile(join(INDEX_DIR, 'embeddings.bin'));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return { meta, docs, vectors, bm25 };
}
