import { Context, Next } from 'hono';
import type { Env, AppVariables } from '../types';

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signData(key: CryptoKey, data: string): Promise<string> {
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function getClientId(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<string> {
  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    const clientCookie = cookies.find(c => c.startsWith('excalidash-csrf-client='));
    if (clientCookie) {
      return clientCookie.split('=')[1];
    }
  }

  const ip = c.req.header('x-real-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const ua = c.req.header('user-agent') || 'unknown';
  const data = new TextEncoder().encode(`${ip}|${ua}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

export const csrfTokenRoute = async (c: Context<{ Bindings: Env; Variables: AppVariables }>) => {
  const clientId = await getClientId(c);
  const ts = Date.now();
  const nonce = crypto.randomUUID();
  
  const payload = JSON.stringify({ ts, nonce });
  const payloadB64 = btoa(payload);
  
  const key = await getHmacKey(c.env.CSRF_SECRET);
  const signatureB64 = await signData(key, `${clientId}|${ts}|${nonce}`);
  
  const token = `${payloadB64}.${signatureB64}`;
  
  const response = c.json({ token });
  
  // Set client ID cookie if not present
  const cookieHeader = c.req.header('Cookie');
  const hasClientCookie = cookieHeader?.includes('excalidash-csrf-client=');
  if (!hasClientCookie) {
    c.header('Set-Cookie', `excalidash-csrf-client=${clientId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  }
  
  return response;
};

export const csrfMiddleware = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
) => {
  const method = c.req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  const token = c.req.header('X-CSRF-Token');
  if (!token) {
    return c.json({ error: 'CSRF token missing' }, 403);
  }

  try {
    const [payloadB64, signatureB64] = token.split('.');
    if (!payloadB64 || !signatureB64) {
      throw new Error('Invalid token format');
    }

    const payloadStr = atob(payloadB64);
    const { ts, nonce } = JSON.parse(payloadStr);

    // Check expiry (24 hours + 5 mins skew)
    const now = Date.now();
    const age = now - ts;
    if (age > 24 * 60 * 60 * 1000 + 5 * 60 * 1000 || age < -5 * 60 * 1000) {
      throw new Error('Token expired');
    }

    const clientId = await getClientId(c);
    const key = await getHmacKey(c.env.CSRF_SECRET);
    const expectedSignature = await signData(key, `${clientId}|${ts}|${nonce}`);

    if (signatureB64 !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    await next();
  } catch (err) {
    return c.json({ error: 'CSRF token invalid' }, 403);
  }
};
