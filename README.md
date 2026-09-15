# Microsoft GitHub Advisory MCP Server

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
   - Clone the advisory database (~370K advisory files; ~35K github-reviewed served) on first use
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
$env:ADVISORY_REPO_PATH = "C:\path\to\advisory-database"
$env:MCP_PORT = "18006"
$env:ADVISORY_API_PORT = "18005"
node dist\http-server.js
```

### Start Server (stdio Mode)
```bash
ADVISORY_REPO_PATH=/path/to/advisory-database node dist/index.js
```

### Guides

- [Correlating advisories with code](docs/advisory-code-correlation.md) — use the
  advisory server together with a code-search MCP to locate and triage vulnerable
  code paths.

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

### Automated Tests
```bash
npx vitest run test/unit   # fast, hermetic unit tests (this is what `npm test` runs)
npm run test:e2e           # end-to-end MCP tests (needs the advisory database)
```

### Health Checks
```powershell
# MCP Server Health
Invoke-RestMethod http://localhost:18006/health

# Local API Health
Invoke-RestMethod http://localhost:18005/health
```

### Test the REST API and MCP protocol directly

Low-level REST and raw MCP JSON-RPC request recipes (health checks, session
initialize, `tools/list`, `tools/call`) live in [docs/http-api.md](docs/http-api.md).

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

## Security & Validation

### Input Validation

All MCP tool parameters are validated using **Zod schemas**:

**list_advisories validation:**
- `ecosystem`: Enum of valid ecosystems (npm, pip, maven, etc.) - prevents injection
- `severity`: Enum (low, medium, high, critical, unknown) - prevents injection  
- `per_page`: Number constrained to 1-100 max - prevents resource exhaustion
- `cwes`: String pattern matching for CWE identifiers - validates format
- Date filters: ISO 8601 format validation

**get_advisory validation:**
- `ghsa_id`: Pattern match `GHSA-xxxx-xxxx-xxxx` - prevents path traversal
- Required field enforcement - rejects empty/null values

**File System Protection:**
- Path validation: Script execution paths validated against known safe scripts
- No user-supplied paths accepted - prevents directory traversal
- Read-only database access - no write operations exposed

### Rate Limiting

**Current:** No rate limiting (stdio transport = single local user)

**Considerations:**
- **stdio mode**: Single-process, single-user - no rate limiting needed
- **HTTP mode**: Consider adding rate limiting if exposed beyond localhost
- **Database queries**: Inherently rate-limited by disk I/O (hundreds of thousands of files)

**Future (HTTP mode):** add rate limiting if you expose the server beyond
localhost — see [docs/integration.md](docs/integration.md).

### Session Security

- **Timeout**: 30-minute automatic session cleanup
- **Isolation**: Each MCP session isolated (no shared state)
- **Transport**: stdio (local) or HTTP (localhost-only by default)

### Known Security Measures

✅ Path validation for script execution (prevents command injection)  
✅ Zod schema validation (prevents type confusion attacks)  
✅ Session timeout (prevents resource leaks)  
✅ Read-only database access (no write exposure)  
✅ Enum validation for critical parameters (prevents injection)  
⚠️ No rate limiting (stdio mode = trusted local user)  
⚠️ No authentication (stdio mode = local process trust model)

## Integration with Orchestrator

The stdio MCP server can be driven from any MCP client. A Python client example
and an HTTP rate-limiting snippet are in [docs/integration.md](docs/integration.md).

## Port Allocation

- **18005**: Local REST API (Express server)
- **18006**: MCP HTTP streaming endpoint

## Troubleshooting

### Database Clone Failures

**Issue:** `git clone` fails for advisory-database
```
fatal: unable to access 'https://github.com/github/advisory-database.git/': Could not resolve host
```

**Solutions:**
1. Check network connectivity: `ping github.com`
2. Use VPN if behind corporate firewall
3. Pre-download database: `git clone --depth=1 https://github.com/github/advisory-database.git external/advisory-database`
4. Point to existing database: `export ADVISORY_REPO_PATH=/path/to/existing/advisory-database`

**Timing:** Initial clone takes 2-5 minutes (hundreds of thousands of files)

### Server Won't Start

**Issue:** `Error: EADDRINUSE: address already in use`

**Solution:**
```bash
# Check what's using the port
lsof -i :18005  # Local API
lsof -i :18006  # MCP server

# Kill process
kill -9 <PID>
```

### Windows-Specific Issues

**Issue:** Bash script fails on Windows
```powershell
./scripts/setup-advisory-database.sh
# bash: ./scripts/setup-advisory-database.sh: No such file or directory
```

**Solution:** Use Git Bash or WSL, or manual clone:
```powershell
git clone --depth=1 https://github.com/github/advisory-database.git external/advisory-database
```

### MCP Tools Not Available in Copilot

**Issue:** Copilot doesn't see advisory MCP tools

**Solution:**
1. Verify `.vscode/mcp.json` exists in workspace root
2. Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Check build: `npm run build` and verify `dist/index.js` exists
4. Check Copilot logs: `Ctrl+Shift+P` → "Developer: Open Logs Folder"

### Query Performance Issues

**Symptom:** Slow advisory queries (>5 seconds)

**Solutions:**
1. First query always slower (loads database index into memory)
2. Use `per_page` parameter to limit results: `per_page: 10`
3. Filter by ecosystem to reduce search space: `ecosystem: "npm"`
4. Check disk I/O: the advisory database is hundreds of thousands of files

**Performance Benchmarks:**
- First query (cold start): builds the in-memory index (slower)
- Subsequent queries: fast (index cached in memory)
- Database size: ~370K advisory JSON files (~35K github-reviewed served by default)

### Database Update Strategy

**Automated Updates:**
The advisory database auto-updates on server start via `git pull` in setup script.

**Manual Update:**
```bash
cd external/advisory-database
git pull origin main
```

**Update Frequency:** GitHub updates advisory-database multiple times daily

## Known Issues

### Windows
- The bash script `setup-advisory-database.sh` doesn't work on Windows
- Workaround: Manually clone database or use existing one via `ADVISORY_REPO_PATH`
- Use `Start.ps1` script for convenient startup

### Database Size
- The advisory-database is ~370K advisory JSON files (~35K github-reviewed)
- Shallow clone (`--depth=1`) recommended
- First query loads entire index into memory (lazy loading)
- Subsequent queries are fast (cached)

## Development

### CI/CD Pipeline

**GitHub Actions Workflows:**

1. **Build and Test** (`.github/workflows/build.yml`)
   - **Triggers:** Push to `main`, PRs to `main`
   - **Matrix:** Node.js 20.x, 22.x on Ubuntu latest
   - **Steps:** Checkout → Setup Node → `npm ci` → build → verify artifacts → unit tests with coverage. End-to-end tests run on the `main` branch.

2. **Copilot PR Review** (`.github/workflows/copilot-review.yml`)
   - **Triggers:** PR opened or synchronized
   - **Action:** Automatically requests Copilot code review
   - **Permissions:** pull-requests: write, contents: read

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

## Contributing

This project does not accept external contributions (pull requests) at this time. Only verified committers from the Microsoft GitHub organization may contribute code.

If you would like to get involved:

- **Report bugs or request features** by [opening an issue](https://github.com/microsoft/github-advisory-mcp/issues/new)
- **Reach out to the maintainers** at [opencode@microsoft.com](mailto:opencode@microsoft.com)

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
