const crypto = require('crypto');

const SESSION_TTL = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
const SESSION_COOKIE = 'sid';

const sessions = new Map(); // sessionId -> { text, expires }

function genSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function genCaptchaText(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
}

function svgForText(text, width = 220, height = 80) {
  const bg = '#f3f4f6';
  const txtColor = '#111827';
  const rnd = (v) => Math.floor(Math.random() * v);

  // Create some random lines for noise
  let noise = '';
  for (let i = 0; i < 6; i++) {
    const x1 = rnd(width);
    const y1 = rnd(height);
    const x2 = rnd(width);
    const y2 = rnd(height);
    const stroke = `rgba(${rnd(200)},${rnd(200)},${rnd(200)},0.25)`;
    noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1" />`;
  }

  // Slight random rotation per-character via tspan with dx
  const chars = text.split('');
  const charSvgs = chars.map((c, i) => {
    const tx = 30 + i * 30 + (Math.random() * 6 - 3);
    const rotate = (Math.random() * 20 - 10).toFixed(2);
    const y = 50 + (Math.random() * 8 - 4);
    return `<g transform="translate(${tx},${y}) rotate(${rotate})"><text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="${txtColor}">${escapeXml(c)}</text></g>`;
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bg}" />
  <g opacity="0.9">${noise}</g>
  <g transform="translate(0,0)">${charSvgs}</g>
</svg>`;

  return svg;
}

function createCaptcha(existingSessionId) {
  const sessionId = existingSessionId || genSessionId();
  const text = genCaptchaText(6);
  const expires = Date.now() + SESSION_TTL;
  sessions.set(sessionId, { text, expires });
  const svg = svgForText(text);
  const data = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  return { sessionId, data };
}

function verifyCaptcha(sessionId, provided) {
  if (!sessionId) return false;
  const rec = sessions.get(sessionId);
  if (!rec) return false;
  if (Date.now() > rec.expires) {
    sessions.delete(sessionId);
    return false;
  }
  const ok = String(provided || '').trim().toLowerCase() === String(rec.text).toLowerCase();
  // Remove after verification to prevent replay
  sessions.delete(sessionId);
  return ok;
}

function getCaptchaTextForTesting(sessionId) {
  const rec = sessions.get(sessionId);
  return rec ? rec.text : null;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (v.expires <= now) sessions.delete(k);
  }
}

setInterval(cleanupExpired, CLEANUP_INTERVAL).unref();

module.exports = {
  createCaptcha,
  verifyCaptcha,
  getCaptchaTextForTesting,
  SESSION_COOKIE_NAME: SESSION_COOKIE
};
