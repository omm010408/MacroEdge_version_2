import { LoadingSkeleton } from "@/components/dashboard/FeedbackStates";

export default function RootLoading() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-14 animate-pulse rounded-lg border border-white/[0.08] bg-[#0A0D12]" />
      <LoadingSkeleton rows={4} />
    </div>
  );
}
