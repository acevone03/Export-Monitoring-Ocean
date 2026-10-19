import { requireUser } from "@/lib/auth";
import { ShipmentForm } from "@/components/ShipmentForm";
import { formOptions } from "../data";
import { createShipmentAction } from "./actions";

export default async function NewShipmentPage() {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const { shippers, csUsers, destinations, carrierNames } = await formOptions();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">New ocean export shipment</h1>
        <p className="text-sm text-slate-600">Type the shipper name or code (e.g. SHP-0001): the pick-up address and contact fill in automatically. Job No. and HBL No. are assigned when you save.</p>
      </div>
      <ShipmentForm
        action={createShipmentAction}
        isNew
        submitLabel="Create shipment"
        shippers={shippers}
        csUsers={csUsers}
        destinations={destinations}
        carrierNames={carrierNames}
        initial={{
          shipperId: "", consigneeName: "", pickupAddress: "", destinationPort: "", pod: "", cargoType: "FCL",
          containerPlan: [], lclQty: "", lclUnit: "",
          requestedPickupAt: "", fsiCutoffAt: "", preadviseCutoffAt: "", etdMnl: "", eta: "",
          arrastreResponsibility: "NNR", carrierName: "", carrierBookingRef: "", carrierRemarks: "",
          assignedCsId: user.role === "CS" ? user.id : "",
          arrastreCutoffAt: "", podCode: "", hblType: "NNR", declarationBy: "NNR", declarationForwarder: "", partOfHblNo: "",
          positioningAt: "", containerYard: "", portOfLoading: "", cyCutoffAt: "", consolidator: "", grossWeightKg: "", cbm: "",
          cargoDescription: "", cargoDimensions: "", deliveryWarehouse: "", pickupRemarks: "",
          vesselName: "", voyageNo: "", freightTerms: "", incoterm: "",
        }}
      />
    </div>
  );
}
