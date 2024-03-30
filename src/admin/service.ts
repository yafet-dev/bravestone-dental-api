import { AuthError } from '../auth/accounts';
import { prisma } from '../db';
import { clinicOrganizationId } from '../clinic/service';
import { isCloudStorageConfigured, removeObjects } from '../storage/bucket';
import { adminPlansSeed, createDefaultAdminState, createDefaultSuperAdminProfile } from './seed';
import type {
  AdminBootstrapState,
  AuditLog,
  Branch,
  ClinicUser,
  Invitation,
  Organization,
  PaymentRecord,
  PricingPlan,
  SuperAdminProfile,
} from './types';

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function isoString(value: Date | null | undefined) {
  return value ? value.toISOString() : undefined;
}

function parseRequiredDate(value: string, fallback = new Date()) {
  return value ? new Date(value) : fallback;
}

function parseOptionalDate(value: string | undefined) {
  return value ? new Date(value) : null;
}

function branchKey(organizationId: string, branchName: string) {
  return `${organizationId}::${branchName}`.toLowerCase();
}

/**
 * Converts the console's dollar figure into stored micro-dollars.
 *
 * Clamped rather than trusted: the value arrives from a number input, and a
 * negative or absurd allowance would either lock a clinic out of the assistant
 * permanently or hand it an unbounded spend. 0 is legitimate — it switches the
 * assistant off for that clinic.
 */
function toBudgetMicroUsd(weeklyBudgetUsd: unknown) {
  const parsed = typeof weeklyBudgetUsd === 'number' ? weeklyBudgetUsd : Number(weeklyBudgetUsd);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  // $2,000/week is far beyond any real clinic and keeps the column inside INT4.
  return Math.min(2_000_000_000, Math.round(parsed * 1_000_000));
}

