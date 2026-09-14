# Local HTTP / REST & MCP protocol recipes

Low-level request examples for the HTTP server. For everyday use, prefer the MCP
tools via VS Code Copilot (see the [README](../README.md)); these recipes are for
directly exercising the REST API and the raw MCP JSON-RPC protocol.

Start the HTTP server first:

```powershell
$env:ADVISORY_REPO_PATH = "C:\path\to\advisory-database"
$env:MCP_PORT = "18006"; $env:ADVISORY_API_PORT = "18005"
node dist\http-server.js
```

## Health checks

```powershell
Invoke-RestMethod http://localhost:18006/health   # MCP server
Invoke-RestMethod http://localhost:18005/health   # Local REST API
```

## Local REST API

```powershell
# List advisories by ecosystem
Invoke-RestMethod "http://localhost:18005/advisories?ecosystem=npm&per_page=5"

# Get a specific advisory
Invoke-RestMethod "http://localhost:18005/advisories/GHSA-jc85-fpwf-qm7x"

# Search advisories
Invoke-RestMethod "http://localhost:18005/search?q=express"
```

## MCP tools over HTTP (raw JSON-RPC)

**Initialize a session:**
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

**List tools:**
```powershell
$body = @{ jsonrpc = "2.0"; id = 2; method = "tools/list" } | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:18006/mcp" -Method POST -Body $body -ContentType "application/json" -Headers @{"Mcp-Session-Id"=$sessionId}
```

**Call `list_advisories`:**
```powershell
$body = @{
  jsonrpc = "2.0"
  id = 3
  method = "tools/call"
  params = @{
    name = "list_advisories"
    arguments = @{ ecosystem = "npm"; severity = "high"; per_page = 5 }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://localhost:18006/mcp" -Method POST -Body $body -ContentType "application/json" -Headers @{"Mcp-Session-Id"=$sessionId}
```
