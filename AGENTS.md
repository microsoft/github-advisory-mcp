# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Keep changes
minimal, typed, and covered by tests. For contribution policy see
[CONTRIBUTING.md](CONTRIBUTING.md); for user-facing docs see [README.md](README.md).

## What this is

An MCP server that serves GitHub Security Advisories from a local clone of
`github/advisory-database`. Two-tier design: **MCP server (stdio or HTTP) → local
Express REST API → `LocalRepositoryDataSource`** (reads advisory JSON from disk).

Core MCP tools: `list_advisories`, `get_advisory` (full parameters in the README).

## Prerequisites

- **Node.js 20+** (CI runs 20.x and 22.x)
- Git
- The server runs from `dist/` — **rebuild after every source change**.

## Build

```bash
npm install      # or: npm ci  (installs from package-lock.json)
npm run build    # tsc -> dist/
```

## Bootstrap the advisory database (needed to run/serve)

The server reads advisory JSON from `ADVISORY_REPO_PATH` (default
`./external/advisory-database`). Clone it once:

```bash
./scripts/setup-advisory-database.sh
# or manually:
git clone --depth=1 https://github.com/github/advisory-database.git external/advisory-database
```

`external/` is git-ignored. If absent, the server also auto-clones on first tool call.

## Run

stdio (what `.vscode/mcp.json` launches — for VS Code / agent use):

```bash
ADVISORY_REPO_PATH=./external/advisory-database node dist/index.js
```

HTTP streaming:

```bash
MCP_PORT=18006 ADVISORY_API_PORT=18005 \
ADVISORY_REPO_PATH=./external/advisory-database node dist/http-server.js
# health: http://localhost:18006/health
```

## Test

- **Unit (fast, hermetic — start here):** `npx vitest run test/unit`
- **E2E (spawns the server; needs the advisory DB):** `npm run test:e2e`
  - The first `list_advisories` cold-builds an in-memory index over the whole DB;
    if it flakes on the default 30s timeout, raise it:
    `npx vitest run test/e2e --testTimeout=120000`.
- **Integration (Azure OpenAI):** `npm run test:integration` — requires Azure
  credentials; skip unless you're specifically exercising the AI SDK path.
- `npm test` runs **all** suites (including integration). Prefer `test/unit` for
  routine work.

## Project layout

| Path | Role |
|------|------|
| `src/index.ts` | stdio MCP entry (also starts the local REST API) |
| `src/http-server.ts` | HTTP streaming MCP entry + REST API |
| `src/local-server.ts` | local Express REST API the tools call |
| `src/server.ts` | shared MCP tool registration |
| `src/datasources/local-repository.ts` | advisory indexing + filters |
| `src/tools/` | MCP tool schemas/handlers |
| `test/{unit,e2e,integration}/` | test suites |

## Conventions

- TypeScript, ES modules, strict `tsc` build. Add/extend Zod schemas in `src/tools/`
  for any new tool input — inputs are validated at the boundary.
- Rebuild (`npm run build`) and restart the server after edits — it runs from `dist/`.
- Don't commit `dist/`, `external/`, or machine-specific `.vscode/mcp.json` tweaks
  (all git-ignored).

## Key environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADVISORY_REPO_PATH` | `./external/advisory-database` | Advisory DB location |
| `MCP_PORT` | `18006` | HTTP MCP port |
| `ADVISORY_API_PORT` | `18005` | Local REST API port |
| `ADVISORY_API_HOST` | `127.0.0.1` | Local REST API host |
| `ADVISORY_REFRESH_ON_START` | `true` | `git pull` the DB on startup (`false` to skip) |

## Semantic search (prototype)

An optional `semantic_search` tool (local hybrid embeddings + BM25) lives under
`src/semantic/`. Build its index once, then it loads lazily on first call:

```bash
npm run build
node dist/semantic/build-index.js --limit 5000   # omit --limit for the full reviewed corpus
```

Relevant env: `SEMANTIC_MODEL` (default `Xenova/all-MiniLM-L6-v2`),
`SEMANTIC_MODEL_CACHE` (point at a local transformers cache to run offline),
`SEMANTIC_ALLOW_REMOTE=true` (allow model download), `SEMANTIC_INDEX_DIR`.

## Network note

Installs use the public npm registry (`registry.npmjs.org`). If your environment
proxies or mirrors npm, configure a **git-ignored** `.npmrc` pointing at your mirror;
the committed `package-lock.json` keeps canonical public registry URLs.
