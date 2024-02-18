import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Every outbound email in the platform goes through this module, driven purely by
 * the SMTP_* values in backend.env. Callers never throw on a delivery failure:
 * they get a `MailResult` back so the UI can report "sent" or "failed" honestly
 * instead of assuming success.
 */
export type MailResult = {
  ok: boolean;
  error?: string;
  messageId?: string;
  skipped?: boolean;
};

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SmtpSettings = {
  from: string;
  host: string;
  pass: string;
  port: number;
  secure: boolean;
  user: string;
};

let cachedTransporter: Transporter | null = null;
let cachedSettingsKey = '';

function readSmtpValue(name: string) {
  const raw = process.env[name];

  if (typeof raw !== 'string') {
    return '';
  }

  // backend.env quotes some values (SMTP_FROM, SMTP_PASS); dotenv strips matched
  // quotes, but be tolerant of hand-edited files that mix styles.
  return raw.trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
}

export function getSmtpSettings(): SmtpSettings {
  const port = Number.parseInt(readSmtpValue('SMTP_PORT'), 10);
  const secureValue = readSmtpValue('SMTP_SECURE').toLowerCase();
  const user = readSmtpValue('SMTP_USER');

  return {
    from: readSmtpValue('SMTP_FROM') || user,
    host: readSmtpValue('SMTP_HOST'),
    pass: readSmtpValue('SMTP_PASS'),
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: secureValue === 'true' || secureValue === '1' || secureValue === 'yes',
    user,
  };
}

export function getSmtpConfigIssue(settings = getSmtpSettings()) {
  if (!settings.host) {
    return 'SMTP_HOST is not set in backend.env.';
  }

  if (!settings.user) {
    return 'SMTP_USER is not set in backend.env.';
  }

  if (!settings.pass) {
    return 'SMTP_PASS is not set in backend.env.';
  }

  if (!settings.from) {
    return 'SMTP_FROM is not set in backend.env.';
  }

  return null;
}

export function isMailConfigured() {
  return getSmtpConfigIssue() === null;
}

function getTransporter(settings: SmtpSettings) {
  // Rebuild the transport only when the SMTP settings actually change, so a
  // long-running process reuses the pooled connection.
  const settingsKey = [settings.host, settings.port, settings.secure, settings.user, settings.pass].join('|');

  if (cachedTransporter && cachedSettingsKey === settingsKey) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // Port 587 starts plaintext and upgrades via STARTTLS, which is what
    // `SMTP_SECURE=false` means here — not "unencrypted".
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
    pool: true,
    maxConnections: 3,
  });
  cachedSettingsKey = settingsKey;

  return cachedTransporter;
}

function describeMailError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'The mail server rejected the message.';
  }

  const code = (error as { code?: unknown }).code;
  const responseCode = (error as { responseCode?: unknown }).responseCode;

  if (code === 'EAUTH' || responseCode === 535) {
    return 'SMTP rejected the credentials in backend.env (SMTP_USER / SMTP_PASS). For Gmail this must be a 16-character app password.';
  }

  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETIMEDOUT' || code === 'EDNS') {
    return `Could not reach the mail server (${readSmtpValue('SMTP_HOST') || 'SMTP_HOST'}:${readSmtpValue('SMTP_PORT') || '587'}). ${error.message}`;
  }

  return error.message || 'The mail server rejected the message.';
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const settings = getSmtpSettings();
  const configIssue = getSmtpConfigIssue(settings);

  if (configIssue) {
    return { ok: false, error: configIssue };
  }

  const recipient = message.to.trim();

  if (!recipient) {
    return { ok: false, error: 'No recipient email address was provided.' };
  }

  try {
    const info = await getTransporter(settings).sendMail({
      from: settings.from,
      to: recipient,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    // Gmail accepts the whole envelope or none of it, but other relays can
    // partially reject; treat any rejection as a failure the caller must show.
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      return {
        ok: false,
        error: `The mail server rejected ${info.rejected.join(', ')}.`,
      };
    }

    return { ok: true, messageId: info.messageId };
  } catch (error) {
    return { ok: false, error: describeMailError(error) };
  }
}

/** Used by /health so misconfigured SMTP is visible before anyone sends an invite. */
export async function verifySmtpConnection(): Promise<MailResult> {
  const settings = getSmtpSettings();
  const configIssue = getSmtpConfigIssue(settings);

  if (configIssue) {
    return { ok: false, error: configIssue };
  }

  try {
    await getTransporter(settings).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeMailError(error) };
  }
}
