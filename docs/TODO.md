# GitHub Advisory MCP - Repository-Specific Advisory Support

## Problem Statement

**Current Limitation:** The Advisory MCP server only indexes the `advisories/github-reviewed/` directory (214 MB) from the GitHub Advisory Database. This means **repository-specific advisories** that haven't been reviewed/curated into the global database return 404 errors.

**Example Case:** GHSA-v64q-396f-7m79 (CVE-2025-61592, Cursor RCE)
- ✅ Exists: `github.com/cursor/cursor/security/advisories/GHSA-v64q-396f-7m79`
- ❌ Missing: Global GitHub Advisory Database
- ❌ Missing: `github/advisory-database` repository
- ❌ Missing: Our local MCP index

## Root Cause

GitHub maintains **TWO separate advisory systems:**

1. **Global GitHub Advisory Database** (`github.com/advisories`)
   - Curated, reviewed advisories
   - Backed by `github/advisory-database` repository
   - Sources: NVD, npm, PyPI, RubyGems, "Security advisories reported on GitHub"
   - Requires review/curation process
   - **Current MCP coverage:** ✅ Fully indexed

2. **Repository-Specific Security Advisories** (`github.com/{owner}/{repo}/security/advisories/{GHSA-ID}`)
   - Published directly by repository owners
   - Immediate publication (no review delay)
   - Not automatically included in global database
   - **Current MCP coverage:** ❌ Not indexed

## Key Challenge: Owner/Repo Discovery

**The Blocker:** To query a repository-specific advisory via REST API, we need:
```
GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}
```

**Problem:** Given only a GHSA ID, how do we discover which `{owner}/{repo}` it belongs to?

### Does CVE Always Include Repo Information?

**Short Answer:** No, not reliably.

**CVE References Field:**
- CVE entries have a `references` array containing URLs
- **Best Case:** Includes `https://github.com/{owner}/{repo}/security/advisories/{GHSA-ID}`
- **Common Case:** Includes `https://github.com/{owner}/{repo}` (repo URL without advisory path)
- **Worst Case:** Only includes external blog posts, vendor advisories, or generic descriptions

**Example from Romulus Memory CVE-2025-61592:**
```json
{
  "id": "CVE-2025-61592",
  "references": [
    "https://github.com/cursor/cursor/security/advisories/GHSA-v64q-396f-7m79",
    "https://securitylab.github.com/advisories/..."
  ]
}
```
✅ **This CVE includes the exact advisory URL** - we can extract `cursor/cursor`

**However:**
- Not all CVEs have GHSA references
- Some CVEs predate the GitHub advisory
- Some advisories don't request CVE IDs
- Private repos won't have public CVEs

## Proposed Solutions

### Option 1: REST API Fallback with CVE Reference Parsing ⭐ **RECOMMENDED**

**Approach:**
1. Check local `github-reviewed` database (current behavior)
2. If 404, check if we have CVE ID for the GHSA
3. Parse CVE references for GitHub URLs
4. Extract `owner/repo` from references
5. Query GitHub REST API: `GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}`
6. Cache result

**Implementation:**
```typescript
async getAdvisory(ghsaId: string): Promise<Advisory | null> {
  // Step 1: Check local database
  const local = await this.localDataSource.getAdvisory(ghsaId);
  if (local) return local;
  
  // Step 2: Try REST API fallback
  const ownerRepo = await this.discoverRepoFromGHSA(ghsaId);
  if (ownerRepo) {
    return await this.githubAPI.getRepoAdvisory(ownerRepo, ghsaId);
  }
  
  return null;
}

async discoverRepoFromGHSA(ghsaId: string): Promise<string | null> {
  // Option A: Check if we have CVE mapping
  const cveId = await this.findCVEForGHSA(ghsaId);
  if (cveId) {
    const references = await this.getCVEReferences(cveId);
    const repoUrl = this.extractGitHubRepo(references);
    if (repoUrl) return repoUrl; // Returns "owner/repo"
  }
  
  // Option B: Web search fallback (see Option 2)
  return await this.searchWebForGHSA(ghsaId);
}
```

**Pros:**
- Authoritative data from GitHub API
- No web scraping
- Works for public and accessible private repos

**Cons:**
- Requires GitHub token with `repo` scope
- CVE references not always available
- Additional API calls (rate limits)

**Dependencies:**
- CVE database integration (use Romulus Memory or NVD API)
- GitHub REST API client with auth
- Reference URL parsing logic

---

### Option 2: Web Search Integration (Google/Brave)

**Approach:**
Use web search APIs to find the advisory URL when local database returns 404.

**Search Query:**
```
"GHSA-xxxx-xxxx-xxxx" site:github.com inurl:security/advisories
```

**Example APIs:**
- **Google Custom Search JSON API** - 100 queries/day free, $5/1000 after
- **Brave Search API** - 2,000 queries/month free
- **SerpAPI** - Wrapper for multiple engines

