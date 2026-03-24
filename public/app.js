// SPA front-end interactions: registration, login, profile, captcha
function el(id) { return document.getElementById(id); }

function showMsg(text, timeout=4000) {
  const m = el('msg');
  m.textContent = text;
  m.classList.remove('hidden');
  clearTimeout(m._t);
  m._t = setTimeout(() => m.classList.add('hidden'), timeout);
}

function showSection(name) {
  ['register','login','profile'].forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    if (s === name) el.classList.remove('hidden'); else el.classList.add('hidden');
  });
}

async function loadCaptcha() {
  try {
    const res = await fetch('/api/captcha');
    const json = await res.json();
    if (json.data) el('captcha-img').src = json.data;
    if (json.sessionId) {
      document.cookie = `sid=${json.sessionId}; Path=/`;
    }
  } catch (err) {
    console.error('captcha load failed', err);
  }
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, body: j };
}

// Nav buttons
el('nav-register').addEventListener('click', () => { showSection('register'); loadCaptcha(); });
el('nav-login').addEventListener('click', () => showSection('login'));
el('nav-profile').addEventListener('click', () => { showSection('profile'); loadProfile(); });

// Register form
el('form-register').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const form = Object.fromEntries(new FormData(f).entries());
  if (form.password !== form.confirm) return showMsg('Passwords do not match');
  const { status, body } = await postJSON('/api/register', { email: form.email, names: form.names, password: form.password, captcha: form.captcha });
  if (status === 200) {
    showMsg('Registered successfully — you can login');
    showSection('login');
  } else {
    showMsg(body && body.error ? body.error : `Error (${status})`);
    loadCaptcha();
  }
});

// Reload captcha
el('reload-captcha').addEventListener('click', loadCaptcha);

// Login form
el('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const form = Object.fromEntries(new FormData(f).entries());
  const { status, body } = await postJSON('/api/login', { email: form.email, password: form.password });
  if (status === 200) {
    showMsg('Login successful');
    showSection('profile');
    loadProfile();
  } else {
    showMsg(body && body.error ? body.error : `Error (${status})`);
  }
});

// Profile load
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    if (res.status !== 200) { showSection('login'); return; }
    const j = await res.json();
    const f = el('form-profile');
    f.elements.email.value = j.email || '';
    f.elements.names.value = j.names || '';
  } catch (err) { console.error(err); showSection('login'); }
}

// Profile save
el('form-profile').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const form = Object.fromEntries(new FormData(f).entries());
  const payload = { names: form.names };
  if (form.password) payload.password = form.password;
  const res = await fetch('/api/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 200) showMsg('Profile updated'); else showMsg(j.error || `Error (${res.status})`);
});

// Logout
el('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  document.cookie = 'sid=; Path=/; Max-Age=0';
  showSection('login');
  showMsg('Logged out');
});

// Init
showSection('register');
loadCaptcha();
