export default function MonakTriageLocked() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center shadow-sm">
        <div className="text-4xl">🔒</div>
        <h1 className="mt-3 text-xl font-bold text-zinc-900">Triage is temporarily locked</h1>
        <p className="mt-2 text-sm text-zinc-700">
          The catalog is being cleaned up right now, so Triage is switched off to keep everything accurate. Anything you
          already saved on your phone is safe and will sync once it is back.
        </p>
        <p className="mt-3 text-xs text-zinc-500">Please check back shortly.</p>
      </div>
    </div>
  );
}
