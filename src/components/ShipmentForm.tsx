"use client";

import { useActionState, useRef, useState } from "react";
import type { FieldErrors } from "@/lib/shipment-input";
import { podCodeFor } from "@/lib/pod-codes";
import { CONTAINER_SIZES, CONTAINER_LABEL, PORTS_OF_LOADING, type ContainerSize } from "@/lib/containers";
import { formatInstructionDate, formatInstructionDateTime, parseManilaInput } from "@/lib/time";

// `values` echoes the submitted fields on error: React 19 resets the form after an
// action, and uncontrolled fields reset to their defaultValue, so we feed it back.
export type ShipmentFormState = { error?: string; fieldErrors?: FieldErrors; values?: Record<string, string> };
export type ShipperOption = {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  defaultPickupAddress: string | null;
  defaultArrastre: "NNR" | "SHIPPER";
};
export type CsOption = { id: string; name: string };
type Container = { size: ContainerSize; qty: number };

export type ShipmentFormValues = {
  shipperId: string;
  consigneeName: string;
  pickupAddress: string;
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
  // Pick-up instruction (sent to transport). FCL:
  positioningAt: string; // datetime-local, Manila
  containerYard: string;
  portOfLoading: string;
  cyCutoffAt: string; // date (YYYY-MM-DD)
  // LCL:
  consolidator: string;
  grossWeightKg: string;
  cbm: string;
  cargoDescription: string;
  cargoDimensions: string;
  deliveryWarehouse: string;
  // Both:
  pickupRemarks: string;
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
  /** HBL No. of an existing shipment (edit). New shipments get theirs on save. */
  hblNo?: string | null;
  /** Positioning and port of loading must be filled for FCL (new shipments, and edits before pick-up). */
  requireInstruction?: boolean;
};

