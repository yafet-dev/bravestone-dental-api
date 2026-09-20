import assert from 'node:assert/strict';
import test from 'node:test';
import { contactMail, parseContact, saveContact } from '../src/contact/service';

const valid = { name: 'Clinic owner', email: 'owner@example.com', message: 'Please tell me about clinic setup.' };
test('phone-only enquiries are accepted without an email address', () => {
  const phoneOnly = { name: valid.name, phone: '+251 912 345 678', message: valid.message };
  assert.deepEqual(parseContact({ ...phoneOnly, phone: ' +251 912 345 678 ' }), phoneOnly);
  const mail = contactMail(phoneOnly, 'recipient@example.com');
  assert.match(mail.text, /Phone: \+251 912 345 678/);
  assert.equal(mail.replyTo, undefined);
  assert.doesNotMatch(mail.text, /undefined|Email:/);
});
test('contact requires at least one valid phone or email and rejects malformed phones', () => {
  const base = { name: valid.name, message: valid.message };
  for (const phone of ['', '123', '1'.repeat(16), '+251\r\n912345678', 'call me', ['0912345678'], '+251@912345678']) {
    assert.equal(parseContact({ ...base, phone }), null);
  }
  assert.equal(parseContact(base), null);
  for (const phone of ['0912345678', '+1 (212) 555-1234', '0912-345-678']) {
    assert.equal(parseContact({ ...base, phone })?.phone, phone);
  }
  assert.deepEqual(parseContact({ ...valid, phone: '0912345678' }), { ...valid, phone: '0912345678' });
});
test('contact is persisted before delivery and records delivery success', async () => {
  const events: string[] = [];
  const result = await saveContact(valid, {
    save: async () => { events.push('save'); },
    send: async () => { events.push('send'); return { ok: true }; },
    mark: async (_id, sent) => { events.push(`mark:${sent}`); },
  });
  assert.deepEqual(events, ['save', 'send', 'mark:true']);
  assert.deepEqual(result, { saved: true, emailSent: true });
});
test('failed email still returns a saved message and records failure', async () => {
  let marked = false;
  const result = await saveContact(valid, {
    save: async () => {}, send: async () => ({ ok: false }),
    mark: async (_id, sent) => { assert.equal(sent, false); marked = true; },
  });
  assert.equal(marked, true);
  assert.deepEqual(result, { saved: true, emailSent: false });
});
test('database failure does not send email or report success', async () => {
  let sent = false;
  await assert.rejects(saveContact(valid, {
    save: async () => { throw new Error('unavailable'); },
    send: async () => { sent = true; return { ok: true }; }, mark: async () => {},
  }), /unavailable/);
  assert.equal(sent, false);
});
test('contact validation trims input and excludes untrusted extra fields', () => {
  assert.deepEqual(parseContact({ ...valid, name: ' Clinic owner ', to: 'other@example.com' }), valid);
});
test('contact validation rejects malformed and oversized submissions', () => {
  for (const body of [null, [], {}, { ...valid, email: 'invalid' }, { ...valid, name: 'x' }, { ...valid, name: 'A\r\nBcc: someone' }, { ...valid, message: 'short' }, { ...valid, message: 'a'.repeat(5001) }, { ...valid, email: ['owner@example.com'] }]) {
    assert.equal(parseContact(body), null);
  }
});
test('contact emails escape visitor HTML and use visitor email only for replies', () => {
  const mail = contactMail({ ...valid, message: '<b>Hello & goodbye</b>' }, 'recipient@example.com');
  assert.equal(mail.to, 'recipient@example.com');
  assert.equal(mail.replyTo, valid.email);
  assert.match(mail.html, /&lt;b&gt;Hello &amp; goodbye&lt;\/b&gt;/);
  assert.doesNotMatch(mail.html, /<b>/);
  assert.match(mail.text, /<b>Hello & goodbye<\/b>/);
});
