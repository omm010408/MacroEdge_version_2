"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { TimeframeSelector } from "@/components/dashboard/FilterControls";

interface DeskNote {
  id: string;
  author: string;
  tag: "Inflation" | "Rates" | "COT" | "FX";
  metric: string;
  headline: string;
  timestamp: string;
  tone: "bullish" | "bearish" | "neutral" | "mixed";
}

const STORAGE_KEY = "macroedge.community_notes.v1";

const INITIAL_NOTES: DeskNote[] = [
  { id: "c1", author: "M. Lindqvist", tag: "Rates", metric: "US10Y 4.31% · 2s10s +13bp", headline: "Term premium expansion lifting long end ahead of CPI print.", timestamp: "14:15 UTC", tone: "neutral" },
  { id: "c2", author: "S. Okafor", tag: "Inflation", metric: "Core PCE 2.7% · 5Y5Y 2.28%", headline: "Supercore services holding sticky above 4.0% YoY.", timestamp: "13:40 UTC", tone: "mixed" },
  { id: "c3", author: "K. Takahashi", tag: "COT", metric: "GC 94th Pct · ZN 12th Pct", headline: "Specs extended long COMEX Gold while 10Y Treasury remains crowded short.", timestamp: "12:05 UTC", tone: "bullish" },
  { id: "c4", author: "R. Chen", tag: "FX", metric: "DXY 104.82 · USDJPY 153.42", headline: "US–JP 10Y spread widening back toward 330 bps.", timestamp: "10:30 UTC", tone: "bullish" },
];

export default function CommunityPage() {
  const [notes, setNotes] = useState(INITIAL_NOTES);
  const [filter, setFilter] = useState<"ALL" | "Inflation" | "Rates" | "COT" | "FX">("ALL");
  const [headline, setHeadline] = useState("");
  const [metric, setMetric] = useState("");
  const [tag, setTag] = useState<DeskNote["tag"]>("Inflation");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DeskNote[];
        if (Array.isArray(parsed) && parsed.length > 0) setNotes(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!headline.trim()) return;
    const entry: DeskNote = {
      id: `note-${Date.now()}`,
      author: "A. Vance",
      tag,
      metric: metric.trim() || "Macro Desk",
      headline: headline.trim(),
      timestamp: new Date().toISOString().slice(11, 16) + " UTC",
      tone: "neutral",
    };
    setNotes((prev) => {
      const next = [entry, ...prev];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    setHeadline("");
    setMetric("");
  }

  const visible = filter === "ALL" ? notes : notes.filter((n) => n.tag === filter);

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div>
          <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#FFFFFF]">
            Analyst Desk Feed
          </span>
          <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#F0F2F5]">
            Community Observations
          </h1>
        </div>
        <TimeframeSelector
          options={["ALL", "Inflation", "Rates", "COT", "FX"] as const}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {/* Concise 1-line observation composer */}
      <form
        onSubmit={handlePost}
        className="flex flex-wrap items-center gap-2.5 rounded-lg border border-white/[0.09] bg-[#0B0D10] p-3.5"
      >
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value as DeskNote["tag"])}
          className="rounded border border-white/[0.09] bg-[#080A0D] px-2.5 py-1.5 font-mono-num text-[11.5px] text-[#F0F2F5]"
        >
          <option value="Inflation">Inflation</option>
          <option value="Rates">Rates</option>
          <option value="COT">COT</option>
          <option value="FX">FX</option>
        </select>
        <input
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          placeholder="Metric ref (e.g. CPI 2.6%)"
          className="w-44 rounded border border-white/[0.09] bg-[#080A0D] px-2.5 py-1.5 font-mono-num text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
        />
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Concise market observation (no advice)..."
          className="min-w-[220px] flex-1 rounded border border-white/[0.09] bg-[#080A0D] px-3 py-1.5 text-[12.5px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded bg-[#FFFFFF] px-3 py-1.5 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
        >
          <Send className="h-3.5 w-3.5" />
          Post
        </button>
      </form>

      <div className="space-y-2.5">
        {visible.map((note) => (
          <div
            key={note.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.09] bg-[#0B0D10] px-4 py-3.5"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <MarketStatusBadge label={note.tag} tone={note.tone} />
                <span className="font-mono-num text-[11.5px] font-semibold text-[#F0F2F5]">
                  {note.metric}
                </span>
                <span className="font-mono-num text-[11px] text-[#555D68]">
                  · {note.author} · {note.timestamp}
                </span>
              </div>
              <div className="text-[13px] text-[#F0F2F5]">{note.headline}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
