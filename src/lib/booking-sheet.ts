import type { Shipment, Shipper } from "@prisma/client";
import { containerPlanText } from "./containers";
import { positioningDates } from "./positioning";
import { formatDate, formatDateTime, formatInstructionDate, formatInstructionDateTime } from "./time";

// Ocean Export Booking Sheet: NNR's paper form (BOOKING SHEET 2024), printed from a shipment.
// Laid out like the Excel original on one US Letter page; the browser's print dialog saves it as PDF.
// Fields the system does not track (vessel, notify, incoterms, tariffs, checklists…) print blank for
// the team to write in, as on the paper form.

export type BookingSheetShipment = Shipment & {
  shipper: Pick<Shipper, "code" | "name" | "contactPerson" | "phone" | "defaultPickupAddress">;
  assignedCs: { name: string };
};

export type BookingSheetData = {
  office: string;
  date: string;
  pic: string;
  load: string;
  hblNo: string;
  bookingNo: string;
  placeOfLoading: string;
  portOfDischarge: string;
  shipperBookDate: string;
  pickupDate: string;
  finalDestination: string;
  carrierCutoff: string;
  fsiCutoff: string;
  edArrastreCutoff: string;
  shipper: string;
  shipperLines: string[];
  carrier: string;
  consignee: string;
  etd: string;
  onboardDate: string;
  eta: string;
  transitTime: string;
  routing: string;
  consolWarehouse: string;
  commodity: string;
  vesselVoyage: string;
  prepaid: boolean;
  collect: boolean;
  incoterm: string;
  invoiceNo: string;
  nnrPickup: boolean;
  shipperDelivery: boolean;
  cargoDimensions: string;
  numberOfCases: string;
  grossWeight: string;
  cbm: string;
  handling: string[];
  billingInvoiceNo: string;
  footer: string;
};

const num = (n: number | null, unit: string) => (n === null ? "" : `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unit}`);

/**
 * One box for both cut-offs (NNR, 19-Oct-2026): the arrastre cut-off when NNR pays arrastre, otherwise the
 * ED (export declaration) cut-off, i.e. the BOC portal upload deadline. Both are shown if they differ.
 */
function edArrastre(s: BookingSheetShipment): string {
  const ed = formatInstructionDateTime(s.bocDeadlineAt);
  const arr = s.arrastreResponsibility === "SHIPPER" ? "" : formatInstructionDateTime(s.arrastreDeadlineAt ?? s.arrastreCutoffAt);
  if (ed && arr && ed !== arr) return `ED ${ed}\nARR ${arr}`;
  return arr || ed;
}

