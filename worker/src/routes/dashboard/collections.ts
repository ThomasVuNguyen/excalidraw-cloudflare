import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM Collection WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  return c.json(results);
});

app.post('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const { name } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO Collection (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.id, name, now, now).run();

  const newCollection = await c.env.DB.prepare(
    'SELECT * FROM Collection WHERE id = ?'
  ).bind(id).first();

  return c.json(newCollection, 201);
});

app.put('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const { name } = await c.req.json();
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    'UPDATE Collection SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(name, now, id, user.id).run();

  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: 'Collection not found or update failed' }, 404);
  }

  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');

  await c.env.DB.prepare(
    'UPDATE Drawing SET collection_id = NULL WHERE collection_id = ? AND user_id = ?'
  ).bind(id, user.id).run();

  const result = await c.env.DB.prepare(
    'DELETE FROM Collection WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();

  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: 'Collection not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
