"use client";

import { useActionState, useRef, useState } from "react";
import type { FieldErrors } from "@/lib/shipment-input";
import { podCodeFor } from "@/lib/pod-codes";

// `values` echoes the submitted fields on error: React 19 resets the form after an
// action, and uncontrolled fields reset to their defaultValue, so we feed it back.
export type ShipmentFormState = { error?: string; fieldErrors?: FieldErrors; values?: Record<string, string> };
export type ShipperOption = { id: string; name: string; defaultArrastre: "NNR" | "SHIPPER" };
export type CsOption = { id: string; name: string };
type Container = { size: "20" | "40" | "40HC"; qty: number };

export type ShipmentFormValues = {
  shipperId: string;
  consigneeName: string;
  destinationPort: string;
  pod: string;
  cargoType: "FCL" | "LCL";
  containerPlan: Container[];
  lclQty: string;
  lclUnit: "" | "PALLET" | "BOX";
  requestedPickupAt: string; // datetime-local, Manila
  fsiCutoffAt: string;
  preadviseCutoffAt: string;
  etdMnl: string;
  eta: string;
  arrastreResponsibility: "NNR" | "SHIPPER";
  carrierName: string;
  carrierBookingRef: string;
  carrierRemarks: string;
  assignedCsId: string;
  arrastreCutoffAt: string;
  podCode: string;
  declarationBy: "NNR" | "SHIPPER";
  declarationForwarder: string;
  partOfHblNo: string;
};

type Props = {
  action: (prev: ShipmentFormState, form: FormData) => Promise<ShipmentFormState>;
  initial: ShipmentFormValues;
  shippers: ShipperOption[];
  csUsers: CsOption[];
  destinations: string[];
  submitLabel: string;
  isNew: boolean;
  /** Review highlights (AI intake): field -> note. Highlighted fields need a human look. */
  flags?: Partial<Record<keyof ShipmentFormValues, string>>;
  /** Shipper text to show when no shipper matched (e.g. the name as written in the email). */
  initialShipperName?: string;
};

