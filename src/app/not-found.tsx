import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="w-full rounded-lg border border-white/[0.09] bg-[#0A0D12] p-8">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-[#FFFFFF]/35 bg-[#050608]">
          <Compass className="h-5 w-5 text-[#FFFFFF]" />
        </div>
        <div className="mt-3 font-mono-num text-[11px] uppercase tracking-wider text-[#FFFFFF]">
          404 · Route Not Found
        </div>
        <h1 className="mt-1 text-[18px] font-semibold tracking-tight text-[#F0F2F5]">
          Terminal Module Unavailable
        </h1>
        <p className="mt-1.5 text-[12.5px] text-[#9299A3]">
          The requested terminal route does not exist or has been relocated.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/macrodashboard"
            className="rounded-md bg-[#FFFFFF] px-4 py-1.5 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
          >
            Return to Macrodashboard
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-white/[0.09] bg-[#050608] px-4 py-1.5 text-[12px] text-[#F0F2F5] transition hover:border-white/20"
          >
            Analyst Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
