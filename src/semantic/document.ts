/**
 * Advisory -> searchable document. Prototype, advisory-specific (no generic memory).
 *
 * We keep two views of each advisory:
 *  - `text`   : the string we embed and BM25-tokenize (semantic + lexical recall)
 *  - `fields` : structured fields the reranker uses for exact/near-exact boosts
 */

import type { Advisory } from '../types/data-source.js';

export interface AdvisoryDoc {
  id: string;                // ghsa_id
  text: string;              // embedded + tokenized
  ghsa_id: string;
  cve_id: string;
  summary: string;
  cweIds: string[];          // e.g. ["CWE-89"]
  packages: string[];        // affected package names (lowercased)
  ecosystems: string[];      // OSV ecosystem names (lowercased)
  severity: string;
  published: number;         // epoch ms (0 if unknown) — used for temporal rerank
  updated: number;           // epoch ms (0 if unknown)
}

const DETAILS_MAX = 500; // embedding models truncate ~512 tokens; keep the tail cheap

export function toDoc(a: Advisory): AdvisoryDoc {
  const cweIds = (a.cwes || []).map(c => c.cwe_id);
  const packages = (a.vulnerabilities || []).map(v => v.package?.name).filter(Boolean) as string[];
  const ecosystems = (a.vulnerabilities || []).map(v => v.package?.ecosystem).filter(Boolean) as string[];
  const cweNames = cweIds.join(' ');
  const details = (a.description || '').slice(0, DETAILS_MAX);

  // Field order matters for lexical weighting: summary first, then identifiers,
  // then the taxonomy/package signals, then a slice of the details.
  const text = [
    a.summary || '',
    a.ghsa_id,
    a.cve_id || '',
    packages.join(' '),
    ecosystems.join(' '),
    cweNames,
    details,
  ].filter(Boolean).join('\n');

  return {
    id: a.ghsa_id,
    text,
    ghsa_id: a.ghsa_id,
    cve_id: a.cve_id || '',
    summary: a.summary || '',
    cweIds,
    packages: packages.map(p => p.toLowerCase()),
    ecosystems: ecosystems.map(e => e.toLowerCase()),
    severity: (a.severity || '').toLowerCase(),
    published: a.published_at ? Date.parse(a.published_at) || 0 : 0,
    updated: a.updated_at ? Date.parse(a.updated_at) || 0 : 0,
  };
}
