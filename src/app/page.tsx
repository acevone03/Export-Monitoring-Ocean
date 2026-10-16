import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";

// Step 1 placeholder: proves auth + seed data. The real live board (filters,
// spreadsheet column order, colour coding, detail timeline) is Step 3.
export default async function Home() {
  const user = await requireUser();
  if (user.role === "FIELD") {
    return (
      <div className="card max-w-lg">
        <h1 className="mb-2 font-semibold">Field updates</h1>
        <p className="text-sm text-slate-600">
          Open the update link CS sends you for each shipment. The links work on your phone without logging in.
        </p>
      </div>
    );
  }

  const shipments = await prisma.shipment.findMany({
    orderBy: { createdAt: "desc" },
    include: { shipper: { select: { name: true } }, assignedCs: { select: { name: true } } },
  });

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Shipments</h1>
        <span className="text-sm text-slate-500">{shipments.length} records</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              {["Job No.", "HBL/HAWB", "Mode", "Shipper", "Destination", "Pick-up", "ETD MNL", "Status", "CS"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shipments.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{s.jobNo}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{s.hblHawbNo}</td>
                <td className="px-3 py-2">{s.mode}</td>
                <td className="px-3 py-2">{s.shipper.name}</td>
                <td className="px-3 py-2">{s.destinationPort}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.requestedPickupAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.etdMnl)}</td>
                <td className="whitespace-nowrap px-3 py-2">{STATUS_LABEL[s.status]}</td>
                <td className="whitespace-nowrap px-3 py-2">{s.assignedCs.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