export function bookingSheetData(s: BookingSheetShipment, printedAt: Date): BookingSheetData {
  const fcl = s.cargoType === "FCL";
  const plan = containerPlanText(s.containerPlan as Array<{ size: string; qty: number }> | null);
  const qty = s.lclQty ? `${s.lclQty} ${s.lclUnit === "BOX" ? (s.lclQty === 1 ? "BOX" : "BOXES") : s.lclQty === 1 ? "PALLET" : "PALLETS"}` : "";
  const days = s.etdMnl && s.eta ? Math.round((s.eta.getTime() - s.etdMnl.getTime()) / 86_400_000) : null;
  const address = s.pickupAddress ?? s.shipper.defaultPickupAddress;
  const contact = [s.shipper.contactPerson, s.shipper.phone].filter(Boolean).join(" · ");
  return {
    office: "MANILA",
    date: formatInstructionDate(s.createdAt),
    pic: s.assignedCs.name.toUpperCase(),
    load: fcl ? `FCL ${plan}`.trim() : `LCL ${qty}`.trim(),
    hblNo: s.hblNo ? `${s.hblNo}${s.hblType === "DIRECT" ? "  (DIRECT)" : ""}` : "",
    bookingNo: s.carrierBookingRef ?? "",
    placeOfLoading: s.portOfLoading ? `MNL · ${s.portOfLoading}` : "MNL",
    portOfDischarge: s.pod,
    shipperBookDate: formatInstructionDate(s.createdAt),
    pickupDate: formatInstructionDateTime(s.requestedPickupAt),
    finalDestination: s.destinationPort,
    carrierCutoff: fcl ? formatInstructionDate(s.cyCutoffAt) : "",
    fsiCutoff: formatInstructionDateTime(s.fsiCutoffAt),
    edArrastreCutoff: edArrastre(s),
    shipper: `${s.shipper.name}`,
    shipperLines: [address, contact].filter((x): x is string => !!x),
    carrier: [s.carrierName, !fcl ? s.consolidator : null].filter(Boolean).join(" / "),
    consignee: s.consigneeName ?? "",
    etd: formatInstructionDate(s.etdMnl),
    onboardDate: formatInstructionDate(s.atdMnl),
    eta: formatInstructionDate(s.eta),
    transitTime: days !== null && days >= 0 ? `${days} DAY${days === 1 ? "" : "S"}` : "",
    routing: `MANILA - ${s.pod}`.toUpperCase(),
    consolWarehouse: fcl ? "" : s.deliveryWarehouse ?? "",
    commodity: s.cargoDescription ?? "",
    vesselVoyage: [s.vesselName, s.voyageNo ? `V.${s.voyageNo}` : null].filter(Boolean).join(" "),
    prepaid: s.freightTerms === "PREPAID",
    collect: s.freightTerms === "COLLECT",
    incoterm: s.incoterm ?? "",
    invoiceNo: "",
    // "Delivered by consignee" on the form ticks the paper form's delivery box.
    nnrPickup: s.cargoArrangement !== "CONSIGNEE_DELIVERY",
    shipperDelivery: s.cargoArrangement === "CONSIGNEE_DELIVERY",
    cargoDimensions: s.cargoDimensions ?? "",
    numberOfCases: fcl ? plan : qty,
    grossWeight: num(s.grossWeightKg, "KGS"),
    cbm: num(s.cbm, "CBM"),
    handling: [
      fcl && s.positioningAt
        ? `Positioning: ${positioningDates(s).map(formatInstructionDateTime).join(", ")}${s.containerYard ? ` at ${s.containerYard}` : ""}`
        : null,
      s.hasCoo ? "Certificate of Origin (COO): YES" : null,
      s.pickupRemarks,
      s.carrierRemarks,
    ].filter((x): x is string => !!x),
    billingInvoiceNo: s.invoiceNo ?? "",
    footer: `Job No. ${s.jobNo} · Shipper ${s.shipper.code} · Printed ${formatDateTime(printedAt)} from NNR Export Monitor`,
  };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const v = (t: string) => (t ? `<div class="v">${esc(t)}</div>` : "");
const box = (on: boolean) => `<span class="cb${on ? " on" : ""}">${on ? "✓" : ""}</span>`;

/** A labelled cell: small label top-left, value below. */
const cell = (label: string, value: string, cls = "", style = "") =>
  `<div class="c ${cls}" style="${style}"><div class="l">${label}</div>${v(value)}</div>`;

const TRANSACTIONS = [
  "Notified Agent (IF APPLICABLE)", "Booked to Freight Movers", "Sailing Details Received", "Send Sailing Details to Shipper",
  "Received Draft B/L", "Send Draft B/L to Shipper", "Draft B/L Approved by Shipper", "ISF / AFR (If Required)",
  "Final B/L Received", "Send Final B/L to Shipper",
];
const EXPORT_DOCS = ["INVOICE", "PACKING LIST", "EXPORT DECLARATION", 'MATERIAL SAFETY DATA SHEET "MSDS" (IF NECESSARY)', "CERTIFICATE OF NON-DANGEROUS GOODS (IF NECESSARY)", ""];
const HBL_CHECK = ["Shipper's Name, Address", "Consignee's name, Address", "Shipment Term", "Destination", "Number of Package/Container", "Commodity", "Invoice Number", "Gross Weight", "CBM (M3)", "Container Number", "Seal Number", ""];
const OPS = [
  "Making Draft HBL", "Sending Draft HBL to CS", "Making Shipping Instruction (S/I)", "Sending (S/I) to Shipping Line",
  'Approved House Bill of Lading "HBL"', "Received Draft MBL", "Checking Draft MBL vs HBL", "Encoding on POWERNET",
  "Sending PRE-ALERT", "CO-LOADER OR CARRIER BILLING ON HAND", "ISSUE BILLING INVOICE", "CUSTOMS BROKER BILLING ON HAND (IF APPLICABLE)",
];

const CSS = `
@page { size: letter portrait; margin: 0.3in; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e5e7eb; color: #000; font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; color-scheme: light; }
.toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; justify-content: center; padding: 10px; background: #1e3a8a; color: #fff; font-size: 14px; }
.toolbar button, .toolbar a { font: inherit; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; text-decoration: none; }
.toolbar button { background: #fff; color: #1e3a8a; font-weight: 700; }
.toolbar a { color: #fff; border: 1px solid #93c5fd; }
.page { width: 7.9in; margin: 16px auto; background: #fff; padding: 0; box-shadow: 0 1px 6px rgba(0,0,0,.25); }
.sheet { border: 3px solid #000; font-size: 7pt; line-height: 1.15; break-inside: avoid; }
.title { background: #000; color: #fff; text-align: center; font-weight: 700; font-size: 11pt; padding: 3px 0; }
.note { font-weight: 700; font-size: 8pt; padding: 1px 3px; border-bottom: 1px solid #000; }
.row { display: flex; border-bottom: 1px solid #000; }
.c { border-right: 1px solid #000; padding: 1px 3px; min-height: 26px; }
.c:last-child { border-right: 0; }
.l { font-size: 5.6pt; text-transform: none; }
.lb { font-weight: 700; }
.v { font-size: 8.5pt; font-weight: 700; color: #0b2a6b; padding-top: 1px; word-break: break-word; }
.big .v { font-size: 12pt; text-align: center; }
.cut .v { font-size: 7.5pt; white-space: pre; }
.cut .l { font-size: 5pt; }
.sub { font-size: 7pt; font-weight: 400; color: #0b2a6b; }
.cols { display: flex; border-bottom: 2px solid #000; }
.left { width: 48%; border-right: 1px solid #000; }
.right { width: 52%; }
.blk { border-bottom: 1px solid #000; padding: 1px 3px; }
.bar { background: #000; color: #fff; font-weight: 700; text-align: center; font-size: 6.5pt; padding: 1px 0; }
.red { color: #dc2626; font-weight: 700; }
.cb { display: inline-flex; align-items: center; justify-content: center; width: 10px; height: 10px; border: 1px solid #000; font-size: 8px; line-height: 1; vertical-align: middle; }
.cb.on { font-weight: 700; color: #0b2a6b; }
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid #000; padding: 1px 3px; height: 14px; font-size: 6.6pt; }
.dash td { border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
.tx td:first-child { font-weight: 700; }
.ops td { height: 12px; font-size: 6pt; padding: 0 3px; }
.gray { background: #d9d9d9; }
.footer { text-align: right; font-size: 6pt; color: #444; padding: 1px 4px; }
@media print {
  html, body { background: #fff; }
  .toolbar { display: none; }
  .page { margin: 0; box-shadow: none; width: auto; }
}
`;

export function bookingSheetHtml(d: BookingSheetData, backHref: string): string {
  const handling = d.handling.map((h) => `<div class="v">${esc(h)}</div>`).join("");
  const dims = d.cargoDimensions
    ? `<tr><td colspan="3" style="height:auto"><span class="v">${esc(d.cargoDimensions)}</span></td></tr>`
    : "";
  const dimRow = `<tr>${["", "", ""].map(() => `<td style="text-align:center;letter-spacing:6px">&nbsp;X&nbsp;&nbsp;X&nbsp;(&nbsp;&nbsp;)&nbsp;;</td>`).join("")}</tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Booking sheet ${esc(d.hblNo || d.bookingNo)}</title><style>${CSS}</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">🖨️ Print / Save as PDF</button><a href="${esc(backHref)}">← Back to shipment</a>
<span style="opacity:.85;font-size:12px">In the print window choose “Save as PDF” as the printer to get a PDF file.</span></div>
<div class="page"><div class="sheet">
  <div class="title">OCEAN EXPORT BOOKING SHEET</div>
  <div class="note">NOTE: This Portion To Be Filled Up By Customer Service Team</div>
  <div class="row">
    ${cell("OFFICE", d.office, "", "width:8.5%")}
    ${cell("DATE", d.date, "", "width:20.6%")}
    ${cell("PIC", d.pic, "big", "width:35.5%")}
    ${cell("LOAD (FCL or LCL)", d.load, "", "width:35.4%")}
  </div>
  <div class="row">
    ${cell('<span class="lb">HBL No.</span>', d.hblNo, "", "width:29.1%;min-height:30px")}
    ${cell('<span class="lb">BOOKING No.</span>', d.bookingNo, "", "width:25.9%")}
    ${cell("Place of Loading", d.placeOfLoading, "", "width:15%")}
    ${cell("Port of Discharge", d.portOfDischarge, "", "width:30%")}
  </div>
  <div class="row">
    ${cell('<span class="lb">Shipper Book Date</span>', d.shipperBookDate, "", "width:12.3%;min-height:30px")}
    ${cell('<span class="lb">Pick Up Date</span>', d.pickupDate, "", "width:21.2%")}
    ${cell('<span class="lb">Final Destination</span>', d.finalDestination, "", "width:20.5%")}
    ${cell("CARRIER CUT OFF DATE AND TIME", d.carrierCutoff, "cut", "width:15.6%")}
    ${cell("FSI CUT OFF DATE AND TIME", d.fsiCutoff, "cut", "width:15.2%")}
    ${cell("ED &amp; ARRASTRE CUT OFF", d.edArrastreCutoff, "cut", "width:15.2%")}
  </div>
  <div class="row">
    <div class="c" style="width:48%;min-height:30px"><div class="l lb">SHIPPER</div>${v(d.shipper)}${d.shipperLines.map((x) => `<div class="sub">${esc(x)}</div>`).join("")}</div>
    ${cell('<span class="lb">CARRIER / CONSOLIDATOR</span>', d.carrier, "", "width:22%")}
    ${cell('<span class="lb">VESSEL NAME AND VOYAGE#</span>', d.vesselVoyage, "", "width:30%")}
  </div>
  <div class="row">
    ${cell('<span class="lb">CONSIGNEE</span>', d.consignee, "", "width:48%;min-height:30px")}
    ${cell("ETD", d.etd, "", "width:16.6%")}
    ${cell("ONBOARD DATE", d.onboardDate, "", "width:21.8%")}
    ${cell("ETA", d.eta, "", "width:13.6%")}
  </div>
  <div class="row">
    ${cell("NOTIFY", "", "", "width:48%;min-height:30px")}
    ${cell("TRANSIT TIME", d.transitTime, "", "width:22%")}
    ${cell("ROUTING", d.routing, "", "width:30%")}
  </div>
  <div class="row">
    ${cell("C/Vessel", "", "", "width:32.5%;min-height:20px")}
    ${cell("C/Vessel ETD", "", "", "width:32.3%")}
    ${cell("C/Vessel ETA", "", "", "width:35.2%")}
  </div>

  <div class="cols">
    <div class="left">
      <div class="blk" style="min-height:22px"><div class="l" style="font-size:6.5pt">Warehouse Receipt Date</div></div>
      <div class="blk" style="min-height:22px"><div class="l" style="font-size:6.5pt">Consolidators Warehouse Name</div>${v(d.consolWarehouse)}</div>
      <div class="blk" style="min-height:30px"><span class="red">COMMODITY:</span>${v(d.commodity)}</div>
      <div class="blk lb" style="min-height:38px">PURCHASE ORDER NO. / S.O. NO.</div>
      <div class="blk lb" style="min-height:34px">IDS No. (SUNPOWER SHIPMENT ONLY)</div>
      <div class="blk lb" style="min-height:30px">INVOICE NO:${v(d.invoiceNo)}</div>
      <table class="dash"><tr><td class="bar" style="width:49%">CONTAINER No.:</td><td class="bar">SEAL No.:</td></tr>
        ${"<tr><td></td><td></td></tr>".repeat(5)}</table>
      <div class="blk" style="display:flex;gap:6px;align-items:center;min-height:30px">
        <div style="line-height:1.6"><div class="lb">NNR PICK-UP ${box(d.nnrPickup)}</div><div class="lb">SHIPPER'S DELIVERY ${box(d.shipperDelivery)}</div></div>
      </div>
      <div><span class="bar" style="display:inline-block;padding:1px 8px">CARGO DIMENSION (CM)</span></div>
      <table class="dash">${dims}${dimRow.repeat(d.cargoDimensions ? 3 : 4)}</table>
      <div class="bar">SPECIAL INSTRUCTION FOR MAKING BILLING INVOICE</div>
      <div style="min-height:46px"></div>
    </div>
    <div class="right">
      <div class="row" style="min-height:44px">
        <div class="c" style="width:22%;display:flex;flex-direction:column;justify-content:space-around;font-weight:700">
          <div>${box(d.prepaid)} PREPAID</div><div>${box(d.collect)} COLLECT</div></div>
        <div class="c lb" style="width:16%;text-align:center">INCOTERMS${d.incoterm ? `<div class="v" style="font-size:11pt;padding-top:6px">${esc(d.incoterm)}</div>` : ""}</div>
        <div class="c lb" style="width:31%;text-align:center">ACCESORIAL TARIFF</div>
        <div class="c lb" style="width:31%;text-align:center">FREIGHT TARIFF</div>
      </div>
      <div class="blk lb" style="min-height:30px">PROFIT SHARE (P/S)</div>
      <table class="tx"><tr><td class="bar" style="width:48%">Transaction Details</td><td class="bar" style="width:26%">DATE</td><td class="bar"></td></tr>
        ${TRANSACTIONS.map((t) => `<tr><td style="height:18px">${t}<span style="float:right">${box(false)}</span></td><td></td><td></td></tr>`).join("")}</table>
      <div class="bar" style="height:7px"></div>
      <div class="row"><div class="c lb" style="width:70%">Number of Case / Container${v(d.numberOfCases)}</div><div class="c lb" style="width:30%">VGM</div></div>
      <div class="row"><div class="c lb" style="width:70%">Total Gross Weight${v(d.grossWeight)}</div><div class="c lb" style="width:30%">Total M3 (CBM)${v(d.cbm)}</div></div>
      <div class="bar">HANDLING INSTRUCTION AND OTHER INFORMATION ( AS NEEDED)</div>
      <div style="min-height:92px;padding:2px 4px">${handling}</div>
      <div class="blk lb" style="border-top:1px solid #000;border-bottom:0;font-size:8pt">Certificate of Origin "COO" (if Any):</div>
    </div>
  </div>

  <div class="note">NOTE: TO BE FILLED UP BY OPERATIONS TEAM</div>
  <div style="display:flex">
    <table class="ops" style="width:32.5%"><tr><td class="bar" colspan="2">EXPORT DOCUMENTS CHECK LIST</td></tr>
      ${EXPORT_DOCS.map((t) => `<tr><td class="lb">${t}</td><td style="width:20%;text-align:center">${t ? box(false) : ""}</td></tr>`).join("")}
      <tr><td class="lb gray">EXPORT CLEARANCE</td><td class="gray" style="text-align:center">${box(false)}</td></tr>
      <tr><td class="gray lb" colspan="2" style="height:44px;text-align:center">FL No.:<br><br>BILLING INVOICE No.: <span class="v" style="display:inline">${esc(d.billingInvoiceNo)}</span></td></tr></table>
    <table class="ops" style="width:22.5%"><tr><td class="bar" colspan="2">HBL CUTTING CHECK LIST</td></tr>
      ${HBL_CHECK.map((t) => `<tr><td class="lb">${t}</td><td style="width:22%;text-align:center">${t ? box(false) : ""}</td></tr>`).join("")}</table>
    <table class="ops" style="width:45%"><tr><td class="bar" style="background:#fff"></td><td class="lb" style="text-align:center;width:16%">DATE</td><td style="width:20%"></td></tr>
      ${OPS.map((t) => `<tr><td class="lb">${t}<span style="float:right">${box(false)}</span></td><td></td><td></td></tr>`).join("")}</table>
  </div>
  <div style="display:flex;border-top:1px solid #000;min-height:64px;font-family:Arial,sans-serif;font-size:6.5pt">
    <div style="width:37%;border-right:1px solid #000;padding:3px 8px;line-height:1.35">
      ${[1, 2, 3].map(() => `<div>(First T/O) &nbsp; ______________________________<br><span style="padding-left:60px">Turned Over Received by:</span></div>`).join("")}
    </div>
    <div style="width:63%;display:flex;align-items:center;padding:0 16px 0 160px;font-size:6pt;font-weight:700">
      NOTE: For shipment to be turned over to another CS on shift schedule, please ensure that the CS will acknowledge and sign on space provided below signifying he understand and acknowledge the special handling and delivery instruction, if any
    </div>
  </div>
</div>
<div class="footer">${esc(d.footer)}</div>
</div>
</body></html>`;
}
