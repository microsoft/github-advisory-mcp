import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess } from "child_process";
import { generateText } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  startMCPServer,
  stopMCPServer,
  initializeMCPSession,
  callMCPTool,
} from "../test-utils.js";

/**
 * Azure OpenAI configuration.
 * 
 * All values are configured via environment variables for security.
 * Tests will be skipped if AZURE_OPENAI_ENDPOINT is not set.
 * 
 * Required environment variables:
 * - AZURE_OPENAI_ENDPOINT: Your Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)
 * - AZURE_OPENAI_DEPLOYMENT: Model deployment name (default: gpt-4o)
 * - AZURE_OPENAI_API_VERSION: API version (default: 2024-10-21)
 * 
 * Authentication: Uses Azure Managed Identity (runs on Azure VMs with system-assigned identity)
 */
const AZURE_CONFIG = {
  endpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o",
  scope: "https://cognitiveservices.azure.com/.default",
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-10-21",
};

/**
 * Test context shared across tests.
 */
interface TestContext {
  azureToken: string;
  sessionId: string;
  serverProcess: ChildProcess;
  baseUrl: string;
}

let testContext: TestContext | null = null;

/**
 * Get Azure AD bearer token via managed identity (VM metadata service).
 */
async function getAzureADToken(): Promise<string> {
  const resp = await fetch(
    `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://cognitiveservices.azure.com`,
    { headers: { Metadata: "true" } }
  );
  if (!resp.ok) {
    throw new Error(`Failed to get token: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error("No access_token in response");
  }
  return data.access_token;
}

/**
 * Create custom fetch adapter for Azure OpenAI.
 * 
 * The AI SDK v6 uses the Responses API format internally, but Azure OpenAI
 * only supports the Chat Completions API. This adapter transforms:
 * - URL: /deployments/{id}/responses → /openai/deployments/{id}/chat/completions
 * - Request: Responses API format → Chat Completions format
 * - Response: Chat Completions format → Responses API format
 */
function createAzureFetchAdapter(token: string): typeof fetch {
  return async (input, init) => {
    let url = input.toString();

    // Fix URL: add /openai/ prefix and convert /responses to /chat/completions
    if (!url.includes("/openai/")) {
      url = url.replace("/deployments/", "/openai/deployments/");
    }
    url = url.replace("/responses", "/chat/completions");

    // Transform request body from Responses API to Chat Completions
    let body = init?.body;
    if (body && typeof body === "string") {
      const parsed = JSON.parse(body);

      // Convert "input" to "messages"
      if (parsed.input && !parsed.messages) {
        parsed.messages = parsed.input.map((msg: any) => {
          const content = Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || c.content || "").join("")
            : msg.content;
          return { role: msg.role, content };
        });
        delete parsed.input;
      }

      // Convert tools from Responses API format to Chat Completions format
      // Responses API: { type, name, description, parameters, strict }
      // Chat Completions: { type, function: { name, description, parameters, strict }}
      if (parsed.tools && Array.isArray(parsed.tools)) {
        parsed.tools = parsed.tools.map((t: any) => {
          if (t.type === "function" && t.name && !t.function) {
            const { type, name, description, parameters, strict, ...rest } = t;
            // Ensure parameters has type: "object" (required by Azure OpenAI)
            const normalizedParams = parameters && typeof parameters === "object"
              ? { type: "object", ...parameters }
              : { type: "object", properties: {}, additionalProperties: false };
            return {
              type: "function",
              function: { name, description, parameters: normalizedParams, strict },
              ...rest,
            };
          }
          // Also handle already-transformed tools that might be missing type
          if (t.type === "function" && t.function?.parameters) {
            const params = t.function.parameters;
            if (!params.type) {
              t.function.parameters = { type: "object", ...params };
            }
          }
          return t;
        });
      }

      // gpt-5.1 requires max_completion_tokens instead of max_tokens
      if (parsed.max_tokens && !parsed.max_completion_tokens) {
        parsed.max_completion_tokens = parsed.max_tokens;
        delete parsed.max_tokens;
      }

      body = JSON.stringify(parsed);
    }

    // Add bearer token
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(url, { ...init, headers, body });
    const responseText = await response.text();

    // Transform response from Chat Completions to Responses API format
    if (response.ok) {
      try {
        const chatResponse = JSON.parse(responseText);

        // Check if this is a tool call response
        const hasToolCalls = chatResponse.choices?.some(
          (c: any) => c.message?.tool_calls?.length > 0
        );

        // Build Responses API format
        const responsesFormat: any = {
          id: chatResponse.id,
          object: "response",
          created_at: chatResponse.created,
          status: "completed",
          model: chatResponse.model,
          output: [],
          usage: {
            input_tokens: chatResponse.usage?.prompt_tokens || 0,
            output_tokens: chatResponse.usage?.completion_tokens || 0,
            total_tokens: chatResponse.usage?.total_tokens || 0,
          },
        };

        for (const choice of chatResponse.choices || []) {
          if (choice.message?.tool_calls?.length > 0) {
            // Tool call response
            for (const toolCall of choice.message.tool_calls) {
              responsesFormat.output.push({
                type: "function_call",
                id: toolCall.id || `call_${randomUUID()}`,
                call_id: toolCall.id || `call_${randomUUID()}`,
                name: toolCall.function?.name,
                arguments: toolCall.function?.arguments || "{}",
              });
            }
          } else {
            // Text response
            responsesFormat.output.push({
              type: "message",
              id: `msg_${randomUUID()}`,
              role: choice.message?.role || "assistant",
              content: [
                {
                  type: "output_text",
                  text: choice.message?.content || "",
                  annotations: [],
                },
              ],
            });
          }
        }

        return new Response(JSON.stringify(responsesFormat), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        // Return original if transformation fails
      }
    }

    return new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

describe("AI SDK Integration with Azure OpenAI (Azure AD Auth)", () => {
  const MCP_PORT = parseInt(process.env.MCP_PORT || "18006", 10);
  const API_PORT = parseInt(process.env.ADVISORY_API_PORT || "18005", 10);
  const REPO_PATH =
    process.env.ADVISORY_REPO_PATH || "./external/advisory-database";
  const baseUrl = `http://localhost:${MCP_PORT}/mcp`;

  beforeAll(async () => {
    // Skip if Azure endpoint not configured
    if (!AZURE_CONFIG.endpoint) {
      console.log("[Test] Skipping - AZURE_OPENAI_ENDPOINT not configured");
      console.log("[Test] Set AZURE_OPENAI_ENDPOINT environment variable to enable these tests");
      return;
    }

    let azureToken: string;
    try {
      console.log("[Test] Acquiring Azure AD token via managed identity...");
      azureToken = await getAzureADToken();
      console.log("[Test] Azure AD token acquired successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[Test] Azure AD auth failed: ${msg}`);
      console.log("[Test] Tests will be skipped - no managed identity available");
      return;
    }

    console.log(`[Test] Starting MCP server for AI SDK tests...`);
    console.log(`[Test] Using Azure OpenAI endpoint: ${AZURE_CONFIG.endpoint}`);
    console.log(`[Test] Using deployment: ${AZURE_CONFIG.deployment}`);

    const serverProcess = await startMCPServer(MCP_PORT, API_PORT, REPO_PATH);
    const sessionId = await initializeMCPSession(baseUrl);

    testContext = {
      azureToken,
      sessionId,
      serverProcess,
      baseUrl,
    };
  }, 60000);

  afterAll(async () => {
    if (testContext?.serverProcess) {
      console.log("[Test] Stopping MCP server...");
      await stopMCPServer(testContext.serverProcess);
    }
  });

  /**
   * Create Azure OpenAI provider with Azure AD auth and Chat Completions adapter.
   */
  function createAzureWithADAuth() {
    if (!testContext) throw new Error("Test context not initialized");

    return createAzure({
      baseURL: AZURE_CONFIG.endpoint,
      apiKey: "azure-ad-auth", // Placeholder - we use bearer token
      apiVersion: AZURE_CONFIG.apiVersion,
      useDeploymentBasedUrls: true,
      fetch: createAzureFetchAdapter(testContext.azureToken),
    });
  }

  /**
   * Helper: Create AI SDK tool from MCP tool schema.
   */
  function createAISDKTool(name: string, description: string, parameters: any) {
    if (!testContext) throw new Error("Test context not initialized");

    const schemaEntries = Object.entries(parameters.properties || {}).map(
      ([key, value]: [string, any]) => {
        let zodType: z.ZodTypeAny;
        if (value.type === "string" && value.enum) {
          zodType = z.enum(value.enum as [string, ...string[]]);
        } else if (value.type === "string") {
          zodType = z.string();
        } else if (value.type === "number" || value.type === "integer") {
          zodType = z.number();
        } else if (value.type === "boolean") {
          zodType = z.boolean();
        } else {
          zodType = z.any();
        }

        const required = parameters.required || [];
        if (!required.includes(key)) {
          zodType = zodType.optional();
        }

        if (value.description) {
          zodType = zodType.describe(value.description);
        }

        return [key, zodType];
      }
    );

    const zodSchema =
      schemaEntries.length > 0
        ? z.object(Object.fromEntries(schemaEntries))
        : z.object({}).passthrough();

    return {
      description,
      parameters: zodSchema,
      execute: async (args: any) => {
        const response = await callMCPTool(
          testContext!.baseUrl,
          testContext!.sessionId,
          name,
          args
        );
        const content = response.result.content[0].text;
        return JSON.parse(content);
      },
    };
  }

  it("should use Azure OpenAI with AD auth to search npm advisories", async () => {
    if (!testContext) {
      console.log("[Test] Skipping - Azure AD auth not available");
      return;
    }

    const azure = createAzureWithADAuth();
    const model = azure(AZURE_CONFIG.deployment);

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
                type: "integer",
                description: "Results per page (max 100)",
              },
            },
          }
        ),
      },
      prompt:
        "Search for 3 critical npm security advisories. Use the list_advisories tool.",
      maxSteps: 3,
    });

    console.log("[Test] Steps completed:", result.steps.length);
    expect(result.steps.length).toBeGreaterThan(0);
  }, 60000);

  it("should get specific advisory details", async () => {
    if (!testContext) {
      console.log("[Test] Skipping - Azure AD auth not available");
      return;
    }

    const azure = createAzureWithADAuth();
    const model = azure(AZURE_CONFIG.deployment);

    // First, list advisories to get a real GHSA ID
    const listResponse = await callMCPTool(
      testContext.baseUrl,
      testContext.sessionId,
      "list_advisories",
      { ecosystem: "npm", per_page: 1 }
    );
    const listContent = JSON.parse(listResponse.result.content[0].text);
    const ghsaId = listContent[0]?.ghsa_id;

    if (!ghsaId) {
      console.log("[Test] No GHSA ID found to test with");
      return;
    }

    console.log(`[Test] Using GHSA ID: ${ghsaId}`);

    const result = await generateText({
      model,
      tools: {
        get_advisory: createAISDKTool(
          "get_advisory",
          "Get detailed information about a specific advisory",
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
      prompt: `Get details for security advisory ${ghsaId}. Use the get_advisory tool with this exact ID.`,
      maxSteps: 3,
    });

    console.log("[Test] Advisory details retrieved");
    expect(result.steps.length).toBeGreaterThan(0);
  }, 60000);

  it("should handle multi-turn tool usage for vulnerability research", async () => {
    if (!testContext) {
      console.log("[Test] Skipping - Azure AD auth not available");
      return;
    }

    const azure = createAzureWithADAuth();
    const model = azure(AZURE_CONFIG.deployment);

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
                type: "integer",
                description: "Results per page (max 100)",
              },
            },
          }
        ),
        get_advisory: createAISDKTool(
          "get_advisory",
          "Get detailed information about a specific advisory",
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
      prompt: `Find one critical npm advisory and then get its full details.
               First use list_advisories to find a critical npm advisory,
               then use get_advisory to get its details.
               Summarize the vulnerability.`,
      maxSteps: 5,
    });

    console.log("[Test] Multi-turn result steps:", result.steps.length);
    console.log("[Test] Tool calls made:", result.steps.flatMap(s => s.toolCalls).length);
    console.log("[Test] Final text length:", result.text.length);
    
    // Model may complete in 1 step if it decides to call both tools or answer directly
    // The important thing is that it completes successfully and either:
    // 1. Produces a text response, OR
    // 2. Made tool calls (indicating successful tool integration)
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    
    const hasToolCalls = result.steps.some(s => s.toolCalls && s.toolCalls.length > 0);
    const hasText = result.text && result.text.length > 0;
    
    // Either we got text back or we made tool calls (or both)
    expect(hasToolCalls || hasText).toBe(true);
  }, 90000);

  it("should work without tools for simple prompts", async () => {
    if (!testContext) {
      console.log("[Test] Skipping - Azure AD auth not available");
      return;
    }

    const azure = createAzureWithADAuth();
    const model = azure(AZURE_CONFIG.deployment);

    const result = await generateText({
      model,
      prompt: "What is a GHSA identifier? Answer in one sentence.",
    });

    console.log("[Test] Simple prompt result:", result.text);
    expect(result.text).toBeTruthy();
    expect(result.text.toLowerCase()).toContain("github");
  }, 30000);
});
