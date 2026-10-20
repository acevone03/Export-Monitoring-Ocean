import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { getCarrierLinks } from "@/lib/tracking";
import { resetCarriersAction, saveCarriersAction } from "./actions";

const BLANK_ROWS = 3;

export default async function CarriersPage() {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const carriers = await getCarrierLinks(prisma);
  const rows = [...carriers, ...Array.from({ length: BLANK_ROWS }, () => ({ name: "", aliases: [] as string[], url: "" }))];
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Shipping line tracking links</h1>
        <p className="text-sm text-slate-600">
          Clicking a booking number opens its shipping line&apos;s track &amp; trace. The line is matched from the
          “Shipping line / co-loader” on the shipment, by name or any of the other names below.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
          <li>Put <code className="rounded bg-slate-100 px-1">{"{ref}"}</code> in the link where the booking number goes: the result opens directly (ONE and COSCO work this way).</li>
          <li>Without <code className="rounded bg-slate-100 px-1">{"{ref}"}</code> the carrier&apos;s tracking page opens and the booking number is copied: paste it with Ctrl+V.</li>
        </ul>
      </div>
      <ActionForm action={saveCarriersAction} className="space-y-3">
        <input type="hidden" name="count" value={rows.length} />
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="px-3 py-2">Shipping line</th><th className="px-3 py-2">Other names (comma-separated)</th><th className="px-3 py-2">Tracking link</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5"><input name={`name_${i}`} defaultValue={c.name} className="input py-1" placeholder="e.g. Sealand" /></td>
                  <td className="px-2 py-1.5"><input name={`aliases_${i}`} defaultValue={c.aliases.join(", ")} className="input py-1" placeholder="e.g. SEALAND ASIA, SEAU" /></td>
                  <td className="px-2 py-1.5"><input name={`url_${i}`} defaultValue={c.url} className="input py-1 font-mono text-xs" placeholder="https://…{ref}" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Clear a row to remove that line. Save, then reopen this page for more blank rows.</p>
        <button className="btn">Save</button>
      </ActionForm>
      {user.role === "SUPERVISOR" && (
        <ActionForm action={resetCarriersAction}>
          <button className="btn-secondary py-1 text-xs">Restore default list</button>
        </ActionForm>
      )}
    </div>
  );
}
