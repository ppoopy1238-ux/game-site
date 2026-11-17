const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 3_000_000;

const SEARCH_ENGINES = {
  ddg: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  wiki: q => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`
};

// CORS
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedList = (env.SITE_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const ok =
    allowedList.includes('*') ||
    allowedList.includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/i.test(origin) ||
    origin === 'https://script.google.com';

  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  });

  if (ok) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

// Block private and local IP addresses.
function isPrivateIp(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const p = host.split('.').map(Number);

    return p[0] === 10 ||
      p[0] === 127 ||
      p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] >= 224;
  }

  const h = host.toLowerCase();

  return h === '::1' ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80:');
}

// Login token helpers.
function b64url(bytes) {
  let s = '';

  for (const b of bytes) {
    s += String.fromCharCode(b);
  }

  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s) {
  const v = s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - s.length % 4) % 4);

  return Uint8Array.from(atob(v), c => c.charCodeAt(0));
}

async function signToken(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const body = b64url(
    new TextEncoder().encode(JSON.stringify(payload))
  );

  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(body)
    )
  );

  return body + '.' + b64url(sig);
}

async function verifyToken(token, secret) {
  try {
    if (!token || !secret) return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(fromB64url(parts[0]))
    );

    const expected = await signToken(payload, secret);

    const a = new TextEncoder().encode(expected.split('.')[1]);
    const b = new TextEncoder().encode(parts[1]);

    if (a.length !== b.length) return false;

    let diff = 0;

    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }

    return diff === 0 &&
      Number.isFinite(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function requireAuth(request, url, env) {
  return !!(await currentUser(request, url, env));
}

// Validate destination URLs.
function validateUrl(value, env) {
  let u;

  try {
    u = new URL(value);
  } catch {
    throw new Error('That is not a valid web address.');
  }

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only HTTP and HTTPS addresses are supported.');
  }

  if (u.username || u.password) {
    throw new Error('Addresses containing usernames or passwords are not supported.');
  }

  const host = u.hostname.toLowerCase();

  if (
    isPrivateIp(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Private and local network addresses are blocked.');
  }

  return u;
}

// Fetch a public URL and follow redirects.
async function fetchPublic(url, env) {
  let current = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    validateUrl(current, env);

    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SublevelProxy/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8'
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');

      if (!location) {
        return { response, finalUrl: current };
      }

      current = new URL(location, current).href;
      continue;
    }

    return { response, finalUrl: current };
  }

  throw new Error('The destination redirected too many times.');
}

// Build a proxied URL.
function proxyUrl(workerOrigin, target, token) {
  return `${workerOrigin}/browse?url=${encodeURIComponent(target)}&token=${encodeURIComponent(token || '')}`;
}

// Rewrite CSS URLs.
function rewriteCss(css, base, workerOrigin, token) {
  const rewrite = raw => {
    const value = raw.trim().replace(/^['"]|['"]$/g, '');

    if (!value || /^(data:|blob:|#|javascript:)/i.test(value)) {
      return raw;
    }

    try {
      return `url("${proxyUrl(
        workerOrigin,
        new URL(value, base).href,
        token
      )}")`;
    } catch {
      return raw;
    }
  };

  return css
    .replace(/url\(([^)]+)\)/gi, (_, value) => rewrite(value))
    .replace(
      /@import\s+(?:url\()?['"]?([^'"\s;)]+)['"]?\)?/gi,
      (_, value) =>
        `@import url("${proxyUrl(
          workerOrigin,
          new URL(value, base).href,
          token
        )}")`
    );
}

// Unwrap Bing click-tracking links.
function decodeBingDestination(target) {
  const host = target.hostname.toLowerCase();

  if (!(host === 'bing.com' || host.endsWith('.bing.com'))) {
    return target;
  }

  const encoded = target.searchParams.get('u');

  if (!encoded || !encoded.startsWith('a1')) {
    return target;
  }

  try {
    const payload = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload +
      '='.repeat((4 - payload.length % 4) % 4);

    const decoded = atob(padded);

    if (/^https?:\/\//i.test(decoded)) {
      return new URL(decoded);
    }
  } catch {}

  return target;
}

