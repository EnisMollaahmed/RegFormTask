const http = require('http');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

const { createCaptcha, verifyCaptcha, SESSION_COOKIE_NAME } = require('./captcha');
const db = require('./db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Simple router maps
const routes = {
  GET: new Map(),
  POST: new Map()
};

// Example API routes
routes.GET.set('/api/health', async (req, res) => {
  sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
});

routes.POST.set('/api/echo', async (req, res, body) => {
  sendJSON(res, 200, { received: body || null });
});

// Return a captcha image and session id
routes.GET.set('/api/captcha', async (req, res) => {
  try {
    const { sessionId, data } = createCaptcha();
    // return data URI and sessionId; client may set cookie
    sendJSON(res, 200, { data, sessionId });
  } catch (err) {
    sendJSON(res, 500, { error: 'Failed to generate captcha' });
  }
});

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').map(s => s.trim()).filter(Boolean).reduce((acc, kv) => {
    const idx = kv.indexOf('=');
    if (idx === -1) return acc;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx+1).trim();
    acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isStrongPassword(pw) {
  if (typeof pw !== 'string') return false;
  if (pw.length < 8) return false;
  // must include letter and number
  if (!/[A-Za-z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

// Registration endpoint: validate, verify captcha, hash password, insert user
routes.POST.set('/api/register', async (req, res, body) => {
  try {
    if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: 'Invalid request body' });
    const email = (body.email || '').trim().toLowerCase();
    const names = (body.names || '').trim();
    const password = body.password || '';
    const captchaInput = (body.captcha || '').trim();

    if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
    if (!names) return sendJSON(res, 400, { error: 'Names must not be empty' });
    if (!isStrongPassword(password)) return sendJSON(res, 400, { error: 'Password too weak (min 8 chars, include letters and numbers)' });

    // get session id from cookie (or body.sessionId fallback)
    const cookies = parseCookies(req);
    const sid = cookies[SESSION_COOKIE_NAME] || body.sessionId || null;
    if (!sid) return sendJSON(res, 400, { error: 'Missing captcha session' });

    if (!verifyCaptcha(sid, captchaInput)) return sendJSON(res, 400, { error: 'Invalid or expired captcha' });

    const password_hash = await hashPassword(password);

    try {
      await db.query('INSERT INTO users (email, names, password_hash) VALUES (?, ?, ?)', [email, names, password_hash]);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      // handle duplicate email
      if (err && err.code === 'ER_DUP_ENTRY') {
        return sendJSON(res, 409, { error: 'Email already registered' });
      }
      console.error('DB insert error', err);
      sendJSON(res, 500, { error: 'Failed to create user' });
    }
  } catch (err) {
    console.error('register error', err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

// Helpers
function sendJSON(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s)
  });
  res.end(s);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function notFound(res) {
  sendText(res, 404, 'Not Found');
}

async function serveStatic(req, res, pathname) {
  let safePath = pathname;
  if (safePath === '/') safePath = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.isDirectory()) {
      // try index.html inside directory
      return serveStatic(req, res, path.join(safePath, 'index.html'));
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => notFound(res));
  } catch (err) {
    notFound(res);
  }
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return resolve(null);

    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function requestHandler(req, res) {
  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || '/';
  const method = (req.method || 'GET').toUpperCase();

  // Route for API paths first
  const routeMap = routes[method];
  if (routeMap && routeMap.has(pathname)) {
    try {
      const body = (method === 'POST' || method === 'PUT') ? await parseJSONBody(req) : null;
      const handler = routeMap.get(pathname);
      await handler(req, res, body);
    } catch (err) {
      sendJSON(res, 400, { error: err.message || 'Bad Request' });
    }
    return;
  }

  // Fallback to static file serving for GET
  if (method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  // Method not allowed / not found
  res.writeHead(405, { 'Allow': 'GET, POST' });
  res.end();
}

const server = http.createServer(requestHandler);
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = server;

// Export some internals for testing (validation, parsing, hashing)
module.exports.utils = {
  isValidEmail,
  isStrongPassword,
  parseCookies,
  hashPassword,
  verifyPassword,
  getAuthTokenFromReq,
  getAuthSession,
  getUserFromRequest
};

// --- Authentication sessions (in-memory) ---
const AUTH_COOKIE = 'auth';
const AUTH_TTL = 24 * 60 * 60 * 1000; // 24 hours
const authSessions = new Map(); // token -> { userId, expires }

function cleanupAuthSessions() {
  const now = Date.now();
  for (const [k, v] of authSessions.entries()) {
    if (v.expires <= now) authSessions.delete(k);
  }
}
setInterval(cleanupAuthSessions, 60 * 1000).unref();

function verifyPassword(password, stored) {
  try {
    const [salt, hashHex] = String(stored || '').split(':');
    if (!salt || !hashHex) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const hashBuf = Buffer.from(hashHex, 'hex');
    if (hashBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(hashBuf, derived);
  } catch (err) {
    return false;
  }
}

// Login endpoint
routes.POST.set('/api/login', async (req, res, body) => {
  try {
    if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: 'Invalid request' });
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!isValidEmail(email) || !password) return sendJSON(res, 400, { error: 'Invalid credentials' });

    const rows = await db.query('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1', [email]);
    if (!rows || rows.length === 0) return sendJSON(res, 401, { error: 'Invalid email or password' });
    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) return sendJSON(res, 401, { error: 'Invalid email or password' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + AUTH_TTL;
    authSessions.set(token, { userId: user.id, expires });

    // set HttpOnly cookie
    const maxAge = Math.floor(AUTH_TTL / 1000);
    res.writeHead(200, {
      'Set-Cookie': `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`,
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error('login error', err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

// Logout endpoint
routes.POST.set('/api/logout', async (req, res, body) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[AUTH_COOKIE] || null;
    if (token) authSessions.delete(token);
    // clear cookie
    res.writeHead(200, {
      'Set-Cookie': `${AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error('logout error', err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

// --- Auth helpers and protected user endpoints ---
function getAuthTokenFromReq(req) {
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE] || null;
}

function getAuthSession(token) {
  if (!token) return null;
  const rec = authSessions.get(token);
  if (!rec) return null;
  if (rec.expires <= Date.now()) { authSessions.delete(token); return null; }
  // extend session
  rec.expires = Date.now() + AUTH_TTL;
  authSessions.set(token, rec);
  return rec;
}

async function getUserFromRequest(req) {
  const token = getAuthTokenFromReq(req);
  const sess = getAuthSession(token);
  if (!sess) return null;
  const rows = await db.query('SELECT id, email, names FROM users WHERE id = ? LIMIT 1', [sess.userId]);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// Fetch the logged-in user's info
routes.GET.set('/api/user', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, { email: user.email, names: user.names });
  } catch (err) {
    console.error('GET /api/user error', err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

// Update the logged-in user's names and/or password
routes.PUT = routes.PUT || new Map();
routes.PUT.set('/api/user', async (req, res, body) => {
  try {
    if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: 'Invalid request' });
    const user = await getUserFromRequest(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });

    const updates = [];
    const params = [];
    if (body.names !== undefined) {
      const names = String(body.names || '').trim();
      if (!names) return sendJSON(res, 400, { error: 'Names must not be empty' });
      updates.push('names = ?'); params.push(names);
    }
    if (body.password !== undefined && body.password !== '') {
      const pw = String(body.password);
      if (!isStrongPassword(pw)) return sendJSON(res, 400, { error: 'Password too weak (min 8 chars, include letters and numbers)' });
      const password_hash = await hashPassword(pw);
      updates.push('password_hash = ?'); params.push(password_hash);
    }
    if (updates.length === 0) return sendJSON(res, 400, { error: 'Nothing to update' });

    params.push(user.id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    await db.query(sql, params);
    sendJSON(res, 200, { ok: true });
  } catch (err) {
    console.error('PUT /api/user error', err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});
