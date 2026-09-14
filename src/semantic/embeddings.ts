/**
 * Local, offline embeddings via @huggingface/transformers (ONNX, CPU).
 *
 * No network at query time and no external service. Defaults to the cached
 * all-MiniLM-L6-v2 (384-dim). Point SEMANTIC_MODEL_CACHE at an existing
 * transformers cache to avoid any download on locked-down devices.
 */

import { env, pipeline } from '@huggingface/transformers';

const MODEL = process.env.SEMANTIC_MODEL || 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = Number(process.env.SEMANTIC_DIM || 384);

// Offline by default; reuse an existing cache dir if provided.
env.allowRemoteModels = process.env.SEMANTIC_ALLOW_REMOTE === 'true';
if (process.env.SEMANTIC_MODEL_CACHE) {
  env.cacheDir = process.env.SEMANTIC_MODEL_CACHE;
}

let extractor: any | null = null;

async function getExtractor(): Promise<any> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', MODEL);
  }
  return extractor;
}

export function modelName(): string {
  return MODEL;
}

/** Embed a single text -> unit-normalized Float32Array[EMBED_DIM]. */
export async function embed(text: string): Promise<Float32Array> {
  const ex = await getExtractor();
  const out = await ex(text, { pooling: 'mean', normalize: true });
  return new Float32Array(out.data);
}

/** Batch embed -> one ONNX forward pass; returns rows of EMBED_DIM. */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await embed(texts[0])];
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: 'mean', normalize: true });
  const data = out.data as Float32Array;
  return Array.from({ length: texts.length }, (_, i) =>
    data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM)
  );
}

/** Cosine of two unit vectors == dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
