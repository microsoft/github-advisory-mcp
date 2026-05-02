/**
 * Unit tests for LocalRepositoryDataSource date filtering logic.
 *
 * Covers `parseDateFilter` and `filterByDateRange` edge cases that the
 * E2E suite cannot reach reliably (invalid input, reversed ranges, etc.).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalRepositoryDataSource } from "../../src/datasources/local-repository.js";
import type { Advisory } from "../../src/types/data-source.js";

// Type alias for accessing the private members under test without changing
// the production class's public API.
type DateFilterInternals = {
  parseDateFilter(dateStr: string): { start: string; end: string };
  filterByDateRange(
    advisories: Advisory[],
    field: "published_at" | "updated_at",
    dateStr: string
  ): Advisory[];
};

describe("LocalRepositoryDataSource - parseDateFilter", () => {
  let internals: DateFilterInternals;

  beforeEach(() => {
    const ds = new LocalRepositoryDataSource("/nonexistent/repo");
    internals = ds as unknown as DateFilterInternals;
  });

  describe("single date", () => {
    it("returns full-day window for a valid YYYY-MM-DD", () => {
      const { start, end } = internals.parseDateFilter("2026-01-27");
      expect(start).toBe("2026-01-27T00:00:00.000Z");
      expect(end).toBe("2026-01-28T00:00:00.000Z");
    });

    it("throws on invalid month", () => {
      expect(() => internals.parseDateFilter("2026-13-01")).toThrowError(
        /Invalid date "2026-13-01"/
      );
    });

    it("throws on completely malformed input", () => {
      expect(() => internals.parseDateFilter("not-a-date")).toThrowError(
        /Invalid date "not-a-date"/
      );
    });
  });

  describe("date range", () => {
    it("returns inclusive range for valid YYYY-MM-DD..YYYY-MM-DD", () => {
      const { start, end } = internals.parseDateFilter(
        "2026-01-01..2026-01-31"
      );
      expect(start).toBe("2026-01-01T00:00:00.000Z");
      // End is exclusive (next day midnight) so January 31 is fully included.
      expect(end).toBe("2026-02-01T00:00:00.000Z");
    });

    it("accepts equal start and end (single-day range)", () => {
      const { start, end } = internals.parseDateFilter(
        "2026-01-15..2026-01-15"
      );
      expect(start).toBe("2026-01-15T00:00:00.000Z");
      expect(end).toBe("2026-01-16T00:00:00.000Z");
    });

    it("throws when range has more than two parts", () => {
      expect(() =>
        internals.parseDateFilter("2026-01-01..2026-02-01..2026-03-01")
      ).toThrowError(/Invalid date range/);
    });

    it("throws when range is missing the end side", () => {
      expect(() => internals.parseDateFilter("2026-01-01..")).toThrowError(
        /Invalid date range/
      );
    });

    it("throws when range is missing the start side", () => {
      expect(() => internals.parseDateFilter("..2026-01-31")).toThrowError(
        /Invalid date range/
      );
    });

    it("throws when start side is not a real date", () => {
      expect(() =>
        internals.parseDateFilter("2026-13-45..2026-12-31")
      ).toThrowError(/Invalid date in range/);
    });

    it("throws when end side is not a real date", () => {
      expect(() =>
        internals.parseDateFilter("2026-01-01..invalid")
      ).toThrowError(/Invalid date in range/);
    });

    it("throws when start is after end (reversed range)", () => {
      expect(() =>
        internals.parseDateFilter("2026-12-31..2026-01-01")
      ).toThrowError(/start date must be less than or equal to end date/);
    });
  });
});

describe("LocalRepositoryDataSource - filterByDateRange", () => {
  let internals: DateFilterInternals;

  beforeEach(() => {
    const ds = new LocalRepositoryDataSource("/nonexistent/repo");
    internals = ds as unknown as DateFilterInternals;
  });

  function makeAdvisory(id: string, publishedIso: string): Advisory {
    return {
      ghsa_id: id,
      cve_id: null,
      url: "",
      html_url: "",
      summary: "",
      description: "",
      type: "reviewed",
      severity: "high",
      repository_advisory_url: null,
      source_code_location: null,
      identifiers: [],
      references: [],
      published_at: publishedIso,
      updated_at: publishedIso,
      github_reviewed_at: publishedIso,
      nvd_published_at: null,
      withdrawn_at: null,
      vulnerabilities: [],
      cvss: { vector_string: null, score: null },
      cvss_severities: {
        cvss_v3: { vector_string: null, score: null },
        cvss_v4: { vector_string: null, score: null },
      },
      epss: undefined,
      cwes: [],
      credits: [],
    } as unknown as Advisory;
  }

  it("returns only advisories within an inclusive single-day window", () => {
    const advisories = [
      makeAdvisory("A", "2026-01-26T23:59:59.000Z"),
      makeAdvisory("B", "2026-01-27T00:00:00.000Z"),
      makeAdvisory("C", "2026-01-27T12:30:00.000Z"),
      makeAdvisory("D", "2026-01-28T00:00:00.000Z"),
    ];
    const filtered = internals.filterByDateRange(
      advisories,
      "published_at",
      "2026-01-27"
    );
    expect(filtered.map((a) => a.ghsa_id)).toEqual(["B", "C"]);
  });

  it("includes the end date in a YYYY-MM-DD..YYYY-MM-DD range", () => {
    const advisories = [
      makeAdvisory("A", "2026-01-31T23:00:00.000Z"),
      makeAdvisory("B", "2026-02-01T00:00:00.000Z"),
    ];
    const filtered = internals.filterByDateRange(
      advisories,
      "published_at",
      "2026-01-01..2026-01-31"
    );
    expect(filtered.map((a) => a.ghsa_id)).toEqual(["A"]);
  });

  it("propagates errors for invalid input", () => {
    const advisories = [makeAdvisory("A", "2026-01-15T00:00:00.000Z")];
    expect(() =>
      internals.filterByDateRange(advisories, "published_at", "bad-date")
    ).toThrowError(/Invalid date "bad-date"/);
  });
});
