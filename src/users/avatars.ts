import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AuthError } from '../auth/accounts';
import { prisma } from '../db';

/**
 * Profile pictures used to live in a Supabase Storage bucket whose RLS policies
 * keyed off `auth.uid()`. Now that sessions are issued by this API there is no
 * Supabase JWT to satisfy those policies, so avatars are stored on the API host
 * and served from /uploads.
 */
export const avatarsRoot = resolve(process.cwd(), 'uploads', 'avatars');

const maxAvatarBytes = 5 * 1024 * 1024;
const extensionByMimeType: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function parseImageDataUrl(dataUrl: unknown) {
  if (typeof dataUrl !== 'string') {
    throw new AuthError(400, 'invalid_image', 'No image data was provided.');
  }

  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new AuthError(400, 'invalid_image', 'The profile picture must be sent as a base64 data URL.');
  }

  const mimeType = match[1]!.toLowerCase();
  const extension = extensionByMimeType[mimeType];

  if (!extension) {
    throw new AuthError(400, 'unsupported_image', 'Please choose a PNG, JPG, WEBP, or GIF image.');
  }

  const contents = Buffer.from(match[2]!, 'base64');

  if (!contents.length) {
    throw new AuthError(400, 'invalid_image', 'The uploaded image was empty.');
  }

  if (contents.length > maxAvatarBytes) {
    throw new AuthError(413, 'image_too_large', 'That image is larger than 5 MB. Please choose a smaller file.');
  }

  return { contents, extension };
}

function buildPublicUrl(relativePath: string) {
  const baseUrl = process.env.API_PUBLIC_URL?.trim() || process.env.APP_URL?.trim() || '';

  if (!baseUrl) {
    return `/uploads/avatars/${relativePath}`;
  }

  return new URL(`/uploads/avatars/${relativePath}`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

export async function saveUserAvatar(input: { dataUrl: unknown; userId: string }) {
  const { contents, extension } = parseImageDataUrl(input.dataUrl);
  const user = await prisma.user.findUnique({ where: { id: input.userId } });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  // One folder per user, holding exactly one current picture.
  const folder = join(avatarsRoot, user.id);
  await mkdir(folder, { recursive: true });

  const previousFiles = await readdir(folder).catch(() => [] as string[]);
  const fileName = `profile-${Date.now()}-${randomBytes(4).toString('hex')}.${extension}`;
  await writeFile(join(folder, fileName), contents);
  await Promise.all(previousFiles.map((previous) => rm(join(folder, previous), { force: true })));

  const avatarUrl = buildPublicUrl(`${user.id}/${fileName}`);
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  return { avatarUrl: updatedUser.avatarUrl || avatarUrl };
}
