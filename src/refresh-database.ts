/**
 * Cross-platform advisory database refresh utility.
 * Works on Windows and Linux using git directly (no bash required).
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";

const logger = createLogger("Refresh");

const ADVISORY_REPO_URL = "https://github.com/github/advisory-database.git";

export interface RefreshOptions {
  /** Skip refresh if network fails (default: true) */
  skipOnFailure?: boolean;
  /** Timeout in milliseconds (default: 120000 = 2 minutes) */
  timeout?: number;
}

/**
 * Run a git command and return stdout.
 */
function runGit(args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      // Don't use shell - git is typically in PATH on both Windows and Linux
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args[0]} failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`git command failed: ${err.message}`));
    });
  });
}

/**
 * Get current commit hash.
 */
async function getCurrentCommit(repoPath: string): Promise<string | null> {
  try {
    return await runGit(["rev-parse", "HEAD"], repoPath, 5000);
  } catch {
    return null;
  }
}

/**
 * Refresh the advisory database with shallow fetch.
 * 
 * @param repoPath - Path to the advisory-database directory
 * @param options - Refresh options
 * @returns true if updated, false if already up-to-date or skipped
 */
export async function refreshAdvisoryDatabase(
  repoPath: string,
  options: RefreshOptions = {}
): Promise<boolean> {
  const { skipOnFailure = true, timeout = 120000 } = options;

  const gitDir = join(repoPath, ".git");
  
  // Check if repo exists
  if (!existsSync(gitDir)) {
    logger.info("Repository not found, cloning...", { repoPath });
    
    try {
      // Clone with depth=1 (shallow)
      const parentDir = join(repoPath, "..");
      const repoName = repoPath.split(/[/\\]/).pop() || "advisory-database";
      // Ensure parent directory exists (spawn fails with ENOENT if cwd is missing)
      mkdirSync(parentDir, { recursive: true });      
      await runGit(
        ["clone", "--depth=1", "--branch=main", ADVISORY_REPO_URL, repoName],
        parentDir,
        timeout
      );
      
      logger.info("Repository cloned successfully");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (skipOnFailure) {
        logger.warn("Clone failed, skipping", { error: msg });
        return false;
      }
      throw err;
    }
  }

  // Get current commit before fetch
  const beforeCommit = await getCurrentCommit(repoPath);
  
  try {
    logger.info("Fetching latest advisories...");
    
    // Fetch with depth=1 (shallow update)
    await runGit(["fetch", "--depth=1", "origin", "main"], repoPath, timeout);
    
    // Reset to origin/main
    await runGit(["reset", "--hard", "origin/main"], repoPath, timeout);
    
    // Get new commit
    const afterCommit = await getCurrentCommit(repoPath);
    
    if (beforeCommit === afterCommit) {
      logger.info("Already up-to-date", { commit: afterCommit?.slice(0, 8) });
      return false;
    }
    
    // Get commit info
    const commitInfo = await runGit(
      ["log", "-1", "--format=%ci %s"],
      repoPath,
      5000
    );
    
    logger.info("Updated successfully", {
      from: beforeCommit?.slice(0, 8),
      to: afterCommit?.slice(0, 8),
      latest: commitInfo,
    });
    
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    
    if (skipOnFailure) {
      logger.warn("Refresh failed, using cached data", { error: msg });
      return false;
    }
    
    throw err;
  }
}

/**
 * Start periodic refresh (runs in background).
 * 
 * @param repoPath - Path to the advisory-database directory
 * @param intervalMs - Refresh interval in milliseconds (default: 1 hour)
 * @returns Function to stop the periodic refresh
 */
export function startPeriodicRefresh(
  repoPath: string,
  intervalMs: number = 60 * 60 * 1000
): () => void {
  logger.info("Starting periodic refresh", {
    intervalMinutes: Math.round(intervalMs / 60000),
  });

  const timer = setInterval(async () => {
    try {
      await refreshAdvisoryDatabase(repoPath, { skipOnFailure: true });
    } catch (err) {
      logger.error("Periodic refresh error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);

  // Return cleanup function
  return () => {
    clearInterval(timer);
    logger.info("Periodic refresh stopped");
  };
}
