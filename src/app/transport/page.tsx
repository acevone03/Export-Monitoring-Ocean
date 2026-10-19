import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { getTransportEmails } from "@/lib/pickup-instruction";
import { smtpConfigured } from "@/lib/mailer";
import { saveTransportEmailsAction } from "./actions";

export default async function TransportPage() {
  await requireUser(["CS", "SUPERVISOR"]);
  const emails = await getTransportEmails(prisma);
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Transport</h1>
        <p className="text-sm text-slate-600">
          When a shipment is saved, its pick-up instruction (FCL or LCL) is emailed to every address below.
          You can resend it from the shipment page.
        </p>
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">Transport email addresses</h2>
        <ActionForm action={saveTransportEmailsAction} className="space-y-3">
          <textarea
            name="emails"
            rows={5}
            className="input font-mono text-sm"
            defaultValue={emails.join("\n")}
            placeholder={"dispatch@trucking.example\nops@trucking.example"}
            aria-label="Transport email addresses"
          />
          <p className="text-xs text-slate-500">One per line (commas also work). Leave empty to stop sending.</p>
          <button className="btn">Save</button>
        </ActionForm>
      </section>

      {!smtpConfigured() && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Email server (SMTP) is not set up, so instructions go to the dev outbox instead of real inboxes. Set <code>SMTP_*</code> in <code>.env</code> to send for real.
        </p>
      )}
    </div>
  );
}
