import { prisma } from '../db';
import { clinicOrganizationId } from '../clinic/service';
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
  return queryAdminState();
}

export async function replaceAdminState(state: AdminBootstrapState) {
  const visibleOrganizations = state.organizations.filter((organization) => !isHiddenAdminOrganization(organization));
  const visibleOrganizationIds = visibleOrganizations.map((organization) => organization.id);
  const visibleInvitations = state.invitations.filter((invitation) => visibleOrganizationIds.includes(invitation.organizationId));
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
      await transaction.organization.upsert({
        where: { id: organization.id },
        create: {
          id: organization.id,
          name: organization.name,
          owner: organization.owner,
          ownerEmail: organization.ownerEmail,
          planId: organization.planId,
          status: organization.status,
          paymentStatus: organization.paymentStatus,
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
          status: organization.status,
          paymentStatus: organization.paymentStatus,
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

    const visibleInvitationIds = visibleInvitations.map((invitation) => invitation.id);

    if (visibleOrganizationIds.length > 0) {
      await transaction.invitation.deleteMany({
        where: visibleInvitationIds.length > 0
          ? {
              organizationId: {
                in: visibleOrganizationIds,
              },
              id: {
                notIn: visibleInvitationIds,
              },
            }
          : {
              organizationId: {
                in: visibleOrganizationIds,
              },
            },
      });
    }

    for (const invitation of visibleInvitations) {
      await transaction.invitation.upsert({
        where: { id: invitation.id },
        create: {
          id: invitation.id,
          organizationId: invitation.organizationId,
          branchId: branchIdsByOrganizationName.get(branchKey(invitation.organizationId, invitation.branchName)) || null,
          email: invitation.email,
          role: invitation.role,
          sentAt: parseRequiredDate(invitation.sentAt),
          expiresAt: parseRequiredDate(invitation.expiresAt),
          status: invitation.status,
        },
        update: {
          organizationId: invitation.organizationId,
          branchId: branchIdsByOrganizationName.get(branchKey(invitation.organizationId, invitation.branchName)) || null,
          email: invitation.email,
          role: invitation.role,
          sentAt: parseRequiredDate(invitation.sentAt),
          expiresAt: parseRequiredDate(invitation.expiresAt),
          status: invitation.status,
        },
      });
    }

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
