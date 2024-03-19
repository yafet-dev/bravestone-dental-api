import { prisma } from '../db';

/**
 * Per-organization weekly spending cap for the AI assistant.
 *
 * Every clinic gets a fixed budget of AI tokens worth a small amount of money
 * per week ($1.00 by default). Spend is metered from the token counts the model
 * provider actually reports, priced with the configured per-million rates — not
 * estimated from message length — so the figure a clinic sees matches what the
 * platform is really billed.
 *
 * Money is handled in integer **micro-dollars** (millionths of a USD, so $1.00
 * is 1_000_000). A clinic accrues many small charges per week and repeated
 * floating-point addition would drift; integers cannot.
 */

const microUsdPerUsd = 1_000_000;
const millisPerWeek = 7 * 24 * 60 * 60 * 1000;

/**
 * Provider prices, per million tokens, in USD.
 *
 * These MUST match the current price list for whatever `DEEPSEEK_MODEL` is set
 * to — the whole cap is computed from them, so a wrong rate silently gives every
 * clinic too much or too little AI. They are environment variables rather than
 * constants so the rates can be corrected without a code change, and the
 * effective values are shown in the super-admin console so they can be audited.
 */
function readRate(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getAiTokenRates() {
  return {
    inputUsdPerMillionTokens: readRate('AI_INPUT_USD_PER_MTOK', 0.3),
    outputUsdPerMillionTokens: readRate('AI_OUTPUT_USD_PER_MTOK', 1.2),
  };
}

/**
 * Cost of one call, rounded **up** to the next micro-dollar. Rounding up means
 * a long run of tiny calls can never accumulate as free usage.
 */
export function priceUsageMicroUsd(inputTokens: number, outputTokens: number) {
  const rates = getAiTokenRates();
  const safeInput = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const safeOutput = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  const usd = (safeInput / 1_000_000) * rates.inputUsdPerMillionTokens
    + (safeOutput / 1_000_000) * rates.outputUsdPerMillionTokens;

  return Math.ceil(usd * microUsdPerUsd);
}

/**
 * A representative call, used as the admission price before a request runs.
 *
 * Output length is unknowable in advance, so the check is "is there enough left
 * for a typical exchange?" rather than an exact reservation. The clinic prompt
 * carries the workspace summary, so input dominates.
 */
function minimumCallMicroUsd() {
  return priceUsageMicroUsd(6000, 700);
}

/** Start of the ISO week (Monday 00:00 UTC) containing `at`. */
export function weekStartedAt(at = new Date()) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // getUTCDay() is 0 for Sunday, so shift it into a Monday-based index.
  const mondayIndex = (start.getUTCDay() + 6) % 7;

  start.setUTCDate(start.getUTCDate() - mondayIndex);
  return start;
}

/** End of the weekly window containing `at` — also the moment the budget resets. */
export function weekResetAt(at = new Date()) {
  return new Date(weekStartedAt(at).getTime() + millisPerWeek);
}

export type AiBudgetState = {
  /** Weekly allowance in whole USD, e.g. 1 for a $1/week clinic. */
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  budgetMicroUsd: number;
  spentMicroUsd: number;
  remainingMicroUsd: number;
  /** 0-100, for a progress meter. */
  usedPercent: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens the remaining balance still buys, priced as input tokens. */
  remainingTokensEstimate: number;
  /** ISO timestamp at which the allowance resets. */
  resetAt: string;
  /** Whole seconds until the reset, for a countdown. */
  resetInSeconds: number;
  /** True when there is not enough left to serve another request. */
  exhausted: boolean;
  rates: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
  };
};

type BudgetRow = {
  aiWeeklyBudgetMicroUsd: number;
  aiWeekSpentMicroUsd: number;
  aiWeekResetAt: Date | null;
  aiWeekInputTokens: number;
  aiWeekOutputTokens: number;
};

function describeBudget(row: BudgetRow, now: Date): AiBudgetState {
  const budgetMicroUsd = Math.max(0, row.aiWeeklyBudgetMicroUsd);
  const spentMicroUsd = Math.max(0, Math.min(row.aiWeekSpentMicroUsd, budgetMicroUsd));
  const remainingMicroUsd = Math.max(0, budgetMicroUsd - spentMicroUsd);
  const resetAt = row.aiWeekResetAt ?? weekResetAt(now);
  const rates = getAiTokenRates();
  // Quoted at the input rate: it is the honest optimistic figure, and the
  // alternative (blended) would need an assumed reply length.
  const remainingTokensEstimate = rates.inputUsdPerMillionTokens > 0
    ? Math.floor((remainingMicroUsd / microUsdPerUsd) / rates.inputUsdPerMillionTokens * 1_000_000)
    : 0;

  return {
    budgetUsd: budgetMicroUsd / microUsdPerUsd,
    spentUsd: spentMicroUsd / microUsdPerUsd,
    remainingUsd: remainingMicroUsd / microUsdPerUsd,
    budgetMicroUsd,
    spentMicroUsd,
    remainingMicroUsd,
    usedPercent: budgetMicroUsd > 0
      ? Math.min(100, Math.round((spentMicroUsd / budgetMicroUsd) * 100))
      : 100,
    inputTokens: Math.max(0, row.aiWeekInputTokens),
    outputTokens: Math.max(0, row.aiWeekOutputTokens),
    remainingTokensEstimate,
    resetAt: resetAt.toISOString(),
    resetInSeconds: Math.max(0, Math.round((resetAt.getTime() - now.getTime()) / 1000)),
    exhausted: budgetMicroUsd <= 0 || remainingMicroUsd < minimumCallMicroUsd(),
    rates,
  };
}

