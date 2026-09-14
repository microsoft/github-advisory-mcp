import { describe, it, expect } from "vitest";
import { EMBED_DIM } from "../../src/semantic/embeddings.js";
import { hybridSearch } from "../../src/semantic/hybrid.js";
import { Bm25 } from "../../src/semantic/bm25.js";
import type { LoadedIndex, StoredDoc } from "../../src/semantic/store.js";

function sdoc(ghsa: string, summary: string, cwe: string, pkg: string, publishedYear: number): StoredDoc {
  return {
    id: ghsa, ghsa_id: ghsa, cve_id: "", summary, cweIds: [cwe], packages: [pkg],
    ecosystems: ["npm"], severity: "high", published: Date.UTC(publishedYear, 0, 15), updated: 0,
  };
}

// dim0-aligned unit vector by weight
function row(out: Float32Array, i: number, dim0: number) { out[i * EMBED_DIM + 0] = dim0; out[i * EMBED_DIM + 1] = Math.sqrt(Math.max(0, 1 - dim0 * dim0)); }

const docs = [
  sdoc("GHSA-AAAA", "sql injection in query builder", "CWE-89", "acme/orm", 2020),
  sdoc("GHSA-BBBB", "cross site scripting xss", "CWE-79", "foo/web", 2026),
  sdoc("GHSA-CCCC", "sql injection via sort parameter", "CWE-89", "bar/db", 2026),
];
const vectors = new Float32Array(docs.length * EMBED_DIM);
row(vectors, 0, 1.0);   // aligned with query
row(vectors, 1, 0.0);   // orthogonal
row(vectors, 2, 0.7);   // partly aligned
const bm25 = Bm25.build(docs.map(d => d.id), docs.map(d => `${d.summary} ${d.ghsa_id}`)).toJSON();
const index: LoadedIndex = {
  meta: { model: "test", dim: EMBED_DIM, count: docs.length, dbCommit: "x", builtAt: "" },
  docs, vectors, bm25,
};
const queryVec = (() => { const v = new Float32Array(EMBED_DIM); v[0] = 1; return v; })();

describe("hybridSearch", () => {
  it("ranks the semantically + lexically matching doc first", async () => {
    const hits = await hybridSearch(index, "sql injection", 3, 10, queryVec);
    expect(hits[0].ghsa_id).toBe("GHSA-AAAA");
    // xss doc has no vector/lexical overlap -> ranks last
    expect(hits[hits.length - 1].ghsa_id).toBe("GHSA-BBBB");
  });

  it("field-aware rerank lifts an exact GHSA-id mention", async () => {
    const hits = await hybridSearch(index, "sql injection GHSA-CCCC", 3, 10, queryVec);
    expect(hits[0].ghsa_id).toBe("GHSA-CCCC");
    expect(hits[0].scores.rerank).toBeGreaterThanOrEqual(5);
  });

  it("temporal proximity scores the in-window doc 1.0 and decays others", async () => {
    const hits = await hybridSearch(index, "sql injection in 2026", 3, 10, queryVec);
    const byId = Object.fromEntries(hits.map(h => [h.ghsa_id, h]));
    expect(byId["GHSA-CCCC"].scores.temporal).toBe(1);   // 2026, in window
    expect(byId["GHSA-AAAA"].scores.temporal).toBeLessThan(1); // 2020, decayed
  });
});