function normalizePlan(plan: PricingPlan): PricingPlan {
  return {
    ...plan,
    features: [...plan.features].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function normalizeOrganization(organization: Organization): Organization {
  return {
    ...organization,
    branches: [...organization.branches].sort((left, right) => left.name.localeCompare(right.name)),
    users: [...organization.users].sort((left, right) => left.name.localeCompare(right.name)),
    paymentHistory: [...organization.paymentHistory].sort((left, right) => right.paidAt.localeCompare(left.paidAt)),
    disabledFeatureIds: [...organization.disabledFeatureIds].sort(),
  };
}

const allowedOrganizationStatusTransitions = new Set([
  'trial->active',
  'trial->denied',
  'denied->trial',
  'active->banned',
  'banned->active',
]);

function canApplyOrganizationSnapshot(
  storedStatus: string | undefined,
  submittedStatus: Organization['status'],
) {
  if (!storedStatus) {
    return true;
  }

  // Onboarding is owned by the clinic's setup form. The console has no edit
  // controls for it, so writing its snapshot can only clobber a concurrent
  // submission.
  if (storedStatus === 'onboarding') {
    return false;
  }

  // Existing lifecycle decisions use the dedicated atomic status endpoint. A
  // bootstrap PUT may edit details only while its snapshot still describes the
  // same lifecycle state.
  return storedStatus === submittedStatus;
}

const legacyDemoAdminOrganizationIds = ['org-bright', 'org-family', 'org-ortho'];
const hiddenAdminOrganizationIds = new Set<string>([
  ...legacyDemoAdminOrganizationIds,
  clinicOrganizationId,
]);
const legacyDemoAdminLogFragments = [
  'Bright Smile Group',
  'Family Dental Network',
  'OrthoPlus Clinics',
  'brightsmile.com',
  'familydental.com',
  'orthoplus.com',
  'bravestonelabs.com',
];

function isHiddenAdminOrganization(organization: { id: string }) {
  return hiddenAdminOrganizationIds.has(organization.id);
}

function isDemoAdminProfile(profile: { email: string; recoveryEmail: string }) {
  return profile.email.includes('bravestonelabs.com') || profile.recoveryEmail.includes('bravestonelabs.com');
}

async function cleanupLegacyDemoAdminData() {
  await prisma.$transaction(async (transaction) => {
    await transaction.auditLog.deleteMany({
      where: {
        OR: legacyDemoAdminLogFragments.map((fragment) => ({
          detail: {
            contains: fragment,
          },
        })),
      },
    });

    await transaction.invitation.deleteMany({
      where: {
        organizationId: {
          in: legacyDemoAdminOrganizationIds,
        },
      },
    });

    await transaction.organization.deleteMany({
      where: {
        id: {
          in: legacyDemoAdminOrganizationIds,
        },
      },
    });

    const existingProfile = await transaction.superAdminProfile.findFirst({
      select: {
        id: true,
        email: true,
        recoveryEmail: true,
      },
    });

    if (existingProfile && isDemoAdminProfile(existingProfile)) {
      const genericProfile = createDefaultSuperAdminProfile();

      await transaction.superAdminProfile.update({
        where: { id: existingProfile.id },
        data: {
          name: genericProfile.name,
          email: genericProfile.email,
          recoveryEmail: genericProfile.recoveryEmail,
          twoFactorEnabled: genericProfile.twoFactorEnabled,
          lastPasswordChange: new Date(),
        },
      });
    }
  });
}

async function normalizeUnpaidApplications() {
  await prisma.organization.updateMany({
    where: {
      status: { in: ['onboarding', 'trial'] },
      paymentStatus: 'paid',
      lifetimePaid: 0,
      paymentHistory: { none: {} },
    },
    data: {
      paymentStatus: 'unpaid',
    },
  });
}

async function queryAdminState(): Promise<AdminBootstrapState> {
  const [plans, organizations, invitations, profile, auditLogs] = await prisma.$transaction([
    prisma.plan.findMany({
      include: {
        features: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.organization.findMany({
      include: {
        branches: {
          orderBy: { createdAt: 'asc' },
        },
        users: {
          orderBy: { createdAt: 'asc' },
        },
        paymentHistory: {
          orderBy: { paidAt: 'desc' },
        },
        disabledFeatures: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      include: {
        organization: true,
        branch: true,
      },
      orderBy: { sentAt: 'desc' },
    }),
    prisma.superAdminProfile.findFirst(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
  ]);

  const visibleOrganizations = organizations.filter((organization) => !isHiddenAdminOrganization(organization));
  const hiddenOrganizationIds = new Set(
    organizations.filter((organization) => isHiddenAdminOrganization(organization)).map((organization) => organization.id),
  );
  const hiddenOrganizationNames = new Set(
    organizations.filter((organization) => isHiddenAdminOrganization(organization)).map((organization) => organization.name),
  );

  const mappedPlans: PricingPlan[] = plans.map((plan) => normalizePlan({
    id: plan.id as PricingPlan['id'],
    name: plan.name,
    price: plan.price,
    summary: plan.summary,
    features: plan.features.map((feature) => ({
      id: feature.id,
      label: feature.label,
      enabled: feature.enabled,
    })),
  }));

  const mappedOrganizations: Organization[] = visibleOrganizations.map((organization) => {
    const branchNames = new Map(organization.branches.map((branch) => [branch.id, branch.name]));
    const usersByBranch = new Map<string, number>();

    organization.users.forEach((user) => {
      if (!user.branchId) {
        return;
      }

      usersByBranch.set(user.branchId, (usersByBranch.get(user.branchId) || 0) + 1);
    });

    return normalizeOrganization({
      id: organization.id,
      name: organization.name,
      owner: organization.owner,
      ownerEmail: organization.ownerEmail,
      planId: organization.planId as Organization['planId'],
      status: organization.status as Organization['status'],
      paymentStatus: organization.paymentStatus as Organization['paymentStatus'],
      dueDate: dateOnly(organization.dueDate) || '',
      lifetimePaid: organization.lifetimePaid,
      lastPaidAt: dateOnly(organization.lastPaidAt),
      lastUnpaidAt: dateOnly(organization.lastUnpaidAt),
      unpaidReason: organization.unpaidReason ?? undefined,
      unpaidEmailSent: organization.unpaidEmailSent,
      featuresPaused: organization.featuresPaused,
      aiUsage: {
        monthlyLimit: organization.aiMonthlyLimit,
        usedThisMonth: organization.aiUsedThisMonth,
        totalChecks: organization.aiTotalChecks,
        checksToday: organization.aiChecksToday,
        resetDate: dateOnly(organization.aiResetDate) || '',
        lastUsedAt: dateOnly(organization.aiLastUsedAt),
        weeklyBudgetUsd: organization.aiWeeklyBudgetMicroUsd / 1_000_000,
        weekSpentUsd: organization.aiWeekSpentMicroUsd / 1_000_000,
        weekInputTokens: organization.aiWeekInputTokens,
        weekOutputTokens: organization.aiWeekOutputTokens,
        weekResetAt: isoString(organization.aiWeekResetAt),
      },
      branches: organization.branches.map((branch): Branch => ({
        id: branch.id,
        name: branch.name,
        city: branch.city,
        manager: branch.manager,
        users: usersByBranch.get(branch.id) || 0,
        patients: branch.patientsCount,
        status: branch.status as Branch['status'],
      })),
      dashboardMetrics: {
        appointmentsToday: organization.dashboardAppointmentsToday,
        monthlyRevenue: organization.dashboardMonthlyRevenue,
        lowStockItems: organization.dashboardLowStockItems,
        pendingForms: organization.dashboardPendingForms,
      },
      disabledFeatureIds: organization.disabledFeatures.map((item) => item.featureId),
      paymentHistory: organization.paymentHistory.map((payment): PaymentRecord => ({
        id: payment.id,
        invoiceNumber: payment.invoiceNumber,
        paidAt: dateOnly(payment.paidAt) || '',
        method: payment.method as PaymentRecord['method'],
        amount: payment.amount,
        reference: payment.reference,
        note: payment.note,
        planName: payment.planName,
        recordedAt: isoString(payment.recordedAt) || '',
        periodStart: dateOnly(payment.periodStart) || '',
        periodEnd: dateOnly(payment.periodEnd) || '',
      })),
      users: organization.users.map((user): ClinicUser => ({
        id: user.id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        branchId: user.branchId || '',
        branchName: user.branchId ? branchNames.get(user.branchId) || 'Unassigned' : 'Unassigned',
        status: user.status as ClinicUser['status'],
      })),
    });
  });

  const mappedInvitations: Invitation[] = invitations
    .filter((invitation) => !hiddenOrganizationIds.has(invitation.organizationId))
    .map((invitation) => ({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: invitation.organization?.name || '',
      branchName: invitation.branch?.name || '',
      email: invitation.email,
      role: invitation.role,
      sentAt: dateOnly(invitation.sentAt) || '',
      expiresAt: dateOnly(invitation.expiresAt) || '',
      status: invitation.status as Invitation['status'],
    }));

  const mappedProfile: SuperAdminProfile = profile
    ? isDemoAdminProfile(profile)
      ? createDefaultSuperAdminProfile()
      : {
        name: profile.name,
        email: profile.email,
        recoveryEmail: profile.recoveryEmail,
        twoFactorEnabled: profile.twoFactorEnabled,
        lastPasswordChange: dateOnly(profile.lastPasswordChange) || '',
      }
    : createDefaultAdminState().superAdminProfile;

  const mappedAuditLogs: AuditLog[] = auditLogs
    .filter((log) => !Array.from(hiddenOrganizationNames).some((name) => log.detail.includes(name)))
    .filter((log) => !legacyDemoAdminLogFragments.some((fragment) => log.detail.includes(fragment)))
    .map((log) => ({
      id: log.id,
      event: log.event,
      detail: log.detail,
      tone: log.tone as AuditLog['tone'],
      createdAt: isoString(log.createdAt) || '',
    }));

  return {
    plans: mappedPlans,
    organizations: mappedOrganizations,
    invitations: mappedInvitations,
    superAdminProfile: mappedProfile,
    auditLogs: mappedAuditLogs,
  };
}

let seedPromise: Promise<void> | null = null;

export async function ensureAdminStateSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      await cleanupLegacyDemoAdminData();

      const [count, profileCount] = await prisma.$transaction([
        prisma.plan.count(),
        prisma.superAdminProfile.count(),
      ]);

      if (count === 0) {
        for (const plan of adminPlansSeed) {
          await prisma.plan.create({
            data: {
              id: plan.id,
              name: plan.name,
              price: plan.price,
              summary: plan.summary,
              features: {
                create: plan.features.map((feature, index) => ({
                  id: feature.id,
                  label: feature.label,
                  enabled: feature.enabled,
                  sortOrder: index,
                })),
              },
            },
          });
        }
      }

      if (profileCount === 0) {
        const profile = createDefaultSuperAdminProfile();

        await prisma.superAdminProfile.create({
          data: {
            id: 'primary',
            name: profile.name,
            email: profile.email,
            recoveryEmail: profile.recoveryEmail,
            twoFactorEnabled: profile.twoFactorEnabled,
            lastPasswordChange: new Date(),
          },
        });
      }
    })().finally(() => {
      seedPromise = null;
    });
  }

  await seedPromise;
}

export async function getAdminState() {
  await ensureAdminStateSeeded();
  // Older self-registration builds marked a brand-new application as paid even
  // though they had no payment record. Repair those rows once they are read so
  // approval and billing remain two honest, separate decisions.
  await normalizeUnpaidApplications();
  return queryAdminState();
}

export async function updateOrganizationStatus(input: {
  expectedStatus: unknown;
  organizationId: string;
  status: unknown;
}) {
  const expectedStatus = typeof input.expectedStatus === 'string'
    ? input.expectedStatus.trim().toLowerCase()
    : '';
  const status = typeof input.status === 'string'
    ? input.status.trim().toLowerCase()
    : '';

  if (!allowedOrganizationStatusTransitions.has(`${expectedStatus}->${status}`)) {
    throw new AuthError(
      400,
      'invalid_status_transition',
      'That company status change is not allowed.',
    );
  }

  if (isHiddenAdminOrganization({ id: input.organizationId })) {
    throw new AuthError(404, 'organization_not_found', 'That company no longer exists.');
  }

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true },
    });

    if (!existing) {
      throw new AuthError(404, 'organization_not_found', 'That company no longer exists.');
    }

    const changed = await transaction.organization.updateMany({
      where: {
        id: input.organizationId,
        status: expectedStatus,
      },
      data: { status },
    });

    if (changed.count !== 1) {
      throw new AuthError(
        409,
        'organization_status_changed',
        'This company changed in another tab. Refresh it before making a new decision.',
      );
    }

    await transaction.branch.updateMany({
      where: { organizationId: input.organizationId },
      data: {
        status: status === 'banned' || status === 'denied' ? 'banned' : 'active',
      },
    });

    return {
      id: existing.id,
      name: existing.name,
      status,
    };
  });
}

