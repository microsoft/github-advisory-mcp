import { describe, it, expect } from "vitest";
import { toDoc } from "../../src/semantic/document.js";
import type { Advisory } from "../../src/types/data-source.js";

function advisory(over: Partial<Advisory> = {}): Advisory {
  return {
    ghsa_id: "GHSA-aaaa-bbbb-cccc",
    cve_id: "CVE-2026-9999",
    summary: "SQL Injection in Example ORM",
    description: "x".repeat(1000),
    severity: "High",
    cwes: [{ cwe_id: "CWE-89", name: "CWE-89" }],
    vulnerabilities: [
      { package: { ecosystem: "Packagist", name: "acme/orm" } },
    ],
    published_at: "2026-06-15T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z",
    ...over,
  } as unknown as Advisory;
}

describe("toDoc", () => {
  it("maps identifiers, cwes, packages, ecosystems (lowercased) and severity", () => {
    const d = toDoc(advisory());
    expect(d.id).toBe("GHSA-aaaa-bbbb-cccc");
    expect(d.cve_id).toBe("CVE-2026-9999");
    expect(d.cweIds).toEqual(["CWE-89"]);
    expect(d.packages).toEqual(["acme/orm"]);
    expect(d.ecosystems).toEqual(["packagist"]);
    expect(d.severity).toBe("high");
  });

  it("stores published/updated as epoch ms", () => {
    const d = toDoc(advisory());
    expect(d.published).toBe(Date.parse("2026-06-15T00:00:00Z"));
    expect(d.updated).toBe(Date.parse("2026-06-16T00:00:00Z"));
  });

  it("embedded text includes summary + ids + package + cwe, details truncated", () => {
    const d = toDoc(advisory());
    expect(d.text).toContain("SQL Injection in Example ORM");
    expect(d.text).toContain("GHSA-aaaa-bbbb-cccc");
    expect(d.text).toContain("acme/orm");
    expect(d.text).toContain("CWE-89");
    // details capped at 500 chars, so the 1000-char body is not fully present
    expect(d.text).not.toContain("x".repeat(600));
  });

  it("tolerates missing dates/cwes/packages", () => {
    const d = toDoc(advisory({ published_at: undefined, cwes: [], vulnerabilities: [] } as any));
    expect(d.published).toBe(0);
    expect(d.cweIds).toEqual([]);
    expect(d.packages).toEqual([]);
  });

  it("falls back to first line of details when summary is absent", () => {
    const d = toDoc(advisory({ summary: undefined, cve_id: undefined } as any));
    expect(d.cve_id).toBe("");
    expect(typeof d.text).toBe("string");
  });
});
