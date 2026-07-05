export interface UnitLevel {
  unitName: string;
  /** How many of this unit make up one of the level above it (the root level's own value is conventionally 1). */
  unitsPerParent: number;
}

export interface BreakdownLevel {
  unitName: string;
  quantity: number;
  amountPerUnit: number;
}

export interface Breakdown {
  baseUnitQuantity: number;
  baseUnitName: string;
  levels: BreakdownLevel[];
  summarySentence: string;
}

/** Map of unitName -> how many base units (smallest level) make up one of that unit. */
export function computeBaseUnitsPerLevel(hierarchy: UnitLevel[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < hierarchy.length; i++) {
    let piecesPerUnit = 1;
    for (let j = i + 1; j < hierarchy.length; j++) {
      piecesPerUnit *= hierarchy[j].unitsPerParent;
    }
    result[hierarchy[i].unitName] = piecesPerUnit;
  }
  return result;
}

export function convertToBaseUnits(hierarchy: UnitLevel[], form: string, quantity: number): number {
  const perLevel = computeBaseUnitsPerLevel(hierarchy);
  const piecesPerUnit = perLevel[form];
  if (piecesPerUnit === undefined) {
    throw new Error(`"${form}" is not one of the defined units for this batch`);
  }
  return piecesPerUnit * quantity;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function pluralize(unitName: string, quantity: number): string {
  if (quantity === 1) return unitName;
  if (/[sxz]$|[cs]h$/i.test(unitName)) return `${unitName}es`;
  return `${unitName}s`;
}

/**
 * FIFO order for drawing stock: soonest expiry first, batches with no expiry
 * go last (not urgently perishable), tie-broken by oldest received first.
 * Mongo's native ascending sort puts null before every date, which is backwards
 * for this rule, so batches are always sorted with this comparator in JS instead.
 */
export function compareBatchesFifo<T extends { expiryDate?: string | Date | null; receivedAt: string | Date }>(
  a: T,
  b: T
): number {
  const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
  const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
}

export interface DrawAllocation {
  id: string;
  baseUnitsDrawn: number;
}

/**
 * Greedily allocate a needed base-unit quantity across FIFO-ordered batches,
 * spanning as many as necessary. Returns null if the batches don't hold enough
 * in total (caller should report how much IS available).
 */
export function planDraw(
  batchesFifoOrder: { id: string; remainingBaseUnitQuantity: number }[],
  neededBaseUnits: number
): DrawAllocation[] | null {
  let remaining = neededBaseUnits;
  const plan: DrawAllocation[] = [];
  for (const batch of batchesFifoOrder) {
    if (remaining <= 0) break;
    if (batch.remainingBaseUnitQuantity <= 0) continue;
    const draw = Math.min(batch.remainingBaseUnitQuantity, remaining);
    plan.push({ id: batch.id, baseUnitsDrawn: draw });
    remaining -= draw;
  }
  return remaining > 0 ? null : plan;
}

/**
 * Given a hierarchy, a form + quantity + total amount for that quantity, break it down
 * into every level of the hierarchy (qty and per-unit amount at each level) plus a
 * human-readable summary sentence, per the "always show qty of form for amount" rule.
 */
export function describeBreakdown(
  hierarchy: UnitLevel[],
  form: string,
  quantity: number,
  totalAmount: number
): Breakdown {
  const perLevel = computeBaseUnitsPerLevel(hierarchy);
  const piecesPerForm = perLevel[form];
  if (piecesPerForm === undefined) {
    throw new Error(`"${form}" is not one of the defined units for this batch`);
  }

  const baseUnitQuantity = piecesPerForm * quantity;
  const baseUnitName = hierarchy[hierarchy.length - 1].unitName;
  const amountPerBaseUnit = baseUnitQuantity > 0 ? totalAmount / baseUnitQuantity : 0;

  const levels: BreakdownLevel[] = hierarchy.map((level) => {
    const piecesPerUnit = perLevel[level.unitName];
    return {
      unitName: level.unitName,
      quantity: baseUnitQuantity / piecesPerUnit,
      amountPerUnit: amountPerBaseUnit * piecesPerUnit,
    };
  });

  const chain = levels.map((l) => `${formatNumber(l.quantity)} ${pluralize(l.unitName, l.quantity)}`).join(" = ");
  const formLevel = levels.find((l) => l.unitName === form)!;
  const baseLevel = levels[levels.length - 1];
  const summarySentence =
    `${chain}. At ₦${formLevel.amountPerUnit.toFixed(2)} per ${form}, that's ₦${baseLevel.amountPerUnit.toFixed(2)} per ${baseUnitName}.`;

  return { baseUnitQuantity, baseUnitName, levels, summarySentence };
}
