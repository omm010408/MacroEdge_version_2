import Image from "next/image";
import { cn } from "@/lib/utils";

interface MacroEdgeLogoProps {
  className?: string;
  height?: number;
  width?: number;
  priority?: boolean;
}

/**
 * MacroEdge Institutional Monogram Logo ("ME")
 * Rendered from the authentic high-resolution vector/raster master asset.
 */
export function MacroEdgeLogo({
  className,
  height = 24,
  width,
  priority = true,
}: MacroEdgeLogoProps) {
  // Master asset aspect ratio: 809 x 345 = ~2.345:1
  const calculatedWidth = width ?? Math.round(height * 2.345);

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center select-none shrink-0",
        className
      )}
    >
      <Image
        src="/macroedge-logo.png"
        alt="MacroEdge Logo"
        width={calculatedWidth}
        height={height}
        priority={priority}
        className="h-full w-auto object-contain filter drop-shadow-[0_0_12px_rgba(255,255,255,0.18)]"
      />
    </div>
  );
}
