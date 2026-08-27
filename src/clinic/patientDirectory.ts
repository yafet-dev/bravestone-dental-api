/**
 * One page of the patient directory, read straight from the relational patient
 * tables.
 *
 * Deliberately not `GET /bootstrap`: that answers with the whole workspace —
 * every patient, profile, payment, appointment and diagnosis in the clinic —
 * which the Patients screen then filtered and drew in one go. A clinic with
 * several hundred patients paid for all of them on every visit to the page, and
 * again on every live refresh. This reads one page instead: the search, the
 * filters, the sort, the count and the offset all run in the database, and only
 * the rows that will actually be drawn come back.
 *
 * Role redaction is not re-implemented here. The page is dressed as a workspace
 * document and put through the same {@link scopeClinicStateForAccess} that
 * guards the bootstrap response, so a role without the financial grant sees the
 * same zeroed balances on this route as on that one.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { scopeClinicStateForAccess } from './access';
import type { WorkspaceAccess } from './permissions';
import type {
  ClinicDiagnosis,
  ClinicPatient,
  ClinicPatientPayment,
  ClinicPatientProfile,
  ClinicPaymentPlan,
  ClinicWorkspaceState,
} from './types';

/** Offered by the rows-per-page selector. Any other size falls back to the default. */
export const PATIENT_DIRECTORY_PAGE_SIZES = [10, 25, 50, 100] as const;

const defaultPageSize = 25;
const patientStatuses = new Set(['active', 'inactive', 'lost']);
const needsPaymentStatus = 'needsPayment';
const maximumSearchLength = 120;

export type PatientDirectoryRecordFilter = 'all' | 'has' | 'none';

export type PatientDirectoryQuery = {
  page: number;
  pageSize: number;
  records: PatientDirectoryRecordFilter;
  search: string;
  status: string;
};

type PatientDirectorySlices = Pick<
  ClinicWorkspaceState,
  'patients' | 'patientProfiles' | 'patientPayments'
>;

/**
 * Directory-wide tallies for the filter menu, which names how many patients each
 * option would show. They answer for the whole directory under the search and
 * status already applied — not for the page.
 */
type PatientDirectoryCounts = {
  withRecords: number;
  withoutRecords: number;
};

export type PatientDirectoryPage = PatientDirectoryQuery & PatientDirectorySlices & {
  counts: PatientDirectoryCounts;
  total: number;
  totalPages: number;
};

type PatientDirectoryResult = PatientDirectorySlices & {
  counts: PatientDirectoryCounts;
  total: number;
};

/**
 * Reads a query string into a directory request.
 *
 * Every field falls back to its unfiltered default rather than erroring: a
 * malformed page number should show the first page, not put an error screen
 * where the clinic's patient list belongs.
 */
