const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const server = require('../server');
const db = require('../db');
const utils = server.utils;

function makeReq(method, url, headers = {}, body = null) {
  const r = new Readable({ read() {} });
  r.method = method;
  r.url = url;
  r.headers = headers;
  if (body !== null) {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    // emulate async chunking
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

test('GET /api/health returns ok', async (t) => {
  const req = makeReq('GET', '/api/health', {});
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 200);
  const obj = JSON.parse(r._body);
  assert.strictEqual(obj.ok, true);
});

test('POST /api/echo echoes JSON body', async (t) => {
  const body = { a: 1, b: 'x' };
  const req = makeReq('POST', '/api/echo', { 'content-type': 'application/json' }, body);
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 200);
  const obj = JSON.parse(r._body);
  assert.deepStrictEqual(obj.received, body);
});

test('GET /api/captcha returns data and sessionId', async (t) => {
  const req = makeReq('GET', '/api/captcha', {});
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 200);
  const obj = JSON.parse(r._body);
  assert.ok(typeof obj.sessionId === 'string' && obj.sessionId.length > 0);
  assert.ok(typeof obj.data === 'string' && obj.data.startsWith('data:image/svg+xml;base64,'));
});

test('auth login creates session and getUserFromRequest returns user', async (t) => {
  // prepare a password hash for the stubbed DB
  const pw = 'TestPass123';
  const stored = await utils.hashPassword(pw);

  // stub db.query to respond to different SQL
  const origQuery = db.query;
  db.query = async (sql, params) => {
    if (/SELECT id, password_hash FROM users/i.test(sql)) {
      return [{ id: 42, password_hash: stored }];
    }
    if (/SELECT id, email, names FROM users/i.test(sql)) {
      return [{ id: 42, email: 'u@e.com', names: 'User Test' }];
    }
    return [];
  };

  try {
    const loginReq = makeReq('POST', '/api/login', { 'content-type': 'application/json' }, { email: 'u@e.com', password: pw });
    const loginRes = makeRes();
    server.emit('request', loginReq, loginRes);
    const lr = await loginRes.finished;
    assert.strictEqual(lr._status, 200);
    // parse Set-Cookie header
    const setCookie = lr._headers['Set-Cookie'] || lr._headers['set-cookie'];
    assert.ok(setCookie && /auth=/.test(setCookie));
    const tokenMatch = String(setCookie).match(/auth=([^;]+);/);
    assert.ok(tokenMatch && tokenMatch[1]);
    const token = tokenMatch[1];

    // now call getAuthSession and getUserFromRequest
    const sess = utils.getAuthSession(token);
    assert.ok(sess && sess.userId === 42);

    const userReq = makeReq('GET', '/api/user', { cookie: `auth=${token}` });
    // override db.query will return user row for getUserFromRequest
    const user = await utils.getUserFromRequest(userReq);
    assert.strictEqual(user.email, 'u@e.com');
  } finally {
    db.query = origQuery;
  }
});

test('getAuthTokenFromReq parses cookie', (t) => {
  const req = { headers: { cookie: 'a=1; auth=tok; b=2' } };
  const tok = utils.getAuthTokenFromReq(req);
  assert.strictEqual(tok, 'tok');
});

test('POST /api/register creates a new user', async (t) => {
  const captcha = require('../captcha');
  const { sessionId } = captcha.createCaptcha();
  const text = captcha.getCaptchaTextForTesting(sessionId);

  const origQuery = db.query;
  let sawInsert = false;
  db.query = async (sql, params) => {
    if (/INSERT INTO users/i.test(sql)) { sawInsert = true; return { insertId: 7 }; }
    return [];
  };

  try {
    const body = { email: 'new@ex.com', names: 'New', password: 'Abc12345', captcha: text, sessionId };
    const req = makeReq('POST', '/api/register', { 'content-type': 'application/json' }, body);
    const res = makeRes();
    server.emit('request', req, res);
    const r = await res.finished;
    assert.strictEqual(r._status, 200);
    const obj = JSON.parse(r._body);
    assert.strictEqual(obj.ok, true);
    assert.ok(sawInsert);
  } finally {
    db.query = origQuery;
  }
});

test('POST /api/logout clears cookie', async (t) => {
  const req = makeReq('POST', '/api/logout', { cookie: 'auth=tok' });
  const res = makeRes();
  server.emit('request', req, res);
  const r = await res.finished;
  assert.strictEqual(r._status, 200);
  const setCookie = r._headers['Set-Cookie'] || r._headers['set-cookie'];
  assert.ok(/Max-Age=0/.test(String(setCookie)));
});

test('PUT /api/user updates names and password', async (t) => {
  // create login session like previous test to get token
  const pw = 'UpdatePass123';
  const stored = await utils.hashPassword(pw);
  const origQuery = db.query;
  db.query = async (sql, params) => {
    if (/SELECT id, password_hash FROM users/i.test(sql)) return [{ id: 99, password_hash: stored }];
    if (/SELECT id, email, names FROM users/i.test(sql)) return [{ id: 99, email: 'x@y.com', names: 'X' }];
    if (/UPDATE users/i.test(sql)) return { affectedRows: 1 };
    return [];
  };

  try {
    const loginReq = makeReq('POST', '/api/login', { 'content-type': 'application/json' }, { email: 'x@y.com', password: pw });
    const loginRes = makeRes();
    server.emit('request', loginReq, loginRes);
    const lr = await loginRes.finished;
    const setCookie = lr._headers['Set-Cookie'] || lr._headers['set-cookie'];
    const token = String(setCookie).match(/auth=([^;]+);/)[1];

    const putReq = makeReq('PUT', '/api/user', { 'content-type': 'application/json', cookie: `auth=${token}` }, { names: 'New Name', password: 'NewStrong123' });
    const putRes = makeRes();
    server.emit('request', putReq, putRes);
    const pr = await putRes.finished;
    assert.strictEqual(pr._status, 200);
    const pobj = JSON.parse(pr._body);
    assert.strictEqual(pobj.ok, true);
  } finally {
    db.query = origQuery;
  }
});
