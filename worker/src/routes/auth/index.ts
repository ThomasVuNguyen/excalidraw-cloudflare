import { Hono } from 'hono';
import { 
  hashPassword, 
  verifyPassword, 
  generateTokens, 
  hashToken, 
  timingSafeEqual 
} from '../../utils/crypto';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import type { Env, AppVariables, AuthUser } from '../../types';

const authRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function setCookies(c: any, accessToken: string, refreshToken: string) {
  const host = c.req.header('host') || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const secure = !isLocalhost ? '; Secure' : '';
  
  c.header('Set-Cookie', `excalidash-access-token=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`, { append: true });
  c.header('Set-Cookie', `excalidash-refresh-token=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`, { append: true });
}

function clearCookies(c: any) {
  const host = c.req.header('host') || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const secure = !isLocalhost ? '; Secure' : '';
  
  c.header('Set-Cookie', `excalidash-access-token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`, { append: true });
  c.header('Set-Cookie', `excalidash-refresh-token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`, { append: true });
}

authRouter.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .bind(email)
    .first();
    
  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const { accessToken, refreshToken } = await generateTokens(
    user.id as string, 
    c.env.JWT_SECRET, 
    user.role as string
  );
  
  const hashedRefresh = await hashToken(refreshToken);
  
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, datetime("now", "+7 days"))'
  ).bind(crypto.randomUUID(), hashedRefresh, user.id).run();

  setCookies(c, accessToken, refreshToken);
  
  const authUser: AuthUser = {
    id: user.id as string,
    email: user.email as string,
    username: (user.username as string) || null,
    name: (user.username as string) || (user.email as string).split('@')[0],
    role: user.role as "USER" | "ADMIN",
    isActive: true,
    mustResetPassword: Boolean(user.must_reset_password),
  };

  return c.json({ success: true, user: authUser });
});

authRouter.post('/register', async (c) => {
  const body = await c.req.json();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || body.username || '').trim();
  const setupCode = body.setupCode ? String(body.setupCode).trim() : undefined;

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const usersCount = await c.env.DB.prepare('SELECT count(*) as count FROM users WHERE is_active = 1').first<{count: number}>();
  const isFirstUser = !usersCount || usersCount.count === 0;

  if (!isFirstUser && !setupCode) {
    const config = await c.env.DB.prepare('SELECT registration_enabled FROM system_config WHERE id = ?').bind('default').first<{registration_enabled: number}>();
    if (config && config.registration_enabled === 0) {
      return c.json({ error: 'Registration is closed. An invitation or setup code is required.' }, 403);
    }
  }

  if (!isFirstUser && setupCode) {
    const config = await c.env.DB.prepare('SELECT bootstrap_setup_code_hash FROM system_config WHERE id = ?').bind('default').first();
    if (!config || !config.bootstrap_setup_code_hash || !timingSafeEqual(config.bootstrap_setup_code_hash as string, setupCode)) {
      return c.json({ error: 'Invalid setup code' }, 403);
    }
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ error: 'Email already in use' }, 400);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const role = isFirstUser ? 'ADMIN' : 'USER';
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, username, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).bind(id, email, passwordHash, name || email.split('@')[0], role, now, now).run();

  // If first user, make sure system_config has auth_enabled = 1 and registration_enabled = 1
  if (isFirstUser) {
    await c.env.DB.prepare(
      'UPDATE system_config SET auth_enabled = 1, registration_enabled = 1, updated_at = datetime("now") WHERE id = ?'
    ).bind('default').run();
  }

  const { accessToken, refreshToken } = await generateTokens(
    id,
    c.env.JWT_SECRET,
    role
  );

  const hashedRefresh = await hashToken(refreshToken);
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, datetime("now", "+7 days"))'
  ).bind(crypto.randomUUID(), hashedRefresh, id).run();

  setCookies(c, accessToken, refreshToken);

  const authUser: AuthUser = {
    id,
    email,
    username: name || email.split('@')[0],
    name: name || email.split('@')[0],
    role: role as "USER" | "ADMIN",
    isActive: true,
    mustResetPassword: false,
  };

  return c.json({ success: true, user: authUser }, 201);
});

