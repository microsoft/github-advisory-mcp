import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  listAdvisories,
  listAdvisoriesSchema,
  getAdvisory,
  getAdvisorySchema,
} from "./tools/advisories.js";

/**
 * Create and configure the MCP server for local advisory database
 */
export function createAdvisoryServer(): Server {
  const server = new Server({
    name: "romulus-advisory-server",
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
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
