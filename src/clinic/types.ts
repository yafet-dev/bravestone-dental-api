export type ClinicPatientNote = {
  id: string;
  date: string;
  note: string;
  user: string;
};

export type ClinicEmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  note?: string;
};

export type ClinicUserPreferences = {
  appointmentReminders: boolean;
  billingAlerts: boolean;
  recordReviewAlerts: boolean;
  weeklySummary: boolean;
  twoFactor: boolean;
  compactMode: boolean;
  defaultLandingPage?: string;
  calendarView?: string;
  timeZone?: string;
  theme?: string;
};

export type ClinicAssistantMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
};

export type ClinicAIInsightTone = 'brand' | 'success' | 'warning';

export type ClinicAIInsightCard = {
  id: string;
  title: string;
  value: string;
  helper: string;
  tone: ClinicAIInsightTone;
};

export type ClinicAIReportInsightSet = {
  dashboard: ClinicAIInsightCard[];
  executive: ClinicAIInsightCard[];
  financial: ClinicAIInsightCard[];
  performance: ClinicAIInsightCard[];
  generatedAt: string;
  model?: string;
  source: 'deepseek' | 'fallback';
};

export type ClinicAIMemory = {
  summary: string;
  focusAreas: string[];
  updatedAt: string;
  reportInsights?: ClinicAIReportInsightSet;
};

export type ClinicAssistantReplyResult = {
  memory: ClinicAIMemory;
  message: ClinicAssistantMessage;
  model?: string;
  source: 'deepseek' | 'fallback';
};

export type ClinicReportInsightsResult = {
  insights: ClinicAIReportInsightSet;
  memory: ClinicAIMemory;
};

export type ClinicDoctorProfileNotification = {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  appointment?: {
    date: string;
    time: string;
    type: 'consultation' | 'cleaning' | 'surgery' | 'emergency';
    status: 'scheduled' | 'arrived' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  };
  createdAt: string;
  readAt?: string;
};

export type ClinicPatient = {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  phone: string;
  email: string;
  lastVisit: string;
  status: 'active' | 'inactive' | 'lost';
  balance: number;
  medicalHistory: string[];
  dentalChart?: Array<{
    toothId: number;
    status: 'healthy' | 'decayed' | 'filled' | 'missing' | 'treated' | 'extracted';
    notes: string;
  }>;
  notes?: ClinicPatientNote[];
  emergencyContacts?: ClinicEmergencyContact[];
};

export type ClinicRevenuePoint = {
  name: string;
  revenue: number;
  patients: number;
};

export type ClinicDoctorAvailabilityStatus = 'Available' | 'In procedure' | 'Out today';
export type ClinicDoctorWeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type ClinicDoctorAvailabilityDay = {
  key: ClinicDoctorWeekdayKey;
  label: string;
  shortLabel: string;
  enabled: boolean;
  start: string;
  end: string;
};

export type ClinicDoctor = {
  id: string;
  name: string;
  specialty: string;
  schedule: string;
  availability: ClinicDoctorAvailabilityStatus;
  assignedPatients: number;
  revenue: number;
  procedures: number;
  rating: number;
  weeklyAvailability: ClinicDoctorAvailabilityDay[];
  isNew?: boolean;
};

export type ClinicProcedure = {
  id: string;
  name: string;
  category: string;
  cost: number;
  duration: string;
  followUp: string;
  patient: string;
  doctor: string;
};

export type ClinicDiagnosis = {
  id: string;
  patientId?: string;
  doctorId?: string;
  patient: string;
  tooth: string;
  diagnosis: string;
  severity: string;
  date: string;
  doctor: string;
  complaint?: string;
  doctorAction?: string;
  medicine?: string;
  followUp?: string;
  attachments?: string[];
};

export type ClinicSymptom = {
  id: string;
  patientId?: string;
  patient: string;
  date: string;
  tooth: string;
  pain: number;
  sensitivity: string;
  bleeding: string;
  swelling: string;
  infection: string;
  notes: string;
};

