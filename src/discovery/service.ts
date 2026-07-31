import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { DiscoveryAnswer, DiscoveryEntry, DiscoveryEntryInput } from './types';

type DiscoveryEntryRecord = {
  id: string;
  clinicName: string;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  answers: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function toDiscoveryAnswers(value: Prisma.JsonValue): DiscoveryAnswer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    return [{
      id: typeof record.id === 'string' ? record.id : '',
      question: typeof record.question === 'string' ? record.question : '',
      answer: typeof record.answer === 'string' ? record.answer : '',
      isCustom: record.isCustom === true,
    }];
  });
}

function toDiscoveryEntry(record: DiscoveryEntryRecord): DiscoveryEntry {
  return {
    id: record.id,
    clinicName: record.clinicName,
    contactName: record.contactName ?? undefined,
    contactPhone: record.contactPhone ?? undefined,
    notes: record.notes ?? undefined,
    answers: toDiscoveryAnswers(record.answers),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function normalizeInput(input: DiscoveryEntryInput) {
  const clinicName = typeof input.clinicName === 'string' ? input.clinicName.trim() : '';

  if (!clinicName) {
    throw new Error('Clinic name is required.');
  }

  const answers = Array.isArray(input.answers)
    ? input.answers.map((answer) => ({
        id: typeof answer?.id === 'string' ? answer.id : '',
        question: typeof answer?.question === 'string' ? answer.question : '',
        answer: typeof answer?.answer === 'string' ? answer.answer : '',
        isCustom: answer?.isCustom === true,
      }))
    : [];

  return {
    clinicName,
    contactName: typeof input.contactName === 'string' ? input.contactName.trim() || null : null,
    contactPhone: typeof input.contactPhone === 'string' ? input.contactPhone.trim() || null : null,
    notes: typeof input.notes === 'string' ? input.notes.trim() || null : null,
    answers: answers as unknown as Prisma.InputJsonValue,
  };
}

export async function listDiscoveryEntries(): Promise<DiscoveryEntry[]> {
  const records = await prisma.clinicDiscoveryEntry.findMany({
    orderBy: { updatedAt: 'desc' },
  });

  return records.map(toDiscoveryEntry);
}

export async function createDiscoveryEntry(input: DiscoveryEntryInput): Promise<DiscoveryEntry> {
  const record = await prisma.clinicDiscoveryEntry.create({
    data: normalizeInput(input),
  });

  return toDiscoveryEntry(record);
}

export async function updateDiscoveryEntry(id: string, input: DiscoveryEntryInput): Promise<DiscoveryEntry> {
  const record = await prisma.clinicDiscoveryEntry.update({
    where: { id },
    data: normalizeInput(input),
  });

  return toDiscoveryEntry(record);
}

export async function deleteDiscoveryEntry(id: string): Promise<void> {
  await prisma.clinicDiscoveryEntry.delete({ where: { id } });
}