// Clean HTML-encoded ampersands.
function cleanHtmlEncodedUrl(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&#x0*26;/gi, '&');
}

// Rewrite responsive image URLs.
function rewriteSrcset(value, baseUrl, workerOrigin, token) {
  return value.split(',').map(candidate => {
    const item = candidate.trim();

    if (!item || /^data:/i.test(item)) {
      return candidate;
    }

    const match = item.match(/^(\S+)(\s+.*)?$/);

    if (!match) {
      return candidate;
    }

    try {
      const proxied = proxyUrl(
        workerOrigin,
        new URL(match[1], baseUrl).href,
        token
      );

      return `${proxied}${match[2] || ''}`;
    } catch {
      return candidate;
    }
  }).join(',');
}
// Rewrite HTML pages.
function rewriteHtml(
  response,
  baseUrl,
  workerOrigin,
  engine,
  rewriteSearchForms = false,
  token = ''
) {
  const headers = new Headers(response.headers);

  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  headers.delete('x-frame-options');
  headers.delete('set-cookie');
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');

  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Type', 'text/html; charset=utf-8');

  const rewriteAttr = (element, attr) => {
    const value = element.getAttribute(attr);

    if (
      !value ||
      /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)
    ) {
      return;
    }

    try {
      const absolute = new URL(value, baseUrl).href;

      element.setAttribute(
        attr,
        proxyUrl(workerOrigin, absolute, token)
      );
    } catch {}
  };

  const rewriter = new HTMLRewriter()

    .on('base', {
      element(e) {
        e.remove();
      }
    })

    .on('a', {
      element(e) {
        const href = e.getAttribute('href');

        if (!href) return;

        if (/^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(href.trim())) {
          return;
        }

        try {
          const cleanedHref = cleanHtmlEncodedUrl(href.trim());
          let target = new URL(cleanedHref, baseUrl);

          // Unwrap DuckDuckGo redirect links.
          if (
            target.hostname.toLowerCase().endsWith('duckduckgo.com') &&
            target.pathname.startsWith('/l/')
          ) {
            const real = target.searchParams.get('uddg');

            if (real) {
              target = new URL(real);
            }
          }

          // Unwrap Bing tracking links.
          target = decodeBingDestination(target);

          if (!['http:', 'https:'].includes(target.protocol)) {
            return;
          }

          e.setAttribute(
            'href',
            proxyUrl(workerOrigin, target.href, token)
          );

          e.setAttribute('target', '_self');
          e.setAttribute('rel', 'noreferrer');
        } catch {
          // Leave malformed links unchanged.
        }
      }
    })

    .on('img', {
      element(e) {
        rewriteAttr(e, 'src');
        rewriteAttr(e, 'data-src');

        const v = e.getAttribute('srcset');

        if (v) {
          e.setAttribute(
            'srcset',
            rewriteSrcset(v, baseUrl, workerOrigin, token)
          );
        }
      }
    })

    .on('script', {
      element(e) {
        rewriteAttr(e, 'src');
      }
    })

    .on('iframe', {
      element(e) {
        rewriteAttr(e, 'src');
      }
    })

    .on('source', {
      element(e) {
        rewriteAttr(e, 'src');

        const v = e.getAttribute('srcset');

        if (v) {
          e.setAttribute(
            'srcset',
            rewriteSrcset(v, baseUrl, workerOrigin, token)
          );
        }
      }
    })

    .on('video', {
      element(e) {
        rewriteAttr(e, 'src');
      }
    })

    .on('audio', {
      element(e) {
        rewriteAttr(e, 'src');
      }
    })

    .on('link', {
      element(e) {
        const rel = (e.getAttribute('rel') || '').toLowerCase();

        if (
          rel.includes('stylesheet') ||
          rel.includes('icon') ||
          rel.includes('preload')
        ) {
          rewriteAttr(e, 'href');
        }
      }
    });

  // Send search forms back through Sublevel.
  if (rewriteSearchForms) {
    rewriter.on('form', {
      element(e) {
        e.setAttribute(
          'action',
          `${workerOrigin}/search?engine=${encodeURIComponent(engine || 'ddg')}&token=${encodeURIComponent(token)}`
        );

        e.setAttribute('method', 'get');
        e.setAttribute('target', '_self');
      }
    });
  }

  const transformed = rewriter.transform(response);

  return new Response(transformed.body, {
    status: response.status,
    headers
  });
}

