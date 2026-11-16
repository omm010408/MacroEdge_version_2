import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import "./overview-ledger.css";
import "./positioning.css";
import "./comparator.css";
import { TerminalProvider } from "@/components/providers/TerminalProvider";
import { AnnouncementBar } from "@/components/navigation/AnnouncementBar";
import { TopNavigation } from "@/components/navigation/TopNavigation";

export const metadata: Metadata = {
  title: "MacroEdge | Institutional Macroeconomic Intelligence Terminal",
  description:
    "Institutional macroeconomic research, cross-asset positioning, central-bank policy, inflation analytics, and fixed-income curve terminal.",
  icons: {
    icon: [
      { url: "/macroedge-logo.png", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute("data-theme","dark");document.documentElement.classList.add("dark");document.documentElement.classList.remove("light");`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[#050608] text-[#F0F2F5] antialiased selection:bg-[#FFFFFF]/25 selection:text-[#F0F2F5]">
        <TerminalProvider>
          <div className="flex min-h-screen flex-col">
            <AnnouncementBar />
            <TopNavigation />
            <div className="flex-1">{children}</div>
          </div>
        </TerminalProvider>
      </body>
    </html>
  );
}
