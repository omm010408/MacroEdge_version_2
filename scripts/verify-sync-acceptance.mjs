#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-accept-"));
const distRoot = path.join(tmpRoot, "dist");
const stateFilePath = path.join(tmpRoot, "sync-state.json");

process.env.MACROEDGE_SYNC_STATE_PATH = stateFilePath;
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");

const workspaceRequire = Module.createRequire(path.join(WORKSPACE, "package.json"));
const ts = workspaceRequire("typescript");

function compileProjectForTests() {
  const tsConfigPath = path.join(WORKSPACE, "tsconfig.json");
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => WORKSPACE,
      getNewLine: () => "\n",
    }));
  }

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

const { NextRequest } = await import(preResolved["next/server"]);
const admin = await import(path.join(distRoot, "lib/supabase/admin.js"));
const registry = await import(path.join(distRoot, "services/sync/provider-registry.js"));
const store = await import(path.join(distRoot, "services/sync/store.js"));
const validation = await import(path.join(distRoot, "services/sync/validation-recovery.js"));
const marketEngine = await import(path.join(distRoot, "services/sync/workers/market-engine.js"));
const macroEngine = await import(path.join(distRoot, "services/sync/workers/macro-engine.js"));
const positioningEngine = await import(path.join(distRoot, "services/sync/workers/positioning-engine.js"));
const liquidityEngine = await import(path.join(distRoot, "services/sync/workers/liquidity-risk-engine.js"));
const aiSupervisor = await import(path.join(distRoot, "services/sync/workers/ai-supervisor.js"));
const orchestrator = await import(path.join(distRoot, "services/sync/orchestrator.js"));
const realtime = await import(path.join(distRoot, "lib/realtime/useMacroRealtime.js"));

const syncStatusRoute = await import(path.join(distRoot, "app/api/sync/status/route.js"));
const syncTriggerRoute = await import(path.join(distRoot, "app/api/sync/trigger/route.js"));
const syncRetryRoute = await import(path.join(distRoot, "app/api/sync/retry/route.js"));
const syncCronRoute = await import(path.join(distRoot, "app/api/sync/cron/route.js"));
const syncInsightsRoute = await import(path.join(distRoot, "app/api/sync/insights/route.js"));
const macroHealthRoute = await import(path.join(distRoot, "app/api/macro/health/route.js"));
const macroOverviewRoute = await import(path.join(distRoot, "app/api/macro/overview/route.js"));
const macroInflationRoute = await import(path.join(distRoot, "app/api/macro/inflation/route.js"));

const results = [];
const ENV_KEYS_TO_ISOLATE = [
  "FRED_API_KEY",
  "BLS_API_KEY",
  "BEA_API_KEY",
  "GEMINI_API_KEY",
  "SYNC_ADMIN_TOKEN",
  "CRON_SECRET",
  "ENABLE_PUBLIC_CFTC_LIVE",
  "ENABLE_PUBLIC_TREASURY_LIVE",
  "ENABLE_PUBLIC_MARKET_WS",
  "MARKET_WS_PROVIDER",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "MACROEDGE_RETRY_BASE_MS",
];
const initialEnv = Object.fromEntries(
  ENV_KEYS_TO_ISOLATE.map((k) => [k, process.env[k]])
);

async function test(name, fn) {
  for (const k of ENV_KEYS_TO_ISOLATE) {
    if (initialEnv[k] === undefined) delete process.env[k];
    else process.env[k] = initialEnv[k];
  }
  await store.resetLocalSyncStoreForTests(true);
  await fn();
  results.push(name);
  console.log(`PASS [${results.length}/14] ${name}`);
}

const origFetch = globalThis.fetch;