authRouter.post('/refresh', async (c) => {
  const cookieHeader = c.req.header('Cookie');
  if (!cookieHeader) return c.json({ error: 'Unauthorized' }, 401);
  
  const cookies = cookieHeader.split(';').map(co => co.trim());
  const tokenCookie = cookies.find(co => co.startsWith('excalidash-refresh-token='));
  if (!tokenCookie) return c.json({ error: 'Unauthorized' }, 401);
  
  const refreshToken = tokenCookie.split('=')[1];
  const hashedRefresh = await hashToken(refreshToken);
  
  const tokenRecord = await c.env.DB.prepare(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime("now") AND revoked_at IS NULL'
  ).bind(hashedRefresh).first();
  
  if (!tokenRecord) {
    clearCookies(c);
    return c.json({ error: 'Invalid refresh token' }, 401);
  }
  
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
    .bind(tokenRecord.user_id).first();
    
  if (!user) return c.json({ error: 'Invalid user' }, 401);
  
  const tokens = await generateTokens(user.id as string, c.env.JWT_SECRET, user.role as string);
  const newHashedRefresh = await hashToken(tokens.refreshToken);
  
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(hashedRefresh).run();
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, datetime("now", "+7 days"))'
  ).bind(crypto.randomUUID(), newHashedRefresh, user.id).run();
  
  setCookies(c, tokens.accessToken, tokens.refreshToken);
  
  return c.json({ success: true });
});

authRouter.post('/logout', requireAuth, async (c) => {
  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(co => co.trim());
    const tokenCookie = cookies.find(co => co.startsWith('excalidash-refresh-token='));
    if (tokenCookie) {
      const refreshToken = tokenCookie.split('=')[1];
      const hashedRefresh = await hashToken(refreshToken);
      await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(hashedRefresh).run();
    }
  }
  clearCookies(c);
  return c.json({ success: true });
});

authRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user') as AuthUser;
  return c.json({ 
    user: {
      ...user,
      name: user.name || user.username || user.email.split('@')[0],
    } 
  });
});

authRouter.get('/status', async (c) => {
  const usersCount = await c.env.DB.prepare('SELECT count(*) as count FROM users WHERE is_active = 1').first<{count: number}>();
  const config = await c.env.DB.prepare('SELECT * FROM system_config WHERE id = ?').bind('default').first();
  const isFirstUser = !usersCount || usersCount.count === 0;
  const registrationEnabled = config ? Boolean(config.registration_enabled) : true;
  
  return c.json({
    authMode: c.env.AUTH_MODE || "local",
    authEnabled: true,
    enabled: true,
    registrationEnabled: isFirstUser ? true : registrationEnabled,
    onboardingComplete: !isFirstUser,
    isFirstUser,
    bootstrapRequired: false,
    authOnboardingRequired: false
  });
});

authRouter.post('/onboarding-choice', async (c) => {
  const { enabled } = await c.req.json();
  
  await c.env.DB.prepare(
    'UPDATE system_config SET auth_enabled = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(enabled ? 1 : 0, 'default').run();
  
  return c.json({ 
    authEnabled: Boolean(enabled), 
    authOnboardingCompleted: true, 
    bootstrapRequired: false 
  });
});

authRouter.post('/auth-enabled', requireAuth, requireAdmin, async (c) => {
  const { enabled } = await c.req.json();
  
  await c.env.DB.prepare(
    'UPDATE system_config SET auth_enabled = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(enabled ? 1 : 0, 'default').run();
  
  return c.json({ success: true });
});

authRouter.put('/profile', requireAuth, async (c) => {
  const user = c.get('user') as AuthUser;
  const { username, name } = await c.req.json();
  const newName = username || name;
  
  await c.env.DB.prepare('UPDATE users SET username = ?, updated_at = datetime("now") WHERE id = ?')
    .bind(newName, user.id).run();
  
  return c.json({ success: true });
});

authRouter.put('/email', requireAuth, async (c) => {
  const user = c.get('user') as AuthUser;
  const { email, password } = await c.req.json();
  
  const userRecord = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!userRecord || !(await verifyPassword(password, userRecord.password_hash as string))) {
    return c.json({ error: 'Invalid password' }, 403);
  }
  
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(email, user.id).first();
  if (existing) {
    return c.json({ error: 'Email already in use' }, 400);
  }
  
  await c.env.DB.prepare('UPDATE users SET email = ?, updated_at = datetime("now") WHERE id = ?').bind(email, user.id).run();
  
  return c.json({ success: true });
});

authRouter.post('/change-password', requireAuth, async (c) => {
  const user = c.get('user') as AuthUser;
  const { currentPassword, newPassword } = await c.req.json();
  
  const userRecord = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!userRecord || !(await verifyPassword(currentPassword, userRecord.password_hash as string))) {
    return c.json({ error: 'Invalid current password' }, 403);
  }
  
  const newHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0, updated_at = datetime("now") WHERE id = ?')
    .bind(newHash, user.id).run();
    
  return c.json({ success: true });
});

export { authRouter as authRoutes };
