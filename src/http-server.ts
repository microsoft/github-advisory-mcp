#!/usr/bin/env node

/**
 * Romulus Advisory MCP Server - HTTP Streaming mode
 *
 * This server runs in HTTP streaming mode for remote MCP client access.
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createAdvisoryServer } from "./server.js";
import { createLocalAdvisoryServer } from "./local-server.js";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { spawn } from "child_process";
import { initTelemetry } from "./telemetry.js";
import { createLogger } from "./logger.js";

const logger = createLogger('MCP-HTTP');
const apiLogger = createLogger('API');
const setupLogger = createLogger('Setup');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Enable CORS and expose session ID header
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  })
);

// Configuration
const mcpPort = parseInt(process.env.MCP_PORT || '18006');
const apiPort = parseInt(process.env.ADVISORY_API_PORT || '18005');
const apiHost = process.env.ADVISORY_API_HOST || '127.0.0.1';
const repoPath = process.env.ADVISORY_REPO_PATH || join(__dirname, '..', 'external', 'advisory-database');

// Store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Store local API server instance
let localApiUrl: string;

async function setupAdvisoryDatabase(): Promise<void> {
  setupLogger.info('Setting up advisory database...');
  const scriptPath = join(__dirname, '..', 'scripts', 'setup-advisory-database.sh');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, repoPath], {
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        setupLogger.info('Database setup complete');
        resolve();
      } else {
        setupLogger.warn(`Database setup exited with code ${code}, continuing...`);
        resolve(); // Continue even if setup fails
      }
    });
    
    proc.on('error', (err) => {
      setupLogger.warn('Setup script error', { error: err.message });
      resolve(); // Continue even if setup fails
    });
  });
}

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "romulus-advisory-mcp",
    mcpPort,
    apiPort,
    localApiUrl,
    repoPath
  });
});

/**
 * Handle POST requests for MCP communication
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const requestMethod = req.body?.method;

  logger.debug('Incoming MCP request', { sessionId: sessionId || 'NEW', method: requestMethod });

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
      await transport.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      const newSessionId = randomUUID();
      logger.info('Creating new MCP session', { sessionId: newSessionId });
      
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sid) => {
          logger.info('Session initialized', { sessionId: sid });
        },
      });

      // Store transport
      transports[newSessionId] = transport;

      // Clean up on close
      transport.onclose = () => {
        logger.info('Session closed', { sessionId: newSessionId });
        delete transports[newSessionId];
      };

      // Connect to MCP server
      const server = createAdvisoryServer();
      await server.connect(transport);

      // Handle initialization
      await transport.handleRequest(req, res, req.body);
    } else {
      // Invalid request
      logger.warn('Invalid MCP request', { sessionId, method: requestMethod, hasInitializeBody: isInitializeRequest(req.body) });
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request: Expected initialize request without session ID, or valid session ID",
        },
      });
    }
  } catch (error) {
    logger.error('Error handling MCP request', { 
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      method: requestMethod
    });
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
  }
});

async function main() {
  // Initialize telemetry first
  initTelemetry();
  
  // Setup advisory database
  try {
    await setupAdvisoryDatabase();
  } catch (error) {
    setupLogger.warn('Database setup failed, continuing', { error: error instanceof Error ? error.message : String(error) });
  }

  // Start local REST API server
  apiLogger.info(`Starting local API server on ${apiHost}:${apiPort}...`);
  const { url } = await createLocalAdvisoryServer({
    repositoryPath: repoPath,
    port: apiPort,
    host: apiHost
  });
  localApiUrl = url;
  apiLogger.info(`Local API ready`, { url });

  // Start HTTP server
  app.listen(mcpPort, () => {
    logger.info(`Romulus Advisory MCP Server (HTTP) listening`, { port: mcpPort });
    logger.info(`MCP endpoint: http://localhost:${mcpPort}/mcp`);
    logger.info(`Health check: http://localhost:${mcpPort}/health`);
    apiLogger.info(`Local API: ${localApiUrl}`);
    setupLogger.info(`Repository: ${repoPath}`);
  });
}

main().catch((error) => {
  logger.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
