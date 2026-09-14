/**
 * Prototype CLI: build the local hybrid index from the advisory DB.
 *
 *   ADVISORY_REPO_PATH=./external/advisory-database \
 *   SEMANTIC_MODEL_CACHE=C:/build/romulus-gym/services/memory/models/.cache \
 *   node dist/semantic/build-index.js --limit 5000
 *
 * --limit N   build over the first N advisories (fast validation); omit for all reviewed.
 */

import { execFileSync } from 'child_process';
import { LocalRepositoryDataSource } from '../datasources/local-repository.js';
import { toDoc, type AdvisoryDoc } from './document.js';
import { embedBatch, modelName, EMBED_DIM } from './embeddings.js';
import { Bm25 } from './bm25.js';
import { saveIndex, indexDir, type IndexMeta } from './store.js';

const REPO = process.env.ADVISORY_REPO_PATH || './external/advisory-database';
const BATCH = Number(process.env.SEMANTIC_BATCH || 64);

function dbCommit(): string {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch { return 'unknown'; }
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  console.error(`[build] repo=${REPO} model=${modelName()} dim=${EMBED_DIM} limit=${limit}`);
  const ds = new LocalRepositoryDataSource(REPO);
  const advisories = await ds.listAdvisories({ type: 'reviewed', per_page: Number.isFinite(limit) ? limit : 1_000_000 });
  const docs: AdvisoryDoc[] = advisories.map(toDoc);
  console.error(`[build] documents: ${docs.length}`);

  const vectors: Float32Array[] = [];
  const t0 = Date.now();
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH).map(d => d.text);
    vectors.push(...await embedBatch(batch));
    if (i % (BATCH * 20) === 0) console.error(`[build] embedded ${i + batch.length}/${docs.length}`);
  }
  console.error(`[build] embeddings done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const bm25 = Bm25.build(docs.map(d => d.id), docs.map(d => d.text));

  const meta: IndexMeta = {
    model: modelName(), dim: EMBED_DIM, count: docs.length,
    dbCommit: dbCommit(), builtAt: new Date().toISOString(),
  };
  await saveIndex(meta, docs, vectors, bm25.toJSON());
  console.error(`[build] saved index -> ${indexDir()} (${docs.length} docs)`);
}

main().catch(err => { console.error(err); process.exit(1); });
