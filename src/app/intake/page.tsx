import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { intakeEnabled, intakeModel } from "@/lib/intake/extract";
import { formatDateTime } from "@/lib/time";
import { IntakeForm } from "./IntakeForm";

export default async function IntakePage() {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const enabled = intakeEnabled();
  const recent = await prisma.emailIntake.findMany({
    where: user.role === "SUPERVISOR" ? {} : { createdById: user.id },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { createdBy: { select: { name: true } }, shipment: { select: { id: true, jobNo: true } } },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">New shipment from a customer email</h1>
        <p className="text-sm text-slate-600">
          Paste the email. AI pre-fills the booking form; you check the highlighted fields and confirm.
          Only the text you paste is sent to the AI service.
        </p>
      </div>

      {enabled ? (
        <section className="card"><IntakeForm /></section>
      ) : (
        <section className="card border-amber-300 bg-amber-50" role="status">
          <h2 className="font-medium text-amber-900">AI email intake is turned off</h2>
          <p className="mt-1 text-sm text-amber-900">
            No <code>ANTHROPIC_API_KEY</code> is configured on the server. Ask the administrator to add it to <code>.env</code> and
            restart the app. Meanwhile, use the <Link href="/shipments/new" className="underline">manual form</Link>.
          </p>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-medium">Recent emails</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link href={`/intake/${i.id}`} className="min-w-0 flex-1 truncate text-blue-700 hover:underline">
                  {i.rawText.split("\n").find((l) => /^subject:/i.test(l))?.replace(/^subject:\s*/i, "") ?? i.rawText.slice(0, 80)}
                </Link>
                <span className="text-xs text-slate-500">{i.createdBy.name} · {formatDateTime(i.createdAt)}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${i.status === "CONFIRMED" ? "bg-green-100 text-green-900" : i.status === "REJECTED" ? "bg-slate-100 text-slate-600" : i.extractError ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>
                  {i.status === "CONFIRMED" ? `Created ${i.shipment?.jobNo ?? ""}` : i.status === "REJECTED" ? "Discarded" : i.extractError ? "Extraction failed" : "Waiting for review"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {enabled && <p className="text-xs text-slate-400">Model: {intakeModel()}</p>}
    </div>
  );
}
