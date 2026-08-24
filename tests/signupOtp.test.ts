import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignupOtp,
  hashSignupOtp,
  isFourDigitSignupOtp,
} from '../src/auth/credentials';
import { buildSignupOtpEmail } from '../src/mail/templates';

process.env.AUTH_JWT_SECRET = 'signup-otp-test-secret-that-is-long-and-stable';

test('signup OTPs are always exactly four numeric digits', () => {
  for (let index = 0; index < 100; index += 1) {
    const otp = createSignupOtp();

    assert.match(otp.code, /^\d{4}$/);
    assert.ok(otp.challengeId.length >= 32);
    assert.equal(otp.codeHash, hashSignupOtp(otp.challengeId, otp.code));
    assert.notEqual(otp.codeHash, otp.code);
  }
});

test('the keyed digest is bound to both the code and challenge id', () => {
  const firstChallenge = 'first-challenge';
  const secondChallenge = 'second-challenge';

  assert.notEqual(hashSignupOtp(firstChallenge, '1234'), hashSignupOtp(firstChallenge, '1235'));
  assert.notEqual(hashSignupOtp(firstChallenge, '1234'), hashSignupOtp(secondChallenge, '1234'));
});

test('signup verification accepts only four digits', () => {
  assert.equal(isFourDigitSignupOtp('1234'), true);
  assert.equal(isFourDigitSignupOtp(' 1234 '), true);
  assert.equal(isFourDigitSignupOtp('123'), false);
  assert.equal(isFourDigitSignupOtp('12345'), false);
  assert.equal(isFourDigitSignupOtp('12a4'), false);
  assert.equal(isFourDigitSignupOtp(1234), false);
});

test('the signup email makes the code prominent without asking for a link click', () => {
  const email = buildSignupOtpEmail({
    code: '0427',
    email: 'owner@example.com',
    fullName: 'Hanna Tesfaye',
  });

  assert.match(email.subject, /0427/);
  assert.match(email.text, /Your signup code: 0427/);
  assert.match(email.text, /10 minutes/);
  assert.doesNotMatch(email.html, /href=/);
});