export function ShipmentForm({ action, initial, shippers, csUsers, destinations, submitLabel, isNew, flags = {}, initialShipperName, hblNo, requireInstruction = isNew }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const err = state.fieldErrors ?? {};
  const v = (k: keyof ShipmentFormValues) => state.values?.[k] ?? (initial[k] as string);

  const [shipperName, setShipperName] = useState(shippers.find((s) => s.id === initial.shipperId)?.name ?? initialShipperName ?? "");
  const [shipperId, setShipperId] = useState(initial.shipperId);
  const shipper = shippers.find((s) => s.id === shipperId) ?? null;
  // Pick-up address follows the chosen shipper until CS types their own.
  const [pickupAddress, setPickupAddress] = useState(
    initial.pickupAddress || (isNew ? shippers.find((s) => s.id === initial.shipperId)?.defaultPickupAddress ?? "" : ""),
  );
  const [addressTouched, setAddressTouched] = useState(!isNew);
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
  // Container size ticks: qty per size, 0 = not ticked.
  const [qtyBySize, setQtyBySize] = useState<Record<ContainerSize, number>>(() => {
    const q = Object.fromEntries(CONTAINER_SIZES.map((z) => [z, 0])) as Record<ContainerSize, number>;
    for (const c of initial.containerPlan) if (c.size in q) q[c.size] += c.qty;
    return q;
  });
  const containers: Container[] = CONTAINER_SIZES.filter((z) => qtyBySize[z] > 0).map((z) => ({ size: z, qty: qtyBySize[z] }));
  const [positioningPreview, setPositioningPreview] = useState(v("positioningAt"));
  const [cutoffPreview, setCutoffPreview] = useState(v("cyCutoffAt"));

  function pickShipper(typed: string) {
    const t = typed.trim().toLowerCase();
    // Match the name, or the code on its own ("shp-0003", "SHP-0003").
    const match = t ? shippers.find((s) => s.name.toLowerCase() === t || s.code.toLowerCase() === t) ?? null : null;
    setShipperName(match && match.code.toLowerCase() === t ? match.name : typed);
    setShipperId(match?.id ?? "");
    // Default arrastre and pick-up address from the shipper master, unless CS already changed them.
    if (match && !arrastreTouched) setArrastre(match.defaultArrastre);
    if (!addressTouched) setPickupAddress(match?.defaultPickupAddress ?? "");
  }


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
            placeholder="Type a shipper name or code (SHP-0001)"
            autoFocus={isNew}
            autoComplete="off"
            required
          />
          <datalist id="shipper-list">
            {shippers.map((s) => <option key={s.id} value={s.name} label={s.code} />)}
          </datalist>
          {shipper && (
            <p className="mt-1 text-xs text-slate-600">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">{shipper.code}</span>
              {[shipper.contactPerson, shipper.phone, shipper.email].filter(Boolean).map((x) => ` · ${x}`).join("")}
            </p>
          )}
          {shipperName && !shipperId && (
            <p className="mt-1 text-xs text-amber-700">
              Not in the shipper list. Type a name or code (e.g. SHP-0001), or <a href="/shippers" target="_blank" className="underline">add it under Shippers</a>.
            </p>
          )}
        </Field>
        <Field label="Pick-up address" error={err.pickupAddress} span={2}>
          <input
            className="input"
            name="pickupAddress"
            value={pickupAddress}
            maxLength={300}
            placeholder={shipper ? "No default address saved for this shipper" : "Fills in when you pick the shipper"}
            onChange={(e) => {
              setPickupAddress(e.target.value);
              setAddressTouched(true);
            }}
          />
          {shipper?.defaultPickupAddress && pickupAddress !== shipper.defaultPickupAddress && (
            <button
              type="button"
              className="mt-1 text-xs text-blue-700 hover:underline"
              onClick={() => {
                setPickupAddress(shipper.defaultPickupAddress ?? "");
                setAddressTouched(false);
              }}
            >
              Use the shipper&apos;s address
            </button>
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

      <Section title="Cargo and pick-up instruction (sent to transport)">
        <Field label="Cargo type" error={err.cargoType} flag={flags.cargoType}>
          <select className="input" name="cargoType" value={cargoType} onChange={(e) => setCargoType(e.target.value as "FCL" | "LCL")}>
            <option value="FCL">FCL</option>
            <option value="LCL">LCL</option>
          </select>
        </Field>
        <Field label="Booking number" error={err.carrierBookingRef}>
          <input className="input" name="carrierBookingRef" defaultValue={v("carrierBookingRef")} />
        </Field>
        <Field label="HBL" span={2}>
          <p className="input bg-slate-50 font-mono text-slate-600">{hblNo ?? (isNew ? `Assigned on save (NNRMNL${podCode || "___"}${cargoType === "FCL" ? "F" : "L"}…)` : "—")}</p>
        </Field>

        {cargoType === "FCL" ? (
          <>
            <Field label={`Positioning date and time${requireInstruction ? " *" : ""}`} error={err.positioningAt}>
              <input className="input" type="datetime-local" name="positioningAt" required={requireInstruction} defaultValue={v("positioningAt")} onChange={(e) => setPositioningPreview(e.target.value)} />
              {positioningPreview && <p className="mt-1 font-mono text-xs text-slate-500">{formatInstructionDateTime(parseManilaInput(positioningPreview))}</p>}
            </Field>
            <Field label="Container yard" error={err.containerYard}>
              <input className="input" name="containerYard" defaultValue={v("containerYard")} placeholder="Where to get the empty" />
            </Field>
            <Field label={`Port of loading${requireInstruction ? " *" : ""}`} error={err.portOfLoading}>
              <select className="input" name="portOfLoading" required={requireInstruction} defaultValue={v("portOfLoading")}>
                <option value="">Choose…</option>
                {PORTS_OF_LOADING.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Cut-off time" error={err.cyCutoffAt}>
              <input className="input" type="date" name="cyCutoffAt" defaultValue={v("cyCutoffAt")} onChange={(e) => setCutoffPreview(e.target.value)} />
              {cutoffPreview && <p className="mt-1 font-mono text-xs text-slate-500">{formatInstructionDate(parseManilaInput(`${cutoffPreview}T00:00`))}</p>}
            </Field>
            <Field label="Container size (tick and enter how many)" error={err.containerPlan} flag={flags.containerPlan} span={3}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CONTAINER_SIZES.map((z) => {
                  const on = qtyBySize[z] > 0;
                  return (
                    <div key={z} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${on ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => setQtyBySize({ ...qtyBySize, [z]: e.target.checked ? 1 : 0 })}
                        />
                        {CONTAINER_LABEL[z]}
                      </label>
                      <span className="text-slate-400">×</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        aria-label={`How many ${CONTAINER_LABEL[z]}`}
                        className="input w-16 py-1"
                        disabled={!on}
                        value={on ? qtyBySize[z] : ""}
                        onChange={(e) => setQtyBySize({ ...qtyBySize, [z]: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                      />
                    </div>
                  );
                })}
              </div>
              {containers.length > 0 && (
                <p className="mt-1 text-xs text-slate-600">{containers.map((c) => `${c.qty}x${CONTAINER_LABEL[c.size]}`).join(" + ")}</p>
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="Consol" error={err.consolidator}>
              <input className="input" name="consolidator" defaultValue={v("consolidator")} placeholder="Consolidator / co-loader" />
            </Field>
            <Field label="Quantity" error={err.lclQty} flag={flags.lclQty}>
              <div className="flex gap-2">
                <input className="input w-24" type="number" min={1} name="lclQty" defaultValue={v("lclQty")} aria-label="Quantity" />
                <select className="input" name="lclUnit" defaultValue={v("lclUnit") || "PALLET"} aria-label="Unit">
                  <option value="PALLET">Pallets</option>
                  <option value="BOX">Boxes</option>
                </select>
              </div>
            </Field>
            <Field label="GW (kg)" error={err.grossWeightKg}>
              <input className="input" type="number" min={0} step="any" name="grossWeightKg" defaultValue={v("grossWeightKg")} />
            </Field>
            <Field label="CBM" error={err.cbm}>
              <input className="input" type="number" min={0} step="any" name="cbm" defaultValue={v("cbm")} />
            </Field>
            <Field label="Description" error={err.cargoDescription} span={2}>
              <input className="input" name="cargoDescription" defaultValue={v("cargoDescription")} placeholder="e.g. Dried mangoes in cartons" />
            </Field>
            <Field label="Cargo dimension" error={err.cargoDimensions} span={2}>
              <input className="input" name="cargoDimensions" defaultValue={v("cargoDimensions")} placeholder="e.g. 4 pallets @ 120 x 100 x 150 cm" />
            </Field>
            <Field label="Delivery warehouse" error={err.deliveryWarehouse} span={2}>
              <input className="input" name="deliveryWarehouse" defaultValue={v("deliveryWarehouse")} placeholder="CFS / consol warehouse" />
            </Field>
          </>
        )}
        <Field label="Remarks (for transport)" error={err.pickupRemarks} span={cargoType === "FCL" ? 1 : 2}>
          <textarea className="input" rows={2} name="pickupRemarks" defaultValue={v("pickupRemarks")} />
        </Field>
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
