import { randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';

/**
 * The public waiting-room price board.
 *
 * A clinic publishes one link and leaves it open on a television. It is read
 * without a session, so what it can return is deliberately narrow: the clinic's
 * display name and its published service prices. Nothing else in the workspace is
 * reachable through it — no patients, no staff, no takings.
 *
 * The URL is `/prices/<slug>/<code>`. The slug is readable so staff can recognise
 * their own link; the code is what makes it unguessable, and rotating the code
 * retires every copy of the old link at once.
 */

/**
 * No I, O, 0 or 1: the code gets read off a screen and typed into a TV browser by
 * hand, and those four are the pairs people mistake for each other.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PRICE_BOARD_CODE_LENGTH = 5;

export type PriceBoardLink = {
  slug: string;
  code: string;
  /** Browser path, so the clinic UI never has to know how the URL is composed. */
  path: string;
};

export type PublicPriceBoardService = {
  id: string;
  name: string;
  note: string;
  price: number;
};

export type PublicPriceBoard = {
  clinicName: string;
  services: PublicPriceBoardService[];
};

export function buildPriceBoardPath(slug: string, code: string) {
  return `/prices/${slug}/${code}`;
}

export function normalizePriceBoardSlug(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

export function normalizePriceBoardCode(value: string | null | undefined) {
  return (value || '').trim().toUpperCase();
}

export function generatePriceBoardCode() {
  return Array.from(
    { length: PRICE_BOARD_CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  ).join('');
}

/**
 * A URL-safe clinic name.
 *
 * NFKD splits an accented letter into a base letter plus a combining mark, and the
 * class below drops the mark, so "Zurich Dental" and "Zurich Dental" slug the same
 * way. An Amharic name has no ASCII to keep at all, so it falls back to a generic
 * segment rather than to an empty one.
 */
function slugifyClinicName(name: string) {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  return slug || 'clinic';
}

/**
 * The clinic's slug, claimed on first use and kept afterwards.
 *
 * Reusing the stored slug matters more than keeping it in step with the clinic's
 * current name: printed and bookmarked links point at the old one, and a rename
 * should not take the waiting-room board down.
 */
async function claimPriceBoardSlug(organizationId: string, clinicName: string) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { priceBoardSlug: true },
  });

  if (existing?.priceBoardSlug) {
    return existing.priceBoardSlug;
  }

  const base = slugifyClinicName(clinicName);

  // Two clinics can share a name. The first keeps the bare slug; the next takes a
  // numbered one, checked against the unique index rather than assumed free.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.organization.findUnique({
      where: { priceBoardSlug: candidate },
      select: { id: true },
    });

    if (!taken || taken.id === organizationId) {
      return candidate;
    }
  }

  throw new Error('Could not reserve a price board address for this clinic.');
}

/** Reads the current link, or null when the board has never been published. */
export async function getPriceBoardLink(organizationId: string): Promise<PriceBoardLink | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { priceBoardCode: true, priceBoardSlug: true },
  });

  if (!organization?.priceBoardSlug || !organization.priceBoardCode) {
    return null;
  }

  return {
    slug: organization.priceBoardSlug,
    code: organization.priceBoardCode,
    path: buildPriceBoardPath(organization.priceBoardSlug, organization.priceBoardCode),
  };
}

/**
 * Publishes the board, or rotates the code of a board already published. Every
 * link handed out before this call stops working.
 */
export async function createPriceBoardLink(
  organizationId: string,
  clinicName: string
): Promise<PriceBoardLink> {
  const slug = await claimPriceBoardSlug(organizationId, clinicName);
  const code = generatePriceBoardCode();

  await prisma.organization.update({
    where: { id: organizationId },
    data: { priceBoardCode: code, priceBoardSlug: slug },
  });

  return { slug, code, path: buildPriceBoardPath(slug, code) };
}

/** Turns the public board off. The slug stays reserved for the next link. */
export async function disablePriceBoardLink(organizationId: string) {
  await prisma.organization.update({
    where: { id: organizationId },
    data: { priceBoardCode: null },
  });
}

function codesMatch(expected: string, provided: string) {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');

  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, providedBytes);
}

function readPublishedServices(organizationProfile: unknown): PublicPriceBoardService[] {
  const servicePrices = (organizationProfile as { servicePrices?: unknown })?.servicePrices;

  if (!Array.isArray(servicePrices)) {
    return [];
  }

  return servicePrices.flatMap((entry): PublicPriceBoardService[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const service = entry as Record<string, unknown>;
    const name = typeof service.name === 'string' ? service.name.trim() : '';

    if (!name) {
      return [];
    }

    const price = Number(service.price);

    return [{
      id: typeof service.id === 'string' && service.id.trim() ? service.id.trim() : name,
      name,
      note: typeof service.note === 'string' ? service.note.trim() : '',
      // A missing or unreadable price publishes as "on request" rather than as 0.
      price: Number.isFinite(price) && price > 0 ? price : 0,
    }];
  });
}

/**
 * The board behind a public link, or null when the link does not resolve.
 *
 * A wrong code, a board that was turned off, and a clinic whose workspace is no
 * longer active all answer the same way: nothing here. The caller must not
 * distinguish them, or the response becomes an oracle for which clinics exist.
 */
export async function loadPublicPriceBoard(
  slugValue: string,
  codeValue: string
): Promise<PublicPriceBoard | null> {
  const slug = normalizePriceBoardSlug(slugValue);
  const code = normalizePriceBoardCode(codeValue);

  if (!slug || !code) {
    return null;
  }

  const organization = await prisma.organization.findUnique({
    where: { priceBoardSlug: slug },
    select: {
      name: true,
      priceBoardCode: true,
      status: true,
      clinicWorkspaceState: { select: { organizationProfile: true } },
    },
  });

  if (!organization?.priceBoardCode || !codesMatch(organization.priceBoardCode, code)) {
    return null;
  }

  // The same standing the rest of the clinic API requires. A suspended or
  // unapproved clinic stops publishing prices along with everything else.
  if (organization.status.trim().toLowerCase() !== 'active') {
    return null;
  }

  const profile = organization.clinicWorkspaceState?.organizationProfile;
  const profileName = typeof (profile as { name?: unknown })?.name === 'string'
    ? ((profile as { name: string }).name).trim()
    : '';

  return {
    clinicName: profileName || organization.name.trim(),
    services: readPublishedServices(profile),
  };
}