// JSON response helper.
function json(data, status = 200, headers = new Headers()) {
  const h = new Headers(headers);

  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');

  return new Response(JSON.stringify(data), {
    status,
    headers: h
  });
}

// D1-backed account helpers.
// Passwords are PBKDF2-SHA-256 hashes; plaintext is never stored.
function randomHex(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );

  return [...new Uint8Array(digest)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPassword(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    material,
    256
  );

  return [...new Uint8Array(bits)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;

  const actual = await hashPassword(password, salt);

  if (actual.length !== expected.length) return false;

  let diff = 0;

  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return diff === 0;
}

async function ensureBootstrapAdmin(env) {
  const found = await env.DB.prepare(
    "SELECT id FROM users WHERE role='admin' LIMIT 1"
  ).first();

  if (found) return;

  const username = String(
    env.ADMIN_USERNAME || env.LOGIN_USERNAME || ''
  ).trim();

  const password = String(
    env.ADMIN_PASSWORD || env.LOGIN_PASSWORD || ''
  );

  if (!username || password.length < 10) {
    throw new Error(
      'Set ADMIN_USERNAME and a strong ADMIN_PASSWORD (10+ characters) in Worker secrets before first login.'
    );
  }

  const salt = randomHex(16);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, status, created_at) VALUES (?, ?, ?, ?, 'admin', 'active', ?)"
  ).bind(
    crypto.randomUUID(),
    username,
    await hashPassword(password, salt),
    salt,
    now
  ).run();
}

async function currentUser(request, url, env) {
  const token =
    url.searchParams.get('token') ||
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  if (!await verifyToken(token, env.SESSION_SECRET || '')) {
    return null;
  }

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromB64url(token.split('.')[0]))
    );

    if (!env.DB || !payload.sub) return null;

    return await env.DB.prepare(
      "SELECT id, username, role, status FROM users WHERE id = ? AND status = 'active'"
    ).bind(payload.sub).first();

  } catch {
    return null;
  }
}

async function recordLogin(env, userId, username, success, request) {
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  const ipHint = ip
    ? ip.split('.').slice(0, 2).join('.') + '.x.x'
    : 'unknown';

  await env.DB.prepare(
    "INSERT INTO login_events (user_id, username, success, ip_hint, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    userId,
    String(username).slice(0, 80),
    success ? 1 : 0,
    ipHint,
    String(request.headers.get('User-Agent') || '').slice(0, 180),
    now
  ).run();
}

