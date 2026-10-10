import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get('/update', async (c) => {
  const CACHE_KEY = 'system:update_check';
  
  if (c.env.KV) {
    try {
      const cached = await c.env.KV.get(CACHE_KEY, 'json');
      if (cached) return c.json(cached);
    } catch (e) {
      // Ignore cache errors
    }
  }

  const currentVersion = c.env.APP_VERSION || '1.0.0';
  const defaultResponse = {
    currentVersion,
    channel: 'stable',
    outboundEnabled: true,
    latestVersion: currentVersion,
    latestUrl: 'https://github.com/excalidraw/excalidraw/releases',
    publishedAt: new Date().toISOString(),
    isUpdateAvailable: false
  };

  try {
    const res = await fetch('https://api.github.com/repos/excalidraw/excalidraw/releases/latest', {
      headers: { 'User-Agent': 'ExcaliDash-Worker' }
    });
    
    if (res.ok) {
      const data = await res.json() as any;
      const versionStr = data.tag_name || data.name;
      
      const updateData = {
        currentVersion,
        channel: 'stable',
        outboundEnabled: true,
        latestVersion: versionStr,
        latestUrl: data.html_url,
        publishedAt: data.published_at,
        isUpdateAvailable: versionStr !== currentVersion && versionStr !== `v${currentVersion}`
      };

      if (c.env.KV) {
        await c.env.KV.put(CACHE_KEY, JSON.stringify(updateData), { expirationTtl: 3600 });
      }

      return c.json(updateData);
    }
  } catch (err) {
    console.error('Update check failed:', err);
  }

  return c.json(defaultResponse);
});

export default app;
