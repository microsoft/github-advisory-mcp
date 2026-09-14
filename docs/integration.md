# Integration & hardening examples

Supplementary examples referenced from the [README](../README.md). These are
illustrative, not shipped code.

## Embedding the MCP server in an orchestrator

The stdio MCP server can be driven from any MCP client. Python example:

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client

# Connect to the MCP Advisory server
async with stdio_client(
    command="node",
    args=["dist/index.js"],
    env={
        "ADVISORY_REPO_PATH": "/path/to/advisory-database"
    }
) as (read, write):
    async with ClientSession(read, write) as session:
        result = await session.call_tool(
            "list_advisories",
            arguments={"ecosystem": "npm", "per_page": 10}
        )
```

## Rate limiting (HTTP mode)

stdio mode is single-user and needs no rate limiting. If you expose the HTTP
server beyond localhost, add rate limiting — for example with `express-rate-limit`:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100                  // limit each IP to 100 requests per window
});

app.use('/mcp', limiter);
```
