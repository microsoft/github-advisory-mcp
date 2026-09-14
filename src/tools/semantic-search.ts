/**
 * semantic_search tool — local hybrid retrieval over the prototype index.
 * Loads the on-disk index + embedding model in-process; no external service.
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../logger.js';
import { indexExists, loadIndex, indexDir, type LoadedIndex } from '../semantic/store.js';
import { hybridSearch } from '../semantic/hybrid.js';
import { ecosystemMatches, cweFilterMatches, isWebAppAdvisory } from '../datasources/local-repository.js';

const logger = createLogger('Tools');

export const semanticSearchSchema = z.object({
  query: z.string().describe('Natural-language query. May include a period ("SSRF in August 2026", "recent RCE") — the date drives temporal reranking.'),
  top_k: z.number().min(1).max(50).optional().describe('Number of results (default 10)'),
  web_app_only: z.boolean().optional().describe('Keep only web-application vulnerability classes (by CWE)'),
  severity: z.enum(['low', 'medium', 'high', 'critical', 'unknown']).optional().describe('Post-filter by severity'),
  ecosystem: z.enum(['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift']).optional().describe('Post-filter by package ecosystem'),
  cwes: z.string().optional().describe('Comma-separated CWE ids to require (e.g. "89" or "CWE-89,79")'),
});

let cachedIndex: LoadedIndex | null = null;

async function getIndex(): Promise<LoadedIndex | null> {
  if (cachedIndex) return cachedIndex;
  if (!indexExists()) return null;
  cachedIndex = await loadIndex();
  return cachedIndex;
}

export async function semanticSearch(params: unknown): Promise<CallToolResult> {
  const p = semanticSearchSchema.parse(params ?? {});
  logger.debug('semantic_search called', { query: p.query });

  const index = await getIndex();
  if (!index) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Semantic index not found at ${indexDir()}. Build it first:\n` +
          `  ADVISORY_REPO_PATH=./external/advisory-database \\\n` +
          `  SEMANTIC_MODEL_CACHE=<transformers cache dir> \\\n` +
          `  node dist/semantic/build-index.js --limit 5000`,
      }],
    };
  }

  const topK = p.top_k ?? 10;
  const cweReq = p.cwes ? [p.cwes] : null;

  // Over-fetch, then apply structured post-filters, then slice.
  const raw = await hybridSearch(index, p.query, Math.max(topK * 5, 50));
  const filtered = raw.filter(h => {
    if (p.severity && h.severity !== p.severity) return false;
    if (p.ecosystem && !h.ecosystems.some(e => ecosystemMatches(e, p.ecosystem!))) return false;
    if (cweReq && !cweFilterMatches(h.cweIds, cweReq)) return false;
    if (p.web_app_only && !isWebAppAdvisory(h.cweIds)) return false;
    return true;
  }).slice(0, topK);

  const results = filtered.map(h => ({
    ghsa_id: h.ghsa_id,
    cve_id: h.cve_id || undefined,
    summary: h.summary,
    severity: h.severity,
    published_at: h.published ? new Date(h.published).toISOString() : undefined,
    cwes: h.cweIds,
    packages: h.packages.slice(0, 8),
    ecosystems: [...new Set(h.ecosystems)],
    score: Number(h.scores.final.toFixed(4)),
    temporal_relevance: Number(h.scores.temporal.toFixed(2)),
    url: `https://github.com/advisories/${h.ghsa_id}`,
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        query: p.query,
        count: results.length,
        index: { docs: index.meta.count, model: index.meta.model, db_commit: index.meta.dbCommit },
        results,
      }, null, 2),
    }],
  };
}
