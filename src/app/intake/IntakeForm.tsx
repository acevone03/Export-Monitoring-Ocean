"use client";

import { useActionState } from "react";
import { createIntakeAction, type IntakeState } from "./actions";

export function IntakeForm() {
  const [state, action, pending] = useActionState<IntakeState, FormData>(createIntakeAction, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Customer email (paste the whole message, including the date line if possible)</span>
        <textarea name="rawText" rows={14} required className="input font-mono text-sm" placeholder={"From: ...\nSubject: Booking request\n\nHi NNR, please book 2x40HC to Los Angeles, pick-up next Tuesday 9am..."} />
      </label>
      <label className="block">
        <span className="label">Attachment text (optional: copy text from a PDF/Excel booking form)</span>
        <textarea name="attachmentText" rows={4} className="input font-mono text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Reading the email…" : "Extract booking details"}</button>
        <span className="text-xs text-slate-500">Nothing is saved as a shipment until you review and confirm.</span>
      </div>
      {state.error && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
    </form>
  );
}
