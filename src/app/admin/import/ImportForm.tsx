"use client";

import { useActionState, useMemo } from "react";
import { importAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, {});
  const r = state.result;
  const errorsHref = useMemo(
    () => (state.errorsFile ? `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${state.errorsFile}` : null),
    [state.errorsFile],
  );

  return (
    <div className="space-y-4">
      <form action={action} className="card space-y-3">
        <input type="file" name="file" accept=".xlsx" required className="block text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="dryRun" defaultChecked /> Check only (nothing is saved)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="createShippers" defaultChecked /> Add shippers that are not in the shipper list yet
        </label>
        <button className="btn" disabled={pending}>{pending ? "Working…" : "Upload"}</button>
        {state.error && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
      </form>

      {r && (
        <section className="card space-y-3" aria-live="polite">
          <h2 className="font-semibold">{r.dryRun ? "Check result" : "Import result"}: {state.fileName}</h2>
          {r.missingHeaders.length > 0 ? (
            <p className="text-sm text-red-700" role="alert">
              Missing required column{r.missingHeaders.length > 1 ? "s" : ""}: {r.missingHeaders.join(", ")}. Nothing was imported. See docs/import.md for the accepted headers.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Rows read" value={r.total} />
                <Stat label={r.dryRun ? "Ready to import" : "Imported"} value={r.imported} tone="green" />
                <Stat label="Skipped (already in)" value={r.skipped.length} />
                <Stat label="Need fixing" value={r.errors.length} tone={r.errors.length ? "red" : undefined} />
              </div>
              {r.dryRun && r.errors.length === 0 && r.imported > 0 && <p className="text-sm text-green-800">All rows are valid. Untick "Check only" and upload again to import.</p>}
              {r.createdShippers.length > 0 && (
                <p className="text-sm">{r.dryRun ? "Shippers that will be added" : "Shippers added"}: {r.createdShippers.join(", ")}</p>
              )}
              {r.unknownHeaders.length > 0 && <p className="text-sm text-slate-600">Ignored columns: {r.unknownHeaders.join(", ")}</p>}
              {r.skipped.length > 0 && (
                <details className="text-sm"><summary className="cursor-pointer">Skipped rows</summary>
                  <ul className="ml-4 list-disc">{r.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
                </details>
              )}
              {r.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-medium text-red-800">Rows to fix ({r.errors.length})</h3>
                    {errorsHref && <a href={errorsHref} download="rows-to-fix.xlsx" className="btn-secondary py-1">Download rows to fix (.xlsx)</a>}
                  </div>
                  <div className="max-h-96 overflow-auto rounded border border-red-200">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-red-50 text-left text-xs uppercase text-red-900"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Problem</th></tr></thead>
                      <tbody className="divide-y divide-red-100">
                        {r.errors.map((e) => (
                          <tr key={e.row}><td className="px-2 py-1 align-top font-mono">{e.row}</td><td className="px-2 py-1">{e.messages.map((m, i) => <div key={i}>{m}</div>)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-green-800" : tone === "red" ? "text-red-700" : "";
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="label">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
