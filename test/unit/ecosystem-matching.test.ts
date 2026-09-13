import { describe, it, expect } from "vitest";
import { ecosystemMatches } from "../../src/datasources/local-repository.js";

describe("ecosystemMatches", () => {
  // GitHub tool-schema enum value -> OSV ecosystem name stored in advisory-database
  const cases: Array<[string, string]> = [
    ["npm", "npm"],
    ["pip", "PyPI"],
    ["maven", "Maven"],
    ["nuget", "NuGet"],
    ["rubygems", "RubyGems"],
    ["composer", "Packagist"],
    ["go", "Go"],
    ["rust", "crates.io"],
    ["erlang", "Hex"],
    ["pub", "Pub"],
    ["swift", "SwiftURL"],
    ["actions", "GitHub Actions"],
  ];

  it.each(cases)(
    "matches GitHub enum '%s' against OSV name '%s'",
    (enumValue, osvName) => {
      expect(ecosystemMatches(osvName, enumValue)).toBe(true);
    }
  );

  it("accepts the OSV name passed directly", () => {
    expect(ecosystemMatches("Packagist", "Packagist")).toBe(true);
    expect(ecosystemMatches("PyPI", "pypi")).toBe(true);
  });

  it("is case-insensitive on the package ecosystem", () => {
    expect(ecosystemMatches("packagist", "composer")).toBe(true);
  });

  it("does not match unrelated ecosystems", () => {
    expect(ecosystemMatches("PyPI", "composer")).toBe(false);
    expect(ecosystemMatches("npm", "pip")).toBe(false);
  });
});
