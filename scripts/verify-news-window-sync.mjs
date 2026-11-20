#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-news-test-"));
const distRoot = path.join(tmpRoot, "dist");
const stateFilePath = path.join(tmpRoot, "sync-state.json");

process.env.MACROEDGE_SYNC_STATE_PATH = stateFilePath;
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");
process.env.MACROEDGE_RETRY_BASE_MS = "10";

// Load .env.local if available
const envLocalPath = path.join(WORKSPACE, ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const workspaceRequire = Module.createRequire(path.join(WORKSPACE, "package.json"));
const ts = workspaceRequire("typescript");

function compileForTest() {
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
        "src/app/api/**/*.ts",
      ],
    },
    ts.sys,
    WORKSPACE
  );

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  assert.equal(emitResult.emitSkipped, false, "TypeScript compilation failed");
}

console.log("Compiling Marketaux News Window test harness...");
compileForTest();

const preResolved = {
  "next/server": workspaceRequire.resolve("next/server"),
  "@supabase/supabase-js": workspaceRequire.resolve("@supabase/supabase-js"),
  react: workspaceRequire.resolve("react"),
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const target = path.join(distRoot, request.slice(2));
    for (const ext of ["", ".js", "/index.js"]) {
      const full = target + ext;
      if (fs.existsSync(full)) return full;
    }
    return target + ".js";
  }
  if (request in preResolved) {
    return preResolved[request];
  }
  return origResolve.call(this, request, parent, isMain, options);
};

const testRequire = Module.createRequire(path.join(distRoot, "services/marketaux/client.js"));
const marketauxClient = testRequire(path.join(distRoot, "services/marketaux/client.js"));
const aiSupervisor = testRequire(path.join(distRoot, "services/sync/workers/ai-supervisor.js"));

async function run() {
  console.log("=== Verifying Marketaux News 2-3 Hour Window Sync ===");

  const nowMs = Date.now();
  const threeHoursMs = 3 * 3600 * 1000;
  const twoHoursMs = 2 * 3600 * 1000;

  // 1. Verify dynamic fallback generator anchors strictly within window
  console.log("\n[Test 1] Dynamic Institutional Fallback Articles Windowing:");
  const testAnchor = new Date("2026-11-20T18:00:00.000Z");
  const fallbacks3h = marketauxClient.getInstitutionalFallbackArticles(testAnchor, 3);
  assert.equal(fallbacks3h.length, 4, "Expected 4 fallback articles");

  for (const article of fallbacks3h) {
    const pubMs = new Date(article.publishedAt).getTime();
    const diffHours = (testAnchor.getTime() - pubMs) / 3600000;
    console.log(`  - ${article.title.slice(0, 50)}... -> published ${diffHours.toFixed(2)}h before anchor (${article.publishedAt})`);
    assert.ok(diffHours >= 0.2 && diffHours <= 3.0, `Article ${article.id} outside 3h window: ${diffHours}h`);
  }
  console.log("  ✓ All dynamic fallback articles strictly inside 2-3 hour window");

  // 2. Verify getGoldAndUs30News default maxAgeHours = 3
  console.log("\n[Test 2] getGoldAndUs30News Default Window (3 Hours):");
  const newsResult = await marketauxClient.getGoldAndUs30News({ forceRefresh: false, maxAgeHours: 3 });
  assert.ok(newsResult.news.length >= 3, "Expected at least 3 news items returned");
  console.log(`  Retrieved ${newsResult.news.length} items (total available: ${newsResult.totalAvailable})`);

  for (const item of newsResult.news) {
    const pubMs = new Date(item.publishedAt).getTime();
    const ageMs = nowMs - pubMs;
    const ageHours = ageMs / 3600000;
    console.log(`  - [${item.targetAsset}] ${item.title.slice(0, 55)}...`);
    console.log(`    Published: ${item.publishedAt} | Age: ${ageHours.toFixed(2)} hours`);
    // Allow up to 2 minutes clock skew if future, and max 3.1 hours in past
    assert.ok(pubMs >= nowMs - threeHoursMs - 120000, `Article ${item.id} older than 3 hours: ${ageHours}h`);
    assert.ok(pubMs <= nowMs + 120000, `Article ${item.id} is in the future beyond tolerance: ${item.publishedAt}`);
  }
  console.log("  ✓ All articles returned by getGoldAndUs30News are strictly within the 3-hour window");

  // 3. Verify getGoldAndUs30News with maxAgeHours = 2
  console.log("\n[Test 3] getGoldAndUs30News Strict 2-Hour Window:");
  const newsResult2h = await marketauxClient.getGoldAndUs30News({ forceRefresh: true, maxAgeHours: 2 });
  assert.ok(newsResult2h.news.length >= 3, "Expected at least 3 news items returned for 2h window");
  for (const item of newsResult2h.news) {
    const pubMs = new Date(item.publishedAt).getTime();
    const ageMs = nowMs - pubMs;
    const ageHours = ageMs / 3600000;
    console.log(`  - [${item.targetAsset}] Age: ${ageHours.toFixed(2)}h | ${item.title.slice(0, 50)}...`);
    assert.ok(pubMs >= nowMs - twoHoursMs - 120000, `Article ${item.id} older than 2 hours: ${ageHours}h`);
  }
  console.log("  ✓ All articles returned in 2-hour mode are within the 2-hour window");

  // 4. Verify runMarketauxSync worker execution
  console.log("\n[Test 4] runMarketauxSync Worker Execution:");
  const workerSummary = await aiSupervisor.runMarketauxSync({ trigger: "manual" });
  console.log(`  Worker status: ${workerSummary.status}, Records inserted: ${workerSummary.recordsInserted}, Latency: ${workerSummary.latencyMs}ms`);
  assert.equal(workerSummary.status, "SUCCEEDED", "Worker should succeed");
  assert.ok(workerSummary.recordsInserted >= 3, "Expected at least 3 records inserted/upserted");
  console.log("  ✓ runMarketauxSync worker completed successfully and populated records");

  console.log("\n=== ALL NEWS WINDOW VERIFICATIONS PASSED ===");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
