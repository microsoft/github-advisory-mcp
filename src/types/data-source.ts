/**
 * Advisory data source abstraction layer
 * Allows using either GitHub API or local advisory database repository
 */

export interface AdvisoryListOptions {
  ghsa_id?: string;
  cve_id?: string;
  ecosystem?: string;
  severity?: string;
  cwes?: string[];
  is_withdrawn?: boolean;
  affects?: string;
  published?: string;
  updated?: string;
  modified?: string;
  epss_percentage?: string;
  epss_percentile?: string;
  before?: string;
  after?: string;
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
  sort?: 'published' | 'updated';
}

export interface Advisory {
  ghsa_id: string;
  cve_id: string | null;
  url: string;
  html_url: string;
  repository_advisory_url: string | null;
  summary: string;
  description: string | null;
  type: string;
  severity: string;
  source_code_location: string | null;
  identifiers: Array<{ type: string; value: string }>;
  references: string[];
  published_at: string;
  updated_at: string;
  github_reviewed_at: string | null;
  nvd_published_at: string | null;
  withdrawn_at: string | null;
  vulnerabilities: Array<{
    package: {
      ecosystem: string;
      name: string;
    };
    severity: string;
    vulnerable_version_range: string;
    first_patched_version: string | null;
  }>;
  cvss: {
    vector_string: string;
    score: number;
  } | null;
  cvss_severities?: Array<{
    score: number;
    type: string;
    vector_string: string;
  }>;
  epss?: {
    percentage: number;
    percentile: number;
  };
  cwes: Array<{
    cwe_id: string;
    name: string;
  }>;
  credits: Array<{
    user: {
      login: string;
      id: number;
      node_id: string;
      avatar_url: string;
      gravatar_id: string;
      url: string;
      html_url: string;
      type: string;
      site_admin: boolean;
    };
    type: string;
  }>;
}

/**
 * Interface for advisory data sources
 * Can be implemented by GitHubAPIDataSource or LocalRepositoryDataSource
 */
export interface IAdvisoryDataSource {
  /**
   * List advisories with optional filtering
   */
  listAdvisories(options?: AdvisoryListOptions): Promise<Advisory[]>;

  /**
   * Get a specific advisory by GHSA ID
   * Returns null if advisory not found
   */
  getAdvisory(ghsaId: string): Promise<Advisory | null>;

  /**
   * Search advisories (optional, may not be supported by all sources)
   */
  searchAdvisories?(query: string, options?: AdvisoryListOptions): Promise<Advisory[]>;

  /**
   * Get data source type identifier
   */
  getSourceType(): 'github-api' | 'local-repository' | 'http-server';
}
