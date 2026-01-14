# Contributing to GitHub Advisory MCP Server

## Contribution Restrictions

**This project is currently under restricted development and only accepts contributions from Microsoft employees (FTEs and interns).**

External contributions are not being accepted at this time. If you are a Microsoft employee interested in contributing, please reach out through internal channels or via the contacts listed below.

## For Microsoft Employees

This project welcomes contributions and suggestions from Microsoft employees. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Development Guidelines

### Project Structure
- **TypeScript/Node.js** - MCP server implementation
- **Two-tier architecture** - MCP Server → Local Express API → Advisory Database
- **stdio transport** - For local VS Code integration
- **OpenTelemetry** - Comprehensive instrumentation

### Prerequisites
- Node.js 18+
- Git
- VS Code (recommended)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/microsoft/github-advisory-mcp.git
   cd github-advisory-mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up advisory database**
   ```bash
   ./scripts/setup-advisory-database.sh
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Run tests**
   ```bash
   npm test
   ```

### Submission Guidelines

#### Issues
Before submitting an issue, please search the existing issues to avoid duplicates. When creating a new issue, provide:
- Clear description of the problem or feature request
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)

#### Pull Requests
1. Create a new branch from `dev`
2. Make your changes with clear, descriptive commit messages
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Update documentation as needed
6. Submit a pull request to the `dev` branch

**Code Quality Requirements:**
- TypeScript with strict mode enabled
- All tests must pass
- No TypeScript errors
- Follow existing code style
- Include JSDoc comments for public APIs

### Testing
- **E2E Tests**: `npm run test:e2e` (requires advisory database)
- **Integration Tests**: `npm run test:integration` (requires Azure setup)
- **Watch Mode**: `npm run test:watch`

### Documentation
When adding new features or making significant changes, please update:
- README.md (if user-facing changes)
- JSDoc comments in code
- Test coverage

## Security
Please review [SECURITY.md](SECURITY.md) for information on reporting security vulnerabilities.

## Compliance
This project requires SDL compliance before open source publication. See [docs/REGISTRATION.md](docs/REGISTRATION.md) for tracking status.

## Contact
- Internal Slack: Contact the MSECAI Applied Research team
- Email: For security concerns, use [opencode@microsoft.com](mailto:opencode@microsoft.com)

## Future Open Source Plans
Once SDL requirements are met, this project may accept external contributions. Check back for updates on contribution policy changes.
