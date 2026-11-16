"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getBreadcrumbSegments } from "@/config/navigation";

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = getBreadcrumbSegments(pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11.5px] text-[#6B6B6B]">
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        return (
          <div key={`${seg.href}-${idx}`} className="flex items-center gap-1.5">
            {idx > 0 && <ChevronRight className="h-3 w-3 text-[#6B6B6B]" />}
            {isLast ? (
              <span aria-current="page" className="font-medium text-[#FFFFFF]">
                {seg.label}
              </span>
            ) : (
              <Link
                href={seg.href}
                className="transition-colors hover:text-[#FFFFFF]"
              >
                {seg.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