/**
 * Writes the console snapshot back.
 *
 * Organizations present in the snapshot are upserted, but organizations *missing*
 * from it are deliberately left alone: this is a whole-state PUT, so a console
 * running on stale data would otherwise wipe clinics it had simply never loaded.
 * Removing a company is an explicit, separately confirmed call — see
 * {@link deleteOrganization}.
 */
export async function replaceAdminState(state: AdminBootstrapState) {
  const visibleOrganizations = state.organizations.filter((organization) => !isHiddenAdminOrganization(organization));
  const branchIdsByOrganizationName = new Map<string, string>();

  visibleOrganizations.forEach((organization) => {
    organization.branches.forEach((branch) => {
      branchIdsByOrganizationName.set(branchKey(organization.id, branch.name), branch.id);
    });
  });

  await prisma.$transaction(async (transaction) => {
    for (const plan of state.plans) {
      await transaction.plan.upsert({
        where: { id: plan.id },
        create: {
          id: plan.id,
          name: plan.name,
          price: plan.price,
          summary: plan.summary,
        },
        update: {
          name: plan.name,
          price: plan.price,
          summary: plan.summary,
        },
      });

      const featureIds = plan.features.map((feature) => feature.id);

      await transaction.planFeature.deleteMany({
        where: featureIds.length > 0
          ? {
              planId: plan.id,
              id: {
                notIn: featureIds,
              },
            }
          : {
              planId: plan.id,
            },
      });

      for (const [index, feature] of plan.features.entries()) {
        await transaction.planFeature.upsert({
          where: { id: feature.id },
          create: {
            id: feature.id,
            planId: plan.id,
            label: feature.label,
            enabled: feature.enabled,
            sortOrder: index,
          },
          update: {
            planId: plan.id,
            label: feature.label,
            enabled: feature.enabled,
            sortOrder: index,
          },
        });
      }
    }

    if (state.plans.length > 0) {
      await transaction.plan.deleteMany({
        where: {
          id: {
            notIn: state.plans.map((plan) => plan.id),
          },
        },
      });
    }

    for (const organization of visibleOrganizations) {
      const storedOrganization = await transaction.organization.findUnique({
        where: { id: organization.id },
        select: { status: true },
      });
      const persistedStatus = storedOrganization?.status || organization.status;
      const persistedPaymentStatus = (
        (persistedStatus === 'onboarding' || persistedStatus === 'trial')
        && organization.lifetimePaid <= 0
        && organization.paymentHistory.length === 0
      )
        ? 'unpaid'
        : organization.paymentStatus;

      if (!canApplyOrganizationSnapshot(storedOrganization?.status, organization.status)) {
        continue;
      }

      await transaction.organization.upsert({
        where: { id: organization.id },
        create: {
          id: organization.id,
          name: organization.name,
          owner: organization.owner,
          ownerEmail: organization.ownerEmail,
          planId: organization.planId,
          status: organization.status,
          paymentStatus: persistedPaymentStatus,
          dueDate: parseRequiredDate(organization.dueDate),
          lifetimePaid: organization.lifetimePaid,
          lastPaidAt: parseOptionalDate(organization.lastPaidAt),
          lastUnpaidAt: parseOptionalDate(organization.lastUnpaidAt),
          unpaidReason: organization.unpaidReason,
          unpaidEmailSent: organization.unpaidEmailSent ?? false,
          featuresPaused: organization.featuresPaused,
          aiMonthlyLimit: organization.aiUsage.monthlyLimit,
          aiUsedThisMonth: organization.aiUsage.usedThisMonth,
          aiTotalChecks: organization.aiUsage.totalChecks,
          aiChecksToday: organization.aiUsage.checksToday,
          aiResetDate: parseRequiredDate(organization.aiUsage.resetDate),
          aiLastUsedAt: parseOptionalDate(organization.aiUsage.lastUsedAt),
          // Only the allowance is writable from the console. The spend counters
          // and the window are metered server-side from real provider usage, so
          // round-tripping them through this snapshot would let a stale console
          // resurrect or zero out a clinic's week.
          aiWeeklyBudgetMicroUsd: toBudgetMicroUsd(organization.aiUsage.weeklyBudgetUsd),
          dashboardAppointmentsToday: organization.dashboardMetrics.appointmentsToday,
          dashboardMonthlyRevenue: organization.dashboardMetrics.monthlyRevenue,
          dashboardLowStockItems: organization.dashboardMetrics.lowStockItems,
          dashboardPendingForms: organization.dashboardMetrics.pendingForms,
        },
        update: {
          name: organization.name,
          owner: organization.owner,
          ownerEmail: organization.ownerEmail,
          planId: organization.planId,
          paymentStatus: persistedPaymentStatus,
          dueDate: parseRequiredDate(organization.dueDate),
          lifetimePaid: organization.lifetimePaid,
          lastPaidAt: parseOptionalDate(organization.lastPaidAt),
          lastUnpaidAt: parseOptionalDate(organization.lastUnpaidAt),
          unpaidReason: organization.unpaidReason,
          unpaidEmailSent: organization.unpaidEmailSent ?? false,
          featuresPaused: organization.featuresPaused,
          aiMonthlyLimit: organization.aiUsage.monthlyLimit,
          aiUsedThisMonth: organization.aiUsage.usedThisMonth,
          aiTotalChecks: organization.aiUsage.totalChecks,
          aiChecksToday: organization.aiUsage.checksToday,
          aiResetDate: parseRequiredDate(organization.aiUsage.resetDate),
          aiLastUsedAt: parseOptionalDate(organization.aiUsage.lastUsedAt),
          // Only the allowance is writable from the console. The spend counters
          // and the window are metered server-side from real provider usage, so
          // round-tripping them through this snapshot would let a stale console
          // resurrect or zero out a clinic's week.
          aiWeeklyBudgetMicroUsd: toBudgetMicroUsd(organization.aiUsage.weeklyBudgetUsd),
          dashboardAppointmentsToday: organization.dashboardMetrics.appointmentsToday,
          dashboardMonthlyRevenue: organization.dashboardMetrics.monthlyRevenue,
          dashboardLowStockItems: organization.dashboardMetrics.lowStockItems,
          dashboardPendingForms: organization.dashboardMetrics.pendingForms,
        },
      });

      const branchIds = organization.branches.map((branch) => branch.id);

      await transaction.branch.deleteMany({
        where: branchIds.length > 0
          ? {
              organizationId: organization.id,
              id: {
                notIn: branchIds,
              },
            }
          : {
              organizationId: organization.id,
            },
      });

      for (const branch of organization.branches) {
        await transaction.branch.upsert({
          where: { id: branch.id },
          create: {
            id: branch.id,
            organizationId: organization.id,
            name: branch.name,
            city: branch.city,
            manager: branch.manager,
            patientsCount: branch.patients,
            status: branch.status,
          },
          update: {
            organizationId: organization.id,
            name: branch.name,
            city: branch.city,
            manager: branch.manager,
            patientsCount: branch.patients,
            status: branch.status,
          },
        });
      }

      const userIds = organization.users.map((user) => user.id);

      await transaction.user.deleteMany({
        where: userIds.length > 0
          ? {
              organizationId: organization.id,
              id: {
                notIn: userIds,
              },
            }
          : {
              organizationId: organization.id,
            },
      });

      for (const user of organization.users) {
        await transaction.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            organizationId: organization.id,
            branchId: user.branchId || null,
            defaultBranchId: user.branchId || null,
            email: user.email,
            fullName: user.name,
            role: user.role,
            status: user.status,
          },
          update: {
            organizationId: organization.id,
            branchId: user.branchId || null,
            defaultBranchId: user.branchId || null,
            email: user.email,
            fullName: user.name,
            role: user.role,
            status: user.status,
          },
        });
      }

      const paymentIds = organization.paymentHistory.map((payment) => payment.id);

      await transaction.paymentRecord.deleteMany({
        where: paymentIds.length > 0
          ? {
              organizationId: organization.id,
              id: {
                notIn: paymentIds,
              },
            }
          : {
              organizationId: organization.id,
            },
      });

      for (const payment of organization.paymentHistory) {
        await transaction.paymentRecord.upsert({
          where: { id: payment.id },
          create: {
            id: payment.id,
            organizationId: organization.id,
            invoiceNumber: payment.invoiceNumber,
            paidAt: parseRequiredDate(payment.paidAt),
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference,
            note: payment.note,
            planName: payment.planName,
            recordedAt: parseRequiredDate(payment.recordedAt),
            periodStart: parseRequiredDate(payment.periodStart),
            periodEnd: parseRequiredDate(payment.periodEnd),
          },
          update: {
            organizationId: organization.id,
            invoiceNumber: payment.invoiceNumber,
            paidAt: parseRequiredDate(payment.paidAt),
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference,
            note: payment.note,
            planName: payment.planName,
            recordedAt: parseRequiredDate(payment.recordedAt),
            periodStart: parseRequiredDate(payment.periodStart),
            periodEnd: parseRequiredDate(payment.periodEnd),
          },
        });
      }

      await transaction.organizationDisabledFeature.deleteMany({
        where: {
          organizationId: organization.id,
        },
      });

      if (organization.disabledFeatureIds.length > 0) {
        await transaction.organizationDisabledFeature.createMany({
          data: organization.disabledFeatureIds.map((featureId) => ({
            organizationId: organization.id,
            featureId,
          })),
        });
      }
    }

    // Invitations are deliberately NOT written here. They carry a single-use
    // token hash and acceptance state that only /api/invitations may change;
    // round-tripping them through this snapshot would invalidate live links and
    // delete invitations the console has not loaded yet. The bootstrap read still
    // returns them so the console can display them.

    await transaction.superAdminProfile.upsert({
      where: { id: 'primary' },
      create: {
        id: 'primary',
        name: state.superAdminProfile.name,
        email: state.superAdminProfile.email,
        recoveryEmail: state.superAdminProfile.recoveryEmail,
        twoFactorEnabled: state.superAdminProfile.twoFactorEnabled,
        lastPasswordChange: parseRequiredDate(state.superAdminProfile.lastPasswordChange),
      },
      update: {
        name: state.superAdminProfile.name,
        email: state.superAdminProfile.email,
        recoveryEmail: state.superAdminProfile.recoveryEmail,
        twoFactorEnabled: state.superAdminProfile.twoFactorEnabled,
        lastPasswordChange: parseRequiredDate(state.superAdminProfile.lastPasswordChange),
      },
    });

    await transaction.auditLog.deleteMany();

    if (state.auditLogs.length > 0) {
      await transaction.auditLog.createMany({
        data: state.auditLogs.map((log) => ({
          id: log.id,
          event: log.event,
          detail: log.detail,
          tone: log.tone,
          createdAt: parseRequiredDate(log.createdAt),
        })),
      });
    }
  });

  return queryAdminState();
}

