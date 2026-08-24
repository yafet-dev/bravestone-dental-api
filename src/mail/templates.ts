const brandName = 'Bravestone';

/**
 * Email links must land on the browser app, not on the API. `APP_PUBLIC_URL` is
 * the explicit setting; `CORS_ORIGIN` is already the front-end origin in every
 * environment, so it is the natural fallback.
 */
export function getAppPublicUrl(path = '/') {
  const candidates = [process.env.APP_PUBLIC_URL, process.env.CORS_ORIGIN, process.env.APP_URL];
  const baseUrl = candidates
    .map((candidate) => (typeof candidate === 'string' ? candidate.split(',')[0]?.trim() : ''))
    .find((candidate) => Boolean(candidate)) || 'http://localhost:3000';

  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type EmailLayoutInput = {
  actionLabel?: string;
  actionUrl?: string;
  code?: string;
  footerNote: string;
  greeting: string;
  intro: string;
  preheader: string;
  title: string;
};

/**
 * A light, transactional shell: neutral page, white card, violet accents drawn
 * from the workspace theme. The action and link violets are deeper than the
 * dashboard's `violet-500` so white button text and body links clear WCAG AA
 * against white, which `#8b5cf6` does not.
 *
 * Every value is a literal hex rather than an `rgba()` tint because Outlook
 * drops alpha channels, and all of it is applied as inline styles because many
 * clients strip `<style>` blocks.
 */
const palette = {
  accent: '#6d28d9',
  accentRule: '#7c3aed',
  body: '#4a4a57',
  border: '#e5e5ee',
  divider: '#ececf3',
  heading: '#17171f',
  linkPanel: '#f7f7fb',
  muted: '#71717f',
  page: '#f4f4f7',
  surface: '#ffffff',
};

const fontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function renderLayout(input: EmailLayoutInput) {
  const safeActionUrl = escapeHtml(input.actionUrl || '');
  const action = input.actionLabel && input.actionUrl
    ? `<tr>
              <td style="padding:28px 40px 0 40px;">
                <!-- Table-wrapped so the background and padding survive Outlook,
                     which ignores padding on a styled anchor. -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${palette.accent}" style="border-radius:8px;">
                      <a href="${safeActionUrl}" style="display:inline-block;padding:14px 30px;font-family:${fontStack};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(input.actionLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${palette.linkPanel};border:1px solid ${palette.border};border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0;font-size:12px;line-height:1.5;color:${palette.muted};">If the button does not work, copy this link into your browser:</p>
                      <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${safeActionUrl}" style="color:${palette.accent};text-decoration:underline;">${safeActionUrl}</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : '';
  const code = input.code
    ? `<tr>
              <td style="padding:28px 40px 0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${palette.linkPanel};border:2px solid ${palette.accentRule};border-radius:12px;">
                  <tr>
                    <td align="center" style="padding:24px 16px;">
                      <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${palette.muted};">Your signup code</p>
                      <p style="margin:0;font-family:${fontStack};font-size:42px;font-weight:700;line-height:1.1;letter-spacing:0.28em;color:${palette.heading};">${escapeHtml(input.code)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:${palette.page};font-family:${fontStack};color:${palette.body};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${palette.page};">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${palette.page};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${palette.surface};border:1px solid ${palette.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="height:4px;background-color:${palette.accentRule};font-size:0;line-height:4px;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:36px 40px 0 40px;">
                <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${palette.accent};">${escapeHtml(brandName)}</p>
                <h1 style="margin:14px 0 0 0;font-size:23px;line-height:1.35;font-weight:600;letter-spacing:-0.01em;color:${palette.heading};mso-line-height-rule:exactly;">${escapeHtml(input.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 40px 0 40px;">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${palette.body};mso-line-height-rule:exactly;">${escapeHtml(input.greeting)}</p>
                <p style="margin:0;font-size:15px;line-height:1.65;color:${palette.body};mso-line-height-rule:exactly;">${escapeHtml(input.intro)}</p>
              </td>
            </tr>
            ${code}
            ${action}
            <tr>
              <td style="padding:26px 40px 32px 40px;">
                <p style="margin:0;padding-top:20px;border-top:1px solid ${palette.divider};font-size:12px;line-height:1.65;color:${palette.muted};">${escapeHtml(input.footerNote)}</p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td align="center" style="padding:20px 16px 0 16px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${palette.muted};">${escapeHtml(brandName)} &middot; Sent to you because someone at your clinic uses ${escapeHtml(brandName)}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderPlainText(input: EmailLayoutInput) {
  return [
    input.title,
    '',
    input.greeting,
    '',
    input.intro,
    '',
    ...(input.code ? [`Your signup code: ${input.code}`, ''] : []),
    ...(input.actionLabel && input.actionUrl ? [`${input.actionLabel}: ${input.actionUrl}`, ''] : []),
    input.footerNote,
    '',
    brandName,
  ].join('\n');
}

export function buildSignupOtpEmail(input: { code: string; email: string; fullName?: string | null }) {
  const layout: EmailLayoutInput = {
    code: input.code,
    footerNote: `This code expires in 10 minutes and works once. ${brandName} will never ask you to share it. If you did not create an account, ignore this email.`,
    greeting: `Hi ${firstNameFrom(input.fullName, input.email)},`,
    intro: `Enter this four-digit code on the signup screen to finish creating your ${brandName} account.`,
    preheader: `${input.code} is your ${brandName} signup code.`,
    title: 'Finish creating your account',
  };

  return {
    subject: `${input.code} is your ${brandName} signup code`,
    html: renderLayout(layout),
    text: renderPlainText(layout),
  };
}

function firstNameFrom(fullName: string | null | undefined, email: string) {
  const trimmed = fullName?.trim();

  if (trimmed) {
    return trimmed.split(/\s+/)[0] || trimmed;
  }

  return email.split('@')[0] || 'there';
}

function describeExpiry(expiresAt: Date) {
  const hours = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)));

  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function buildVerificationEmail(input: { email: string; expiresAt: Date; fullName?: string | null; token: string }) {
  const layout: EmailLayoutInput = {
    actionLabel: 'Verify my email',
    actionUrl: getAppPublicUrl(`/verify-email?token=${encodeURIComponent(input.token)}`),
    footerNote: `This link expires in ${describeExpiry(input.expiresAt)}. If you did not create a ${brandName} account, you can ignore this email.`,
    greeting: `Hi ${firstNameFrom(input.fullName, input.email)},`,
    intro: `Confirm this email address to activate your ${brandName} account and open your clinic workspace.`,
    preheader: `Confirm your email to activate your ${brandName} account.`,
    title: 'Verify your email address',
  };

  return {
    subject: `Verify your ${brandName} email address`,
    html: renderLayout(layout),
    text: renderPlainText(layout),
  };
}

export function buildPasswordResetEmail(input: { email: string; expiresAt: Date; fullName?: string | null; token: string }) {
  const layout: EmailLayoutInput = {
    actionLabel: 'Choose a new password',
    actionUrl: getAppPublicUrl(`/reset-password?token=${encodeURIComponent(input.token)}`),
    footerNote: `This link expires in ${describeExpiry(input.expiresAt)} and can be used once. If you did not request a password reset, no action is needed and your current password still works.`,
    greeting: `Hi ${firstNameFrom(input.fullName, input.email)},`,
    intro: 'Use the link below to set a new password for your account.',
    preheader: 'Reset your password with this single-use link.',
    title: 'Reset your password',
  };

  return {
    subject: `Reset your ${brandName} password`,
    html: renderLayout(layout),
    text: renderPlainText(layout),
  };
}

export function buildInvitationEmail(input: {
  branchName?: string | null;
  email: string;
  expiresAt: Date;
  fullName?: string | null;
  invitedByName?: string | null;
  organizationName: string;
  role: string;
  token: string;
}) {
  const inviter = input.invitedByName?.trim();
  const place = input.branchName?.trim()
    ? `${input.organizationName} (${input.branchName.trim()})`
    : input.organizationName;
  const readableRole = input.role.replace(/_/g, ' ');
  const layout: EmailLayoutInput = {
    actionLabel: 'Accept invitation',
    actionUrl: getAppPublicUrl(`/accept-invite?token=${encodeURIComponent(input.token)}`),
    footerNote: `This invitation expires in ${describeExpiry(input.expiresAt)}. If you were not expecting it, you can ignore this email.`,
    greeting: `Hi ${firstNameFrom(input.fullName, input.email)},`,
    intro: `${inviter ? `${inviter} invited you` : 'You have been invited'} to join ${place} on ${brandName} as ${readableRole}. Accept the invitation to set your password and open the workspace.`,
    preheader: `You have been invited to join ${place} on ${brandName}.`,
    title: `You are invited to ${input.organizationName}`,
  };

  return {
    subject: `${inviter ? `${inviter} invited you` : 'You are invited'} to join ${input.organizationName} on ${brandName}`,
    html: renderLayout(layout),
    text: renderPlainText(layout),
  };
}
