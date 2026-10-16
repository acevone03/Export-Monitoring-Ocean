"use client";

import { useEffect, useRef, useState } from "react";

/** Renders a Mermaid diagram in the browser (mermaid is loaded only on this page). */
export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", flowchart: { htmlLabels: true } });
        const { svg } = await mermaid.render("process-map", chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) return <pre className="whitespace-pre-wrap text-xs text-red-700">Could not draw the diagram: {error}</pre>;
  return <div ref={ref} className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" aria-label="Export process map" role="img" />;
}
