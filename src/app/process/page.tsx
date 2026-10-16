import { requireUser } from "@/lib/auth";
import { PROCESS_MERMAID, PROCESS_NOTES } from "@/lib/process-map";
import { MermaidDiagram } from "./MermaidDiagram";

export default async function ProcessPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Export process map</h1>
        <p className="text-sm text-slate-600">From booking request to arrival. Italic labels are the shipment status after each step.</p>
      </div>
      <section className="card"><MermaidDiagram chart={PROCESS_MERMAID} /></section>
      <ul className="ml-5 list-disc space-y-1 text-sm text-slate-700">
        {PROCESS_NOTES.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
