import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ items: [] });

  const library = await c.env.DB.prepare(
    'SELECT * FROM libraries WHERE user_id = ?'
  ).bind(user.id).first();

  let items: any[] = [];
  if (library?.items) {
    try {
      items = JSON.parse(library.items as string);
    } catch {
      items = [];
    }
  }

  return c.json({ items: Array.isArray(items) ? items : [] });
});

app.put('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const { items } = await c.req.json();
  const now = new Date().toISOString();
  const safeItems = Array.isArray(items) ? items : [];
  const itemsStr = JSON.stringify(safeItems);

  const existing = await c.env.DB.prepare('SELECT id FROM libraries WHERE user_id = ?').bind(user.id).first();
  
  if (existing) {
    await c.env.DB.prepare(
      'UPDATE libraries SET items = ?, updated_at = ? WHERE user_id = ?'
    ).bind(itemsStr, now, user.id).run();
  } else {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO libraries (id, user_id, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, user.id, itemsStr, now, now).run();
  }

  return c.json({ items: safeItems });
});

export default app;
