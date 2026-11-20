#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-twelvedata-"));
const distRoot = path.join(tmpRoot, "dist");
const stateFilePath = path.join(tmpRoot, "sync-state.json");

process.env.MACROEDGE_SYNC_STATE_PATH = stateFilePath;
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");
process.env.MACROEDGE_RETRY_BASE_MS = "10";

// Load local environment if present (matching Next.js behavior)
if (fs.existsSync(path.join(WORKSPACE, ".env.local"))) {
  const envContent = fs.readFileSync(path.join(WORKSPACE, ".env.local"), "utf8");
  const match = envContent.match(/^TWELVE_DATA_API_KEY=(.*)$/m);
  if (match) {
    process.env.TWELVE_DATA_API_KEY = match[1].trim().replace(/^["']|["']$/g, "");
  }
} else {
  process.env.TWELVE_DATA_API_KEY = "test_twelve_data_key_32_characters";
}

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

console.log("Compiling Twelve Data verification test harness...");
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

const { isProviderConfigured, getAllProviderStatuses, getActiveMarketWsProvider } =
  await import(path.join(distRoot, "services/sync/provider-registry.js"));
const { getAutoSyncDiagnostics } =
  await import(path.join(distRoot, "services/sync/debug.js"));
const { dispatchSyncJob, getProviderRateHistories } =
  await import(path.join(distRoot, "services/sync/orchestrator.js"));
const { updateDataHealth } =
  await import(path.join(distRoot, "services/sync/store.js"));

async function runTests() {
  console.log("\n--- Testing Twelve Data WebSocket Configuration & Sync Dispatch ---");

  // Test 1: Configuration check
  console.log("Test 1: isProviderConfigured(\"twelve_data_ws\") returns true");
  const configured = isProviderConfigured("twelve_data_ws");
  assert.equal(configured, true, "twelve_data_ws must be recognized as configured");
  console.log("  Configured:", configured);

  // Test 2: Active WS provider resolution
  console.log("\nTest 2: Active WS provider prioritizes twelve_data_ws when configured");
  const activeWs = getActiveMarketWsProvider();
  assert.equal(activeWs, "twelve_data_ws", "Expected active market WS provider to be twelve_data_ws");
  console.log("  Active WS Provider:", activeWs);

  // Test 3: Provider Auth Status in registry
  console.log("\nTest 3: getAllProviderStatuses marks twelve_data_ws as configured and LIVE");
  const statuses = getAllProviderStatuses();
  const tdStatus = statuses.find((s) => s.providerId === "twelve_data_ws");
  assert.ok(tdStatus, "twelve_data_ws status must be present");
  assert.equal(tdStatus.configured, true);
  assert.equal(tdStatus.status, "LIVE");
  assert.equal(tdStatus.transport, "websocket");
  console.log("  Status:", tdStatus.status, "Configured:", tdStatus.configured);

  // Test 4: Dispatch sync job with twelve_data_ws
  console.log("\nTest 4: dispatchSyncJob executes twelve_data_ws and records rate usage");
  const syncRes = await dispatchSyncJob({ providerId: "twelve_data_ws", force: true, trigger: "manual" });
  assert.ok(syncRes.summaries.length >= 1, "Expected at least 1 summary for twelve_data_ws");
  const tdSummary = syncRes.summaries.find((s) => s.providerId === "twelve_data_ws");
  assert.ok(tdSummary, "Expected summary with providerId twelve_data_ws");
  console.log("  Summary:", tdSummary.status, "records:", tdSummary.recordsInserted + tdSummary.recordsUpdated);

  // Test 5: Verify Rate Limit Usage tracking
  console.log("\nTest 5: Rate limit usage for twelve_data_ws is recorded");
  const rates = getProviderRateHistories();
  assert.ok(rates.twelve_data_ws, "Rate history must track twelve_data_ws");
  assert.ok(rates.twelve_data_ws.requestsInLastMinute >= 1, "At least 1 request recorded in window");
  assert.equal(rates.twelve_data_ws.maxAllowed, 8);
  console.log(`  RPM Usage: ${rates.twelve_data_ws.requestsInLastMinute} / ${rates.twelve_data_ws.maxAllowed} (${rates.twelve_data_ws.maxAllowed - rates.twelve_data_ws.requestsInLastMinute} left)`);

  // Test 6: Verify health state update
  console.log("\nTest 6: Simulated quote updates twelve_data_ws data health to LIVE with valid lastSuccessAt");
  const successIso = new Date().toISOString();
  await updateDataHealth({
    id: "source:twelve_data_ws",
    entityType: "source",
    sourceId: "twelve_data_ws",
    workerId: "market-engine",
    status: "LIVE",
    lastSuccessAt: successIso,
    lastAttemptAt: successIso,
    freshnessSeconds: 0,
    consecutiveFailures: 0,
    details: { configured: true, transport: "websocket" },
  });

  const diag = await getAutoSyncDiagnostics();
  const tdDiag = diag.providers.twelve_data_ws;
  assert.ok(tdDiag, "Diagnostic provider item must exist for twelve_data_ws");
  assert.equal(tdDiag.configured, true);
  assert.equal(tdDiag.status, "LIVE");
  assert.equal(tdDiag.lastSuccessAt, successIso);
  assert.equal(tdDiag.overdue, false);
  console.log("  Diagnostics:", tdDiag.name, "| Status:", tdDiag.status, "| Configured:", tdDiag.configured, "| Last Success:", tdDiag.lastSuccessAt.slice(11, 19) + " UTC");

  console.log("\nALL TWELVE DATA VERIFICATION TESTS PASSED SUCCESSFULLY.");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
