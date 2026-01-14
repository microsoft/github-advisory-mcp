#!/usr/bin/env bash
#
# Clone or update the GitHub advisory-database repository.
#
# This script clones or updates the external/advisory-database directory
# with a shallow clone (latest commit only) to save disk space and time.
#
# The advisory-database is OPTIONAL and only required for:
# - Local server tests (src/test/local-server.test.ts)
# - GitHub API comparison tests (src/test/github-api-comparison.test.ts)
# - VS Code extension local server integration tests
#
# This is intentionally NOT run in CI/CD by default to keep workflows fast.
# Run manually when you need to test with real advisory data.

set -euo pipefail

# Repository URL
ADVISORY_REPO="https://github.com/github/advisory-database.git"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  GitHub Advisory Database - Submodule Setup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get repository root (parent of scripts directory)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_PATH="$REPO_ROOT/external/advisory-database"

echo -e "${GRAY}📍 Repository root: $REPO_ROOT${NC}"
echo -e "${GRAY}📁 Target path: $SUBMODULE_PATH${NC}"
echo ""

# Check if directory exists and is a git repository
if [ -d "$SUBMODULE_PATH/.git" ]; then
    echo -e "${YELLOW}📦 Repository exists - updating...${NC}"
    
    cd "$SUBMODULE_PATH"
    
    # Fetch latest changes (shallow)
    echo -e "${GRAY}   Fetching latest changes...${NC}"
    git fetch --depth=1 origin main || {
        echo -e "${YELLOW}⚠️  Fetch failed, trying pull instead...${NC}"
        git pull --depth=1 origin main
    }
    
    # Reset to latest
    echo -e "${GRAY}   Resetting to latest commit...${NC}"
    git reset --hard origin/main
    
    # Show current commit
    COMMIT_HASH=$(git rev-parse --short HEAD)
    COMMIT_DATE=$(git log -1 --format=%cd --date=short)
    
    echo ""
    echo -e "${GREEN}✅ Repository updated successfully!${NC}"
    echo -e "${GRAY}   Commit: $COMMIT_HASH ($COMMIT_DATE)${NC}"
    
    cd "$REPO_ROOT"
elif [ -d "$SUBMODULE_PATH" ]; then
    echo -e "${YELLOW}⚠️  Directory exists but is not a git repository${NC}"
    echo -e "${YELLOW}   Removing and re-cloning...${NC}"
    rm -rf "$SUBMODULE_PATH"
    NEEDS_CLONE=true
else
    echo -e "${CYAN}📥 Repository not found - will clone fresh copy${NC}"
    NEEDS_CLONE=true
fi

if [ "${NEEDS_CLONE:-false}" = "true" ]; then
    echo ""
    echo -e "${CYAN}🌟 Cloning advisory-database (shallow, latest only)...${NC}"
    echo -e "${GRAY}   This may take a few minutes (100K+ advisories)...${NC}"
    echo ""
    
    # Create external directory if needed
    mkdir -p "$REPO_ROOT/external"
    
    # Clone with shallow history
    git clone --depth=1 --branch main "$ADVISORY_REPO" "$SUBMODULE_PATH"
    
    # Show info about cloned repo
    cd "$SUBMODULE_PATH"
    COMMIT_HASH=$(git rev-parse --short HEAD)
    COMMIT_DATE=$(git log -1 --format=%cd --date=short)
    ADVISORY_COUNT=$(find . -name "*.json" -type f | wc -l)
    
    echo ""
    echo -e "${GREEN}✅ Repository cloned successfully!${NC}"
    echo -e "${GRAY}   Commit: $COMMIT_HASH ($COMMIT_DATE)${NC}"
    echo -e "${GRAY}   Advisories: ~$ADVISORY_COUNT JSON files${NC}"
    
    cd "$REPO_ROOT"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Next Steps${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${WHITE}To run tests that use real advisory data:${NC}"
echo -e "${GRAY}  npm test                    # All tests${NC}"
echo -e "${GRAY}  npm run test:unit           # Unit tests only${NC}"
echo -e "${GRAY}  npm run test:e2e            # E2E (local server) tests${NC}"
echo -e "${GRAY}  npm run test:integration    # Integration tests${NC}"
echo ""
echo -e "${WHITE}The advisory database will be automatically updated on MCP server start.${NC}"
echo ""
