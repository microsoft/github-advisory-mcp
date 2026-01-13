import { spawn, ChildProcess } from "child_process";

/**
 * Wait for server to be ready by polling health endpoint
 */
export async function waitForServer(
  port: number,
  timeout: number = 10000
): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `http://localhost:${port}/health`;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        console.log(`[Test] Server ready on port ${port}`);
        return;
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Server on port ${port} did not start within ${timeout}ms`);
}

/**
 * Check if server is running on port
 */
export async function isServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Parse SSE (Server-Sent Events) response
 */
export function parseSSEResponse(sseText: string): any {
  const lines = sseText.trim().split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.substring(6));
    }
  }
  throw new Error("No data field found in SSE response");
}

/**
 * Start MCP server in background
 */
export async function startMCPServer(
  port: number,
  apiPort: number,
  repoPath: string
): Promise<ChildProcess> {
  const serverPath = "./dist/http-server.js";
  
  const serverProcess = spawn("node", [serverPath], {
    env: {
      ...process.env,
      MCP_PORT: port.toString(),
      ADVISORY_API_PORT: apiPort.toString(),
      ADVISORY_REPO_PATH: repoPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture output for debugging
  serverProcess.stdout?.on("data", (data) => {
    console.log("[Server]", data.toString().trim());
  });

  serverProcess.stderr?.on("data", (data) => {
    console.error("[Server Error]", data.toString().trim());
  });

  // Wait for server to be ready (longer timeout for database clone on first run)
  await waitForServer(port, 180000); // 3 minutes

  return serverProcess;
}

/**
 * Stop MCP server
 */
export async function stopMCPServer(
  serverProcess: ChildProcess
): Promise<void> {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  return new Promise((resolve) => {
    serverProcess.on("close", () => {
      resolve();
    });

    serverProcess.kill("SIGTERM");

    // Force kill after 5 seconds
    setTimeout(() => {
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 5000);
  });
}

/**
 * Initialize MCP session
 */
export async function initializeMCPSession(
  baseUrl: string
): Promise<string> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vitest-client", version: "1.0.0" },
      },
      id: 1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Initialize failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let data: any;

  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    data = parseSSEResponse(text);
  } else {
    data = await response.json();
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error("No session ID in response headers");
  }

  return sessionId;
}

/**
 * Call MCP tool
 */
export async function callMCPTool(
  baseUrl: string,
  sessionId: string,
  toolName: string,
  args: any
): Promise<any> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
      id: Math.floor(Math.random() * 10000),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tool call failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    return parseSSEResponse(text);
  } else {
    return response.json();
  }
}

/**
 * List MCP tools
 */
export async function listMCPTools(
  baseUrl: string,
  sessionId: string
): Promise<any> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      id: 2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`List tools failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    return parseSSEResponse(text);
  } else {
    return response.json();
  }
}
