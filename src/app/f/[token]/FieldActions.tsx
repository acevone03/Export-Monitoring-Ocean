"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FieldState } from "./actions";

type ActionDef = { action: "PICKED_UP" | "DECLARATION_FILED" | "DECLARATION_RELEASED"; label: string; tone: string };

/** Big buttons; each needs a second tap within 5 s, so a stray tap in a pocket does not count. */
export function FieldActions({ action, buttons }: { action: (p: FieldState, f: FormData) => Promise<FieldState>; buttons: ActionDef[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
    setArmed(null);
  }, [state]);

  function arm(e: React.MouseEvent, key: string) {
    if (armed === key) return; // second tap: let the form submit
    e.preventDefault();
    setArmed(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(null), 5000);
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state.ok && <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-lg font-medium text-green-900">✓ {state.ok}</p>}
      {state.error && <p role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-base font-medium text-red-900">{state.error}</p>}

      <div className="space-y-3">
        {buttons.map((b) => (
          <button
            key={b.action}
            name="action"
            value={b.action}
            disabled={pending}
            onClick={(e) => arm(e, b.action)}
            className={`block w-full rounded-xl px-4 py-5 text-xl font-semibold text-white shadow disabled:opacity-60 ${armed === b.action ? "bg-slate-900 ring-4 ring-amber-400" : b.tone}`}
          >
            {armed === b.action ? `Tap again to confirm: ${b.label}` : b.label}
          </button>
        ))}
        {buttons.length === 0 && (
          <p className="rounded-lg bg-slate-100 px-4 py-3 text-slate-700">Pick-up and declaration are all done. You can still send a note or photo below.</p>
        )}
      </div>

      <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium text-slate-600">Optional: note or photo</legend>
        <textarea name="note" rows={3} maxLength={500} placeholder="e.g. Truck arrived 9:10, 2 units loaded" className="input text-base" />
        <label className="block text-base">
          <span className="mb-1 block text-sm text-slate-600">Photo</span>
          <input type="file" name="photo" accept="image/*" capture="environment" className="block w-full text-base" />
        </label>
        <button name="action" value="NOTE" disabled={pending} className="btn-secondary w-full py-3 text-base">
          {pending ? "Sending…" : "Send note / photo only"}
        </button>
      </fieldset>
    </form>
  );
}