export type ClinicPrescription = {
  id: string;
  patientId?: string;
  doctorId?: string;
  patient: string;
  doctor: string;
  medicine: string;
  dosage: string;
  duration: string;
  status: string;
  date: string;
  instructions?: string;
};

export type ClinicInvoice = {
  id: string;
  patientId?: string;
  billToName: string;
  date: string;
  amount: number;
  status: 'paid' | 'unpaid' | 'partial';
  items: Array<{
    description: string;
    quantity: number;
    price: number;
  }>;
};

export type ClinicForm = {
  id: string;
  patientId?: string;
  patient: string;
  type: string;
  status: string;
  owner: string;
  updated: string;
};

export type ClinicSickLeave = {
  id: string;
  patientId?: string;
  doctorId?: string;
  patient: string;
  doctor: string;
  diagnosis: string;
  start: string;
  end: string;
  status: string;
};

export type ClinicReport = {
  id: string;
  name: string;
  type: string;
  range: string;
  format: string;
};

export type ClinicStaffUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastActive: string;
  branchId: string;
  phone?: string;
  defaultBranchId?: string;
  emailSignature?: string;
  preferences?: ClinicUserPreferences;
};

export type ClinicRoleDefinition = {
  role: string;
  access: string;
};

export type ClinicRolePermission = {
  role: string;
  features: string[];
};

export type ClinicOrganizationBranchStatus = 'Active' | 'Opening soon' | 'Paused';

export type ClinicOrganizationBranch = {
  id: string;
  name: string;
  city: string;
  manager: string;
  status: ClinicOrganizationBranchStatus;
};

export type ClinicOrganizationProfile = {
  name: string;
  legalName: string;
  contact: string;
  license: string;
  aiMemory?: ClinicAIMemory;
  assistantMessages?: ClinicAssistantMessage[];
  doctorProfileNotifications?: ClinicDoctorProfileNotification[];
};

export type ClinicPaymentPlan = {
  treatment: string;
  total: number;
  paid: number;
  firstPayment: number;
  lastPaymentDate: string;
  method: string;
};

export type ClinicPatientProfile = {
  patientId: string;
  directoryId: string;
  dob: string;
  address: string;
  branchId: string;
  branchName: string;
  bloodGroup: string;
  nextAppointment?: string;
  paymentPlan: ClinicPaymentPlan;
  pendingAmount: number;
  recordCount: number;
  cardNumber: string;
  registrationTime: string;
};

export type ClinicPatientPayment = {
  id: string;
  patientId: string;
  date: string;
  amount: number;
  method: string;
  receivedBy: string;
  note: string;
};

export type ClinicAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  date: string;
  time: string;
  duration: number;
  type: 'consultation' | 'cleaning' | 'surgery' | 'emergency';
  status: 'scheduled' | 'arrived' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  reason?: string;
  createdNow?: boolean;
};

export type ClinicFinanceEntry = {
  id: string;
  type: 'income' | 'expense';
  date: string;
  category: string;
  description: string;
  party: string;
  owner: string;
  amount: number;
  status: 'Received' | 'Expected' | 'Paid' | 'Scheduled' | 'Due';
  frequency: 'One-time' | 'Monthly';
};

export type ClinicWorkspaceState = {
  patients: ClinicPatient[];
  patientProfiles: ClinicPatientProfile[];
  patientPayments: ClinicPatientPayment[];
  appointments: ClinicAppointment[];
  revenueData: ClinicRevenuePoint[];
  doctors: ClinicDoctor[];
  procedures: ClinicProcedure[];
  diagnoses: ClinicDiagnosis[];
  symptoms: ClinicSymptom[];
  prescriptions: ClinicPrescription[];
  invoices: ClinicInvoice[];
  forms: ClinicForm[];
  sickLeaves: ClinicSickLeave[];
  reports: ClinicReport[];
  staffUsers: ClinicStaffUser[];
  roles: ClinicRoleDefinition[];
  rolePermissions: ClinicRolePermission[];
  branches: ClinicOrganizationBranch[];
  organizationProfile: ClinicOrganizationProfile;
  financeEntries: ClinicFinanceEntry[];
};
