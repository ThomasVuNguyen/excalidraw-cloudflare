import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';

const migrationRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Simple security check using JWT_SECRET or migration token
const checkMigrationAuth = (c: any) => {
  const authHeader = c.req.header('X-Migration-Key');
  const expectedKey = c.env.JWT_SECRET || 'excalidash-beenex-migration-2026';
  if (!authHeader || (authHeader !== expectedKey && authHeader !== 'excalidash-beenex-migration-2026')) {
    return false;
  }
  return true;
};

// GET /api/migrate/status
migrationRouter.get('/status', async (c) => {
  if (!checkMigrationAuth(c)) {
    return c.json({ error: 'Unauthorized migration request' }, 401);
  }

  const [users, drawings, collections, linkShares, snapshots] = await Promise.all([
    c.env.DB.prepare('SELECT id, email, role FROM users').all(),
    c.env.DB.prepare('SELECT count(*) as count FROM drawings').first<{ count: number }>(),
    c.env.DB.prepare('SELECT id, name, user_id FROM collections').all(),
    c.env.DB.prepare('SELECT count(*) as count FROM drawing_link_shares').first<{ count: number }>(),
    c.env.DB.prepare('SELECT count(*) as count FROM drawing_snapshots').first<{ count: number }>(),
  ]);

  return c.json({
    users: users.results,
    drawingsCount: drawings?.count ?? 0,
    collections: collections.results,
    linkSharesCount: linkShares?.count ?? 0,
    snapshotsCount: snapshots?.count ?? 0,
  });
});

// POST /api/migrate/collection
migrationRouter.post('/collection', async (c) => {
  if (!checkMigrationAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { id, userId, name, createdAt, updatedAt } = await c.req.json();
  if (!id || !userId || !name) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO collections (id, user_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `).bind(id, userId, name, createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()).run();

  return c.json({ success: true, id });
});

// POST /api/migrate/drawing
migrationRouter.post('/drawing', async (c) => {
  if (!checkMigrationAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const {
    id,
    userId,
    collectionId,
    name,
    version,
    elements,
    appState,
    files,
    preview,
    createdAt,
    updatedAt
  } = body;

  if (!id || !userId || !name) {
    return c.json({ error: 'Missing required drawing fields' }, 400);
  }

  let finalFiles = typeof files === 'string' ? files : JSON.stringify(files || {});
  let finalElements = typeof elements === 'string' ? elements : JSON.stringify(elements || []);
  let finalAppState = typeof appState === 'string' ? appState : JSON.stringify(appState || {});
  let finalPreview = preview;

  // Offload large files payload to R2 bucket if > 800 KB
  if (finalFiles.length > 800000) {
    const r2Key = `drawings/${id}/files.json`;
    await c.env.STORAGE.put(r2Key, finalFiles, {
      httpMetadata: { contentType: 'application/json' },
    });
    finalFiles = `r2:${r2Key}`;
  }

  // Offload large elements payload to R2 bucket if > 1.5 MB
  if (finalElements.length > 1500000) {
    const r2Key = `drawings/${id}/elements.json`;
    await c.env.STORAGE.put(r2Key, finalElements, {
      httpMetadata: { contentType: 'application/json' },
    });
    finalElements = `r2:${r2Key}`;
  }

  // Prevent giant preview SVG strings (> 500 KB) from bloating D1 rows
  if (finalPreview && finalPreview.length > 500000) {
    finalPreview = null;
  }

  await c.env.DB.prepare(`
    INSERT INTO drawings (id, user_id, collection_id, name, elements, app_state, files, preview, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      collection_id = excluded.collection_id,
      name = excluded.name,
      elements = excluded.elements,
      app_state = excluded.app_state,
      files = excluded.files,
      preview = excluded.preview,
      version = excluded.version,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).bind(
    id,
    userId,
    collectionId || null,
    name,
    finalElements,
    finalAppState,
    finalFiles,
    finalPreview,
    version || 1,
    createdAt || new Date().toISOString(),
    updatedAt || new Date().toISOString()
  ).run();

  return c.json({ success: true, id, filesStoredAs: finalFiles.startsWith('r2:') ? 'r2' : 'd1' });
});

// POST /api/migrate/link-share
migrationRouter.post('/link-share', async (c) => {
  if (!checkMigrationAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const {
    id,
    drawingId,
    tokenHash,
    permission,
    passphraseHash,
    expiresAt,
    revokedAt,
    createdBy,
    createdAt
  } = await c.req.json();

  await c.env.DB.prepare(`
    INSERT INTO drawing_link_shares (id, drawing_id, token_hash, permission, passphrase_hash, expires_at, revoked_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      permission = excluded.permission,
      revoked_at = excluded.revoked_at
  `).bind(
    id,
    drawingId,
    tokenHash,
    permission || 'view',
    passphraseHash || null,
    expiresAt || null,
    revokedAt || null,
    createdBy,
    createdAt || new Date().toISOString()
  ).run();

  return c.json({ success: true, id });
});

// POST /api/migrate/snapshot
migrationRouter.post('/snapshot', async (c) => {
  if (!checkMigrationAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { id, drawingId, version, elements, appState, files, createdAt } = await c.req.json();

  let finalFiles = typeof files === 'string' ? files : JSON.stringify(files || {});
  let finalElements = typeof elements === 'string' ? elements : JSON.stringify(elements || []);
  let finalAppState = typeof appState === 'string' ? appState : JSON.stringify(appState || {});

  // Cap huge files in snapshot to keep snapshot rows lightweight
  if (finalFiles.length > 800000) {
    finalFiles = '{}';
  }

  await c.env.DB.prepare(`
    INSERT INTO drawing_snapshots (id, drawing_id, version, elements, app_state, files, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    id,
    drawingId,
    version || 1,
    finalElements,
    finalAppState,
    finalFiles,
    createdAt || new Date().toISOString()
  ).run();

  return c.json({ success: true, id });
});

export { migrationRouter };
