import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="terminal-card flex flex-col items-center justify-center rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2E2E2E] bg-[#141414]">
        <Inbox className="h-4.5 w-4.5 text-[#FFFFFF]" />
      </div>
      <div className="mt-3 text-[13px] font-semibold tracking-tight text-[#FFFFFF]">{title}</div>
      {detail && <div className="mt-1 max-w-md text-[12px] text-[#A3A3A3]">{detail}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function DataOpsEmptyState({
  title = "Awaiting Live Data Sync",
  detail = "Configure API keys and trigger Data Operations sync to populate live institutional data.",
  actionHref = "/macrodashboard/tools/data-ops",
  actionLabel = "Open Data Operations",
}: {
  title?: string;
  detail?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <EmptyState
      title={title}
      detail={detail}
      action={
        <Link
          href={actionHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#FFFFFF] bg-[#FFFFFF] px-3 py-1.5 text-[12px] font-medium text-[#000000] transition hover:bg-[#FFFFFF]/90"
        >
          {actionLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    />
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: rows }).map((_, idx) => (
          <div
            key={idx}
            className="h-28 animate-pulse rounded-xl border border-[#1C1C1C] bg-[#0A0A0A]"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-[#1C1C1C] bg-[#0A0A0A]" />
    </div>
  );
}