export function ShipmentForm({ action, initial, shippers, csUsers, destinations, submitLabel, isNew, flags = {}, initialShipperName }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const err = state.fieldErrors ?? {};
  const v = (k: keyof ShipmentFormValues) => state.values?.[k] ?? (initial[k] as string);

  const [shipperName, setShipperName] = useState(shippers.find((s) => s.id === initial.shipperId)?.name ?? initialShipperName ?? "");
  const [shipperId, setShipperId] = useState(initial.shipperId);
  const [arrastre, setArrastre] = useState(initial.arrastreResponsibility);
  // HBL destination code follows the destination/POD until CS types their own.
  const [podCode, setPodCode] = useState(initial.podCode || podCodeFor(initial.pod) || podCodeFor(initial.destinationPort) || "");
  const [podTouched, setPodTouched] = useState(!!initial.podCode && !isNew);
  const suggestCode = (form: HTMLFormElement | null) => {
    if (podTouched || !form || !isNew) return;
    const pod = (form.elements.namedItem("pod") as HTMLInputElement | null)?.value;
    const dest = (form.elements.namedItem("destinationPort") as HTMLInputElement | null)?.value;
    setPodCode(podCodeFor(pod) || podCodeFor(dest) || "");
  };
  const [arrastreTouched, setArrastreTouched] = useState(!isNew);
  const [cargoType, setCargoType] = useState(initial.cargoType);
  const [containers, setContainers] = useState<Container[]>(
    initial.containerPlan.length ? initial.containerPlan : [{ size: "40HC", qty: 1 }],
  );

  function pickShipper(name: string) {
    setShipperName(name);
    const match = shippers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    setShipperId(match?.id ?? "");
    // Default arrastre from the shipper master, unless CS already chose one.
    if (match && !arrastreTouched) setArrastre(match.defaultArrastre);
  }

  const usedSizes = new Set(containers.map((c) => c.size));
  const nextFreeSize = (["40HC", "40", "20"] as const).find((s) => !usedSizes.has(s));

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) formRef.current?.requestSubmit();
      }}
    >
      <input type="hidden" name="shipperId" value={shipperId} />
      <input type="hidden" name="containerPlan" value={cargoType === "FCL" ? JSON.stringify(containers) : "[]"} />

      <Section title="Booking">
        <Field label="Shipper" error={err.shipperId} flag={flags.shipperId} span={2}>
          <input
            className="input"
            list="shipper-list"
            value={shipperName}
            onChange={(e) => pickShipper(e.target.value)}
            placeholder="Start typing a shipper name"
            autoFocus={isNew}
            autoComplete="off"
            required
          />
          <datalist id="shipper-list">
            {shippers.map((s) => <option key={s.id} value={s.name} />)}
          </datalist>
          {shipperName && !shipperId && (
            <p className="mt-1 text-xs text-amber-700">Not in the shipper list. Pick an existing shipper or add it under Shippers.</p>
          )}
        </Field>
        <Field label="Consignee (optional)" error={err.consigneeName} span={2}>
          <input className="input" name="consigneeName" defaultValue={v("consigneeName")} />
        </Field>
        <Field label="Destination" error={err.destinationPort} flag={flags.destinationPort} span={2}>
          <input className="input" name="destinationPort" list="dest-list" defaultValue={v("destinationPort")} placeholder="e.g. TOKYO or JPTYO Tokyo" required autoComplete="off" onChange={(e) => suggestCode(e.currentTarget.form)} />
        </Field>
        <Field label="Port of discharge" error={err.pod} flag={flags.pod} span={2}>
          <input className="input" name="pod" list="dest-list" defaultValue={v("pod")} placeholder="e.g. USLGB Long Beach" required autoComplete="off" onChange={(e) => suggestCode(e.currentTarget.form)} />
        </Field>
        <Field label="HBL destination code" error={err.podCode} flag={flags.podCode}>
          <input
            className="input font-mono uppercase"
            name="podCode"
            value={podCode}
            maxLength={3}
            placeholder="e.g. TYO"
            onChange={(e) => {
              setPodCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""));
              setPodTouched(true);
            }}
          />
          <p className="mt-1 text-xs text-slate-500">{isNew ? "Used in the HBL No. (NNRMNL" + (podCode || "___") + "F…)." : "Changing it does not change the issued HBL No."}</p>
        </Field>
        <Field label="Part of HBL (split shipment, optional)" error={err.partOfHblNo}>
          <input className="input font-mono uppercase" name="partOfHblNo" defaultValue={v("partOfHblNo")} placeholder="e.g. NNRMNLNGOF8665" />
        </Field>
        <datalist id="dest-list">
          {destinations.map((d) => <option key={d} value={d} />)}
        </datalist>
      </Section>

      <Section title="Cargo">
        <Field label="Cargo type" error={err.cargoType} flag={flags.cargoType}>
          <select className="input" name="cargoType" value={cargoType} onChange={(e) => setCargoType(e.target.value as "FCL" | "LCL")}>
            <option value="FCL">FCL</option>
            <option value="LCL">LCL</option>
          </select>
        </Field>
        {cargoType === "FCL" ? (
          <Field label="Containers" error={err.containerPlan} flag={flags.containerPlan} span={3}>
            <div className="space-y-2">
              {containers.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    aria-label="Quantity"
                    className="input w-20"
                    value={c.qty}
                    onChange={(e) => setContainers(containers.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))}
                  />
                  <span className="text-slate-500">×</span>
                  <select
                    aria-label="Container size"
                    className="input w-28"
                    value={c.size}
                    onChange={(e) => setContainers(containers.map((x, j) => (j === i ? { ...x, size: e.target.value as Container["size"] } : x)))}
                  >
                    <option value="20">20&apos;</option>
                    <option value="40">40&apos;</option>
                    <option value="40HC">40&apos; HC</option>
                  </select>
                  {containers.length > 1 && (
                    <button type="button" className="text-sm text-slate-500 hover:text-red-700" onClick={() => setContainers(containers.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {nextFreeSize && (
                <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setContainers([...containers, { size: nextFreeSize, qty: 1 }])}>
                  + Add another size
                </button>
              )}
            </div>
          </Field>
        ) : (
          <>
            <Field label="LCL quantity" error={err.lclQty} flag={flags.lclQty}>
              <input className="input" type="number" min={1} name="lclQty" defaultValue={v("lclQty")} />
            </Field>
            <Field label="Unit">
              <select className="input" name="lclUnit" defaultValue={v("lclUnit") || "PALLET"}>
                <option value="PALLET">Pallets</option>
                <option value="BOX">Boxes</option>
              </select>
            </Field>
          </>
        )}
      </Section>

      <Section title="Schedule and cut-offs (Manila time)">
        <Field label="Requested pick-up" error={err.requestedPickupAt} flag={flags.requestedPickupAt}>
          <input className="input" type="datetime-local" name="requestedPickupAt" defaultValue={v("requestedPickupAt")} />
        </Field>
        <Field label="FSI cut-off" error={err.fsiCutoffAt}>
          <input className="input" type="datetime-local" name="fsiCutoffAt" defaultValue={v("fsiCutoffAt")} />
        </Field>
        <Field label="Pre-advise cut-off" error={err.preadviseCutoffAt}>
          <input className="input" type="datetime-local" name="preadviseCutoffAt" defaultValue={v("preadviseCutoffAt")} />
        </Field>
        <Field label="Arrastre cut-off" error={err.arrastreCutoffAt}>
          <input className="input" type="datetime-local" name="arrastreCutoffAt" defaultValue={v("arrastreCutoffAt")} />
        </Field>
        <Field label="ETD MNL" error={err.etdMnl}>
          <input className="input" type="datetime-local" name="etdMnl" defaultValue={v("etdMnl")} />
        </Field>
        <Field label="ETA" error={err.eta}>
          <input className="input" type="datetime-local" name="eta" defaultValue={v("eta")} />
        </Field>
      </Section>

      <Section title="Carrier">
        <Field label="Shipping line / co-loader" error={err.carrierName}>
          <input className="input" name="carrierName" defaultValue={v("carrierName")} />
        </Field>
        <Field label="Booking no." error={err.carrierBookingRef}>
          <input className="input" name="carrierBookingRef" defaultValue={v("carrierBookingRef")} />
        </Field>
        <Field label="Remarks" error={err.carrierRemarks} span={2}>
          <input className="input" name="carrierRemarks" defaultValue={v("carrierRemarks")} />
        </Field>
      </Section>

      <Section title="Responsibility">
        <Field label="Arrastre paid by" error={err.arrastreResponsibility}>
          <select
            className="input"
            name="arrastreResponsibility"
            value={arrastre}
            onChange={(e) => {
              setArrastre(e.target.value as "NNR" | "SHIPPER");
              setArrastreTouched(true);
            }}
          >
            <option value="NNR">NNR</option>
            <option value="SHIPPER">Shipper</option>
          </select>
        </Field>
        <Field label="Export declaration c/o" error={err.declarationBy}>
          <select className="input" name="declarationBy" defaultValue={v("declarationBy") || "NNR"}>
            <option value="NNR">NNR</option>
            <option value="SHIPPER">Shipper</option>
          </select>
        </Field>
        <Field label="Declaration via forwarder (optional)" error={err.declarationForwarder}>
          <input className="input" name="declarationForwarder" defaultValue={v("declarationForwarder")} placeholder="e.g. AAI" />
        </Field>
        <Field label="Assigned CS" error={err.assignedCsId}>
          <select className="input" name="assignedCsId" defaultValue={v("assignedCsId")} required>
            <option value="">Choose…</option>
            {csUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        <span className="text-xs text-slate-500">Ctrl/⌘ + Enter to save</span>
        {(state.error || Object.keys(err).length > 0) && (
          <span className="text-sm text-red-700" role="alert">{state.error ?? "Please fix the highlighted fields."}</span>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card">
      <legend className="px-1 text-sm font-semibold text-slate-700">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </fieldset>
  );
}

function Field({ label, error, flag, span = 1, children }: { label: string; error?: string; flag?: string; span?: 1 | 2 | 3; children: React.ReactNode }) {
  const spans = { 1: "", 2: "lg:col-span-2", 3: "sm:col-span-2 lg:col-span-3" };
  return (
    <div className={`${spans[span]} ${flag ? "-m-1.5 rounded-md bg-amber-50 p-1.5 ring-2 ring-amber-400" : ""}`}>
      <label className="label">{label}{flag && <span className="ml-1 text-amber-700" aria-hidden>⚠</span>}</label>
      {children}
      {flag && <p className="mt-1 text-xs text-amber-800">{flag}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
