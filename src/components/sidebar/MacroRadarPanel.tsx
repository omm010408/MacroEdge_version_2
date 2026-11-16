"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RegimeTone } from "@/lib/types";
import { useMacroRealtime } from "@/lib/realtime/useMacroRealtime";
import { buildSectionMacroRadar } from "@/services/data/section-radar";
import { useTerminal } from "@/components/providers/TerminalProvider";

const CX = 110;
const CY = 86;
const MAX_R = 40;
const RINGS = [0.25, 0.5, 0.75, 1];
const ANIM_DURATION_MS = 740;

const MINI_PALETTE: Record<
  RegimeTone,
  { stroke: string; dot: string; glow: string; fillInner: string; fillOuter: string }
> = {
  bearish: {
    stroke: "#E5485D",
    dot: "#FF7588",
    glow: "rgba(229, 72, 93, 0.50)",
    fillInner: "rgba(229, 72, 93, 0.40)",
    fillOuter: "rgba(229, 72, 93, 0.14)",
  },
  bullish: {
    stroke: "#00C985",
    dot: "#42F0B2",
    glow: "rgba(0, 201, 133, 0.48)",
    fillInner: "rgba(0, 201, 133, 0.36)",
    fillOuter: "rgba(0, 201, 133, 0.12)",
  },
  mixed: {
    stroke: "#FFFFFF",
    dot: "#FFFFFF",
    glow: "rgba(255, 255, 255, 0.48)",
    fillInner: "rgba(255, 255, 255, 0.34)",
    fillOuter: "rgba(255, 255, 255, 0.12)",
  },
  neutral: {
    stroke: "#FFFFFF",
    dot: "#FFFFFF",
    glow: "rgba(255, 255, 255, 0.48)",
    fillInner: "rgba(255, 255, 255, 0.34)",
    fillOuter: "rgba(255, 255, 255, 0.12)",
  },
};

