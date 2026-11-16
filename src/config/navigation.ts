export type NavIconKey =
  | "layout-dashboard"
  | "graduation-cap"
  | "award"
  | "trophy"
  | "users"
  | "activity"
  | "briefcase"
  | "crosshair"
  | "grid-3x3"
  | "landmark"
  | "building-2"
  | "shield-alert"
  | "line-chart"
  | "flame"
  | "percent"
  | "globe"
  | "bar-chart-3"
  | "git-compare"
  | "bookmark"
  | "check-square"
  | "brain-circuit";

export interface TopNavItem {
  id: string;
  label: string;
  href: string;
  icon: NavIconKey;
  matchPrefix?: string;
}

export interface SidebarChildItem {
  id: string;
  label: string;
  href: string;
  icon: NavIconKey;
  category: string;
  section: "STATISTICS" | "TOOLS" | "WORKSPACE";
  keywords: string[];
}

export interface SidebarCategoryGroup {
  id: string;
  label: string;
  icon: NavIconKey;
  section: "STATISTICS" | "TOOLS";
  href?: string;
  category?: string;
  keywords?: string[];
  items?: SidebarChildItem[];
}

export const TOP_NAV_ITEMS: TopNavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "layout-dashboard",
  },
  {
    id: "student-area",
    label: "Student Area",
    href: "/student-area",
    icon: "graduation-cap",
  },
  {
    id: "ranks",
    label: "Ranks",
    href: "/ranks",
    icon: "award",
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    href: "/leaderboard",
    icon: "trophy",
  },
  {
    id: "community",
    label: "Community",
    href: "/community",
    icon: "users",
  },
  {
    id: "macrodashboard",
    label: "Macrodashboard",
    href: "/macrodashboard",
    icon: "activity",
    matchPrefix: "/macrodashboard",
  },
  {
    id: "partner-offers",
    label: "Partner Offers",
    href: "/partner-offers",
    icon: "briefcase",
  },
];

export const MACRO_SIDEBAR_GROUPS: SidebarCategoryGroup[] = [
  {
    id: "positioning",
    label: "Positioning",
    icon: "crosshair",
    section: "STATISTICS",
    items: [
      {
        id: "commitments-of-traders",
        label: "Commitments of Traders",
        href: "/macrodashboard/positioning/commitments-of-traders",
        icon: "crosshair",
        category: "Positioning",
        section: "STATISTICS",
        keywords: ["cot", "cftc", "futures", "positioning", "extreme", "net contracts"],
      },
      {
        id: "correlation-matrix",
        label: "Correlation Matrix",
        href: "/macrodashboard/positioning/correlation-matrix",
        icon: "grid-3x3",
        category: "Positioning",
        section: "STATISTICS",
        keywords: ["correlation", "heatmap", "xauusd", "dxy", "us10y", "spx", "btc"],
      },
    ],
  },
  {
    id: "liquidity",
    label: "Liquidity",
    icon: "landmark",
    section: "STATISTICS",
    items: [
      {
        id: "monetary-policy",
        label: "Monetary Policy",
        href: "/macrodashboard/liquidity/monetary-policy",
        icon: "landmark",
        category: "Liquidity",
        section: "STATISTICS",
        keywords: ["fed", "fomc", "ecb", "boe", "boj", "policy rate", "ois", "balance sheet"],
      },
      {
        id: "primary-dealer-stats",
        label: "Primary Dealer Stats",
        href: "/macrodashboard/liquidity/primary-dealer-stats",
        icon: "building-2",
        category: "Liquidity",
        section: "STATISTICS",
        keywords: ["dealer", "repo", "sofr", "rrp", "tga", "walcl", "treasury auctions"],
      },
    ],
  },
  {
    id: "credit-risk",
    label: "Credit & Risk",
    icon: "shield-alert",
    section: "STATISTICS",
    href: "/macrodashboard/credit-risk",
  },
  {
    id: "economy",
    label: "Economy",
    icon: "line-chart",
    section: "STATISTICS",
    items: [
      {
        id: "economy-labor",
        label: "Economy & Labor",
        href: "/macrodashboard/economy/economy-labor",
        icon: "line-chart",
        category: "Economy",
        section: "STATISTICS",
        keywords: ["gdp", "nfp", "unemployment", "jolts", "ism", "pmi", "claims", "retail sales"],
      },
      {
        id: "inflation",
        label: "Inflation",
        href: "/macrodashboard/economy/inflation",
        icon: "flame",
        category: "Economy",
        section: "STATISTICS",
        keywords: ["cpi", "core cpi", "pce", "ppi", "breakeven", "5y5y", "shelter", "prices"],
      },
      {
        id: "fixed-income-rates",
        label: "Fixed Income & Rates",
        href: "/macrodashboard/economy/fixed-income-rates",
        icon: "percent",
        category: "Economy",
        section: "STATISTICS",
        keywords: ["yield curve", "2s10s", "5s30s", "real yield", "term premium", "treasury"],
      },
      {
        id: "international",
        label: "International",
        href: "/macrodashboard/economy/international",
        icon: "globe",
        category: "Economy",
        section: "STATISTICS",
        keywords: ["eurozone", "uk", "japan", "china", "canada", "australia", "switzerland"],
      },
      {
        id: "g10-indicators",
        label: "G10 Indicators",
        href: "/macrodashboard/economy/g10-indicators",
        icon: "bar-chart-3",
        category: "Economy",
        section: "STATISTICS",
        keywords: ["g10", "matrix", "central bank", "real rate", "fx", "sovereign"],
      },
    ],
  },
  {
    id: "comparator",
    label: "Comparator",
    icon: "git-compare",
    section: "TOOLS",
    href: "/macrodashboard/tools/comparator",
  },
  {
    id: "watch-list",
    label: "Watch List",
    icon: "bookmark",
    section: "TOOLS",
    href: "/macrodashboard/tools/watch-list",
  },
  {
    id: "daily-check",
    label: "Daily Check",
    icon: "check-square",
    section: "TOOLS",
    href: "/macrodashboard/tools/daily-check",
  },
  {
    id: "ai-bias",
    label: "AI Bias Engine",
    icon: "brain-circuit",
    section: "TOOLS",
    href: "/macrodashboard/tools/ai-bias",
    category: "Tools",
    keywords: [
      "ai",
      "ml",
      "xgboost",
      "finbert",
      "forecast",
      "bias",
      "xauusd",
      "gold",
      "regime",
      "reaction",
      "news",
    ],
  },
  {
    id: "data-ops",
    label: "Data Operations",
    icon: "activity",
    section: "TOOLS",
    href: "/macrodashboard/tools/data-ops",
    category: "Tools",
    keywords: [
      "data ops",
      "data operations",
      "sync",
      "workers",
      "health",
      "realtime",
      "anomalies",
      "dead letter",
      "ai supervisor",
    ],
  },
  {
    id: "incidents",
    label: "Incident Response",
    icon: "shield-alert",
    section: "TOOLS",
    href: "/macrodashboard/tools/incidents",
    category: "Tools",
    keywords: [
      "incident",
      "debugger",
      "agent 7",
      "alerts",
      "root cause",
      "recovery",
      "errors",
      "logs",
      "reliability",
    ],
  },
];

