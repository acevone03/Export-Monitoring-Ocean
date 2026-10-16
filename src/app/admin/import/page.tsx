import { requireUser } from "@/lib/auth";
import { IMPORT_FIELDS } from "@/lib/import/mapping";
import { ImportForm } from "./ImportForm";

export default async function ImportPage() {
  await requireUser(["SUPERVISOR"]);
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Import the old monitoring spreadsheet</h1>
        <p className="text-sm text-slate-600">
          One-time move of existing shipments. Check first, then import. Rows with problems are listed (and downloadable)
          for correction; re-uploading is safe because rows already imported are skipped.
        </p>
      </div>
      <ImportForm />
      <details className="card text-sm">
        <summary className="cursor-pointer font-medium">Accepted column headers</summary>
        <table className="mt-2 min-w-full">
          <tbody className="divide-y divide-slate-100">
            {IMPORT_FIELDS.map((f) => (
              <tr key={f.key}>
                <td className="py-1 pr-3 align-top">{f.headers.join(" / ")}{"required" in f && f.required && <span className="text-red-700"> *</span>}</td>
                <td className="py-1 text-slate-600">{"note" in f ? f.note : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">* required. Dates: Excel date cells or 16-Oct-2026 09:00 (Manila). Full details in docs/import.md.</p>
      </details>
    </div>
  );
}
