import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";
import { ExtractionSchema } from "@/lib/intake/extract";
import { extractionToForm } from "@/lib/intake/to-form";
import { ShipmentForm } from "@/components/ShipmentForm";
import { formOptions } from "../../shipments/data";
import { confirmIntakeAction, discardIntakeAction, retryExtractionAction } from "../actions";

export default async function IntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const { id } = await params;
  const intake = await prisma.emailIntake.findUnique({ where: { id } }).catch(() => null);
  if (!intake || (user.role !== "SUPERVISOR" && intake.createdById !== user.id)) notFound();
  const created = intake.shipmentId
    ? await prisma.shipment.findUnique({ where: { id: intake.shipmentId }, select: { id: true, jobNo: true } })
    : null;

  const parsed = intake.extractedJson ? ExtractionSchema.safeParse(intake.extractedJson) : null;
  const { shippers, csUsers, destinations } = await formOptions();
  const mapped = parsed?.success ? extractionToForm(parsed.data, shippers, user.role === "CS" ? user.id : "") : null;
  const flagged = mapped ? Object.keys(mapped.flags).length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Review email booking</h1>
        <span className="text-sm text-slate-500">Pasted {formatDateTime(intake.createdAt)}{intake.model ? ` · read by ${intake.model}` : ""}</span>
        <Link href="/intake" className="ml-auto text-sm text-blue-700 hover:underline">All emails</Link>
      </div>

      {intake.status === "CONFIRMED" && created && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">
          Confirmed. Shipment <Link href={`/shipments/${created.id}`} className="font-mono underline">{created.jobNo}</Link> was created from this email.
        </div>
      )}
      {intake.status === "REJECTED" && (
        <div className="rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm">This email was discarded. Nothing was created.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card self-start lg:sticky lg:top-4">
          <h2 className="mb-2 font-medium">Original email</h2>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-sm">{intake.rawText}</pre>
          {intake.attachmentText && (
            <>
              <h3 className="mb-1 mt-3 text-sm font-medium">Attachment text</h3>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs">{intake.attachmentText}</pre>
            </>
          )}
          {parsed?.success && parsed.data.review_notes.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Notes from the AI</p>
              <ul className="ml-4 list-disc">{parsed.data.review_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </section>

        <section className="space-y-3">
          {intake.status === "PENDING_REVIEW" && (intake.extractError || !mapped) && (
            <div className="card border-red-300 bg-red-50 text-sm" role="alert">
              <p className="font-medium text-red-900">Could not extract the booking</p>
              <p className="mt-1 text-red-900">{intake.extractError ?? "The saved extraction could not be read."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={retryExtractionAction}>
                  <input type="hidden" name="intakeId" value={intake.id} />
                  <button className="btn py-1">Try again</button>
                </form>
                <Link href="/shipments/new" className="btn-secondary py-1">Enter manually</Link>
              </div>
            </div>
          )}

          {intake.status === "PENDING_REVIEW" && mapped && (
            <>
              <div className={`rounded-md border px-4 py-2 text-sm ${flagged ? "border-amber-300 bg-amber-50 text-amber-900" : "border-green-300 bg-green-50 text-green-900"}`}>
                {flagged
                  ? `${flagged} field${flagged === 1 ? "" : "s"} highlighted: check them against the email. Fill in anything else you know (cut-offs, ETD, carrier).`
                  : "Everything was found clearly. Still check it against the email before confirming."}
                {" "}Job No. and HBL No. are assigned when you confirm.
              </div>
              <ShipmentForm
                action={confirmIntakeAction.bind(null, intake.id)}
                isNew
                submitLabel="Confirm and create shipment"
                shippers={shippers}
                csUsers={csUsers}
                destinations={destinations}
                initial={mapped.values}
                flags={mapped.flags}
                initialShipperName={mapped.values.shipperId ? undefined : mapped.shipperNameFromEmail ?? undefined}
              />
              <form action={discardIntakeAction}>
                <input type="hidden" name="intakeId" value={intake.id} />
                <button className="text-sm text-red-700 hover:underline">Discard this email (no shipment)</button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
