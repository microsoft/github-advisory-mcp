# Semantic search — how to run (code layout)

> Prototype on branch `proto/semantic-search`. Runs entirely on-device (no external
> engine or service).
>
> **Design & rationale live in a separate doc:**
> [`docs/semantic-search-design.md`](../../docs/semantic-search-design.md). This file
> is the practical "build and run the index" guide next to the code.

Hybrid retrieval for advisories: local embeddings + BM25, fused with Reciprocal
Rank Fusion, then a field-aware + temporal rerank. Exposed as the `semantic_search`
MCP tool (stdio + HTTP), alongside `list_advisories` / `get_advisory`.
Advisory-specific (GHSA/CVE ids, summary, CWEs, affected packages, ecosystem,
severity) — not a general-purpose memory store.

## Pieces

| File | Role |
|---|---|
| `document.ts` | Advisory → searchable doc (embedded text + rerank fields) |
| `embeddings.ts` | Local ONNX embeddings (`@huggingface/transformers`, MiniLM 384-dim), offline |
| `bm25.ts` | Compact Okapi BM25, identifier-preserving tokenizer |
| `temporal.ts` | Parse a period from the query + score publish-date proximity |
| `store.ts` | Persist/load `embeddings.bin` + `bm25.json` + `docs.json` + `meta.json` |
| `hybrid.ts` | Vector kNN ∪ BM25 → RRF → field-aware + temporal rerank |
| `build-index.ts` | CLI: build the index from the advisory DB |
| `query.ts` | CLI: query the index |

## Run

```powershell
# point at a pre-downloaded @huggingface/transformers cache to stay offline
# (omit it + set SEMANTIC_ALLOW_REMOTE=true to download the model instead)
$env:SEMANTIC_MODEL_CACHE = "<path to a transformers cache>"
$env:ADVISORY_REPO_PATH   = "./external/advisory-database"

npm run build
node dist/semantic/build-index.js --limit 5000   # omit --limit for all reviewed
node dist/semantic/query.js "blind ORM injection via sort parameter" --top 8
```

## Config (env)

- `SEMANTIC_MODEL` (default `Xenova/all-MiniLM-L6-v2`), `SEMANTIC_DIM` (384)
- `SEMANTIC_MODEL_CACHE` — transformers cache dir (point at a pre-downloaded cache)
- `SEMANTIC_ALLOW_REMOTE=true` — allow HF download (default offline)
- `SEMANTIC_INDEX_DIR` (default `./.semantic-index`), `SEMANTIC_BATCH` (64)

## Temporal-aware reranking

If a query mentions a period, that intent is parsed out (`temporal.ts`), the
*residual* text drives semantic + BM25 recall, and a proximity score reranks by
how close each advisory's `published` date is to the window:

- Recognized: explicit range `2026-01-01..2026-06-30`, ISO date, `2026-08`,
  month names (`August 2026`), `last/past N days|weeks|months|years`,
  `this/last week|month|year`, `today`/`yesterday`, bare year, and fuzzy
  `recent|latest` (→ last 90 days).
- In-window → 1.0; outside → exponential decay (half-life 45 days), added with a
  small weight so it reorders *within* relevant results rather than becoming a
  hard date sort. Example: `"sql injection in june 2026"` lifts June/early-July
  advisories above later ones while every hit stays SQL-injection.
- A hard date filter still lives in the structured `published`/`updated` params.

## Design notes / next steps

- **Storage** is a flat `Float32Array` + brute-force cosine — fine for the ~35k
  reviewed tier (<50 ms). For the 370k unreviewed tier, swap in ANN (hnswlib).
- **Reranking** is currently field-aware (exact id / package / CWE / phrase). The
  `rerankScore` interface can be replaced by a local cross-encoder (e.g.
  `Xenova/bge-reranker-base`) with no other changes.
- **Incremental**: rebuild only changed advisories via `git diff` between the
  cached `dbCommit` and current `HEAD` (not yet implemented).
- **Not wired to MCP**: a `semantic_search` tool that combines this with the
  structured filters (`ecosystem`, `cwes`, `web_app_only`, date ranges) is the
  intended next step.
