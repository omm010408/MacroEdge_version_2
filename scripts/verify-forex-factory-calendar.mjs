#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

const WORKSPACE = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macroedge-ff-test-"));
const distRoot = path.join(tmpRoot, "dist");
const stateFilePath = path.join(tmpRoot, "sync-state.json");

process.env.MACROEDGE_SYNC_STATE_PATH = stateFilePath;
process.env.MACROEDGE_INCIDENT_STATE_PATH = path.join(tmpRoot, "incidents-state.json");
process.env.MACROEDGE_RETRY_BASE_MS = "10";

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

console.log("Compiling Forex Factory Calendar & Sync test harness...");
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

const testRequire = Module.createRequire(path.join(distRoot, "services/data/forex-factory.js"));
const forexFactory = testRequire(path.join(distRoot, "services/data/forex-factory.js"));
const marketEngine = testRequire(path.join(distRoot, "services/sync/workers/market-engine.js"));
const aiSupervisor = testRequire(path.join(distRoot, "services/sync/workers/ai-supervisor.js"));
const store = testRequire(path.join(distRoot, "services/sync/store.js"));

console.log("--- Testing Forex Factory Economic Calendar & Sync Additions ---");

// Test 1: Forex Factory docket generation and data schema
const docket = forexFactory.getInstitutionalForexFactoryDocket();
assert.ok(Array.isArray(docket) && docket.length >= 20, "Expected at least 20 docket events");
console.log(`[PASS] Test 1: Generated ${docket.length} Forex Factory events with rich schema`);

// Verify all required fields
for (const ev of docket) {
  assert.ok(ev.id, "Event must have id");
  assert.ok(ev.title, "Event must have title");
  assert.ok(ev.currency, "Event must have currency");
  assert.ok(ev.country, "Event must have country");
  assert.ok(ev.date, "Event must have date");
  assert.ok(ev.time, "Event must have time");
  assert.ok(["HIGH", "MEDIUM", "LOW", "NON_ECONOMIC"].includes(ev.impact), "Valid impact tier");
  assert.ok(typeof ev.forecast === "string", "Forecast is string");
  assert.ok(typeof ev.previous === "string", "Previous is string");
}
console.log("[PASS] Test 2: All events strictly adhere to Forex Factory docket schema");

// Test 3: Currency coverage across G10 and major economies
const currenciesInDocket = new Set(docket.map((e) => e.currency));
for (const curr of ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD"]) {
  assert.ok(currenciesInDocket.has(curr), `Docket must cover currency: ${curr}`);
}
console.log(`[PASS] Test 3: Multi-currency coverage verified for ${Array.from(currenciesInDocket).join(", ")}`);

// Test 4: Beat vs Miss polarity evaluation (including inverted metrics)
assert.equal(forexFactory.evaluateBetterThanExpected("2.8%", "2.5%", "GDP q/q"), true, "Higher GDP is better");
assert.equal(forexFactory.evaluateBetterThanExpected("2.2%", "2.5%", "GDP q/q"), false, "Lower GDP is miss");
assert.equal(forexFactory.evaluateBetterThanExpected("213K", "215K", "Unemployment Claims"), true, "Lower jobless claims is better (inverted)");
assert.equal(forexFactory.evaluateBetterThanExpected("220K", "215K", "Unemployment Claims"), false, "Higher jobless claims is miss (inverted)");
assert.equal(forexFactory.evaluateBetterThanExpected("4.1%", "4.0%", "Unemployment Rate"), false, "Higher unemployment is miss (inverted)");
assert.equal(forexFactory.evaluateBetterThanExpected("3.9%", "4.0%", "Unemployment Rate"), true, "Lower unemployment is beat (inverted)");
assert.equal(forexFactory.evaluateBetterThanExpected("—", "2.0%", "Event"), null, "Missing actual returns null");
assert.equal(forexFactory.evaluateBetterThanExpected("2.5%", "2.5%", "GDP q/q"), null, "Equal values return null");
console.log("[PASS] Test 4: Better-than-expected calculation verified for normal and inverted indicators");