**Implementation:**
```typescript
async searchWebForGHSA(ghsaId: string): Promise<string | null> {
  const query = `"${ghsaId}" site:github.com inurl:security/advisories`;
  const results = await this.braveSearch(query);
  
  // Parse first result URL: github.com/{owner}/{repo}/security/advisories/{ghsa_id}
  const match = results[0]?.url.match(/github\.com\/([^\/]+)\/([^\/]+)\/security/);
  if (match) {
    return `${match[1]}/${match[2]}`; // owner/repo
  }
  
  return null;
}
```

**Pros:**
- No need for CVE mapping
- Works for any public advisory
- Can discover repos even without CVE

**Cons:**
- Requires external API keys
- Rate limits and costs
- Not authoritative (relies on indexing)
- Latency

---

### Option 3: GitHub Code Search API

**Approach:**
Use GitHub's Code Search API to find advisory metadata files.

**Search Query:**
```
GHSA-xxxx-xxxx-xxxx path:/security/advisories/
```

**API Endpoint:**
```
GET /search/code?q=GHSA-xxxx-xxxx-xxxx+path:/security/advisories/
```

**Implementation:**
```typescript
async searchCodeForGHSA(ghsaId: string): Promise<string | null> {
  const response = await this.githubAPI.searchCode({
    q: `${ghsaId} path:/security/advisories/`
  });
  
  // Extract repo from first match
  if (response.items.length > 0) {
    const repo = response.items[0].repository.full_name; // "owner/repo"
    return repo;
  }
  
  return null;
}
```

**Pros:**
- Native GitHub integration
- Accurate results
- No external dependencies

**Cons:**
- Rate limited (30 queries/minute)
- Only finds public repos
- May not find advisory if stored as metadata (not file)

---

### Option 4: GraphQL Repository Vulnerability Alerts

**Approach:**
Use GitHub GraphQL to search for advisories across repositories (requires org access).

**Query:**
```graphql
query SearchAdvisory($ghsaId: String!) {
  search(query: $ghsaId, type: REPOSITORY, first: 10) {
    edges {
      node {
        ... on Repository {
          nameWithOwner
          vulnerabilityAlerts(first: 100) {
            edges {
              node {
                securityVulnerability {
                  advisory {
                    ghsaId
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Pros:**
- Official GitHub API
- Can traverse multiple repos

**Cons:**
- Requires repo access
- Complex query structure
- Not designed for GHSA→Repo reverse lookup

---

### Option 5: Build Reverse Index from Scanning

**Approach:**
Periodically scan known repositories and build a reverse index: `GHSA-ID → owner/repo`.

**Sources:**
- Organizations we care about (e.g., Microsoft, cursor, openai)
- Popular repositories (GitHub trending, star counts)
- Repositories from previous Memory database queries

**Implementation:**
```typescript
// Background job
async buildReverseIndex() {
  const repos = await this.getTargetRepos();
  const index = new Map<string, string>();
  
  for (const repo of repos) {
    const advisories = await this.githubAPI.listRepoAdvisories(repo);
    for (const advisory of advisories) {
      index.set(advisory.ghsa_id, repo);
    }
  }
  
  await this.saveIndex(index);
}
```

**Pros:**
- Fast lookups (local index)
- No external dependencies at query time
- Works offline

**Cons:**
- Requires background indexing
- Storage overhead
- Stale data between scans
- Doesn't cover all repos

---

### Option 6: OSV.dev API Fallback

**Approach:**
Query OSV.dev (Open Source Vulnerability database) which may have repo mappings.

**API:**
```bash
curl -X POST https://api.osv.dev/v1/query \
  -d '{"id": {"GHSA": "GHSA-v64q-396f-7m79"}}'
```

**Response:**
```json
{
  "vulns": [{
    "id": "GHSA-v64q-396f-7m79",
    "affected": [{
      "package": {
        "name": "github.com/cursor/cursor",
        "ecosystem": "GitHub Actions"
      }
    }]
  }]
}
```

**Pros:**
- Free, public API
- No authentication
- Fast

**Cons:**
- Only works if advisory promoted to OSV
- Repository-specific advisories rarely included
- No guarantee of data

---

## Recommended Implementation Plan

### Phase 1: CVE-Based Discovery (Highest ROI)
1. **Integrate with Romulus Memory MCP** for CVE data
2. **Parse CVE references** to extract GitHub repo URLs
3. **Implement REST API client** with GitHub token
4. **Add fallback logic** in `getAdvisory()` method
5. **Cache results** to reduce API calls

**Timeline:** 2-3 days  
**Coverage:** ~70-80% of cases where CVE exists

---

### Phase 2: Web Search Fallback (Best Coverage)
1. **Integrate Brave Search API** (2,000 free queries/month)
2. **Add search fallback** when CVE parsing fails
3. **Implement result parsing** and validation
4. **Add rate limiting** and caching

**Timeline:** 1-2 days  
**Coverage:** ~95% of public advisories

---

### Phase 3: Code Search Enhancement (Optional)
1. **Add GitHub Code Search** as tertiary fallback
2. **Handle rate limits** gracefully
3. **Combine with GraphQL** for authenticated searches

**Timeline:** 1 day  
**Coverage:** Marginal improvement, mainly for edge cases

---

## Configuration Requirements

### Environment Variables Needed:
```bash
# GitHub API (for REST/GraphQL)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx  # Requires 'repo' scope

