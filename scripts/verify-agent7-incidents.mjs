#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-agent7-"));
const distRoot = path.join(tmpRoot, "dist");
process.env.MACROEDGE_SYNC_STATE_PATH = path.join(tmpRoot, "sync-state.json");
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");
process.env.MACROEDGE_RETRY_BASE_MS = "10";

const workspaceRequire = Module.createRequire(path.join(WORKSPACE, "package.json"));
const ts = workspaceRequire("typescript");

function compileProjectForTests() {
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
        "src/app/api/sync/**/*.ts",
        "src/app/api/incidents/**/*.ts",
      ],
    },
    ts.sys,
    WORKSPACE
  );

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  if (diagnostics.length > 0) {
    const formatted = diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    throw new Error(`TypeScript compile errors:\n${formatted}`);
  }
}

compileProjectForTests();

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

const redact = await import(path.join(distRoot, "lib/incidents/redact.js"));
const incStore = await import(path.join(distRoot, "services/incidents/store.js"));
const syncStore = await import(path.join(distRoot, "services/sync/store.js"));
const dbg = await import(path.join(distRoot, "services/incidents/debugger-engine.js"));
const apiHelpers = await import(path.join(distRoot, "services/api-helpers.js"));
const realtime = await import(path.join(distRoot, "lib/realtime/useMacroRealtime.js"));

const incidentsGetRoute = await import(path.join(distRoot, "app/api/incidents/route.js"));
const incidentsIngestRoute = await import(path.join(distRoot, "app/api/incidents/ingest/route.js"));
const incidentsSweepRoute = await import(path.join(distRoot, "app/api/incidents/sweep/route.js"));
const incidentsActionRoute = await import(path.join(distRoot, "app/api/incidents/[id]/action/route.js"));
const syncCronRoute = await import(path.join(distRoot, "app/api/sync/cron/route.js"));

const results = [];
async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS [${results.length}] ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err });
    console.error(`FAIL [${results.length}] ${name}:`, err);
    throw err;
  }
}

function snapshotEnv(keys) {
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  return () => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
}

