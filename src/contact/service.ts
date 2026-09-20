import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { sendMail } from '../mail/mailer';

export type ContactInput = { name: string; email?: string; phone?: string; message: string };

export function parseContact(body: unknown): ContactInput | null {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  if (![input.name, input.message].every(value => typeof value === 'string')) return null;
  if (input.email !== undefined && typeof input.email !== 'string') return null;
  if (input.phone !== undefined && typeof input.phone !== 'string') return null;
  const name = (input.name as string).trim();
  const email = (input.email as string | undefined)?.trim() || '';
  const phone = (input.phone as string | undefined)?.trim() || '';
  const message = (input.message as string).trim();
  if (name.length < 2 || name.length > 100 || /[\r\n\x00]/.test(name)) return null;
  if (!email && !phone) return null;
  if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) return null;
  const phoneDigits = phone.replace(/\D/g, '');
  if (phone && (phone.length > 30 || !/^\+?[0-9 ()-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15)) return null;
  if (message.length < 10 || message.length > 5000 || message.includes('\x00')) return null;
  return { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}), message };
}

export function contactMail(input: ContactInput, recipient: string) {
  const text = [`Name: ${input.name}`, ...(input.phone ? [`Phone: ${input.phone}`] : []), ...(input.email ? [`Email: ${input.email}`] : []), '', input.message].join('\n');
  const escaped = text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  return { to: recipient, ...(input.email ? { replyTo: input.email } : {}), subject: 'New Bravestone contact enquiry', text, html: `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escaped}</pre>` };
}

const contactDependencies = {
  async save(id: string, input: ContactInput) {
    await prisma.$executeRaw`
    INSERT INTO public.contact_messages (id, name, email, phone, message)
    VALUES (${id}::uuid, ${input.name}, ${input.email || null}, ${input.phone || null}, ${input.message})
    `;
  },
  send: sendMail,
  async mark(id: string, sent: boolean) {
    await prisma.$executeRaw`
      UPDATE public.contact_messages
      SET email_status = ${sent ? 'sent' : 'failed'}, emailed_at = ${sent ? new Date() : null}
      WHERE id = ${id}::uuid
    `;
  },
};

export async function saveContact(input: ContactInput, dependencies = contactDependencies) {
  const id = randomUUID();
  await dependencies.save(id, input);
  // The saved row remains available even when SMTP is unavailable.
  const result = await dependencies.send(contactMail(input, process.env.CONTACT_TO_EMAIL?.trim() || 'yafetdev@gmail.com'));
  try {
    await dependencies.mark(id, result.ok);
  } catch {
    console.error('Contact email status could not be updated:', id);
  }
  if (!result.ok) console.error('Contact notification failed; message remains saved:', id);
  return { saved: true, emailSent: result.ok };
}
