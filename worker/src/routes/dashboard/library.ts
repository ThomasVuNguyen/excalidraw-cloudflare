import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const library = await c.env.DB.prepare(
    'SELECT * FROM Library WHERE user_id = ?'
  ).bind(user.id).first();

  return c.json(library || { items: '[]' });
});

app.put('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const { items } = await c.req.json();
  const now = new Date().toISOString();
  const itemsStr = JSON.stringify(items);

  const existing = await c.env.DB.prepare('SELECT id FROM Library WHERE user_id = ?').bind(user.id).first();
  
  if (existing) {
    await c.env.DB.prepare(
      'UPDATE Library SET items = ?, updated_at = ? WHERE user_id = ?'
    ).bind(itemsStr, now, user.id).run();
  } else {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO Library (id, user_id, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, user.id, itemsStr, now, now).run();
  }

  return c.json({ success: true });
});

export default app;
