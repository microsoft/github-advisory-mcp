/**
 * Compact in-process BM25 (Okapi) — no external engine.
 *
 * Advisory-tuned: identifiers (GHSA-…, CVE-…, package names) survive tokenization
 * so exact-id and package queries score strongly.
 */

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // keep letters/digits/hyphen/dot/underscore so "ghsa-xxxx", "cve-2026-1", "next.js" stay intact
    .split(/[^a-z0-9._-]+/)
    .filter(t => t.length > 1);
}

export interface Bm25Data {
  ids: string[];
  df: Record<string, number>;
  docTokens: number[][];       // per-doc term-id lists (indexes into `vocab`)
  vocab: string[];             // term-id -> term
  tf: Record<number, number>[]; // per-doc term-id -> frequency
  avgdl: number;
  n: number;
}

export class Bm25 {
  private data: Bm25Data;
  private termId: Map<string, number>;

  constructor(data: Bm25Data) {
    this.data = data;
    this.termId = new Map(data.vocab.map((t, i) => [t, i]));
  }

  static build(ids: string[], texts: string[]): Bm25 {
    const vocab: string[] = [];
    const termId = new Map<string, number>();
    const df: Record<string, number> = {};
    const tf: Record<number, number>[] = [];
    const docTokens: number[][] = [];
    let total = 0;

    for (const text of texts) {
      const toks = tokenize(text);
      total += toks.length;
      const counts: Record<number, number> = {};
      const seen = new Set<number>();
      const ids2: number[] = [];
      for (const tok of toks) {
        let id = termId.get(tok);
        if (id === undefined) { id = vocab.length; vocab.push(tok); termId.set(tok, id); }
        counts[id] = (counts[id] || 0) + 1;
        ids2.push(id);
        if (!seen.has(id)) { seen.add(id); df[tok] = (df[tok] || 0) + 1; }
      }
      tf.push(counts);
      docTokens.push(ids2);
    }

    const n = texts.length;
    const data: Bm25Data = { ids, df, docTokens, vocab, tf, avgdl: total / (n || 1), n };
    return new Bm25(data);
  }

  toJSON(): Bm25Data { return this.data; }
  static fromJSON(d: Bm25Data): Bm25 { return new Bm25(d); }

  /** Returns [docIndex, score] pairs sorted desc, top `limit`. */
  search(query: string, limit: number): Array<[number, number]> {
    const { df, tf, docTokens, avgdl, n } = this.data;
    const qTerms = tokenize(query);
    const scores = new Map<number, number>();

    for (const term of qTerms) {
      const id = this.termId.get(term);
      if (id === undefined) continue;
      const termDf = df[term] || 0;
      if (termDf === 0) continue;
      const idf = Math.log(1 + (n - termDf + 0.5) / (termDf + 0.5));
      for (let d = 0; d < n; d++) {
        const f = tf[d][id];
        if (!f) continue;
        const dl = docTokens[d].length;
        const denom = f + K1 * (1 - B + B * (dl / avgdl));
        scores.set(d, (scores.get(d) || 0) + idf * ((f * (K1 + 1)) / denom));
      }
    }

    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
}
