const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../server');
const utils = server.utils;

test('email validation', (t) => {
  assert.strictEqual(utils.isValidEmail('user@example.com'), true);
  assert.strictEqual(utils.isValidEmail('bad@'), false);
  assert.strictEqual(utils.isValidEmail(''), false);
});

test('password strength validation', (t) => {
  assert.strictEqual(utils.isStrongPassword('Abc12345'), true);
  assert.strictEqual(utils.isStrongPassword('short1'), false);
  assert.strictEqual(utils.isStrongPassword('NoNumbersHere'), false);
});

test('parseCookies decodes cookies', (t) => {
  const fakeReq = { headers: { cookie: 'a=1; b=hello%20world; c=%7B%22x%22%3A1%7D' } };
  const c = utils.parseCookies(fakeReq);
  assert.deepStrictEqual(c, { a: '1', b: 'hello world', c: '{"x":1}' });
});

test('hashPassword and verifyPassword roundtrip', async (t) => {
  const pw = 'StrongPass123';
  const stored = await utils.hashPassword(pw);
  assert.ok(typeof stored === 'string' && stored.includes(':'));

  const ok = utils.verifyPassword(pw, stored);
  assert.strictEqual(ok, true);

  const bad = utils.verifyPassword('WrongPass', stored);
  assert.strictEqual(bad, false);
});