try {
  // TEST 1: Frontend ingestion, credential redaction, loop exclusion & human approval gate
  await runTest("1. Frontend telemetry ingest, secret redaction & UI code approval gate", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    const restore = snapshotEnv(["FRED_API_KEY", "GEMINI_API_KEY"]);
    process.env.FRED_API_KEY = "fred-super-secret-value-991";

    try {
      const ingestReq = new Request("http://localhost/api/incidents/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({
          domain: "frontend",
          severity: "High",
          affectedComponent: "LightweightTerminalChart",
          errorDescription:
            "TypeError rendering chart with Bearer sk-test-secret-token-123456 and api_key=fred-super-secret-value-991",
          stackTrace:
            "TypeError: Cannot read properties of undefined\n  https://api.example.com?api_key=abc123SECRET\n  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig",
          routePath: "/macrodashboard/economy/inflation",
          // Attempt to spoof protected server-controlled fields:
          status: "resolved",
          approvalStatus: "approved",
        }),
      });

      const res = await incidentsIngestRoute.POST(ingestReq);
      assert.equal(res.status, 202);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.ok(body.incidentId?.startsWith("INC-"));

      const stored = await incStore.getIncidentById(body.incidentId);
      assert.ok(stored);
      // Verify server fields ignored spoofed status/approvalStatus and gated UI bug
      assert.equal(stored.status, "awaiting_approval");
      assert.equal(stored.requiresHumanApproval, true);
      assert.equal(stored.approvalStatus, "pending_approval");
      // Verify full secret redaction
      assert.ok(!stored.errorDescription.includes("fred-super-secret-value-991"));
      assert.ok(!stored.errorDescription.includes("sk-test-secret-token-123456"));
      assert.ok(!(stored.redactedTrace ?? "").includes("abc123SECRET"));
      assert.ok(!(stored.redactedTrace ?? "").includes("eyJhbGci"));

      // Verify recursion protection on /api/incidents/ingest itself
      const loopRes = await dbg.ingestTelemetryAndClassify({
        domain: "frontend",
        affectedComponent: "fetch:/api/incidents/ingest",
        errorDescription: "Loop failure calling /api/incidents/ingest",
      });
      assert.equal(loopRes.telemetryRecorded, false);
      assert.equal(loopRes.incidentResult, null);
    } finally {
      restore();
    }
  });

  // TEST 2: Backend runtime metrics (memory RSS/heap, event-loop lag) & WS disconnect detection
  await runTest("2. Backend memory, event-loop lag, process monitor & active WS disconnect detection", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    await syncStore.resetLocalSyncStoreForTests();
    const restore = snapshotEnv(["MARKET_WS_PROVIDER", "TWELVE_DATA_API_KEY", "ENABLE_PUBLIC_MARKET_WS"]);
    process.env.MARKET_WS_PROVIDER = "twelve_data_ws";
    process.env.TWELVE_DATA_API_KEY = "td-live-token-for-ws-check";

    try {
      await syncStore.seedDataSourcesIfNeeded();
      await syncStore.updateDataHealth({
        id: "source:twelve_data_ws",
        entityType: "source",
        sourceId: "twelve_data_ws",
        workerId: "market-engine",
        status: "FAILED",
        lastError: "WebSocket heartbeat timeout (4001)",
      });

      const sweep = await dbg.runDeterministicMonitorSweep({
        runDbProbe: false,
        autoRemediate: false,
        invokeAi: false,
      });

      assert.ok(sweep.telemetryRecorded >= 1);
      const telemetry = await incStore.listRuntimeTelemetry({ metricType: "memory_rss" });
      assert.ok(telemetry.length >= 1);
      assert.ok((telemetry[0].memoryRssMb ?? 0) > 0);
      assert.equal(typeof telemetry[0].eventLoopLagMs, "number");

      const incidents = await incStore.listIncidents({ domain: "backend" });
      const wsInc = incidents.find((i) => i.providerId === "twelve_data_ws");
      assert.ok(wsInc, "Expected backend WS disconnect incident when configured WS is FAILED");
      assert.equal(wsInc.safeIdempotentAction, "reconnect_market_daemon");
      assert.equal(wsInc.requiresHumanApproval, false);
      assert.equal(typeof dbg.installWorkerProcessMonitors, "function");
    } finally {
      restore();
    }
  });

  // TEST 3: Database read-only integrity check never mutates historical financial observations
  await runTest("3. Database monitoring detects query/duplicate anomalies without mutating historical rows", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    await syncStore.resetLocalSyncStoreForTests();

    // Insert genuine historical economic observation
    await syncStore.upsertMacroObservation({
      seriesKey: "CPI_YOY",
      sourceId: "fred",
      externalSeriesId: "CPIAUCSL",
      observationDate: "2026-08-01",
      publishedAt: "2026-09-10T12:30:00Z",
      value: 2.55,
      unit: "% YoY",
      cadence: "MONTHLY",
      sourceAttribution: "FRED / BLS",
      workerId: "macro-engine",
      validationStatus: "VALIDATED",
    });

    // Record DB duplicate/monotonic anomaly
    await syncStore.recordAnomaly({
      seriesKey: "CPI_YOY",
      sourceId: "fred",
      workerId: "validation-recovery",
      severity: "WARN",
      anomalyType: "NON_MONOTONIC_REJECTED",
      message: "Rejected out-of-order monotonic duplicate timestamp",
      observedValue: "2.40",
      expectedRange: ">= 2026-08-01",
    });

    // Simulate failed DB query via measureDbQuery
    await assert.rejects(
      () =>
        dbg.measureDbQuery("test-supabase-select", async () => {
          throw new Error("DB connection failed using postgres://admin:secretPass@db.host:5432/app");
        }),
      /DB connection failed/
    );

    const beforeObs = await syncStore.getObservations("CPI_YOY");
    const sweep = await dbg.runDeterministicMonitorSweep({
      runDbProbe: true,
      autoRemediate: true,
      invokeAi: false,
    });
    const afterObs = await syncStore.getObservations("CPI_YOY");

    // Strict financial data immutability check!
    assert.deepEqual(afterObs, beforeObs);
    assert.equal(afterObs[0].value, 2.55);

    const dbIncidents = await incStore.listIncidents({ domain: "database" });
    assert.ok(dbIncidents.length >= 2);
    for (const inc of dbIncidents) {
      assert.equal(inc.requiresHumanApproval, true);
      assert.equal(inc.status, "awaiting_approval");
      assert.ok(!(inc.errorDescription + (inc.redactedTrace ?? "")).includes("secretPass"));
    }
    assert.ok(sweep.checksRun.some((c) => c.domain === "database"));
  });

  // TEST 4 & 5: Honesty ("never invent root cause") + Redacted AI Investigation
  await runTest("4. Root-cause honesty: insufficient_evidence fallback & redacted Gemini AI hypothesis", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    const restore = snapshotEnv(["GEMINI_API_KEY"]);
    delete process.env.GEMINI_API_KEY;

    const ambiguous = await incStore.upsertIncident({
      fingerprint: "ambiguous:unclassified-signal",
      severity: "Medium",
      domain: "backend",
      affectedComponent: "opaque-adapter",
      errorDescription: "Opaque condition occurred",
    });

    const detResult = await dbg.investigateIncidentRootCause(ambiguous.incident.id, {
      allowAi: false,
    });
    assert.equal(detResult?.investigationSource, "insufficient_evidence");
    assert.equal(detResult?.rootCauseVerified, false);

    // Mock Gemini response and ensure GEMINI_API_KEY is sent only via header and scrubbed from traces
    const origFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedHeaderKey = "";
    let capturedBodyText = "";
    process.env.GEMINI_API_KEY = "gemini-top-secret-key-987654";

    try {
      globalThis.fetch = async (url, init) => {
        capturedUrl = String(url);
        const hdrs = init?.headers ?? {};
        capturedHeaderKey = hdrs["x-goog-api-key"] ?? "";
        capturedBodyText = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        insufficient_evidence: false,
                        root_cause: "Adapter observed repeated opaque condition without retry metadata.",
                        recommended_fix: "Add structured HTTP status logging to opaque-adapter.",
                        confidence: "medium",
                        evidence_cited: ["errorDescription"],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const aiRes = await dbg.investigateIncidentRootCause(ambiguous.incident.id, {
        allowAi: true,
      });
      assert.equal(capturedHeaderKey, "gemini-top-secret-key-987654");
      assert.ok(!capturedUrl.includes("gemini-top-secret-key-987654"));
      assert.ok(!capturedBodyText.includes("gemini-top-secret-key-987654"));
      assert.equal(aiRes?.investigationSource, "ai_gemini");
      // AI diagnosis MUST stay unverified & awaiting human approval until verified!
      assert.equal(aiRes?.rootCauseVerified, false);
      assert.equal(aiRes?.requiresHumanApproval, true);
      assert.equal(aiRes?.status, "awaiting_approval");
    } finally {
      globalThis.fetch = origFetch;
      restore();
    }
  });

  // TEST 6: Safe idempotent recovery vs human-approval block + real recovery verification
  await runTest("5. Safe idempotent sync recovery resolves on passing verification; risky incident blocks until human approve", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    await syncStore.resetLocalSyncStoreForTests();

    const restore = snapshotEnv(["FRED_API_KEY", "BLS_API_KEY", "BEA_API_KEY"]);
    // Temporarily blank external keys so recovery retry uses clean deterministic fallback cleanly offline
    delete process.env.FRED_API_KEY;
    delete process.env.BLS_API_KEY;
    delete process.env.BEA_API_KEY;

    try {
      const failedRun = await syncStore.recordSyncRunStart({
        workerId: "macro-engine",
        sourceId: "fred",
        jobName: "sync:macro-engine:fred",
        triggerType: "scheduled",
        maxAttempts: 3,
        rawPayload: { seriesKeys: ["CPI_YOY"] },
      });
      await syncStore.completeSyncRun(failedRun.id, {
        status: "DEAD_LETTER",
        deadLettered: true,
        errorMessage: "HTTP 503 upstream outage from FRED",
      });

      const sweep = await dbg.runDeterministicMonitorSweep({
        runDbProbe: false,
        autoRemediate: true,
        invokeAi: false,
      });

      assert.ok(sweep.autoRemediatedCount >= 1);
      const syncIncidents = await incStore.listIncidents({ domain: "sync" });
      const runInc = syncIncidents.find((i) => i.metadata?.syncRunId === failedRun.id);
      assert.ok(runInc);
      assert.equal(runInc.status, "resolved");
      assert.equal(runInc.recoveryVerification?.verified, true);
      assert.ok(runInc.recoveryVerification?.checks.some((c) => c.passed));

      // Now test human approval block on anomaly/historical/UI bug
      const gated = await incStore.upsertIncident({
        fingerprint: "sync:outlier:CPI_YOY",
        severity: "High",
        domain: "sync",
        affectedComponent: "validation:CPI_YOY",
        affectedDataset: "CPI_YOY",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        status: "awaiting_approval",
        errorDescription: "OUTLIER_ZSCORE detected on CPI_YOY (99.0% vs 2.5%)",
      });

      const blockedOutcome = await dbg.executeSafeIdempotentRecovery(gated.incident.id);
      assert.equal(blockedOutcome.ok, false);
      assert.ok(blockedOutcome.blockedReason?.includes("Human approval"));

      const approvedOutcome = await dbg.handleIncidentAction(gated.incident.id, {
        action: "approve",
        actor: "lead-engineer",
        note: "Verified upstream release anomaly manually.",
      });
      assert.equal(approvedOutcome.ok, true);
      assert.equal(approvedOutcome.incident?.approvalStatus, "approved");
    } finally {
      restore();
    }
  });

  // TEST 7: Operational Incident APIs, Cron hook, Auth Guard, Realtime Mapper
  await runTest("6. API auth enforcement, GET snapshot, /api/sync/cron monitor sweep, and Realtime mapper", async () => {
    const restore = snapshotEnv([
      "SYNC_ADMIN_TOKEN",
      "CRON_SECRET",
      "FRED_API_KEY",
      "BLS_API_KEY",
      "BEA_API_KEY",
    ]);
    process.env.SYNC_ADMIN_TOKEN = "agent7-admin-secret";
    process.env.CRON_SECRET = "agent7-cron-secret";
    delete process.env.FRED_API_KEY;
    delete process.env.BLS_API_KEY;
    delete process.env.BEA_API_KEY;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Offline sandbox test stub");
    };

    try {
      const getRes = await incidentsGetRoute.GET();
      assert.equal(getRes.status, 200);
      assert.equal(getRes.headers.get("X-Sync-Admin-Auth-Required"), "true");
      const getJson = await getRes.json();
      assert.ok(Array.isArray(getJson.incidents));
      assert.ok(!JSON.stringify(getJson).includes("agent7-admin-secret"));

      const unauthSweep = await incidentsSweepRoute.POST(
        new Request("http://localhost/api/incidents/sweep", { method: "POST" })
      );
      assert.equal(unauthSweep.status, 401);

      const authSweep = await incidentsSweepRoute.POST(
        new Request("http://localhost/api/incidents/sweep", {
          method: "POST",
          headers: { Authorization: "Bearer agent7-admin-secret" },
          body: JSON.stringify({ runDbProbe: true, autoRemediate: false, invokeAi: false }),
        })
      );
      assert.equal(authSweep.status, 200);
      const authSweepJson = await authSweep.json();
      assert.equal(authSweepJson.ok, true);
      assert.ok(authSweepJson.sweep.checksRun.length >= 4);

      const missingAction = await incidentsActionRoute.POST(
        new Request("http://localhost/api/incidents/INC-MISSING/action", {
          method: "POST",
          headers: {
            Authorization: "Bearer agent7-admin-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "investigate" }),
        }),
        { params: Promise.resolve({ id: "INC-MISSING" }) }
      );
      assert.equal(missingAction.status, 404);

      // Cron route includes Agent 7 incidentSweep
      const unauthCron = await syncCronRoute.GET(
        new Request("http://localhost/api/sync/cron")
      );
      assert.equal(unauthCron.status, 401);

      const authCron = await syncCronRoute.GET(
        new Request("http://localhost/api/sync/cron", {
          headers: { Authorization: "Bearer agent7-cron-secret" },
        })
      );
      assert.equal(authCron.status, 200);
      const cronJson = await authCron.json();
      assert.equal(cronJson.ok, true);
      assert.ok(cronJson.incidentSweep);

      // Realtime single-channel inclusion of system_incidents
      assert.ok(realtime.REALTIME_TABLES.includes("system_incidents"));
      const mapped = realtime.mapRealtimeIncident({
        id: "INC-20261111-9999",
        fingerprint: "sync:test",
        severity: "High",
        domain: "sync",
        affected_component: "worker:fred",
        status: "awaiting_approval",
        approval_status: "pending_approval",
        requires_human_approval: true,
        first_detected_at: "2026-11-11T12:00:00.000Z",
        last_detected_at: "2026-11-11T12:05:00.000Z",
        occurrence_count: 2,
        error_description: "Sample error",
        root_cause_verified: false,
        investigation_source: "deterministic",
      });
      assert.equal(mapped.id, "INC-20261111-9999");
      assert.equal(mapped.requiresHumanApproval, true);
      assert.equal(mapped.occurrenceCount, 2);
    } finally {
      globalThis.fetch = origFetch;
      restore();
    }
  });

  // TEST 8: Full live workspace diagnostic sweep sanity check
  await runTest("7. Full 4-domain MacroEdge diagnostic sweep covers frontend, backend, database & sync", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    await syncStore.resetLocalSyncStoreForTests();
    const sweep = await dbg.runDeterministicMonitorSweep({
      runDbProbe: true,
      autoRemediate: true,
      invokeAi: false,
    });
    const coveredDomains = new Set(sweep.checksRun.map((c) => c.domain));
    assert.ok(coveredDomains.has("frontend"));
    assert.ok(coveredDomains.has("backend"));
    assert.ok(coveredDomains.has("database"));
    assert.ok(coveredDomains.has("sync"));
  });

  // TEST 9: Extended coverage — unexpected termination, stale quotes, duplicate RUNNING jobs, historical drift & runSafeMacroRoute 500
  await runTest("8. Extended coverage: unexpected termination, CPU telemetry, stale quotes, duplicate jobs & API 500 capture", async () => {
    await incStore.resetLocalIncidentStoreForTests();
    await syncStore.resetLocalSyncStoreForTests();
    const restore = snapshotEnv(["MARKET_WS_PROVIDER", "TWELVE_DATA_API_KEY"]);
    process.env.MARKET_WS_PROVIDER = "twelve_data_ws";
    process.env.TWELVE_DATA_API_KEY = "td-key-test";

    try {
      // Simulate worker crash / unexpected termination (started twice without stopped)
      await dbg.recordWorkerSessionLifecycle("macroedge-sync-worker", "started");
      await dbg.recordWorkerSessionLifecycle("macroedge-sync-worker", "started");

      // Seed stale configured market quote (> 5m old)
      await syncStore.upsertMarketQuote({
        symbol: "XAUUSD",
        sourceId: "twelve_data_ws",
        price: 2650.25,
        quoteTimestamp: "2020-01-01T00:00:00.000Z",
        receivedAt: "2020-01-01T00:00:01.000Z",
      });

      // Seed duplicate concurrent RUNNING jobs
      await syncStore.recordSyncRunStart({
        workerId: "macro-engine",
        sourceId: "fred",
        jobName: "sync:macro-engine:fred",
      });
      await syncStore.recordSyncRunStart({
        workerId: "macro-engine",
        sourceId: "fred",
        jobName: "sync:macro-engine:fred",
      });

      // Trigger unhandled 500 in runSafeMacroRoute
      const errRes = await apiHelpers.runSafeMacroRoute(async () => {
        throw new Error("Simulated backend dataset failure with Bearer secretTokenValue99");
      }, "api:macro:overview");
      assert.equal(errRes.status, 500);

      const sweep = await dbg.runDeterministicMonitorSweep({
        runDbProbe: true,
        autoRemediate: false,
        invokeAi: false,
      });

      const memSample = (await incStore.listRuntimeTelemetry({ metricType: "memory_rss" }))[0];
      assert.equal(typeof memSample?.metadata?.cpuPercent, "number");

      const allIncidents = await incStore.listIncidents({ includeClosed: true, limit: 100 });
      assert.ok(allIncidents.some((i) => i.fingerprint.includes("unexpected-termination")));
      assert.ok(allIncidents.some((i) => i.fingerprint.includes("stale-quote:XAUUSD")));
      assert.ok(allIncidents.some((i) => i.fingerprint.includes("duplicate-or-hung")));
      assert.ok(
        allIncidents.some(
          (i) =>
            i.affectedComponent === "api:macro:overview" &&
            !i.errorDescription.includes("secretTokenValue99")
        )
      );
      assert.ok(sweep.checksRun.length >= 5);
    } finally {
      restore();
    }
  });

  // Cleanup sensitive text function spot check
  const sampleRedacted = redact.redactSensitiveText("url=https://x?api_key=abc12345");
  assert.ok(!sampleRedacted.includes("abc12345"));

  console.log(`\nALL ${results.length} AGENT 7 INCIDENT RESPONSE TESTS PASSED.`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
