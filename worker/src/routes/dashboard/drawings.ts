import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseJsonSafe<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val as T;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function toTimestamp(dateVal: any): number {
  if (!dateVal) return Date.now();
  if (typeof dateVal === 'number') return dateVal;
  const parsed = Date.parse(String(dateVal));
  return isNaN(parsed) ? Date.now() : parsed;
}

async function hydrateR2Field(env: Env, val: any, fallback: any): Promise<any> {
  if (typeof val === 'string' && val.startsWith('r2:')) {
    try {
      const key = val.slice(3);
      const obj = await env.STORAGE.get(key);
      if (obj) {
        const text = await obj.text();
        return parseJsonSafe(text, fallback);
      }
    } catch (e) {
      console.error('Failed to read from R2:', e);
    }
    return fallback;
  }
  return parseJsonSafe(val, fallback);
}

function formatDrawing(d: any, accessLevel: string = 'owner') {
  return {
    id: d.id,
    userId: d.user_id,
    name: d.name,
    collectionId: d.collection_id || null,
    elements: parseJsonSafe(d.elements, []),
    appState: parseJsonSafe(d.app_state, {}),
    files: parseJsonSafe(d.files, {}),
    preview: d.preview || null,
    version: d.version ?? 1,
    createdAt: toTimestamp(d.created_at),
    updatedAt: toTimestamp(d.updated_at),
    accessLevel,
  };
}

function formatDrawingSummary(d: any, accessLevel: string = 'owner') {
  return {
    id: d.id,
    name: d.name,
    collectionId: d.collection_id || null,
    preview: d.preview || null,
    version: d.version ?? 1,
    createdAt: toTimestamp(d.created_at),
    updatedAt: toTimestamp(d.updated_at),
    accessLevel,
  };
}

// GET /
app.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ drawings: [], totalCount: 0, limit: 20, offset: 0 });

  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const collectionId = c.req.query('collectionId');
  const includeData = c.req.query('includeData') === 'true';
  const sortField = c.req.query('sortField') || 'updatedAt';
  const sortDirection = c.req.query('sortDirection') === 'asc' ? 'ASC' : 'DESC';

  let where = 'WHERE user_id = ?';
  const params: any[] = [user.id];

  if (collectionId === 'null') {
    where += ' AND collection_id IS NULL';
  } else if (collectionId) {
    where += ' AND collection_id = ?';
    params.push(collectionId);
  }

  if (search) {
    where += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  const countRow = await c.env.DB.prepare(`SELECT count(*) as count FROM drawings ${where}`).bind(...params).first<{ count: number }>();
  const totalCount = countRow ? countRow.count : 0;

  const dbSortField = sortField === 'name' ? 'name' : sortField === 'createdAt' ? 'created_at' : 'updated_at';
  const query = `SELECT * FROM drawings ${where} ORDER BY ${dbSortField} ${sortDirection} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  const drawings = results.map(d => includeData ? formatDrawing(d, 'owner') : formatDrawingSummary(d, 'owner'));

  return c.json({
    drawings,
    totalCount,
    limit,
    offset,
  });
});

// GET /shared
app.get('/shared', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ drawings: [], totalCount: 0, limit: 20, offset: 0 });

  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const includeData = c.req.query('includeData') === 'true';

  let where = 'WHERE dp.user_id = ?';
  const params: any[] = [user.id];

  if (search) {
    where += ' AND d.name LIKE ?';
    params.push(`%${search}%`);
  }

  const countRow = await c.env.DB.prepare(`
    SELECT count(*) as count
    FROM drawings d
    JOIN drawing_permissions dp ON d.id = dp.drawing_id
    ${where}
  `).bind(...params).first<{ count: number }>();
  const totalCount = countRow ? countRow.count : 0;

  const query = `
    SELECT d.*, dp.permission AS access_level
    FROM drawings d
    JOIN drawing_permissions dp ON d.id = dp.drawing_id
    ${where}
    ORDER BY d.updated_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  const drawings = results.map(d => {
    const level = (d.access_level as string) || 'view';
    return includeData ? formatDrawing(d, level) : formatDrawingSummary(d, level);
  });

  return c.json({
    drawings,
    totalCount,
    limit,
    offset,
  });
});

