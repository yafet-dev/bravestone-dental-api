import type { ClinicVitalReading } from './types';

const positiveNumber = (value: unknown) => typeof value === 'string'
  && /^\d+(?:\.\d+)?$/.test(value.trim()) && Number(value) > 0 && Number.isFinite(Number(value));

export function validVitalMeasurements(value: Pick<ClinicVitalReading, 'temperature' | 'systolic' | 'diastolic' | 'fbs'>) {
  const fields = [value.temperature, value.systolic, value.diastolic, value.fbs];
  return fields.some(field => field.trim())
    && fields.every(field => !field.trim() || positiveNumber(field))
    && Boolean(value.systolic.trim()) === Boolean(value.diastolic.trim());
}

export function normalizeVitalReadings(value: unknown): ClinicVitalReading[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id
      || seen.has(item.id) || typeof item.recordedAt !== 'string'
      || !Number.isFinite(Date.parse(item.recordedAt)) || typeof item.recordedBy !== 'string') return [];
    const reading: ClinicVitalReading = {
      id: item.id, recordedAt: item.recordedAt, recordedBy: item.recordedBy,
      temperature: typeof item.temperature === 'string' ? item.temperature.trim() : '',
      systolic: typeof item.systolic === 'string' ? item.systolic.trim() : '',
      diastolic: typeof item.diastolic === 'string' ? item.diastolic.trim() : '',
      fbs: typeof item.fbs === 'string' ? item.fbs.trim() : '',
    };
    if (!validVitalMeasurements(reading)) return [];
    seen.add(reading.id);
    return [reading];
  }).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}

/** Readings are append-only so a stale patient edit cannot erase the history. */
export function mergeVitalReadings(stored: unknown, incoming: unknown) {
  return normalizeVitalReadings([...normalizeVitalReadings(stored), ...normalizeVitalReadings(incoming)]);
}
