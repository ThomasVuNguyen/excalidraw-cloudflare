import { Context, Next } from 'hono';
import type { Env, AppVariables } from '../types';

export const onboardingGate = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const path = new URL(c.req.url).pathname;
  
  // Skip onboarding check for specific paths
  if (
    path === '/api/health' || 
    path.startsWith('/api/auth/') || 
    path === '/api/csrf-token'
  ) {
    return next();
  }

  // Only applies in local auth mode
  if (c.env.AUTH_MODE !== 'local') {
    return next();
  }

  const config = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'auth_enabled'"
  ).first<{ value: string }>();

  if (!config) {
    return c.json({ 
      error: 'Auth onboarding required', 
      code: 'AUTH_ONBOARDING_REQUIRED' 
    }, 409);
  }

  await next();
};
