/**
 * Loads Golden Speciality Dental Clinic's printed price list into their workspace.
 *
 *   npm run seed:golden-prices                    # dry run: shows what would change
 *   npm run seed:golden-prices -- --apply         # writes it
 *   npm run seed:golden-prices -- --org <id>      # target a specific organization id
 *
 * Transcribed from the clinic's own laminated sheet ("ይፋዊ የዋጋ ዝርዝር / OFFICIAL
 * PRICE LIST"), in the order the paper lists them, so a patient holding the sheet
 * and a patient reading the waiting-room board see the same list in the same
 * order.
 *
 * Two things the sheet says that one integer cannot:
 *
 *   - A RANGE ("5,000 – 8,000"). The lower bound becomes the price and the note
 *     carries the ceiling, because the board's figure is what the patient is
 *     quoted from, and a mid-point would be a number the clinic never wrote.
 *   - FREE. A price of zero publishes as "On request", which is right for a
 *     treatment nobody can quote unseen and wrong for a consultation the clinic
 *     gives away. The note marks it; see `isFreeService` in the frontend.
 */
import '../src/env';
import '../src/admin/service';
import { prisma } from '../src/db';
import { updateClinicServicePrices } from '../src/clinic/service';

/** Matches the clinic by name when no organization id is passed. */
const clinicNameNeedle = 'golden';

type SeedService = {
  name: string;
  note: string;
  price: number;
};

/**
 * The sheet, row for row.
 *
 * Where the paper prints an Amharic name, that Amharic is used verbatim. Where it
 * prints only English — Registration Card, Scaling & Root Planing, Tooth
 * Whitening, Extraction, Impacted Extraction, RCT — the Amharic here was added to
 * match the rest of the board and should be read back by the clinic before it
 * goes on the wall.
 */
const goldenPriceList: SeedService[] = [
  // --- ምርመራና ንፅህና · Diagnostics & Hygiene ----------------------------------
  { name: 'Registration card / የካርድ ክፍያ', note: '', price: 300 },
  { name: 'Consultation / ምርመራ', note: 'Free / በነፃ', price: 0 },
  { name: 'Scaling & root planing / የጥርስ ጽዳት', note: '', price: 1500 },
  { name: 'Tooth whitening / የጥርስ ነጭ ማድረግ', note: '', price: 12000 },

  // --- ጥርስ መሙላት · Restorative / Filling --------------------------------------
  { name: 'Composite filling / ኮምፖዚት', note: '', price: 2500 },
  { name: 'GIC filling / ጂ.አይ.ሲ', note: '', price: 1500 },

  // --- ቀዶ ጥገናና የጥርስ ስር ህክምና · Surgical & RCT --------------------------------
  { name: 'Extraction (adult) / ጥርስ ማውጣት', note: '', price: 1500 },
  { name: 'Extraction (child) / ጥርስ መንቀል (ለህፃናት)', note: '', price: 1000 },
  { name: 'Impacted extraction / የተቀበረ ጥርስ ማውጣት', note: 'from · to 8,000', price: 5000 },
  { name: 'Root canal treatment (RCT) / የጥርስ ስር ህክምና', note: 'from · to 5,000', price: 2000 },

  // --- ቋሚ ሰው ሰራሽ ጥርስ · Fixed Prosthesis -------------------------------------
  { name: 'Zirconia crown / ዚርኮኒያ', note: '', price: 15000 },
  { name: 'Ceramic crown / ሴራሚክ', note: '', price: 7000 },
  { name: 'Gold crown / ወርቅ', note: '', price: 30000 },
  { name: 'Chrome cobalt / ክሮም ኮባልት', note: '', price: 3000 },

  // --- ተንቀሳቃሽ ሰው ሰራሽ ጥርስ · Removable Prosthesis -----------------------------
  { name: 'Rigid denture / ጠንካራ', note: 'per tooth / ለአንድ ጥርስ', price: 3000 },
  { name: 'Flexible denture / ተለዋዋጭ', note: 'per tooth / ለአንድ ጥርስ', price: 5000 },
  { name: 'Acrylic denture / አክሪሊክ', note: '', price: 2500 },

  // --- ልዩ ህክምናዎች · Specialized Care -----------------------------------------
  { name: 'Braces / የጥርስ ማስተካከያ', note: 'from · to 15,000', price: 12000 },
  { name: 'Jaw fracture treatment (IMF) / የመንጋጋ ስብራት ህክምና', note: '', price: 10000 },
  { name: 'Splinting / የተነቃነቁ ጥርስ ማሰር', note: '', price: 10000 },
  { name: 'Minor oral surgery / አነስተኛ የአፍ ውስጥ ቀዶ ጥገና', note: '', price: 8000 },
];

function readFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readOption(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function describe(service: SeedService) {
  const price = service.price > 0 ? `${service.price.toLocaleString('en-US')} ETB` : 'Free';
  return `  ${service.name.padEnd(56)} ${price}${service.note ? `  (${service.note})` : ''}`;
}

async function findOrganization(explicitId: string | undefined) {
  if (explicitId) {
    const organization = await prisma.organization.findUnique({
      where: { id: explicitId },
      select: { id: true, name: true },
    });

    if (!organization) throw new Error(`No organization with id ${explicitId}.`);

    return organization;
  }

  const matches = await prisma.organization.findMany({
    where: { name: { contains: clinicNameNeedle, mode: 'insensitive' } },
    select: { id: true, name: true },
  });

  if (!matches.length) {
    throw new Error(
      `No organization whose name contains "${clinicNameNeedle}". Pass --org <id> to target one directly.`
    );
  }

  // Never guess between two clinics: writing a price list onto the wrong one puts
  // the wrong figures on a public waiting-room board.
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} organizations match "${clinicNameNeedle}":\n${matches
        .map((match) => `  ${match.id}  ${match.name}`)
        .join('\n')}\nPass --org <id> to choose.`
    );
  }

  return matches[0];
}

async function main() {
  const apply = readFlag('apply');
  const organization = await findOrganization(readOption('org'));

  const workspace = await prisma.clinicWorkspaceState.findFirst({
    where: { organizationId: organization.id },
    select: { organizationProfile: true },
  });

  if (!workspace) {
    throw new Error(`${organization.name} has no workspace state row yet — open the app for that clinic once first.`);
  }

  const profile = (workspace.organizationProfile || {}) as { servicePrices?: unknown };
  const existing = Array.isArray(profile.servicePrices) ? profile.servicePrices : [];

  console.log(`Organization: ${organization.name}  (${organization.id})`);
  console.log(`Current price list: ${existing.length} row(s).`);
  console.log(`\nReplacing with ${goldenPriceList.length} row(s) from the printed sheet:`);
  goldenPriceList.forEach((service) => console.log(describe(service)));

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
    return;
  }

  const saved = await updateClinicServicePrices({
    organizationId: organization.id,
    servicePrices: goldenPriceList.map((service) => ({ ...service, id: service.name })),
  });

  if (!saved) {
    throw new Error('The workspace row was not updated. Nothing was written.');
  }

  console.log(`\nSaved ${saved.length} price(s) to ${organization.name}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
