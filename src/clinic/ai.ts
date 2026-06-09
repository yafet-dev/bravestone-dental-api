import '../env';
import type {
  ClinicAIInsightCard,
  ClinicAIMemory,
  ClinicAIReportInsightSet,
  ClinicAssistantMessage,
  ClinicWorkspaceState,
} from './types';

type ClinicBranchPerformance = {
  branch: string;
  revenue: number;
  expenses: number;
  patients: number;
  outstanding: number;
  margin: number;
};

type ClinicTopPatientRevenue = {
  branch: string;
  category: string;
  lastPayment: string;
  paid: number;
  patient: string;
  visits: number;
};

type DeepSeekMessageContent = string | Array<{ text?: string; type?: string }> | null | undefined;

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: DeepSeekMessageContent;
    };
  }>;
  model?: string;
};

const deepSeekBaseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/$/, '');
const deepSeekModel = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash';
const insightCacheMaxAgeMs = 30 * 60 * 1000;
const branchColorPalette = ['#0f766e', '#14b8a6', '#84cc16', '#f59e0b', '#64748b', '#f43f5e'];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(amount);
}

function toTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function clipText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function sanitizeId(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'insight';
}

function getMessageContent(content: DeepSeekMessageContent) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n');
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonObject(value: string) {
  const normalized = stripCodeFence(value);

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized.slice(firstBrace, lastBrace + 1)) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

function toFocusAreas(value: unknown, fallback: string[]) {
  const focusAreas = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => clipText(item, 40))
    : [];

  return [...new Set((focusAreas.length ? focusAreas : fallback).filter(Boolean))].slice(0, 4);
}

function getInsightTone(value: unknown, fallback: ClinicAIInsightCard['tone']) {
  return value === 'brand' || value === 'success' || value === 'warning'
    ? value
    : fallback;
}