// GET /:id
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const shareToken = c.req.query('shareToken');

  const drawing = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  if (!drawing) return c.json({ error: 'Drawing not found', message: 'Drawing does not exist' }, 404);

  let hasAccess = false;
  let accessLevel = 'view';

  if (user && drawing.user_id === user.id) {
    hasAccess = true;
    accessLevel = 'owner';
  }

  if (!hasAccess && user) {
    const perm = await c.env.DB.prepare(
      'SELECT permission FROM drawing_permissions WHERE drawing_id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    if (perm) {
      hasAccess = true;
      accessLevel = perm.permission as string;
    }
  }

  if (!hasAccess && shareToken) {
    const hashedToken = await sha256(shareToken);
    const linkShare = await c.env.DB.prepare(
      'SELECT permission FROM drawing_link_shares WHERE drawing_id = ? AND token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(id, hashedToken, new Date().toISOString()).first();
    if (linkShare) {
      hasAccess = true;
      accessLevel = linkShare.permission as string;
    }
  }

  if (!hasAccess && !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);

  const formatted = formatDrawing(drawing, accessLevel);
  formatted.files = await hydrateR2Field(c.env, drawing.files, {});
  formatted.elements = await hydrateR2Field(c.env, drawing.elements, []);
  return c.json(formatted);
});

