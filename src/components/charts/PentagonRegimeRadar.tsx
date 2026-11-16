"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import type { ForceId, RegimeForceReading, RegimeTone } from "@/lib/types";
import { useOptionalTerminal } from "@/components/providers/TerminalProvider";

interface PentagonRegimeRadarProps {
  lensId: string;
  forces: RegimeForceReading[];
  tone: RegimeTone;
  hoveredForceId: ForceId | null;
  onHoverForce: (id: ForceId | null) => void;
}

const TONE_PALETTE: Record<
  RegimeTone,
  {
    stroke: string;
    dot: string;
    glow: string;
    fillInner: string;
    fillOuter: string;
    pillBorder: string;
  }
> = {
  bearish: {
    stroke: "#E5485D",
    dot: "#FF7588",
    glow: "rgba(229, 72, 93, 0.48)",
    fillInner: "rgba(229, 72, 93, 0.38)",
    fillOuter: "rgba(229, 72, 93, 0.11)",
    pillBorder: "rgba(229, 72, 93, 0.35)",
  },
  bullish: {
    stroke: "#00C985",
    dot: "#42F0B2",
    glow: "rgba(0, 201, 133, 0.44)",
    fillInner: "rgba(0, 201, 133, 0.34)",
    fillOuter: "rgba(0, 201, 133, 0.10)",
    pillBorder: "rgba(0, 201, 133, 0.35)",
  },
  mixed: {
    stroke: "#D9B45C",
    dot: "#F3D78A",
    glow: "rgba(217, 180, 92, 0.42)",
    fillInner: "rgba(217, 180, 92, 0.32)",
    fillOuter: "rgba(217, 180, 92, 0.10)",
    pillBorder: "rgba(217, 180, 92, 0.35)",
  },
  neutral: {
    stroke: "#FFFFFF",
    dot: "#FFFFFF",
    glow: "rgba(255, 255, 255, 0.45)",
    fillInner: "rgba(255, 255, 255, 0.34)",
    fillOuter: "rgba(255, 255, 255, 0.10)",
    pillBorder: "rgba(255, 255, 255, 0.35)",
  },
};

const CX = 200;
const CY = 176;
const MAX_R = 94;
const RINGS = [0.25, 0.5, 0.75, 1];
const ANIM_DURATION_MS = 820;

function getVertex(index: number, count: number, ratio: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: CX + Math.cos(angle) * MAX_R * ratio,
    y: CY + Math.sin(angle) * MAX_R * ratio,
    angle,
  };
}

