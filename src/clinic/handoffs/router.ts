import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { prisma } from '../../db';
import { resolveWorkspaceAccess } from '../permissions';
import type { ClinicRolePermission } from '../types';
import {
  acknowledgeHandoff,
  assignPatient,
  cancelOpenSignals,
  createReadySignal,
  dispatchPatient,
  listCareHandoffs,
} from './store';
import { ensureCareHandoffListener, subscribeToCareHandoffs } from './events';

export const careHandoffsRouter = Router();

/**
 * Resolves the caller's clinic. Mirrors the parent clinic router: the workspace
 * comes from the signed-in account, never from a request field, so a caller
 * cannot address another clinic's handoffs.
 */
function resolveOrganizationId(request: Request, response: Response) {
  const organizationId = request.actor?.organizationId || null;

  if (!organizationId) {
    response.status(403).json({ message: 'Unable to resolve the clinic workspace for this session.' });
    return null;
  }

  return organizationId;
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

careHandoffsRouter.get('/', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    response.json({ handoffs: await listCareHandoffs(organizationId) });
  } catch (error) {
    next(error);
  }
});

careHandoffsRouter.post('/', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    const doctorId = readString(request.body?.doctorId);
    const doctorName = readString(request.body?.doctorName);

    if (!doctorId || !doctorName) {
      response.status(400).json({ message: 'A doctor id and name are required.' });
      return;
    }

    const handoff = await createReadySignal({
      branchId: readString(request.body?.branchId),
      doctorId,
      doctorName,
      doctorSpecialty: readString(request.body?.doctorSpecialty, 'Dentist'),
      // The client may supply the id so its optimistic row and the stored row
      // are the same record, which keeps the echoed event from duplicating it.
      id: readString(request.body?.id) || `care-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      organizationId,
      requestedByMemberId: readString(request.body?.requestedByMemberId, request.actor?.id || ''),
    });

    response.status(201).json({ handoff });
  } catch (error) {
    next(error);
  }
});

careHandoffsRouter.post('/cancel', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    const handoffs = await cancelOpenSignals({
      doctorId: readString(request.body?.doctorId),
      organizationId,
      requestedByMemberId: readString(request.body?.requestedByMemberId, request.actor?.id || ''),
    });

    response.json({ handoffs });
  } catch (error) {
    next(error);
  }
});

careHandoffsRouter.post('/dispatch', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    const access = resolveWorkspaceAccess({ role: request.actor?.role });
    const canDispatch = access.canManageClinic || [
      'receptionist',
      'reception',
      'front_desk',
      'frontdesk',
    ].includes(access.role);

    if (!canDispatch) {
      response.status(403).json({ message: 'Only reception or a clinic admin can send a patient to a provider.' });
      return;
    }

    const doctorId = readString(request.body?.doctorId);
    const doctorName = readString(request.body?.doctorName);
    const patientId = readString(request.body?.patientId);
    const patientName = readString(request.body?.patientName);

    if (!doctorId || !doctorName || !patientId || !patientName) {
      response.status(400).json({ message: 'A patient and recipient are required.' });
      return;
    }

    const handoff = await dispatchPatient({
      ...(readString(request.body?.appointmentId) ? { appointmentId: readString(request.body?.appointmentId) } : {}),
      assignedByMemberId: request.actor?.id || '',
      assignedByName: request.actor?.fullName || 'Reception',
      branchId: readString(request.body?.branchId),
      doctorId,
      doctorName,
      doctorSpecialty: readString(request.body?.doctorSpecialty, 'Dentist'),
      id: readString(request.body?.id) || `care-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      organizationId,
      patientId,
      patientName,
    });

    response.status(201).json({ handoff });
  } catch (error) {
    next(error);
  }
});

careHandoffsRouter.post('/:id/assign', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    const patientId = readString(request.body?.patientId);
    const patientName = readString(request.body?.patientName);

    if (!patientId || !patientName) {
      response.status(400).json({ message: 'A patient is required to answer a handoff.' });
      return;
    }

    const handoff = await assignPatient({
      ...(readString(request.body?.appointmentId) ? { appointmentId: readString(request.body?.appointmentId) } : {}),
      assignedByMemberId: readString(request.body?.assignedByMemberId, request.actor?.id || ''),
      assignedByName: readString(request.body?.assignedByName, request.actor?.fullName || ''),
      handoffId: request.params.id,
      organizationId,
      patientId,
      patientName,
    });

    if (!handoff) {
      // Either it never existed, or a colleague answered it first.
      response.status(409).json({ message: 'This handoff was already answered or is no longer open.' });
      return;
    }

    response.json({ handoff });
  } catch (error) {
    next(error);
  }
});

