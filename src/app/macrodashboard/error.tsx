"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { reportFrontendIncident } from "@/lib/incidents/client-reporter";

export default function MacrodashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportFrontendIncident({
      domain: "frontend",
      severity: "High",
      affectedComponent: "next-app:MacrodashboardError",
      errorDescription: error.message || "Unexpected terminal rendering error.",
      stackTrace: error.stack ?? error.digest ?? null,
      metricType: "ui_error",
      metadata: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[#F05454]/30 bg-[#0A0D12] p-10 text-center">
      <AlertTriangle className="h-6 w-6 text-[#F05454]" />
      <h2 className="mt-3 text-[15px] font-semibold text-[#F0F2F5]">
        Module Render Interrupted
      </h2>
      <p className="mt-1 font-mono-num text-[12px] text-[#9299A3]">
        {error.message || "Unexpected terminal rendering error."}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono-num text-[10.5px] text-[#555D68]">
          Ref: {error.digest}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-[#FFFFFF] px-4 py-1.5 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
        >
          Retry View
        </button>
        <Link
          href="/macrodashboard"
          className="rounded-md border border-white/[0.09] bg-[#0B0D10] px-4 py-1.5 text-[12px] text-[#F0F2F5] transition hover:border-white/20"
        >
          Macro Overview
        </Link>
      </div>
    </div>
  );
}