# Web Search (optional)
BRAVE_API_KEY=BSxxxxxxxxxxxxxxx
# OR
GOOGLE_CUSTOM_SEARCH_API_KEY=xxxx
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=xxxx

# OSV.dev (no auth required)
OSV_API_URL=https://api.osv.dev/v1
```

### mcp.json Update:
```jsonc
"advisory": {
  "command": "node",
  "args": [
    "${workspaceFolder}/services/mcp/advisory/dist/index.js"
  ],
  "type": "stdio",
  "env": {
    "ADVISORY_REPO_PATH": "${workspaceFolder}/services/mcp/advisory/external/advisory-database",
    "GITHUB_TOKEN": "${env:GITHUB_TOKEN}",
    "BRAVE_API_KEY": "${env:BRAVE_API_KEY}",
    "ENABLE_REPO_ADVISORY_FALLBACK": "true"
  }
}
```

---

## Data Flow Example

**Query:** `getAdvisory("GHSA-v64q-396f-7m79")`

```
1. Check local github-reviewed database
   └─> NOT FOUND

2. Query Romulus Memory for CVE mapping
   └─> Found CVE-2025-61592

3. Get CVE references from Memory
   └─> Found: https://github.com/cursor/cursor/security/advisories/GHSA-v64q-396f-7m79

4. Extract owner/repo: "cursor/cursor"

5. GitHub REST API call:
   GET /repos/cursor/cursor/security-advisories/GHSA-v64q-396f-7m79
   └─> SUCCESS: Return advisory data

6. Cache result for future queries

Total latency: ~200-500ms (with cache: <10ms)
```

---

## Testing Strategy

### Test Cases:
1. **Global advisory** (in local database) → Should use local data
2. **Repo-specific advisory with CVE** → Should use REST API fallback
3. **Repo-specific advisory without CVE** → Should use web search
4. **Non-existent GHSA** → Should return 404
5. **Private repo advisory** → Should fail gracefully (needs auth)

### Mock Data:
```typescript
// tests/fixtures/advisories.ts
export const TEST_ADVISORIES = {
  globalReviewed: 'GHSA-xxxx-xxxx-xxxx',    // In local DB
  cursorRCE: 'GHSA-v64q-396f-7m79',         // Repo-specific
  nonExistent: 'GHSA-9999-9999-9999',       // 404
};
```

---

## Metrics to Track

- **Cache hit rate** (local DB vs REST API vs web search)
- **Fallback success rate** (% of 404s resolved)
- **API call volume** (GitHub REST + Search APIs)
- **Latency p50/p95/p99** (by data source)
- **Cost** (API usage fees)

---

## Open Questions

1. **Should we index unreviewed directory?**
   - 2.2 GB of data (44,791 advisories in 2025 alone)
   - Tradeoff: Disk space vs API calls
   - Potential: Lazy loading or selective indexing

2. **How to handle private repositories?**
   - GitHub token needs access to specific org/repo
   - May need user-provided tokens (not service token)

3. **What about advisories without CVEs?**
   - ~1,523 GitHub Advisories have no CVE ID
   - Web search becomes only option
   - Build reverse index for known repos?

4. **Rate limiting strategy?**
   - GitHub: 5,000 requests/hour (authenticated)
   - Brave Search: 2,000 queries/month
   - Need caching + backoff logic

5. **Should we contribute to github/advisory-database?**
   - Submit PRs to promote important repo advisories
   - Help community discover Cursor RCE and similar issues

---

## Related Issues

- #TODO: Add GitHub REST API client with auth
- #TODO: Integrate with Romulus Memory for CVE lookups
- #TODO: Add web search fallback (Brave API)
- #TODO: Implement caching layer for API responses
- #TODO: Add metrics/telemetry for fallback usage
- #TODO: Document token requirements in main README

---

## References

- [GitHub REST API - Repository Security Advisories](https://docs.github.com/en/rest/security-advisories/repository-advisories)
- [GitHub Advisory Database](https://github.com/advisories)
- [OSV.dev API Documentation](https://osv.dev/docs/)
- [Brave Search API](https://brave.com/search/api/)
- Perplexity Research: Thread from Jan 7, 2026
