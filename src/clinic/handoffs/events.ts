import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { ClinicCareHandoff, ClinicTreatmentPriceHandoff } from '../types';

/**
 * Fan-out for care handoff changes.
 *
 * Subscribers are held in memory per process, which is all a single instance
 * needs. Delivery goes through a Postgres `NOTIFY` channel rather than straight
 * into the local map, so a clinic whose doctor and receptionist happen to be
 * connected to two different API processes still sees the same events. That
 * makes the transport correct whether the service runs as one process or ten,
 * with no configuration to get wrong: the publisher never assumes the listener
 * is itself.
 *
 * `NOTIFY` payloads are capped at 8000 bytes. A handoff is a fixed set of short
 * ids, names and timestamps, so it fits with room to spare; `publish` still
 * guards the limit and falls back to an id-only notice that tells listeners to
 * re-read rather than dropping the event.
 */

const channelName = 'care_handoff_events';

/**
 * Identifies this process on the shared channel. A publisher delivers to its own
 * subscribers directly and then tags what it sends, so when the notification
 * loops back it can be recognised and skipped instead of delivered twice.
 */
const originId = randomUUID();

export type CareHandoffEvent =
  | { type: 'changed'; organizationId: string; handoff: ClinicCareHandoff }
  | { type: 'treatment-price'; organizationId: string; price: ClinicTreatmentPriceHandoff }
  | { type: 'reload'; organizationId: string };

type PublishedEvent = CareHandoffEvent & { originId?: string };

type Subscriber = (event: CareHandoffEvent) => void;

const subscribersByOrganization = new Map<string, Set<Subscriber>>();

/** Registers a listener for one organization. Returns the unsubscribe. */
export function subscribeToCareHandoffs(organizationId: string, subscriber: Subscriber) {
  const existing = subscribersByOrganization.get(organizationId);
  const subscribers = existing ?? new Set<Subscriber>();

  if (!existing) {
    subscribersByOrganization.set(organizationId, subscribers);
  }

  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);

    // Drop the bucket once the last tab for a clinic disconnects, so the map
    // tracks live connections instead of every organization ever seen.
    if (!subscribers.size) {
      subscribersByOrganization.delete(organizationId);
    }
  };
}

function deliverLocally(event: CareHandoffEvent) {
  const subscribers = subscribersByOrganization.get(event.organizationId);

  if (!subscribers?.size) {
    return;
  }

  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event);
    } catch (error) {
      // One broken response must not stop delivery to the other tabs in the
      // clinic; the stream route removes its own subscriber when it closes.
      console.error('Care handoff subscriber failed:', error instanceof Error ? error.message : error);
    }
  }
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const maxNotifyPayloadBytes = 7000;

let listenClient: Client | null = null;
let listenStarting: Promise<void> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function parseEvent(payload: string | undefined): PublishedEvent | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as PublishedEvent;

    if (typeof parsed?.organizationId !== 'string' || !parsed.organizationId) {
      return null;
    }

    if (parsed.type === 'changed' && parsed.handoff?.id) {
      return parsed;
    }

    if (parsed.type === 'treatment-price' && parsed.price?.id) {
      return parsed;
    }

    if (parsed.type === 'reload') {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureCareHandoffListener();
  }, 2000);

  // A pending reconnect must not hold the process open during shutdown.
  reconnectTimer.unref?.();
}

/**
 * Opens the dedicated `LISTEN` connection. This cannot share the Prisma pool:
 * a listening connection is checked out for its whole life, so borrowing one
 * from the pool would starve queries.
 */
export function ensureCareHandoffListener(): Promise<void> {
  if (listenClient) {
    return Promise.resolve();
  }

  if (listenStarting) {
    return listenStarting;
  }

  if (!databaseUrl) {
    // Without a connection string there is nothing to listen on. Local
    // delivery still works, so a single process keeps functioning.
    return Promise.resolve();
  }

  const client = new Client({ connectionString: databaseUrl, keepAlive: true });

  listenStarting = (async () => {
    try {
      await client.connect();
      await client.query(`LISTEN ${channelName}`);

      client.on('notification', (notification) => {
        const event = parseEvent(notification.payload);

        if (!event) {
          return;
        }

        // Our own publishes were already handed to local subscribers before the
        // notification went out, so delivering the echo would re-render for
        // nothing. Events from other instances have a different origin and are
        // the reason this listener exists.
        if (event.originId === originId) {
          return;
        }

        deliverLocally(event);
      });

      client.on('error', (error) => {
        console.error('Care handoff listener error:', error.message);
        listenClient = null;
        void client.end().catch(() => undefined);
        scheduleReconnect();
      });

      client.on('end', () => {
        if (listenClient === client) {
          listenClient = null;
          scheduleReconnect();
        }
      });

      listenClient = client;
    } catch (error) {
      console.error('Care handoff listener failed to start:', error instanceof Error ? error.message : error);
      await client.end().catch(() => undefined);
      scheduleReconnect();
    } finally {
      listenStarting = null;
    }
  })();

  return listenStarting;
}

export async function stopCareHandoffListener() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const client = listenClient;
  listenClient = null;

  if (client) {
    await client.end().catch(() => undefined);
  }
}

/**
 * Broadcasts a change.
 *
 * Subscribers on this process are served first and synchronously, because the
 * database round trip a notification needs is pure latency for them: with a
 * single instance, the doctor and the receptionist are on this process, and that
 * is the whole hop the feature is trying to make instant.
 *
 * The notification then goes out for any other instance. It is best-effort — a
 * failed publish is logged but not thrown, since the local clinic has already
 * been updated and other instances recover on their own polling refresh.
 */
export async function publishCareHandoffEvent(
  event: CareHandoffEvent,
  query: (sql: string, values: unknown[]) => Promise<unknown>
) {
  deliverLocally(event);

  const serialized = JSON.stringify({ ...event, originId } satisfies PublishedEvent);
  const payload = Buffer.byteLength(serialized, 'utf8') > maxNotifyPayloadBytes
    // Too large to carry inline: tell other instances to re-read instead.
    ? JSON.stringify({ type: 'reload', organizationId: event.organizationId, originId } satisfies PublishedEvent)
    : serialized;

  try {
    await query(`SELECT pg_notify($1, $2)`, [channelName, payload]);
  } catch (error) {
    console.error('Care handoff notify failed:', error instanceof Error ? error.message : error);
  }
}
