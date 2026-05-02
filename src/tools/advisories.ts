import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('Tools');

/**
 * Local advisory server configuration
 * Set via environment variable or default to local instance
 */
const LOCAL_API_BASE = process.env.ADVISORY_API_BASE || 'http://localhost:18005';

/**
 * Fetch data from local advisory API
 */
async function fetchLocalAPI<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${LOCAL_API_BASE}${endpoint}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Local API error (${response.status}): ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Build query string from parameters
 */
function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  }
  
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * List global security advisories from local database
 */
export const listAdvisoriesSchema = z.object({
  ghsa_id: z.string().optional().describe('GHSA identifier (e.g., "GHSA-xxxx-xxxx-xxxx")'),
  cve_id: z.string().optional().describe('CVE identifier (e.g., "CVE-2026-12345")'),
  ecosystem: z.enum(['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift']).optional().describe('Package ecosystem'),
  severity: z.enum(['low', 'medium', 'high', 'critical', 'unknown']).optional().describe('Severity level'),
  cwes: z.string().optional().describe('Comma-separated CWE identifiers (e.g., "79,284,22")'),
  is_withdrawn: z.boolean().optional().describe('Filter withdrawn advisories'),
  affects: z.string().optional().describe('Package name filter (partial match, e.g., "express" matches "express-session")'),
  published: z.string().optional().describe('Filter by published date in YYYY-MM-DD format. Single date returns that day only. Range format: "2026-01-01..2026-01-31" returns inclusive range. Examples: "2026-01-27" (single day), "2026-01-01..2026-01-31" (January 2026)'),
  updated: z.string().optional().describe('Filter by updated date in YYYY-MM-DD format. Single date returns that day only. Range format: "2026-01-01..2026-01-31" returns inclusive range'),
  per_page: z.number().min(1).max(100).optional().describe('Results per page (default: 30, max: 100)'),
  direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc, newest first)'),
  sort: z.enum(['updated', 'published']).optional().describe('Sort field (default: published)')
});

export async function listAdvisories(params: unknown): Promise<CallToolResult> {
  try {
    logger.debug('list_advisories called', { params });
    
    const queryString = buildQueryString(params as Record<string, unknown>);
    const endpoint = `/advisories${queryString}`;
    
    const fetchStart = Date.now();
    const advisories = await fetchLocalAPI<Array<Record<string, unknown>>>(endpoint);
    const fetchDuration = Date.now() - fetchStart;
    
    logger.info('list_advisories completed', { count: advisories.length, duration_ms: fetchDuration });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          count: advisories.length,
          advisories: advisories.map(adv => ({
            ghsa_id: (adv as any).ghsa_id,
            cve_id: (adv as any).cve_id,
            summary: (adv as any).summary,
            severity: (adv as any).severity,
            type: (adv as any).type,
            published_at: (adv as any).published_at,
            updated_at: (adv as any).updated_at,
            affected_packages: ((adv as any).vulnerabilities || []).map((v: any) => ({
              ecosystem: v.package?.ecosystem,
              name: v.package?.name,
              vulnerable_range: v.vulnerable_version_range
            })),
            cwes: (adv as any).cwes,
            url: (adv as any).html_url
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('list_advisories failed', { error: errorMessage });
    
    return {
      content: [{
        type: 'text',
        text: `Error fetching advisories from local database: ${errorMessage}`
      }],
      isError: true
    };
  }
}

/**
 * Get a specific advisory by GHSA ID
 */
export const getAdvisorySchema = z.object({
  ghsa_id: z.string().describe('GHSA identifier (e.g., GHSA-xxxx-xxxx-xxxx)')
});

export async function getAdvisory(params: unknown): Promise<CallToolResult> {
  try {
    const validated = getAdvisorySchema.parse(params);
    logger.debug('get_advisory called', { ghsa_id: validated.ghsa_id });
    const advisory = await fetchLocalAPI<Record<string, unknown>>(`/advisories/${validated.ghsa_id}`);
    logger.info('get_advisory completed', { ghsa_id: validated.ghsa_id });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(advisory, null, 2)
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const ghsaId = (params as any)?.ghsa_id || 'unknown';
    logger.error('get_advisory failed', { ghsa_id: ghsaId, error: errorMessage });
    
    return {
      content: [{
        type: 'text',
        text: `Error fetching advisory ${ghsaId}: ${errorMessage}`
      }],
      isError: true
    };
  }
}
