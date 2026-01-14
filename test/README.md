# MCP Advisory Server Tests

Comprehensive test suite for the MCP Advisory server implementation.

## Test Structure

```
test/
├── e2e/                    # End-to-end MCP protocol tests
│   └── mcp-server.test.ts  # Server integration tests (✅ 18/18 passing)
├── integration/            # AI SDK integration tests  
│   └── ai-sdk-azure.test.ts # Azure OpenAI agent tests (⚠️ schema compatibility issues)
├── test-utils.ts          # Shared test utilities
└── README.md              # This file
```

## Running Tests

### All Tests
```bash
npm test
```

### E2E Tests Only (Recommended)
```bash
npm run test:e2e
```

### AI Integration Tests (Experimental)
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

## Test Coverage

### ✅ E2E Tests (18 passing)

**Health Check** (1 test)
- Server health endpoint responds correctly

**MCP Session Management** (3 tests)
- Initialize session and get UUID
- List available tools (list_advisories, get_advisory)
- Verify tool schemas

**List Advisories Tool** (4 tests)
- List npm ecosystem advisories
- Filter by severity (critical, high, medium, low)
- Pagination support (per_page parameter)
- Multiple ecosystems (npm, pip, maven, go, rust)

**Get Advisory Tool** (5 tests)
- Retrieve specific advisory by GHSA ID
- Verify CVE information included
- Verify CWE information included
- Error handling for invalid GHSA ID
- Error handling for missing parameter

**Local REST API Integration** (3 tests)
- REST API accessible independently
- MCP tool results match direct API results
- Advisory database initialized properly

**Error Handling** (2 tests)
- Invalid ecosystem parameter
- Missing required parameters

### ⚠️ AI Integration Tests (experimental)

**Note:** These tests have Azure OpenAI SDK compatibility issues with tool schema serialization.

**Test Scenarios:**
1. Search npm advisories with AI natural language queries
2. Generate security reports for specific advisories  
3. Compare advisories across ecosystems
4. Multi-step research workflow (list → get → summarize)

**Known Issues:**
- AI SDK v5+ expects specific tool schema format
- Azure OpenAI endpoint may have different API requirements
- Schema serialization between Zod and OpenAI format

## Test Utilities (`test-utils.ts`)

### Server Management
- `startMCPServer(port, apiPort, repoPath)` - Start server programmatically
- `stopMCPServer(serverProcess)` - Graceful shutdown with SIGTERM/SIGKILL
- `waitForServer(port, timeout)` - Poll health endpoint until ready

### MCP Protocol
- `initializeMCPSession(baseUrl)` - Initialize session, get UUID
- `callMCPTool(baseUrl, sessionId, toolName, args)` - Invoke MCP tool
- `listMCPTools(baseUrl, sessionId)` - Get available tools

### Utilities
- `parseSSEResponse(sseText)` - Parse Server-Sent Events format

## Environment Variables

Create `.env` file in project root:

```bash
# MCP Server Configuration
MCP_PORT=18006
ADVISORY_API_PORT=18005
ADVISORY_REPO_PATH=/path/to/advisory-database

# Azure OpenAI (for AI SDK tests - OPTIONAL)
# Tests automatically skip if not configured
AZURE_OPENAI_API_KEY=your-key-here
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# GitHub Token (for advisory database access)
GITHUB_TOKEN=your-token-here
```

## Prerequisites

### Advisory Database
The tests require GitHub Advisory Database clone:

```bash
# From advisory repo
git submodule update --init --depth 1 external/advisory-database
```

Or using the setup script:
```bash
./scripts/setup-advisory-database.sh
```

### Dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

## Test Patterns

### Server Lifecycle Pattern
```typescript
let serverProcess: ChildProcess;

beforeAll(async () => {
  serverProcess = await startMCPServer(MCP_PORT, API_PORT, REPO_PATH);
  sessionId = await initializeMCPSession(baseUrl);
});

afterAll(async () => {
  await stopMCPServer(serverProcess);
});
```

### Tool Call Pattern
```typescript
const response = await callMCPTool(baseUrl, sessionId, "list_advisories", {
  ecosystem: "npm",
  severity: "critical",
  per_page: 10
});

const advisories = JSON.parse(response.result.content[0].text);
expect(advisories.length).toBeGreaterThan(0);
```

### Error Handling Pattern
```typescript
try {
  await callMCPTool(baseUrl, sessionId, "list_advisories", {
    ecosystem: "invalid"
  });
  expect.fail("Should have thrown error");
} catch (error: any) {
  expect(error.message).toContain("Invalid ecosystem");
}
```

## Troubleshooting

### Server Won't Start
- Check if port 18005 or 18006 is already in use
- Verify advisory database path exists
- Check server logs in test output

### Tests Timeout
- Default timeout is 30 seconds (configured in vitest.config.ts)
- Increase timeout if needed: `{ timeout: 60000 }`
- Check network connectivity to localhost

### AI Tests Skip
- **Tests automatically skip** if AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY not set
- This is by design - integration tests are optional
- Safe to run `npm test` without Azure credentials
- Check test output for: `[Test] Skipping AI SDK tests - Azure OpenAI credentials not configured`

### Advisory Database Empty
- Run `./scripts/setup-advisory-database.sh`
- Verify submodule initialized: `git submodule status`
- Check GitHub token has correct permissions

## VS Code Tasks

Use VS Code tasks for easier testing:
- **Advisory: Run All Tests** - Ctrl+Shift+B
- **Advisory: Run E2E Tests** - Test menu
- **Advisory: Run AI Tests** - Test menu
- **Advisory: Build** - Builds TypeScript

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Setup Advisory Database
  run: ./scripts/setup-advisory-database.sh

- name: Install Dependencies
  run: npm install
  working-directory: services/mcp/advisory

- name: Build
  run: npm run build
  working-directory: services/mcp/advisory

- name: Run E2E Tests
  run: npm run test:e2e
  working-directory: services/mcp/advisory
```

**Note:** Skip AI integration tests in CI (no credentials).

## Future Improvements

- [ ] Fix Azure OpenAI SDK tool schema compatibility
- [ ] Add unit tests for individual functions
- [ ] Add performance benchmarks
- [ ] Add test coverage reporting
- [ ] Mock advisory database for faster tests
- [ ] Add integration tests for stdio transport
- [ ] Test concurrent session handling
- [ ] Test rate limiting behavior