export function PentagonRegimeRadar({
  lensId,
  forces,
  tone,
  hoveredForceId,
  onHoverForce,
}: PentagonRegimeRadarProps) {
  const uid = useId().replace(/:/g, "");
  const [spread, setSpread] = useState(0);
  const [replayCount, setReplayCount] = useState(0);

  const terminal = useOptionalTerminal();
  const isLight = terminal?.theme === "light";

  const palette = useMemo(() => {
    const base = TONE_PALETTE[tone];
    if (tone === "neutral" && isLight) {
      return {
        stroke: "#0F172A",
        dot: "#1E293B",
        glow: "rgba(15, 23, 42, 0.22)",
        fillInner: "rgba(15, 23, 42, 0.16)",
        fillOuter: "rgba(15, 23, 42, 0.04)",
        pillBorder: "rgba(15, 23, 42, 0.25)",
      };
    }
    return base;
  }, [tone, isLight]);

  // Center-outward spread animation on mount, lens switch, or manual replay
  useEffect(() => {
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
      const elapsed = now - startTime;
      const raw = Math.min(1, elapsed / ANIM_DURATION_MS);
      // Quartic ease-out for crisp emergence from center and silky settle
      const eased = 1 - Math.pow(1 - raw, 4);
      setSpread(eased);

      if (raw < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [lensId, replayCount]);

  const count = forces.length;

  const todayPoints = useMemo(
    () =>
      forces.map((f, idx) => {
        const pt = getVertex(idx, count, (f.todayScore / 100) * spread);
        return { ...pt, force: f };
      }),
    [forces, count, spread]
  );

  const lastWeekSpread = Math.min(1, spread * 1.18);
  const lastWeekPoints = useMemo(
    () =>
      forces.map((f, idx) =>
        getVertex(idx, count, (f.lastWeekScore / 100) * lastWeekSpread)
      ),
    [forces, count, lastWeekSpread]
  );

  const todayPolygonStr = todayPoints
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const lastWeekPolygonStr = lastWeekPoints
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const pulsePolygonStr = useMemo(() => {
    const ratio = Math.max(0.02, spread);
    return forces
      .map((_, idx) => {
        const pt = getVertex(idx, count, ratio);
        return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
      })
      .join(" ");
  }, [forces, count, spread]);

  // 60 micro compass ticks around the outer reticle (major ticks every 72deg axis)
  const dialTicks = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 60;
      const isAxisTick = i % 12 === 0;
      const isMidTick = i % 6 === 0 && !isAxisTick;
      const r1 = MAX_R + 18;
      const r2 = MAX_R + (isAxisTick ? 25 : isMidTick ? 22 : 20);
      return {
        x1: CX + Math.cos(a) * r1,
        y1: CY + Math.sin(a) * r1,
        x2: CX + Math.cos(a) * r2,
        y2: CY + Math.sin(a) * r2,
        isAxisTick,
        isMidTick,
      };
    });
  }, []);

  const hoveredIndex = forces.findIndex((f) => f.id === hoveredForceId);
  const hoveredForce = hoveredIndex >= 0 ? forces[hoveredIndex] : null;
  const hoveredDelta = hoveredForce
    ? hoveredForce.todayScore - hoveredForce.lastWeekScore
    : 0;

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative w-full max-w-[400px]">
        <svg
          viewBox="0 0 400 356"
          className="h-auto w-full select-none overflow-visible"
          role="img"
          aria-label="Macro regime pentagon radar"
        >
          <defs>
            <radialGradient id={`radar-fill-${uid}`} cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor={palette.fillInner} />
              <stop offset="100%" stopColor={palette.fillOuter} />
            </radialGradient>
            <radialGradient id={`radar-ambient-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={palette.glow} stopOpacity="0.14" />
              <stop offset="65%" stopColor={palette.glow} stopOpacity="0.03" />
              <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
            </radialGradient>
            <filter id={`radar-glow-${uid}`} x="-35%" y="-35%" width="170%" height="170%">
              <feGaussianBlur stdDeviation="3.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Subtle ambient radial aura inside the radar scope */}
          <circle
            cx={CX}
            cy={CY}
            r={MAX_R + 22}
            fill={`url(#radar-ambient-${uid})`}
          />

          {/* Outer precision reticle rings */}
          <circle
            cx={CX}
            cy={CY}
            r={MAX_R + 23}
            fill="none"
            stroke={isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255,255,255,0.13)"}
            strokeWidth="1"
            strokeDasharray="1.5 5"
          />
          <circle
            cx={CX}
            cy={CY}
            r={MAX_R + 14}
            fill="none"
            stroke={isLight ? "rgba(15, 23, 42, 0.10)" : "rgba(255,255,255,0.085)"}
            strokeWidth="1"
          />

          {/* 60 Precision dial ticks */}
          {dialTicks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={
                t.isAxisTick
                  ? palette.stroke
                  : t.isMidTick
                  ? isLight
                    ? "rgba(15, 23, 42, 0.32)"
                    : "rgba(255,255,255,0.28)"
                  : isLight
                  ? "rgba(15, 23, 42, 0.14)"
                  : "rgba(255,255,255,0.14)"
              }
              strokeOpacity={t.isAxisTick ? 0.78 : 1}
              strokeWidth={t.isAxisTick ? "1.35" : "1"}
            />
          ))}

          {/* Concentric pentagon web rings */}
          {RINGS.map((ring) => {
            const pts = forces
              .map((_, idx) => {
                const pt = getVertex(idx, count, ring);
                return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
              })
              .join(" ");
            return (
              <polygon
                key={ring}
                points={pts}
                fill={ring === 1 ? (isLight ? "rgba(15, 23, 42, 0.02)" : "rgba(255,255,255,0.02)") : "none"}
                stroke={
                  ring === 1
                    ? isLight
                      ? "rgba(15, 23, 42, 0.22)"
                      : "rgba(255,255,255,0.22)"
                    : ring === 0.5
                    ? isLight
                      ? "rgba(15, 23, 42, 0.14)"
                      : "rgba(255,255,255,0.14)"
                    : isLight
                    ? "rgba(15, 23, 42, 0.08)"
                    : "rgba(255,255,255,0.095)"
                }
                strokeWidth="1"
              />
            );
          })}

          {/* Subtle scale markers (25 / 50 / 75) along top spoke */}
          {[0.25, 0.5, 0.75].map((r) => (
            <text
              key={r}
              x={CX + 4}
              y={CY - MAX_R * r + 3}
              fill={isLight ? "rgba(15, 23, 42, 0.55)" : "rgba(255,255,255,0.46)"}
              fontSize="7.5"
              fontWeight="600"
              className="font-mono-num"
            >
              {Math.round(r * 100)}
            </text>
          ))}

          {/* Precision center crosshair marking spread origin */}
          <g stroke={isLight ? "rgba(15, 23, 42, 0.38)" : "rgba(255,255,255,0.38)"} strokeWidth="1">
            <line x1={CX - 5} y1={CY} x2={CX + 5} y2={CY} />
            <line x1={CX} y1={CY - 5} x2={CX} y2={CY + 5} />
          </g>

          {/* 5 Radial axis spokes & labels (12px+ clearance outside dial ticks) */}
          {forces.map((force, idx) => {
            const end = getVertex(idx, count, 1);
            const labelDist = idx === 0 ? 1.42 : idx === 2 || idx === 3 ? 1.42 : 1.38;
            const lbl = getVertex(idx, count, labelDist);
            const isHovered = hoveredForceId === force.id;
            const textAnchor =
              Math.abs(Math.cos(lbl.angle)) < 0.25
                ? "middle"
                : Math.cos(lbl.angle) > 0
                ? "start"
                : "end";

            const baseY = lbl.y + (idx === 0 ? -7 : idx === 2 || idx === 3 ? 5 : 2);

            return (
              <g
                key={force.id}
                className="cursor-pointer"
                onMouseEnter={() => onHoverForce(force.id)}
                onMouseLeave={() => onHoverForce(null)}
              >
                <line
                  x1={CX}
                  y1={CY}
                  x2={end.x}
                  y2={end.y}
                  stroke={isHovered ? palette.stroke : isLight ? "rgba(15, 23, 42, 0.16)" : "rgba(255,255,255,0.16)"}
                  strokeWidth={isHovered ? "1.6" : "1"}
                  strokeOpacity={isHovered ? 0.9 : 1}
                />
                <text
                  x={lbl.x}
                  y={baseY}
                  textAnchor={textAnchor}
                  fill={isHovered ? (isLight ? "#0F172A" : "#FFFFFF") : isLight ? "#475569" : "#C4CBD4"}
                  fontSize="10"
                  fontWeight={isHovered ? "700" : "600"}
                  letterSpacing="0.1em"
                  className="font-mono-num transition-colors"
                >
                  {force.shortLabel}
                </text>
                <text
                  x={lbl.x}
                  y={baseY + 11}
                  textAnchor={textAnchor}
                  fill={isHovered ? palette.dot : isLight ? "rgba(71, 85, 105, 0.85)" : "rgba(196,203,212,0.78)"}
                  fontSize="8.5"
                  fontWeight="600"
                  className="font-mono-num transition-colors"
                >
                  {force.todayScore}
                </text>
              </g>
            );
          })}

          {/* Expanding center-origin wavefronts during spread */}
          {spread > 0.02 && spread < 0.99 && (
            <g>
              <circle
                cx={CX}
                cy={CY}
                r={Math.max(2, (MAX_R + 14) * spread)}
                fill="none"
                stroke={palette.stroke}
                strokeWidth="1"
                strokeOpacity={(1 - spread) * 0.34}
              />
              <polygon
                points={pulsePolygonStr}
                fill="none"
                stroke={palette.dot}
                strokeWidth="1.2"
                strokeOpacity={(1 - spread) * 0.45}
              />
            </g>
          )}

          {/* Last Week dashed baseline polygon + hollow vertex dots */}
          <polygon
            points={lastWeekPolygonStr}
            fill={isLight ? "rgba(15, 23, 42, 0.025)" : "rgba(255,255,255,0.025)"}
            stroke={isLight ? "rgba(15, 23, 42, 0.45)" : "rgba(255,255,255,0.52)"}
            strokeWidth="1.25"
            strokeDasharray="3.5 3.5"
            strokeLinejoin="round"
          />
          {lastWeekPoints.map((pt, idx) => (
            <circle
              key={`lw-${forces[idx].id}`}
              cx={pt.x}
              cy={pt.y}
              r={hoveredIndex === idx ? "3" : "2.2"}
              fill={isLight ? "#FFFFFF" : "#080A0D"}
              stroke={isLight ? "rgba(15, 23, 42, 0.65)" : "rgba(255,255,255,0.72)"}
              strokeWidth="1.15"
            />
          ))}

          {/* Today animated polygon spreading from center */}
          <polygon
            points={todayPolygonStr}
            fill={`url(#radar-fill-${uid})`}
            stroke={palette.stroke}
            strokeWidth="2.1"
            strokeLinejoin="round"
            filter={`url(#radar-glow-${uid})`}
          />

          {/* Razor-sharp inner highlight edge */}
          <polygon
            points={todayPolygonStr}
            fill="none"
            stroke={isLight ? "rgba(15, 23, 42, 0.22)" : "rgba(255,255,255,0.36)"}
            strokeWidth="0.7"
            strokeLinejoin="round"
          />

          {/* 1W Shift vector line when hovering a force */}
          {hoveredIndex >= 0 && spread > 0.7 && (
            <line
              x1={lastWeekPoints[hoveredIndex].x}
              y1={lastWeekPoints[hoveredIndex].y}
              x2={todayPoints[hoveredIndex].x}
              y2={todayPoints[hoveredIndex].y}
              stroke={palette.dot}
              strokeWidth="1.4"
              strokeDasharray="2 2"
            />
          )}

          {/* Origin anchor node */}
          <circle
            cx={CX}
            cy={CY}
            r="2.2"
            fill={palette.dot}
            fillOpacity={0.65}
          />

          {/* Today vertex nodes with rest halo + hover bloom */}
          {todayPoints.map((pt) => {
            const isHovered = hoveredForceId === pt.force.id;
            return (
              <g
                key={pt.force.id}
                className="cursor-pointer"
                onMouseEnter={() => onHoverForce(pt.force.id)}
                onMouseLeave={() => onHoverForce(null)}
              >
                <circle cx={pt.x} cy={pt.y} r="14" fill="transparent" />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? "9.5" : "6"}
                  fill={palette.glow}
                  fillOpacity={isHovered ? "0.42" : "0.18"}
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? "4.6" : "3.2"}
                  fill={palette.dot}
                  stroke={isLight ? "#FFFFFF" : "#080A0D"}
                  strokeWidth="1.3"
                />
              </g>
            );
          })}
        </svg>

        {/* Bottom HUD Readout / Legend */}
        <div className="mt-1 flex min-h-[28px] items-center justify-center">
          {hoveredForce ? (
            <div
              className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border bg-[#0A0D12]/95 px-3.5 py-1 font-mono-num text-[10.5px] text-[#F0F2F5] shadow-lg backdrop-blur-sm"
              style={{ borderColor: palette.pillBorder }}
            >
              <span className="font-semibold" style={{ color: palette.dot }}>
                {hoveredForce.shortLabel}
              </span>
              <span className="text-[#E6EAEF]">
                {hoveredForce.todayZ >= 0
                  ? `+${hoveredForce.todayZ.toFixed(2)}`
                  : hoveredForce.todayZ.toFixed(2)}{" "}
                <span className="text-[#9AA3B0]">({hoveredForce.todayScore}/100)</span>
              </span>
              <span className="text-[#8C95A2]">·</span>
              <span
                className={
                  hoveredDelta > 0
                    ? "text-[#00C985]"
                    : hoveredDelta < 0
                    ? "text-[#E5485D]"
                    : "text-[#B8C0CC]"
                }
              >
                1W {hoveredDelta > 0 ? `+${hoveredDelta}` : hoveredDelta}
              </span>
              <span className="text-[#8C95A2]">·</span>
              <span className="text-[#B8C0CC]">{hoveredForce.stateLabel}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-5 font-mono-num text-[10.5px] uppercase tracking-wider text-[#C4CBD4]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-[2px] w-3.5 rounded-full"
                  style={{ backgroundColor: palette.stroke }}
                />
                Today
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0 w-3.5 border-t border-dashed border-white/65" />
                Last Week
              </span>
              <button
                type="button"
                onClick={() => setReplayCount((c) => c + 1)}
                title="Replay spread animation"
                className="inline-flex items-center gap-1 rounded-full border border-white/[0.14] bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-[#B8C0CC] transition hover:border-white/30 hover:text-[#FFFFFF]"
              >
                <RotateCw className="h-2.5 w-2.5" />
                Replay
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
