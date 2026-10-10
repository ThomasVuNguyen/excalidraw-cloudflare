import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// GET /
app.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const collectionId = c.req.query('collectionId');
  const sortField = c.req.query('sortField') || 'updatedAt';
  const sortDirection = c.req.query('sortDirection') === 'asc' ? 'ASC' : 'DESC';

  let query = 'SELECT * FROM Drawing WHERE user_id = ?';
  const params: any[] = [user.id];

  if (collectionId) {
    query += ' AND collection_id = ?';
    params.push(collectionId);
  }
  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  const dbSortField = sortField === 'name' ? 'name' : sortField === 'createdAt' ? 'created_at' : 'updated_at';
  query += ` ORDER BY ${dbSortField} ${sortDirection} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

// GET /shared
app.get('/shared', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const { results } = await c.env.DB.prepare(`
    SELECT d.*, dp.permission
    FROM Drawing d
    JOIN DrawingPermission dp ON d.id = dp.drawing_id
    WHERE dp.user_id = ?
  `).bind(user.id).all();

  return c.json(results);
});

// GET /:id
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const shareToken = c.req.query('shareToken');

  const drawing = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing) return c.json({ error: 'Not found' }, 404);

  let hasAccess = false;
  let accessLevel = 'view';

  if (user && drawing.user_id === user.id) {
    hasAccess = true;
    accessLevel = 'edit';
  }

  if (!hasAccess && user) {
    const perm = await c.env.DB.prepare(
      'SELECT permission FROM DrawingPermission WHERE drawing_id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    if (perm) {
      hasAccess = true;
      accessLevel = perm.permission as string;
    }
  }

  if (!hasAccess && shareToken) {
    const hashedToken = await sha256(shareToken);
    const linkShare = await c.env.DB.prepare(
      'SELECT permission FROM DrawingLinkShare WHERE drawing_id = ? AND token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(id, hashedToken, new Date().toISOString()).first();
    if (linkShare) {
      hasAccess = true;
      accessLevel = linkShare.permission as string;
    }
  }

  if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);

  return c.json({ ...drawing, accessLevel });
});

// POST /
app.post('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO Drawing (id, user_id, collection_id, name, elements, app_state, files, preview, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, user.id, body.collectionId || null, body.name || 'Untitled',
    JSON.stringify(body.elements || []), JSON.stringify(body.appState || {}),
    JSON.stringify(body.files || {}), body.preview || null,
    1, now, now
  ).run();

  const newDrawing = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ?').bind(id).first();
  return c.json(newDrawing, 201);
});

// PUT /:id
app.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = new Date().toISOString();

  const current = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ?').bind(id).first();
  if (!current) return c.json({ error: 'Not found' }, 404);

  let hasEdit = false;
  if (user && current.user_id === user.id) hasEdit = true;
  else if (user) {
    const perm = await c.env.DB.prepare('SELECT permission FROM DrawingPermission WHERE drawing_id = ? AND user_id = ?').bind(id, user.id).first();
    if (perm && perm.permission === 'edit') hasEdit = true;
  }
  
  if (!hasEdit) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (current.version !== body.version) {
    return c.json({ error: 'VERSION_CONFLICT', currentVersion: current.version }, 409);
  }

  // Create snapshot
  await c.env.DB.prepare(`
    INSERT INTO DrawingSnapshot (id, drawing_id, version, elements, app_state, files, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), id, current.version,
    current.elements, current.app_state, current.files, current.updated_at
  ).run();

  // Update drawing
  await c.env.DB.prepare(`
    UPDATE Drawing
    SET elements = ?, app_state = ?, files = ?, preview = ?, name = COALESCE(?, name), version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?
  `).bind(
    JSON.stringify(body.elements || []), JSON.stringify(body.appState || {}), JSON.stringify(body.files || {}),
    body.preview || null, body.name, now, id, current.version
  ).run();

  return c.json({ success: true, version: (current.version as number) + 1 });
});

// DELETE /:id
app.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('DELETE FROM Drawing WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!result.success || result.meta.changes === 0) return c.json({ error: 'Not found or not owner' }, 404);
  return c.json({ success: true });
});