// Test 5: CSV & JSON Exporters matching fizahkhalid/forex_factory_calendar_news_scraper
const csv = forexFactory.exportForexFactoryCsv(docket.slice(0, 5));
assert.ok(csv.includes("Date (UTC)"), "CSV has header");
assert.ok(csv.includes("Currency"), "CSV has currency column");
assert.ok(csv.includes("Impact"), "CSV has impact column");
assert.ok(csv.includes("USD") || csv.includes("EUR") || csv.includes("GBP"), "CSV includes currencies");

const jsonStr = forexFactory.exportForexFactoryJson(docket.slice(0, 3));
const parsedJson = JSON.parse(jsonStr);
assert.equal(parsedJson.length, 3);
assert.equal(parsedJson[0].title, docket[0].title);
console.log("[PASS] Test 5: Export to CSV and JSON matches Forex Factory scraper output format");

// Test 6: Compatibility conversion to EconomicCalendarEvent
const legacyEv = forexFactory.toEconomicCalendarEvent(docket[0]);
assert.ok(legacyEv.id);
assert.ok(legacyEv.event);
assert.ok(legacyEv.country);
assert.ok(legacyEv.importance);
assert.ok(legacyEv.currency);
console.log("[PASS] Test 6: Seamless backwards compatibility with EconomicCalendarEvent");

// Test 7: Verify yfinance and marketaux sync & database additions
console.log("\n--- Testing Sync & Database Additions for yfinance and marketaux ---");

// Sync yfinance
const yfSummary = await marketEngine.runMarketEngineCycle({ trigger: "manual", providerId: "yfinance" });
assert.equal(yfSummary.status, "SUCCEEDED", "yfinance sync must succeed");
assert.ok(yfSummary.recordsUpdated + yfSummary.recordsInserted >= 10, "Expected at least 10 yfinance quotes updated/inserted");

const quotes = await store.getMarketQuotes();
const yfQuotes = quotes.filter((q) => q.sourceId === "yfinance");
assert.ok(yfQuotes.length >= 10, "Expected yfinance quotes in store");
console.log(`[PASS] Test 7: yfinance synced and updated ${yfQuotes.length} market quotes in database store`);

// Sync marketaux and verify database insertion into macro_insights
const mxSummary = await aiSupervisor.runMarketauxSync({ trigger: "manual" });
assert.equal(mxSummary.status, "SUCCEEDED", "marketaux sync must succeed");
assert.ok(mxSummary.recordsInserted >= 1, "Expected marketaux to insert records into database");

const health = await store.listDataHealth();
const mxHealth = health.find((h) => h.id === "source:marketaux");
assert.ok(mxHealth, "source:marketaux health record must exist");
assert.equal(mxHealth.status, "CURRENT", "source:marketaux health must be CURRENT");
assert.ok(mxHealth.lastSuccessAt, "source:marketaux must have fresh lastSuccessAt");

const yfHealth = health.find((h) => h.id === "source:yfinance");
assert.ok(yfHealth, "source:yfinance health record must exist");
assert.equal(yfHealth.status, "CURRENT", "source:yfinance health must be CURRENT");
assert.ok(yfHealth.lastSuccessAt, "source:yfinance must have fresh lastSuccessAt");

const insights = await store.listMacroInsights(undefined, 20);
const mxInsights = insights.filter((i) => i.modelId === "marketaux-feed");
assert.ok(mxInsights.length >= 1, "Expected persisted marketaux macro_insights rows in database store");
console.log(`[PASS] Test 8: marketaux synced and added ${mxInsights.length} news insights to database store`);
console.log(`[PASS] Test 9: Data health verified CURRENT for both source:yfinance and source:marketaux`);

console.log("\nALL FOREX FACTORY CALENDAR & SYNC ENGINE TESTS PASSED SUCCESSFULLY.");

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  // Non-fatal
}