try {
  // 1. WS reconnect
  await test("1. WS reconnect with exponential backoff and health state recovery", async () => {
    const sockets = [];
    const states = [];
    const daemon = new marketEngine.MarketWebSocketDaemon({
      providerId: "coinbase_ws",
      symbols: ["BTCUSD"],
      respectEnvConfig: false,
      reconnectBaseMs: 15,
      reconnectMaxMs: 60,
      maxReconnectAttempts: 3,
      wsFactory: () => {
        const ws = {
          readyState: 1,
          sent: [],
          send(msg) {
            this.sent.push(msg);
          },
          close() {
            this.readyState = 3;
            this.onclose?.({});
          },
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
        };
        sockets.push(ws);
        return ws;
      },
      onStateChange: (s) => states.push(s),
    });

    await daemon.start();
    assert.equal(sockets.length, 1);
    sockets[0].onopen?.({});
    assert.equal(daemon.getConnectionState(), "OPEN");

    // Simulate unexpected disconnect -> triggers reconnectWithBackoff -> opens second socket
    sockets[0].onclose?.({});
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(states.includes("RECONNECTING"), "Expected RECONNECTING state transition");
    assert.ok(sockets.length >= 2, "Expected daemon to open replacement WebSocket");
    sockets[1].onopen?.({});
    assert.equal(daemon.getConnectionState(), "OPEN");
    await daemon.stop();
    assert.equal(daemon.getConnectionState(), "STOPPED");
  });

  // 2. Tick dedup + OHLCV bar aggregation + DXY/provider config honesty
  await test("2. Market tick deduplication, stale rejection, OHLCV bars, and DXY/config honesty", async () => {
    const dxyMapping = registry.getMarketInstrumentMapping("DXY");
    assert.ok(!dxyMapping.fallbackProviders.includes("fred"), "DXY must not fail over to FRED DTWEXBGS");
    assert.equal(dxyMapping.externalSymbols.fred, undefined);

    delete process.env.ENABLE_PUBLIC_CFTC_LIVE;
    delete process.env.ENABLE_PUBLIC_TREASURY_LIVE;
    delete process.env.ENABLE_PUBLIC_MARKET_WS;
    delete process.env.MARKET_WS_PROVIDER;
    assert.equal(registry.isProviderConfigured("cftc"), false);
    assert.equal(registry.isProviderConfigured("us_treasury"), false);
    assert.equal(registry.isProviderConfigured("coinbase_ws"), false);

    const providerStatuses = await registry.getAllProviderStatuses();
    for (const pid of ["cftc", "us_treasury", "coinbase_ws"]) {
      const row = providerStatuses.find((s) => s.providerId === pid);
      assert.ok(row, `Missing provider status for ${pid}`);
      assert.equal(row.configured, false);
      assert.equal(row.status, "DISCONNECTED");
    }

    const daemon = new marketEngine.MarketWebSocketDaemon({
      providerId: "coinbase_ws",
      symbols: ["BTCUSD"],
      respectEnvConfig: false,
      barTimeframes: ["1m"],
    });
    const tsNow = new Date().toISOString();
    const first = await daemon.handleIncomingTick({
      symbol: "BTCUSD",
      providerId: "coinbase_ws",
      price: 85100,
      volume: 1.25,
      tickSeq: 100,
      quoteTimestamp: tsNow,
    });
    assert.equal(first.accepted, true);

    const dup = await daemon.handleIncomingTick({
      symbol: "BTCUSD",
      providerId: "coinbase_ws",
      price: 85100,
      volume: 1.25,
      tickSeq: 100,
      quoteTimestamp: tsNow,
    });
    assert.equal(dup.accepted, false);
    assert.equal(dup.reason, "DEDUP_OR_STALE_TICK");

    const higher = await daemon.handleIncomingTick({
      symbol: "BTCUSD",
      providerId: "coinbase_ws",
      price: 85350,
      volume: 2.0,
      tickSeq: 101,
      quoteTimestamp: new Date(Date.parse(tsNow) + 500).toISOString(),
    });
    assert.equal(higher.accepted, true);

    const quotes = await store.getMarketQuotes();
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].price, 85350);

    const bars = await store.getMarketBars("BTCUSD", "1m", 10);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].open, 85100);
    assert.equal(bars[0].high, 85350);
    assert.equal(bars[0].close, 85350);
    assert.equal(bars[0].tickCount, 2);
    assert.equal(bars[0].volume, 3.25);
  });

  // 3. DB record updates & SQL schema verification
  await test("3. SQL migration contracts & DB record updates across tables", async () => {
    const sqlPath = path.join(WORKSPACE, "supabase/migrations/001_autonomous_macro_sync.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    for (const tableName of [
      "data_sources",
      "data_observations",
      "latest_values",
      "market_quotes",
      "market_bars",
      "sync_runs",
      "data_health",
      "data_anomalies",
      "sync_checkpoints",
      "macro_insights",
    ]) {
      assert.ok(sql.includes(`create table if not exists public.${tableName}`), `Missing SQL table ${tableName}`);
      assert.ok(sql.includes(`alter table public.${tableName} enable row level security`), `Missing RLS on ${tableName}`);
    }
    assert.ok(sql.includes("create or replace function public.upsert_macro_observation"));
    assert.ok(sql.includes("alter publication supabase_realtime add table public.latest_values"));

    await store.seedDataSourcesIfNeeded();
    const res = await store.upsertMacroObservation({
      seriesKey: "UNRATE",
      sourceId: "fred",
      externalSeriesId: "UNRATE",
      observationDate: "2026-10-01",
      publishedAt: "2026-11-01T12:30:00Z",
      value: 4.1,
      previousValue: 4.1,
      unit: "%",
      cadence: "MONTHLY",
      sourceAttribution: "BLS / FRED · UNRATE",
    });
    assert.equal(res.accepted, true);
    assert.equal((await store.getLatestValues()).length, 1);
    assert.equal((await store.getObservations("UNRATE", 10)).length, 1);
  });

  // 4. Vintage revision preservation
  await test("4. Vintage revision preservation for restated economic prints", async () => {
    const v1 = await validation.validateAndNormalizeObservation(
      {
        seriesKey: "CPI_YOY",
        sourceId: "bls",
        externalSeriesId: "CUUR0000SA0",
        observationDate: "2026-10-01",
        publishedAt: "2026-11-10T13:30:00Z",
        value: 2.6,
        unit: "% YoY",
        cadence: "MONTHLY",
      },
      { persist: true }
    );
    assert.equal(v1.valid, true);
    assert.equal(v1.upsertResult?.revisionNumber, 1);

    const v2 = await validation.validateAndNormalizeObservation(
      {
        seriesKey: "CPI_YOY",
        sourceId: "bls",
        externalSeriesId: "CUUR0000SA0",
        observationDate: "2026-10-01",
        publishedAt: "2026-11-12T13:30:00Z",
        value: 2.64,
        unit: "% YoY",
        cadence: "MONTHLY",
      },
      { persist: true }
    );
    assert.equal(v2.valid, true);
    assert.equal(v2.isRevision, true);
    assert.equal(v2.upsertResult?.revisionNumber, 2);

    const allObs = await store.getObservations("CPI_YOY", 10);
    assert.equal(allObs.length, 2);
    assert.equal(allObs.filter((o) => o.isLatest).length, 1);
    assert.equal(allObs.find((o) => o.isLatest).value, 2.64);
  });

  // 5. Monotonic latest guard
  await test("5. Monotonic latest guard rejects older observationDate & older publishedAt", async () => {
    await store.upsertMacroObservation({
      seriesKey: "CORE_PCE_YOY",
      sourceId: "fred",
      externalSeriesId: "PCEPILFE",
      observationDate: "2026-10-01",
      publishedAt: "2026-11-10T13:30:00Z",
      value: 2.7,
      previousValue: 2.6,
      unit: "% YoY",
      cadence: "MONTHLY",
      sourceAttribution: "BEA / FRED · PCEPILFE",
    });

    // Older observation date cannot overwrite latest_values
    const olderDate = await validation.validateAndNormalizeObservation(
      {
        seriesKey: "CORE_PCE_YOY",
        sourceId: "fred",
        externalSeriesId: "PCEPILFE",
        observationDate: "2026-09-01",
        publishedAt: "2026-10-31T13:30:00Z",
        value: 2.5,
        unit: "% YoY",
        cadence: "MONTHLY",
      },
      { persist: true, isBackfill: true }
    );
    assert.equal(olderDate.canUpdateLatest, false);

    // Older publishedAt for same date is rejected & flagged as anomaly
    const olderPub = await validation.validateAndNormalizeObservation(
      {
        seriesKey: "CORE_PCE_YOY",
        sourceId: "fred",
        externalSeriesId: "PCEPILFE",
        observationDate: "2026-10-01",
        publishedAt: "2026-11-08T13:30:00Z",
        value: 2.55,
        unit: "% YoY",
        cadence: "MONTHLY",
      },
      { persist: true }
    );
    assert.equal(olderPub.valid, false);
    assert.equal(olderPub.monotonicRejected, true);

    const latest = await store.getLatestValues();
    assert.equal(latest[0].value, 2.7);
    assert.equal(latest[0].observationDate, "2026-10-01");
    const anomalies = await store.listAnomalies(false, 20);
    assert.ok(anomalies.some((a) => a.anomalyType === "NON_MONOTONIC_REJECTED"));
  });

  // 6. Retry / backoff & dead-letter queue (both validation helper and real worker HTTP 503/429 retry)
  await test("6. Exponential retry/backoff recovery (including real worker 503/429 retry) and DLQ", async () => {
    process.env.MACROEDGE_RETRY_BASE_MS = "5";
    process.env.FRED_API_KEY = "test-fred-key";
    process.env.BLS_API_KEY = "test-bls-key";

    let attempts = 0;
    const recovered = await validation.executeWithRetry(
      {
        workerId: "macro-engine",
        providerId: "fred",
        jobName: "transient-recovery-test",
        maxAttempts: 3,
        backoffBaseMs: 5,
        backoffMaxMs: 20,
        sleepFn: async () => {},
      },
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new validation.ProviderRequestError("Temporary 503", {
            statusCode: 503,
            retryable: true,
          });
        }
        return { status: "SUCCEEDED", recordsInserted: 2 };
      }
    );
    assert.equal(recovered.status, "SUCCEEDED");
    assert.equal(attempts, 3);

    // Real worker HTTP 503 -> 429 -> 200 retry inside runMacroEngineSync
    let fredCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("api.stlouisfed.org")) {
        fredCalls += 1;
        if (fredCalls === 1) {
          return new Response("Upstream overloaded", { status: 503 });
        }
        if (fredCalls === 2) {
          return new Response("Rate limited", { status: 429 });
        }
        return new Response(
          JSON.stringify({
            observations: [
              { date: "2026-10-01", value: "3.30", realtime_start: "2026-11-10" },
              { date: "2026-09-01", value: "3.20", realtime_start: "2026-10-10" },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("Offline");
    };

    const macroRetryRes = await macroEngine.runMacroEngineSync({
      seriesKeys: ["CORE_CPI_YOY"],
      trigger: "manual",
    });
    assert.equal(macroRetryRes.status, "SUCCEEDED");
    assert.equal(fredCalls, 3);
    assert.equal(macroRetryRes.recordsInserted, 2);
    const latestAfterRetry = await store.getLatestValues();
    assert.equal(latestAfterRetry[0].seriesKey, "CORE_CPI_YOY");
    assert.equal(latestAfterRetry[0].value, 3.3);
    assert.equal(latestAfterRetry[0].observationDate, "2026-10-01");

    const dead = await validation.executeWithRetry(
      {
        workerId: "macro-engine",
        providerId: "bls",
        jobName: "persistent-failure-dlq-test",
        maxAttempts: 2,
        backoffBaseMs: 5,
        backoffMaxMs: 10,
        sleepFn: async () => {},
      },
      async () => {
        throw new validation.ProviderRequestError("Rate limit 429", {
          statusCode: 429,
          retryable: true,
        });
      }
    );
    assert.equal(dead.status, "DEAD_LETTER");
    assert.equal(dead.deadLetter, true);
    const runs = await store.listSyncRuns(10);
    const macroRunRow = runs.find((r) => r.id === macroRetryRes.runId);
    assert.ok(macroRunRow && Number(macroRunRow.rawPayload.retryCount) >= 2);
    assert.ok(runs.some((r) => r.id === dead.runId && r.deadLettered));
    delete process.env.MACROEDGE_RETRY_BASE_MS;
  });

  // 7. Staleness detection (periodic economic data NEVER marked LIVE)
  await test("7. Cadence-aware staleness detection never marks periodic sources LIVE", async () => {
    await store.seedDataSourcesIfNeeded();
    process.env.FRED_API_KEY = "test-fred-key";
    const oldTs = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    await store.updateDataHealth({
      id: "source:fred",
      entityType: "source",
      sourceId: "fred",
      workerId: "macro-engine",
      status: "CURRENT",
      lastSuccessAt: oldTs,
      lastAttemptAt: oldTs,
    });
    const evaluated = await validation.evaluateSourceStaleness(Date.now());
    const fredHealth = evaluated.find((h) => h.id === "source:fred");
    assert.equal(fredHealth.status, "STALE");
    assert.ok(evaluated.every((h) => h.sourceId !== "fred" || h.status !== "LIVE"));

    const nowTs = new Date().toISOString();
    await store.updateDataHealth({
      id: "source:fred",
      entityType: "source",
      sourceId: "fred",
      workerId: "macro-engine",
      status: "CURRENT",
      lastSuccessAt: nowTs,
      lastAttemptAt: nowTs,
    });
    const freshEval = await validation.evaluateSourceStaleness(Date.now());
    const fredFresh = freshEval.find((h) => h.id === "source:fred");
    assert.equal(fredFresh.status, "CURRENT");
  });

  // 8. Realtime channel payload/subscription deduplication & mapping
  await test("8. Supabase Realtime channel deduplication, payload mapping, and cleanup", async () => {
    let subscribeCb = null;
    const changeHandlers = {};
    let removeChannelCalls = 0;

    const fakeChannel = {
      on(_kind, filter, cb) {
        changeHandlers[filter.table] = cb;
        return fakeChannel;
      },
      subscribe(cb) {
        subscribeCb = cb;
        cb("SUBSCRIBED");
        return fakeChannel;
      },
    };
    const fakeSupabase = {
      channel() {
        return fakeChannel;
      },
      async removeChannel() {
        removeChannelCalls += 1;
      },
    };

    const events1 = [];
    const statuses1 = [];
    const events2 = [];

    const unsub1 = realtime.subscribeToMacroRealtimeRegistry(
      { onStatus: (s) => statuses1.push(s), onEvent: (e) => events1.push(e) },
      fakeSupabase
    );
    const unsub2 = realtime.subscribeToMacroRealtimeRegistry(
      { onStatus: () => {}, onEvent: (e) => events2.push(e) },
      fakeSupabase
    );

    // Two listeners MUST share 1 deduplicated channel
    assert.equal(realtime.getActiveRealtimeChannelCount(), 1);
    assert.ok(statuses1.includes("LIVE"));
    assert.ok(typeof subscribeCb === "function");
    for (const tbl of realtime.REALTIME_TABLES) {
      assert.ok(tbl in changeHandlers, `Missing table subscription for ${tbl}`);
    }

    changeHandlers.latest_values({
      eventType: "UPDATE",
      new: {
        series_key: "CPI_YOY",
        source_id: "bls",
        external_series_id: "CUUR0000SA0",
        observation_date: "2026-10-01",
        published_at: "2026-11-12T13:30:00Z",
        value: 2.6,
        unit: "% YoY",
        cadence: "MONTHLY",
        status: "CURRENT",
        revision_number: 2,
      },
    });
    assert.equal(events1.length, 1);
    assert.equal(events2.length, 1);
    assert.equal(events1[0].record.seriesKey, "CPI_YOY");
    assert.equal(
      realtime.shouldAcceptMonotonicLatestValue(events1[0].record, {
        ...events1[0].record,
        observationDate: "2026-09-01",
      }),
      false
    );

    unsub1();
    assert.equal(realtime.getActiveRealtimeChannelCount(), 1);
    unsub2();
    assert.equal(realtime.getActiveRealtimeChannelCount(), 0);
    assert.equal(removeChannelCalls, 1);
  });

  // 9. sync_runs logging + post-validation AI supervisor + us_treasury + ISM non-pollution
  await test("9. sync_runs audit logging across engines, us_treasury support, & post-validation AI", async () => {
    process.env.MACROEDGE_RETRY_BASE_MS = "5";
    process.env.FRED_API_KEY = "test-fred-key";
    process.env.BLS_API_KEY = "test-bls-key";
    process.env.BEA_API_KEY = "test-bea-key";
    process.env.ENABLE_PUBLIC_TREASURY_LIVE = "true";
    delete process.env.GEMINI_API_KEY;

    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("api.stlouisfed.org")) {
        return new Response(
          JSON.stringify({
            observations: [
              { date: "2026-10-01", value: "2.60", realtime_start: "2026-11-10" },
              { date: "2026-09-01", value: "2.40", realtime_start: "2026-10-10" },
            ],
          }),
          { status: 200 }
        );
      }
      if (s.includes("api.bls.gov")) {
        return new Response(
          JSON.stringify({
            status: "REQUEST_SUCCEEDED",
            Results: {
              series: [
                {
                  data: [
                    { year: "2026", period: "M10", value: "315.66" },
                    { year: "2026", period: "M09", value: "315.10" },
                    { year: "2025", period: "M10", value: "307.66" },
                    { year: "2025", period: "M09", value: "307.70" },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (s.includes("apps.bea.gov")) {
        return new Response(
          JSON.stringify({
            BEAAPI: {
              Results: {
                Data: [
                  { LineNumber: "1", TimePeriod: "2026Q2", DataValue: "3.0" },
                  { LineNumber: "1", TimePeriod: "2026Q3", DataValue: "2.8" },
                ],
              },
            },
          }),
          { status: 200 }
        );
      }
      if (s.includes("api.fiscaldata.treasury.gov")) {
        return new Response(
          JSON.stringify({
            data: [
              { record_date: "2026-10-31", security_desc: "Treasury Notes", avg_interest_rate_amt: "3.34" },
              { record_date: "2026-09-30", security_desc: "Treasury Notes", avg_interest_rate_amt: "3.30" },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("Simulated offline for optional feeds");
    };

    const macroRes = await macroEngine.runMacroEngineSync({
      seriesKeys: ["CPI_YOY", "CORE_CPI_YOY", "REAL_GDP_QOQ", "ISM_MFG"],
      trigger: "manual",
    });
    assert.equal(macroRes.status, "SUCCEEDED");
    assert.ok(macroRes.recordsInserted >= 3);

    // Ensure ISM_MFG did NOT mark source:fred as DISCONNECTED
    const healthAfterMacro = await store.listDataHealth();
    assert.notEqual(
      healthAfterMacro.find((h) => h.id === "source:fred")?.status,
      "DISCONNECTED"
    );

    const posRes = await positioningEngine.runPositioningEngineSync({ trigger: "manual" });
    assert.equal(posRes.status, "SUCCEEDED");

    const liqRes = await liquidityEngine.runLiquidityRiskEngineSync({ trigger: "manual" });
    assert.ok(["SUCCEEDED", "PARTIAL"].includes(liqRes.status));
    assert.ok(
      (await store.getLatestValues()).some((v) => v.seriesKey === "UST_AVG_NOTE_RATE"),
      "Expected liquidity-risk-engine to sync us_treasury UST_AVG_NOTE_RATE"
    );

    const aiRes = await aiSupervisor.runAiSupervisorCycle({ trigger: "manual" });
    assert.equal(aiRes.status, "SUCCEEDED");
    assert.equal(aiRes.recordsInserted, 1);

    const runs = await store.listSyncRuns(20);
    assert.ok(runs.length >= 4);
    assert.ok(runs.every((r) => Boolean(r.startedAt) && Boolean(r.finishedAt)));

    const insights = await store.listMacroInsights(undefined, 5);
    assert.equal(insights.length, 1);
    assert.equal(insights[0].modelId, "unconfigured_ai");
    assert.ok(insights[0].sourceSeriesKeys.includes("CPI_YOY"));
    delete process.env.MACROEDGE_RETRY_BASE_MS;
  });

  // 10. Worker isolation
  await test("10. Worker isolation prevents single-provider failure from halting other engines", async () => {
    process.env.MACROEDGE_RETRY_BASE_MS = "5";
    process.env.FRED_API_KEY = "test-fred-key";
    process.env.BLS_API_KEY = "test-bls-key";
    process.env.ENABLE_PUBLIC_CFTC_LIVE = "true";

    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("publicreporting.cftc.gov")) {
        throw new Error("Simulated CFTC outage");
      }
      if (s.includes("api.stlouisfed.org")) {
        return new Response(
          JSON.stringify({
            observations: [{ date: "2026-11-11", value: "4.31", realtime_start: "2026-11-11" }],
          }),
          { status: 200 }
        );
      }
      if (s.includes("api.bls.gov")) {
        return new Response(
          JSON.stringify({
            status: "REQUEST_SUCCEEDED",
            Results: {
              series: [
                {
                  data: [
                    { year: "2026", period: "M10", value: "315.66" },
                    { year: "2026", period: "M09", value: "315.10" },
                    { year: "2025", period: "M10", value: "307.66" },
                    { year: "2025", period: "M09", value: "307.70" },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("Simulated optional feed failure");
    };

    const dispatch = await orchestrator.dispatchSyncJob({
      trigger: "manual",
      force: true,
      seriesKeys: ["CPI_YOY", "CORE_CPI_YOY"],
    });
    assert.ok(dispatch.summaries.some((s) => s.workerId === "macro-engine" && s.status !== "FAILED"));
    assert.ok(
      dispatch.summaries.some(
        (s) =>
          s.workerId === "positioning-engine" &&
          (s.status === "FAILED" || s.status === "DEAD_LETTER")
      )
    );
    assert.ok((await store.getLatestValues()).some((v) => v.seriesKey === "CPI_YOY"));
    delete process.env.MACROEDGE_RETRY_BASE_MS;
  });

  // 11. Server-only keys & zero secret leakage
  await test("11. Server-only API keys, browser guard, and scrubbed .env.example", async () => {
    const envExample = fs.readFileSync(path.join(WORKSPACE, ".env.example"), "utf8");
    for (const keyName of [
      "FRED_API_KEY",
      "BLS_API_KEY",
      "BEA_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GEMINI_API_KEY",
      "CRON_SECRET",
      "SYNC_ADMIN_TOKEN",
    ]) {
      const line = envExample.split("\n").find((l) => l.startsWith(`${keyName}=`));
      assert.equal(line, `${keyName}=`, `.env.example must keep ${keyName} as empty placeholder`);
    }

    process.env.FRED_API_KEY = "SUPER_SECRET_FRED_123";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "SUPER_SECRET_SERVICE_ROLE_456";
    process.env.GEMINI_API_KEY = "SUPER_SECRET_GEMINI_789";

    // Simulate browser global to verify runtime server-only guards
    globalThis.window = {};
    try {
      assert.throws(() => admin.getSupabaseAdminClient());
      assert.equal(registry.isProviderConfigured("fred"), false);
    } finally {
      delete globalThis.window;
    }

    globalThis.fetch = async () => {
      throw new Error("Offline");
    };

    const responses = [
      await (await macroHealthRoute.GET()).text(),
      await (await macroOverviewRoute.GET(new NextRequest("http://localhost/api/macro/overview"))).text(),
      await (await macroInflationRoute.GET(new NextRequest("http://localhost/api/macro/inflation"))).text(),
      await (await syncStatusRoute.GET()).text(),
    ];
    for (const body of responses) {
      assert.ok(!body.includes("SUPER_SECRET_FRED_123"), "Leaked FRED_API_KEY in response");
      assert.ok(!body.includes("SUPER_SECRET_SERVICE_ROLE_456"), "Leaked SERVICE_ROLE_KEY in response");
      assert.ok(!body.includes("SUPER_SECRET_GEMINI_789"), "Leaked GEMINI_API_KEY in response");
    }
  });

  // 12. Build / deployment config / TypeScript check
  await test("12. Deployment config (vercel.json, render.yaml, sync-worker) & typecheck", async () => {
    const vercelCfg = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "vercel.json"), "utf8"));
    assert.ok(Array.isArray(vercelCfg.crons));
    assert.equal(vercelCfg.crons[0].path, "/api/sync/cron");

    const renderYaml = fs.readFileSync(path.join(WORKSPACE, "render.yaml"), "utf8");
    assert.ok(renderYaml.includes("type: worker"));
    assert.ok(renderYaml.includes("scripts/sync-worker.ts"));

    execFileSync("npm", ["run", "typecheck"], { cwd: WORKSPACE, stdio: "pipe" });
  });

  // 13. Operational controls (/api/sync/status, trigger, retry, cron, insights)
  await test("13. Operational API controls (auth, trigger, retry, cron, insights)", async () => {
    process.env.SYNC_ADMIN_TOKEN = "admin-token-xyz";
    process.env.CRON_SECRET = "cron-secret-xyz";
    delete process.env.ENABLE_PUBLIC_CFTC_LIVE;
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };

    const statusRes = await syncStatusRoute.GET();
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.headers.get("x-sync-admin-auth-required"), "true");

    // Unauthorized trigger blocked with 401
    const unauthTrigger = await syncTriggerRoute.POST(
      new NextRequest("http://localhost/api/sync/trigger", {
        method: "POST",
        body: JSON.stringify({ workerId: "positioning-engine" }),
      })
    );
    assert.equal(unauthTrigger.status, 401);

    // Authorized trigger runs cleanly
    const authTrigger = await syncTriggerRoute.POST(
      new NextRequest("http://localhost/api/sync/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer admin-token-xyz" },
        body: JSON.stringify({ workerId: "positioning-engine" }),
      })
    );
    assert.equal(authTrigger.status, 200);
    const triggerJson = await authTrigger.json();
    assert.equal(triggerJson.ok, true);

    // Retry DLQ runId
    const dlqRun = await store.recordSyncRunStart({
      workerId: "positioning-engine",
      sourceId: "cftc",
      jobName: "dlq-retry-test",
      attempt: 3,
      maxAttempts: 3,
    });
    await store.completeSyncRun(dlqRun.id, { status: "FAILED", deadLettered: true });

    const retryRes = await syncRetryRoute.POST(
      new NextRequest("http://localhost/api/sync/retry", {
        method: "POST",
        headers: { Authorization: "Bearer admin-token-xyz" },
        body: JSON.stringify({ runId: dlqRun.id }),
      })
    );
    assert.equal(retryRes.status, 200);
    assert.equal((await retryRes.json()).ok, true);

    // Cron auth check
    const cronUnauth = await syncCronRoute.GET(
      new NextRequest("http://localhost/api/sync/cron")
    );
    assert.equal(cronUnauth.status, 401);

    const cronAuth = await syncCronRoute.GET(
      new NextRequest("http://localhost/api/sync/cron", {
        headers: { Authorization: "Bearer cron-secret-xyz" },
      })
    );
    assert.equal(cronAuth.status, 200);

    // Insights trigger after seeding 1 validated observation (with mocked Gemini synthesis)
    process.env.GEMINI_API_KEY = "test-gemini-key";
    globalThis.fetch = async (url) => {
      if (String(url).includes("generativelanguage.googleapis.com")) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        title: "US CPI Grounded Synthesis",
                        summary: "CPI_YOY printed 2.6% for 2026-10-01 (published 2026-11-10T13:30:00Z).",
                        keyDrivers: ["CPI_YOY=2.6 % YoY"],
                        riskFlags: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("Offline");
    };

    await store.upsertMacroObservation({
      seriesKey: "CPI_YOY",
      sourceId: "bls",
      externalSeriesId: "CUUR0000SA0",
      observationDate: "2026-10-01",
      publishedAt: "2026-11-10T13:30:00Z",
      value: 2.6,
      previousValue: 2.4,
      unit: "% YoY",
      cadence: "MONTHLY",
      sourceAttribution: "BLS · CUUR0000SA0",
    });
    const insightsRes = await syncInsightsRoute.POST(
      new NextRequest("http://localhost/api/sync/insights", {
        method: "POST",
        headers: { Authorization: "Bearer admin-token-xyz" },
      })
    );
    assert.equal(insightsRes.status, 200);
    const insightsJson = await insightsRes.json();
    assert.ok(insightsJson.snapshot.insights.length >= 1);
    assert.equal(insightsJson.snapshot.insights[0].modelId, "gemini-2.5-flash");
  });

  // 14. Zero-demo honesty for macro routes & persisted/live observation rendering
  await test("14. Zero-demo honesty: unconfigured routes report UNCONFIGURED/null and live routes return persisted/mocked observations", async () => {
    for (const key of [
      "FRED_API_KEY",
      "BLS_API_KEY",
      "BEA_API_KEY",
      "ENABLE_PUBLIC_CFTC_LIVE",
      "ENABLE_PUBLIC_TREASURY_LIVE",
      "ENABLE_PUBLIC_MARKET_WS",
      "MARKET_WS_PROVIDER",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]) {
      delete process.env[key];
    }
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };

    const healthEmptyRes = await macroHealthRoute.GET();
    assert.equal(healthEmptyRes.status, 200);
    const healthEmptyText = await healthEmptyRes.text();
    assert.ok(!healthEmptyText.includes("DEMO_SNAPSHOT"));
    assert.ok(!healthEmptyText.includes("LOCAL_DEMO"));
    const healthEmpty = JSON.parse(healthEmptyText);
    assert.equal(healthEmpty.providers.fred, "UNCONFIGURED");
    assert.equal(healthEmpty.providers.bls, "UNCONFIGURED");
    assert.equal(healthEmpty.providers.bea, "UNCONFIGURED");
    assert.equal(healthEmpty.providers.cftc, "UNCONFIGURED");
    assert.equal(healthEmpty.providers.treasury, "UNCONFIGURED");
    assert.equal(healthEmpty.providers.supabase, "LOCAL_AUTH");

    const overviewEmptyRes = await macroOverviewRoute.GET(
      new NextRequest("http://localhost/api/macro/overview")
    );
    assert.equal(overviewEmptyRes.status, 200);
    const overviewEmptyText = await overviewEmptyRes.text();
    assert.ok(!overviewEmptyText.includes("DEMO_SNAPSHOT"));
    const overviewEmpty = JSON.parse(overviewEmptyText);
    assert.equal(overviewEmpty.meta.mode, "UNCONFIGURED");
    assert.ok(overviewEmpty.cards.length > 0);
    assert.ok(
      overviewEmpty.cards.every(
        (c) =>
          c.value === null &&
          c.previous === null &&
          c.change === null &&
          c.changePercent === null &&
          Array.isArray(c.sparkline) &&
          c.sparkline.length === 0
      ),
      "Unconfigured overview cards must not contain synthetic numeric values"
    );
    assert.equal(overviewEmpty.regimeFactors.length, 0);
    assert.equal(overviewEmpty.calendarEvents.length, 0);
    assert.equal(overviewEmpty.correlationAssets.length, 0);

    const inflationEmptyRes = await macroInflationRoute.GET(
      new NextRequest("http://localhost/api/macro/inflation")
    );
    assert.equal(inflationEmptyRes.status, 200);
    const inflationEmptyText = await inflationEmptyRes.text();
    assert.ok(!inflationEmptyText.includes("DEMO_SNAPSHOT"));
    const inflationEmpty = JSON.parse(inflationEmptyText);
    assert.equal(inflationEmpty.meta.mode, "UNCONFIGURED");
    assert.ok(inflationEmpty.topMetrics.length > 0);
    assert.ok(
      inflationEmpty.topMetrics.every((m) => m.latest === null && m.previous === null),
      "Unconfigured inflation metrics must not contain synthetic numeric values"
    );
    assert.equal(inflationEmpty.components.length, 0);
    assert.equal(inflationEmpty.history.length, 0);

    // Configured key without synced observations reports LIVE_CONFIGURED / AWAITING_SYNC
    process.env.FRED_API_KEY = "test-fred-key";
    const healthConfigured = await (await macroHealthRoute.GET()).json();
    assert.equal(healthConfigured.providers.fred, "LIVE_CONFIGURED");
    const overviewAwaiting = await (
      await macroOverviewRoute.GET(new NextRequest("http://localhost/api/macro/overview"))
    ).json();
    const awaitingUs10y = overviewAwaiting.cards.find((c) => c.id === "us10y");
    assert.ok(awaitingUs10y);
    assert.equal(awaitingUs10y.value, null);
    assert.equal(awaitingUs10y.meta.mode, "AWAITING_SYNC");

    // Seed persisted observations in store.ts -> routes return real stored values cleanly
    await store.upsertMacroObservation({
      seriesKey: "US10Y",
      sourceId: "fred",
      externalSeriesId: "DGS10",
      observationDate: "2026-11-10",
      publishedAt: "2026-11-10T21:00:00Z",
      value: 4.28,
      previousValue: 4.22,
      unit: "%",
      cadence: "DAILY",
      sourceAttribution: "US Treasury H.15 / FRED · DGS10",
    });
    await store.upsertMacroObservation({
      seriesKey: "CPI_YOY",
      sourceId: "bls",
      externalSeriesId: "CUUR0000SA0",
      observationDate: "2026-10-01",
      publishedAt: "2026-11-10T13:30:00Z",
      value: 2.65,
      previousValue: 2.58,
      unit: "% YoY",
      cadence: "MONTHLY",
      sourceAttribution: "BLS · CUUR0000SA0",
    });

    const overviewPersisted = await (
      await macroOverviewRoute.GET(new NextRequest("http://localhost/api/macro/overview"))
    ).json();
    const persistedUs10y = overviewPersisted.cards.find((c) => c.id === "us10y");
    assert.equal(persistedUs10y.value, 4.28);
    assert.equal(persistedUs10y.meta.mode, "LIVE_API");

    const inflationPersisted = await (
      await macroInflationRoute.GET(new NextRequest("http://localhost/api/macro/inflation"))
    ).json();
    const persistedCpi = inflationPersisted.topMetrics.find((m) => m.id === "cpi-yoy");
    assert.equal(persistedCpi.latest, 2.65);
    assert.equal(persistedCpi.meta.mode, "LIVE_API");

    // Live mocked API overrides with freshest reading cleanly
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.includes("api.stlouisfed.org") && s.includes("series_id=DGS10")) {
        return new Response(
          JSON.stringify({
            observations: [
              { date: "2026-11-11", value: "4.35" },
              { date: "2026-11-10", value: "4.28" },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("Offline");
    };
    const overviewLive = await (
      await macroOverviewRoute.GET(new NextRequest("http://localhost/api/macro/overview"))
    ).json();
    const liveUs10y = overviewLive.cards.find((c) => c.id === "us10y");
    assert.equal(liveUs10y.value, 4.35);
    assert.equal(liveUs10y.previous, 4.28);
    assert.equal(liveUs10y.meta.mode, "LIVE_API");
  });

  console.log(`\nALL ${results.length} ACCEPTANCE TESTS PASSED.`);
} finally {
  globalThis.fetch = origFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
