"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Flame,
  Newspaper,
  Play,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AiModelsSnapshot } from "@/lib/ai-models/types";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

type ModelTab = "model1" | "model2" | "model3" | "model4";

function biasTone(bias: string) {
  if (bias === "BULLISH") {
    return {
      text: "text-[#00C985]",
      bg: "bg-[#00C985]/12",
      border: "border-[#00C985]/35",
      pill: "bg-[#00C985] text-[#050608]",
    };
  }
  if (bias === "BEARISH") {
    return {
      text: "text-[#E5485D]",
      bg: "bg-[#E5485D]/12",
      border: "border-[#E5485D]/35",
      pill: "bg-[#E5485D] text-white",
    };
  }
  return {
    text: "text-[#D9B45C]",
    bg: "bg-[#D9B45C]/12",
    border: "border-[#D9B45C]/35",
    pill: "bg-[#D9B45C] text-[#050608]",
  };
}

export function AiBiasEngineView({
  initialSnapshot,
}: {
  initialSnapshot: AiModelsSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<AiModelsSnapshot | null>(initialSnapshot);
  const [selectedAsset, setSelectedAsset] = useState<"XAUUSD" | "US30">(
    initialSnapshot?.target_asset ??
      (initialSnapshot?.model4_macro_regime_bias?.primary_asset === "US30" ? "US30" : "XAUUSD")
  );
  const [activeTab, setActiveTab] = useState<ModelTab>("model1");
  const [eventType, setEventType] = useState<string>(
    initialSnapshot?.scenario_inputs?.event_type ?? "CPI"
  );
  const [useAutoSurprise, setUseAutoSurprise] = useState<boolean>(true);
  const [manualSurpriseZ, setManualSurpriseZ] = useState<number>(
    initialSnapshot?.model3_market_reaction?.input_surprise_z ?? 0
  );
  const [customNewsText, setCustomNewsText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const newsParam = params.get("news");
      if (newsParam) {
        setCustomNewsText(decodeURIComponent(newsParam));
      }
      const assetParam = params.get("asset")?.toUpperCase();
      if (assetParam === "US30" || assetParam === "XAUUSD") {
        setSelectedAsset(assetParam);
      }
    }
  }, []);

  // Auto-load snapshot if missing on initial render
  useEffect(() => {
    if (!snapshot || !snapshot.model4_macro_regime_bias) {
      void runSimulation(false, selectedAsset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSimulation(refreshData = false, asset = selectedAsset) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-models/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_asset: asset,
          event_type: eventType,
          surprise_z: useAutoSurprise ? null : manualSurpriseZ,
          custom_news_text: customNewsText.trim(),
          refresh_data: refreshData,
          use_finbert: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Inference request failed.");
      }
      setSnapshot(json.snapshot);
      if (useAutoSurprise && json.snapshot?.model3_market_reaction) {
        setManualSurpriseZ(json.snapshot.model3_market_reaction.input_surprise_z);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run inference.");
    } finally {
      setLoading(false);
    }
  }

  const m1 = snapshot?.model1_economic_forecast;
  const m2 = snapshot?.model2_news_intelligence;

  const m4 = useMemo(() => {
    if (!snapshot) return null;
    if (selectedAsset === "US30" && snapshot.us30_model4) {
      return snapshot.us30_model4;
    }
    if (selectedAsset === "XAUUSD" && snapshot.xauusd_model4) {
      return snapshot.xauusd_model4;
    }
    return snapshot.model4_macro_regime_bias;
  }, [snapshot, selectedAsset]);

  const m3 = useMemo(() => {
    if (!snapshot) return null;
    if (selectedAsset === "US30" && snapshot.us30_model3) {
      return snapshot.us30_model3;
    }
    if (selectedAsset === "XAUUSD" && snapshot.xauusd_model3) {
      return snapshot.xauusd_model3;
    }
    return snapshot.model3_market_reaction;
  }, [snapshot, selectedAsset]);

  const horizonChartData = useMemo(() => {
    if (!m3) return [];
    return (["5m", "30m", "4h", "1d"] as const)
      .map((h) => {
        const row = m3.horizons[h];
        if (row.expected_return_pct === null) return null;
        return {
          horizon: h.toUpperCase(),
          expectedPct: row.expected_return_pct,
          p10: row.distribution_pct.p10 ?? 0,
          p90: row.distribution_pct.p90 ?? 0,
          probUp: row.prob_up !== null ? Math.round(row.prob_up * 100) : 0,
          probDown: row.prob_down !== null ? Math.round(row.prob_down * 100) : 0,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [m3]);

  const componentChartData = useMemo(() => {
    if (!m4) return [];
    const c = m4.component_scores;
    return [
      { name: "Macro Rules", score: c.transparent_macro_rules },
      { name: "Regime ML", score: c.statistical_regime_ml },
      { name: "M1 Econ", score: c.model1_economic_surprise },
      { name: "M2 News", score: c.model2_news_intelligence },
      { name: "M3 Reaction", score: c.model3_market_reaction },
    ];
  }, [m4]);

  if (loading && (!snapshot || !m4)) {
    return (
      <div className="space-y-6 p-6">
        <Breadcrumbs />
        <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-12 text-center">
          <RefreshCw className="mx-auto mb-3 h-8 w-8 text-[#FFFFFF] animate-spin" />
          <h2 className="text-lg font-semibold text-white">
            Calibrating MacroEdge 4-Model AI Engine
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[#9299A3]">
            Synthesizing point-in-time FRED indicators, central bank sentiment, and live {selectedAsset} market reaction distributions...
          </p>
        </div>
      </div>
    );
  }

  if (!snapshot || !m4 || !m1 || !m2 || !m3) {
    return (
      <div className="space-y-6 p-6">
        <Breadcrumbs />
        <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-8 text-center">
          <BrainCircuit className="mx-auto mb-3 h-8 w-8 text-[#FFFFFF]" />
          <h2 className="text-lg font-semibold text-white">
            AI Bias & Macro Intelligence Engine
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[#9299A3]">
            Click below to run live 4-model inference across FRED macro series, FinBERT news intelligence, and {selectedAsset} reaction models.
          </p>
          {error && (
            <div className="mx-auto mt-3 max-w-lg rounded-lg border border-[#E5485D]/20 bg-[#E5485D]/10 p-3 text-left">
              <p className="text-xs font-semibold text-[#E5485D]">Inference Notice</p>
              <pre className="mt-1 max-h-32 overflow-auto font-mono text-[11px] text-[#E5485D]/90 whitespace-pre-wrap">
                {error}
              </pre>
            </div>
          )}
          <button
            onClick={() => runSimulation(false, selectedAsset)}
            disabled={loading}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#FFFFFF] px-4 py-2 text-xs font-semibold text-[#050608] hover:bg-[#E2E6EC] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {loading ? "Running Models..." : "Run 4-Model Inference"}
          </button>
        </div>
      </div>
    );
  }

  const tone = biasTone(m4.bias);

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Breadcrumbs />
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
            <BrainCircuit className="h-5 w-5 text-[#FFFFFF]" />
            MacroEdge 4-Model AI Bias & Reaction Engine
          </h1>
          <p className="text-xs text-[#9299A3]">
            Trained on historical FRED releases, FinBERT/Gemini central-bank intelligence, and real {selectedAsset} macroeconomic reaction models.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Institutional Asset Selector: Gold (XAUUSD) vs Dow Jones (US30) */}
          <div className="flex items-center rounded-lg border border-white/[0.12] bg-[#0E1218] p-1">
            <button
              type="button"
              onClick={() => setSelectedAsset("XAUUSD")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                selectedAsset === "XAUUSD"
                  ? "bg-[#D9B45C] text-[#050608] shadow-sm"
                  : "text-[#9299A3] hover:text-white"
              )}
            >
              <span className="h-2 w-2 rounded-full bg-[#D9B45C] ring-2 ring-[#D9B45C]/30" />
              XAUUSD (Gold)
            </button>
            <button
              type="button"
              onClick={() => setSelectedAsset("US30")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                selectedAsset === "US30"
                  ? "bg-[#3B82F6] text-white shadow-sm"
                  : "text-[#9299A3] hover:text-white"
              )}
            >
              <span className="h-2 w-2 rounded-full bg-[#3B82F6] ring-2 ring-[#3B82F6]/30" />
              US30 (Dow Jones 30)
            </button>
          </div>

          <span className="rounded border border-white/[0.08] bg-[#0E1218] px-2.5 py-1 font-mono-num text-[11px] text-[#9299A3]">
            As of {m4.as_of_date} · {m4.primary_asset}{" "}
            {m4.primary_asset === "US30"
              ? `${(m4.spot_us30 ?? m4.spot_price ?? 43450).toLocaleString()} pts`
              : `$${m4.spot_xauusd.toLocaleString()}`}
          </span>
          <button
            onClick={() => runSimulation(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#12161B] px-3 py-1.5 text-xs font-medium text-white hover:border-[#FFFFFF]/50 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#FFFFFF]", loading && "animate-spin")} />
            {loading ? "Updating..." : "Sync Live Data & Re-Score"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[#E5485D]/40 bg-[#E5485D]/10 px-4 py-2.5 text-xs text-[#E5485D]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* MODEL 4 HERO SUMMARY */}
      <div className={cn("rounded-xl border p-5 bg-[#0A0D12]", tone.border)}>
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-5">
            <div className="flex items-center gap-2">
              <span className="font-mono-num text-[11px] uppercase tracking-wider text-[#FFFFFF]">
                Model 4 · Macro Regime + Bias Engine
              </span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide", tone.pill)}>
                {m4.primary_asset} {m4.bias}
              </span>
            </div>

            <div className="flex items-baseline gap-4">
              <span className={cn("font-mono-num text-4xl font-bold tracking-tight", tone.text)}>
                {m4.bias_score > 0 ? `+${m4.bias_score}` : m4.bias_score}
              </span>
              <div className="text-xs text-[#9299A3]">
                <div>Composite Score (-100 to +100)</div>
                <div className="font-mono-num text-white">
                  Confidence {m4.confidence_pct}% · Uncertainty {(m4.uncertainty * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.07] bg-[#0E1218] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9299A3]">Detected Macro Regime (GMM)</span>
                <span className="font-semibold text-white">{m4.regime.dominant_regime}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {Object.entries(m4.regime.probabilities).map(([name, prob]) => (
                  <div key={name} className="space-y-0.5">
                    <div className="flex justify-between text-[11px] text-[#9299A3]">
                      <span>{name}</span>
                      <span className="font-mono-num text-white">{(prob * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-[#FFFFFF]"
                        style={{ width: `${Math.round(prob * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Component Score Attribution Chart */}
          <div className="lg:col-span-4 rounded-lg border border-white/[0.07] bg-[#0E1218] p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-white">Sub-Model Attribution (-100..+100)</span>
              <span className="font-mono-num text-[11px] text-[#9299A3]">
                ML 4w P(Up): {(m4.component_scores.ml_prob_up_4w * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={componentChartData} layout="vertical" margin={{ left: 8, right: 14, top: 6, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" domain={[-100, 100]} tick={{ fill: "#9299A3", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={76} tick={{ fill: "#D0D5DD", fontSize: 11 }} />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0A0D12", borderColor: "rgba(255,255,255,0.12)", fontSize: 12 }}
                  />
                  <Bar dataKey="score" radius={[3, 3, 3, 3]}>
                    {componentChartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.score >= 0 ? "#00C985" : "#E5485D"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cross-Asset Biases & Triggers */}
          <div className="space-y-3 lg:col-span-3">
            <div className="rounded-lg border border-white/[0.07] bg-[#0E1218] p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#9299A3]">
                Cross-Asset Bias Context
              </div>
              <div className="space-y-1.5">
                {Object.entries(m4.cross_asset_biases).map(([sym, item]) => {
                  const t = biasTone(item.bias);
                  const isSelected = sym === selectedAsset;
                  const isClickable = sym === "XAUUSD" || sym === "US30";
                  return (
                    <button
                      key={sym}
                      type="button"
                      disabled={!isClickable}
                      onClick={() => {
                        if (isClickable) setSelectedAsset(sym as "XAUUSD" | "US30");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors text-left",
                        isSelected
                          ? "border border-white/[0.2] bg-white/[0.08]"
                          : isClickable
                          ? "hover:bg-white/[0.04]"
                          : "opacity-80"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-mono-num font-semibold text-white">
                        {isSelected && (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              sym === "US30" ? "bg-[#3B82F6]" : "bg-[#D9B45C]"
                            )}
                          />
                        )}
                        <span>{sym}</span>
                        {isClickable && (
                          <span className="text-[10px] text-[#9299A3]">
                            {sym === "US30" ? "Dow" : "Gold"}
                          </span>
                        )}
                      </div>
                      <span className={cn("rounded px-2 py-0.5 font-mono-num text-[11px] font-semibold", t.bg, t.text)}>
                        {item.bias} ({item.score > 0 ? `+${item.score}` : item.score})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.07] bg-[#0E1218] p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[#9299A3]">
                <ShieldAlert className="h-3.5 w-3.5 text-[#D9B45C]" />
                Bias Invalidation Triggers
              </div>
              <div className="space-y-1.5">
                {m4.invalidation_triggers.map((tr) => (
                  <div key={tr.trigger} className="text-[11px] leading-snug text-[#D0D5DD]">
                    <span className="font-semibold text-white">{tr.trigger}:</span> {tr.condition}{" "}
                    <span className="font-mono-num text-[#9299A3]">({tr.current})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE SCENARIO & NEWS SIMULATOR */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
            Live Catalyst & News Intelligence Simulator (Models 2 → 3 → 4)
          </div>
          <div className="text-[11px] text-[#9299A3]">
            FinBERT: {m2.finbert_active ? "Active (ProsusAI/finbert)" : "Macro NLP Fallback"} · Gemini API:{" "}
            {m2.gemini_active ? "Connected" : "Unconfigured (Local FinBERT + NLP Active)"}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="mb-1 block text-[11px] text-[#9299A3]">Catalyst Event</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-[#0E1218] px-2.5 py-2 text-xs text-white"
            >
              <option value="CPI">CPI</option>
              <option value="CORE_CPI">Core CPI</option>
              <option value="PCE">PCE</option>
              <option value="CORE_PCE">Core PCE</option>
              <option value="NFP">NFP</option>
              <option value="FOMC">FOMC</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#9299A3]">
                Surprise Z-Score:{" "}
                <span className="font-mono-num text-white">
                  {useAutoSurprise ? `Auto (${m3.input_surprise_z}σ)` : `${manualSurpriseZ.toFixed(2)}σ`}
                </span>
              </span>
              <label className="flex cursor-pointer items-center gap-1 text-[#FFFFFF]">
                <input
                  type="checkbox"
                  checked={useAutoSurprise}
                  onChange={(e) => setUseAutoSurprise(e.target.checked)}
                />
                Use Model 1
              </label>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              disabled={useAutoSurprise}
              value={manualSurpriseZ}
              onChange={(e) => setManualSurpriseZ(Number(e.target.value))}
              className="mt-2 w-full accent-[#FFFFFF] disabled:opacity-40"
            />
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-[11px] text-[#9299A3]">
              Inject News / Central-Bank Speech / Print (Optional)
            </label>
            <input
              type="text"
              value={customNewsText}
              onChange={(e) => setCustomNewsText(e.target.value)}
              placeholder="e.g., Core CPI cools to 0.1% MoM; Fed signals rate cuts ahead..."
              className="w-full rounded-lg border border-white/[0.1] bg-[#0E1218] px-3 py-2 text-xs text-white placeholder:text-[#636B78]"
            />
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              onClick={() => runSimulation(false)}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#FFFFFF] px-3 py-2 text-xs font-semibold text-[#050608] hover:bg-[#E2E6EC] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {loading ? "Running..." : "Run Inference"}
            </button>
          </div>
        </div>
      </div>

      {/* MODEL TABS */}
      <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-2">
        {[
          { id: "model1", label: "Model 1 · Economic Forecast", icon: Flame },
          { id: "model2", label: "Model 2 · News Intelligence", icon: Newspaper },
          { id: "model3", label: `Model 3 · Market Reaction (${selectedAsset})`, icon: Activity },
          { id: "model4", label: `Model 4 · Evidence & Backtest (${selectedAsset})`, icon: BrainCircuit },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ModelTab)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-[#FFFFFF]/15 text-[#FFFFFF] border border-[#FFFFFF]/40"
                  : "text-[#9299A3] hover:text-white border border-transparent"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: MODEL 1 ECONOMIC FORECAST */}
      {activeTab === "model1" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0A0D12]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.08] bg-[#0E1218] text-[11px] uppercase tracking-wider text-[#9299A3]">
                <tr>
                  <th className="px-4 py-3">Indicator</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Last Actual</th>
                  <th className="px-4 py-3">Model Forecast</th>
                  <th className="px-4 py-3">Consensus</th>
                  <th className="px-4 py-3">Surprise (Z)</th>
                  <th className="px-4 py-3">P(&gt; Cons)</th>
                  <th className="px-4 py-3">p10 – p90 Band</th>
                  <th className="px-4 py-3">OOF MAE (36m)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {Object.values(m1.forecasts).map((item) => {
                  const hot = item.expected_surprise > 0;
                  return (
                    <tr key={item.indicator} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-white">
                        <div>{item.label}</div>
                        <div className="font-mono-num text-[10px] text-[#9299A3]">
                          FRED · {item.fred_series}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[#9299A3]">{item.target_period}</td>
                      <td className="px-4 py-3 font-mono-num text-white">
                        {item.last_actual} {item.unit}
                        {item.last_actual_yoy !== null && (
                          <div className="text-[10px] text-[#9299A3]">{item.last_actual_yoy}% YoY</div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono-num font-semibold text-[#FFFFFF]">
                        {item.forecast} {item.unit}
                        {item.implied_yoy !== null && (
                          <div className="text-[10px] text-[#9299A3]">Impl {item.implied_yoy}% YoY</div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[#D0D5DD]">
                        {item.consensus} {item.unit}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 font-mono-num font-semibold",
                          hot ? "text-[#E5485D]" : "text-[#00C985]"
                        )}
                      >
                        {item.expected_surprise > 0 ? `+${item.expected_surprise}` : item.expected_surprise}{" "}
                        ({item.surprise_zscore > 0 ? `+${item.surprise_zscore}` : item.surprise_zscore}σ)
                      </td>
                      <td className="px-4 py-3 font-mono-num text-white">
                        {(item.prob_above_consensus * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[#D0D5DD]">
                        [{item.distribution.p10}, {item.distribution.p90}]
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[#9299A3]">
                        {item.metrics.mae_36m}
                        <div className="text-[10px]">
                          DirAcc {(item.metrics.beat_consensus_dir_acc_36m * 100).toFixed(0)}% · 80%Cov{" "}
                          {(item.metrics.interval_80_coverage * 100).toFixed(0)}%
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {Object.values(m1.forecasts).slice(0, 3).map((item) => (
              <div key={item.indicator} className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
                <div className="text-xs font-semibold text-white">{item.label} · Top XGBoost Drivers</div>
                <div className="mt-2 space-y-1.5">
                  {item.top_features.map((f) => (
                    <div key={f.feature} className="flex items-center justify-between text-[11px]">
                      <span className="font-mono-num text-[#D0D5DD]">{f.feature}</span>
                      <span className="font-mono-num text-[#FFFFFF]">{(f.importance * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: MODEL 2 NEWS INTELLIGENCE */}
      {activeTab === "model2" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              {
                label: "Monetary Policy",
                val: m2.aggregate.policy_label,
                score: m2.aggregate.policy_hawkish_score,
                color: m2.aggregate.policy_hawkish_score > 0 ? "text-[#E5485D]" : "text-[#00C985]",
              },
              {
                label: "Inflation Signal",
                val: m2.aggregate.inflation_label,
                score: m2.aggregate.inflation_pressure_score,
                color: m2.aggregate.inflation_pressure_score > 0 ? "text-[#E5485D]" : "text-[#00C985]",
              },
              {
                label: "Growth Signal",
                val: m2.aggregate.growth_label,
                score: m2.aggregate.growth_momentum_score,
                color: m2.aggregate.growth_momentum_score > 0 ? "text-[#00C985]" : "text-[#E5485D]",
              },
              {
                label: "Text Uncertainty",
                val: `${(m2.aggregate.uncertainty * 100).toFixed(0)}%`,
                score: m2.aggregate.uncertainty,
                color: "text-[#D9B45C]",
              },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#9299A3]">{card.label}</div>
                <div className={cn("mt-1 font-mono-num text-xl font-bold", card.color)}>{card.val}</div>
                <div className="mt-1 font-mono-num text-[11px] text-[#9299A3]">
                  Score: {card.score > 0 ? `+${card.score}` : card.score}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4 lg:col-span-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                Affected Market Transmission Channels
              </div>
              <div className="space-y-2.5">
                {m2.affected_channels.map((ch) => (
                  <div key={ch.channel} className="rounded-lg border border-white/[0.06] bg-[#0E1218] p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">{ch.channel}</span>
                      <span className="font-mono-num text-[11px] text-[#FFFFFF]">{ch.direction}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#9299A3]">{ch.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4 lg:col-span-7">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                Extracted Evidence ({m2.items_analyzed} Fed Releases / Speeches / Inputs)
              </div>
              <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                {m2.evidence_items.map((ev, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.06] bg-[#0E1218] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-[#FFFFFF]/15 px-2 py-0.5 font-mono-num text-[10px] text-[#FFFFFF]">
                        {ev.topic} ({Math.round(ev.topic_confidence * 100)}%)
                      </span>
                      <span className="font-mono-num text-[10px] text-[#9299A3]">
                        {ev.source} · Policy {ev.implications.monetary_policy.stance} · Unc{" "}
                        {(ev.uncertainty * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs font-medium text-white">{ev.title}</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-[#D0D5DD]">
                      {ev.extracted_new_info.map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MODEL 3 MARKET REACTION */}
      {activeTab === "model3" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {(["5m", "30m", "4h", "1d"] as const).map((h) => {
              const row = m3.horizons[h];
              const t = biasTone(row.direction);
              return (
                <div key={h} className={cn("rounded-xl border bg-[#0A0D12] p-4", t.border)}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono-num text-sm font-bold text-white">{h.toUpperCase()} Horizon</span>
                    <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold", t.pill)}>
                      {row.direction}
                    </span>
                  </div>
                  <div className={cn("mt-2 font-mono-num text-2xl font-bold", t.text)}>
                    {row.expected_return_pct !== null ? (row.expected_return_pct > 0 ? `+${row.expected_return_pct}%` : `${row.expected_return_pct}%`) : "—"}
                  </div>
                  <div className="font-mono-num text-xs text-[#9299A3]">
                    Est. Move: {row.expected_usd_move !== null ? (row.expected_usd_move > 0 ? `+${row.expected_usd_move}` : `${row.expected_usd_move}`) : "—"} {selectedAsset === "US30" ? "pts" : "/oz"}
                  </div>
                  <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#00C985]">P(Up)</span>
                      <span className="font-mono-num text-white">{row.prob_up !== null ? `${(row.prob_up * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#9299A3]">P(Flat)</span>
                      <span className="font-mono-num text-white">{row.prob_flat !== null ? `${(row.prob_flat * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#E5485D]">P(Down)</span>
                      <span className="font-mono-num text-white">{row.prob_down !== null ? `${(row.prob_down * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                    <div className="flex justify-between pt-1 text-[#9299A3]">
                      <span>p10 / p90</span>
                      <span className="font-mono-num">
                        {row.distribution_pct.p10 ?? 0}% / {row.distribution_pct.p90 ?? 0}%
                      </span>
                    </div>
                    <div className="flex justify-between text-[#9299A3]">
                      <span>OOF Dir Acc</span>
                      <span className="font-mono-num text-white">
                        {row.metrics.oof_up_down_accuracy !== undefined ? `${(row.metrics.oof_up_down_accuracy * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#636B78]">
                      Real obs: {row.metrics.exact_intraday_observed_events} / {row.metrics.total_events} events
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4 lg:col-span-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                Expected {selectedAsset} Return (%) Across Horizons ({m3.event_type}, {m3.input_surprise_z}σ)
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={horizonChartData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="horizon" tick={{ fill: "#D0D5DD", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#9299A3", fontSize: 11 }} unit="%" />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0A0D12", borderColor: "rgba(255,255,255,0.12)", fontSize: 12 }}
                    />
                    <Bar dataKey="expectedPct" name="Expected Return %" radius={[4, 4, 0, 0]}>
                      {horizonChartData.map((d, idx) => (
                        <Cell key={idx} fill={d.expectedPct >= 0 ? "#00C985" : "#E5485D"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4 lg:col-span-7">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                Top 5 Historical Analogous Macro Releases (Cosine Similarity)
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-[11px] uppercase text-[#9299A3]">
                  <tr>
                    <th className="py-2">Event Date</th>
                    <th className="py-2">Catalyst</th>
                    <th className="py-2">Surprise Z</th>
                    <th className="py-2">Real 10Y</th>
                    <th className="py-2">VIX</th>
                    <th className="py-2">Actual {selectedAsset === "US30" ? "US30 1D" : "XAU 1D"}</th>
                    <th className="py-2">Sim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {m3.historical_analogs.map((a) => (
                    <tr key={`${a.event_date}-${a.event_type}`}>
                      <td className="py-2 font-mono-num text-white">{a.event_date}</td>
                      <td className="py-2 font-mono-num text-[#FFFFFF]">{a.event_type}</td>
                      <td className="py-2 font-mono-num text-[#D0D5DD]">{a.surprise_z}σ</td>
                      <td className="py-2 font-mono-num text-[#9299A3]">
                        {a.real10y_level !== null ? `${a.real10y_level}%` : "—"}
                      </td>
                      <td className="py-2 font-mono-num text-[#9299A3]">{a.vix_level ?? "—"}</td>
                      <td
                        className={cn(
                          "py-2 font-mono-num font-semibold",
                          a.xau_ret_1d_pct >= 0 ? "text-[#00C985]" : "text-[#E5485D]"
                        )}
                      >
                        {a.xau_ret_1d_pct > 0 ? `+${a.xau_ret_1d_pct}%` : `${a.xau_ret_1d_pct}%`}
                      </td>
                      <td className="py-2 font-mono-num text-[#D0D5DD]">{a.similarity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MODEL 4 EVIDENCE & BACKTEST */}
      {activeTab === "model4" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
              <div className="text-[11px] uppercase text-[#9299A3]">OOF 4w Accuracy / AUC</div>
              <div className="mt-1 font-mono-num text-xl font-bold text-white">
                {(m4.metrics.oof_4w_directional_accuracy * 100).toFixed(1)}%
              </div>
              <div className="font-mono-num text-xs text-[#FFFFFF]">
                ROC-AUC: {m4.metrics.oof_4w_roc_auc} ({m4.metrics.oof_weeks} wks)
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
              <div className="text-[11px] uppercase text-[#9299A3]">OOF Strategy Sharpe</div>
              <div className="mt-1 font-mono-num text-xl font-bold text-[#00C985]">
                {m4.metrics.oof_strategy_sharpe}
              </div>
              <div className="font-mono-num text-xs text-[#9299A3]">
                Buy &amp; Hold Sharpe: {m4.metrics.oof_buy_hold_sharpe}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
              <div className="text-[11px] uppercase text-[#9299A3]">OOF Cumulative Return</div>
              <div className="mt-1 font-mono-num text-xl font-bold text-white">
                {m4.metrics.oof_strategy_cum_return_pct}%
              </div>
              <div className="font-mono-num text-xs text-[#9299A3]">
                Buy &amp; Hold: {m4.metrics.oof_buy_hold_cum_return_pct}%
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4">
              <div className="text-[11px] uppercase text-[#9299A3]">Uncertainty Decomposition</div>
              <div className="mt-1 space-y-0.5 font-mono-num text-xs text-[#D0D5DD]">
                <div>Disagreement: {(m4.uncertainty_breakdown.cross_model_disagreement * 100).toFixed(0)}%</div>
                <div>News Ambiguity: {(m4.uncertainty_breakdown.news_ambiguity * 100).toFixed(0)}%</div>
                <div>Regime Entropy: {(m4.uncertainty_breakdown.regime_entropy * 100).toFixed(0)}%</div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0A0D12]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.08] bg-[#0E1218] text-[11px] uppercase tracking-wider text-[#9299A3]">
                <tr>
                  <th className="px-4 py-3">Macro / Market Factor</th>
                  <th className="px-4 py-3">Current Reading</th>
                  <th className="px-4 py-3">5Y Z-Score</th>
                  <th className="px-4 py-3">Rule Weight</th>
                  <th className="px-4 py-3">{selectedAsset === "US30" ? "US30 Contribution" : "XAUUSD Contribution"}</th>
                  <th className="px-4 py-3">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {m4.supporting_evidence.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-2.5 font-medium text-white">{row.factor}</td>
                    <td className="px-4 py-2.5 font-mono-num text-[#D0D5DD]">{row.current_value}</td>
                    <td className="px-4 py-2.5 font-mono-num text-white">
                      {row.z_score > 0 ? `+${row.z_score}` : row.z_score}σ
                    </td>
                    <td className="px-4 py-2.5 font-mono-num text-[#9299A3]">{row.weight}</td>
                    <td
                      className={cn(
                        "px-4 py-2.5 font-mono-num font-semibold",
                        row.xauusd_contribution >= 0 ? "text-[#00C985]" : "text-[#E5485D]"
                      )}
                    >
                      {row.xauusd_contribution > 0 ? `+${row.xauusd_contribution}` : row.xauusd_contribution}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-mono-num text-[11px] font-semibold",
                          row.signal.includes("BULLISH")
                            ? "text-[#00C985]"
                            : row.signal.includes("BEARISH")
                            ? "text-[#E5485D]"
                            : "text-[#9299A3]"
                        )}
                      >
                        {row.signal.includes("BULLISH") ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : row.signal.includes("BEARISH") ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : null}
                        {row.signal}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
