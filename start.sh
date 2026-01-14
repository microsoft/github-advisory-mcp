#!/bin/bash
set -e

# Default values
MCP_PORT="${MCP_PORT:-18006}"
API_PORT="${ADVISORY_API_PORT:-18005}"
REPO_PATH="${ADVISORY_REPO_PATH:-external/advisory-database}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Microsoft GitHub Advisory MCP Server..."
echo "MCP Port: $MCP_PORT"
echo "API Port: $API_PORT"
echo "Repository: $REPO_PATH"

export MCP_PORT
export ADVISORY_API_PORT="$API_PORT"
export ADVISORY_REPO_PATH="$REPO_PATH"

node dist/http-server.js