export function MacroRadarPanel({ onNavigate }: { onNavigate?: () => void }) {
  const uid = useId().replace(/:/g, "");
  const pathname = usePathname();
  const { activeRegimeLens, theme } = useTerminal();
  const isLight = theme === "light";
  const { latestValues, marketQuotes, health, recentRuns } = useMacroRealtime({
    fetchOnMount: true,
    pollIntervalMs: 5000,
  });
  const [spread, setSpread] = useState(0);

  const model = useMemo(
    () =>
      buildSectionMacroRadar(pathname, {
        latestValues,
        marketQuotes,
        health,
        recentRuns,
        activeRegimeLens,
      }),
    [pathname, latestValues, marketQuotes, health, recentRuns, activeRegimeLens]
  );

  const axes = model.axes;
  const palette = useMemo(() => {
    const base = MINI_PALETTE[model.tone];
    if (model.tone === "neutral" && isLight) {
      return {
        stroke: "#0F172A",
        dot: "#1E293B",
        glow: "rgba(15, 23, 42, 0.22)",
        fillInner: "rgba(15, 23, 42, 0.16)",
        fillOuter: "rgba(15, 23, 42, 0.04)",
      };
    }
    return base;
  }, [model.tone, isLight]);

  useEffect(() => {
    if (axes.length === 0) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setSpread(1);
      return;
    }

    let rafId = 0;
    let startTime: number | null = null;
    setSpread(0);

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const raw = Math.min(1, (now - startTime) / ANIM_DURATION_MS);
      setSpread(1 - Math.pow(1 - raw, 4));
      if (raw < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [model.sectionId, axes.length]);

  if (axes.length === 0) {
    return null;
  }

  const getPoint = (index: number, ratio: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
    return {
      x: CX + Math.cos(angle) * MAX_R * ratio,
      y: CY + Math.sin(angle) * MAX_R * ratio,
      angle,
    };
  };

  const todayPoints = axes.map((a, idx) =>
    getPoint(idx, (a.todayScore / 100) * spread)
  );
  const todayPolygon = todayPoints
    .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(" ");

  const lastWeekPolygon = axes
    .map((a, idx) => {
      const pt = getPoint(idx, (a.lastWeekScore / 100) * Math.min(1, spread * 1.18));
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <Link
      href="/macrodashboard/tools/daily-check"
      onClick={onNavigate}
      title={`${model.sectionLabel} · ${model.syncedCount}/${model.totalAxes} live axes synced`}
      className="terminal-card group relative block overflow-hidden rounded-lg border border-white/[0.15] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:border-white/30"
    >
      {/* Subtle metallic ambient glow matching active section regime */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle at 50% 42%, ${palette.fillOuter}, transparent 72%)`,
        }}
      />

      <div className="relative z-10">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B8C0CC] transition-colors group-hover:text-[#FFFFFF]">
              Macro Radar
            </span>
            <span
              className="font-mono-num text-[9px] text-[#8C95A2]"
              aria-label={`${model.syncedCount} of ${model.totalAxes} live axes`}
            >
              {model.syncedCount}/{model.totalAxes}
            </span>
          </div>
          <span
            className="rounded border px-1.5 py-0.5 font-mono-num text-[9px] font-semibold uppercase tracking-wider"
            style={{
              color: palette.dot,
              borderColor: `${palette.stroke}66`,
              backgroundColor: `${palette.stroke}1E`,
            }}
          >
            {model.sectionLabel}
          </span>
        </div>

        <svg
          viewBox="0 0 220 168"
          className="mx-auto block h-[146px] w-full select-none overflow-visible"
          role="img"
          aria-label={`${model.sectionLabel} macro radar`}
        >
          <defs>
            <radialGradient id={`mini-fill-${uid}`} cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor={palette.fillInner} />
              <stop offset="100%" stopColor={palette.fillOuter} />
            </radialGradient>
            <filter id={`mini-glow-${uid}`} x="-35%" y="-35%" width="170%" height="170%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer precision scope ring (strictly inside label ring with 9px gap) */}
          <circle
            cx={CX}
            cy={CY}
            r={MAX_R + 7}
            fill="none"
            stroke={isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255,255,255,0.14)"}
            strokeWidth="0.9"
            strokeDasharray="1.5 4"
          />

          {/* Concentric pentagons */}
          {RINGS.map((r) => {
            const pts = axes
              .map((_, idx) => {
                const p = getPoint(idx, r);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              })
              .join(" ");
            return (
              <polygon
                key={r}
                points={pts}
                fill={r === 1 ? (isLight ? "rgba(15, 23, 42, 0.02)" : "rgba(255,255,255,0.02)") : "none"}
                stroke={
                  r === 1
                    ? isLight
                      ? "rgba(15, 23, 42, 0.22)"
                      : "rgba(255,255,255,0.22)"
                    : r === 0.5
                    ? isLight
                      ? "rgba(15, 23, 42, 0.13)"
                      : "rgba(255,255,255,0.13)"
                    : isLight
                    ? "rgba(15, 23, 42, 0.08)"
                    : "rgba(255,255,255,0.095)"
                }
                strokeWidth="0.95"
              />
            );
          })}

          {/* Center origin crosshair */}
          <g stroke={isLight ? "rgba(15, 23, 42, 0.38)" : "rgba(255,255,255,0.38)"} strokeWidth="0.9">
            <line x1={CX - 4} y1={CY} x2={CX + 4} y2={CY} />
            <line x1={CX} y1={CY - 4} x2={CX} y2={CY + 4} />
          </g>

          {/* Spokes & crisp axis labels cleanly outside the scope ring */}
          {axes.map((axis, idx) => {
            const end = getPoint(idx, 1);
            const lbl = getPoint(idx, idx === 0 ? 1.38 : 1.40);
            const textAnchor =
              Math.abs(Math.cos(lbl.angle)) < 0.25
                ? "middle"
                : Math.cos(lbl.angle) > 0
                ? "start"
                : "end";
            const dy = idx === 0 ? -2 : idx === 2 || idx === 3 ? 5 : 3;
            return (
              <g key={axis.id}>
                <line
                  x1={CX}
                  y1={CY}
                  x2={end.x}
                  y2={end.y}
                  stroke={isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255,255,255,0.16)"}
                  strokeWidth="0.95"
                />
                <text
                  x={lbl.x}
                  y={lbl.y + dy}
                  textAnchor={textAnchor}
                  fill={axis.synced ? (isLight ? "#0F172A" : "#E2E6EC") : isLight ? "#64748B" : "#B8C0CC"}
                  fontSize="7.6"
                  fontWeight="600"
                  letterSpacing="0.08em"
                  className="font-mono-num"
                >
                  {axis.label}
                </text>
              </g>
            );
          })}

          {/* Subtle center-out spread ripple */}
          {spread > 0.03 && spread < 0.99 && (
            <circle
              cx={CX}
              cy={CY}
              r={Math.max(1.5, (MAX_R + 6) * spread)}
              fill="none"
              stroke={palette.stroke}
              strokeWidth="1"
              strokeOpacity={(1 - spread) * 0.45}
            />
          )}

          {/* Last week / baseline dashed polygon */}
          <polygon
            points={lastWeekPolygon}
            fill={isLight ? "rgba(15, 23, 42, 0.015)" : "rgba(255,255,255,0.015)"}
            stroke={isLight ? "rgba(15, 23, 42, 0.45)" : "rgba(255,255,255,0.48)"}
            strokeWidth="1.1"
            strokeDasharray="2.5 2.5"
            strokeLinejoin="round"
          />

          {/* Today polygon with glow + crisp edge highlight */}
          <polygon
            points={todayPolygon}
            fill={`url(#mini-fill-${uid})`}
            stroke={palette.stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
            filter={`url(#mini-glow-${uid})`}
          />
          <polygon
            points={todayPolygon}
            fill="none"
            stroke={isLight ? "rgba(15, 23, 42, 0.22)" : "rgba(255,255,255,0.38)"}
            strokeWidth="0.65"
            strokeLinejoin="round"
          />

          {/* Vertex nodes */}
          {todayPoints.map((pt, idx) => (
            <g key={axes[idx].id}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r="4.2"
                fill={palette.glow}
                fillOpacity="0.28"
              />
              <circle
                cx={pt.x}
                cy={pt.y}
                r="2.4"
                fill={palette.dot}
                stroke={isLight ? "#FFFFFF" : "#060709"}
                strokeWidth="1"
              />
            </g>
          ))}
        </svg>

        <div className="mt-1.5 grid grid-cols-5 divide-x divide-white/[0.07] rounded-md border border-white/[0.09] bg-[#060709]/85 py-1.5 text-center">
          {axes.map((axis) => (
            <div key={axis.id} className="min-w-0 px-0.5">
              <div className="truncate font-mono-num text-[7.5px] font-medium uppercase tracking-wider text-[#9AA3B0]">
                {axis.code}
              </div>
              <div className="mt-0.5 font-mono-num text-[11px] font-semibold leading-none text-[#FFFFFF]">
                {axis.synced ? axis.todayScore : "—"}
              </div>
              <div
                className="mt-0.5 font-mono-num text-[8.5px] font-medium leading-none"
                style={{
                  color:
                    axis.delta === null
                      ? "#8C95A2"
                      : axis.delta > 0
                      ? "#00C985"
                      : axis.delta < 0
                      ? "#E5485D"
                      : "#8C95A2",
                }}
              >
                {axis.delta === null
                  ? "—"
                  : axis.delta > 0
                  ? `+${axis.delta}`
                  : axis.delta}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}
