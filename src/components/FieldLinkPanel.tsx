"use client";

import { useActionState, useRef, useState } from "react";
import type { FieldLinkState } from "@/app/shipments/[id]/actions";

type Props = {
  shipmentId: string;
  jobNo: string;
  fieldUsers: Array<{ id: string; name: string; phone: string | null }>;
  action: (prev: FieldLinkState, form: FormData) => Promise<FieldLinkState>;
};

/** Generates a field update link. The full URL exists only here, right after creation. */
export function FieldLinkPanel({ shipmentId, jobNo, fieldUsers, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [assignee, setAssignee] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const phone = fieldUsers.find((u) => u.id === assignee)?.phone ?? "";
  const message = state.url ? `NNR ${jobNo}: tap to update pick-up / declaration: ${state.url}` : "";

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <select name="assigneeId" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input w-auto py-1" aria-label="Field person">
          <option value="">Any field person</option>
          {fieldUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="btn-secondary py-1" disabled={pending}>{pending ? "Creating…" : "Create field link"}</button>
      </form>
      {state.error && <p className="text-xs text-red-700" role="alert">{state.error}</p>}
      {state.url && (
        <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs text-blue-900">
            Link{state.forName ? ` for ${state.forName}` : ""}, valid until {state.expiresAt}. Copy it now: for security it is not shown again.
          </p>
          <input ref={inputRef} readOnly value={state.url} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Field link" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn py-1"
              onClick={async () => {
                if (await copyText(state.url!, inputRef.current)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a className="btn-secondary py-1" href={`sms:${phone}?&body=${encodeURIComponent(message)}`}>Send by SMS</a>
            <a className="btn-secondary py-1" href={`viber://forward?text=${encodeURIComponent(message)}`}>Send by Viber</a>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Clipboard API only exists on HTTPS or localhost. An office server reached over plain
 * http://192.168.x.x has none, so fall back to selecting the text and execCommand("copy").
 */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  if (!input) return false;
  input.focus();
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false; // the text stays selected so the user can copy it manually
  }
}
