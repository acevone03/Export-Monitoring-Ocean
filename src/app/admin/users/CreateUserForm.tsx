"use client";

import { useActionState } from "react";
import { createUserAction, type CreateUserState } from "./actions";

export function CreateUserForm() {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUserAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div><label className="label">Name</label><input name="name" required className="input" /></div>
      <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
      <div>
        <label className="label">Role</label>
        <select name="role" className="input" defaultValue="CS">
          <option value="CS">Customer Service</option>
          <option value="FIELD">Field / Customs</option>
          <option value="SUPERVISOR">Supervisor (manages users, rules, import)</option>
        </select>
      </div>
      <div><label className="label">Job title (optional)</label><input name="title" className="input" placeholder="e.g. CS Export Assistant" /></div>
      <div><label className="label">Phone (optional)</label><input name="phone" className="input" /></div>
      <div className="sm:col-span-2">
        <label className="label">Initial password</label>
        <input name="password" type="password" minLength={10} required className="input" autoComplete="new-password" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn" disabled={pending}>Create user</button>
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
      </div>
    </form>
  );
}
