import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { createShipperAction } from "./actions";

export default async function ShippersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser(["CS", "SUPERVISOR"]);
  const q = ((await searchParams).q ?? "").trim();
  const all = await prisma.shipper.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { shipments: true } } } });
  const needle = q.toLowerCase();
  const shippers = needle ? all.filter((s) => s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)) : all;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Shippers</h1>
          <p className="text-sm text-slate-600">Each shipper has a permanent code. A name can be added only once (case, punctuation and Inc/Corp are ignored).</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} className="input py-1" placeholder="Search name or code" aria-label="Search shippers" />
          <button className="btn-secondary py-1">Search</button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>{["Code", "Name", "Contact", "Email", "Phone", "Pick-up address", "Arrastre", "Shipments"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shippers.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2">{s.contactPerson}</td>
                <td className="px-3 py-2">{s.email}</td>
                <td className="px-3 py-2">{s.phone}</td>
                <td className="px-3 py-2">{s.defaultPickupAddress}</td>
                <td className="px-3 py-2">{s.defaultArrastre === "NNR" ? "NNR" : "Shipper"}</td>
                <td className="px-3 py-2">{s._count.shipments}</td>
              </tr>
            ))}
            {shippers.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{q ? `No shipper matches "${q}".` : "No shippers yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <section className="card">
        <h2 className="mb-1 font-medium">Add shipper</h2>
        <p className="mb-3 text-xs text-slate-500">The code (SHP-0001, SHP-0002, …) is assigned automatically when you save.</p>
        <ActionForm action={createShipperAction} className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Name</label><input name="name" className="input" required /></div>
          <div><label className="label">Contact person</label><input name="contactPerson" className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">Phone</label><input name="phone" className="input" /></div>
          <div><label className="label">Default pick-up address</label><input name="defaultPickupAddress" className="input" /></div>
          <div>
            <label className="label">Arrastre usually paid by</label>
            <select name="defaultArrastre" className="input" defaultValue="NNR"><option value="NNR">NNR</option><option value="SHIPPER">Shipper</option></select>
          </div>
          <div className="sm:col-span-3"><button className="btn">Add shipper</button></div>
        </ActionForm>
      </section>
    </div>
  );
}
