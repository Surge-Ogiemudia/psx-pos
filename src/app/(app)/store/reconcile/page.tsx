import ReconcileClient from "./ReconcileClient";

export const metadata = {
  title: "Bulk Store Physical Stock Reconciliation | PSX POS",
  description: "Interactive physical stock reconciliation and catalog matching for Monak Pharmacy Bulk Store",
};

export default function ReconcilePage() {
  return <ReconcileClient />;
}