// POST /
app.post('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json();
  const id = body.id || crypto.randomUUID();
  const now = body.createdAt ? new Date(body.createdAt).toISOString() : new Date().toISOString();
  const updated = body.updatedAt ? new Date(body.updatedAt).toISOString() : now;

  let filesVal = JSON.stringify(body.files || {});
  if (filesVal.length > 800000) {
    const key = `drawings/${id}/files.json`;
    await c.env.STORAGE.put(key, filesVal, { httpMetadata: { contentType: 'application/json' } });
    filesVal = `r2:${key}`;
  }

  let elementsVal = JSON.stringify(body.elements || []);
  if (elementsVal.length > 1500000) {
    const key = `drawings/${id}/elements.json`;
    await c.env.STORAGE.put(key, elementsVal, { httpMetadata: { contentType: 'application/json' } });
    elementsVal = `r2:${key}`;
  }

  let previewVal = body.preview || null;
  if (previewVal && previewVal.length > 500000) {
    previewVal = null;
  }

  await c.env.DB.prepare(`
    INSERT INTO drawings (id, user_id, collection_id, name, elements, app_state, files, preview, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, user.id, body.collectionId || null, body.name || 'Untitled Drawing',
    elementsVal, JSON.stringify(body.appState || {}),
    filesVal, previewVal,
    body.version || 1, now, updated
  ).run();

  const newDrawing = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  const formatted = formatDrawing(newDrawing, 'owner');
  formatted.files = await hydrateR2Field(c.env, newDrawing?.files, {});
  formatted.elements = await hydrateR2Field(c.env, newDrawing?.elements, []);
  return c.json(formatted, 201);
});

// PUT /:id
app.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = new Date().toISOString();

  const current = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  if (!current) return c.json({ error: 'Not found' }, 404);

  let hasEdit = false;
  if (user && current.user_id === user.id) hasEdit = true;
  else if (user) {
    const perm = await c.env.DB.prepare('SELECT permission FROM drawing_permissions WHERE drawing_id = ? AND user_id = ?').bind(id, user.id).first();
    if (perm && (perm.permission === 'edit' || perm.permission === 'owner')) hasEdit = true;
  }
  
  if (!hasEdit) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (body.version !== undefined && current.version !== body.version) {
    return c.json({ error: 'VERSION_CONFLICT', currentVersion: current.version }, 409);
  }

  const nextVersion = (current.version as number) + 1;

  // Create snapshot
  await c.env.DB.prepare(`
    INSERT INTO drawing_snapshots (id, drawing_id, version, elements, app_state, files, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), id, current.version,
    current.elements as string, current.app_state as string, current.files as string, current.updated_at as string
  ).run();

  let filesVal = body.files !== undefined ? JSON.stringify(body.files) : null;
  if (filesVal && filesVal.length > 800000) {
    const key = `drawings/${id}/files.json`;
    await c.env.STORAGE.put(key, filesVal, { httpMetadata: { contentType: 'application/json' } });
    filesVal = `r2:${key}`;
  }

  let elementsVal = body.elements !== undefined ? JSON.stringify(body.elements) : null;
  if (elementsVal && elementsVal.length > 1500000) {
    const key = `drawings/${id}/elements.json`;
    await c.env.STORAGE.put(key, elementsVal, { httpMetadata: { contentType: 'application/json' } });
    elementsVal = `r2:${key}`;
  }

  let previewVal = body.preview !== undefined ? (body.preview && body.preview.length > 500000 ? null : body.preview) : undefined;

  // Update drawing
  await c.env.DB.prepare(`
    UPDATE drawings
    SET elements = COALESCE(?, elements),
        app_state = COALESCE(?, app_state),
        files = COALESCE(?, files),
        preview = CASE WHEN ? IS NOT NULL THEN ? ELSE preview END,
        name = COALESCE(?, name),
        version = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(
    elementsVal,
    body.appState ? JSON.stringify(body.appState) : null,
    filesVal,
    previewVal !== undefined ? 'set' : null,
    previewVal ?? null,
    body.name || null,
    nextVersion,
    now,
    id
  ).run();

  const updated = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  const formatted = formatDrawing(updated, user && current.user_id === user.id ? 'owner' : 'edit');
  formatted.files = await hydrateR2Field(c.env, updated?.files, {});
  formatted.elements = await hydrateR2Field(c.env, updated?.elements, []);
  return c.json(formatted);
});

// DELETE /:id
app.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');

  const current = await c.env.DB.prepare('SELECT files, elements FROM drawings WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (current) {
    if (typeof current.files === 'string' && current.files.startsWith('r2:')) {
      await c.env.STORAGE.delete(current.files.slice(3)).catch(() => {});
    }
    if (typeof current.elements === 'string' && current.elements.startsWith('r2:')) {
      await c.env.STORAGE.delete(current.elements.slice(3)).catch(() => {});
    }
  }

  const result = await c.env.DB.prepare('DELETE FROM drawings WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!result.success || result.meta.changes === 0) return c.json({ error: 'Not found or not owner' }, 404);
  return c.json({ success: true });
});

// POST /:id/duplicate
app.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const original = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  if (!original) return c.json({ error: 'Not found' }, 404);

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const copyName = `${original.name} (Copy)`;
  await c.env.DB.prepare(`
    INSERT INTO drawings (id, user_id, collection_id, name, elements, app_state, files, preview, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId, user.id, original.collection_id, copyName,
    original.elements, original.app_state, original.files, original.preview,
    1, now, now
  ).run();

  const duplicated = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(newId).first();
  return c.json(formatDrawing(duplicated, 'owner'), 201);
});

// History: GET /:id/history
app.get('/:id/history', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT id, version, created_at FROM drawing_snapshots WHERE drawing_id = ? ORDER BY version DESC').bind(id).all();
  return c.json(results);
});

// History: GET /:id/history/:snapshotId
app.get('/:id/history/:snapshotId', async (c) => {
  const { id, snapshotId } = c.req.param();
  const snapshot = await c.env.DB.prepare('SELECT * FROM drawing_snapshots WHERE id = ? AND drawing_id = ?').bind(snapshotId, id).first();
  if (!snapshot) return c.json({ error: 'Not found' }, 404);
  return c.json(snapshot);
});