function getInsightCards(value: unknown, fallback: ClinicAIInsightCard[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return fallback.map((defaultCard, index) => {
    const nextCard = value[index];

    if (!nextCard || typeof nextCard !== 'object' || Array.isArray(nextCard)) {
      return defaultCard;
    }

    const candidate = nextCard as Record<string, unknown>;
    const title = typeof candidate.title === 'string' && candidate.title.trim()
      ? clipText(candidate.title, 40)
      : defaultCard.title;
    const valueText = typeof candidate.value === 'string' && candidate.value.trim()
      ? clipText(candidate.value, 48)
      : defaultCard.value;
    const helper = typeof candidate.helper === 'string' && candidate.helper.trim()
      ? clipText(candidate.helper, 120)
      : defaultCard.helper;

    return {
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? sanitizeId(candidate.id)
        : defaultCard.id,
      title,
      value: valueText,
      helper,
      tone: getInsightTone(candidate.tone, defaultCard.tone),
    };
  });
}

function buildInsightCard(
  title: string,
  value: string,
  helper: string,
  tone: ClinicAIInsightCard['tone']
): ClinicAIInsightCard {
  return {
    id: sanitizeId(title),
    title,
    value: clipText(value, 48),
    helper: clipText(helper, 120),
    tone,
  };
}

function getClinicOwnerSummary(state: ClinicWorkspaceState) {
  const ownerUser = state.staffUsers.find((user) => user.role.toLowerCase().includes('admin'))
    || state.staffUsers[0];

  return ownerUser?.name || state.organizationProfile.name || 'Clinic Owner';
}

function buildClinicMetrics(state: ClinicWorkspaceState) {
  const activeBranches = state.branches.length
    ? state.branches
    : [{
        id: 'unassigned',
        name: 'Unassigned',
        city: '',
        manager: '',
        status: 'Active' as const,
      }];
  const patientMap = new Map(state.patients.map((patient) => [patient.id, patient]));
  const profileMap = new Map(state.patientProfiles.map((profile) => [profile.patientId, profile]));
  const appointmentVisitCounts = state.appointments.reduce<Record<string, number>>((counts, appointment) => {
    counts[appointment.patientId] = (counts[appointment.patientId] || 0) + 1;
    return counts;
  }, {});
  const totalExpensePool = state.financeEntries
    .filter((entry) => entry.type === 'expense')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalCollectedRevenue = state.patientPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalBranchPatients = Math.max(state.patientProfiles.length, 1);
  const branchPerformanceData: ClinicBranchPerformance[] = activeBranches.map((branch) => {
    const branchProfiles = state.patientProfiles.filter((profile) => profile.branchId === branch.id);
    const branchPatientIds = new Set(branchProfiles.map((profile) => profile.patientId));
    const revenue = state.patientPayments
      .filter((payment) => branchPatientIds.has(payment.patientId))
      .reduce((sum, payment) => sum + payment.amount, 0);
    const outstanding = branchProfiles.reduce((sum, profile) => sum + (profile.pendingAmount || 0), 0);
    const patients = branchPatientIds.size;
    const branchExpenses = totalExpensePool * (patients / totalBranchPatients);
    const margin = revenue > 0 ? Number((((revenue - branchExpenses) / revenue) * 100).toFixed(1)) : 0;

    return {
      branch: branch.name,
      revenue,
      expenses: Number(branchExpenses.toFixed(2)),
      patients,
      outstanding,
      margin,
    };
  }).filter((branch) => (
    branch.patients > 0 || branch.revenue > 0 || branch.expenses > 0 || branch.outstanding > 0
  ));
  const safeBranchPerformanceData = branchPerformanceData.length
    ? branchPerformanceData
    : activeBranches.map((branch) => ({
        branch: branch.name,
        revenue: 0,
        expenses: 0,
        patients: 0,
        outstanding: 0,
        margin: 0,
      }));
  const topPatientRevenueData = (() => {
    const patientRevenue = new Map<string, ClinicTopPatientRevenue>();

    state.patientPayments.forEach((payment) => {
      const patient = patientMap.get(payment.patientId);
      const profile = profileMap.get(payment.patientId);

      if (!patient) {
        return;
      }

      const current = patientRevenue.get(payment.patientId) || {
        branch: profile?.branchName || activeBranches[0]?.name || 'Unassigned',
        category: profile?.paymentPlan.treatment?.trim() || 'Not set',
        lastPayment: payment.date,
        paid: 0,
        patient: patient.name,
        visits: appointmentVisitCounts[payment.patientId] || 0,
      };

      current.paid += payment.amount;
      if (payment.date > current.lastPayment) {
        current.lastPayment = payment.date;
      }

      patientRevenue.set(payment.patientId, current);
    });

    const fallbackPatients = state.patients.map((patient) => {
      const profile = profileMap.get(patient.id);
      return {
        branch: profile?.branchName || activeBranches[0]?.name || 'Unassigned',
        category: profile?.paymentPlan.treatment?.trim() || 'Not set',
        lastPayment: patient.lastVisit,
        paid: 0,
        patient: patient.name,
        visits: appointmentVisitCounts[patient.id] || 0,
      };
    });

    return (patientRevenue.size ? Array.from(patientRevenue.values()) : fallbackPatients)
      .sort((first, second) => second.paid - first.paid)
      .slice(0, 5);
  })();
  const sortedAppointments = [...state.appointments].sort((left, right) => (
    left.date.localeCompare(right.date) || left.time.localeCompare(right.time)
  ));
  const today = new Date().toISOString().slice(0, 10);
  const appointmentsToday = sortedAppointments.filter((appointment) => appointment.date === today);
  const nextAppointmentDate = sortedAppointments.find((appointment) => appointment.date >= today)?.date || '';
  const openForms = state.forms.filter((form) => form.status !== 'Signed');
  const activePatients = state.patients.filter((patient) => patient.status === 'active').length;
  const totalOutstanding = state.patientProfiles.reduce((sum, profile) => sum + (profile.pendingAmount || 0), 0)
    || state.patients.reduce((sum, patient) => sum + patient.balance, 0);
  const totalExpenses = totalExpensePool;
  const topDoctor = [...state.doctors].sort((first, second) => second.revenue - first.revenue)[0];
  const availableDoctors = state.doctors.filter((doctor) => doctor.availability === 'Available').length;
  const bestBranch = [...safeBranchPerformanceData].sort((first, second) => second.revenue - first.revenue)[0];
  const growthBranch = [...safeBranchPerformanceData].sort((first, second) => second.patients - first.patients)[0];
  const topPayer = topPatientRevenueData[0];
  const unpaidInvoices = state.invoices.filter((invoice) => invoice.status !== 'paid').length;
  const netMargin = totalCollectedRevenue > 0
    ? Number((((totalCollectedRevenue - totalExpenses) / totalCollectedRevenue) * 100).toFixed(1))
    : 0;

  return {
    activeBranches,
    activePatients,
    appointmentsToday,
    availableDoctors,
    bestBranch,
    growthBranch,
    nextAppointmentDate,
    netMargin,
    openForms,
    safeBranchPerformanceData,
    topDoctor,
    topPayer,
    totalCollectedRevenue,
    totalExpenses,
    totalOutstanding,
    topPatientRevenueData,
    unpaidInvoices,
  };
}

function buildMemorySummary(state: ClinicWorkspaceState) {
  const metrics = buildClinicMetrics(state);
  const branchCount = metrics.activeBranches.length;

  return clipText(
    `${state.organizationProfile.name || 'This clinic'} is managing ${state.patients.length} patients across ${branchCount} branch${branchCount === 1 ? '' : 'es'}, with ${formatCurrency(metrics.totalCollectedRevenue)} collected revenue and ${formatCurrency(metrics.totalOutstanding)} still outstanding.`,
    220
  );
}

function buildDefaultFocusAreas(state: ClinicWorkspaceState) {
  const metrics = buildClinicMetrics(state);
  const focusAreas = [
    metrics.totalOutstanding > 0 ? 'Collections follow-up' : 'Revenue growth',
    metrics.openForms.length > 0 ? 'Record completion' : 'Clinical throughput',
    metrics.appointmentsToday.length > 0 || metrics.nextAppointmentDate ? 'Schedule flow' : 'Appointment intake',
    metrics.availableDoctors < state.doctors.length ? 'Provider utilization' : 'Team capacity',
  ];

  return [...new Set(focusAreas.filter(Boolean))].slice(0, 4);
}

export function buildClinicFallbackMemory(
  state: ClinicWorkspaceState,
  existingMemory?: ClinicAIMemory,
  reportInsights?: ClinicAIReportInsightSet
): ClinicAIMemory {
  return {
    summary: existingMemory?.summary?.trim() || buildMemorySummary(state),
    focusAreas: existingMemory?.focusAreas?.length
      ? toFocusAreas(existingMemory.focusAreas, buildDefaultFocusAreas(state))
      : buildDefaultFocusAreas(state),
    updatedAt: new Date().toISOString(),
    reportInsights: reportInsights || existingMemory?.reportInsights,
  };
}

export function isClinicAIReportInsightSetFresh(
  reportInsights?: ClinicAIReportInsightSet,
  maxAgeMs = insightCacheMaxAgeMs
) {
  if (!reportInsights?.generatedAt) {
    return false;
  }

  const generatedAt = new Date(reportInsights.generatedAt);

  if (Number.isNaN(generatedAt.getTime())) {
    return false;
  }

  return Date.now() - generatedAt.getTime() < maxAgeMs;
}

export function buildClinicFallbackReportInsights(state: ClinicWorkspaceState): ClinicAIReportInsightSet {
  const metrics = buildClinicMetrics(state);
  const dashboard = [
    buildInsightCard(
      'Appointments',
      String(metrics.appointmentsToday.length),
      metrics.appointmentsToday.length
        ? `${metrics.appointmentsToday.length} scheduled for today`
        : metrics.nextAppointmentDate
          ? `Next scheduled day is ${metrics.nextAppointmentDate}`
          : 'No appointments are on the calendar yet',
      metrics.appointmentsToday.length ? 'success' : 'brand'
    ),
    buildInsightCard(
      'Open Records',
      String(metrics.openForms.length),
      metrics.openForms.length
        ? `${metrics.openForms.length} forms still need review or signature`
        : 'All current forms are signed and up to date',
      metrics.openForms.length ? 'warning' : 'success'
    ),
    buildInsightCard(
      'Collected Revenue',
      formatCurrency(metrics.totalCollectedRevenue),
      state.patientPayments.length
        ? `${state.patientPayments.length} payment entries recorded`
        : 'Payments recorded here will sharpen the financial picture',
      metrics.totalCollectedRevenue > 0 ? 'success' : 'brand'
    ),
    buildInsightCard(
      'Top Provider',
      metrics.topDoctor?.name || 'No provider data',
      metrics.topDoctor
        ? `${formatCurrency(metrics.topDoctor.revenue)} produced with ${metrics.topDoctor.assignedPatients} assigned patients`
        : 'Add provider performance data to rank the team',
      metrics.topDoctor ? 'brand' : 'warning'
    ),
  ];
  const executive = [
    buildInsightCard(
      'Best Branch',
      metrics.bestBranch?.revenue ? metrics.bestBranch.branch : 'No revenue recorded',
      metrics.bestBranch?.revenue
        ? `${formatCurrency(metrics.bestBranch.revenue)} revenue`
        : 'Record revenue to compare branches',
      metrics.bestBranch?.revenue ? 'success' : 'warning'
    ),
    buildInsightCard(
      'Top Payer',
      metrics.topPayer?.paid ? metrics.topPayer.patient : 'No payments recorded',
      metrics.topPayer?.paid
        ? `${formatCurrency(metrics.topPayer.paid)} paid across ${metrics.topPayer.visits} visits`
        : 'Payments will surface here once recorded',
      metrics.topPayer?.paid ? 'brand' : 'warning'
    ),
    buildInsightCard(
      'Collection Risk',
      formatCurrency(metrics.totalOutstanding),
      'Outstanding balance across branch profiles',
      metrics.totalOutstanding > 0 ? 'warning' : 'success'
    ),
    buildInsightCard(
      'Growth Branch',
      metrics.growthBranch?.branch || 'No branch data',
      `${metrics.growthBranch?.patients || 0} active patients`,
      metrics.growthBranch?.patients ? 'success' : 'brand'
    ),
  ];
  const financial = [
    buildInsightCard(
      'Gross Revenue',
      formatCurrency(metrics.totalCollectedRevenue),
      'Rolling income captured from patient payments',
      metrics.totalCollectedRevenue > 0 ? 'success' : 'brand'
    ),
    buildInsightCard(
      'Total Expenses',
      formatCurrency(metrics.totalExpenses),
      'Expense pool distributed across active branches',
      metrics.totalExpenses > 0 ? 'warning' : 'brand'
    ),
    buildInsightCard(
      'Net Margin',
      `${metrics.netMargin.toFixed(1)}%`,
      `${metrics.safeBranchPerformanceData.length} branch snapshot`,
      metrics.netMargin >= 20 ? 'success' : metrics.netMargin > 0 ? 'brand' : 'warning'
    ),
    buildInsightCard(
      'Unpaid Invoices',
      String(metrics.unpaidInvoices),
      metrics.unpaidInvoices
        ? `${metrics.unpaidInvoices} invoices are not fully paid yet`
        : 'No invoice collection risk is open right now',
      metrics.unpaidInvoices ? 'warning' : 'success'
    ),
  ];
  const performance = [
    buildInsightCard(
      'Active Patients',
      String(metrics.activePatients),
      `${state.patientProfiles.length} active profiles`,
      metrics.activePatients ? 'success' : 'brand'
    ),
    buildInsightCard(
      'Procedures',
      String(state.procedures.length),
      `${state.procedures.filter((procedure) => procedure.category === 'Restorative').length} restorative cases`,
      state.procedures.length ? 'success' : 'brand'
    ),
    buildInsightCard(
      'Open Records',
      String(metrics.openForms.length),
      metrics.openForms.length ? 'Doctor review needed' : 'Records are fully signed',
      metrics.openForms.length ? 'warning' : 'success'
    ),
    buildInsightCard(
      'Available Doctors',
      String(metrics.availableDoctors),
      `${state.doctors.length} total providers in the roster`,
      metrics.availableDoctors ? 'brand' : 'warning'
    ),
  ];

  return {
    dashboard,
    executive,
    financial,
    performance,
    generatedAt: new Date().toISOString(),
    source: 'fallback',
  };
}

function buildRecentConversation(messages?: ClinicAssistantMessage[]) {
  if (!messages?.length) {
    return 'No saved assistant conversation yet.';
  }

  return messages
    .slice(-8)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${clipText(message.content, 220)}`)
    .join('\n');
}

function buildClinicContext(state: ClinicWorkspaceState, existingMemory?: ClinicAIMemory) {
  const metrics = buildClinicMetrics(state);
  const profileByPatientId = new Map(state.patientProfiles.map((profile) => [profile.patientId, profile]));
  const nextAppointments = state.appointments
    .filter((appointment) => ['scheduled', 'arrived', 'in-progress'].includes(appointment.status))
    .sort((first, second) => (
      `${first.date}T${first.time}`.localeCompare(`${second.date}T${second.time}`)
    ))
    .slice(0, 8)
    .map((appointment) => (
      `${appointment.patientName} with ${appointment.doctorName} on ${appointment.date} at ${appointment.time} (${appointment.status})`
    ));
  const patientSnapshots = state.patients
    .slice(0, 12)
    .map((patient) => {
      const profile = profileByPatientId.get(patient.id);
      const outstanding = profile?.pendingAmount ?? patient.balance;
      return `${patient.name}: ${patient.status}, balance ${formatCurrency(outstanding)}, last visit ${patient.lastVisit}, next appointment ${profile?.nextAppointment || 'none'}`;
    });
  const doctorSnapshots = [...state.doctors]
    .sort((first, second) => second.revenue - first.revenue)
    .slice(0, 6)
    .map((doctor) => (
      `${doctor.name}: ${doctor.specialty}, ${doctor.availability}, revenue ${formatCurrency(doctor.revenue)}, ${doctor.assignedPatients} assigned patients`
    ));
  const branchSnapshots = metrics.safeBranchPerformanceData.map((branch, index) => (
    `${branch.branch}: revenue ${formatCurrency(branch.revenue)}, expenses ${formatCurrency(branch.expenses)}, outstanding ${formatCurrency(branch.outstanding)}, active patients ${branch.patients}, color ${branchColorPalette[index % branchColorPalette.length]}`
  ));
  const reportSummary = existingMemory?.reportInsights
    ? `Latest report insights were generated at ${existingMemory.reportInsights.generatedAt} from ${existingMemory.reportInsights.source}.`
    : 'No report insight snapshot has been generated yet.';

  return [
    `Organization: ${state.organizationProfile.name || 'Clinic workspace'}`,
    `Owner: ${getClinicOwnerSummary(state)}`,
    `Counts: ${state.patients.length} patients, ${state.doctors.length} doctors, ${state.appointments.length} appointments, ${state.forms.length} forms, ${state.reports.length} reports, ${state.branches.length || 1} branches`,
    `Finance: collected revenue ${formatCurrency(metrics.totalCollectedRevenue)}, expenses ${formatCurrency(metrics.totalExpenses)}, outstanding ${formatCurrency(metrics.totalOutstanding)}, unpaid invoices ${metrics.unpaidInvoices}`,
    `Current memory summary: ${existingMemory?.summary || buildMemorySummary(state)}`,
    `Current focus areas: ${(existingMemory?.focusAreas?.length ? existingMemory.focusAreas : buildDefaultFocusAreas(state)).join(', ')}`,
    reportSummary,
    `Upcoming appointments:\n${nextAppointments.length ? nextAppointments.join('\n') : 'None scheduled.'}`,
    `Top doctors:\n${doctorSnapshots.length ? doctorSnapshots.join('\n') : 'No doctors recorded.'}`,
    `Patients:\n${patientSnapshots.length ? patientSnapshots.join('\n') : 'No patients recorded.'}`,
    `Branch performance:\n${branchSnapshots.length ? branchSnapshots.join('\n') : 'No branch performance data recorded.'}`,
  ].join('\n\n');
}

async function requestDeepSeekJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ data: Record<string, unknown>; model?: string } | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${deepSeekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: deepSeekModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as DeepSeekChatCompletionResponse;
    const content = getMessageContent(payload.choices?.[0]?.message?.content);
    const data = parseJsonObject(content);

    if (!data) {
      return null;
    }

    return {
      data,
      model: typeof payload.model === 'string' ? payload.model : deepSeekModel,
    };
  } catch {
    return null;
  }
}

function buildClinicAIMemory(
  state: ClinicWorkspaceState,
  existingMemory: ClinicAIMemory | undefined,
  reportInsights: ClinicAIReportInsightSet | undefined,
  summaryValue: unknown,
  focusAreasValue: unknown
): ClinicAIMemory {
  const fallback = buildClinicFallbackMemory(state, existingMemory, reportInsights);
  const summary = typeof summaryValue === 'string' && summaryValue.trim()
    ? clipText(summaryValue, 220)
    : fallback.summary;

  return {
    summary,
    focusAreas: toFocusAreas(focusAreasValue, fallback.focusAreas),
    updatedAt: new Date().toISOString(),
    reportInsights: reportInsights || fallback.reportInsights,
  };
}

export function buildClinicFallbackAssistantContent(state: ClinicWorkspaceState, message: string) {
  const normalizedQuery = message.trim().toLowerCase();
  const patient = state.patients.find((candidate) => {
    const fullName = candidate.name.toLowerCase();
    const nameParts = fullName.split(/\s+/);
    return normalizedQuery.includes(fullName) || nameParts.some((part) => part.length > 2 && normalizedQuery.includes(part));
  });

  if (patient) {
    const profile = state.patientProfiles.find((item) => item.patientId === patient.id);
    const latestDiagnosis = state.diagnoses
      .filter((item) => item.patientId === patient.id)
      .sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];
    const latestPrescription = state.prescriptions
      .filter((item) => item.patientId === patient.id)
      .sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];
    const outstanding = profile?.pendingAmount ?? patient.balance;

    return `${patient.name} is ${patient.status} with an outstanding balance of ${formatCurrency(outstanding)}. ${latestDiagnosis ? `Latest record: ${latestDiagnosis.diagnosis}${latestDiagnosis.tooth ? ` on ${latestDiagnosis.tooth}` : ''} by ${latestDiagnosis.doctor} on ${latestDiagnosis.date}.` : 'No diagnosis is recorded yet.'} ${latestPrescription ? `Latest prescription: ${latestPrescription.medicine} (${latestPrescription.status}).` : 'No prescription is recorded yet.'} ${profile?.nextAppointment ? `Next appointment: ${profile.nextAppointment}.` : 'No next appointment is scheduled.'}`;
  }

  const metrics = buildClinicMetrics(state);

  if (normalizedQuery.includes('revenue') || normalizedQuery.includes('income') || normalizedQuery.includes('billing') || normalizedQuery.includes('balance')) {
    return `Collected revenue recorded so far is ${formatCurrency(metrics.totalCollectedRevenue)}. The clinic still has ${formatCurrency(metrics.totalOutstanding)} outstanding, and ${metrics.unpaidInvoices} invoices are not fully paid yet.`;
  }

  if (normalizedQuery.includes('appointment') || normalizedQuery.includes('follow-up') || normalizedQuery.includes('visit') || normalizedQuery.includes('schedule')) {
    const nextThree = state.appointments
      .filter((appointment) => ['scheduled', 'arrived', 'in-progress'].includes(appointment.status))
      .sort((first, second) => toTimestamp(`${first.date}T${first.time}`) - toTimestamp(`${second.date}T${second.time}`))
      .slice(0, 3)
      .map((appointment) => `${appointment.patientName} with ${appointment.doctorName} on ${appointment.date} at ${appointment.time}`);

    return nextThree.length
      ? `There are ${nextThree.length} upcoming priority appointments. Next up: ${nextThree.join('; ')}.`
      : 'There are no active appointments scheduled right now.';
  }

  if (normalizedQuery.includes('doctor') || normalizedQuery.includes('dentist') || normalizedQuery.includes('provider')) {
    return `${metrics.availableDoctors} doctors are currently marked available. ${metrics.topDoctor ? `${metrics.topDoctor.name} is leading revenue with ${formatCurrency(metrics.topDoctor.revenue)} and ${metrics.topDoctor.assignedPatients} assigned patients.` : 'No doctor performance data is available yet.'}`;
  }

  if (normalizedQuery.includes('record') || normalizedQuery.includes('note') || normalizedQuery.includes('form')) {
    const patientNotes = state.patients.reduce((sum, currentPatient) => sum + (currentPatient.notes?.length || 0), 0);
    const recentDiagnosis = [...state.diagnoses].sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];

    return `There are ${metrics.openForms.length} forms still waiting on completion, ${patientNotes} saved patient notes, and ${recentDiagnosis ? `the latest diagnosis is ${recentDiagnosis.diagnosis} for ${recentDiagnosis.patient}.` : 'no diagnoses recorded yet.'}`;
  }

  return `You have ${state.patients.length} patients, ${state.doctors.length} doctors, ${state.appointments.filter((appointment) => ['scheduled', 'arrived', 'in-progress'].includes(appointment.status)).length} active appointments, and ${formatCurrency(metrics.totalOutstanding)} still outstanding.`;
}

export async function requestClinicAssistantAI(
  state: ClinicWorkspaceState,
  message: string,
  existingMemory?: ClinicAIMemory
): Promise<{ reply: string; memory: ClinicAIMemory; model?: string; source: 'deepseek' } | null> {
  const response = await requestDeepSeekJson(
    'You are the Bravestone Dental organization assistant. Use only the provided clinic data. If a detail is missing, say it is not recorded instead of inventing it. Respond with JSON only.',
    [
      'Return a JSON object with exactly these keys:',
      '{"reply":"string","memory_summary":"string","focus_areas":["string"]}',
      'Rules:',
      '- reply must be concise, practical, and under 120 words.',
      '- memory_summary must be one or two sentences summarizing the organization priorities you should remember for future conversations.',
      '- focus_areas must be 2 to 4 short phrases.',
      '',
      'Clinic context:',
      buildClinicContext(state, existingMemory),
      '',
      'Recent conversation:',
      buildRecentConversation(state.organizationProfile.assistantMessages),
      '',
      `Latest user request: ${message.trim()}`,
    ].join('\n')
  );

  if (!response) {
    return null;
  }

  const reply = typeof response.data.reply === 'string'
    ? clipText(response.data.reply, 700)
    : '';

  if (!reply) {
    return null;
  }

  return {
    reply,
    memory: buildClinicAIMemory(
      state,
      existingMemory,
      existingMemory?.reportInsights,
      response.data.memory_summary,
      response.data.focus_areas
    ),
    model: response.model,
    source: 'deepseek',
  };
}

export async function requestClinicReportInsightsAI(
  state: ClinicWorkspaceState,
  existingMemory?: ClinicAIMemory
): Promise<{ insights: ClinicAIReportInsightSet; memory: ClinicAIMemory; model?: string; source: 'deepseek' } | null> {
  const fallbackInsights = buildClinicFallbackReportInsights(state);
  const response = await requestDeepSeekJson(
    'You are the Bravestone Dental executive reporting assistant. Use only the provided clinic data. If a detail is missing, keep the wording grounded and conservative. Respond with JSON only.',
    [
      'Return a JSON object with exactly these keys:',
      '{"dashboard":[card],"executive":[card],"financial":[card],"performance":[card],"memory_summary":"string","focus_areas":["string"]}',
      'Each card must be an object with: {"id":"string","title":"string","value":"string","helper":"string","tone":"brand|success|warning"}',
      'Rules:',
      '- Keep dashboard, executive, financial, and performance arrays aligned to 4 cards each.',
      '- value should be short enough for a compact metric card.',
      '- helper should be one sentence grounded in the provided data.',
      '- Prefer actionable operational language over hype.',
      '',
      'Clinic context:',
      buildClinicContext(state, existingMemory),
    ].join('\n')
  );

  if (!response) {
    return null;
  }

  const insights: ClinicAIReportInsightSet = {
    dashboard: getInsightCards(response.data.dashboard, fallbackInsights.dashboard),
    executive: getInsightCards(response.data.executive, fallbackInsights.executive),
    financial: getInsightCards(response.data.financial, fallbackInsights.financial),
    performance: getInsightCards(response.data.performance, fallbackInsights.performance),
    generatedAt: new Date().toISOString(),
    model: response.model,
    source: 'deepseek',
  };

  return {
    insights,
    memory: buildClinicAIMemory(
      state,
      existingMemory,
      insights,
      response.data.memory_summary,
      response.data.focus_areas
    ),
    model: response.model,
    source: 'deepseek',
  };
}
