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
  ghsa_id: z.string().optional().describe('GHSA identifier'),
  cve_id: z.string().optional().describe('CVE identifier'),
  ecosystem: z.enum(['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift']).optional().describe('Package ecosystem'),
  severity: z.enum(['low', 'medium', 'high', 'critical', 'unknown']).optional().describe('Severity level'),
  cwes: z.string().optional().describe('Comma-separated CWE identifiers (e.g., "79,284,22")'),
  is_withdrawn: z.boolean().optional().describe('Filter withdrawn advisories'),
  affects: z.string().optional().describe('Package name filter'),
  published: z.string().optional().describe('Published date or range'),
  updated: z.string().optional().describe('Updated date or range'),
  per_page: z.number().min(1).max(100).optional().describe('Results per page (max 100)'),
  direction: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  sort: z.enum(['updated', 'published']).optional().describe('Sort field')
});

export async function listAdvisories(params: any): Promise<CallToolResult> {
  try {
    logger.debug('list_advisories called', { params });
    
    const queryString = buildQueryString(params as Record<string, unknown>);
    const endpoint = `/advisories${queryString}`;
    
    const fetchStart = Date.now();
    const advisories = await fetchLocalAPI<any[]>(endpoint);
    const fetchDuration = Date.now() - fetchStart;
    
    logger.info('list_advisories completed', { count: advisories.length, duration_ms: fetchDuration });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          count: advisories.length,
          advisories: advisories.map(adv => ({
            ghsa_id: adv.ghsa_id,
            cve_id: adv.cve_id,
            summary: adv.summary,
            severity: adv.severity,
            type: adv.type,
            published_at: adv.published_at,
            updated_at: adv.updated_at,
            affected_packages: adv.vulnerabilities.map((v: any) => ({
              ecosystem: v.package.ecosystem,
              name: v.package.name,
              vulnerable_range: v.vulnerable_version_range
            })),
            cwes: adv.cwes,
            url: adv.html_url
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

export async function getAdvisory(params: { ghsa_id: string }): Promise<CallToolResult> {
  try {
    logger.debug('get_advisory called', { ghsa_id: params.ghsa_id });
    const advisory = await fetchLocalAPI<any>(`/advisories/${params.ghsa_id}`);
    logger.info('get_advisory completed', { ghsa_id: params.ghsa_id });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(advisory, null, 2)
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('get_advisory failed', { ghsa_id: params.ghsa_id, error: errorMessage });
    
    return {
      content: [{
        type: 'text',
        text: `Error fetching advisory ${params.ghsa_id}: ${errorMessage}`
      }],
      isError: true
    };
  }
}
