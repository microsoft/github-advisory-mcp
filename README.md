# Romulus MCP Advisory Server

MCP server for querying GitHub Security Advisories from a local cloned advisory database.

## Architecture

**Two-Tier Design:**
```
┌─────────────────────────────────────┐
│ MCP Server (stdio or HTTP)          │  Port: 18006 (HTTP mode)
│  - list_advisories tool             │
│  - get_advisory tool                │
└──────────┬──────────────────────────┘
           │ calls internally
┌──────────▼──────────────────────────┐
│ Local Express REST API              │  Port: 18005
│  GET /health                        │
│  GET /advisories                    │
│  GET /advisories/:ghsa_id           │
│  GET /search?q=<query>              │
└──────────┬──────────────────────────┘
           │ reads from
┌──────────▼──────────────────────────┐
│ LocalRepositoryDataSource           │
│  Reads JSON files from:             │
│  external/advisory-database/        │
└─────────────────────────────────────┘
```

## Quick Start (VS Code + GitHub Copilot)

**For users who just want to use the MCP server in VS Code:**

1. **Clone and Setup:**
```bash
git clone https://github.com/microsoft/github-advisory-mcp.git
cd github-advisory-mcp
npm install
npm run build
```

2. **The `.vscode/mcp.json` is pre-configured:**
```json
{
  "servers": {
    "advisory": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "type": "stdio",
      "env": {
        "ADVISORY_REPO_PATH": "${workspaceFolder}/external/advisory-database"
      }
    }
  }
}
```

3. **Reload VS Code** - Copilot will automatically:
   - Clone the advisory database (~310K advisories) on first use
   - Enable MCP tools: `list_advisories`, `get_advisory`

4. **Test in Copilot Chat:**
```
@workspace Find high-severity npm advisories related to express
```

**Done!** The MCP server runs automatically when Copilot needs it.

## Setup (Advanced)

### 1. Install Dependencies
```bash
npm install
npm run build
```

### 2. Database Setup (Optional - Auto-clones on first use)
```bash
# Linux/Mac (manual pre-clone)
./scripts/setup-advisory-database.sh

# Windows (manual pre-clone)
git clone --depth=1 https://github.com/github/advisory-database.git external/advisory-database
```

The database will auto-clone on first MCP tool call if not present.

## Usage

### Start Server (HTTP Streaming Mode)

**Windows:**
```powershell
.\Start.ps1
# or with custom ports:
.\Start.ps1 -McpPort 18006 -ApiPort 18005
```

**Manual Start:**
```powershell
$env:ADVISORY_REPO_PATH = "c:\build\maxgolov\advisory\external\advisory-database"
$env:MCP_PORT = "18006"
$env:ADVISORY_API_PORT = "18005"
node dist\http-server.js
```

### Start Server (stdio Mode)
```bash
ADVISORY_REPO_PATH=/path/to/advisory-database node dist/index.js
```

## Testing

### Quick Test (Copilot Chat)
After setup, test in VS Code Copilot Chat:
```
@workspace /tests What tools does the advisory MCP server provide?
```

Or query advisories directly:
```
@workspace Find critical npm advisories from 2024
@workspace Get details for GHSA-jc85-fpwf-qm7x
```

### Unit Tests (Automated)
```bash
npm test           # All tests
npm run test:e2e   # E2E tests (18 tests, ~9.5s after database cached)
```

### Health Checks
```powershell
# MCP Server Health
Invoke-RestMethod http://localhost:18006/health

# Local API Health
Invoke-RestMethod http://localhost:18005/health
```

### Test Local REST API Directly

**List advisories by ecosystem:**
```powershell
Invoke-RestMethod "http://localhost:18005/advisories?ecosystem=npm&per_page=5"
```

**Get specific advisory:**
```powershell
Invoke-RestMethod "http://localhost:18005/advisories/GHSA-jc85-fpwf-qm7x"
```

**Search advisories:**
```powershell
Invoke-RestMethod "http://localhost:18005/search?q=express"
```

### Test MCP Tools

**Initialize Session:**
```powershell
$body = @{
  jsonrpc = "2.0"
  id = 1
  method = "initialize"
  params = @{
    protocolVersion = "2024-11-05"
    capabilities = @{}
    clientInfo = @{ name = "test-client"; version = "1.0.0" }
  }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "http://localhost:18006/mcp" -Method POST -Body $body -ContentType "application/json"
$sessionId = $response.result.sessionId
```

**List Tools:**
```powershell
$body = @{
  jsonrpc = "2.0"
  id = 2
  method = "tools/list"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:18006/mcp" -Method POST -Body $body -ContentType "application/json" -Headers @{"Mcp-Session-Id"=$sessionId}
```