export const ALL_MACRO_ROUTES: SidebarChildItem[] = [
  {
    id: "macro-overview",
    label: "Macro Overview",
    href: "/macrodashboard",
    icon: "activity",
    category: "Overview",
    section: "STATISTICS",
    keywords: ["overview", "regime", "calendar", "market", "dxy", "vix", "gold"],
  },
  ...MACRO_SIDEBAR_GROUPS.flatMap((group) => {
    if (group.items && group.items.length > 0) {
      return group.items;
    }
    if (group.href) {
      return [
        {
          id: group.id,
          label: group.label,
          href: group.href,
          icon: group.icon,
          category: group.category ?? group.label,
          section: group.section,
          keywords: group.keywords ?? [group.label.toLowerCase(), group.id],
        },
      ];
    }
    return [];
  }),
];

export const ALL_TERMINAL_ROUTES: SidebarChildItem[] = [
  ...ALL_MACRO_ROUTES,
  ...TOP_NAV_ITEMS.filter((item) => item.href !== "/macrodashboard").map((item) => ({
    id: `nav-${item.id}`,
    label: item.label,
    href: item.href,
    icon: item.icon,
    category: "Terminal Workspace",
    section: "WORKSPACE" as const,
    keywords: [item.label.toLowerCase(), item.id, "workspace", "nav"],
  })),
];

export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export function isRouteActive(
  pathname: string,
  href: string,
  matchPrefix?: string
): boolean {
  const current = normalizePathname(pathname);
  const target = normalizePathname(href);
  if (matchPrefix) {
    const prefix = normalizePathname(matchPrefix);
    return current === prefix || current.startsWith(`${prefix}/`);
  }
  if (target === "/macrodashboard" || target === "/") {
    return current === target;
  }
  return current === target || current.startsWith(`${target}/`);
}

export function getBreadcrumbSegments(pathname: string): { label: string; href: string }[] {
  const current = normalizePathname(pathname);
  const segments: { label: string; href: string }[] = [
    { label: "MacroEdge", href: "/macrodashboard" },
  ];

  if (current === "/macrodashboard") {
    segments.push({ label: "Overview", href: "/macrodashboard" });
    return segments;
  }

  for (const group of MACRO_SIDEBAR_GROUPS) {
    if (group.href && isRouteActive(current, group.href)) {
      segments.push({ label: group.section === "TOOLS" ? "Tools" : "Statistics", href: "/macrodashboard" });
      segments.push({ label: group.label, href: group.href });
      return segments;
    }
    if (group.items) {
      const child = group.items.find((item) => isRouteActive(current, item.href));
      if (child) {
        segments.push({ label: group.label, href: group.items[0]?.href ?? child.href });
        segments.push({ label: child.label, href: child.href });
        return segments;
      }
    }
  }

  const topMatch = TOP_NAV_ITEMS.find((item) =>
    isRouteActive(current, item.href, item.matchPrefix)
  );
  if (topMatch) {
    segments.push({ label: topMatch.label, href: topMatch.href });
  }

  return segments;
}