// History: POST /:id/history/:snapshotId/restore
app.post('/:id/history/:snapshotId/restore', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const { id, snapshotId } = c.req.param();

  const current = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!current) return c.json({ error: 'Not found or not owner' }, 404);

  const snapshot = await c.env.DB.prepare('SELECT * FROM drawing_snapshots WHERE id = ? AND drawing_id = ?').bind(snapshotId, id).first();
  if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);

  const now = new Date().toISOString();
  const nextVersion = (current.version as number) + 1;

  await c.env.DB.prepare(`
    INSERT INTO drawing_snapshots (id, drawing_id, version, elements, app_state, files, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), id, current.version, current.elements, current.app_state, current.files, now).run();

  await c.env.DB.prepare(`
    UPDATE drawings SET elements = ?, app_state = ?, files = ?, version = ?, updated_at = ?
    WHERE id = ?
  `).bind(snapshot.elements, snapshot.app_state, snapshot.files, nextVersion, now, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM drawings WHERE id = ?').bind(id).first();
  return c.json(formatDrawing(updated, 'owner'));
});

// Sharing: GET /:id/sharing
app.get('/:id/sharing', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const drawing = await c.env.DB.prepare('SELECT user_id FROM drawings WHERE id = ?').bind(id).first();
  if (!drawing || (user && drawing.user_id !== user.id)) return c.json({ error: 'Forbidden' }, 403);

  const permissions = await c.env.DB.prepare(`
    SELECT dp.id, dp.user_id as granteeUserId, dp.permission, u.email, u.username as name
    FROM drawing_permissions dp
    JOIN users u ON dp.user_id = u.id
    WHERE dp.drawing_id = ?
  `).bind(id).all();

  const linkShares = await c.env.DB.prepare('SELECT id, permission, expires_at as expiresAt, revoked_at as revokedAt, created_at as createdAt FROM drawing_link_shares WHERE drawing_id = ?').bind(id).all();

  return c.json({ permissions: permissions.results, linkShares: linkShares.results });
});

// Sharing: GET /:id/share-resolve
app.get('/:id/share-resolve', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ users: [] });
  const searchPattern = `%${q}%`;
  const { results } = await c.env.DB.prepare(
    'SELECT id, username as name, email FROM users WHERE email LIKE ? OR username LIKE ? LIMIT 10'
  ).bind(searchPattern, searchPattern).all();
  return c.json({ users: results });
});

// Sharing: POST /:id/permissions
app.post('/:id/permissions', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { granteeUserId, userId, permission } = await c.req.json();
  const targetUserId = granteeUserId || userId;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const drawing = await c.env.DB.prepare('SELECT user_id FROM drawings WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  const now = new Date().toISOString();
  const permId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO drawing_permissions (id, drawing_id, user_id, permission, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(drawing_id, user_id) DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at
  `).bind(permId, id, targetUserId, permission, now, now).run();

  return c.json({ success: true });
});

// Sharing: DELETE /:id/permissions/:permId
app.delete('/:id/permissions/:permId', async (c) => {
  const user = c.get('user');
  const { id, permId } = c.req.param();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM drawings WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('DELETE FROM drawing_permissions WHERE id = ? AND drawing_id = ?').bind(permId, id).run();
  return c.json({ success: true });
});

// Sharing: POST /:id/link-shares
app.post('/:id/link-shares', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM drawings WHERE id = ?').bind(id).first();
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
    INSERT INTO drawing_link_shares (id, drawing_id, token_hash, permission, passphrase_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(shareId, id, tokenHash, permission, passphraseHash, expiresAt || null, now).run();

  return c.json({ share: { id: shareId, token: rawToken, permission, expiresAt: expiresAt || null, revokedAt: null, createdAt: now, updatedAt: now, lastUsedAt: null } });
});

// Sharing: DELETE /:id/link-shares/:shareId
app.delete('/:id/link-shares/:shareId', async (c) => {
  const user = c.get('user');
  const { id, shareId } = c.req.param();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const drawing = await c.env.DB.prepare('SELECT user_id FROM drawings WHERE id = ?').bind(id).first();
  if (!drawing || drawing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('UPDATE drawing_link_shares SET revoked_at = ? WHERE id = ? AND drawing_id = ?')
    .bind(new Date().toISOString(), shareId, id).run();

  return c.json({ success: true });
});

export default app;
