"use client";

import { useEffect } from "react";

// The offline-mode service worker (src/app/sw.ts) intercepts requests below the
// browser's normal cache layer, so a plain reload doesn't reliably pick up a new
// deploy on a tab that's been open for a while — exactly what happened tonight,
// where staff needed a full browser restart (or incognito) to see a fix that had
// already shipped. skipWaiting + clientsClaim (already set in sw.ts) make a new
// service worker take over quickly, but nothing was reloading the already-open
// page once it did. This does: one auto-reload when a new worker takes control,
// plus a periodic check so a POS terminal left open all day doesn't sit for hours
// before even noticing an update exists. Safe here specifically because the POS
// cart persists to localStorage and rehydrates on load — a reload never loses an
// in-progress sale.
export default function ServiceWorkerUpdater() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {}));
    };
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      clearInterval(interval);
    };
  }, []);

  return null;
}
