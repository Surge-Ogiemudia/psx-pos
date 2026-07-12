export type AlertSeverity = "high" | "medium" | "low";

const ALERT_SEVERITY_CLASS: Record<AlertSeverity, { rest: string; active: string }> = {
  high: {
    rest: "bg-red-100 text-red-800 hover:bg-red-200",
    active: "bg-red-600 text-white hover:bg-red-700",
  },
  medium: {
    rest: "bg-orange-100 text-orange-800 hover:bg-orange-200",
    active: "bg-orange-600 text-white hover:bg-orange-700",
  },
  low: {
    rest: "bg-amber-100 text-amber-800 hover:bg-amber-200",
    active: "bg-amber-600 text-white hover:bg-amber-700",
  },
};

// A solid-background button at rest (not just a border/hover state), so it reads as a real,
// pressable control on sight — including on touch devices with no hover to reveal it.
export default function AlertFilterButton({
  count,
  label,
  severity,
  active,
  onClick,
}: {
  count: number;
  label: string;
  severity: AlertSeverity;
  active: boolean;
  onClick: () => void;
}) {
  const palette = ALERT_SEVERITY_CLASS[severity];
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? palette.active : palette.rest}`}
    >
      <span className="font-semibold">{count}</span> {label}
    </button>
  );
}
