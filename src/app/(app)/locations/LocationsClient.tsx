"use client";

import CollapsibleSection from "@/components/CollapsibleSection";
import BranchesClient from "./BranchesClient";
import StoresClient from "./StoresClient";

export default function LocationsClient() {
  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Locations</h1>
      <CollapsibleSection title="Retail branches" defaultOpen>
        <BranchesClient />
      </CollapsibleSection>
      <CollapsibleSection title="Bulk stores">
        <StoresClient />
      </CollapsibleSection>
    </div>
  );
}
