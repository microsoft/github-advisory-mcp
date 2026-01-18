import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import {
  refreshAdvisoryDatabase,
  startPeriodicRefresh,
} from "../../src/refresh-database.js";

// Mock modules
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

// Mock logger to avoid console spam in tests
vi.mock("../../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("refresh-database", () => {
  const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
  const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper to create a mock child process.
   */
  function createMockProcess(
    exitCode: number = 0,
    stdout: string = "",
    stderr: string = ""
  ): Partial<ChildProcess> {
    const stdoutCallbacks: Array<(data: Buffer) => void> = [];
    const stderrCallbacks: Array<(data: Buffer) => void> = [];
    const closeCallbacks: Array<(code: number | null) => void> = [];
    const errorCallbacks: Array<(err: Error) => void> = [];

    const process: Partial<ChildProcess> = {
      stdout: {
        on: (event: string, cb: (data: Buffer) => void) => {
          if (event === "data") stdoutCallbacks.push(cb);
        },
      } as any,
      stderr: {
        on: (event: string, cb: (data: Buffer) => void) => {
          if (event === "data") stderrCallbacks.push(cb);
        },
      } as any,
      on: (event: string, cb: any) => {
        if (event === "close") closeCallbacks.push(cb);
        if (event === "error") errorCallbacks.push(cb);
        return process as ChildProcess;
      },
    };

    // Schedule the callback execution
    setImmediate(() => {
      stdoutCallbacks.forEach((cb) => cb(Buffer.from(stdout)));
      stderrCallbacks.forEach((cb) => cb(Buffer.from(stderr)));
      closeCallbacks.forEach((cb) => cb(exitCode));
    });

    return process;
  }

  describe("refreshAdvisoryDatabase", () => {
    it("should clone repository when it does not exist", async () => {
      // Mock: .git directory does not exist
      mockExistsSync.mockReturnValue(false);

      // Mock successful clone
      mockSpawn.mockReturnValue(createMockProcess(0, "", ""));

      const result = await refreshAdvisoryDatabase("/path/to/advisory-database");

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone", "--depth=1", "--branch=main"]),
        expect.objectContaining({ cwd: "/path/to" })
      );
    });

    it("should skip on clone failure when skipOnFailure is true", async () => {
      mockExistsSync.mockReturnValue(false);
      mockSpawn.mockReturnValue(
        createMockProcess(128, "", "fatal: unable to access")
      );

      const result = await refreshAdvisoryDatabase("/path/to/advisory-database", {
        skipOnFailure: true,
      });

      expect(result).toBe(false);
    });

    it("should throw on clone failure when skipOnFailure is false", async () => {
      mockExistsSync.mockReturnValue(false);
      mockSpawn.mockReturnValue(
        createMockProcess(128, "", "fatal: unable to access")
      );

      await expect(
        refreshAdvisoryDatabase("/path/to/advisory-database", {
          skipOnFailure: false,
        })
      ).rejects.toThrow("git clone failed");
    });

    it("should fetch and reset when repository exists", async () => {
      // Mock: .git directory exists
      mockExistsSync.mockReturnValue(true);

      // Track git commands
      const gitCommands: string[][] = [];
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        gitCommands.push(args);

        // Different responses for different commands
        if (args[0] === "rev-parse") {
          // First call: before commit, Second call: after commit (different)
          return createMockProcess(
            0,
            gitCommands.filter((c) => c[0] === "rev-parse").length === 1
              ? "abc123"
              : "def456"
          );
        }
        if (args[0] === "fetch") {
          return createMockProcess(0, "");
        }
        if (args[0] === "reset") {
          return createMockProcess(0, "");
        }
        if (args[0] === "log") {
          return createMockProcess(0, "2024-01-15 Add new advisories");
        }
        return createMockProcess(0, "");
      });

      const result = await refreshAdvisoryDatabase("/path/to/advisory-database");

      expect(result).toBe(true);
      expect(gitCommands).toContainEqual(["fetch", "--depth=1", "origin", "main"]);
      expect(gitCommands).toContainEqual(["reset", "--hard", "origin/main"]);
    });

    it("should return false when already up-to-date", async () => {
      mockExistsSync.mockReturnValue(true);

      // All rev-parse calls return same commit
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === "rev-parse") {
          return createMockProcess(0, "abc123");
        }
        return createMockProcess(0, "");
      });

      const result = await refreshAdvisoryDatabase("/path/to/advisory-database");

      expect(result).toBe(false);
    });

    it("should skip on fetch failure when skipOnFailure is true", async () => {
      mockExistsSync.mockReturnValue(true);

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === "rev-parse") {
          return createMockProcess(0, "abc123");
        }
        if (args[0] === "fetch") {
          return createMockProcess(128, "", "Could not resolve host");
        }
        return createMockProcess(0, "");
      });

      const result = await refreshAdvisoryDatabase("/path/to/advisory-database", {
        skipOnFailure: true,
      });

      expect(result).toBe(false);
    });

    it("should throw on fetch failure when skipOnFailure is false", async () => {
      mockExistsSync.mockReturnValue(true);

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === "rev-parse") {
          return createMockProcess(0, "abc123");
        }
        if (args[0] === "fetch") {
          return createMockProcess(128, "", "Could not resolve host");
        }
        return createMockProcess(0, "");
      });

      await expect(
        refreshAdvisoryDatabase("/path/to/advisory-database", {
          skipOnFailure: false,
        })
      ).rejects.toThrow("git fetch failed");
    });

    it("should respect custom timeout", async () => {
      mockExistsSync.mockReturnValue(false);
      mockSpawn.mockReturnValue(createMockProcess(0, "", ""));

      await refreshAdvisoryDatabase("/path/to/advisory-database", {
        timeout: 30000,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "git",
        expect.any(Array),
        expect.objectContaining({ timeout: 30000 })
      );
    });
  });

  describe("startPeriodicRefresh", () => {
    it("should set up periodic refresh interval", () => {
      vi.useFakeTimers();
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(createMockProcess(0, "abc123"));

      const stop = startPeriodicRefresh("/path/to/repo", 60000);

      expect(typeof stop).toBe("function");

      stop(); // Clean up
    });

    it("should call refresh at specified interval", async () => {
      vi.useFakeTimers();
      mockExistsSync.mockReturnValue(true);

      let refreshCount = 0;
      mockSpawn.mockImplementation(() => {
        refreshCount++;
        return createMockProcess(0, "abc123");
      });

      const stop = startPeriodicRefresh("/path/to/repo", 1000); // 1 second

      // Advance time by 2.5 seconds
      await vi.advanceTimersByTimeAsync(2500);

      // Should have been called at 1s and 2s (2 times)
      expect(refreshCount).toBeGreaterThanOrEqual(2);

      stop();
    });

    it("should handle refresh errors gracefully", async () => {
      vi.useFakeTimers();
      mockExistsSync.mockReturnValue(true);

      mockSpawn.mockImplementation(() => {
        return createMockProcess(128, "", "Network error");
      });

      const stop = startPeriodicRefresh("/path/to/repo", 1000);

      // This should not throw
      await vi.advanceTimersByTimeAsync(1500);

      stop();
    });

    it("should stop when stop function is called", () => {
      vi.useFakeTimers();
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(createMockProcess(0, "abc123"));

      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const stop = startPeriodicRefresh("/path/to/repo", 1000);
      stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
