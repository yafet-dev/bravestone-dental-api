/**
 * Treatment charges: the doctor's priced lines, and the total reception collects.
 *
 * This lives on its own so the browser and the API run the same rules. Both
 * normalize the workspace on the way through, and if they disagreed about what a
 * treatment costs, the figure on a receipt would depend on which side wrote last.
 *
 * The flow it exists for: reception registers a patient without a price, because
 * nobody knows the treatment yet. The doctor examines, adds priced lines, and
 * sends them. Their sum becomes the treatment total, and reception collects
 * against it on the next workspace refresh.
 */

/** Kept structural so the API can use it without importing browser types. */
export type TreatmentChargeLike = {
  addedAt: string;
  addedByName: string;
  amount: number;
  description: string;
  id: string;
  sentAt?: string;
};

/** Money is rounded to cents so a sum of typed prices cannot drift. */
function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Drops anything that is not a usable charge and squares up the numbers.
 *
 * A line with no description or a non-positive amount is discarded rather than
 * shown as a zero: a blank row on a bill reads as a fault, and a negative one
 * would quietly reduce what the patient owes.
 */
export function normalizeTreatmentCharges(value: unknown): TreatmentChargeLike[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): TreatmentChargeLike[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const candidate = entry as Partial<TreatmentChargeLike>;
    const amount = typeof candidate.amount === 'number' ? candidate.amount : Number(candidate.amount);
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';

    if (!description || !Number.isFinite(amount) || amount <= 0) {
      return [];
    }

    const sentAt = typeof candidate.sentAt === 'string' ? candidate.sentAt.trim() : '';

    return [{
      addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt : '',
      addedByName: typeof candidate.addedByName === 'string' ? candidate.addedByName.trim() : '',
      amount: roundMoney(amount),
      description,
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : description,
      ...(sentAt ? { sentAt } : {}),
    }];
  });
}

/** Lines the doctor has handed to reception. Drafts are not billable. */
export function sentTreatmentCharges(charges: TreatmentChargeLike[]) {
  return charges.filter((charge) => Boolean(charge.sentAt));
}

export function sumTreatmentCharges(charges: TreatmentChargeLike[]) {
  return roundMoney(charges.reduce((total, charge) => total + charge.amount, 0));
}

/**
 * The treatment total for a patient.
 *
 * Sent charges win once any exist. Until then the stored figure stands, which is
 * what keeps patients priced before this existed — and clinics that still quote at
 * the desk — reading correctly instead of dropping to zero.
 */
export function resolveTreatmentTotal(storedTotal: number, charges: TreatmentChargeLike[]) {
  const sent = sentTreatmentCharges(charges);

  if (!sent.length) {
    return Number.isFinite(storedTotal) ? storedTotal : 0;
  }

  return sumTreatmentCharges(sent);
}
