import { requireUser } from "@/lib/auth";
import { IMPORT_FIELDS } from "@/lib/import/mapping";
import { ImportForm } from "./ImportForm";
import { now } from "@/lib/clock";
import { manilaParts, DAY } from "@/lib/time";

export default async function ImportPage() {
  await requireUser(["SUPERVISOR"]);
  const p = manilaParts(new Date((await now()).getTime() - 30 * DAY));
  const defaultHistory = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Import the old monitoring spreadsheet</h1>
        <p className="text-sm text-slate-600">
          One-time move of existing shipments. Upload the monitoring sheet as it is (Excel or CSV, the 3-row header layout
          is recognised) or the template. Check first, then import. Rows with problems are listed and downloadable for
          correction; re-uploading is safe because rows already imported are skipped.
        </p>
      </div>
      <ImportForm defaultHistory={defaultHistory} />
      <details className="card text-sm">
        <summary className="cursor-pointer font-medium">Template layout: accepted column headers (not needed for the NNR monitoring sheet)</summary>
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
