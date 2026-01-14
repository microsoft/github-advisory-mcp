# MCP Server Registration - GitHub Advisory Database

**Server Name:** GitHub Advisory MCP Server  
**Repository:** [microsoft/github-advisory-mcp](https://github.com/microsoft/github-advisory-mcp)  
**Version:** 1.0.0  
**Type:** Local Server (stdio transport)  
**Publishing Target:** Open Source (3P) - External Use

## Overview

This MCP server provides programmatic access to GitHub Security Advisories through the Model Context Protocol. It enables AI assistants and developer tools to query vulnerability information from a locally-cloned GitHub Advisory Database.

**Key Features:**
- **Offline-capable:** Works with locally cloned advisory database (no external API calls)
- **Comprehensive search:** Filter by ecosystem, severity, CVE ID, GHSA ID, CWE, and date ranges
- **Detailed vulnerability data:** Access full advisory details including CVSS scores, affected packages, and references
- **Privacy-preserving:** All data processing happens locally on the user's machine

## Deployment Model

**🏠 Local Server** - Runs on user's machine via stdio transport

**Why Local:**
- Requires access to local filesystem (cloned GitHub advisory database)
- No network dependencies after initial database clone
- User controls data location and updates

## Publishing Status

### Current Implementation Status

| Requirement | Status | Notes |
|------------|--------|-------|
| **Language/Runtime** | ✅ TypeScript/Node.js | Microsoft-sponsored language, ideal for VS Code integration |
| **Transport** | ✅ stdio | Compliant |
| **Authentication** | ✅ Not Required | Read-only access to public data |
| **Packaging** | ✅ npm | Standard distribution for MCP servers |
| **Open Source License** | ✅ MIT | Permissive license |
| **Security Scanning** | 🔄 Pending | Requires Component Governance, CodeQL |
| **Threat Model** | 🔄 Pending | SDL requirement |
| **CELA Review** | 🔄 Pending | Required for open source release |

### Publishing Strategy

This server is intended for **external (3P) open source publication** on GitHub. Users can clone and run locally without central hosting.

**Distribution Method:**
```bash
# Users install via npm/npx (Node.js required)
npx @microsoft/github-advisory-mcp

# Or clone repository directly
git clone https://github.com/microsoft/github-advisory-mcp
cd github-advisory-mcp
npm install && npm run build
node dist/index.js
```

## Security & Compliance

### SDL Requirements Checklist

#### Pre-Publishing Requirements

- [ ] **Threat Model Review**
  - Document: [Link to OneDrive threat model doc]
  - Reviewer: [Security contact]
  - Date: [TBD]

- [ ] **Authentication Implementation**
  - ✅ Not required - server provides read-only access to public GitHub advisory data
  - No sensitive data or write operations
  - Users control database location via `ADVISORY_REPO_PATH` environment variable

- [ ] **License Verification**
  - ✅ MIT License - permissive and compatible with open source distribution
  - Dependencies: @modelcontextprotocol/sdk (MIT), Express (MIT), Winston (MIT)
  - GitHub Advisory Database: CC-BY 4.0 (separate repository, user-cloned)

- [ ] **CELA Review**
  - Status: Pending
  - Contact: [Divisional CELA representative]
  - GitHub Copilot CELA Guidelines: [Reference]
  - Open Source Release Guidance: [Reference]

- [ ] **Vulnerability Remediation**
  - Component Governance scan: [Pending]
  - CodeQL scan: [Pending]
  - Status: All critical/high vulnerabilities must be remediated before publishing

- [ ] **Open Source Compliance**
  - Follow [Microsoft Open Source Development Guidance](https://aka.ms/opensource)
  - Repository: microsoft/github-advisory-mcp
  - License file: ✅ MIT in repository
  - Contributing guidelines: [ ] To be added
  - Code of Conduct: [ ] To be added
  - Security policy: [ ] To be added

### Security Considerations

**Data Source:** GitHub Advisory Database
- Public repository: https://github.com/github/advisory-database
- License: CC-BY 4.0 (user clones locally)
- No API keys or authentication required

**Local Data Access:**
- Reads JSON files from user-specified directory
- No write operations
- No network calls to external services (after DB clone)
- No sensitive data processing

**Privacy:**
- No telemetry by default
- Optional OpenTelemetry integration (user-configured)
- No data sent to external services

## Technical Specifications

### Server Capabilities

**MCP Tools Provided:**

1. **`list_advisories`** - Query advisories with filters
   ```typescript
   {
     ecosystem?: "npm" | "pip" | "rubygems" | "maven" | "nuget" | "go" | "rust" | "composer" | "pub" | "swift" | "erlang",
     severity?: "low" | "medium" | "high" | "critical",
     cve_id?: string,
     ghsa_id?: string,
     cwes?: string,
     affects?: string,
     published?: string,
     updated?: string,
     is_withdrawn?: boolean,
     sort?: "updated" | "published",
     direction?: "asc" | "desc",
     per_page?: number
   }
   ```

2. **`get_advisory`** - Get detailed advisory information
   ```typescript
   {
     ghsa_id: string  // e.g., "GHSA-jc85-fpwf-qm7x"
   }
   ```

**Response Format:**
- JSON-formatted vulnerability data
- Includes CVSS scores, CWE classifications, affected package versions, references
- Compatible with GitHub Advisory Database schema

### Dependencies

**Core:**
- Node.js ≥ 18.0.0
- @modelcontextprotocol/sdk ^1.20.2
- Express ^5.1.0 (for HTTP mode)
- Winston ^3.17.0 (logging)

**Optional:**
- OpenTelemetry packages (telemetry integration)

### Installation & Setup

**Prerequisites:**
```bash
# 1. Clone advisory database
git clone --depth=1 https://github.com/github/advisory-database.git

# 2. Install server
npm install -g @microsoft/github-advisory-mcp

# 3. Configure environment
export ADVISORY_REPO_PATH=/path/to/advisory-database
```

**VS Code/Cursor Configuration:**
```json
{
  "mcpServers": {
    "github-advisory": {
      "command": "npx",
      "args": ["@microsoft/github-advisory-mcp"],
      "env": {
        "ADVISORY_REPO_PATH": "/path/to/advisory-database"
      }
    }
  }
}
```

## Documentation

### Repository Structure
```
github-advisory-mcp/
├── README.md              # User-facing documentation
├── REGISTRATION.md        # This file - compliance tracking
├── LICENSE                # MIT License
├── CONTRIBUTING.md        # Contribution guidelines
├── SECURITY.md            # Security policy
├── CODE_OF_CONDUCT.md     # Community standards
├── package.json           # Node.js package metadata
├── tsconfig.json          # TypeScript configuration
├── src/                   # Source code
│   ├── index.ts           # stdio server entry point
│   ├── http-server.ts     # HTTP server (optional)
│   ├── tools/             # MCP tool implementations
│   └── datasources/       # Advisory database reader
├── test/                  # Test suites
└── scripts/               # Setup scripts
```

### User Documentation (README.md)

Must include:
- ✅ **Description:** What the server does and why it's useful
- ✅ **Installation:** Step-by-step setup instructions
- ✅ **Authentication:** N/A - read-only public data
- ✅ **Usage Examples:** Sample configurations for VS Code, Cursor, Claude Desktop
- ✅ **Supported Tools:** list_advisories, get_advisory with parameter documentation
- ✅ **Support:** GitHub Issues for bug reports and questions
- [ ] **Troubleshooting:** Common issues and solutions
- [ ] **Contributing:** How to contribute (link to CONTRIBUTING.md)

## Publishing Workflow

### Phase 1: Internal Review (Current)
1. ✅ Server implemented and functional
2. ✅ Basic documentation in place
3. 🔄 Security review and threat modeling
4. 🔄 CELA approval for open source release

### Phase 2: Open Source Publication
1. [ ] Complete all SDL requirements
2. [ ] Add missing documentation (CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md)
3. [ ] Set up CI/CD pipeline with security scanning
4. [ ] Create public repository at microsoft/github-advisory-mcp
5. [ ] Publish to npm as @microsoft/github-advisory-mcp
6. [ ] Submit to registries:
   - [ ] Anthropic Official MCP Registry (primary)
   - [ ] Microsoft MCP Repository (microsoft/mcp README)
   - [ ] 1ES MCP Registry (aka.ms/MCPServerRequest) - for internal visibility

### Phase 3: Maintenance
1. [ ] Monitor GitHub Issues for bug reports
2. [ ] Keep dependencies updated (Dependabot)
3. [ ] Sync with advisory database schema changes
4. [ ] Community engagement and PR reviews

## Technology Rationale

**TypeScript Implementation:**
- TypeScript is a Microsoft-sponsored language
- Native integration with VS Code extensions ecosystem
- Official MCP SDK support (@modelcontextprotocol/sdk)
- JSON-native processing (advisory database format)
- Simple deployment via npm/npx
- Appropriate for public data processing with no security-critical operations

**Distribution via npm:**
- Standard for MCP server ecosystem
- One-command installation: `npx @microsoft/github-advisory-mcp`
- Automatic updates and dependency management
- Developer-friendly for target audience

## Support & Contact

### Internal Questions
- **Publishing Questions:** MCP 1P Publishing Teams Channel
- **General Questions:** 1ESMCP@microsoft.com
- **Azure-specific:** Azure MCP Teams Channel (if Azure branding considered)

### External Support (Post-Publication)
- **Bug Reports:** GitHub Issues
- **Feature Requests:** GitHub Issues
- **Security Issues:** SECURITY.md (responsible disclosure)
- **Community:** GitHub Discussions

## Compliance Tracking

### Document History
| Date | Author | Change | Approval |
|------|--------|--------|----------|
| 2026-01-13 | Microsoft | Initial registration document | Pending |

### Approval Signatures
- [ ] **Product Owner:** _______________________  Date: _______
- [ ] **Security Review:** _______________________  Date: _______
- [ ] **CELA Approval:** _______________________  Date: _______
- [ ] **1ES MCP Registry:** _______________________  Date: _______

---

**Next Steps:**
1. Complete threat model review
2. Run Component Governance and CodeQL scans
3. Obtain CELA approval for open source release
4. Address any security findings
5. Submit to 1ES MCP Registry: aka.ms/MCPServerRequest
6. Publish to microsoft/mcp repository
7. Submit to Anthropic Official MCP Registry

**Registry Submission Link:** https://aka.ms/MCPServerRequest
