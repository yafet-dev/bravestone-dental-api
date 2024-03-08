/**
 * Opening-balance payment rows, and the one filter every revenue figure must use.
 *
 * When a patient's recorded paid-to-date exceeds the payment transactions on file,
 * `normalizeClinicState` synthesises the difference as a payment row so the two
 * agree. That money moved before this workspace existed: nobody took it at a desk,
 * and the row is stamped with the patient's last-payment date, their registration
 * time, or 1970 when neither is known.
 *
 * So it is not revenue. Summing these rows overstates collections and files the
 * phantom under whichever month that synthetic date lands in. Patient-facing
 * balance maths is the exception and must NOT filter them out — there the
 * carried-forward amount is genuinely part of what the patient has paid.
 */

import type { ClinicPatientPayment } from './types';

export const openingBalancePaymentIdPrefix = 'PAY-OPENING-';

/** True when this row records a carried-forward balance, not a real transaction. */
export function isOpeningBalancePayment(paymentId: string) {
  return paymentId.startsWith(openingBalancePaymentIdPrefix);
}

/** Only the payments that represent money this clinic actually took in. */
export function collectedPayments(payments: ClinicPatientPayment[]) {
  return payments.filter((payment) => !isOpeningBalancePayment(payment.id));
}