**Call list_advisories:**
```powershell
$body = @{
  jsonrpc = "2.0"
  id = 3
  method = "tools/call"
  params = @{
    name = "list_advisories"
    arguments = @{
      ecosystem = "npm"
      severity = "high"
      per_page = 5
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://localhost:18006/mcp" -Method POST -Body $body -ContentType "application/json" -Headers @{"Mcp-Session-Id"=$sessionId}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADVISORY_REPO_PATH` | `./external/advisory-database` | Path to cloned advisory-database repository |
| `MCP_PORT` | `18006` | Port for MCP HTTP server |
| `ADVISORY_API_PORT` | `18005` | Port for local REST API |
| `ADVISORY_API_HOST` | `127.0.0.1` | Host for local REST API |
| `ADVISORY_API_BASE` | `http://localhost:18005` | Base URL for MCP tools to call local API |

## MCP Tools

### list_advisories

List security advisories with optional filters.

**Parameters:**
- `ghsa_id` (string): GHSA identifier
- `cve_id` (string): CVE identifier
- `ecosystem` (enum): Package ecosystem (npm, pip, maven, etc.)
- `severity` (enum): Severity level (low, medium, high, critical, unknown)
- `cwes` (string): Comma-separated CWE identifiers
- `is_withdrawn` (boolean): Filter withdrawn advisories
- `affects` (string): Package name filter
- `published` (string): Published date filter
- `updated` (string): Updated date filter
- `per_page` (number): Results per page (max 100)
- `direction` (enum): Sort direction (asc, desc)
- `sort` (enum): Sort field (updated, published)

**Example:**
```json
{
  "ecosystem": "npm",
  "severity": "critical",
  "per_page": 10
}
```

### get_advisory

Get detailed information about a specific advisory.

**Parameters:**
- `ghsa_id` (string, required): GHSA identifier (e.g., GHSA-xxxx-xxxx-xxxx)

**Example:**
```json
{
  "ghsa_id": "GHSA-jc85-fpwf-qm7x"
}
```

## Integration with Orchestrator

The MCP Advisory server can be managed by the Romulus RED orchestrator:

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client

# Connect to MCP Advisory server
async with stdio_client(
    command="node",
    args=["dist/index.js"],
    env={
        "ADVISORY_REPO_PATH": "/path/to/advisory-database"
    }
) as (read, write):
    async with ClientSession(read, write) as session:
        # List npm advisories
        result = await session.call_tool(
            "list_advisories",
            arguments={"ecosystem": "npm", "per_page": 10}
        )
```

## Port Allocation

- **18005**: Local REST API (Express server)
- **18006**: MCP HTTP streaming endpoint

**Avoids conflicts with:**
- 18004: MCP Coder
- 3333: Inspector MCP
- 3500: Memory Service

## Known Issues

### Windows
- The bash script `setup-advisory-database.sh` doesn't work on Windows
- Workaround: Manually clone database or use existing one via `ADVISORY_REPO_PATH`
- Use `Start.ps1` script for convenient startup

### Database Size
- The advisory-database is ~100K+ JSON files
- Shallow clone (`--depth=1`) recommended
- First query loads entire index into memory (lazy loading)
- Subsequent queries are fast (cached)

## Development

**Watch Mode:**
```powershell
npm run dev
```

**Clean Build:**
```powershell
npm run clean
npm run build
```

**File Structure:**
```
services/mcp/advisory/
├── src/
│   ├── index.ts              # stdio entry point
│   ├── http-server.ts        # HTTP streaming server
│   ├── server.ts             # MCP server factory
│   ├── local-server.ts       # Express REST API
│   ├── datasources/
│   │   └── local-repository.ts  # LocalRepositoryDataSource
│   ├── tools/
│   │   └── advisories.ts     # MCP tools (list/get)
│   └── types/
│       └── data-source.ts    # TypeScript interfaces
├── dist/                     # Compiled JavaScript
├── external/
│   └── advisory-database/    # Git submodule (cloned)
├── scripts/
│   └── setup-advisory-database.sh
├── package.json
├── tsconfig.json
├── Start.ps1                 # Windows startup script
└── README.md
```

## Testing Status

✅ **Working:**
- TypeScript compilation
- HTTP server startup (port 18006)
- Local REST API (port 18005)
- Health endpoints
- Advisory listing with filters
- Getting specific advisory by GHSA ID
- Ecosystem filtering (npm, pip, etc.)
- Pagination

⏳ **Not Yet Tested:**
- MCP tool calls (list_advisories, get_advisory)
- Session management
- stdio mode
- Multiple concurrent sessions
- Search functionality

## Next Steps

1. Create test client for MCP tool calls
2. Test stdio mode
3. Add to orchestrator configuration
4. Create Service.ps1 for unified management
5. Add Docker support
6. Create integration tests
