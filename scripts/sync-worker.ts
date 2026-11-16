import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  runScheduledOrchestratorTick,
  type DispatchSyncResult,
} from "../src/services/sync/orchestrator";
import {
  startMarketWebSocketDaemon,
  stopMarketWebSocketDaemon,
  type MarketWebSocketDaemon,
} from "../src/services/sync/workers/market-engine";
import { seedDataSourcesIfNeeded } from "../src/services/sync/store";
import {
  installWorkerProcessMonitors,
  recordWorkerSessionLifecycle,
  runDeterministicMonitorSweep,
} from "../src/services/incidents/debugger-engine";

export interface SyncWorkerRuntime {
  daemon: MarketWebSocketDaemon;
  stop: () => Promise<void>;
  runTick: () => Promise<DispatchSyncResult>;
}

const DEFAULT_SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Starts the persistent background synchronization runtime (Render Background Worker):
 * 1) Seeds data source definitions in persistence
 * 2) Starts MarketWebSocketDaemon (native WebSocket when configured, DISCONNECTED otherwise)
 * 3) Runs an initial orchestrator tick and schedules source-specific cadence checks
 */
export async function startSyncWorkerProcess(options?: {
  schedulerIntervalMs?: number;
  runInitialTick?: boolean;
}): Promise<SyncWorkerRuntime> {
  const detachCrashMonitors = installWorkerProcessMonitors("macroedge-sync-worker");
  await recordWorkerSessionLifecycle("macroedge-sync-worker", "started");
  await seedDataSourcesIfNeeded();

  const daemon = await startMarketWebSocketDaemon();
  let tickInFlight = false;

  const runTick = async (): Promise<DispatchSyncResult> => {
    if (tickInFlight) {
      const now = new Date().toISOString();
      return {
        ok: true,
        trigger: "scheduled",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        summaries: [],
        errors: [],
        skippedLocks: ["scheduler-interval-busy"],
      };
    }
    tickInFlight = true;
    try {
      const res = await runScheduledOrchestratorTick({ trigger: "scheduled" });
      await runDeterministicMonitorSweep({
        runDbProbe: true,
        autoRemediate: true,
        invokeAi: Boolean(process.env.GEMINI_API_KEY?.trim()),
        actor: "render-sync-worker",
      }).catch((sweepErr) => {
        console.error(
          "[MacroEdge SyncWorker] Agent 7 monitor sweep error:",
          sweepErr instanceof Error ? sweepErr.message : String(sweepErr)
        );
      });
      return res;
    } finally {
      tickInFlight = false;
    }
  };

  if (options?.runInitialTick !== false) {
    await runTick();
  }

  const envInterval =
    process.env.AUTOSYNC_INTERVAL_MS?.trim() ||
    process.env.SYNC_WORKER_INTERVAL_MS?.trim();
  const parsedEnv = envInterval ? Number(envInterval) : NaN;
  const intervalMs =
    options?.schedulerIntervalMs ??
    (Number.isFinite(parsedEnv) && parsedEnv > 0 ? parsedEnv : DEFAULT_SCHEDULER_INTERVAL_MS);

  console.info(
    `[MacroEdge SyncWorker] Autonomous sync scheduler loop configured: ${intervalMs}ms (${Math.round(
      intervalMs / 1000
    )}s period)`
  );

  const timer = setInterval(() => {
    void runTick().catch((err) => {
      console.error(
        "[MacroEdge SyncWorker] Scheduled tick error:",
        err instanceof Error ? err.message : String(err)
      );
    });
  }, intervalMs);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    detachCrashMonitors();
    await stopMarketWebSocketDaemon();
    await recordWorkerSessionLifecycle("macroedge-sync-worker", "stopped").catch(() => {});
  };

  return { daemon, stop, runTick };
}

async function runCliEntrypoint(): Promise<void> {
  console.info("[MacroEdge SyncWorker] Starting autonomous macro synchronization daemon...");
  const runtime = await startSyncWorkerProcess();
  console.info(
    `[MacroEdge SyncWorker] Active (WS state: ${runtime.daemon.getConnectionState()}).`
  );

  const shutdown = async (signal: string) => {
    console.info(`[MacroEdge SyncWorker] Received ${signal}, shutting down cleanly...`);
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

const isDirectExecution =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  void runCliEntrypoint().catch((err) => {
    console.error(
      "[MacroEdge SyncWorker] Fatal startup error:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  });
}
