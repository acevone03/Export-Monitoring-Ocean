import { describe, expect, it } from "vitest";
import { bookingSheetData, bookingSheetHtml, type BookingSheetShipment } from "@/lib/booking-sheet";
import { fromManila } from "@/lib/time";

const base = {
  jobNo: "EX-O-2610-0007", hblNo: "MAEU240001", hblType: "DIRECT", cargoType: "FCL", carrierBookingRef: "MAEU240001", carrierName: "Maersk",
  consolidator: null, createdAt: fromManila(2026, 10, 19, 9), requestedPickupAt: fromManila(2026, 11, 12, 8), pod: "JPTYO Tokyo", destinationPort: "TOKYO",
  portOfLoading: "SUBIC", cyCutoffAt: fromManila(2026, 11, 13), positioningAt: fromManila(2026, 11, 13, 13), containerYard: "NYK CY",
  containerPlan: [{ size: "40HC", qty: 1 }], consigneeName: "Tokyo <Fresh>", etdMnl: fromManila(2026, 11, 15), atdMnl: null, eta: fromManila(2026, 11, 21),
  pickupAddress: null, cargoDescription: "Coconut", cargoDimensions: null, grossWeightKg: 24000, cbm: null, lclQty: null, lclUnit: null,
  deliveryWarehouse: null, pickupRemarks: null, carrierRemarks: null, invoiceNo: "SI-1", fsiCutoffAt: fromManila(2026, 11, 13, 17),
  arrastreResponsibility: "NNR", bocDeadlineAt: fromManila(2026, 11, 12, 17), arrastreDeadlineAt: fromManila(2026, 11, 13, 12), arrastreCutoffAt: null,
  shipper: { code: "SHP-0001", name: "Luzon Coco", contactPerson: null, phone: null, defaultPickupAddress: "Calamba" }, assignedCs: { name: "Kyla Marie Risma" },
} as unknown as BookingSheetShipment;

describe("booking sheet", () => {
  it("fills the form from the shipment", () => {
    const d = bookingSheetData(base, fromManila(2026, 10, 19, 15));
    expect(d).toMatchObject({
      pic: "KYLA MARIE RISMA", load: "FCL 1x40HC", hblNo: "MAEU240001  (DIRECT)", placeOfLoading: "MNL · SUBIC",
      pickupDate: "12/NOV/2026 08:00H", carrierCutoff: "13/NOV/2026", etd: "15/NOV/2026", transitTime: "6 DAYS",
      shipperLines: ["Calamba"], grossWeight: "24,000 KGS", nnrPickup: true, billingInvoiceNo: "SI-1",
      fsiCutoff: "13/NOV/2026 17:00H", edArrastreCutoff: "ED 12/NOV/2026 17:00H\nARR 13/NOV/2026 12:00H",
    });
  });

  it("shows one ED & arrastre cut-off when they match, or the ED one when the shipper pays arrastre", () => {
    const same = bookingSheetData({ ...base, arrastreDeadlineAt: base.bocDeadlineAt } as BookingSheetShipment, new Date());
    expect(same.edArrastreCutoff).toBe("12/NOV/2026 17:00H");
    const shipperPays = bookingSheetData({ ...base, arrastreResponsibility: "SHIPPER" } as BookingSheetShipment, new Date());
    expect(shipperPays.edArrastreCutoff).toBe("12/NOV/2026 17:00H");
  });

  it("escapes text and offers the print button", () => {
    const html = bookingSheetHtml(bookingSheetData(base, new Date()), "/shipments/x");
    expect(html).toContain("Tokyo &lt;Fresh&gt;");
    expect(html).toContain("window.print()");
    expect(html).toContain("size: letter portrait");
  });
});
