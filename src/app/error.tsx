"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { reportFrontendIncident } from "@/lib/incidents/client-reporter";

export default function GlobalRouteError({
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
      affectedComponent: "next-app:GlobalRouteError",
      errorDescription: error.message || "Unexpected rendering failure.",
      stackTrace: error.stack ?? error.digest ?? null,
      metricType: "ui_error",
      metadata: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="w-full rounded-lg border border-[#F05454]/30 bg-[#0A0D12] p-8">
        <AlertTriangle className="mx-auto h-7 w-7 text-[#F05454]" />
        <h2 className="mt-3 text-[16px] font-semibold text-[#F0F2F5]">
          Terminal Route Error
        </h2>
        <p className="mt-1 font-mono-num text-[12px] text-[#9299A3]">
          {error.message || "Unexpected rendering failure."}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono-num text-[10.5px] text-[#555D68]">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-[#FFFFFF] px-4 py-1.5 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
          >
            Retry
          </button>
          <Link
            href="/macrodashboard"
            className="rounded-md border border-white/[0.09] bg-[#0B0D10] px-4 py-1.5 text-[12px] text-[#F0F2F5] transition hover:border-white/20"
          >
            Macro Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
