import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, assertShipmentAccess } from "@/lib/auth";
import { ShipmentForm } from "@/components/ShipmentForm";
import { formOptions, toFormValues } from "../../data";
import { updateShipmentAction } from "../actions";

export default async function EditShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const { id } = await params;
  await assertShipmentAccess(user, id);
  const s = await prisma.shipment.findUnique({ where: { id } }).catch(() => null);
  if (!s) notFound();
  if (s.status === "CLOSED" || s.status === "CANCELLED") redirect(`/shipments/${id}`);
  const { shippers, csUsers, destinations } = await formOptions();
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">Edit <span className="font-mono">{s.jobNo}</span></h1>
        <Link href={`/shipments/${id}`} className="text-sm text-blue-700 hover:underline">Cancel</Link>
      </div>
      <p className="text-sm text-slate-600">
        Milestones (pick-up done, FSI, uploads, payments, departure) are recorded from the shipment page, not here.
        {!s.actualPickupAt && " If you change anything on the pick-up instruction, the revised instruction is emailed to transport when you save."}
      </p>
      <ShipmentForm
        action={updateShipmentAction.bind(null, id)}
        isNew={false}
        submitLabel="Save changes"
        shippers={shippers}
        csUsers={csUsers}
        destinations={destinations}
        initial={toFormValues(s)}
        hblNo={s.hblNo}
        requireInstruction={!s.actualPickupAt}
      />
    </div>
  );
}
