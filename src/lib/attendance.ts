export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "early_exit";

const GRACE_MINUTES = 10;

export function todayDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Late/early are judged against the pharmacy's local wall-clock time-of-day, which the kiosk
 * browser sends alongside the punch (e.g. "14:32") — comparing that string to the shift's
 * "HH:mm" fields sidesteps the server's own timezone entirely. Duration math (hours worked)
 * still uses the stored UTC Date instants, which is timezone-agnostic.
 */
export function computeClockInStatus(params: {
  localTimeOfDay: string | null;
  scheduledStartTime?: string | null;
}): AttendanceStatus {
  const { localTimeOfDay, scheduledStartTime } = params;
  const isLate =
    !!localTimeOfDay && !!scheduledStartTime && timeToMinutes(localTimeOfDay) > timeToMinutes(scheduledStartTime) + GRACE_MINUTES;
  return isLate ? "late" : "present";
}

export function computeClockOutStatus(params: {
  localTimeOfDay: string | null;
  totalHoursWorked: number;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  wasLate: boolean;
}): AttendanceStatus {
  const { localTimeOfDay, totalHoursWorked, scheduledStartTime, scheduledEndTime, wasLate } = params;

  if (scheduledStartTime && scheduledEndTime) {
    const scheduledHours = (timeToMinutes(scheduledEndTime) - timeToMinutes(scheduledStartTime)) / 60;
    if (scheduledHours > 0 && totalHoursWorked < scheduledHours / 2) return "half_day";
  }

  const isEarly =
    !!localTimeOfDay && !!scheduledEndTime && timeToMinutes(localTimeOfDay) < timeToMinutes(scheduledEndTime) - GRACE_MINUTES;

  if (wasLate) return "late";
  if (isEarly) return "early_exit";
  return "present";
}

export function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100);
}

/** Hourly staff earn per hour worked; monthly/salaried staff earn a flat daily share of their monthly rate for any day they showed up. */
export function computeDayPay(params: {
  salaryType: "monthly" | "hourly";
  salaryAmount: number;
  hoursWorked: number;
}): number {
  const { salaryType, salaryAmount, hoursWorked } = params;
  if (salaryType === "hourly") return Math.round(salaryAmount * hoursWorked * 100) / 100;
  const workingDaysPerMonth = 26;
  return hoursWorked > 0 ? Math.round((salaryAmount / workingDaysPerMonth) * 100) / 100 : 0;
}
