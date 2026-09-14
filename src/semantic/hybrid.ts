/**
 * Hybrid retrieval: BM25 + dense vectors fused with Reciprocal Rank Fusion,
 * then a lightweight, field-aware rerank. All local; no cross-encoder needed
 * (a local reranker model can replace `rerankScore` later behind this interface).
 */

import { embed, cosine, EMBED_DIM } from './embeddings.js';
import { Bm25, tokenize } from './bm25.js';
import { parseTemporal, temporalRelevance } from './temporal.js';
import type { LoadedIndex, StoredDoc } from './store.js';

export interface SearchHit {
  ghsa_id: string;
  cve_id: string;
  summary: string;
  severity: string;
  cweIds: string[];
  packages: string[];
  published: number;
  scores: { rrf: number; vector: number; bm25Rank: number; rerank: number; temporal: number; final: number };
}

const RRF_K = 60;
const TEMPORAL_WEIGHT = 0.02; // additive; comparable to an RRF top-rank contribution

function vectorTopK(query: Float32Array, vectors: Float32Array, n: number, k: number): Array<[number, number]> {
  const scored: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const row = vectors.subarray(i * EMBED_DIM, (i + 1) * EMBED_DIM);
    scored.push([i, cosine(query, row)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, k);
}

/**
 * Field-aware rerank of a fused candidate. Rewards exact identifiers, affected
 * package names present in the query, CWE mentions, and summary phrase overlap.
 */
function rerankScore(query: string, qTokens: Set<string>, doc: StoredDoc): number {
  const q = query.toLowerCase();
  let s = 0;
  if (doc.ghsa_id && q.includes(doc.ghsa_id.toLowerCase())) s += 5;
  if (doc.cve_id && q.includes(doc.cve_id.toLowerCase())) s += 5;
  if (doc.packages.some(p => qTokens.has(p))) s += 2;
  if (doc.cweIds.some(c => qTokens.has(c.toLowerCase()) || qTokens.has(c.replace(/^cwe-/i, '')))) s += 1.5;
  const summaryTokens = new Set(tokenize(doc.summary));
  let overlap = 0;
  for (const t of qTokens) if (summaryTokens.has(t)) overlap++;
  s += Math.min(overlap, 5) * 0.4;
  return s;
}

export async function hybridSearch(
  index: LoadedIndex,
  query: string,
  topK = 10,
  fetch = 50
): Promise<SearchHit[]> {
  const bm25 = Bm25.fromJSON(index.bm25);

  // Split temporal intent out of the query: recall runs on the residual text,
  // the period drives a proximity boost in the rerank stage.
  const temporal = parseTemporal(query);
  const recallQuery = temporal.present && temporal.residual ? temporal.residual : query;

  const qEmbedding = await embed(recallQuery);
  const qTokens = new Set(tokenize(recallQuery));

  const vec = vectorTopK(qEmbedding, index.vectors, index.docs.length, fetch);
  const lex = bm25.search(recallQuery, fetch);

  // Reciprocal Rank Fusion over the two candidate lists.
  const rrf = new Map<number, number>();
  const vecScore = new Map<number, number>();
  vec.forEach(([d, s], rank) => { rrf.set(d, (rrf.get(d) || 0) + 1 / (RRF_K + rank + 1)); vecScore.set(d, s); });
  const bmRank = new Map<number, number>();
  lex.forEach(([d], rank) => { rrf.set(d, (rrf.get(d) || 0) + 1 / (RRF_K + rank + 1)); bmRank.set(d, rank + 1); });

  // Rerank the fused candidates.
  const candidates = [...rrf.keys()];
  const hits = candidates.map(d => {
    const doc = index.docs[d];
    const rerank = rerankScore(recallQuery, qTokens, doc);
    const rrfScore = rrf.get(d)!;
    const temporalScore = temporalRelevance(doc.published, temporal);
    return {
      d,
      hit: {
        ghsa_id: doc.ghsa_id,
        cve_id: doc.cve_id,
        summary: doc.summary,
        severity: doc.severity,
        cweIds: doc.cweIds,
        packages: doc.packages,
        published: doc.published,
        scores: {
          rrf: rrfScore,
          vector: vecScore.get(d) ?? 0,
          bm25Rank: bmRank.get(d) ?? 0,
          rerank,
          temporal: temporalScore,
          final: rrfScore + rerank * 0.01 + temporalScore * TEMPORAL_WEIGHT,
        },
      } as SearchHit,
    };
  });

  hits.sort((a, b) => b.hit.scores.final - a.hit.scores.final);
  return hits.slice(0, topK).map(h => h.hit);
}
