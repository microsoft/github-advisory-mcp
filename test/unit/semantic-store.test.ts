import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EMBED_DIM } from "../../src/semantic/embeddings.js";
import { saveIndex, loadIndex, indexExists, type IndexMeta } from "../../src/semantic/store.js";
import type { AdvisoryDoc } from "../../src/semantic/document.js";
import { Bm25 } from "../../src/semantic/bm25.js";

let dir: string;

function doc(id: string, over: Partial<AdvisoryDoc> = {}): AdvisoryDoc {
  return {
    id, text: `${id} sql injection`, ghsa_id: id, cve_id: "", summary: "sql injection",
    cweIds: ["CWE-89"], packages: ["acme/orm"], ecosystems: ["packagist"],
    severity: "high", published: Date.UTC(2026, 5, 1), updated: Date.UTC(2026, 5, 2), ...over,
  };
}

function vec(seed: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) v[i] = Math.sin(seed + i) * 0.01;
  return v;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "semidx-"));
  process.env.SEMANTIC_INDEX_DIR = dir;
});
afterAll(() => {
  delete process.env.SEMANTIC_INDEX_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("store save/load round-trip", () => {
  const docs = [doc("GHSA-1"), doc("GHSA-2")];
  const vectors = [vec(1), vec(2)];
  const bm25 = Bm25.build(docs.map(d => d.id), docs.map(d => d.text)).toJSON();
  const meta: IndexMeta = { model: "test-model", dim: EMBED_DIM, count: 2, dbCommit: "abc1234", builtAt: "2026-09-13T00:00:00Z" };

  it("indexExists is false before a build", () => {
    expect(indexExists()).toBe(false);
  });

  it("writes all four files", async () => {
    await saveIndex(meta, docs, vectors, bm25);
    expect(indexExists()).toBe(true);
  });

  it("reloads meta and docs (text stripped) faithfully", async () => {
    const ix = await loadIndex();
    expect(ix.meta).toEqual(meta);
    expect(ix.docs).toHaveLength(2);
    expect((ix.docs[0] as any).text).toBeUndefined();
    expect(ix.docs[0].ghsa_id).toBe("GHSA-1");
    expect(ix.docs[0].published).toBe(Date.UTC(2026, 5, 1));
  });

  it("reloads embeddings byte-exact (serialization portability)", async () => {
    const ix = await loadIndex();
    expect(ix.vectors.length).toBe(2 * EMBED_DIM);
    for (let i = 0; i < EMBED_DIM; i++) {
      expect(ix.vectors[i]).toBe(vectors[0][i]);
      expect(ix.vectors[EMBED_DIM + i]).toBe(vectors[1][i]);
    }
  });
});
