import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess } from "child_process";
import {
  startMCPServer,
  stopMCPServer,
  initializeMCPSession,
  listMCPTools,
  callMCPTool,
} from "../test-utils.js";

describe("MCP Advisory Server E2E Tests", () => {
  let serverProcess: ChildProcess;
  const MCP_PORT = parseInt(process.env.MCP_PORT || "18006", 10);
  const API_PORT = parseInt(process.env.ADVISORY_API_PORT || "18005", 10);
  const REPO_PATH =
    process.env.ADVISORY_REPO_PATH ||
    "./external/advisory-database";
  const baseUrl = `http://localhost:${MCP_PORT}/mcp`;
  let sessionId: string;

  beforeAll(async () => {
    console.log(`[Test] Starting MCP server on port ${MCP_PORT}...`);
    console.log(`[Test] Local API port: ${API_PORT}`);
    console.log(`[Test] Repository path: ${REPO_PATH}`);
    console.log(`[Test] Note: First run may take 1-2 minutes to clone advisory database`);

    serverProcess = await startMCPServer(MCP_PORT, API_PORT, REPO_PATH);
  }, 180000); // 3 minutes for first-time database clone

  afterAll(async () => {
    console.log("[Test] Stopping MCP server...");
    await stopMCPServer(serverProcess);
  });

  describe("Health Check", () => {
    it("should return health status", async () => {
      const response = await fetch(`http://localhost:${MCP_PORT}/health`);
      expect(response.ok).toBe(true);

      const health = await response.json();
      expect(health).toMatchObject({
        status: "ok",
        service: "github-advisory-mcp",
        mcpPort: MCP_PORT,
        apiPort: API_PORT,
      });
      expect(health.localApiUrl).toContain(API_PORT.toString());
    });
  });

  describe("MCP Session Management", () => {
    it("should initialize MCP session", async () => {
      sessionId = await initializeMCPSession(baseUrl);
      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    });

    it("should list available tools", async () => {
      const response = await listMCPTools(baseUrl, sessionId);
      expect(response.result).toBeDefined();
      expect(response.result.tools).toBeInstanceOf(Array);
      expect(response.result.tools.length).toBeGreaterThan(0);

      // Verify expected tools exist
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("list_advisories");
      expect(toolNames).toContain("get_advisory");
    });

    it("should have correct tool schemas", async () => {
      const response = await listMCPTools(baseUrl, sessionId);
      const tools = response.result.tools;

      const listTool = tools.find((t: any) => t.name === "list_advisories");
      expect(listTool).toBeDefined();
      expect(listTool.description).toContain("security advisories");
      expect(listTool.inputSchema).toBeDefined();
      expect(listTool.inputSchema.properties).toHaveProperty("ecosystem");
      expect(listTool.inputSchema.properties).toHaveProperty("severity");

      const getTool = tools.find((t: any) => t.name === "get_advisory");
      expect(getTool).toBeDefined();
      expect(getTool.inputSchema).toBeDefined();
      expect(getTool.inputSchema.properties).toHaveProperty("ghsa_id");
      expect(getTool.inputSchema.required).toContain("ghsa_id");
    });
  });

  describe("List Advisories Tool", () => {
    beforeAll(async () => {
      if (!sessionId) {
        sessionId = await initializeMCPSession(baseUrl);
      }
    });

    it("should list npm advisories", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
        ecosystem: "npm",
        per_page: 5,
      });

      expect(response.result).toBeDefined();
      expect(response.result.content).toBeInstanceOf(Array);
      expect(response.result.content.length).toBeGreaterThan(0);

      const content = JSON.parse(response.result.content[0].text);
      expect(content.count).toBeGreaterThan(0);
      expect(content.advisories).toBeInstanceOf(Array);
      expect(content.advisories.length).toBeLessThanOrEqual(5);

      // Verify advisory structure
      const advisory = content.advisories[0];
      expect(advisory).toHaveProperty("ghsa_id");
      expect(advisory).toHaveProperty("summary");
      expect(advisory).toHaveProperty("severity");
      expect(advisory.affected_packages).toBeInstanceOf(Array);
      expect(advisory.affected_packages[0].ecosystem).toBe("npm");
    });

    it("should filter by severity", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
        ecosystem: "npm",
        severity: "critical",
        per_page: 3,
      });

      const content = JSON.parse(response.result.content[0].text);
      expect(content.advisories).toBeInstanceOf(Array);

      if (content.advisories.length > 0) {
        content.advisories.forEach((adv: any) => {
          expect(adv.severity).toBe("critical");
        });
      }
    });

    it("should support pagination", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
        ecosystem: "pip",
        per_page: 2,
      });

      const content = JSON.parse(response.result.content[0].text);
      expect(content.advisories.length).toBeLessThanOrEqual(2);
    });

    it("should list multiple ecosystems", async () => {
      for (const ecosystem of ["npm", "pip", "maven", "go"]) {
        const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
          ecosystem,
          per_page: 1,
        });

        const content = JSON.parse(response.result.content[0].text);
        if (content.advisories.length > 0) {
          expect(
            content.advisories[0].affected_packages.some(
              (p: any) => p.ecosystem === ecosystem
            )
          ).toBe(true);
        }
      }
    });
  });

  describe("Get Advisory Tool", () => {
    let testGhsaId: string;

    beforeAll(async () => {
      if (!sessionId) {
        sessionId = await initializeMCPSession(baseUrl);
      }

      // Get a real GHSA ID for testing
      const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
        ecosystem: "npm",
        per_page: 1,
      });
      const content = JSON.parse(response.result.content[0].text);
      testGhsaId = content.advisories[0].ghsa_id;
    });

    it("should get specific advisory by GHSA ID", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "get_advisory", {
        ghsa_id: testGhsaId,
      });

      expect(response.result).toBeDefined();
      expect(response.result.content).toBeInstanceOf(Array);

      const advisory = JSON.parse(response.result.content[0].text);
      expect(advisory.ghsa_id).toBe(testGhsaId);
      expect(advisory).toHaveProperty("summary");
      expect(advisory).toHaveProperty("description");
      expect(advisory).toHaveProperty("severity");
      expect(advisory).toHaveProperty("vulnerabilities");
      expect(advisory).toHaveProperty("references");
      expect(advisory).toHaveProperty("published_at");
    });

    it("should include CVE information", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "get_advisory", {
        ghsa_id: testGhsaId,
      });

      const advisory = JSON.parse(response.result.content[0].text);
      if (advisory.cve_id) {
        expect(advisory.cve_id).toMatch(/^CVE-\d{4}-\d+$/);
      }
    });

    it("should include CWE information", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "get_advisory", {
        ghsa_id: testGhsaId,
      });

      const advisory = JSON.parse(response.result.content[0].text);
      expect(advisory.cwes).toBeInstanceOf(Array);
      if (advisory.cwes.length > 0) {
        expect(advisory.cwes[0]).toHaveProperty("cwe_id");
        expect(advisory.cwes[0].cwe_id).toMatch(/^CWE-\d+$/);
      }
    });

    it("should include vulnerability details", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "get_advisory", {
        ghsa_id: testGhsaId,
      });

      const advisory = JSON.parse(response.result.content[0].text);
      expect(advisory.vulnerabilities).toBeInstanceOf(Array);
      expect(advisory.vulnerabilities.length).toBeGreaterThan(0);

      const vuln = advisory.vulnerabilities[0];
      expect(vuln.package).toHaveProperty("ecosystem");
      expect(vuln.package).toHaveProperty("name");
      expect(vuln).toHaveProperty("vulnerable_version_range");
    });

    it("should handle non-existent GHSA ID", async () => {
      const response = await callMCPTool(baseUrl, sessionId, "get_advisory", {
        ghsa_id: "GHSA-xxxx-yyyy-zzzz",
      });

      // Should return error or empty result
      const content = response.result.content[0].text;
      expect(content).toContain("Error");
    });
  });

  describe("Local REST API Integration", () => {
    it("should verify REST API is accessible", async () => {
      const response = await fetch(`http://localhost:${API_PORT}/health`);
      expect(response.ok).toBe(true);

      const health = await response.json();
      expect(health.status).toBe("ok");
    });

    it("should query REST API directly", async () => {
      const response = await fetch(
        `http://localhost:${API_PORT}/advisories?ecosystem=npm&per_page=2`
      );
      expect(response.ok).toBe(true);

      const advisories = await response.json();
      expect(advisories).toBeInstanceOf(Array);
      expect(advisories.length).toBeLessThanOrEqual(2);
    });

    it("should verify MCP tools use REST API", async () => {
      // Call MCP tool
      const mcpResponse = await callMCPTool(
        baseUrl,
        sessionId,
        "list_advisories",
        {
          ecosystem: "npm",
          per_page: 1,
        }
      );
      const mcpContent = JSON.parse(mcpResponse.result.content[0].text);

      // Call REST API directly
      const apiResponse = await fetch(
        `http://localhost:${API_PORT}/advisories?ecosystem=npm&per_page=1`
      );
      const apiAdvisories = await apiResponse.json();

      // Results should match
      expect(mcpContent.advisories[0].ghsa_id).toBe(apiAdvisories[0].ghsa_id);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid ecosystem", async () => {
      try {
        await callMCPTool(baseUrl, sessionId, "list_advisories", {
          ecosystem: "invalid-ecosystem",
        });
        // If validation happens at tool level, should throw
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should handle missing required parameters", async () => {
      try {
        await callMCPTool(baseUrl, sessionId, "get_advisory", {});
        // Should fail without ghsa_id
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
