import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess } from "child_process";
import { generateText } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { z } from "zod";
import {
  startMCPServer,
  stopMCPServer,
  initializeMCPSession,
  callMCPTool,
} from "../test-utils.js";

describe("AI SDK Integration with Azure OpenAI", () => {
  let serverProcess: ChildProcess;
  const MCP_PORT = parseInt(process.env.MCP_PORT || "18006", 10);
  const API_PORT = parseInt(process.env.ADVISORY_API_PORT || "18005", 10);
  const REPO_PATH =
    process.env.ADVISORY_REPO_PATH ||
    "c:/build/maxgolov/advisory/external/advisory-database";
  const baseUrl = `http://localhost:${MCP_PORT}/mcp`;
  let sessionId: string;

  // Azure OpenAI configuration
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";

  // Skip tests if Azure credentials not configured
  const shouldSkip = !azureEndpoint || !azureApiKey;

  beforeAll(async () => {
    if (shouldSkip) {
      console.log(
        "[Test] Skipping AI SDK tests - Azure OpenAI credentials not configured"
      );
      return;
    }

    console.log(`[Test] Starting MCP server for AI SDK tests...`);
    serverProcess = await startMCPServer(MCP_PORT, API_PORT, REPO_PATH);
    sessionId = await initializeMCPSession(baseUrl);
  }, 20000);

  afterAll(async () => {
    if (!shouldSkip && serverProcess) {
      console.log("[Test] Stopping MCP server...");
      await stopMCPServer(serverProcess);
    }
  });

  /**
   * Helper: Create AI SDK tool from MCP tool
   */
  function createAISDKTool(name: string, description: string, parameters: any) {
    return {
      description,
      parameters: z.object(
        Object.fromEntries(
          Object.entries(parameters.properties || {}).map(([key, value]: [string, any]) => {
            if (value.type === "string" && value.enum) {
              return [key, z.enum(value.enum).optional().describe(value.description || "")];
            } else if (value.type === "string") {
              return [key, z.string().optional().describe(value.description || "")];
            } else if (value.type === "number") {
              return [key, z.number().optional().describe(value.description || "")];
            }
            return [key, z.any()];
          })
        )
      ),
      execute: async (args: any) => {
        const response = await callMCPTool(baseUrl, sessionId, name, args);
        const content = response.result.content[0].text;
        return JSON.parse(content);
      },
    };
  }

  it.skipIf(shouldSkip)(
    "should use Azure OpenAI to search npm advisories",
    async () => {
      const azure = createAzure({
        resourceName: azureEndpoint!.split("//")[1].split(".")[0],
        apiKey: azureApiKey!,
      });

      const model = azure(azureDeployment);

      const result = await generateText({
        model,
        tools: {
          list_advisories: createAISDKTool(
            "list_advisories",
            "List GitHub security advisories with filters",
            {
              type: "object",
              properties: {
                ecosystem: {
                  type: "string",
                  enum: ["npm", "pip", "maven", "go", "rust"],
                  description: "Package ecosystem",
                },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high", "critical"],
                  description: "Severity level",
                },
                per_page: {
                  type: "number",
                  description: "Results per page (max 100)",
                },
              },
            }
          ),
        },
        prompt:
          "Find critical npm security advisories. List the top 3 with their CVE IDs.",
        maxSteps: 5,
      });

      console.log("[AI] Result:", result.text);
      console.log("[AI] Tool calls:", result.toolCalls?.length || 0);

      expect(result.text).toBeTruthy();
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls!.length).toBeGreaterThan(0);

      // Verify tool was called with correct parameters
      const listCall = result.toolCalls!.find(
        (tc: any) => tc.toolName === "list_advisories"
      );
      expect(listCall).toBeDefined();
      expect((listCall as any).args).toMatchObject({
        ecosystem: "npm",
        severity: "critical",
      });

      // Verify response mentions CVE IDs
      expect(result.text.toLowerCase()).toMatch(/cve-\d{4}-\d+/);
    },
    30000
  );

  it.skipIf(shouldSkip)(
    "should generate security report for specific advisory",
    async () => {
      // First, get a real advisory
      const listResponse = await callMCPTool(
        baseUrl,
        sessionId,
        "list_advisories",
        {
          ecosystem: "npm",
          severity: "high",
          per_page: 1,
        }
      );
      const listContent = JSON.parse(listResponse.result.content[0].text);
      const ghsaId = listContent.advisories[0].ghsa_id;

      const azure = createAzure({
        resourceName: azureEndpoint!.split("//")[1].split(".")[0],
        apiKey: azureApiKey!,
      });

      const model = azure(azureDeployment);

      const result = await generateText({
        model,
        tools: {
          get_advisory: createAISDKTool(
            "get_advisory",
            "Get detailed advisory information by GHSA ID",
            {
              type: "object",
              properties: {
                ghsa_id: {
                  type: "string",
                  description: "GHSA identifier (e.g., GHSA-xxxx-xxxx-xxxx)",
                },
              },
              required: ["ghsa_id"],
            }
          ),
        },
        prompt: `Get detailed information about advisory ${ghsaId} and summarize: 
        1. What is the vulnerability?
        2. Which packages are affected?
        3. What is the severity and CVSS score?
        4. Are there any fixes available?`,
        maxSteps: 5,
      });

      console.log("[AI] Report:", result.text);

      expect(result.text).toBeTruthy();
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls!.length).toBeGreaterThan(0);

      // Verify tool was called with correct GHSA ID
      const getCall = result.toolCalls!.find(
        (tc: any) => tc.toolName === "get_advisory"
      );
      expect(getCall).toBeDefined();
      expect((getCall as any).args.ghsa_id).toBe(ghsaId);

      // Verify report contains key information
      expect(result.text.toLowerCase()).toContain("vulnerability");
      expect(result.text.toLowerCase()).toMatch(/high|critical/);
    },
    30000
  );

  it.skipIf(shouldSkip)(
    "should compare advisories across ecosystems",
    async () => {
      const azure = createAzure({
        resourceName: azureEndpoint!.split("//")[1].split(".")[0],
        apiKey: azureApiKey!,
      });

      const model = azure(azureDeployment);

      const result = await generateText({
        model,
        tools: {
          list_advisories: createAISDKTool(
            "list_advisories",
            "List GitHub security advisories",
            {
              type: "object",
              properties: {
                ecosystem: {
                  type: "string",
                  enum: ["npm", "pip", "maven", "go"],
                },
                severity: {
                  type: "string",
                  enum: ["critical"],
                },
                per_page: { type: "number" },
              },
            }
          ),
        },
        prompt:
          "Compare the number of critical advisories between npm and pip ecosystems. Which has more?",
        maxSteps: 10,
      });

      console.log("[AI] Comparison:", result.text);
      console.log("[AI] Tool calls:", result.toolCalls?.length || 0);

      expect(result.text).toBeTruthy();
      expect(result.toolCalls).toBeDefined();
      
      // Should call list_advisories at least twice (npm and pip)
      const listCalls = result.toolCalls!.filter(
        (tc) => tc.toolName === "list_advisories"
      );
      expect(listCalls.length).toBeGreaterThanOrEqual(2);

      // Verify both ecosystems were queried
      const ecosystems = listCalls.map((tc: any) => tc.args.ecosystem);
      expect(ecosystems).toContain("npm");
      expect(ecosystems).toContain("pip");

      // Verify response contains comparison
      expect(result.text.toLowerCase()).toMatch(/npm|pip/);
      expect(result.text.toLowerCase()).toMatch(/more|less|greater|fewer/);
    },
    45000
  );

  it.skipIf(shouldSkip)(
    "should handle multi-step advisory research workflow",
    async () => {
      const azure = createAzure({
        resourceName: azureEndpoint!.split("//")[1].split(".")[0],
        apiKey: azureApiKey!,
      });

      const model = azure(azureDeployment);

      const result = await generateText({
        model,
        tools: {
          list_advisories: createAISDKTool(
            "list_advisories",
            "List GitHub security advisories",
            {
              type: "object",
              properties: {
                ecosystem: { type: "string", enum: ["npm", "pip", "maven", "go"] },
                severity: { type: "string", enum: ["critical", "high"] },
                per_page: { type: "number" },
              },
            }
          ),
          get_advisory: createAISDKTool(
            "get_advisory",
            "Get detailed advisory information",
            {
              type: "object",
              properties: {
                ghsa_id: { type: "string", description: "GHSA identifier" },
              },
              required: ["ghsa_id"],
            }
          ),
        },
        prompt: `Research the most critical npm vulnerabilities:
        1. Find critical npm advisories
        2. Get details for the first one
        3. Summarize the vulnerability, affected versions, and mitigation`,
        maxSteps: 10,
      });

      console.log("[AI] Research:", result.text);
      console.log("[AI] Steps:", result.steps.length);

      expect(result.text).toBeTruthy();
      expect(result.steps.length).toBeGreaterThan(1);

      // Verify multi-step execution
      const listCall = result.toolCalls!.find(
        (tc) => tc.toolName === "list_advisories"
      );
      const getCall = result.toolCalls!.find(
        (tc) => tc.toolName === "get_advisory"
      );

      expect(listCall).toBeDefined();
      expect(getCall).toBeDefined();

      // Verify logical flow: list first, then get details
      const listIndex = result.toolCalls!.indexOf(listCall!);
      const getIndex = result.toolCalls!.indexOf(getCall!);
      expect(listIndex).toBeLessThan(getIndex);

      // Verify comprehensive summary
      expect(result.text.toLowerCase()).toContain("vulnerability");
      expect(result.text.toLowerCase()).toMatch(/version|package/);
    },
    60000
  );
});
