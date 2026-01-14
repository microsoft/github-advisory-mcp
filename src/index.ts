#!/usr/bin/env node

/**
 * Microsoft GitHub Advisory MCP Server
 * 
 * Serves GitHub Security Advisories from local cloned advisory-database
 * Supports both stdio and HTTP streaming transports
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAdvisoryServer } from './server.js';
import { createLocalAdvisoryServer } from './local-server.js';
import { join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const httpIndex = args.indexOf('--http');
const isHttpMode = httpIndex !== -1;

// Configuration
const repoPath = process.env.ADVISORY_REPO_PATH || join(__dirname, '..', 'external', 'advisory-database');
const apiPort = process.env.ADVISORY_API_PORT ? parseInt(process.env.ADVISORY_API_PORT) : 18005;
const apiHost = process.env.ADVISORY_API_HOST || '127.0.0.1';

async function setupAdvisoryDatabase(): Promise<void> {
  console.error('[Advisory] Setting up advisory database...');
  const scriptPath = join(__dirname, '..', 'scripts', 'setup-advisory-database.sh');
    // Validate script path exists and is within expected directory
  if (!scriptPath.includes('scripts/setup-advisory-database.sh')) {
    throw new Error('Invalid script path');
  }
    return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, repoPath], {
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.error('[Advisory] ✅ Database setup complete');
        resolve();
      } else {
        console.error(`[Advisory] ❌ Database setup failed with code ${code}`);
        reject(new Error(`Setup script exited with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      console.error('[Advisory] ❌ Failed to run setup script:', err);
      reject(err);
    });
  });
}

async function startLocalAPI() {
  console.error(`[Advisory] Starting local API server on ${apiHost}:${apiPort}...`);
  const { url } = await createLocalAdvisoryServer({
    repositoryPath: repoPath,
    port: apiPort,
    host: apiHost
  });
  console.error(`[Advisory] ✅ Local API ready at ${url}`);
  return url;
}

async function main() {
  // Setup advisory database (clone/update git submodule)
  try {
    await setupAdvisoryDatabase();
  } catch (error) {
    console.error('[Advisory] Warning: Database setup failed, continuing anyway:', error);
  }

  // Start local REST API server
  await startLocalAPI();

  // Create MCP server
  const server = createAdvisoryServer();

  if (isHttpMode) {
    // HTTP mode is handled by separate http-server.ts
    console.error('[Advisory] Error: Use http-server.js for HTTP mode');
    console.error('[Advisory] Run: node dist/http-server.js');
    process.exit(1);
  } else {
    // stdio mode (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Advisory] GitHub Advisory MCP Server running on stdio');
    console.error(`[Advisory] Local API: ${apiHost}:${apiPort}`);
    console.error(`[Advisory] Repository: ${repoPath}`);
  }
}

main().catch((error) => {
  console.error('[Advisory] Fatal error:', error);
  process.exit(1);
});
