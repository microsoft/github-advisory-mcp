/**
 * Local advisory database repository implementation
 * Reads advisories from cloned github/advisory-database repository
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { IAdvisoryDataSource, Advisory, AdvisoryListOptions } from '../types/data-source.js';

/**
 * OSV (Open Source Vulnerability) format from advisory-database
 */
interface OSVAdvisory {
  schema_version: string;
  id: string;
  modified: string;
  published: string;
  withdrawn?: string;
  aliases: string[];
  summary?: string;
  details: string;
  severity: Array<{
    type: string;
    score: string;
  }>;
  affected: Array<{
    package: {
      ecosystem: string;
      name: string;
      purl?: string;
    };
    ranges: Array<{
      type: string;
      events: Array<{
        introduced?: string;
        fixed?: string;
        last_affected?: string;
        limit?: string;
      }>;
    }>;
    versions?: string[];
    database_specific?: {
      source?: string;
      last_known_affected_version_range?: string;
    };
    ecosystem_specific?: any;
  }>;
  references: Array<{
    type: string;
    url: string;
  }>;
  database_specific: {
    cwe_ids: string[];
    severity: string;
    github_reviewed: boolean;
    github_reviewed_at: string | null;
    nvd_published_at: string | null;
  };
  credits?: Array<{
    name: string;
    contact?: string[];
    type?: string;
  }>;
}

/**
 * Data source that reads from local cloned github/advisory-database repository
 */
export class LocalRepositoryDataSource implements IAdvisoryDataSource {
  private repoPath: string;
  private cache: Map<string, Advisory> = new Map();
  private indexBuilt: boolean = false;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  getSourceType(): 'local-repository' {
    return 'local-repository';
  }

  /**
   * Calculate CVSS 3.x score from vector string
   * Simplified calculation - returns approximate score based on metrics
   */
  private calculateCVSS3Score(vectorString: string): number {
    // Parse CVSS vector: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
    const metrics: Record<string, string> = {};
    const parts = vectorString.split('/');
    
    for (const part of parts.slice(1)) { // Skip CVSS:3.1
      const [key, value] = part.split(':');
      if (key && value) {
        metrics[key] = value;
      }
    }

    // Attack Vector impact
    let avScore = 0;
    if (metrics.AV === 'N') avScore = 0.85;
    else if (metrics.AV === 'A') avScore = 0.62;
    else if (metrics.AV === 'L') avScore = 0.55;
    else if (metrics.AV === 'P') avScore = 0.2;

    // Attack Complexity impact
    let acScore = 0;
    if (metrics.AC === 'L') acScore = 0.77;
    else if (metrics.AC === 'H') acScore = 0.44;

    // Privileges Required impact (depends on Scope)
    let prScore = 0;
    if (metrics.PR === 'N') prScore = 0.85;
    else if (metrics.PR === 'L') prScore = metrics.S === 'C' ? 0.68 : 0.62;
    else if (metrics.PR === 'H') prScore = metrics.S === 'C' ? 0.50 : 0.27;

    // User Interaction impact
    let uiScore = 0;
    if (metrics.UI === 'N') uiScore = 0.85;
    else if (metrics.UI === 'R') uiScore = 0.62;

    // Impact scores (CIA) - these are the confidentiality, integrity, availability impacts
    let cScore = 0;
    if (metrics.C === 'H') cScore = 0.56;
    else if (metrics.C === 'L') cScore = 0.22;
    else if (metrics.C === 'N') cScore = 0;

    let iScore = 0;
    if (metrics.I === 'H') iScore = 0.56;
    else if (metrics.I === 'L') iScore = 0.22;
    else if (metrics.I === 'N') iScore = 0;

    let aScore = 0;
    if (metrics.A === 'H') aScore = 0.56;
    else if (metrics.A === 'L') aScore = 0.22;
    else if (metrics.A === 'N') aScore = 0;

    // Calculate exploitability
    const exploitability = 8.22 * avScore * acScore * prScore * uiScore;

    // Impact Sub-Score (ISS) calculation (official CVSS 3.x formula)
    // ISS = 1 - [(1 - ImpactConf) × (1 - ImpactInteg) × (1 - ImpactAvail)]
    const impactSubScore = 1 - ((1 - cScore) * (1 - iScore) * (1 - aScore));
    
    // Impact calculation depends on Scope
    let impact = 0;
    if (metrics.S === 'C') {
      // Scope Changed: 7.52 × (ISS - 0.029) - 3.25 × (ISS × 0.9731 - 0.02)^13
      impact = 7.52 * (impactSubScore - 0.029) - 3.25 * Math.pow(impactSubScore * 0.9731 - 0.02, 13);
    } else {
      // Scope Unchanged: 6.42 × ISS
      impact = 6.42 * impactSubScore;
    }

    // Calculate base score
    let baseScore = 0;
    if (impact <= 0) {
      baseScore = 0;
    } else if (metrics.S === 'U') {
      baseScore = Math.min(impact + exploitability, 10);
    } else {
      // Scope Changed: Roundup(Minimum[(Impact + Exploitability) × 1.08, 10])
      baseScore = Math.min(1.08 * (impact + exploitability), 10);
    }

    // Round UP to 1 decimal place (CVSS spec)
    return Math.ceil(baseScore * 10) / 10;
  }

