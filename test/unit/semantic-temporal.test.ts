import { describe, it, expect } from "vitest";
import { parseTemporal, temporalRelevance } from "../../src/semantic/temporal.js";

const NOW = Date.UTC(2026, 8, 13); // 2026-09-13

describe("parseTemporal", () => {
  it("no period -> not present, residual unchanged", () => {
    const t = parseTemporal("sql injection", NOW);
    expect(t.present).toBe(false);
    expect(t.residual).toBe("sql injection");
  });

  it("explicit range", () => {
    const t = parseTemporal("ssrf 2026-01-01..2026-06-30", NOW);
    expect(t.present).toBe(true);
    expect(new Date(t.start).toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(new Date(t.end).toISOString().slice(0, 10)).toBe("2026-07-01"); // end exclusive (+1 day)
    expect(t.residual).toBe("ssrf");
  });

  it("month name + year, strips the phrase", () => {
    const t = parseTemporal("sql injection in August 2026", NOW);
    expect(new Date(t.start).toISOString().slice(0, 7)).toBe("2026-08");
    expect(new Date(t.end).toISOString().slice(0, 7)).toBe("2026-09");
    expect(t.residual).toBe("sql injection in");
  });

  it("relative: last 30 days", () => {
    const t = parseTemporal("rce in the last 30 days", NOW);
    expect(t.present).toBe(true);
    expect(t.start).toBeLessThan(NOW);
    expect(NOW - t.start).toBeGreaterThanOrEqual(30 * 86_400_000 - 1);
    expect(t.residual).toBe("rce in the");
  });

  it("fuzzy 'recent' -> ~last 90 days", () => {
    const t = parseTemporal("recent account takeover", NOW);
    expect(t.present).toBe(true);
    expect(Math.round((NOW - t.start) / 86_400_000)).toBe(90);
    expect(t.residual).toBe("account takeover");
  });

  it("bare year", () => {
    const t = parseTemporal("xss 2024", NOW);
    expect(new Date(t.start).toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(new Date(t.end).toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("single ISO date -> that day", () => {
    const t = parseTemporal("rce 2026-03-05", NOW);
    expect(new Date(t.start).toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(new Date(t.end).toISOString().slice(0, 10)).toBe("2026-03-06");
    expect(t.residual).toBe("rce");
  });

  it("year-month -> whole month", () => {
    const t = parseTemporal("idor 2026-02", NOW);
    expect(new Date(t.start).toISOString().slice(0, 7)).toBe("2026-02");
    expect(new Date(t.end).toISOString().slice(0, 7)).toBe("2026-03");
  });

  it("this month -> start of month .. now", () => {
    const t = parseTemporal("ssrf this month", NOW);
    expect(new Date(t.start).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(t.end).toBeGreaterThan(NOW - 1);
    expect(t.residual).toBe("ssrf");
  });

  it("last year -> previous calendar year", () => {
    const t = parseTemporal("xxe last year", NOW);
    expect(new Date(t.start).toISOString().slice(0, 10)).toBe("2025-01-01");
    expect(new Date(t.end).toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("today / yesterday", () => {
    const today = parseTemporal("today", NOW);
    expect(today.present).toBe(true);
    const y = parseTemporal("yesterday", NOW);
    expect(y.end).toBeLessThanOrEqual(today.start + 1);
  });
});

describe("temporalRelevance", () => {
  const t = parseTemporal("2026-06-01..2026-06-30", NOW);
  it("in-window scores 1.0", () => {
    expect(temporalRelevance(Date.UTC(2026, 5, 15), t)).toBe(1);
  });
  it("outside window decays between 0 and 1", () => {
    const s = temporalRelevance(Date.UTC(2026, 2, 1), t); // ~3 months before
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it("closer dates score higher than farther ones", () => {
    const near = temporalRelevance(Date.UTC(2026, 6, 10), t);
    const far = temporalRelevance(Date.UTC(2025, 0, 1), t);
    expect(near).toBeGreaterThan(far);
  });
  it("unknown date or no period -> 0", () => {
    expect(temporalRelevance(0, t)).toBe(0);
    expect(temporalRelevance(Date.UTC(2026, 5, 15), parseTemporal("no date", NOW))).toBe(0);
  });
});
