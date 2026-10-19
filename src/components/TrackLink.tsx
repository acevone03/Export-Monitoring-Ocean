"use client";

import { useState } from "react";
import type { TrackTarget } from "@/lib/tracking";

/**
 * Booking number that opens the shipping line's track & trace in a new tab. It also copies the number,
 * so on carrier sites that do not take it from the link CS just paste it (Ctrl+V).
 */
export function TrackLink({ refNo, target, className = "" }: { refNo: string; target: TrackTarget | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!target) return <span className={className}>{refNo}</span>;
  return (
    <span className="relative inline-flex items-center gap-1">
      <a
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-blue-700 underline decoration-dotted underline-offset-2 hover:decoration-solid ${className}`}
        title={target.direct ? `Track on ${target.carrier}` : `Open ${target.carrier} tracking (booking no. is copied: paste with Ctrl+V)`}
        onClick={() => {
          try {
            void navigator.clipboard?.writeText(refNo);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {}
        }}
      >
        {refNo}
        <span aria-hidden className="ml-0.5 text-xs">↗</span>
      </a>
      {copied && !target.direct && (
        <span role="status" className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-xs text-white shadow">
          Copied. Paste on {target.carrier} with Ctrl+V
        </span>
      )}
    </span>
  );
}
