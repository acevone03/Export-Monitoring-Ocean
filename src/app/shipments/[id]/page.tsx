import Link from "next/link";
import { notFound } from "next/navigation";
import type { Shipment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, can, assertShipmentAccess } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { formatDateTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";
import { dueState, type DueState } from "@/lib/due";
import { missingMandatory } from "@/lib/mandatory";
import { deadlinesMoot } from "@/lib/deadline-status";
import { describeEvent, SOURCE_LABEL } from "@/lib/event-text";
import { ActionForm } from "@/components/ActionForm";
import { milestoneAction, editHblAction, createFieldLinkAction, revokeFieldLinkAction, revertMilestoneAction } from "./actions";
import type { RevertKind } from "@/lib/shipments";
import { FieldLinkPanel } from "@/components/FieldLinkPanel";

const DUE_STYLE: Record<DueState, string> = {
  done: "bg-green-50 text-green-800 border-green-200",
  overdue: "bg-red-50 text-red-800 border-red-300",
  soon: "bg-amber-50 text-amber-900 border-amber-300",
  ok: "bg-white text-slate-700 border-slate-200",
  none: "bg-white text-slate-500 border-slate-200",
};
const DUE_TEXT: Record<DueState, string> = { done: "Done", overdue: "Overdue", soon: "Due within 4h", ok: "On track", none: "No deadline" };

export default async function ShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const { id } = await params;
  const { created } = await searchParams;
  await assertShipmentAccess(user, id);
  const s = await prisma.shipment
    .findUnique({
      where: { id },
      include: {
        shipper: true,
        assignedCs: { select: { name: true } },
        arrastreProof: true,
        intake: { select: { id: true } },
        events: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } },
        fieldLinks: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          include: { assignee: { select: { name: true } }, createdBy: { select: { name: true } } },
        },
      },
    })
    .catch(() => null);
  if (!s) notFound();

  const now = await clockNow();
  const parent = s.partOfHblNo ? await prisma.shipment.findUnique({ where: { hblNo: s.partOfHblNo }, select: { id: true } }) : null;
  const fieldUsers = await prisma.user.findMany({ where: { role: "FIELD", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } });
  const open = s.status !== "CLOSED" && s.status !== "CANCELLED";
  const missing = missingMandatory(s);
  const moot = deadlinesMoot(s);
  // Supervisors can undo a step recorded by mistake (logged, nothing deleted).
  const rv = (kind: RevertKind) => (user.role === "SUPERVISOR" ? <RevertForm shipmentId={s.id} kind={kind} /> : null); // after departure / cancel / close, open deadlines no longer turn red
  const plan = (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? [];
  const cargo = s.cargoType === "FCL"
    ? `FCL ${plan.map((c) => `${c.qty}×${c.size === "40HC" ? "40'HC" : `${c.size}'`}`).join(" + ")}`
    : `LCL ${s.lclQty ?? "?"} ${s.lclUnit === "BOX" ? "boxes" : "pallets"}`;

  return (
    <div className="space-y-6">
      {created && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          Shipment created. Job No. <b className="font-mono">{s.jobNo}</b>, HBL No. <b className="font-mono">{s.hblNo}</b>.
        </div>
      )}

      <header className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">HBL No.</p>
          <h1 className="font-mono text-2xl font-semibold">{s.hblNo ?? (/DIRECT BL/i.test(s.carrierRemarks ?? "") ? "DIRECT BL" : "(no HBL)")}</h1>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Job No.</p>
          <p className="font-mono text-2xl text-slate-600">{s.jobNo}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <p className="mt-1 inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900">{STATUS_LABEL[s.status]}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/" className="btn-secondary">Back to board</Link>
          {open && <Link href={`/shipments/${s.id}/edit`} className="btn">Edit details</Link>}
        </div>
      </header>

      {missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Missing data: {missing.join(", ")}
        </div>
      )}
      {s.status === "CLOSED" && (
        <div className="rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm">
          Closed {formatDateTime(s.closedAt)}.
          {rv("CLOSED")}
        </div>
      )}
      {s.status === "CANCELLED" && (
        <div className="rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm">
          Cancelled {formatDateTime(s.cancelledAt)}: {s.cancelReason}
          {rv("CANCELLED")}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row k="Shipper" v={s.shipper.name} />
            <Row k="Consignee" v={s.consigneeName} />
            <Row k="Destination" v={s.destinationPort} />
            <Row k="POD" v={s.pod} />
            <Row k="Cargo" v={cargo} />
            <Row k="Shipping line / co-loader" v={s.carrierName} />
            <Row k="Booking no." v={s.carrierBookingRef} mono />
            <Row k="Remarks" v={s.carrierRemarks} />
            <Row k="Requested pick-up" v={formatDateTime(s.requestedPickupAt)} />
            <Row k="FSI cut-off" v={formatDateTime(s.fsiCutoffAt)} />
            <Row k="Pre-advise cut-off" v={formatDateTime(s.preadviseCutoffAt)} />
            <Row k="Arrastre cut-off" v={s.arrastreResponsibility === "NNR" ? formatDateTime(s.arrastreCutoffAt) : "n/a (shipper)"} />
            <Row k="ETD MNL" v={formatDateTime(s.etdMnl)} />
            <Row k="ETA" v={formatDateTime(s.eta)} />
            <Row k="Arrastre by" v={s.arrastreResponsibility === "NNR" ? "NNR" : "Shipper"} />
            <Row k="Declaration c/o" v={`${s.declarationBy === "NNR" ? "NNR" : "Shipper"}${s.declarationForwarder ? ` (${s.declarationForwarder})` : ""}`} />
            <Row k="HBL destination code" v={s.podCode} mono />
            {s.partOfHblNo && (
              <>
                <dt className="text-slate-500">Part of HBL</dt>
                <dd className="font-mono">
                  {parent ? <Link href={`/shipments/${parent.id}`} className="text-blue-700 hover:underline">{s.partOfHblNo}</Link> : s.partOfHblNo}
                </dd>
              </>
            )}
            <Row k="Assigned CS" v={s.assignedCs.name} />
            <dt className="text-slate-500">Source</dt>
            <dd>
              {s.source}
              {s.intake && <Link href={`/intake/${s.intake.id}`} className="ml-2 text-blue-700 hover:underline">original email</Link>}
            </dd>
          </dl>
        </section>

        <section className="space-y-2 lg:col-span-3">
          <h2 className="font-semibold">Milestones</h2>
          <Step label="1. Pick-up" due={s.requestedPickupAt} done={s.actualPickupAt} now={now} passive={moot} revert={rv("PICKED_UP")}>
            {open && <TimedAction s={s} kind="PICKED_UP" button="Mark picked up" behalf />}
          </Step>
          <Step label="2. FSI submitted" due={s.fsiCutoffAt} done={s.fsiSubmittedAt} now={now} passive={moot} revert={rv("FSI_SUBMITTED")}>
            {open && <TimedAction s={s} kind="FSI_SUBMITTED" button="Mark FSI submitted" />}
          </Step>
          <Step label="3. Pre-advise sent" due={s.preadviseCutoffAt} done={s.preadviseSentAt} now={now} passive={moot} revert={rv("PREADVISE_SENT")}>
            {open && <TimedAction s={s} kind="PREADVISE_SENT" button="Mark pre-advise sent" />}
          </Step>
          <Step
            label={`4. Export declaration: ${s.exportDeclarationStatus}`}
            due={null}
            done={s.exportDeclarationStatus !== "PENDING" ? s.exportDeclarationUpdatedAt ?? true : null}
            now={now}
            keepOpen
          >
            {open && (
              <ActionForm action={milestoneAction} className="flex flex-wrap items-center gap-2">
                <Hidden s={s} kind="DECLARATION_STATUS" />
                <div className="w-40">
                  <select name="status" defaultValue={nextDeclaration(s.exportDeclarationStatus)} className="input py-1" aria-label="Declaration status">
                    {["PENDING", "FILED", "ASSESSED", "RELEASED"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </div>
                <OnBehalf />
                <button className="btn-secondary py-1">Update</button>
              </ActionForm>
            )}
          </Step>
          <Step label="5. Uploaded to BOC portal" due={s.bocDeadlineAt} done={s.bocUploadAt} now={now} passive={moot} rule="FSI cut-off − 24h" revert={rv("BOC_UPLOADED")}>
            {open && <TimedAction s={s} kind="BOC_UPLOADED" button="Mark uploaded" />}
          </Step>
          {s.arrastreResponsibility === "NNR" ? (
            <Step label="6. Arrastre paid" due={s.arrastreDeadlineAt} done={s.arrastrePaidAt} now={now} passive={moot} rule="arrastre cut-off" keepOpen revert={rv("ARRASTRE_PAID")}>
              {s.arrastreProof && (
                <a className="text-sm text-blue-700 hover:underline" href={`/api/attachments/${s.arrastreProof.id}`} target="_blank">
                  View proof ({s.arrastreProof.originalName})
                </a>
              )}
              {open && !s.arrastrePaidAt && (
                <ActionForm action={milestoneAction} className="flex flex-wrap items-center gap-2">
                  <Hidden s={s} kind="ARRASTRE_PAID" />
                  <input type="file" name="proof" accept="image/png,image/jpeg,image/webp,application/pdf" required className="text-sm" />
                  <WhenInput />
                  <button className="btn-secondary py-1">Mark paid</button>
                </ActionForm>
              )}
            </Step>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              6. Arrastre: paid by shipper, step skipped
            </div>
          )}
          <Step label="7. Export docs sent" due={null} done={s.exportDocsSentAt} now={now} keepOpen revert={rv("DOCS_SENT")}>
            {s.exportDocsSentAt ? (
              <p className="text-xs text-slate-600">To {s.exportDocsRecipient}: “{s.exportDocsSubject}”</p>
            ) : open && (
              <ActionForm action={milestoneAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Hidden s={s} kind="DOCS_SENT" />
                <input name="recipient" defaultValue={s.shipper.email ?? ""} placeholder="Sent to (email)" className="input py-1" required />
                <input name="subject" defaultValue={`Export docs ${s.jobNo} / HBL ${s.hblNo}`} placeholder="Email subject" className="input py-1" required />
                <button className="btn-secondary py-1">Mark sent</button>
              </ActionForm>
            )}
          </Step>
          <Step label="8. Docs sent to overseas office" due={null} done={s.exportDocsToOverseasAt} now={now} keepOpen revert={rv("DOCS_TO_OVERSEAS")}>
            {open && <TimedAction s={s} kind="DOCS_TO_OVERSEAS" button="Mark sent" />}
          </Step>
          <Step label="9. Departed (ATD MNL)" due={s.etdMnl} done={s.atdMnl} now={now} dueLabel="ETD" revert={rv("DEPARTED")}>
            {open && !s.atdMnl && (
              <ActionForm action={milestoneAction} className="flex flex-wrap items-center gap-2">
                <Hidden s={s} kind="DEPARTED" />
                <WhenInput label="ATD" />
                <label className="text-xs text-slate-600">ETA <input type="datetime-local" name="eta" className="input inline-block w-auto py-1" /></label>
                <button className="btn-secondary py-1">Mark departed</button>
              </ActionForm>
            )}
          </Step>
          <Step label="10. Arrived (ATA)" due={s.eta} done={s.ata} now={now} dueLabel="ETA" passive={!s.atdMnl} revert={rv("ARRIVED")}>
            {open && s.atdMnl && <TimedAction s={s} kind="ARRIVED" button="Mark arrived" whenLabel="ATA" />}
          </Step>

          {open && (
            <div className="flex flex-wrap gap-4 pt-2">
              {s.status === "ARRIVED" && (
                <ActionForm action={milestoneAction}>
                  <Hidden s={s} kind="CLOSED" />
                  <button className="btn">Close shipment</button>
                </ActionForm>
              )}
              {!s.atdMnl && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-red-700">Cancel shipment…</summary>
                  <ActionForm action={milestoneAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <Hidden s={s} kind="CANCELLED" />
                    <input name="reason" placeholder="Reason" className="input w-64 py-1" required minLength={3} />
                    <button className="rounded-md bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800">Confirm cancel</button>
                  </ActionForm>
                </details>
              )}
            </div>
          )}
          {open && (
            <div className="card mt-4 space-y-3">
              <div>
                <h3 className="font-medium">Field update link</h3>
                <p className="text-xs text-slate-600">
                  A no-login page for the field person&apos;s phone: Picked up, Declaration filed, Declaration released, plus note/photo.
                  Valid 7 days.
                </p>
              </div>
              <FieldLinkPanel shipmentId={s.id} jobNo={s.jobNo} fieldUsers={fieldUsers} action={createFieldLinkAction} />
              {s.fieldLinks.length > 0 && (
                <ul className="divide-y divide-slate-100 text-sm">
                  {s.fieldLinks.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                      <span>{l.assignee ? `For ${l.assignee.name}` : "Any field person"}</span>
                      <span className="text-xs text-slate-500">
                        by {l.createdBy.name}, expires {formatDateTime(l.expiresAt)}
                        {l.lastUsedAt ? `, last used ${formatDateTime(l.lastUsedAt)}` : ", not used yet"}
                      </span>
                      <form action={revokeFieldLinkAction} className="ml-auto">
                        <input type="hidden" name="shipmentId" value={s.id} />
                        <input type="hidden" name="linkId" value={l.id} />
                        <button className="text-xs text-red-700 hover:underline">Revoke</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {can.editHblNo(user) && (
            <details className="pt-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Correct HBL No. (supervisor)…</summary>
              <ActionForm action={editHblAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <input name="hblNo" defaultValue={s.hblNo ?? ""} className="input w-40 py-1 font-mono" required />
                <input name="reason" placeholder="Reason (logged)" className="input w-64 py-1" required />
                <button className="btn-secondary py-1">Save HBL No.</button>
              </ActionForm>
            </details>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="mb-3 font-semibold">Timeline</h2>
        <ol className="space-y-2 text-sm">
          {s.events.map((e) => (
            <li key={e.id} className="grid gap-x-4 sm:grid-cols-[10rem_1fr]">
              <span className="whitespace-nowrap text-slate-500">{formatDateTime(e.occurredAt)}</span>
              <span>
                {describeEvent(e)}
                {photoId(e.value) && (
                  <a href={`/api/attachments/${photoId(e.value)}`} target="_blank" className="ml-1 text-blue-700 hover:underline">View photo</a>
                )}
                {e.note && <span className="text-slate-600"> · “{e.note}”</span>}
                <span className="text-xs text-slate-400"> · {e.actor?.name ?? "System"} via {SOURCE_LABEL[e.source]}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function photoId(value: string | null): string | null {
  if (!value?.startsWith("{")) return null;
  try {
    return JSON.parse(value).attachmentId ?? null;
  } catch {
    return null;
  }
}

function nextDeclaration(cur: string) {
  const order = ["PENDING", "FILED", "ASSESSED", "RELEASED"];
  return order[Math.min(order.indexOf(cur) + 1, order.length - 1)];
}

function Row({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? "font-mono" : ""}>{v || <span className="text-slate-400">—</span>}</dd>
    </>
  );
}

function Step({
  label, due, done, now, rule, dueLabel = "Due", passive, keepOpen, revert, children,
}: {
  label: string;
  due: Date | null;
  done: Date | boolean | null;
  now: Date;
  rule?: string;
  dueLabel?: string;
  passive?: boolean;
  keepOpen?: boolean;
  revert?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const state = passive && !done ? "none" : dueState(due, done, now);
  return (
    <div className={`rounded-md border px-3 py-2 ${DUE_STYLE[state]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{label}</span>
        <span className="text-xs">{DUE_TEXT[state]}</span>
        <span className="ml-auto text-xs text-slate-600">
          {due && <>{dueLabel} {formatDateTime(due)}{rule && <span className="text-slate-400"> ({rule})</span>}</>}
          {done instanceof Date && <> · Done {formatDateTime(done)}</>}
        </span>
      </div>
      {children && (!done || keepOpen) && <div className="mt-2">{children}</div>}
      {done && revert && <div className="mt-1">{revert}</div>}
    </div>
  );
}

function Hidden({ s, kind }: { s: Shipment; kind: string }) {
  return (
    <>
      <input type="hidden" name="shipmentId" value={s.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
}

function WhenInput({ label = "When" }: { label?: string }) {
  return (
    <label className="text-xs text-slate-600">
      {label} <input type="datetime-local" name="at" className="input inline-block w-auto py-1" title="Leave blank for now" />
    </label>
  );
}

function OnBehalf() {
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer">On behalf of field…</summary>
      <label className="mt-1 flex items-center gap-1">
        <input type="checkbox" name="onBehalf" value="1" /> Field person reported this by text
      </label>
      <input name="note" placeholder="Note, e.g. who texted and when" className="input mt-1 py-1" maxLength={500} />
    </details>
  );
}

function TimedAction({ s, kind, button, behalf, whenLabel }: { s: Shipment; kind: string; button: string; behalf?: boolean; whenLabel?: string }) {
  const done =
    (kind === "PICKED_UP" && s.actualPickupAt) || (kind === "FSI_SUBMITTED" && s.fsiSubmittedAt) ||
    (kind === "PREADVISE_SENT" && s.preadviseSentAt) || (kind === "BOC_UPLOADED" && s.bocUploadAt) ||
    (kind === "DOCS_TO_OVERSEAS" && s.exportDocsToOverseasAt) ||
    (kind === "ARRIVED" && s.ata);
  if (done) return null;
  return (
    <ActionForm action={milestoneAction} className="flex flex-wrap items-center gap-2">
      <Hidden s={s} kind={kind} />
      <WhenInput label={whenLabel} />
      {behalf && <OnBehalf />}
      <button className="btn-secondary py-1">{button}</button>
    </ActionForm>
  );
}

function RevertForm({ shipmentId, kind }: { shipmentId: string; kind: RevertKind }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-red-700">Revert… (supervisor)</summary>
      <ActionForm action={revertMilestoneAction} className="mt-1 flex flex-wrap items-center gap-2">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <input type="hidden" name="kind" value={kind} />
        <input name="reason" required minLength={3} placeholder="Why? (kept on the timeline)" className="input w-64 py-1 text-xs" />
        <button className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50">Revert this step</button>
      </ActionForm>
    </details>
  );
}