  /**
   * Build index of all advisories (lazy loaded)
   */
  private async buildIndex(): Promise<void> {
    if (this.indexBuilt) return;

    const reviewedPath = join(this.repoPath, 'advisories', 'github-reviewed');
    await this.indexDirectory(reviewedPath);
    
    this.indexBuilt = true;
  }

  /**
   * Recursively index advisory JSON files
   */
  private async indexDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.indexDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const osv: OSVAdvisory = JSON.parse(content);
            const advisory = this.osvToAdvisory(osv);
            this.cache.set(advisory.ghsa_id, advisory);
          } catch (err) {
            console.error(`Failed to parse ${fullPath}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to read directory ${dir}:`, err);
    }
  }

  /**
   * Convert OSV format to GitHub Advisory format
   */
  private osvToAdvisory(osv: OSVAdvisory): Advisory {
    const cveId = osv.aliases.find(alias => alias.startsWith('CVE-')) || '';
    
    // Extract CVSS score if available
    const cvssVector = osv.severity.find(s => s.type === 'CVSS_V3');
    let cvss: Advisory['cvss'] = null;
    let cvss_severities: Advisory['cvss_severities'] = undefined;
    
    if (cvssVector) {
      // CVSS vector format: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
      // Calculate score based on the vector (simplified calculation)
      const score = this.calculateCVSS3Score(cvssVector.score);
      cvss = {
        vector_string: cvssVector.score,
        score: score,
      };
      
      // Add cvss_severities array (GitHub API includes this)
      cvss_severities = [{
        score: score,
        type: 'CVSS_V3',
        vector_string: cvssVector.score,
      }];
    }

    // Map CWE IDs to names (simplified - in production you'd want a CWE lookup table)
    const cwes = osv.database_specific.cwe_ids.map(cweId => ({
      cwe_id: cweId,
      name: cweId, // Simplified - would need CWE database for full names
    }));

    // Build vulnerabilities array from affected packages
    const vulnerabilities = osv.affected?.map(affected => {
      const range = affected.ranges?.[0];
      const events = range?.events || [];
      
      let vulnerableRange = '*';
      if (events.length > 0) {
        const introduced = events.find(e => e.introduced)?.introduced || '';
        const fixed = events.find(e => e.fixed)?.fixed || '';
        if (introduced && fixed) {
          vulnerableRange = `>= ${introduced}, < ${fixed}`;
        } else if (introduced) {
          vulnerableRange = `>= ${introduced}`;
        } else if (fixed) {
          vulnerableRange = `< ${fixed}`;
        }
      }

      const firstPatchedVersion = events.find(e => e.fixed)?.fixed || null;

      return {
        package: {
          ecosystem: affected.package?.ecosystem || 'Unknown',
          name: affected.package?.name || 'unknown',
        },
        severity: osv.database_specific?.severity || 'unknown',
        vulnerable_version_range: vulnerableRange,
        first_patched_version: firstPatchedVersion,
      };
    }) || [];

    return {
      ghsa_id: osv.id,
      cve_id: cveId,
      url: `https://github.com/advisories/${osv.id}`,
      html_url: `https://github.com/advisories/${osv.id}`,
      repository_advisory_url: null,
      summary: osv.summary || osv.details.split('\n')[0],
      description: osv.details,
      type: 'reviewed',
      severity: osv.database_specific.severity.toLowerCase(),
      source_code_location: null,
      identifiers: [
        { type: 'GHSA', value: osv.id },
        ...(cveId ? [{ type: 'CVE', value: cveId }] : []),
      ],
      references: osv.references.map(ref => ref.url),
      published_at: osv.published,
      updated_at: osv.modified,
      github_reviewed_at: osv.database_specific.github_reviewed_at,
      nvd_published_at: osv.database_specific.nvd_published_at,
      withdrawn_at: osv.withdrawn || null,
      vulnerabilities,
      cvss,
      cvss_severities,
      epss: undefined, // EPSS data not available in OSV format
      cwes,
      credits: [], // OSV credits format is different from GitHub API
    };
  }

  /**
   * Parse date filter string and return start/end dates
   * Supports: "2026-01-27" (single day) or "2026-01-01..2026-01-31" (range)
   */
  private parseDateFilter(dateStr: string): { start: string; end: string } {
    if (dateStr.includes('..')) {
      const [start, end] = dateStr.split('..');
      // End date: include full day by using next day midnight
      const endDate = new Date(end + 'T00:00:00Z');
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      return { start: start + 'T00:00:00Z', end: endDate.toISOString() };
    }
    // Single date: filter for that specific day
    const startDate = new Date(dateStr + 'T00:00:00Z');
    const endDate = new Date(dateStr + 'T00:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return { start: startDate.toISOString(), end: endDate.toISOString() };
  }

  /**
   * Filter advisories by date range
   */
  private filterByDateRange(advisories: Advisory[], field: 'published_at' | 'updated_at', dateStr: string): Advisory[] {
    const { start, end } = this.parseDateFilter(dateStr);
    return advisories.filter(a => {
      const date = a[field];
      return date >= start && date < end;
    });
  }

  /**
   * List advisories with optional filtering
   */
  async listAdvisories(options: AdvisoryListOptions = {}): Promise<Advisory[]> {
    await this.buildIndex();

    let results = Array.from(this.cache.values());

    // Apply filters
    if (options.ghsa_id) {
      results = results.filter(a => a.ghsa_id === options.ghsa_id);
    }

    if (options.cve_id) {
      results = results.filter(a => a.cve_id === options.cve_id);
    }

    if (options.ecosystem) {
      results = results.filter(a =>
        a.vulnerabilities.some(v => v.package.ecosystem === options.ecosystem)
      );
    }

    if (options.severity) {
      results = results.filter(a => 
        a.severity.toLowerCase() === options.severity!.toLowerCase()
      );
    }

    if (options.cwes && options.cwes.length > 0) {
      results = results.filter(a =>
        a.cwes.some(cwe => options.cwes!.includes(cwe.cwe_id))
      );
    }

    if (options.is_withdrawn !== undefined) {
      results = results.filter(a =>
        options.is_withdrawn ? a.withdrawn_at !== null : a.withdrawn_at === null
      );
    }

    if (options.affects) {
      results = results.filter(a =>
        a.vulnerabilities.some(v => v.package.name.includes(options.affects!))
      );
    }

    if (options.published) {
      results = this.filterByDateRange(results, 'published_at', options.published);
    }

    if (options.updated) {
      results = this.filterByDateRange(results, 'updated_at', options.updated);
    }

    // Sort results
    const sortField = options.sort || 'published';
    results.sort((a, b) => {
      const aDate = sortField === 'published' ? a.published_at : a.updated_at;
      const bDate = sortField === 'published' ? b.published_at : b.updated_at;
      return options.direction === 'asc'
        ? aDate.localeCompare(bDate)
        : bDate.localeCompare(aDate);
    });

    // Apply pagination
    const perPage = options.per_page || 30;
    const page = (options as any).page || 1; // Page parameter from query string
    const startIndex = (page - 1) * perPage;
    results = results.slice(startIndex, startIndex + perPage);

    return results;
  }

  /**
   * Get a specific advisory by GHSA ID
   */
  async getAdvisory(ghsaId: string): Promise<Advisory | null> {
    await this.buildIndex();

    const advisory = this.cache.get(ghsaId);
    if (!advisory) {
      return null;
    }

    return advisory;
  }

  /**
   * Search advisories by text query
   */
  async searchAdvisories(query: string, options: AdvisoryListOptions = {}): Promise<Advisory[]> {
    await this.buildIndex();

    const queryLower = query.toLowerCase();
    let results = Array.from(this.cache.values()).filter(a =>
      a.summary.toLowerCase().includes(queryLower) ||
      a.description?.toLowerCase().includes(queryLower) ||
      a.ghsa_id.toLowerCase().includes(queryLower) ||
      a.cve_id?.toLowerCase().includes(queryLower)
    );

    // Apply additional filters
    return this.filterResults(results, options);
  }

  private filterResults(results: Advisory[], options: AdvisoryListOptions): Advisory[]  {
    // Apply all filters from listAdvisories
    if (options.ecosystem) {
      results = results.filter(a =>
        a.vulnerabilities.some(v => v.package.ecosystem === options.ecosystem)
      );
    }

    if (options.severity) {
      results = results.filter(a =>
        a.severity.toLowerCase() === options.severity!.toLowerCase()
      );
    }

    // Pagination
    const perPage = options.per_page || 30;
    return results.slice(0, perPage);
  }
}