async function audit(env, userId, username, action, details) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    userId,
    username || 'system',
    action,
    String(details || '').slice(0, 500),
    Math.floor(Date.now() / 1000)
  ).run();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // Health check.
    if (
      url.pathname === '/health' &&
      ['GET', 'HEAD'].includes(request.method)
    ) {
      return json(
        { ok: true, service: 'Sublevel proxy' },
        200,
        cors
      );
    }

    // Public status endpoint for the website maintenance screen.
    if (
      url.pathname === '/status' &&
      ['GET', 'HEAD'].includes(request.method)
    ) {
      if (!env.DB) {
        return json({
          maintenance: false,
          message: '',
          announcement: ''
        }, 200, cors);
      }

      try {
        const rows = await env.DB.prepare(
          "SELECT key, value FROM settings WHERE key IN ('maintenance', 'maintenanceMessage', 'announcement')"
        ).all();

        const settings = Object.fromEntries(
          (rows.results || []).map(x => [x.key, x.value])
        );

        return json({
          maintenance: settings.maintenance === '1',
          message: settings.maintenanceMessage ||
            'Sublevel is temporarily undergoing maintenance. Please check back soon.',
          announcement: settings.announcement || ''
        }, 200, cors);
      } catch {
        return json({ error: 'Could not read site status.' }, 503, cors);
      }
    }

    // Enforce maintenance across all API and proxy routes.
    // Login and status remain available; authenticated admins bypass maintenance.
    if (env.DB && !['/health', '/status', '/auth/login', '/auth/me'].includes(url.pathname)) {
      const maintenance = await env.DB.prepare(
        "SELECT value FROM settings WHERE key = 'maintenance'"
      ).first().catch(() => null);

      if (maintenance?.value === '1') {
        const user = await currentUser(request, url, env);

        if (!user || user.role !== 'admin') {
          const setting = await env.DB.prepare(
            "SELECT value FROM settings WHERE key = 'maintenanceMessage'"
          ).first().catch(() => null);

          return json({
            maintenance: true,
            error: setting?.value ||
              'Sublevel is temporarily undergoing maintenance. Please check back soon.'
          }, 503, cors);
        }
      }
    }

    // Authentication, invitations, and account management.
    if (url.pathname === '/auth/register' && request.method === 'POST') {
      try {
        if (!env.DB) {
          return json({ error: 'D1 database binding DB is missing.' }, 503, cors);
        }

        const body = await request.json();
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const inviteCode = String(body.inviteCode || '').trim();

        if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
          return json({
            error: 'Username must be 3–24 characters (letters, numbers, dot, underscore or dash).'
          }, 400, cors);
        }

        if (password.length < 10 || password.length > 200) {
          return json({
            error: 'Password must be at least 10 characters.'
          }, 400, cors);
        }

        if (!inviteCode) {
          return json({ error: 'An invitation code is required.' }, 400, cors);
        }

        const inviteHash = await sha256Hex(inviteCode);

        const invite = await env.DB.prepare(
          "SELECT * FROM invites WHERE code_hash = ? AND revoked = 0"
        ).bind(inviteHash).first();

        const now = Math.floor(Date.now() / 1000);

        if (
          !invite ||
          (invite.expires_at && invite.expires_at < now) ||
          invite.uses >= invite.max_uses
        ) {
          return json({
            error: 'Invitation code is invalid, expired, or already used.'
          }, 403, cors);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE lower(username) = lower(?)"
        ).bind(username).first();

        if (existing) {
          return json({ error: 'That username is already taken.' }, 409, cors);
        }

        const salt = randomHex(16);
        const passwordHash = await hashPassword(password, salt);
        const id = crypto.randomUUID();

        await env.DB.prepare(
          "INSERT INTO users (id, username, password_hash, salt, role, status, created_at) VALUES (?, ?, ?, ?, 'user', 'active', ?)"
        ).bind(
          id,
          username,
          passwordHash,
          salt,
          now
        ).run();

        await env.DB.prepare(
          "UPDATE invites SET uses = uses + 1 WHERE id = ?"
        ).bind(invite.id).run();

        await audit(
          env,
          null,
          username,
          'account.registered',
          'Account created with invitation'
        );

        return json({
          ok: true,
          message: 'Account created. You can now sign in.'
        }, 201, cors);

      } catch (e) {
        return json({
          error: e.message || 'Could not create account.'
        }, 400, cors);
      }
    }

    // Login.
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      try {
        if (!env.DB || !env.SESSION_SECRET) {
          return json({
            error: 'Authentication is not configured. Add the D1 DB binding and SESSION_SECRET.'
          }, 503, cors);
        }

        await ensureBootstrapAdmin(env);

        const body = await request.json();
        const username = String(body.username || '').trim();
        const password = String(body.password || '');

        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE lower(username) = lower(?)"
        ).bind(username).first();

        const valid = !!(
          user &&
          user.status === 'active' &&
          await verifyPassword(password, user.salt, user.password_hash)
        );

        await recordLogin(
          env,
          user ? user.id : null,
          username,
          valid,
          request
        );

        if (!valid) {
          return json({
            error: user && user.status !== 'active'
              ? 'This account is suspended or disabled.'
              : 'Incorrect username or password.'
          }, 401, cors);
        }

        const now = Math.floor(Date.now() / 1000);

        await env.DB.prepare(
          "UPDATE users SET last_login = ? WHERE id = ?"
        ).bind(now, user.id).run();

        const token = await signToken({
          sub: user.id,
          username: user.username,
          role: user.role,
          exp: now + 60 * 60 * 12
        }, env.SESSION_SECRET);

        return json({
          ok: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        }, 200, cors);

      } catch (e) {
        return json({
          error: e.message || 'Could not process login.'
        }, 400, cors);
      }
    }

    // Current account.
    if (url.pathname === '/auth/me' && request.method === 'GET') {
      const user = await currentUser(request, url, env);

      if (!user) {
        return json({ error: 'Please sign in again.' }, 401, cors);
      }

      return json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status
        }
      }, 200, cors);
    }

    // Admin-only routes.
    if (url.pathname.startsWith('/admin/')) {
      const admin = await currentUser(request, url, env);

      if (!admin || admin.role !== 'admin') {
        return json({
          error: 'Administrator access required.'
        }, 403, cors);
      }

      if (!env.DB) {
        return json({
          error: 'D1 database binding DB is missing.'
        }, 503, cors);
      }

      // Dashboard statistics.
      if (
        url.pathname === '/admin/overview' &&
        request.method === 'GET'
      ) {
        const [
          users,
          active,
          suspended,
          invites,
          logins
        ] = await Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM users"
          ).first(),

          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM users WHERE status = 'active'"
          ).first(),

          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM users WHERE status != 'active'"
          ).first(),

          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM invites WHERE revoked = 0 AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)"
          ).bind(Math.floor(Date.now() / 1000)).first(),

          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM login_events WHERE success = 1 AND created_at > ?"
          ).bind(Math.floor(Date.now() / 1000) - 86400).first()
        ]);

        return json({
          users: users.n,
          active: active.n,
          suspended: suspended.n,
          invites: invites.n,
          logins24h: logins.n
        }, 200, cors);
      }

      // User list.
      if (
        url.pathname === '/admin/users' &&
        request.method === 'GET'
      ) {
        const result = await env.DB.prepare(
          "SELECT id, username, role, status, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 500"
        ).all();

        return json({
          users: result.results || []
        }, 200, cors);
      }

      // Invitation list.
      if (
        url.pathname === '/admin/invites' &&
        request.method === 'GET'
      ) {
        const result = await env.DB.prepare(
          "SELECT id, code_hint, uses, max_uses, expires_at, revoked, created_at FROM invites ORDER BY created_at DESC LIMIT 100"
        ).all();

        return json({
          invites: result.results || []
        }, 200, cors);
      }

      // Generate invitation.
      if (
        url.pathname === '/admin/invites' &&
        request.method === 'POST'
      ) {
        const body = await request.json();

        const maxUses = Math.max(
          1,
          Math.min(100, Number(body.maxUses) || 1)
        );

        const days = Math.max(
          1,
          Math.min(365, Number(body.days) || 7)
        );

        const code =
          randomHex(4).toUpperCase() +
          '-' +
          randomHex(4).toUpperCase();

        const id = crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);

        await env.DB.prepare(
          "INSERT INTO invites (id, code_hash, code_hint, created_by, max_uses, uses, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)"
        ).bind(
          id,
          await sha256Hex(code),
          code.slice(-4),
          admin.id,
          maxUses,
          now + days * 86400,
          now
        ).run();

        await audit(
          env,
          admin.id,
          admin.username,
          'invite.created',
          `Uses=${maxUses}; days=${days}`
        );

        return json({
          ok: true,
          code,
          maxUses,
          expiresAt: now + days * 86400
        }, 201, cors);
      }

      // Suspend or reactivate accounts.
      if (
        url.pathname.startsWith('/admin/users/') &&
        url.pathname.endsWith('/status') &&
        request.method === 'PATCH'
      ) {
        const id = url.pathname.split('/')[3];

        if (id === admin.id) {
          return json({
            error: 'You cannot suspend your own admin account.'
          }, 400, cors);
        }

        const body = await request.json();

        const status = body.status === 'suspended'
          ? 'suspended'
          : 'active';

        const target = await env.DB.prepare(
          "SELECT id, username FROM users WHERE id = ?"
        ).bind(id).first();

        if (!target) {
          return json({ error: 'User not found.' }, 404, cors);
        }

        await env.DB.prepare(
          "UPDATE users SET status = ? WHERE id = ? AND role != 'admin'"
        ).bind(status, id).run();

        await audit(
          env,
          admin.id,
          admin.username,
          'user.status_changed',
          `${target.username}: ${status}`
        );

        return json({ ok: true }, 200, cors);
      }

      // Login activity.
      if (
        url.pathname === '/admin/logs' &&
        request.method === 'GET'
      ) {
        const result = await env.DB.prepare(
          "SELECT username, success, ip_hint, user_agent, created_at FROM login_events ORDER BY created_at DESC LIMIT 200"
        ).all();

        return json({
          logs: result.results || []
        }, 200, cors);
      }

      // Read site settings.
      if (
        url.pathname === '/admin/settings' &&
        request.method === 'GET'
      ) {
        const result = await env.DB.prepare(
          "SELECT key, value FROM settings"
        ).all();

        const settings = Object.fromEntries(
          (result.results || []).map(x => [x.key, x.value])
        );

        return json({ settings }, 200, cors);
      }

      // Save site settings.
      if (
        url.pathname === '/admin/settings' &&
        request.method === 'PUT'
      ) {
        const body = await request.json();

        const maintenance = body.maintenance === true ? '1' : '0';
        const message = String(body.maintenanceMessage || '').slice(0, 240);
        const announcement = String(body.announcement || '').slice(0, 500);
        const now = Math.floor(Date.now() / 1000);

        for (const [key, value] of Object.entries({
          maintenance,
          maintenanceMessage: message,
          announcement
        })) {
          await env.DB.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
          ).bind(key, value, now).run();
        }

        await audit(
          env,
          admin.id,
          admin.username,
          'site.settings_updated',
          'Maintenance and announcement settings updated'
        );

        return json({ ok: true }, 200, cors);
      }

      return json({
        error: 'Unknown admin route.'
      }, 404, cors);
    }
        // Only allow GET and HEAD for the remaining proxy routes.
    if (!['GET', 'HEAD'].includes(request.method)) {
      return json({
        error: 'Method not allowed.'
      }, 405, cors);
    }

    try {

      // SEARCH ROUTE
      if (url.pathname === '/search') {
        const token = url.searchParams.get('token') || '';

        if (!await requireAuth(request, url, env)) {
          return json({
            error: 'Please sign in to Sublevel.'
          }, 401, cors);
        }

        const q = (
          url.searchParams.get('q') ||
          url.searchParams.get('search') ||
          url.searchParams.get('query') ||
          ''
        ).trim();

        if (!q) {
          return new Response(
            'Enter a search term in the address bar.',
            { status: 400, headers: cors }
          );
        }

        if (q.length > 300) {
          return new Response(
            'Search query is too long.',
            { status: 400, headers: cors }
          );
        }

        const requestedEngine =
          url.searchParams.get('engine') || 'ddg';

        const engine = SEARCH_ENGINES[requestedEngine]
          ? requestedEngine
          : 'ddg';

        // Search verticals.
        const type = (
          url.searchParams.get('type') || 'web'
        ).toLowerCase();

        const verticalSearches = {
          images: query =>
            `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`,

          videos: query =>
            `https://www.bing.com/videos/search?q=${encodeURIComponent(query)}`,

          news: query =>
            `https://www.bing.com/news/search?q=${encodeURIComponent(query)}`,

          maps: query =>
            `https://www.bing.com/maps?q=${encodeURIComponent(query)}`
        };

        const target = verticalSearches[type]
          ? verticalSearches[type](q)
          : SEARCH_ENGINES[engine](q);

        const { response, finalUrl } = await fetchPublic(target, env);

        if (!response.ok) {
          return new Response(
            `Search provider returned HTTP ${response.status}. Try DuckDuckGo or another provider.`,
            { status: 502, headers: cors }
          );
        }

        const ct = response.headers.get('content-type') || '';

        if (!ct.includes('text/html')) {
          return new Response(
            'The search provider did not return an HTML results page.',
            { status: 502, headers: cors }
          );
        }

        const workerOrigin = url.origin;

        const rewritten = rewriteHtml(
          response,
          finalUrl,
          workerOrigin,
          engine,
          true,
          token
        );

        const outHeaders = new Headers(rewritten.headers);

        for (const [k, v] of cors) {
          outHeaders.set(k, v);
        }

        return new Response(rewritten.body, {
          status: rewritten.status,
          headers: outHeaders
        });
      }

      // BROWSE ROUTE
      if (url.pathname === '/browse') {
        const token = url.searchParams.get('token') || '';

        if (!await requireAuth(request, url, env)) {
          return json({
            error: 'Please sign in to Sublevel.'
          }, 401, cors);
        }

        const target = url.searchParams.get('url');

        if (!target) {
          return new Response(
            'Missing ?url= destination.',
            { status: 400, headers: cors }
          );
        }

        const { response, finalUrl } = await fetchPublic(target, env);

        const ct =
          response.headers.get('content-type') ||
          'application/octet-stream';

        const headers = new Headers(cors);

        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');

        if (ct.includes('text/html')) {
          const len = Number(
            response.headers.get('content-length') || 0
          );

          if (len > MAX_HTML_BYTES) {
            return new Response(
              'This page is too large for the lightweight proxy.',
              { status: 413, headers }
            );
          }

          const browseHost = new URL(finalUrl).hostname.toLowerCase();

          const isDuckDuckGo =
            browseHost === 'duckduckgo.com' ||
            browseHost.endsWith('.duckduckgo.com');

          const rewritten = rewriteHtml(
            response,
            finalUrl,
            url.origin,
            'ddg',
            isDuckDuckGo,
            token
          );

          for (const [k, v] of cors) {
            rewritten.headers.set(k, v);
          }

          return rewritten;
        }

        if (ct.includes('text/css')) {
          const css = await response.text();

          headers.set('Content-Type', 'text/css; charset=utf-8');

          return new Response(
            rewriteCss(css, finalUrl, url.origin, token),
            {
              status: response.status,
              headers
            }
          );
        }

        headers.set('Content-Type', ct);

        return new Response(
          request.method === 'HEAD' ? null : response.body,
          {
            status: response.status,
            headers
          }
        );
      }

      // Default response.
      return json({
        service: 'Sublevel proxy',
        routes: [
          '/health',
          '/search?q=hello&engine=ddg',
          '/browse?url=https%3A%2F%2Fexample.com'
        ],
        note: 'Lightweight compatibility proxy; not every website is supported.'
      }, 200, cors);

    } catch (error) {
      return json({
        error: error && error.message
          ? error.message
          : 'Proxy request failed.'
      }, 502, cors);
    }
  }
};