// POST /:id/duplicate
app.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const original = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ?').bind(id).first();
  if (!original) return c.json({ error: 'Not found' }, 404);

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO Drawing (id, user_id, collection_id, name, elements, app_state, files, preview, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId, user.id, original.collection_id, \`\${original.name} (Copy)\`,
    original.elements, original.app_state, original.files, original.preview,
    1, now, now
  ).run();

  const duplicated = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ?').bind(newId).first();
  return c.json(duplicated, 201);
});

// History: GET /:id/history
app.get('/:id/history', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT id, version, created_at FROM DrawingSnapshot WHERE drawing_id = ? ORDER BY version DESC').bind(id).all();
  return c.json(results);
});

// History: GET /:id/history/:snapshotId
app.get('/:id/history/:snapshotId', async (c) => {
  const { id, snapshotId } = c.req.param();
  const snapshot = await c.env.DB.prepare('SELECT * FROM DrawingSnapshot WHERE id = ? AND drawing_id = ?').bind(snapshotId, id).first();
  if (!snapshot) return c.json({ error: 'Not found' }, 404);
  return c.json(snapshot);
});

// History: POST /:id/history/:snapshotId/restore
app.post('/:id/history/:snapshotId/restore', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const { id, snapshotId } = c.req.param();

  const current = await c.env.DB.prepare('SELECT * FROM Drawing WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!current) return c.json({ error: 'Not found or not owner' }, 404);

  const snapshot = await c.env.DB.prepare('SELECT * FROM DrawingSnapshot WHERE id = ? AND drawing_id = ?').bind(snapshotId, id).first();
  if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);

  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO DrawingSnapshot (id, drawing_id, version, elements, app_state, files, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), id, current.version, current.elements, current.app_state, current.files, now).run();

  await c.env.DB.prepare(`
    UPDATE Drawing SET elements = ?, app_state = ?, files = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `).bind(snapshot.elements, snapshot.app_state, snapshot.files, now, id).run();

  return c.json({ success: true });
});

// Sharing: GET /:id/sharing
app.get('/:id/sharing', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const drawing = await c.env.DB.prepare('SELECT user_id FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing || (user && drawing.user_id !== user.id)) return c.json({ error: 'Forbidden' }, 403);

  const permissions = await c.env.DB.prepare(`
    SELECT dp.id, dp.user_id, dp.permission, u.email, u.username
    FROM DrawingPermission dp
    JOIN User u ON dp.user_id = u.id
    WHERE dp.drawing_id = ?
  `).bind(id).all();

  const linkShares = await c.env.DB.prepare('SELECT id, permission, expires_at, revoked_at, created_at FROM DrawingLinkShare WHERE drawing_id = ?').bind(id).all();

  return c.json({ permissions: permissions.results, linkShares: linkShares.results });
});

// Sharing: GET /:id/share-resolve
app.get('/:id/share-resolve', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json([]);
  const { results } = await c.env.DB.prepare(`
    SELECT id, username, email FROM User WHERE email LIKE ? OR username LIKE ? LIMIT 10
  `).bind(\`%\${q}%\`, \`%\${q}%\`).all();
  return c.json(results);
});

// Sharing: POST /:id/permissions
app.post('/:id/permissions', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { userId, permission } = await c.req.json();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const drawing = await c.env.DB.prepare('SELECT user_id FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO DrawingPermission (id, drawing_id, user_id, permission, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(drawing_id, user_id) DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), id, userId, permission, now, now).run();

  return c.json({ success: true });
});

// Sharing: DELETE /:id/permissions/:permId
app.delete('/:id/permissions/:permId', async (c) => {
  const user = c.get('user');
  const { id, permId } = c.req.param();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('DELETE FROM DrawingPermission WHERE id = ? AND drawing_id = ?').bind(permId, id).run();
  return c.json({ success: true });
});

// Sharing: POST /:id/link-shares
app.post('/:id/link-shares', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  const { permission, expiresAt, passphrase } = await c.req.json();
  const rawToken = crypto.randomUUID();
  const tokenHash = await sha256(rawToken);

  let passphraseHash = null;
  if (passphrase) {
    passphraseHash = await sha256(passphrase);
  }

  const shareId = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO DrawingLinkShare (id, drawing_id, token_hash, permission, passphrase_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(shareId, id, tokenHash, permission, passphraseHash, expiresAt || null, now).run();

  return c.json({ id: shareId, token: rawToken, permission });
});

// Sharing: DELETE /:id/link-shares/:shareId
app.delete('/:id/link-shares/:shareId', async (c) => {
  const user = c.get('user');
  const { id, shareId } = c.req.param();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM Drawing WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('UPDATE DrawingLinkShare SET revoked_at = ? WHERE id = ? AND drawing_id = ?')
    .bind(new Date().toISOString(), shareId, id).run();

  return c.json({ success: true });
});

export default app;
