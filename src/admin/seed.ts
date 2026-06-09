import { AdminBootstrapState, PricingPlan, SuperAdminProfile } from './types';

export const adminPlansSeed: PricingPlan[] = [
  {
    id: 'plus',
    name: 'Plus',
    price: 2900,
    summary: 'Small single clinic.',
    features: [
      { id: 'plus-1', label: '1 branch', enabled: true },
      { id: 'plus-2', label: 'Up to 8 users', enabled: true },
      { id: 'plus-3', label: 'Patient records', enabled: true },
      { id: 'plus-4', label: 'AI assistant', enabled: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 4900,
    summary: 'Growing clinic team.',
    features: [
      { id: 'pro-1', label: 'Up to 3 branches', enabled: true },
      { id: 'pro-2', label: 'Up to 25 users', enabled: true },
      { id: 'pro-3', label: 'AI assistant', enabled: true },
      { id: 'pro-4', label: 'Advanced reports', enabled: true },
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    price: 8900,
    summary: 'Multi-branch organization.',
    features: [
      { id: 'elite-1', label: 'Unlimited branches', enabled: true },
      { id: 'elite-2', label: 'Unlimited users', enabled: true },
      { id: 'elite-3', label: 'Priority support', enabled: true },
      { id: 'elite-4', label: 'Audit controls', enabled: true },
    ],
  },
];

export function createDefaultSuperAdminProfile(): SuperAdminProfile {
  return {
    name: 'Super Admin',
    email: '',
    recoveryEmail: '',
    twoFactorEnabled: false,
    lastPasswordChange: '',
  };
}

export function createDefaultAdminState(): AdminBootstrapState {
  return {
    plans: adminPlansSeed,
    organizations: [],
    invitations: [],
    superAdminProfile: createDefaultSuperAdminProfile(),
    auditLogs: [],
  };
}
