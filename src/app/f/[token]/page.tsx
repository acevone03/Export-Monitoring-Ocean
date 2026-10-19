import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { resolveFieldLink } from "@/lib/field-links";
import { formatDateTime } from "@/lib/time";
import { verseOfTheDay } from "@/lib/scripture";
import { FieldActions } from "./FieldActions";
import { fieldAction } from "./actions";

export const metadata: Metadata = { title: "Field update · NNR", robots: { index: false, follow: false } };

const REFUSED: Record<string, string> = {
  invalid: "This link is not valid.",
  expired: "This link has expired.",
  revoked: "This link was turned off by CS.",
  closed: "This shipment is closed or cancelled.",
};

// Public, no login. Shows only what the field person needs for this one shipment.
export default async function FieldPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveFieldLink(prisma, token);
  if (!link.ok) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 text-center shadow">
        <p className="text-4xl" aria-hidden>🔒</p>
        <h1 className="mt-2 text-xl font-semibold">{REFUSED[link.reason]}</h1>
        <p className="mt-2 text-slate-600">Ask NNR customer service for a new update link.</p>
      </div>
    );
  }

  const s = link.shipment;
  const plan = (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? [];
  const cargo = s.cargoType === "FCL"
    ? plan.map((c) => `${c.qty} × ${c.size === "40HC" ? "40' HC" : `${c.size}'`}`).join(" + ")
    : `LCL ${s.lclQty ?? "?"} ${s.lclUnit === "BOX" ? "boxes" : "pallets"}`;

  const buttons = [
    !s.actualPickupAt && { action: "PICKED_UP" as const, label: "Picked up", tone: "bg-blue-700 active:bg-blue-800" },
    s.exportDeclarationStatus === "PENDING" && { action: "DECLARATION_FILED" as const, label: "Export declaration filed", tone: "bg-indigo-700 active:bg-indigo-800" },
    s.exportDeclarationStatus !== "RELEASED" && { action: "DECLARATION_RELEASED" as const, label: "Declaration released", tone: "bg-green-700 active:bg-green-800" },
  ].filter(Boolean) as Array<{ action: "PICKED_UP" | "DECLARATION_FILED" | "DECLARATION_RELEASED"; label: string; tone: string }>;

  return (
    <div className="mx-auto max-w-md space-y-4 text-base">
      <header className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">NNR field update{link.assignee ? ` · for ${link.assignee.name}` : ""}</p>
        <h1 className="font-mono text-2xl font-bold">{s.jobNo}</h1>
        <p className="text-lg font-medium">{s.shipper.name}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
          <dt className="text-slate-500">Pick-up</dt>
          <dd>{s.requestedPickupAt ? formatDateTime(s.requestedPickupAt) : "not scheduled"}</dd>
          {(s.pickupAddress ?? s.shipper.defaultPickupAddress) && (<><dt className="text-slate-500">Address</dt><dd>{s.pickupAddress ?? s.shipper.defaultPickupAddress}</dd></>)}
          <dt className="text-slate-500">Cargo</dt><dd>{cargo}</dd>
          <dt className="text-slate-500">To</dt><dd>{s.destinationPort}</dd>
        </dl>
      </header>

      <section className="grid grid-cols-2 gap-2 text-sm">
        <div className={`rounded-lg p-3 ${s.actualPickupAt ? "bg-green-100 text-green-900" : "bg-slate-100"}`}>
          <p className="font-medium">Pick-up</p>
          <p>{s.actualPickupAt ? `Done ${formatDateTime(s.actualPickupAt)}` : "Not yet"}</p>
        </div>
        <div className={`rounded-lg p-3 ${s.exportDeclarationStatus === "RELEASED" ? "bg-green-100 text-green-900" : "bg-slate-100"}`}>
          <p className="font-medium">Declaration</p>
          <p>{s.exportDeclarationStatus}</p>
        </div>
      </section>

      <FieldActions action={fieldAction.bind(null, token)} buttons={buttons} />
      <p className="text-center text-xs text-slate-400">Each update is sent to NNR customer service right away.</p>
      {(() => {
        const v = verseOfTheDay(new Date());
        return (
          <p className="px-2 pb-6 text-center text-sm text-amber-900">
            <span className="font-serif italic">{v.text}</span> <span className="whitespace-nowrap font-medium">— {v.ref}</span>
          </p>
        );
      })()}
    </div>
  );
}
