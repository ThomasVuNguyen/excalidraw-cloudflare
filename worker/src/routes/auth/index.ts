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
  const isProd = c.env.FRONTEND_URL?.startsWith('https');
  const secure = isProd ? '; Secure' : '';
  
  c.header('Set-Cookie', `excalidash-access-token=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`, { append: true });
  c.header('Set-Cookie', `excalidash-refresh-token=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`, { append: true });
}

function clearCookies(c: any) {
  const isProd = c.env.FRONTEND_URL?.startsWith('https');
  const secure = isProd ? '; Secure' : '';
  
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
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, datetime("now", "+7 days"))'
  ).bind(hashedRefresh, user.id).run();

  setCookies(c, accessToken, refreshToken);
  
  return c.json({ success: true });
});

authRouter.post('/register', async (c) => {
  const { email, password, name, setupCode } = await c.req.json();
  
  const usersCount = await c.env.DB.prepare('SELECT count(*) as count FROM users').first<{count: number}>();
  const isFirstUser = usersCount && usersCount.count === 0;
  
  if (!isFirstUser && !setupCode) {
    // Only admins can invite, or setup code required (simplify to block open registration)
    return c.json({ error: 'Registration requires invitation or setup code' }, 403);
  }
  
  if (!isFirstUser && setupCode) {
    const config = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'setup_code'").first<{value: string}>();
    if (!config || !timingSafeEqual(config.value, setupCode)) {
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
  
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)'
  ).bind(id, email, passwordHash, name, role).run();
  
  return c.json({ success: true });
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
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime("now")'
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
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, datetime("now", "+7 days"))'
  ).bind(newHashedRefresh, user.id).run();
  
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
  return c.json({ user });
});

authRouter.get('/status', async (c) => {
  const usersCount = await c.env.DB.prepare('SELECT count(*) as count FROM users').first<{count: number}>();
  const authEnabled = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'auth_enabled'").first<{value: string}>();
  
  return c.json({
    authMode: c.env.AUTH_MODE,
    authEnabled: authEnabled ? authEnabled.value === 'true' : null,
    onboardingComplete: authEnabled !== null,
    isFirstUser: usersCount ? usersCount.count === 0 : true
  });
});

authRouter.post('/onboarding-choice', async (c) => {
  const { enabled } = await c.req.json();
  const value = enabled ? 'true' : 'false';
  
  await c.env.DB.prepare(
    "INSERT INTO system_config (key, value) VALUES ('auth_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).bind(value, value).run();
  
  return c.json({ success: true });
});

authRouter.post('/auth-enabled', requireAuth, requireAdmin, async (c) => {
  const { enabled } = await c.req.json();
  const value = enabled ? 'true' : 'false';
  
  await c.env.DB.prepare(
    "INSERT INTO system_config (key, value) VALUES ('auth_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).bind(value, value).run();
  
  return c.json({ success: true });
});

authRouter.put('/profile', requireAuth, async (c) => {
  const user = c.get('user') as AuthUser;
  const { name } = await c.req.json();
  
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  
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
  
  await c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, user.id).run();
  
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
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?')
    .bind(newHash, user.id).run();
    
  return c.json({ success: true });
});

export default authRouter;
