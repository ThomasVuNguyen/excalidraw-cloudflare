import fs from 'fs';
import path from 'path';

const API_BASE = 'https://draw.beenex.company/api/migrate';
const MIGRATION_KEY = 'excalidash-beenex-migration-2026';
const TARGET_USER_ID = '51e29243-4550-4f7a-b480-84e370c1d264'; // thomas@beenex.ai

const EXPORT_FILE = '/tmp/excalidash_export.json';

async function postJson(endpoint, data) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Migration-Key': MIGRATION_KEY,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status} from ${endpoint}: ${errorText}`);
  }

  return res.json();
}

async function main() {
  console.log('🚀 Starting ExcaliDash Migration to draw.beenex.company...');

  if (!fs.existsSync(EXPORT_FILE)) {
    throw new Error(`Export file not found at ${EXPORT_FILE}`);
  }

  const exportData = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf-8'));
  console.log(`Loaded export data:`);
  console.log(`- Users: ${exportData.users?.length}`);
  console.log(`- Collections: ${exportData.collections?.length}`);
  console.log(`- Drawings: ${exportData.drawings?.length}`);
  console.log(`- Link Shares: ${exportData.linkShares?.length}`);
  console.log(`- Snapshots: ${exportData.snapshots?.length}`);

  // 1. Collections
  console.log('\n📁 Migrating collections...');
  for (const coll of exportData.collections || []) {
    if (coll.id.startsWith('trash:') || coll.name.toLowerCase() === 'trash') {
      console.log(`- Skipping trash collection ${coll.id}`);
      continue;
    }

    console.log(`- Migrating collection "${coll.name}" (${coll.id})...`);
    await postJson('/collection', {
      id: coll.id,
      name: coll.name,
      userId: TARGET_USER_ID,
      createdAt: coll.createdAt,
      updatedAt: coll.updatedAt,
    });
    console.log(`  ✓ Collection "${coll.name}" migrated.`);
  }

  // 2. Drawings
  console.log('\n🎨 Migrating drawings...');
  let migratedDrawings = 0;
  let r2OffloadedCount = 0;

  for (let i = 0; i < exportData.drawings.length; i++) {
    const d = exportData.drawings[i];
    const isComfyBloom = d.collectionId === 'c48f9e0b-2f89-4407-87ba-98e01ac0fc6b';
    const targetCollectionId = isComfyBloom ? d.collectionId : null;

    const payload = {
      id: d.id,
      name: d.name,
      userId: TARGET_USER_ID,
      collectionId: targetCollectionId,
      version: d.version,
      elements: d.elements,
      appState: d.appState,
      files: d.files,
      preview: d.preview,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };

    const result = await postJson('/drawing', payload);
    migratedDrawings++;
    if (result.filesStoredAs === 'r2') {
      r2OffloadedCount++;
    }

    const storageType = result.filesStoredAs === 'r2' ? '[R2]' : '[D1]';
    console.log(`[${i + 1}/${exportData.drawings.length}] ${storageType} "${d.name}" (${d.id})`);
  }
  console.log(`✓ Finished migrating ${migratedDrawings} drawings (${r2OffloadedCount} large drawings offloaded to R2).`);

  // 3. Link shares
  console.log('\n🔗 Migrating link shares...');
  let migratedLinkShares = 0;
  for (const ls of exportData.linkShares || []) {
    try {
      await postJson('/link-share', {
        id: ls.id,
        drawingId: ls.drawingId,
        tokenHash: ls.tokenHash,
        permission: ls.permission,
        passphraseHash: ls.passphraseHash,
        expiresAt: ls.expiresAt,
        revokedAt: ls.revokedAt,
        createdBy: TARGET_USER_ID,
        createdAt: ls.createdAt,
      });
      migratedLinkShares++;
    } catch (err) {
      console.warn(`  ⚠️ Failed to migrate link share ${ls.id}:`, err.message);
    }
  }
  console.log(`✓ Finished migrating ${migratedLinkShares} link shares.`);

  // 4. Snapshots
  console.log('\n📸 Migrating drawing snapshots...');
  let migratedSnapshots = 0;
  for (const snap of exportData.snapshots || []) {
    try {
      await postJson('/snapshot', {
        id: snap.id,
        drawingId: snap.drawingId,
        version: snap.version,
        elements: snap.elements,
        appState: snap.appState,
        files: snap.files,
        createdAt: snap.createdAt,
      });
      migratedSnapshots++;
    } catch (err) {
      console.warn(`  ⚠️ Failed to migrate snapshot ${snap.id}:`, err.message);
    }
  }
  console.log(`✓ Finished migrating ${migratedSnapshots} snapshots.`);

  // 5. Verification
  console.log('\n🔍 Verifying final status on draw.beenex.company...');
  const statusRes = await fetch(`${API_BASE}/status`, {
    headers: { 'X-Migration-Key': MIGRATION_KEY },
  });
  const status = await statusRes.json();
  console.log('Final Live Status:', JSON.stringify(status, null, 2));

  console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
