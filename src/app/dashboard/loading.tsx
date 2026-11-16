import { LoadingSkeleton } from "@/components/dashboard/FeedbackStates";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between border-b border-[#1C1C1C] pb-4">
        <div className="space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-[#0A0A0A]" />
          <div className="h-6 w-56 animate-pulse rounded bg-[#0A0A0A]" />
        </div>
        <div className="h-8 w-44 animate-pulse rounded-md bg-[#0A0A0A]" />
      </div>
      <LoadingSkeleton rows={4} />
    </div>
  );
}
