/**
 * Prototype CLI: query the local hybrid index.
 *
 *   SEMANTIC_MODEL_CACHE=<path to a transformers cache> \
 *   node dist/semantic/query.js "blind ORM injection via sort parameter" --top 8
 */

import { indexExists, loadIndex } from './store.js';
import { hybridSearch } from './hybrid.js';

async function main() {
  const args = process.argv.slice(2);
  const topIdx = args.indexOf('--top');
  const top = topIdx !== -1 ? Number(args[topIdx + 1]) : 10;
  const query = args.filter((a, i) => a !== '--top' && args[i - 1] !== '--top').join(' ').trim();

  if (!query) { console.error('usage: query.js "<text>" [--top N]'); process.exit(2); }
  if (!indexExists()) { console.error('No index found. Run build-index.js first.'); process.exit(1); }

  const index = await loadIndex();
  console.error(`[query] index: ${index.meta.count} docs, model ${index.meta.model}, DB ${index.meta.dbCommit}`);
  const t0 = Date.now();
  const hits = await hybridSearch(index, query, top);
  console.error(`[query] "${query}" -> ${hits.length} hits in ${Date.now() - t0}ms\n`);

  hits.forEach((h, i) => {
    const pub = h.published ? new Date(h.published).toISOString().slice(0, 10) : '----------';
    console.log(`${(i + 1).toString().padStart(2)}. ${h.ghsa_id}  [${h.severity}]  pub=${pub}  ${h.summary}`);
    console.log(`    cwes=${h.cweIds.join(',') || '-'}  pkgs=${h.packages.slice(0, 4).join(',') || '-'}`);
    console.log(`    final=${h.scores.final.toFixed(4)} rrf=${h.scores.rrf.toFixed(4)} vec=${h.scores.vector.toFixed(3)} bm25Rank=${h.scores.bm25Rank} rerank=${h.scores.rerank.toFixed(1)} temporal=${h.scores.temporal.toFixed(2)}`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
