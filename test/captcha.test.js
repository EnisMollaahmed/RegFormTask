const test = require('node:test');
const assert = require('node:assert/strict');
const captcha = require('../captcha');

test('createCaptcha returns data URI and sessionId; verifyCaptcha works', (t) => {
  const { sessionId, data } = captcha.createCaptcha();
  assert.ok(sessionId && typeof sessionId === 'string');
  assert.ok(data && data.startsWith('data:image/svg+xml;base64,'));

  // get the stored text for test verification
  const text = captcha.getCaptchaTextForTesting(sessionId);
  assert.ok(typeof text === 'string' && text.length === 6);

  // correct verification
  const ok = captcha.verifyCaptcha(sessionId, text);
  assert.strictEqual(ok, true);

  // subsequent verification should fail (one-time use)
  const ok2 = captcha.verifyCaptcha(sessionId, text);
  assert.strictEqual(ok2, false);
});

test('verifyCaptcha fails for wrong session or wrong text', (t) => {
  const { sessionId } = captcha.createCaptcha();
  // wrong text
  const bad = captcha.verifyCaptcha(sessionId, 'XXXXXX');
  assert.strictEqual(bad, false);

  // nonexistent session
  const no = captcha.verifyCaptcha('no-such-session', 'FOO');
  assert.strictEqual(no, false);
});
