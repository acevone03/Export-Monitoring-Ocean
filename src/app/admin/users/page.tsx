import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CreateUserForm } from "./CreateUserForm";
import { toggleActiveAction } from "./actions";

export default async function UsersPage() {
  const me = await requireUser(["SUPERVISOR"]);
  const users = await prisma.user.findMany({
    where: { role: { not: "CUSTOMER" } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Users</h1>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.active ? "Active" : <span className="text-slate-400">Inactive</span>}</td>
                <td className="px-3 py-2 text-right">
                  {u.id !== me.id && (
                    <form action={toggleActiveAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button className="btn-secondary py-1">{u.active ? "Deactivate" : "Activate"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card">
        <h2 className="mb-3 font-medium">Add user</h2>
        <CreateUserForm />
      </section>
    </div>
  );
}
