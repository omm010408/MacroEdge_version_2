import { Sidebar } from "@/components/sidebar/Sidebar";

export default function MacrodashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-3.25rem)] w-full bg-[#050608]">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="mx-auto max-w-[1440px] space-y-6">{children}</div>
      </main>
    </div>
  );
}