careHandoffsRouter.post('/:id/acknowledge', async (request, response, next) => {
  try {
    const organizationId = resolveOrganizationId(request, response);

    if (!organizationId) {
      return;
    }

    const handoff = await acknowledgeHandoff({ handoffId: request.params.id, organizationId });

    if (!handoff) {
      response.status(409).json({ message: 'This handoff is no longer waiting to be acknowledged.' });
      return;
    }

    response.json({ handoff });
  } catch (error) {
    next(error);
  }
});

/** Idle gap after which a comment frame is sent to keep proxies from closing. */
const heartbeatMs = 25_000;
/** Revalidate long-lived streams after a platform suspension or denial. */
const accessRecheckMs = 5_000;

careHandoffsRouter.get('/stream', async (request, response, next) => {
  const organizationId = resolveOrganizationId(request, response);

  if (!organizationId) {
    return;
  }

  // Everything that can fail runs before the response is committed, so a failure
  // here is still a normal JSON error the client can read. The snapshot query is
  // the important one: it touches the database, and reading it after `writeHead`
  // would leave the only path to report the failure being `next()`, which cannot
  // work once headers are sent.
  let snapshot;
  let canReceiveTreatmentPrices = false;

  try {
    await ensureCareHandoffListener();
    const [handoffs, workspace] = await Promise.all([
      listCareHandoffs(organizationId),
      prisma.clinicWorkspaceState.findUnique({
        where: { organizationId },
        select: { rolePermissions: true },
      }),
    ]);
    snapshot = handoffs;
    const access = resolveWorkspaceAccess({
      role: request.actor?.role,
      rolePermissions: Array.isArray(workspace?.rolePermissions)
        ? workspace.rolePermissions as ClinicRolePermission[]
        : [],
    });
    canReceiveTreatmentPrices = (
      access.role === 'receptionist'
      && access.canViewPatientPayments
    );
  } catch (error) {
    next(error);
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx and similar proxies buffer responses by default, which would hold
    // frames back until the buffer fills and defeat the whole point.
    'X-Accel-Buffering': 'no',
  });

  // Past this line the response is an open stream. `next()` must never be called
  // again: the error handler would try to write a JSON body over headers that
  // have already gone out, which fails with ERR_HTTP_HEADERS_SENT and buries the
  // real error. Anything that goes wrong from here just closes the stream and
  // lets the client reconnect.
  let heartbeat: NodeJS.Timeout | null = null;
  let accessRecheck: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (accessRecheck) {
      clearInterval(accessRecheck);
      accessRecheck = null;
    }

    unsubscribe?.();
    unsubscribe = null;
    response.end();
  };

  const write = (chunk: string) => {
    if (closed || response.writableEnded) {
      return;
    }

    try {
      response.write(chunk);
    } catch (error) {
      console.error('Care handoff stream write failed:', error instanceof Error ? error.message : error);
      close();
    }
  };

  const send = (event: string, data: unknown) => {
    write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  request.on('close', close);
  request.on('error', close);
  response.on('error', close);

  // The current list rides the stream itself, so a reconnecting client is
  // resynchronised without a second request.
  send('snapshot', { handoffs: snapshot });

  unsubscribe = subscribeToCareHandoffs(organizationId, (event) => {
    if (event.type === 'changed') {
      send('changed', { handoff: event.handoff });
      return;
    }

    if (event.type === 'treatment-price' && canReceiveTreatmentPrices) {
      send('treatment-price', { price: event.price });
      return;
    }

    if (event.type === 'treatment-price') {
      return;
    }

    send('reload', {});
  });

  heartbeat = setInterval(() => {
    // A comment frame: ignored by the parser, enough to keep the socket alive.
    write(': keep-alive\n\n');
  }, heartbeatMs);

  accessRecheck = setInterval(() => {
    void prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    }).then((organization) => {
      if (organization?.status.trim().toLowerCase() !== 'active') {
        close();
      }
    }).catch((error) => {
      console.error('Care handoff access recheck failed:', error instanceof Error ? error.message : error);
      close();
    });
  }, accessRecheckMs);
});
