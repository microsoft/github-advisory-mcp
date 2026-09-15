import { describe, it, expect } from "vitest";
import { tokenize, Bm25 } from "../../src/semantic/bm25.js";

describe("tokenize", () => {
  it("preserves security identifiers and package names", () => {
    expect(tokenize("GHSA-abcd-1234-xyz9 CVE-2026-1 next.js")).toEqual([
      "ghsa-abcd-1234-xyz9",
      "cve-2026-1",
      "next.js",
    ]);
  });
  it("lowercases, splits on punctuation, drops single chars", () => {
    expect(tokenize("SQL Injection! a (blind)")).toEqual(["sql", "injection", "blind"]);
  });
});

describe("Bm25", () => {
  const ids = ["a", "b", "c"];
  const texts = [
    "sql injection in the query builder",
    "cross site scripting reflected xss",
    "sql injection via sort parameter",
  ];
  const bm = Bm25.build(ids, texts);

  it("ranks documents containing the query terms", () => {
    const r = bm.search("sql injection", 5);
    const top = r.map(([d]) => d);
    expect(top).toContain(0);
    expect(top).toContain(2);
    expect(top).not.toContain(1); // xss doc has neither term
  });
  it("returns nothing for out-of-vocabulary queries", () => {
    expect(bm.search("kubernetes", 5)).toEqual([]);
  });
  it("survives a JSON round-trip", () => {
    const again = Bm25.fromJSON(JSON.parse(JSON.stringify(bm.toJSON())));
    expect(again.search("sql injection", 5)).toEqual(bm.search("sql injection", 5));
  });
});
