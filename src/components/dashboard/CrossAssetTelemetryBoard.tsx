"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, BarChart3, RefreshCw } from "lucide-react";
import type { MarketOverviewCardData } from "@/lib/types";
import { useMacroRealtime } from "@/lib/realtime/useMacroRealtime";
import { AutoSyncControl } from "@/components/dashboard/AutoSyncControl";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { useTerminal } from "@/components/providers/TerminalProvider";
import { cn, formatNumber } from "@/lib/utils";

interface CrossAssetTelemetryBoardProps {
  initialCards: MarketOverviewCardData[];
}

interface TelemetryItem {
  id: string;
  name: string;
  symbol: string;
  category: string;
  value: number | null | undefined;
  unit: string;
  change: number | null | undefined;
  deltaUnit: string;
  decimals: number;
  mode: string;
  statusLabel?: string;
  statusTone?: "bullish" | "bearish" | "neutral";
  lastUpdated?: string;
}

export function CrossAssetTelemetryBoard({
  initialCards,
}: CrossAssetTelemetryBoardProps) {
  const { prefs, updatePrefs } = useTerminal();

  const realtime = useMacroRealtime({
    fetchOnMount: true,
    pollIntervalMs: 5000,
    autoSyncPeriod: prefs.autoSyncPeriod,
  });

  const {
    marketQuotes,
    latestValues,
    isSyncing,
    isRefreshing,
    triggerSync,
    autoSyncPeriod,
    setAutoSyncPeriod,
    nextAutoSyncSec,
    lastAutoSyncedAt,
    overallStatus,
    connectionStatus,
  } = realtime;

  const telemetry = useMemo<TelemetryItem[]>(() => {
    // 1. Initial fallback maps
    const cardMap = new Map<string, MarketOverviewCardData>();
    for (const c of initialCards) {
      cardMap.set(c.id, c);
      cardMap.set(c.symbol.toUpperCase(), c);
    }

    const initUs10y = cardMap.get("us10y");
    const initUs02y = cardMap.get("us02y");
    const initDxy = cardMap.get("dxy");
    const initVix = cardMap.get("vix");
    const initGold = cardMap.get("xauusd");
    const initSpx = cardMap.get("spx");
    const initBtc = cardMap.get("btcusd");

    // 2. Resolve US 10Y Yield
    const q10y = marketQuotes["US10Y"];
    const lv10y = latestValues["US10Y"];
    const val10y =
      q10y?.price && q10y.price > 0
        ? q10y.price
        : lv10y?.value && lv10y.value > 0
        ? lv10y.value
        : initUs10y?.value ?? null;
    const prev10y = q10y?.previousClose ?? lv10y?.previousValue ?? initUs10y?.previous ?? null;
    const change10y =
      val10y !== null && prev10y !== null && Number.isFinite(val10y) && Number.isFinite(prev10y)
        ? Math.round((val10y - prev10y) * 100)
        : initUs10y?.change ?? null;

    // 3. Resolve US 2Y Yield
    const q2y = marketQuotes["US2Y"];
    const lv2y = latestValues["US2Y"];
    const val2y =
      q2y?.price && q2y.price > 0
        ? q2y.price
        : lv2y?.value && lv2y.value > 0
        ? lv2y.value
        : initUs02y?.value ?? null;
    const prev2y = q2y?.previousClose ?? lv2y?.previousValue ?? initUs02y?.previous ?? null;
    const change2y =
      val2y !== null && prev2y !== null && Number.isFinite(val2y) && Number.isFinite(prev2y)
        ? Math.round((val2y - prev2y) * 100)
        : initUs02y?.change ?? null;

    // 4. Calculate live 2s10s yield curve spread
    const curveSpreadBps =
      val10y !== null && val2y !== null && Number.isFinite(val10y) && Number.isFinite(val2y)
        ? Math.round((val10y - val2y) * 100)
        : null;

    // 5. Resolve DXY
    const qDxy = marketQuotes["DXY"];
    const valDxy = qDxy?.price && qDxy.price > 0 ? qDxy.price : initDxy?.value ?? null;
    const prevDxy = qDxy?.previousClose ?? initDxy?.previous ?? null;
    const changeDxy =
      qDxy?.changePct !== undefined && qDxy.changePct !== 0
        ? qDxy.changePct
        : valDxy !== null && prevDxy !== null && prevDxy !== 0
        ? Number((((valDxy - prevDxy) / prevDxy) * 100).toFixed(2))
        : initDxy?.changePercent ?? null;

    // 6. Resolve VIX
    const qVix = marketQuotes["VIX"];
    const lvVix = latestValues["VIX"] || latestValues["VIXCLS"];
    const valVix =
      qVix?.price && qVix.price > 0
        ? qVix.price
        : lvVix?.value && lvVix.value > 0
        ? lvVix.value
        : initVix?.value ?? null;
    const prevVix = qVix?.previousClose ?? lvVix?.previousValue ?? initVix?.previous ?? null;
    const changeVix =
      valVix !== null && prevVix !== null
        ? Number((valVix - prevVix).toFixed(2))
        : initVix?.change ?? null;

    // 7. Resolve Gold (XAUUSD)
    const qGold = marketQuotes["XAUUSD"];
    const valGold = qGold?.price && qGold.price > 0 ? qGold.price : initGold?.value ?? null;
    const prevGold = qGold?.previousClose ?? initGold?.previous ?? null;
    const changeGold =
      qGold?.changePct !== undefined && qGold.changePct !== 0
        ? qGold.changePct
        : valGold !== null && prevGold !== null && prevGold !== 0
        ? Number((((valGold - prevGold) / prevGold) * 100).toFixed(2))
        : initGold?.changePercent ?? null;

    // 8. Resolve US30 (Dow Jones Industrial Average)
    const qUs30 = marketQuotes["US30"];
    const valUs30 = qUs30?.price && qUs30.price > 0 ? qUs30.price : null;
    const prevUs30 = qUs30?.previousClose ?? null;
    const changeUs30 =
      qUs30?.changePct !== undefined && qUs30.changePct !== 0
        ? qUs30.changePct
        : valUs30 !== null && prevUs30 !== null && prevUs30 !== 0
        ? Number((((valUs30 - prevUs30) / prevUs30) * 100).toFixed(2))
        : null;

    // 9. Resolve SPX (S&P 500)
    const qSpx = marketQuotes["SPX500"] || marketQuotes["SPX"];
    const valSpx = qSpx?.price && qSpx.price > 0 ? qSpx.price : initSpx?.value ?? null;
    const prevSpx = qSpx?.previousClose ?? initSpx?.previous ?? null;
    const changeSpx =
      qSpx?.changePct !== undefined && qSpx.changePct !== 0
        ? qSpx.changePct
        : valSpx !== null && prevSpx !== null && prevSpx !== 0
        ? Number((((valSpx - prevSpx) / prevSpx) * 100).toFixed(2))
        : initSpx?.changePercent ?? null;

    // 10. Resolve Bitcoin (BTCUSD)
    const qBtc = marketQuotes["BTCUSD"];
    const valBtc = qBtc?.price && qBtc.price > 0 ? qBtc.price : initBtc?.value ?? null;
    const prevBtc = qBtc?.previousClose ?? initBtc?.previous ?? null;
    const changeBtc =
      qBtc?.changePct !== undefined && qBtc.changePct !== 0
        ? qBtc.changePct
        : valBtc !== null && prevBtc !== null && prevBtc !== 0
        ? Number((((valBtc - prevBtc) / prevBtc) * 100).toFixed(2))
        : initBtc?.changePercent ?? null;

    return [
      {
        id: "us10y",
        name: "US 10Y Yield",
        symbol: "US10Y",
        category: "Rates",
        value: val10y,
        unit: "%",
        change: change10y,
        deltaUnit: "bps",
        decimals: 2,
        mode: q10y?.status === "LIVE" ? "LIVE" : "DAILY",
        lastUpdated: q10y?.receivedAt,
      },
      {
        id: "us02y",
        name: "US 2Y Yield",
        symbol: "US02Y",
        category: "Rates",
        value: val2y,
        unit: "%",
        change: change2y,
        deltaUnit: "bps",
        decimals: 2,
        mode: q2y?.status === "LIVE" ? "LIVE" : "DAILY",
        lastUpdated: q2y?.receivedAt,
      },
      {
        id: "curve",
        name: "2s10s Curve Spread",
        symbol: "10Y-2Y",
        category: "Yield Curve",
        value: curveSpreadBps,
        unit: " bps",
        change: null,
        deltaUnit: "bps",
        decimals: 0,
        mode: "DERIVED",
        statusLabel:
          curveSpreadBps !== null
            ? curveSpreadBps >= 0
              ? "Normal Slope"
              : "Inverted"
            : "Awaiting Sync",
        statusTone:
          curveSpreadBps !== null
            ? curveSpreadBps >= 0
              ? "bullish"
              : "bearish"
            : "neutral",
      },
      {
        id: "dxy",
        name: "US Dollar Index",
        symbol: "DXY",
        category: "FX",
        value: valDxy,
        unit: "",
        change: changeDxy,
        deltaUnit: "%",
        decimals: 2,
        mode: qDxy?.status === "LIVE" ? "LIVE" : "DAILY",
        lastUpdated: qDxy?.receivedAt,
      },
      {
        id: "vix",
        name: "CBOE Volatility",
        symbol: "VIX",
        category: "Vol",
        value: valVix,
        unit: "",
        change: changeVix,
        deltaUnit: "",
        decimals: 2,
        mode: qVix?.status === "LIVE" ? "LIVE" : "DAILY",
        lastUpdated: qVix?.receivedAt,
      },
      {
        id: "xauusd",
        name: "Gold Spot",
        symbol: "XAUUSD",
        category: "Metals",
        value: valGold,
        unit: "$",
        change: changeGold,
        deltaUnit: "%",
        decimals: 2,
        mode: qGold?.status === "LIVE" ? "LIVE" : initGold?.meta.frequency ?? "LIVE",
        lastUpdated: qGold?.receivedAt,
      },
      {
        id: "us30",
        name: "Dow Jones 30",
        symbol: "US30",
        category: "Equities",
        value: valUs30,
        unit: "",
        change: changeUs30,
        deltaUnit: "%",
        decimals: 1,
        mode: qUs30?.status === "LIVE" ? "LIVE" : "LIVE",
        lastUpdated: qUs30?.receivedAt,
      },
      {
        id: "spx",
        name: "S&P 500 Index",
        symbol: "SPX",
        category: "Equities",
        value: valSpx,
        unit: "",
        change: changeSpx,
        deltaUnit: "%",
        decimals: 1,
        mode: qSpx?.status === "LIVE" ? "LIVE" : "EOD",
        lastUpdated: qSpx?.receivedAt,
      },
      {
        id: "btcusd",
        name: "Bitcoin Spot",
        symbol: "BTCUSD",
        category: "Crypto",
        value: valBtc,
        unit: "$",
        change: changeBtc,
        deltaUnit: "%",
        decimals: 0,
        mode: qBtc?.status === "LIVE" ? "LIVE" : "LIVE",
        lastUpdated: qBtc?.receivedAt,
      },
    ];
  }, [initialCards, marketQuotes, latestValues]);

  return (
    <section className="dashboard-panel terminal-card flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] lg:col-span-8">
      <div>
        {/* Header Bar with AutoSync and Status Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1C1C1C] pb-3">
          <div className="flex items-center gap-2">
            <span className="dashboard-icon rounded-md border border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold text-[#FFFFFF]">
                  Cross-Asset Telemetry Board
                </h2>
                <MarketStatusBadge
                  tone={
                    connectionStatus === "LIVE" || overallStatus === "CURRENT" || overallStatus === "LIVE"
                      ? "bullish"
                      : "neutral"
                  }
                  size="sm"
                  label={
                    connectionStatus === "LIVE"
                      ? "WS LIVE"
                      : overallStatus === "CURRENT" || overallStatus === "LIVE"
                      ? "SYNCED"
                      : isSyncing
                      ? "SYNCING"
                      : "AWAITING SYNC"
                  }
                />
              </div>
              <span className="font-mono-num text-[10.5px] text-[#6B6B6B]">
                Core Macro Anchors, Equities, Gold &amp; Yield Curve
              </span>
            </div>
          </div>

          {/* Sync Control & AutoSync Period Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <AutoSyncControl
              period={autoSyncPeriod}
              onChange={(next) => {
                setAutoSyncPeriod(next);
                void updatePrefs({ autoSyncPeriod: next });
              }}
              nextSec={nextAutoSyncSec}
              isSyncing={isSyncing}
            />

            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void triggerSync({ force: true })}
              title="Trigger immediate live data sync across all providers"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#141414] px-2.5 py-1.5 font-mono-num text-[11px] font-medium text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C] disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "h-3 w-3 text-[#FFFFFF]",
                  isSyncing || isRefreshing ? "animate-spin" : ""
                )}
              />
              <span className="hidden sm:inline">
                {isSyncing ? "Syncing..." : "Sync Now"}
              </span>
            </button>
          </div>
        </div>

        {/* Live Ticker Matrix */}
        <div className="dashboard-telemetry-grid mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {telemetry.map((item) => {
            const hasVal = item.value !== null && item.value !== undefined;
            const isPos = (item.change ?? 0) >= 0;

            return (
              <div
                key={item.id}
                className="dashboard-telemetry-card flex flex-col justify-between rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-3 transition-colors hover:border-[#2E2E2E] hover:bg-[#141414]"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono-num text-[11px] font-bold text-[#FFFFFF]">
                    {item.symbol}
                  </span>
                  <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1 py-0.5 font-mono-num text-[9.5px] font-semibold uppercase text-[#A3A3A3]">
                    {item.mode}
                  </span>
                </div>

                <div className="my-2">
                  <span className="font-mono-num text-[18px] font-bold tracking-tight text-[#FFFFFF]">
                    {hasVal
                      ? item.unit === "$"
                        ? `$${formatNumber(item.value!, item.decimals)}`
                        : item.unit === " bps"
                        ? `${item.value! > 0 ? "+" : ""}${item.value!} bps`
                        : item.unit === "%"
                        ? `${item.value!.toFixed(item.decimals)}%`
                        : item.value! >= 1000
                        ? formatNumber(item.value!, item.decimals)
                        : item.value!.toFixed(item.decimals)
                      : "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-1 border-t border-[#1C1C1C] pt-1.5 text-[10.5px]">
                  <span className="truncate text-[#6B6B6B]">{item.name}</span>
                  {item.statusLabel ? (
                    <span
                      className={cn(
                        "font-mono-num font-semibold",
                        item.statusTone === "bullish"
                          ? "text-[#22C55E]"
                          : item.statusTone === "bearish"
                          ? "text-[#EF4444]"
                          : "text-[#A3A3A3]"
                      )}
                    >
                      {item.statusLabel}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "font-mono-num font-semibold",
                        !hasVal || item.change === null || item.change === undefined
                          ? "text-[#6B6B6B]"
                          : isPos
                          ? "text-[#22C55E]"
                          : "text-[#EF4444]"
                      )}
                    >
                      {hasVal && item.change !== null && item.change !== undefined
                        ? `${isPos ? "+" : ""}${
                            item.deltaUnit === "bps"
                              ? `${item.change} bps`
                              : `${item.change.toFixed(2)}%`
                          }`
                        : "Awaiting Sync"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Telemetry Footer Bar */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#1C1C1C] pt-2.5 text-[11px]">
        <div className="flex items-center gap-2 text-[#6B6B6B]">
          <span>Providers: API Ninjas · yfinance · FRED</span>
          {lastAutoSyncedAt && (
            <>
              <span>·</span>
              <span className="font-mono-num text-[10.5px] text-[#A3A3A3]">
                Last synced {lastAutoSyncedAt.slice(11, 19)} UTC
              </span>
            </>
          )}
        </div>
        <Link
          href="/macrodashboard"
          className="inline-flex items-center gap-1 font-medium text-[#FFFFFF] hover:underline"
        >
          Inspect All Benchmarks
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}
