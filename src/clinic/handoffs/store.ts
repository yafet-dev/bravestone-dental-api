import type { CareHandoff, Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { ClinicCareHandoff, ClinicCareHandoffStatus } from '../types';
import { publishCareHandoffEvent } from './events';

/** Statuses a handoff can still move out of. */
const openStatuses: ClinicCareHandoffStatus[] = ['ready', 'assigned'];

/** Reception only ever needs the recent tail, not the clinic's whole history. */
const listLimit = 60;

function toIsoString(value: Date) {
  return value.toISOString();
}

/**
 * Maps a row to the shape the browser already understands. Nulls are dropped
 * rather than passed through, because the client type declares these keys
 * optional and `undefined` is what its existing checks expect.
 */
export function toClinicCareHandoff(row: CareHandoff): ClinicCareHandoff {
  return {
    id: row.id,
    branchId: row.branchId,
    doctorId: row.doctorId,
    doctorName: row.doctorName,
    doctorSpecialty: row.doctorSpecialty,
    requestedByMemberId: row.requestedByMemberId,
    requestedAt: toIsoString(row.requestedAt),
    status: row.status as ClinicCareHandoffStatus,
    updatedAt: toIsoString(row.updatedAt),
    ...(row.patientId ? { patientId: row.patientId } : {}),
    ...(row.patientName ? { patientName: row.patientName } : {}),
    ...(row.appointmentId ? { appointmentId: row.appointmentId } : {}),
    ...(row.assignedByMemberId ? { assignedByMemberId: row.assignedByMemberId } : {}),
    ...(row.assignedByName ? { assignedByName: row.assignedByName } : {}),
    ...(row.assignedAt ? { assignedAt: toIsoString(row.assignedAt) } : {}),
    ...(row.acknowledgedAt ? { acknowledgedAt: toIsoString(row.acknowledgedAt) } : {}),
  };
}

/** Notify runs through the Prisma pool; the listener owns its own connection. */
function notify(organizationId: string, handoff: ClinicCareHandoff) {
  return publishCareHandoffEvent(
    { type: 'changed', organizationId, handoff },
    (sql, values) => prisma.$executeRawUnsafe(sql, ...values)
  );
}

export async function listCareHandoffs(organizationId: string): Promise<ClinicCareHandoff[]> {
  const rows = await prisma.careHandoff.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    take: listLimit,
  });

  return rows.map(toClinicCareHandoff);
}

export type CreateReadySignalInput = {
  branchId: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  id: string;
  organizationId: string;
  requestedByMemberId: string;
};

/**
 * Records a doctor as free. Any signal they already had open is cancelled in the
 * same transaction, so a doctor can never appear twice in reception's queue.
 */
export async function createReadySignal(input: CreateReadySignalInput) {
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    await tx.careHandoff.updateMany({
      where: {
        organizationId: input.organizationId,
        status: { in: openStatuses },
        OR: [
          { doctorId: input.doctorId },
          { requestedByMemberId: input.requestedByMemberId },
        ],
      },
      data: { status: 'cancelled', updatedAt: now },
    });

    return tx.careHandoff.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        branchId: input.branchId,
        doctorId: input.doctorId,
        doctorName: input.doctorName,
        doctorSpecialty: input.doctorSpecialty,
        requestedByMemberId: input.requestedByMemberId,
        requestedAt: now,
        status: 'ready',
        updatedAt: now,
      },
    });
  });

  const handoff = toClinicCareHandoff(created);
  await notify(input.organizationId, handoff);

  return handoff;
}

export async function cancelOpenSignals(input: {
  doctorId: string;
  organizationId: string;
  requestedByMemberId: string;
}) {
  const now = new Date();
  const where: Prisma.CareHandoffWhereInput = {
    organizationId: input.organizationId,
    status: { in: openStatuses },
    OR: [
      { doctorId: input.doctorId },
      { requestedByMemberId: input.requestedByMemberId },
    ],
  };

  const affected = await prisma.careHandoff.findMany({ where, select: { id: true } });

  if (!affected.length) {
    return [];
  }

  await prisma.careHandoff.updateMany({ where, data: { status: 'cancelled', updatedAt: now } });

  const rows = await prisma.careHandoff.findMany({
    where: { id: { in: affected.map((row) => row.id) } },
  });
  const handoffs = rows.map(toClinicCareHandoff);

  await Promise.all(handoffs.map((handoff) => notify(input.organizationId, handoff)));

  return handoffs;
}

export type AssignPatientInput = {
  appointmentId?: string;
  assignedByMemberId: string;
  assignedByName: string;
  handoffId: string;
  organizationId: string;
  patientId: string;
  patientName: string;
};

/**
 * Sends a patient in. The `status: 'ready'` guard is the point of the dedicated
 * table: two receptionists answering the same signal both run this, and only
 * the first update matches, so the second is told the signal is already taken
 * instead of silently overwriting the first one's choice of patient.
 */
export async function assignPatient(input: AssignPatientInput) {
  const now = new Date();
  const result = await prisma.careHandoff.updateMany({
    where: {
      id: input.handoffId,
      organizationId: input.organizationId,
      status: 'ready',
    },
    data: {
      appointmentId: input.appointmentId ?? null,
      assignedAt: now,
      assignedByMemberId: input.assignedByMemberId,
      assignedByName: input.assignedByName,
      patientId: input.patientId,
      patientName: input.patientName,
      status: 'assigned',
      updatedAt: now,
    },
  });

  if (!result.count) {
    return null;
  }

  const row = await prisma.careHandoff.findUnique({ where: { id: input.handoffId } });

  if (!row) {
    return null;
  }

  const handoff = toClinicCareHandoff(row);
  await notify(input.organizationId, handoff);

  return handoff;
}

/** Doctor confirms they have the patient. Guarded the same way as assignment. */
export async function acknowledgeHandoff(input: { handoffId: string; organizationId: string }) {
  const now = new Date();
  const result = await prisma.careHandoff.updateMany({
    where: {
      id: input.handoffId,
      organizationId: input.organizationId,
      status: 'assigned',
    },
    data: {
      acknowledgedAt: now,
      status: 'acknowledged',
      updatedAt: now,
    },
  });

  if (!result.count) {
    return null;
  }

  const row = await prisma.careHandoff.findUnique({ where: { id: input.handoffId } });

  if (!row) {
    return null;
  }

  const handoff = toClinicCareHandoff(row);
  await notify(input.organizationId, handoff);

  return handoff;
}
