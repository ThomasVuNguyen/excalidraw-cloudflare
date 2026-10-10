import { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import { getCookie } from 'hono/cookie';
import type { Env, AppVariables, AuthUser } from '../types';

function getToken(c: Context<{ Bindings: Env; Variables: AppVariables }>): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  const token = getCookie(c, 'excalidash-access-token');
  if (token) {
    return token;
  }
  
  return null;
}

export const authMiddleware = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const token = getToken(c);
  if (!token) {
    return next();
  }

  try {
    const secretKey = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);
    
    if (payload && payload.userId) {
      const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
        .bind(payload.userId as string)
        .first();

      if (user) {
        const authUser: AuthUser = {
          id: user.id as string,
          email: user.email as string,
          username: (user.username as string) || null,
          role: user.role as "USER" | "ADMIN",
          isActive: !!user.is_active,
          mustResetPassword: !!user.must_reset_password,
        };
        c.set('user', authUser);
      }
    }
  } catch (err) {
    // Invalid token, ignore
  }

  await next();
};

export const requireAuth = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (user.mustResetPassword) {
    const path = new URL(c.req.url).pathname;
    const allowedPaths = [
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/logout',
      '/auth/me',
      '/auth/change-password',
      '/auth/logout',
    ];
    if (!allowedPaths.includes(path)) {
      return c.json({ error: 'Password reset required', code: 'PASSWORD_RESET_REQUIRED' }, 403);
    }
  }

  await next();
};

export const requireAdmin = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const user = c.get('user');
  if (!user || user.role !== 'ADMIN') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
};
