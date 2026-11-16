#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-autosync-"));
const distRoot = path.join(tmpRoot, "dist");
const stateFilePath = path.join(tmpRoot, "sync-state.json");

process.env.MACROEDGE_SYNC_STATE_PATH = stateFilePath;
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");
process.env.MACROEDGE_RETRY_BASE_MS = "10";

const workspaceRequire = Module.createRequire(path.join(WORKSPACE, "package.json"));
const ts = workspaceRequire("typescript");

function compileForTest() {
  const tsConfigPath = path.join(WORKSPACE, "tsconfig.json");
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "dom.iterable", "esnext"],
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        jsx: "react-jsx",
        outDir: distRoot,
        rootDir: path.join(WORKSPACE, "src"),
        baseUrl: WORKSPACE,
        paths: { "@/*": ["src/*"] },
      },
      include: [
        "src/lib/**/*.ts",
        "src/services/**/*.ts",
        "src/app/api/macro/**/*.ts",
        "src/app/api/sync/**/*.ts",
      ],
    },
    ts.sys,
    WORKSPACE
  );

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  assert.equal(emitResult.emitSkipped, false, "Compilation failed for test harness");
}

console.log("Compiling AutoSync Debug test harness...");
compileForTest();

const preResolved = {
  "next/server": workspaceRequire.resolve("next/server"),
  "@supabase/supabase-js": workspaceRequire.resolve("@supabase/supabase-js"),
  react: workspaceRequire.resolve("react"),
};

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const mapped = path.join(distRoot, request.slice(2));
    return origResolveFilename.call(this, mapped, parent, isMain, options);
  }
  if (request in preResolved) {
    return preResolved[request];
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

const { getAutoSyncDiagnostics, runAutoSyncProbe, clearOrphanedSyncLocks, resetRateLimitHistory } =
  await import(path.join(distRoot, "services/sync/debug.js"));
const { dispatchSyncJob, getActiveOrchestratorLocks, getProviderRateHistories } =
  await import(path.join(distRoot, "services/sync/orchestrator.js"));

async function runTests() {
  console.log("\n--- Testing AutoSync High-End Diagnostics & Debugging Engine ---");

  // Test 1: Introspection & Diagnostics Structure
  console.log("Test 1: getAutoSyncDiagnostics returns complete structured telemetry");
  const diag = await getAutoSyncDiagnostics();
  assert.ok(diag.timestamp, "Diagnostics must have timestamp");
  assert.ok(typeof diag.uptimeSeconds === "number", "Diagnostics must have uptime");
  assert.ok(diag.verdict, "Diagnostics must have verdict");
  assert.ok(diag.memoryUsageMb.rss > 0, "Memory RSS must be tracked");
  assert.ok(Array.isArray(diag.activeLocks), "Active locks must be array");
  assert.ok(diag.providers.fred, "FRED provider must exist in diagnostics");
  assert.ok(diag.providers.bls, "BLS provider must exist in diagnostics");
  assert.ok(diag.providers.bea, "BEA provider must exist in diagnostics");
  assert.ok(diag.providers.us_treasury, "US Treasury provider must exist in diagnostics");
  assert.ok(diag.workers["macro-engine"], "macro-engine worker must exist");
  assert.ok(diag.workers["liquidity-risk-engine"], "liquidity-risk-engine worker must exist");
  console.log(`  Verdict: ${diag.verdict}, Memory RSS: ${diag.memoryUsageMb.rss}MB, Providers: ${Object.keys(diag.providers).length}`);

  // Test 2: Latency Probe execution
  console.log("\nTest 2: runAutoSyncProbe executes multi-worker cycle with per-worker latencies");
  const probe = await runAutoSyncProbe();
  assert.ok(typeof probe.totalDurationMs === "number", "Total duration must be a number");
  assert.ok(Object.keys(probe.workerLatenciesMs).length > 0, "Worker latencies map must be populated");
  console.log(`  Probe Duration: ${probe.totalDurationMs}ms, Workers: ${Object.keys(probe.workerLatenciesMs).join(", ")}`);

  // Test 3: Lock Management & Orphan Clearing
  console.log("\nTest 3: clearOrphanedSyncLocks clears active locks safely");
  const clearRes = await clearOrphanedSyncLocks();
  assert.ok(typeof clearRes.clearedCount === "number", "Cleared count must be a number");
  assert.equal(clearRes.remainingLocks.length, 0, "No remaining locks after clear");
  console.log(`  Cleared ${clearRes.clearedCount} lock(s), remaining: 0`);

  // Test 4: Rate Limit History Reset
  console.log("\nTest 4: resetRateLimitHistory resets provider tracking windows");
  const resetRes = await resetRateLimitHistory();
  assert.equal(resetRes.reset, true, "Rate limit reset must be true");
  const rateHist = getProviderRateHistories();
  assert.equal(Object.keys(rateHist).length, 0, "Rate history must be empty after full reset");
  console.log("  Rate limit sliding windows reset successfully");

  // Test 5: Verify Partitioned Dispatch avoids duplicate fetches
  console.log("\nTest 5: dispatchSyncJob dispatches partitioned series to FRED, BLS, and BEA");
  const syncResult = await dispatchSyncJob({ force: true, trigger: "manual" });
  assert.ok(syncResult.summaries.length >= 6, "Expected at least 6 worker summaries");
  const macroSummaries = syncResult.summaries.filter((s) => s.workerId === "macro-engine");
  assert.ok(macroSummaries.length >= 3, "Expected macro-engine summaries for fred, bls, and bea");
  console.log(`  Total worker summaries: ${syncResult.summaries.length}, Macro workers: ${macroSummaries.length}`);

  console.log("\nALL AUTOSYNC DEBUG TESTS PASSED SUCCESSFULLY.");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
