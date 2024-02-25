/**
 * Validation and re-encoding for uploaded clinical images.
 *
 * Two policies, because the two kinds of image are read differently:
 *
 * - **Photos** (intra-oral shots, documents, consent forms) are looked at, not
 *   measured. They are capped at 2000px and re-encoded to lossy WebP, which is
 *   typically a 90%+ saving.
 * - **Radiographs** (OPG, periapical, bitewing, CBCT slices, ceph) are diagnostic.
 *   A dentist reads fine trabecular detail and margin sharpness off them, and lossy
 *   compression is exactly what destroys that. They are capped at 3000px — enough to
 *   discard a needlessly huge scan — and encoded **lossless**, so no detail the
 *   sensor captured is thrown away.
 *
 * Re-encoding also strips metadata as a side effect, which matters here: phone
 * cameras write GPS coordinates into EXIF, and a patient photo carrying the clinic's
 * location (or a home visit's) is a privacy leak nobody asked for.
 */
import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

export const maxUploadBytes = 25 * 1024 * 1024;

const photoMaxDimension = 2000;
const radiographMaxDimension = 3000;
const photoWebpQuality = 80;
const radiographWebpQuality = 100;

/** What a browser is allowed to send us. Checked against real bytes, not the label. */
const acceptedFormats = new Set(['jpeg', 'jpg', 'png', 'webp', 'gif', 'tiff']);

export type PreparedImage = {
  checksum: string;
  contents: Buffer;
  contentType: string;
  height: number | null;
  isRadiograph: boolean;
  width: number | null;
};

export class ImageRejected extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Words that mean "this is a radiograph".
 *
 * Matched against the file name as a hint only — the caller can also say so
 * explicitly, and an unrecognised name simply means the photo policy applies.
 *
 * The boundaries are letter/digit lookarounds rather than `\b`, because `\b` counts
 * `_` as a word character and so missed `xray_upper.png` and `opg_2026.png` — camera
 * and sensor software separates with underscores more often than anything else.
 */
const radiographNamePattern = /(?<![a-z0-9])(x-?ray|radiograph[a-z]*|opg|panoramic|pano|periapical|bitewing|cbct|ceph[a-z]*|dicom|dcm|rvg)(?![a-z0-9])/i;

export function looksLikeRadiograph(fileName: string) {
  return radiographNamePattern.test(fileName || '');
}

/**
 * Decides the policy for one upload.
 *
 * An explicit `true` from the client is honoured; an explicit `false` is not allowed
 * to *downgrade* a file whose name says radiograph, because the cost of wrongly
 * compressing a diagnostic image is far higher than the cost of storing a photo
 * losslessly by mistake.
 */
export function resolveIsRadiograph(fileName: string, declared?: unknown) {
  if (declared === true) {
    return true;
  }

  return looksLikeRadiograph(fileName);
}

/** Strips directory parts and anything that is not safe to echo back. */
export function sanitizeFileName(fileName: unknown) {
  const raw = typeof fileName === 'string' ? fileName : '';
  const base = raw.split(/[/\\]/).pop() || '';
  const cleaned = base
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      // Drop C0 controls and DEL; they have no business in a header value.
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/["\\]/g, '')
    .trim();

  return cleaned.slice(0, 180) || 'image';
}

/**
 * Parses a base64 data URL into bytes.
 *
 * The declared mime type is returned for logging only; what the file actually *is*
 * gets decided by sharp reading its header.
 */
export function parseDataUrl(dataUrl: unknown) {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
    throw new ImageRejected(400, 'image_required', 'No image was provided.');
  }

  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new ImageRejected(400, 'invalid_image', 'The image must be sent as a base64 data URL.');
  }

  // base64 inflates by 4/3, so reject on the encoded length before allocating.
  if (match[2]!.length > Math.ceil((maxUploadBytes * 4) / 3) + 64) {
    throw new ImageRejected(413, 'image_too_large', 'That image is larger than 25 MB.');
  }

  const contents = Buffer.from(match[2]!, 'base64');

  if (!contents.length) {
    throw new ImageRejected(400, 'invalid_image', 'The image was empty.');
  }

  if (contents.length > maxUploadBytes) {
    throw new ImageRejected(413, 'image_too_large', 'That image is larger than 25 MB.');
  }

  return { contents, declaredType: match[1]!.toLowerCase() };
}

/**
 * Validates, resizes and re-encodes one image, ready to store.
 *
 * The format check is done by decoding the header rather than trusting the mime type
 * the browser sent: a file named `x.png` that is really something else must not reach
 * the bucket, and `sharp` refusing to parse it is the check.
 */
export async function prepareImage(input: {
  contents: Buffer;
  fileName: string;
  isRadiograph: boolean;
}): Promise<PreparedImage> {
  let metadata: Metadata;

  try {
    metadata = await sharp(input.contents, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageRejected(400, 'unsupported_image', 'That file is not a readable image.');
  }

  if (!metadata.format || !acceptedFormats.has(metadata.format)) {
    throw new ImageRejected(
      400,
      'unsupported_image',
      'Please upload a PNG, JPG, WEBP, GIF or TIFF image.'
    );
  }

  // A "decompression bomb": small file, enormous pixel dimensions.
  const pixels = (metadata.width || 0) * (metadata.height || 0);
  if (pixels > 80_000_000) {
    throw new ImageRejected(413, 'image_too_large', 'That image has too many pixels to process.');
  }

  const maxDimension = input.isRadiograph ? radiographMaxDimension : photoMaxDimension;
  const pipeline = sharp(input.contents, { failOn: 'error' })
    // Honour the EXIF orientation flag before dropping metadata, or portrait phone
    // photos come out sideways.
    .rotate()
    .resize({
      fit: 'inside',
      height: maxDimension,
      width: maxDimension,
      withoutEnlargement: true,
    });

  const contents = await (input.isRadiograph
    // WebP near-lossless at quality 100 preserves every sample while still using
    // the near-lossless encoder path requested for diagnostic images.
    ? pipeline.webp({ effort: 4, nearLossless: true, quality: radiographWebpQuality })
    : pipeline.webp({ effort: 4, quality: photoWebpQuality })
  ).toBuffer();

  if (contents.length > maxUploadBytes) {
    throw new ImageRejected(
      413,
      'processed_image_too_large',
      'That image remains larger than 25 MB after safe processing.'
    );
  }

  const stored = await sharp(contents).metadata();

  return {
    checksum: createHash('sha256').update(contents).digest('hex'),
    contents,
    contentType: 'image/webp',
    height: stored.height ?? null,
    isRadiograph: input.isRadiograph,
    width: stored.width ?? null,
  };
}
