import { describe, it, expect } from "vitest";
import { normalizeCwe, cweFilterMatches } from "../../src/datasources/local-repository.js";

describe("normalizeCwe", () => {
  it("prefixes bare numbers", () => {
    expect(normalizeCwe("89")).toBe("CWE-89");
  });
  it("keeps and upper-cases prefixed ids", () => {
    expect(normalizeCwe("cwe-89")).toBe("CWE-89");
    expect(normalizeCwe("CWE-89")).toBe("CWE-89");
  });
  it("trims whitespace", () => {
    expect(normalizeCwe("  79 ")).toBe("CWE-79");
  });
});

describe("cweFilterMatches", () => {
  const adv = ["CWE-89", "CWE-943"];

  it("matches a bare number (the documented input form)", () => {
    expect(cweFilterMatches(adv, ["89"])).toBe(true);
  });
  it("matches a prefixed id", () => {
    expect(cweFilterMatches(adv, ["CWE-943"])).toBe(true);
  });
  it("matches a comma-separated single element", () => {
    expect(cweFilterMatches(adv, ["79,89"])).toBe(true);
  });
  it("matches across a multi-element array", () => {
    expect(cweFilterMatches(adv, ["79", "89"])).toBe(true);
  });
  it("does not match unrelated CWEs", () => {
    expect(cweFilterMatches(adv, ["79"])).toBe(false);
    expect(cweFilterMatches(adv, ["22,306"])).toBe(false);
  });
  it("empty filter matches everything", () => {
    expect(cweFilterMatches(adv, [])).toBe(true);
  });
});
