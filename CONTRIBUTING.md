# Contributing to GitHub Advisory MCP Server

## External Contributions

**This project does not accept external contributions (pull requests) at this time.** Only verified committers from the Microsoft GitHub organization may contribute code.

If you would like to contribute, we encourage you to:

- **Report bugs** by [opening an issue](https://github.com/microsoft/github-advisory-mcp/issues/new)
- **Request features** by [opening an issue](https://github.com/microsoft/github-advisory-mcp/issues/new)
- **Reach out to the project maintainers** at [opencode@microsoft.com](mailto:opencode@microsoft.com) to discuss your ideas

We appreciate your interest and feedback!

## For Microsoft Employees

This project welcomes contributions and suggestions from Microsoft employees (FTEs and interns). Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

All commits must be signed and verified. The `main` branch is protected and requires pull request reviews, passing CI status checks, and signed commits.

## Signing Commits — Note for Microsoft Committers

The `main` branch protection requires every commit on a PR to be cryptographically signed and show as **Verified** on GitHub. If a commit on your PR shows as **Unverified**, the PR will be blocked from merging.

This section documents the SSH commit signing setup that works for Microsoft committers using their existing SSH key.

### Prerequisites

1. An existing SSH key (e.g., `~/.ssh/id_rsa.pub` or `~/.ssh/id_ed25519.pub`).
2. Your `microsoft.com` (or other corporate) email added and **verified** on GitHub: <https://github.com/settings/emails>.
   - GitHub will only mark a signature as Verified if the commit author email is on this list and verified.
   - If you cannot verify a corporate email, use your `@users.noreply.github.com` GitHub-provided email as the commit author email.

### Step 1: Register the SSH key as a Signing Key

GitHub treats Authentication keys and Signing keys as separate entries, even when the underlying key contents are identical.

1. Go to <https://github.com/settings/ssh/new>.
2. **Title**: e.g., `MyMachine-SIGNING-KEY`.
3. **Key type**: select **Signing Key** (not Authentication Key).
4. Paste the contents of your public key file (`id_rsa.pub` or `id_ed25519.pub`).
5. Click **Add SSH key**.

You can keep the same key registered as both an Authentication key and a Signing key — they are independent entries.

### Step 2: Configure git to sign commits with SSH

Run these in the repository (or globally with `--global` if you want signing everywhere):

```powershell
git config gpg.format ssh
git config user.signingkey "$HOME\.ssh\id_rsa.pub"   # or id_ed25519.pub
git config commit.gpgsign true
git config tag.gpgsign true
```

Verify the commit author identity matches a verified email on your GitHub account:

```powershell
git config user.email     # must match a verified email on https://github.com/settings/emails
git config user.name
```

### Step 3: Sign new commits

Once configured, normal `git commit` will sign automatically. To verify locally that signatures are embedded:

```powershell
git cat-file -p HEAD | Select-Object -First 10
# Expect to see a `gpgsig -----BEGIN SSH SIGNATURE-----` block.
```

### Step 4: Re-sign existing unsigned PR commits

If you already pushed a PR with unsigned commits and the protection is now blocking the merge, re-sign all commits on the branch in place:

```powershell
git switch <your-pr-branch>
git fetch origin
git rebase origin/main --exec "git commit --amend --no-edit -S"
git push --force-with-lease
```

This rewrites every commit since `origin/main` to include an SSH signature. Force-with-lease is required because rebasing changes the commit hashes.

### Troubleshooting

- **Commit shows as "Unverified" with `unknown signature` reason**
  - The SSH key is registered as Authentication only. Re-register the same key with **Key type = Signing Key** at <https://github.com/settings/ssh/new>.

- **Commit shows as "Unverified" because email is not associated with a verified account**
  - The commit author email is not on <https://github.com/settings/emails> as verified. Either verify the email on GitHub, or change `git config user.email` to a verified address (e.g., your `@users.noreply.github.com`) and re-sign as in Step 4.

- **Local `git log --show-signature` prints `gpg.ssh.allowedSignersFile needs to be configured`**
  - This is only a *local* verification message and does **not** affect GitHub's verified status. To enable local verification:

    ```powershell
    "$(git config user.email) namespaces=`"git`" $(Get-Content $HOME\.ssh\id_rsa.pub)" | Out-File -Encoding ascii -Append $HOME\.ssh\allowed_signers
    git config gpg.ssh.allowedSignersFile "$HOME\.ssh\allowed_signers"
    ```

- **`git commit` fails with `gpg failed to sign the data` when `gpg.format=ssh`**
  - Ensure `user.signingkey` points at a `.pub` file that exists, and the matching private key is loadable by `ssh-keygen -Y sign` (Git for Windows uses the bundled `ssh-keygen`).

### References

- GitHub docs: [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
- GitHub docs: [Signing commits with SSH](https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key#telling-git-about-your-ssh-key)

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

## Contact
- **Issues & Feedback:** [GitHub Issues](https://github.com/microsoft/github-advisory-mcp/issues)
- **Security concerns:** See [SECURITY.md](SECURITY.md)
- **General questions:** [opencode@microsoft.com](mailto:opencode@microsoft.com)
