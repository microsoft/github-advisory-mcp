# Correlating advisories with code

The advisory MCP server pairs well with a code-search MCP server (for example
GitHub's hosted `search_code`, or a local semantic code-search server). Together
they turn "is there a known vulnerability like X?" into "here is the matching
code path in this repository, and here is the fix."

- **`advisory`** — this server, over a local clone of `github/advisory-database`.
  Tools: `list_advisories` (filters below) and `get_advisory(ghsa_id)`.
- **code search** — `search_code` (or equivalent) to locate a pattern in source.

## When it helps

- "Do we have advisories for this library / ecosystem / CWE?"
- "Where does the sink described by advisory `GHSA-…` exist in this repo?"
- "Triage which advisories actually reach code in this codebase."
- "Summarise the fix and affected version range for a review."

## The workflow

1. **Scope the class** with `list_advisories` — prefer narrow, structured
   filters over free text:
   - `ecosystem` — accepts GitHub names (`npm`, `pip`, `composer`, `maven`,
     `nuget`, `rubygems`, `go`, `rust`, `erlang`, `pub`, `swift`, `actions`);
     these are mapped to the OSV names in the data (`PyPI`, `Packagist`,
     `crates.io`, `Hex`, …).
   - `cwes` — comma-separated, bare or prefixed (`"89"`, `"CWE-89"`, `"79,89"`).
   - `affects` — package-name substring (`"doctrine"`, `"sequelize"`).
   - `severity` — `low|medium|high|critical|unknown`.
   - `published` / `updated` — single day `"2026-01-27"` or inclusive range
     `"2026-01-01..2026-06-30"`.
   - `sort` (`published|updated`), `direction` (`asc|desc`), `per_page` (≤100).
2. **Read the detail** with `get_advisory(ghsa_id)` — the `description` usually
   contains the vulnerable pattern and the fix; also check `cwes`, `cvss`,
   `vulnerabilities[].vulnerable_version_range`, and `references`.
3. **Extract the pattern** — the concrete code shape the advisory describes.
4. **Find it in code** with `search_code`, scoped to the target repository.
5. **Correlate and act** — confirm the code path uses an affected version, then
   write up the finding, the fix (upgrade / input validation), and the review.

## Worked example

Goal: locate the code behind an ORM query-injection advisory.

1. `get_advisory("GHSA-2xmm-g482-4439")` → *DQL injection through sorting
   parameters* (CVE-2022-24752, CWE-89): a sort/`ORDER BY` value taken from user
   input was passed to the query builder; the fix validates the sort field and
   direction against an allow-list.
2. Pattern: an order/sort value derived from request input and concatenated into
   a query builder.
3. `search_code`: look for `orderBy(` / `addOrderBy(` fed from request/query
   parameters in the target repo.
4. Correlate: a matching call plus an affected dependency version indicates the
   code is reachable; recommend the upstream fix (allow-list the sort field) and
   the version upgrade.

Sibling classes already in the corpus: Sequelize (`affects: "sequelize"`),
Hibernate/NHibernate (`affects: "hibernate"`), Laravel Eloquent
(`affects: "eloquent"`), Django ORM (`ecosystem: "pip"`, `cwes: "89"`).

## Filter recipes

| Goal | Call |
|---|---|
| PHP/Composer SQL-injection cluster | `list_advisories(ecosystem="composer", cwes="89", per_page=50)` |
| Recently-changed criticals | `list_advisories(severity="critical", updated="2026-08-01..2026-09-13")` |
| One package's history | `list_advisories(affects="sequelize")` |
| A specific advisory | `get_advisory("GHSA-…")` |

## Running both servers locally

`.vscode/mcp.json` (local; add a code-search server alongside `advisory`):

```jsonc
{
  "servers": {
    "advisory": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "type": "stdio",
      "env": {
        "ADVISORY_REPO_PATH": "${workspaceFolder}/external/advisory-database",
        "ADVISORY_API_PORT": "18025"
      }
    },
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" }
  }
}
```

The `github` server is optional and requires access to GitHub's hosted MCP; for
a fully local/offline target, use a code-search MCP pointed at the repo instead.

## Notes

- **Search matches literal substrings** of summary/description; there is no
  semantic ranking. Query with concrete terms (library names, CWE ids) and
  prefer the structured filters above.
- **Rebuild + restart** the server after code changes — it runs from `dist/`.
- **Keep the database current**: `git -C external/advisory-database pull` before
  a session, or rely on the server's refresh-on-start.
- **Ports**: the server's local API and the test suite both default around
  18005/18006; the config above moves the server to 18025 so they don't collide.
