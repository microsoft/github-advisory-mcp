# Design note: weekly redistribution of the semantic index

Status: prototype (`proto/semantic-search`). Applies to the local hybrid search
index in `src/semantic/` (see its README).

## Current workflow: manual build → downloadable artifact

`.github/workflows/semantic-index.yml` is a **manually-triggered** build
(`workflow_dispatch`) that rebuilds the index and uploads it as a workflow
**artifact** named `semantic-index` (retention 14 days). It does **not** write to the
repo and does **not** create a Release — so `permissions: contents: read` only, no
branch-protection interaction, no clone bloat. The weekly `schedule` is **deferred**
(not enabled yet).

Run it: **Actions → “Semantic Index (manual build)” → Run workflow**, pick the branch,
optionally set `limit` (default `2000` for a quick test; `0` = full reviewed ~35k).
Download from the run's **Artifacts**, then:

```bash
# unzip the downloaded 'semantic-index' artifact into the repo, then:
mkdir -p .semantic-index && cp -f semantic-index/* .semantic-index/
```

### Who can trigger it (access control)

- **Baseline:** `workflow_dispatch` can only be started by users with **write** access
  — GitHub rejects a dispatch from anyone without it.
- **Narrowed to maintainers/admins:** the `authorize` job checks the actor's
  collaborator permission and fails unless it is `admin` or `maintain`.
- **Hard enforcement (recommended, admin-configured):** create a repo **Environment**
  named `semantic-index` with **required reviewers** = the maintainer team, then add
  `environment: semantic-index` to the `build-index` job. Each run then pauses for
  maintainer approval before doing any work. Left un-wired by default so we don't
  auto-create an environment.

### Enabling the weekly schedule later (deferred)

Add back to the workflow (the `schedule` trigger only fires from the default branch):

```yaml
on:
  schedule:
    - cron: "0 6 * * 1"   # Mondays 06:00 UTC
```

Scheduled runs execute as the repo (no interactive actor), so guard the `authorize`
actor-check with `if: github.event_name == 'workflow_dispatch'`. For *distributing* a
scheduled build's output, choose a Release asset or a git-lfs branch (below) — **not
wired yet.**

## Why redistribute at all

Building the reviewed-tier index (~35k advisories) is a one-off CPU cost
(~15–20 min at fp32 on a typical 4-core CPU) and needs the embedding model +
toolchain. The output is **portable data**, so the right pattern is *build once,
ship the artifact* — consumers read the vectors instead of recomputing them, and
only embed the query at runtime.

## What is distributed

`.semantic-index/` (~100 MB total at 35k):

| File | ~Size @35k | Notes |
|---|---|---|
| `embeddings.bin` | ~52 MB | `count × 384 × 4` bytes, raw float32 |
| `bm25.json` | ~35–45 MB | lexical index (vocab + tf/df) |
| `docs.json` | ~13 MB | rerank/display fields |
| `meta.json` | tiny | model, dim, count, **dbCommit**, builtAt |

Every blob is traceable to the advisory-database commit it was built from
(`meta.dbCommit`) and the model that produced it (`meta.model`).

## Channel: git-lfs

- Track the binary blob (and the large `bm25.json`) via `.gitattributes` LFS:
  ```
  .semantic-index/embeddings.bin filter=lfs diff=lfs merge=lfs -text
  .semantic-index/bm25.json      filter=lfs diff=lfs merge=lfs -text
  ```
- Consumers `git lfs pull`; no re-embedding of the corpus, only query embedding.
- Alternatives: a GitHub **Release asset** (`index.tar.gz`) or an OCI artifact —
  LFS is simplest for "the index lives with the repo," a Release is better if you
  don't want LFS bandwidth on every clone.

## Cross-platform / ABI (portable — with two guards)

- `embeddings.bin` is native-endian float32. All real targets (Windows/Linux/mac,
  x86-64 **and** ARM64) are little-endian and IEEE-754, so bytes round-trip
  everywhere. Harden by writing/reading with an explicit little-endian `DataView`
  and stamping a `formatVersion`.
- Consumers must embed **queries** with the *same model* the blob was built with,
  or the query lands in a different vector space. Pin the model **revision** and,
  on load, assert `meta.model === runtimeModel` and `meta.dim === EMBED_DIM`.
- `onnxruntime-node` ships per-platform prebuilt binaries — an install concern for
  query embedding, not a data concern; the blob itself is arch-neutral.
- Re-embedding is **not** bit-identical across arch/EP/thread-count (last-few-ULP),
  but distributing the prebuilt blob sidesteps that entirely; keep one canonical
  builder platform for reproducible artifacts.

## Weekly schedule on GitHub Actions — can it run in 30 min?

Platform limits are 6 h/job (hosted) / 5 days (self-hosted), so **30 min is a
budget, not a limit**. Budget for a *full* rebuild on `ubuntu-latest` (4 vCPU):

| Step | ~Time |
|---|---|
| checkout (+lfs) | ~30 s |
| advisory-db shallow clone | ~1–3 min (cacheable) |
| npm ci + build | ~1–2 min (cacheable) |
| model fetch | ~30 s (cacheable) |
| embed 35k (fp32, 4 vCPU) | ~15–25 min |
| git-lfs push (~100 MB) | ~1–2 min |
| **total** | **~20–33 min** |

So a full rebuild is **borderline** on the smallest runner. It fits 30 min
comfortably with any of:

1. **Incremental (recommended steady state):** only re-embed advisories changed
   since the previous `meta.dbCommit` (`git diff --name-only <prev>..HEAD`). Weekly
   advisory churn is hundreds, not 35k → **seconds**, not minutes. Full rebuild
   only when the model/format version changes.
2. **Bigger runner** (8/16 vCPU): ONNX scales near-linearly → embeddings ~5–10 min.
3. **Quantized model** (int8 MiniLM ONNX): ~2–4× faster embeddings.
4. **Cache** the DB clone + model weights (`actions/cache`) to remove startup cost.
5. **Shard** the corpus across a matrix and merge (for the initial full build).

## Recommended pipeline (sketch)

```yaml
on:
  schedule: [{ cron: "0 6 * * 1" }]   # weekly
  workflow_dispatch: {}
jobs:
  build-index:
    runs-on: ubuntu-latest            # or a larger runner for full rebuilds
    steps:
      - uses: actions/checkout@v7      # with: lfs: true
      - restore caches: advisory-db, model weights, npm
      - shallow update external/advisory-database
      - npm ci && npm run build
      - node dist/semantic/build-index.js --since <prev meta.dbCommit>  # incremental (future flag)
      - assert meta.model/dim; commit .semantic-index via git-lfs (or upload a Release asset)
```

## Caveats

- **Size/bandwidth:** ~100 MB/week; LFS stores whole objects per version, so gzip
  the blob and prefer incremental re-embedding to minimize churn.
- **Freshness vs cost:** weekly cadence balances advisory-database churn against
  rebuild cost; bump to daily only with incremental builds.
- **Canonical builder:** pin the runner OS/arch + model revision so the published
  artifact is reproducible; record all of it in `meta.json`.
