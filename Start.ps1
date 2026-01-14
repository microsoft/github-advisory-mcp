#!/usr/bin/env pwsh
param([int]$McpPort = 18006, [int]$ApiPort = 18005)
$env:ADVISORY_REPO_PATH = "$PSScriptRoot/external/advisory-database"
$env:MCP_PORT = $McpPort
$env:ADVISORY_API_PORT = $ApiPort
Push-Location "$PSScriptRoot"
try { & node dist\http-server.js } 
finally { Pop-Location }
