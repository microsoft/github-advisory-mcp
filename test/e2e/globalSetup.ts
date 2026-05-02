/**
 * Vitest global setup for E2E tests.
 * Ensures the advisory-database repository is cloned before tests start.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const ADVISORY_REPO_URL = "https://github.com/github/advisory-database.git";

export default function globalSetup() {
  const repoPath =
    process.env.ADVISORY_REPO_PATH ||
    resolve("./external/advisory-database");
  const gitDir = join(repoPath, ".git");

  if (existsSync(gitDir)) {
    console.log(`[globalSetup] Advisory database already exists at ${repoPath}`);
    return;
  }

  console.log(`[globalSetup] Cloning advisory-database to ${repoPath}...`);
  console.log(`[globalSetup] This may take 1-2 minutes on first run.`);

  const parentDir = join(repoPath, "..");
  const repoName = repoPath.split(/[/\\]/).pop() || "advisory-database";

  mkdirSync(parentDir, { recursive: true });

  try {
    execFileSync(
      "git",
      ["clone", "--depth=1", "--branch=main", ADVISORY_REPO_URL, repoName],
      {
        cwd: parentDir,
        stdio: "inherit",
        timeout: 180_000, // 3 minutes
      }
    );
    console.log(`[globalSetup] Advisory database cloned successfully.`);
  } catch (err) {
    console.warn(
      `[globalSetup] Failed to clone advisory database: ${err instanceof Error ? err.message : err}`
    );
    console.warn(
      `[globalSetup] E2E tests that require advisory data will be skipped or return empty results.`
    );
  }
}
