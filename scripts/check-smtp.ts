/**
 * Diagnostic for the SMTP_* values in backend.env.
 *
 *   npm run check:smtp              # connect + authenticate only, sends nothing
 *   npm run check:smtp -- <address> # also send one test message to <address>
 */
import '../src/env';
import { getSmtpConfigIssue, getSmtpSettings, sendMail, verifySmtpConnection } from '../src/mail/mailer';

function maskedPassword(password: string) {
  return password ? `set (${password.replace(/\s/g, '').length} chars)` : 'missing';
}

async function main() {
  const settings = getSmtpSettings();
  const configIssue = getSmtpConfigIssue(settings);

  console.log('SMTP settings from backend.env');
  console.log(`  host      ${settings.host || '(missing)'}`);
  console.log(`  port      ${settings.port}`);
  console.log(`  secure    ${settings.secure} ${settings.secure ? '(implicit TLS)' : '(STARTTLS)'}`);
  console.log(`  user      ${settings.user || '(missing)'}`);
  console.log(`  from      ${settings.from || '(missing)'}`);
  console.log(`  password  ${maskedPassword(settings.pass)}`);

  if (configIssue) {
    console.error(`\nConfiguration problem: ${configIssue}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nVerifying connection and credentials...');
  const verification = await verifySmtpConnection();

  if (!verification.ok) {
    console.error(`FAILED: ${verification.error}`);
    process.exitCode = 1;
    return;
  }

  console.log('OK: the mail server accepted the credentials.');

  const recipient = process.argv[2]?.trim();

  if (!recipient) {
    console.log('\nNo recipient argument given, so no test email was sent.');
    return;
  }

  console.log(`\nSending a test message to ${recipient}...`);
  const result = await sendMail({
    to: recipient,
    subject: 'Bravestone SMTP test',
    html: '<p>Your Bravestone backend can send email. Verification, password reset, and invitation messages will use this relay.</p>',
    text: 'Your Bravestone backend can send email. Verification, password reset, and invitation messages will use this relay.',
  });

  if (!result.ok) {
    console.error(`FAILED: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`OK: delivered (message id ${result.messageId}).`);
}

void main().then(() => process.exit(process.exitCode ?? 0));
