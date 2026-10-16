"use client";

import { useActionState } from "react";

type State = { ok?: string; error?: string };

/** Small inline form for one action, showing its own error/success message. */
export function ActionForm({
  action,
  children,
  className = "",
}: {
  action: (prev: State, form: FormData) => Promise<State>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state.error && <p className="mt-1 w-full text-xs text-red-700" role="alert">{state.error}</p>}
      {state.ok && !state.error && <p className="mt-1 w-full text-xs text-green-700">{state.ok}</p>}
    </form>
  );
}
