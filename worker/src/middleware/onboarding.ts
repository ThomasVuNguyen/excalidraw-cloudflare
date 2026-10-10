import { Context, Next } from 'hono';
import type { Env, AppVariables } from '../types';

export const onboardingGate = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const path = new URL(c.req.url).pathname;
  
  // Skip onboarding check for public, health, csrf, and auth paths
  if (
    path === '/health' || 
    path === '/api/health' || 
    path === '/csrf-token' ||
    path === '/api/csrf-token' ||
    path.startsWith('/auth/') ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/ws/')
  ) {
    return next();
  }

  // Only applies in local auth mode
  if (c.env.AUTH_MODE !== 'local') {
    return next();
  }

  const config = await c.env.DB.prepare(
    "SELECT auth_enabled FROM system_config WHERE id = 'default'"
  ).first<{ auth_enabled: number }>();

  // If auth is enabled, onboarding is not required
  if (config && config.auth_enabled === 1) {
    return next();
  }

  // If there are already active users, onboarding is complete
  const userCount = await c.env.DB.prepare(
    "SELECT count(*) as count FROM users WHERE is_active = 1"
  ).first<{ count: number }>();

  if (userCount && userCount.count > 0) {
    return next();
  }

  // Otherwise, onboarding choice is required
  return c.json({ 
    error: 'Auth onboarding required', 
    code: 'AUTH_ONBOARDING_REQUIRED' 
  }, 409);
};
