import { prisma } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { changePasswordAction } from "./actions";

export default async function AccountPage() {
  const me = await requireUser(STAFF_ROLES);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { name: true, email: true, role: true, title: true } });
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold">My account</h1>
        <p className="text-sm text-slate-600">
          {user.name}{user.title ? ` · ${user.title}` : ""} · {user.email} · {user.role}
        </p>
      </div>
      <section className="card">
        <h2 className="mb-3 font-medium">Change password</h2>
        <ActionForm action={changePasswordAction} className="space-y-3">
          <div><label className="label">Current password</label><input name="current" type="password" required className="input" autoComplete="current-password" /></div>
          <div><label className="label">New password (at least 10 characters)</label><input name="next" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
          <div><label className="label">New password again</label><input name="confirm" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
          <button className="btn">Change password</button>
        </ActionForm>
      </section>
    </div>
  );
}