const budgetColumns = {
  aiWeeklyBudgetMicroUsd: true,
  aiWeekSpentMicroUsd: true,
  aiWeekResetAt: true,
  aiWeekInputTokens: true,
  aiWeekOutputTokens: true,
} as const;

/**
 * Reads the current window, rolling it forward first if the previous one has
 * elapsed. The roll is lazy — there is no scheduled job — so a clinic that does
 * not use the assistant for a month still finds a full allowance waiting.
 */
export async function loadAiBudget(organizationId: string, now = new Date()): Promise<AiBudgetState | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: budgetColumns,
  });

  if (!organization) {
    return null;
  }

  const expired = !organization.aiWeekResetAt || organization.aiWeekResetAt.getTime() <= now.getTime();

  if (!expired) {
    return describeBudget(organization, now);
  }

  const rolled = {
    aiWeekSpentMicroUsd: 0,
    aiWeekInputTokens: 0,
    aiWeekOutputTokens: 0,
    aiWeekResetAt: weekResetAt(now),
  };

  await prisma.organization.update({
    where: { id: organizationId },
    data: rolled,
  });

  return describeBudget({ ...organization, ...rolled }, now);
}

/**
 * Adds one call's usage to the current week and returns the state afterwards.
 *
 * The increments are relative (`{ increment }`) so two clinic users talking to
 * the assistant at the same time cannot overwrite each other's charge.
 */
export async function recordAiSpend(
  organizationId: string,
  usage: { inputTokens: number; outputTokens: number },
  now = new Date(),
): Promise<AiBudgetState | null> {
  const cost = priceUsageMicroUsd(usage.inputTokens, usage.outputTokens);

  if (cost <= 0) {
    return loadAiBudget(organizationId, now);
  }

  // Opening the window here as well as in loadAiBudget keeps the very first
  // call of a clinic's life from being charged against a window with no end.
  const current = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiWeekResetAt: true },
  });

  if (!current) {
    return null;
  }

  const needsWindow = !current.aiWeekResetAt || current.aiWeekResetAt.getTime() <= now.getTime();
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: needsWindow
      ? {
          aiWeekResetAt: weekResetAt(now),
          aiWeekSpentMicroUsd: cost,
          aiWeekInputTokens: Math.max(0, usage.inputTokens),
          aiWeekOutputTokens: Math.max(0, usage.outputTokens),
          aiLastUsedAt: now,
          aiTotalChecks: { increment: 1 },
        }
      : {
          aiWeekSpentMicroUsd: { increment: cost },
          aiWeekInputTokens: { increment: Math.max(0, usage.inputTokens) },
          aiWeekOutputTokens: { increment: Math.max(0, usage.outputTokens) },
          aiLastUsedAt: now,
          aiTotalChecks: { increment: 1 },
        },
    select: budgetColumns,
  });

  return describeBudget(updated, now);
}

function formatUsd(microUsd: number) {
  return `$${(microUsd / microUsdPerUsd).toFixed(2)}`;
}

/** "3 days 4 hours", for the reset countdown in a refusal message. */
export function describeResetDelay(resetInSeconds: number) {
  if (resetInSeconds <= 0) {
    return 'shortly';
  }

  const days = Math.floor(resetInSeconds / 86400);
  const hours = Math.floor((resetInSeconds % 86400) / 3600);
  const minutes = Math.floor((resetInSeconds % 3600) / 60);

  if (days > 0) {
    return hours > 0
      ? `${days} ${days === 1 ? 'day' : 'days'} and ${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  if (hours > 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * What the clinic sees when the week's allowance is gone. It states the cap, when
 * it returns, and that more has to be arranged with the platform team — there is
 * deliberately no self-service purchase path.
 */
export function buildAiBudgetExhaustedReply(budget: AiBudgetState) {
  const contact = process.env.AI_BUDGET_CONTACT?.trim() || process.env.SMTP_FROM?.trim() || '';
  const contactLine = contact
    ? ` To add more this week, contact ${contact}.`
    : ' To add more this week, contact the Bravestone team.';

  if (budget.budgetMicroUsd <= 0) {
    return `The AI assistant is switched off for this clinic.${contactLine}`;
  }

  return `This clinic has used its ${formatUsd(budget.budgetMicroUsd)} weekly AI allowance `
    + `(${budget.inputTokens.toLocaleString()} tokens in, ${budget.outputTokens.toLocaleString()} out). `
    + `It resets automatically in ${describeResetDelay(budget.resetInSeconds)}.${contactLine}`;
}