/**
 * Removes a clinic company outright.
 *
 * Every clinic table hangs off `Organization` with `onDelete: Cascade`, so this
 * also destroys the branches, staff accounts, patients, appointments, payment
 * records, and pending invitations that belong to it. There is no undo, which is
 * why it is a dedicated call the console has to confirm rather than a side effect
 * of saving the snapshot.
 */
export async function deleteOrganization(organizationId: string) {
  const id = typeof organizationId === 'string' ? organizationId.trim() : '';

  if (!id) {
    throw new AuthError(400, 'organization_required', 'Choose which company to delete.');
  }

  if (hiddenAdminOrganizationIds.has(id)) {
    throw new AuthError(403, 'forbidden', 'This workspace is reserved and cannot be deleted from the console.');
  }

  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      patientAttachments: { select: { storagePath: true } },
    },
  });

  if (!organization) {
    throw new AuthError(404, 'organization_not_found', 'That company no longer exists.');
  }

  if (
    organization.patientAttachments.length
    && !isCloudStorageConfigured()
    && process.env.ALLOW_LOCAL_RECORD_STORAGE !== 'true'
  ) {
    throw new AuthError(
      503,
      'attachment_storage_unconfigured',
      'Patient image storage must be configured before this company can be deleted securely.'
    );
  }

  try {
    await removeObjects(organization.patientAttachments.map((attachment) => attachment.storagePath));
  } catch {
    // Do not cascade-delete the only database index of PHI that still exists in
    // object storage. Keeping the organization row makes cleanup retryable.
    throw new AuthError(
      503,
      'attachment_cleanup_failed',
      'This company still has patient images that could not be removed securely. Please try the deletion again.'
    );
  }

  await prisma.organization.delete({ where: { id } });

  return { id: organization.id, name: organization.name };
}
