"use client";

import { useEffect, useState } from "react";

export default function DispensaryClient({ pharmacyId }: { pharmacyId: string }) {
  const [emrUrl, setEmrUrl] = useState("");

  useEffect(() => {
    const isLocal = window.location.hostname === "localhost";
    const baseUrl = isLocal ? "http://localhost:3000" : window.location.origin.replace("pos", "emr");
    setEmrUrl(`${baseUrl}/embed/dispensary?pharmacyId=${pharmacyId}`);
  }, [pharmacyId]);

  return (
    <div className="flex flex-1 w-full h-[calc(100vh-65px)] bg-zinc-50">
      {emrUrl ? (
        <iframe
          src={emrUrl}
          className="w-full h-full border-0"
          title="EMR Dispensary Tab"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-teal-600"></div>
        </div>
      )}
    </div>
  );
}
