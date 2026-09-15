import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  listAdvisories,
  getAdvisory,
} from "./tools/advisories.js";
import { semanticSearch } from "./tools/semantic-search.js";

/**
 * Create and configure the MCP server for local advisory database
 */
export function createAdvisoryServer(): Server {
  const server = new Server({
    name: "github-advisory-server",
    version: "1.0.0",
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Register tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_advisories",
          description: "List GitHub security advisories from local database with optional filters. Returns summary information about advisories including GHSA ID, CVE ID, severity, affected packages, and more.",
          inputSchema: {
            type: "object",
            properties: {
              ghsa_id: { type: "string", description: "GHSA identifier" },
              cve_id: { type: "string", description: "CVE identifier" },
              ecosystem: {
                type: "string",
                enum: ['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift'],
                description: "Package ecosystem"
              },
              severity: {
                type: "string",
                enum: ['low', 'medium', 'high', 'critical', 'unknown'],
                description: "Severity level"
              },
              cwes: { type: "string", description: "Comma-separated CWE identifiers (e.g., '79,284,22')" },
              is_withdrawn: { type: "boolean", description: "Filter withdrawn advisories" },
              affects: { type: "string", description: "Package name filter" },
              published: { type: "string", description: "Published date or range" },
              updated: { type: "string", description: "Updated date or range" },
              per_page: { type: "number", minimum: 1, maximum: 100, description: "Results per page (max 100)" },
              direction: { type: "string", enum: ['asc', 'desc'], description: "Sort direction" },
              sort: { type: "string", enum: ['updated', 'published'], description: "Sort field" }
            }
          }
        },
        {
          name: "get_advisory",
          description: "Get detailed information about a specific GitHub security advisory by its GHSA identifier. Returns comprehensive details including description, vulnerabilities, CVSS scores, CWE classifications, and references.",
          inputSchema: {
            type: "object",
            properties: {
              ghsa_id: { type: "string", description: "GHSA identifier (e.g., GHSA-xxxx-xxxx-xxxx)" }
            },
            required: ["ghsa_id"]
          }
        },
        {
          name: "semantic_search",
          description: "Local hybrid semantic search over advisories (embeddings + BM25 + reranking). Use for natural-language / conceptual queries (e.g. 'blind ORM injection via sort parameter', 'account takeover in recent Keycloak'). A period in the query ('in August 2026', 'recent') drives temporal reranking. Requires the prototype index to be built.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Natural-language query; may include a period for temporal reranking" },
              top_k: { type: "number", minimum: 1, maximum: 50, description: "Number of results (default 10)" },
              web_app_only: { type: "boolean", description: "Keep only web-application vulnerability classes (by CWE)" },
              severity: { type: "string", enum: ['low', 'medium', 'high', 'critical', 'unknown'], description: "Post-filter by severity" },
              ecosystem: { type: "string", enum: ['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift'], description: "Post-filter by ecosystem" },
              cwes: { type: "string", description: "Comma-separated CWE ids to require (e.g. '89' or 'CWE-89,79')" }
            },
            required: ["query"]
          }
        }
      ]
    };
  });

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "list_advisories":
        return await listAdvisories(args || {});
      case "get_advisory":
        return await getAdvisory(args || {});
      case "semantic_search":
        return await semanticSearch(args || {});
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
