export type ToastTone = 'success' | 'error' | 'warning' | 'info';
export type PlanId = 'plus' | 'pro' | 'elite';
export type ClinicStatus = 'active' | 'trial' | 'banned';
export type OrganizationStatus = ClinicStatus | 'onboarding' | 'denied';
export type UserStatus = 'active' | 'invited' | 'banned';
export type PaymentStatus = 'paid' | 'unpaid';
export type InviteStatus = 'sent' | 'accepted' | 'expired';
export type PaymentMethod = 'Cash' | 'Bank transfer' | 'Card' | 'Mobile money' | 'Check';

export type SuperAdminProfile = {
  name: string;
  email: string;
  recoveryEmail: string;
  twoFactorEnabled: boolean;
  lastPasswordChange: string;
};

export type AuditLog = {
  id: string;
  event: string;
  detail: string;
  tone: ToastTone;
  createdAt: string;
};

export type PlanFeature = {
  id: string;
  label: string;
  enabled: boolean;
};

export type PricingPlan = {
  id: PlanId;
  name: string;
  price: number;
  summary: string;
  features: PlanFeature[];
};

export type Branch = {
  id: string;
  name: string;
  city: string;
  manager: string;
  users: number;
  patients: number;
  status: ClinicStatus;
};

export type ClinicUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string;
  branchName: string;
  status: UserStatus;
};

export type AIUsage = {
  monthlyLimit: number;
  usedThisMonth: number;
  totalChecks: number;
  checksToday: number;
  resetDate: string;
  lastUsedAt?: string;
  /**
   * The weekly money cap that actually gates the assistant. `weeklyBudgetUsd` is
   * what a super admin edits; the rest is read-only metering, priced from the
   * token counts the provider reported.
   */
  weeklyBudgetUsd: number;
  weekSpentUsd: number;
  weekInputTokens: number;
  weekOutputTokens: number;
  /** ISO timestamp; empty until the clinic's first AI call opens a window. */
  weekResetAt?: string;
};

export type ClinicDashboardMetrics = {
  appointmentsToday: number;
  monthlyRevenue: number;
  lowStockItems: number;
  pendingForms: number;
};

export type PaymentRecord = {
  id: string;
  invoiceNumber: string;
  paidAt: string;
  method: PaymentMethod;
  amount: number;
  reference: string;
  note: string;
  planName: string;
  recordedAt: string;
  periodStart: string;
  periodEnd: string;
};

export type Organization = {
  id: string;
  name: string;
  owner: string;
  ownerEmail: string;
  planId: PlanId;
  status: OrganizationStatus;
  paymentStatus: PaymentStatus;
  dueDate: string;
  lifetimePaid: number;
  lastPaidAt?: string;
  lastUnpaidAt?: string;
  unpaidReason?: string;
  unpaidEmailSent?: boolean;
  featuresPaused: boolean;
  aiUsage: AIUsage;
  branches: Branch[];
  dashboardMetrics: ClinicDashboardMetrics;
  disabledFeatureIds: string[];
  paymentHistory: PaymentRecord[];
  users: ClinicUser[];
};

export type Invitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  branchName: string;
  email: string;
  role: string;
  sentAt: string;
  expiresAt: string;
  status: InviteStatus;
};

export type AdminBootstrapState = {
  plans: PricingPlan[];
  organizations: Organization[];
  invitations: Invitation[];
  superAdminProfile: SuperAdminProfile;
  auditLogs: AuditLog[];
};