export function parsePatientDirectoryQuery(query: Record<string, unknown>): PatientDirectoryQuery {
  const readText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const requestedPage = Number.parseInt(readText(query.page), 10);
  const requestedPageSize = Number.parseInt(readText(query.pageSize), 10);
  const requestedStatus = readText(query.status);
  const requestedRecords = readText(query.records);

  return {
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: (PATIENT_DIRECTORY_PAGE_SIZES as readonly number[]).includes(requestedPageSize)
      ? requestedPageSize
      : defaultPageSize,
    records: requestedRecords === 'has' || requestedRecords === 'none' ? requestedRecords : 'all',
    search: readText(query.search).slice(0, maximumSearchLength),
    status: requestedStatus === needsPaymentStatus || patientStatuses.has(requestedStatus)
      ? requestedStatus
      : 'all',
  };
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizePatientEmail(email: string | null | undefined) {
  const normalized = typeof email === 'string' ? email.trim() : '';
  return normalized === 'No email recorded' ? '' : normalized;
}

function normalizePatientAddress(address: string | null | undefined) {
  const normalized = typeof address === 'string' ? address.trim() : '';
  return normalized === 'Address on file' ? '' : normalized;
}

function toPaymentPlan(value: unknown): ClinicPaymentPlan {
  const plan = (value && typeof value === 'object' ? value : {}) as Partial<ClinicPaymentPlan>;
  const amount = (candidate: unknown) => (Number.isFinite(candidate) ? Number(candidate) : 0);

  return {
    treatment: typeof plan.treatment === 'string' ? plan.treatment : '',
    total: amount(plan.total),
    paid: amount(plan.paid),
    firstPayment: amount(plan.firstPayment),
    lastPaymentDate: typeof plan.lastPaymentDate === 'string' ? plan.lastPaymentDate : '',
    method: typeof plan.method === 'string' ? plan.method : '',
  };
}

/**
 * What the search box matches: a name, an email address, a phone number, or a
 * patient number. Phone matching stays case-sensitive because a phone number has
 * no case to fold.
 *
 * This and {@link matchesStatus} are the readable statement of what each filter
 * means. {@link readRelationalDirectoryPage} expresses the same rules as SQL, and
 * the legacy fallback applies these directly — the two have to move together.
 */
function matchesSearch(
  patient: ClinicPatient,
  profile: ClinicPatientProfile | undefined,
  search: string,
) {
  if (!search) {
    return true;
  }

  const query = search.toLowerCase();

  return (
    patient.name.toLowerCase().includes(query)
    || normalizePatientEmail(patient.email).toLowerCase().includes(query)
    || patient.phone.includes(search)
    || (profile?.directoryId || '').toLowerCase().includes(query)
  );
}

function matchesStatus(
  patient: ClinicPatient,
  profile: ClinicPatientProfile | undefined,
  status: string,
) {
  if (status === 'all') {
    return true;
  }

  return status === needsPaymentStatus
    ? (profile?.pendingAmount ?? 0) > 0
    : patient.status === status;
}

/**
 * The patients who have at least one clinical record.
 *
 * A diagnosis normally carries the patient's id, but rows written before that
 * column existed identify the patient by name alone, and the Patients screen has
 * always counted those too. Resolving both in one `EXISTS` keeps the work in the
 * database instead of pulling every diagnosis in the clinic across the wire to
 * match names in memory.
 */
async function readPatientIdsWithRecords(organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p."id"
    FROM "clinic_patients" p
    WHERE p."organizationId" = ${organizationId}
      AND EXISTS (
        SELECT 1
        FROM "clinic_diagnoses" d
        WHERE d."organizationId" = p."organizationId"
          AND (
            d."patientId" = p."id"
            OR (d."patientId" IS NULL AND lower(btrim(d."patient")) = lower(btrim(p."name")))
          )
      )
  `;

  return rows.map((row) => row.id);
}

/**
 * Applies the caller's role to one page.
 *
 * The page is dressed as a workspace document purely so the single redaction
 * pass that guards `GET /bootstrap` can run over it unchanged. There is no second
 * copy of the money rules here to drift out of step with the first.
 */
function scopePatientSlices(
  slices: PatientDirectorySlices,
  access: WorkspaceAccess,
  actorId?: string,
): PatientDirectorySlices {
  const scoped = scopeClinicStateForAccess(
    {
      ...slices,
      appointments: [],
      revenueData: [],
      doctors: [],
      procedures: [],
      diagnoses: [],
      symptoms: [],
      prescriptions: [],
      invoices: [],
      forms: [],
      sickLeaves: [],
      reports: [],
      staffUsers: [],
      roles: [],
      rolePermissions: [],
      branches: [],
      organizationProfile: { name: '', legalName: '', contact: '', license: '' },
      financeEntries: [],
    },
    access,
    actorId,
  );

  return {
    patients: scoped.patients,
    patientProfiles: scoped.patientProfiles,
    patientPayments: scoped.patientPayments,
  };
}

/**
 * Pages a directory held entirely in memory.
 *
 * The in-memory twin of {@link readRelationalDirectoryPage}, for legacy
 * workspaces whose patients still live only in the JSON snapshot. Kept pure and
 * exported so the filter, tally and offset rules can be tested directly rather
 * than only through a database that no longer contains such a workspace.
 */
export function pagePatientDirectorySlices(
  slices: PatientDirectorySlices & { diagnoses: Pick<ClinicDiagnosis, 'patient' | 'patientId'>[] },
  query: PatientDirectoryQuery,
): PatientDirectoryResult {
  const profileByPatientId = new Map(
    slices.patientProfiles.map((profile) => [profile.patientId, profile]),
  );
  const patientIdByName = new Map(
    slices.patients.map((patient) => [patient.name.trim().toLowerCase(), patient.id]),
  );
  const idsWithRecords = new Set<string>();

  slices.diagnoses.forEach((diagnosis) => {
    const patientId = diagnosis.patientId
      || patientIdByName.get(diagnosis.patient?.trim().toLowerCase() || '');

    if (patientId) {
      idsWithRecords.add(patientId);
    }
  });

  const matched = slices.patients.filter((patient) => {
    const profile = profileByPatientId.get(patient.id);
    return matchesSearch(patient, profile, query.search)
      && matchesStatus(patient, profile, query.status);
  });
  const withRecords = matched.filter((patient) => idsWithRecords.has(patient.id)).length;
  const selected = query.records === 'all'
    ? matched
    : matched.filter((patient) => idsWithRecords.has(patient.id) === (query.records === 'has'));
  const page = selected.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const pageIds = new Set(page.map((patient) => patient.id));

  return {
    counts: { withRecords, withoutRecords: matched.length - withRecords },
    patients: page,
    patientProfiles: page.flatMap((patient) => {
      const profile = profileByPatientId.get(patient.id);
      return profile ? [profile] : [];
    }),
    patientPayments: slices.patientPayments.filter((payment) => pageIds.has(payment.patientId)),
    total: selected.length,
  };
}

/**
 * Legacy workspaces whose patients still live only in the JSON snapshot.
 *
 * The relational tables are rewritten by every workspace save, so this path is
 * taken only until the next one lands. It still reads four JSON columns rather
 * than the twenty a bootstrap read touches, and pages in memory because there
 * are no rows to ask the database about.
 */
async function readLegacyDirectoryPage(
  organizationId: string,
  query: PatientDirectoryQuery,
): Promise<PatientDirectoryResult | null> {
  const record = await prisma.clinicWorkspaceState.findUnique({
    where: { organizationId },
    select: {
      patients: true,
      patientProfiles: true,
      patientPayments: true,
      diagnoses: true,
    },
  });
  const patients = toJsonArray<ClinicPatient>(record?.patients);

  if (!patients.length) {
    return null;
  }

  return pagePatientDirectorySlices({
    patients,
    patientProfiles: toJsonArray<ClinicPatientProfile>(record?.patientProfiles),
    patientPayments: toJsonArray<ClinicPatientPayment>(record?.patientPayments),
    diagnoses: toJsonArray<ClinicDiagnosis>(record?.diagnoses),
  }, query);
}

async function readRelationalDirectoryPage(
  organizationId: string,
  query: PatientDirectoryQuery,
  idsWithRecords: string[],
): Promise<PatientDirectoryResult> {
  // Built as an AND list rather than one object literal because the search and
  // the "needs payment" status both reach into the profile relation, and a single
  // object cannot carry that key twice.
  const conditions: Prisma.ClinicPatientWhereInput[] = [{ organizationId }];

  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { patientProfile: { directoryId: { contains: query.search, mode: 'insensitive' } } },
      ],
    });
  }

  if (query.status === needsPaymentStatus) {
    conditions.push({ patientProfile: { pendingAmount: { gt: 0 } } });
  } else if (query.status !== 'all') {
    conditions.push({ status: query.status });
  }

  const searched: Prisma.ClinicPatientWhereInput = { AND: conditions };
  const recordScoped: Prisma.ClinicPatientWhereInput = query.records === 'all'
    ? searched
    : {
      AND: [
        ...conditions,
        { id: query.records === 'has' ? { in: idsWithRecords } : { notIn: idsWithRecords } },
      ],
    };

  // The filter menu's two tallies are counted against the search and status the
  // user already applied, so switching between "Has records" and "No records"
  // can never claim more patients than the directory is showing.
  const [total, withRecords, rows] = await Promise.all([
    prisma.clinicPatient.count({ where: recordScoped }),
    prisma.clinicPatient.count({ where: { AND: [...conditions, { id: { in: idsWithRecords } }] } }),
    prisma.clinicPatient.findMany({
      where: recordScoped,
      // Newest registration first, which is where a just-added patient belongs.
      // `createdAt` cannot serve: a workspace save deletes and recreates every
      // patient row, so it records the last save rather than the registration.
      // The id breaks ties, so two pages of one list never repeat or skip a
      // patient.
      orderBy: [{ patientProfile: { registrationTime: 'desc' } }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { patientProfile: true },
    }),
  ]);
  // Identical to `total` unless a record filter is narrowing the page, so the
  // extra count is only paid for when it would actually differ.
  const matchedTotal = query.records === 'all'
    ? total
    : await prisma.clinicPatient.count({ where: searched });
  const pageIds = rows.map((row) => row.id);
  // Every payment belonging to the patients on this page, because the browser
  // derives what a patient has paid and still owes from the transactions
  // themselves — the same derivation the rest of the workspace uses. Sending the
  // stored total instead would let this screen disagree with the patient's own
  // profile by a payment.
  const payments = pageIds.length
    ? await prisma.clinicPatientPayment.findMany({
      where: { organizationId, patientId: { in: pageIds } },
      orderBy: { date: 'asc' },
    })
    : [];

  return {
    counts: { withRecords, withoutRecords: matchedTotal - withRecords },
    patients: rows.map((row): ClinicPatient => ({
      id: row.id,
      name: row.name,
      age: row.age,
      gender: row.gender as ClinicPatient['gender'],
      phone: row.phone,
      email: normalizePatientEmail(row.email),
      lastVisit: row.lastVisit,
      status: row.status as ClinicPatient['status'],
      balance: row.balance,
      medicalHistory: toStringList(row.medicalHistory),
      dentalChart: toJsonArray<NonNullable<ClinicPatient['dentalChart']>[number]>(row.dentalChart),
      notes: toJsonArray<NonNullable<ClinicPatient['notes']>[number]>(row.notes),
      emergencyContacts: toJsonArray<NonNullable<ClinicPatient['emergencyContacts']>[number]>(
        row.emergencyContacts,
      ),
    })),
    patientProfiles: rows.flatMap((row): ClinicPatientProfile[] => {
      const profile = row.patientProfile;

      if (!profile) {
        return [];
      }

      return [{
        patientId: profile.patientId,
        directoryId: profile.directoryId,
        dob: profile.dob,
        address: normalizePatientAddress(profile.address),
        branchId: profile.branchId,
        branchName: profile.branchName,
        bloodGroup: profile.bloodGroup,
        ...(profile.nextAppointment ? { nextAppointment: profile.nextAppointment } : {}),
        paymentPlan: toPaymentPlan(profile.paymentPlan),
        pendingAmount: profile.pendingAmount,
        recordCount: profile.recordCount,
        cardNumber: profile.cardNumber,
        registrationTime: profile.registrationTime,
      }];
    }),
    patientPayments: payments.map((payment): ClinicPatientPayment => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date,
      amount: payment.amount,
      method: payment.method,
      receivedBy: payment.receivedBy,
      note: payment.note,
    })),
    total,
  };
}

export async function readPatientDirectoryPage({
  access,
  actorId,
  organizationId,
  query,
}: {
  access: WorkspaceAccess;
  actorId?: string;
  organizationId: string;
  query: PatientDirectoryQuery;
}): Promise<PatientDirectoryPage> {
  // Whether a patient has a diagnosis is clinical information in its own right.
  // Accounting gets the directory for billing, but not this record-presence
  // filter or its clinic-wide counts.
  const effectiveQuery: PatientDirectoryQuery = access.role === 'accountant'
    ? { ...query, records: 'all' }
    : query;
  const relationalCount = await prisma.clinicPatient.count({ where: { organizationId } });
  const result = relationalCount === 0
    ? await readLegacyDirectoryPage(organizationId, effectiveQuery)
    : await readRelationalDirectoryPage(
      organizationId,
      effectiveQuery,
      access.role === 'accountant' ? [] : await readPatientIdsWithRecords(organizationId),
    );

  if (!result) {
    return {
      ...effectiveQuery,
      counts: { withRecords: 0, withoutRecords: 0 },
      patients: [],
      patientProfiles: [],
      patientPayments: [],
      total: 0,
      totalPages: 0,
    };
  }

  return {
    ...effectiveQuery,
    ...scopePatientSlices(result, access, actorId),
    counts: access.role === 'accountant'
      ? { withRecords: 0, withoutRecords: result.total }
      : result.counts,
    // The page asked for is reported back as asked for, not clamped: a filter can
    // empty the directory while the user sits on page four, and the screen can
    // then offer to go back to the first page instead of silently showing rows
    // under a page number that no longer exists.
    page: effectiveQuery.page,
    total: result.total,
    totalPages: Math.ceil(result.total / query.pageSize),
  };
}
