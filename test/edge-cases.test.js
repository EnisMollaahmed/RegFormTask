const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const server = require('../server');
const db = require('../db');
const captcha = require('../captcha');

function makeReq(method, url, headers = {}, body = null) {
  const r = new Readable({ read() {} });
  r.method = method;
  r.url = url;
  r.headers = headers;
  if (body !== null) {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    process.nextTick(() => { r.push(s); r.push(null); });
  } else {
    process.nextTick(() => r.push(null));
  }
  return r;
}

function makeRes() {
  let resolve;
  const p = new Promise(r => { resolve = r; });
  const res = {
    _headers: {},
    _status: 200,
    _body: '',
    writeHead(status, headers) { this._status = status; Object.assign(this._headers, headers || {}); },
    write(chunk) { this._body += String(chunk); },
    end(chunk) { if (chunk) this._body += String(chunk); resolve(this); }
  };
  res.finished = p;
  return res;
}

// helper to stub db.query; prefer test.mock.method when available
function stubQuery(fn) {
  if (test.mock && typeof test.mock === 'object' && typeof test.mock.method === 'function') {
    return test.mock.method(db, 'query', fn);
  }
  const orig = db.query;
  db.query = fn;
  return () => { db.query = orig; };
}

test('POST /api/register - invalid email returns 400', async () => {
  const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, { email: 'bad', names: 'X', password: 'Abc12345' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
  const obj = JSON.parse(r._body);
  assert.strictEqual(obj.error, 'Invalid email');
});

test('POST /api/register - missing names returns 400', async () => {
  const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, { email: 'ok@e.com', names: '', password: 'Abc12345' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
  const obj = JSON.parse(r._body);
  assert.strictEqual(obj.error, 'Names must not be empty');
});

test('POST /api/register - weak password returns 400', async () => {
  const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, { email: 'x@y.com', names: 'X', password: 'short' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
  const obj = JSON.parse(r._body);
  assert.ok(/Password too weak/.test(obj.error));
});

test('POST /api/register - missing captcha session returns 400', async () => {
  const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, { email: 'ok@e.com', names: 'X', password: 'Abc12345', captcha: 'whatever' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
  const obj = JSON.parse(r._body);
  assert.strictEqual(obj.error, 'Missing captcha session');
});

test('POST /api/register - wrong captcha returns 400', async () => {
  const { sessionId } = captcha.createCaptcha();
  const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, { email: 'ok2@e.com', names: 'X', password: 'Abc12345', captcha: 'WRONG', sessionId });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
  const obj = JSON.parse(r._body);
  assert.strictEqual(obj.error, 'Invalid or expired captcha');
});

test('POST /api/register - duplicate email returns 409', async () => {
  const { sessionId } = captcha.createCaptcha();
  const text = captcha.getCaptchaTextForTesting(sessionId);
  const restore = stubQuery(async (sql, params) => {
    if (/INSERT INTO users/i.test(sql)) {
      const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e;
    }
    return [];
  });
  try {
    const body = { email: 'dup@e.com', names: 'Dup', password: 'Abc12345', captcha: text, sessionId };
    const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, body);
    const res = makeRes();
    server.emit('request', req, res);
    const r = await res.finished;
    assert.strictEqual(r._status, 409);
    const obj = JSON.parse(r._body);
    assert.strictEqual(obj.error, 'Email already registered');
  } finally { restore(); }
});

test('POST /api/register - DB error returns 500', async () => {
  const { sessionId } = captcha.createCaptcha();
  const text = captcha.getCaptchaTextForTesting(sessionId);
  const restore = stubQuery(async (sql, params) => {
    if (/INSERT INTO users/i.test(sql)) throw new Error('boom');
    return [];
  });
  try {
    const body = { email: 'err@e.com', names: 'Err', password: 'Abc12345', captcha: text, sessionId };
    const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, body);
    const res = makeRes();
    server.emit('request', req, res);
    const r = await res.finished;
    assert.strictEqual(r._status, 500);
  } finally { restore(); }
});

test('POST /api/login - invalid request returns 400', async () => {
  const req = makeReq('POST', '/api/login', { 'content-type': 'application/json' }, { email: 'bad', password: '' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 400);
});

test('POST /api/login - wrong password returns 401', async () => {
  const pw = 'RightPass123';
  const stored = await server.utils.hashPassword(pw);
  const restore = stubQuery(async (sql, params) => {
    if (/SELECT id, password_hash FROM users/i.test(sql)) return [{ id: 5, password_hash: stored }];
    return [];
  });
  try {
    const req = makeReq('POST', '/api/login', { 'content-type': 'application/json' }, { email: 'u@e.com', password: 'Wrong' });
    const res = makeRes();
    server.emit('request', req, res);
    const r = await res.finished;
    assert.strictEqual(r._status, 401);
  } finally { restore(); }
});

test('GET /api/user without auth returns 401', async () => {
  const req = makeReq('GET', '/api/user', {});
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 401);
});

test('PUT /api/user without auth returns 401', async () => {
  const req = makeReq('PUT', '/api/user', { 'content-type': 'application/json' }, { names: 'X' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 401);
});
